// One message over one submission session (RFC 5321 4.5.2, RFC 6409): "Before sending a line of
// mail text, the SMTP client checks the first character of the line." So the data cannot end early,
// and the bytes arrive as written. Before the message's first byte nothing was handed over, so a
// failure is a refusal; from that byte on only the server's reply decides, by its first digit
// (RFC 5321 4.2), and its absence is unknown.
import { timer, type Connection, type Deadline } from "./connection.ts";
import type { Outcome, Outgoing } from "./index.ts";

export type Login = { user: string; password: string };

type Refused = Extract<Outcome, { kind: "refused" }>;
type Why = Pick<Refused, "stage" | "final" | "code" | "text">;
type Reply = { code: number; lines: string[] };
// `open` is true when the last thing heard was a complete reply, so QUIT can be written.
type Ended = { outcomes: Outcome[]; open: boolean };

const PERIOD = 0x2e;
const CR = 0x0d;
const LF = 0x0a;
const TERMINATOR = Uint8Array.of(PERIOD, CR, LF);
/** RFC 5321 4.5.3.1.4: the longest command line, counting its CRLF. */
const MAX_COMMAND_LINE = 512;
/** RFC 5321 4.2.1: a code, then a space, a hyphen or nothing. */
const REPLY_LINE = /^\d{3}([ -]|$)/;

const encoder = new TextEncoder();

/** RFC 5321 4.5.2: a period at the start of the data or after a CRLF is the start of a line. */
function startsLineWithPeriod(bytes: Uint8Array, i: number): boolean {
  return bytes[i] === PERIOD && (i === 0 || (bytes[i - 1] === LF && bytes[i - 2] === CR));
}

/**
 * RFC 5321 4.5.2: doubles a period at the start of a line and ends the data with a period and
 * CRLF. It works on bytes: `TextDecoder`'s `ascii` label is really windows-1252.
 */
export function stuff(bytes: Uint8Array): Uint8Array {
  const doubled = bytes.reduce((n, _, i) => n + (startsLineWithPeriod(bytes, i) ? 1 : 0), 0);
  const out = new Uint8Array(bytes.length + doubled + TERMINATOR.length);
  let at = 0;
  for (const [i, byte] of bytes.entries()) {
    if (startsLineWithPeriod(bytes, i)) out[at++] = PERIOD;
    out[at++] = byte;
  }
  out.set(TERMINATOR, at);
  return out;
}

/** RFC 5321 2.3.1: a command is its text and CRLF. */
function command(text: string): Uint8Array {
  return encoder.encode(`${text}\r\n`);
}

/**
 * RFC 5321 4.2.1: lines with `-` after the code continue a reply, and its code is its last line's.
 * Any other line, or a `line()` that throws, counts as a closed connection: null.
 */
async function readReply(conn: Connection): Promise<Reply | null> {
  const lines: string[] = [];
  try {
    for (;;) {
      const line = await conn.line();
      if (line === null || !REPLY_LINE.test(line)) return null;
      lines.push(line.slice(4));
      if (line.charAt(3) !== "-") return { code: Number(line.slice(0, 3)), lines };
    }
  } catch {
    return null;
  }
}

/** RFC 5321 4.3: writes, then reads the reply; a `write()` that throws counts as closed: null. */
async function exchange(conn: Connection, bytes: Uint8Array): Promise<Reply | null> {
  try {
    await conn.write(bytes);
  } catch {
    return null;
  }
  return readReply(conn);
}

/** RFC 5321 4.2: the reply's first digit, all a client may rely on. */
function digit(reply: Reply): number {
  return Math.floor(reply.code / 100);
}

/** RFC 5321 4.2: true for a complete reply of this first digit; false says only that it is not one. */
function isClass(reply: Reply | null, first: number): reply is Reply {
  return reply !== null && digit(reply) === first;
}

/** Form 01a19d25, Final: why a step refused; a closed connection has code null. */
function why(stage: Refused["stage"], reply: Reply | null, final = false): Why {
  return reply === null
    ? { stage, final, code: null, text: "connection closed" }
    : { stage, final, code: reply.code, text: reply.lines.join("\n") };
}

/** Form 01a19d25: `AUTH PLAIN` as a later token of an EHLO keyword line; `AUTH=PLAIN` does not count. */
function offersPlain(ehlo: Reply): boolean {
  return ehlo.lines.slice(1).some((line) => {
    const [keyword, ...later] = line.toUpperCase().split(" ");
    return keyword === "AUTH" && later.includes("PLAIN");
  });
}

/** RFC 4616 2: NUL, user, NUL, password, as UTF-8, then base64. */
function plainCredential(login: Login): string {
  const octets = encoder.encode(`\0${login.user}\0${login.password}`);
  return btoa(Array.from(octets, (octet) => String.fromCharCode(octet)).join(""));
}

/** Form 01a19d25: the terminator's reply decides, and only its first digit. */
function atTerminator(recipient: string, reply: Reply | null): Outcome {
  if (reply === null) {
    return { recipient, kind: "unknown", detail: "connection lost after the message began" };
  }
  const first = digit(reply);
  const text = reply.lines.join("\n");
  // A positive reply means the server took the message: recording 251 as a refusal sends it twice.
  if (first === 2) return { recipient, kind: "accepted", providerId: null, text };
  if (first === 4 || first === 5) {
    return { recipient, kind: "refused", ...why("data", reply, first === 5) };
  }
  return { recipient, kind: "unknown", detail: `unexpected reply: ${reply.code} ${text}` };
}

/** RFC 6409 and form 01a19d25: one session's commands in order, each decided by the session table. */
async function session(
  conn: Connection,
  settings: { ehlo: string; login: Login },
  { bytes, envelope: { from, to } }: Outgoing,
): Promise<Ended> {
  const refusals = new Map<string, Outcome>();
  // Each result applies to every recipient but those already refused at RCPT.
  const each = (outcome: (recipient: string) => Outcome, open: boolean): Ended => ({
    outcomes: to.map((recipient) => refusals.get(recipient) ?? outcome(recipient)),
    open,
  });
  const refuse = (reason: Why, open: boolean): Ended =>
    each((recipient) => ({ recipient, kind: "refused", ...reason }), open);
  const refuseAt = (stage: Refused["stage"], reply: Reply | null): Ended =>
    refuse(why(stage, reply), reply !== null);

  const greeting = await readReply(conn);
  if (!isClass(greeting, 2)) return refuseAt("greeting", greeting);

  const ehlo = await exchange(conn, command(`EHLO ${settings.ehlo}`));
  if (!isClass(ehlo, 2)) return refuseAt("ehlo", ehlo);
  if (!offersPlain(ehlo)) {
    const text = "server does not offer AUTH PLAIN";
    return refuse({ stage: "auth", final: false, code: null, text }, true);
  }

  const authLine = command(`AUTH PLAIN ${plainCredential(settings.login)}`);
  if (authLine.length > MAX_COMMAND_LINE) {
    // RFC 4954 4 forbids the initial response on a later line, so it cannot be sent at all.
    const text = "credential too long for AUTH PLAIN";
    return refuse({ stage: "auth", final: false, code: null, text }, true);
  }
  const auth = await exchange(conn, authLine);
  if (!isClass(auth, 2)) return refuseAt("auth", auth);

  const mail = await exchange(conn, command(`MAIL FROM:<${from}>`));
  if (!isClass(mail, 2)) return refuseAt("mail", mail);

  for (const recipient of to) {
    const rcpt = await exchange(conn, command(`RCPT TO:<${recipient}>`));
    if (rcpt === null) return refuseAt("rcpt", rcpt);
    if (!isClass(rcpt, 2)) {
      const reason = why("rcpt", rcpt, digit(rcpt) === 5);
      refusals.set(recipient, { recipient, kind: "refused", ...reason });
    }
  }
  // With none accepted every recipient already has its own refusal, and this reason goes unused.
  if (to.every((recipient) => refusals.has(recipient))) return refuse(why("rcpt", null), true);

  const data = await exchange(conn, command("DATA"));
  if (!isClass(data, 3)) return refuseAt("data", data);

  const answer = await exchange(conn, stuff(bytes));
  return each((recipient) => atTerminator(recipient, answer), answer !== null);
}

/** Form 01a19d25, QUIT: waits at most `ms`; the result is already decided, so a throw is ignored. */
async function briefly(
  deadline: Deadline,
  ms: number,
  work: () => Promise<unknown>,
): Promise<void> {
  const bound = deadline(ms, "quit wait");
  const { promise, resolve } = Promise.withResolvers<void>();
  bound.signal.addEventListener("abort", () => resolve(), { once: true });
  try {
    await Promise.race([work(), promise]);
  } catch {
    // Neither QUIT nor close can replace or lose a result.
  } finally {
    bound.clear();
  }
}

/**
 * RFC 5321 4.1.1.10 and form 01a19d25: submits one message, one Outcome per envelope recipient in
 * envelope order. After any complete reply it writes QUIT, and it always closes, each bounded by
 * `quitWaitMs`, because a Worker dying during a long wait would lose a known result.
 */
export async function submit(
  conn: Connection,
  settings: { ehlo: string; login: Login; quitWaitMs?: number; deadline?: Deadline },
  message: Outgoing,
): Promise<Outcome[]> {
  const wait = settings.quitWaitMs ?? 5_000;
  const { deadline = timer } = settings;
  try {
    const { outcomes, open } = await session(conn, settings, message);
    if (open) await briefly(deadline, wait, () => exchange(conn, command("QUIT")));
    return outcomes;
  } finally {
    await briefly(deadline, wait, () => conn.close());
  }
}
