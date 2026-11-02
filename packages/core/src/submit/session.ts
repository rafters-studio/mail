// The state machine (RFC 5321 4.1.4): "There are restrictions on the order in which these commands
// may be used." A session is octets in and octets out, like IMAP, so one session serves every
// transport. What it holds of a partial command, an AUTH continuation or a message is memory only: a
// step is a whole command, and a session resumed in a message reads none of it as a command.
import { ZodError } from "zod";
import { never } from "../encoding/never.ts";
import type { Random } from "../message/index.ts";
import { binary, readMessage } from "../read/index.ts";
import { digest } from "../receive/digest.ts";
import { domainName } from "../receive/recipient.ts";
import type { Outcome } from "../send/index.ts";
import { UNSAFE_ADDRESS } from "../send/unsafe.ts";
import type { SubmitInput, SubmitPorts, SubmitSnapshot } from "./index.ts";
import { asSent, hasBadBytes, hasDate, holdInput, originators } from "./message.ts";
import { noticeSubject, providerText, writeNotice } from "./notice.ts";
import { messageReader, readLine } from "./reader.ts";

const BAD_SYNTAX = "501 Bad syntax";
const BAD_ADDRESS = "501 Bad address";
const BAD_ENCODING = "501 Bad encoding";
const BAD_SEQUENCE = "503 Bad sequence";
const BAD_CREDENTIALS = "535 Bad credentials";
const TRY_AGAIN = "451 Try again";
const NOT_YOURS = "553 Not your address";
const TOO_LARGE = "552 Too large";
const BAD_MESSAGE = "554 Bad message";
const OK = "250 Ok";

/** The text `ports.submit` gives a row that may belong to an attempt still running (The answer). */
const STILL_SENDING = "still sending";

// RFC 5321 4.1.2: a path in brackets, then parameters. `MAIL FROM: <a>` and no brackets are not it.
const MAIL_PATH = /^FROM:<(.*?)>(?: (.*))?$/i;
const RCPT_PATH = /^TO:<(.*?)>(?: (.*))?$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type Phase = SubmitSnapshot["phase"];
type Answer = string | Promise<string>;
/** A message on its way in, and whose it is. */
type Reading = { reader: ReturnType<typeof messageReader>; mailbox: string; to: string[] };

/**
 * RFC 6409 4.2: the domain of a safe address with one `@`, whose right side has at least one dot;
 * null for any other. A comma is unsafe here: it is how a route or a list would arrive.
 */
function addressDomain(address: string): string | null {
  if (UNSAFE_ADDRESS.test(address) || address.includes(",")) return null;
  if (address.split("@").length !== 2) return null;
  const domain = domainName(address.slice(address.indexOf("@") + 1));
  return domain?.includes(".") ? domain : null;
}

/** RFC 4954 4: a client's base64 as binary text, or null when it is not base64. */
function decoded(text: string): string | null {
  return BASE64.test(text) ? atob(text) : null;
}

/**
 * RFC 5321 6.1 and form 01a19de8, Notices: what a person must be told of one outcome, or nothing. An
 * accepted one has gone, and a row still sending will be asked about again.
 */
function failure(outcome: Outcome): { recipient: string; text: string }[] {
  const { recipient } = outcome;
  if (outcome.kind === "accepted") return [];
  if (outcome.kind === "unknown") {
    return [{ recipient, text: `may not have gone: ${providerText(outcome.detail)}` }];
  }
  /* v8 ignore next */ if (outcome.kind !== "refused") return never(outcome);
  return outcome.text === STILL_SENDING ? [] : [{ recipient, text: providerText(outcome.text) }];
}

/**
 * RFC 5321 4.1.4: one connection's session from `from`; binary text in, and text out with every
 * reply's CRLF. Bytes queued behind a command are read only after it is answered.
 */
export function startSession(env: {
  ports: SubmitPorts;
  hostname: string;
  from: SubmitSnapshot;
  random: Random;
  now: () => Date;
  maxSize: number;
  maxRecipients: number;
}): {
  receive: (input: string) => Promise<string>;
  closed: () => boolean;
  snapshot: () => SubmitSnapshot;
} {
  const { ports, hostname, random, now, maxSize, maxRecipients } = env;
  let phase: Phase = env.from.phase;
  let failed = env.from.failures;
  let buffer = "";
  let reading: Reading | null = null;
  let waiting: ((line: string) => Answer) | null = null;

  const closed = (): boolean => phase.name === "closed";

  /** RSET and a later EHLO or HELO (RFC 5321 4.1.1.5): the envelope goes and the login stays. */
  const reset = (): void => {
    if (phase.name === "envelope") phase = { name: "ready", mailbox: phase.mailbox };
  };

  /** RFC 4954 4: answers with a challenge, and the next line is the client's response to it. */
  const challenge = (reply: string, next: (line: string) => Answer): string => {
    waiting = next;
    return reply;
  };

  /** Form 01a19de8, Logging in: only a 535 counts toward the three that close. */
  const refuseLogin = (): string => {
    failed++;
    if (failed < 3) return BAD_CREDENTIALS;
    phase = { name: "closed" };
    return `${BAD_CREDENTIALS}\r\n421 Too many failures`;
  };

  /** RFC 4954 6: a login that throws answers 454, so a D1 outage does not close sessions. */
  const logIn = async (user: string, password: string): Promise<string> => {
    let mailbox: string | null;
    try {
      mailbox = await ports.login(user, password);
    } catch {
      return "454 Try again";
    }
    if (mailbox === null) return refuseLogin();
    phase = { name: "ready", mailbox };
    return "235 Ok";
  };

  /** RFC 4616 2: authorization identity, NUL, user, NUL, password; an identity must be the user. */
  const plain = (response: string): Answer => {
    const [identity, user, password, ...more] = decoded(response)?.split("\0") ?? [];
    if (identity === undefined || user === undefined || password === undefined || more.length > 0)
      return BAD_ENCODING;
    return identity !== "" && identity !== user ? refuseLogin() : logIn(user, password);
  };

  /** The LOGIN mechanism's username, held in memory only until its password arrives. */
  const loginUser = (response: string): Answer => {
    const user = decoded(response);
    if (user === null) return BAD_ENCODING;
    return challenge("334 UGFzc3dvcmQ6", (line) => {
      const password = decoded(line);
      return password === null ? BAD_ENCODING : logIn(user, password);
    });
  };

  // RFC 4954 4: the mechanisms offered, each with or without a response on its command line.
  const mechanisms = new Map<string, (initial: string | undefined) => Answer>([
    ["PLAIN", (initial) => (initial === undefined ? challenge("334 ", plain) : plain(initial))],
    [
      "LOGIN",
      (initial) =>
        initial === undefined ? challenge("334 VXNlcm5hbWU6", loginUser) : loginUser(initial),
    ],
  ]);

  /** RFC 4954 4: AUTH is for a session not yet logged in; an unknown mechanism is not a failure. */
  const auth = (argument: string): Answer => {
    if (phase.name !== "not-authenticated") return "503 Already authenticated";
    const m = /^([^ ]+)(?: ([^ ]+))?$/.exec(argument);
    if (m === null) return BAD_SYNTAX;
    const mechanism = mechanisms.get(String(m[1]).toUpperCase());
    return mechanism === undefined ? "504 Unknown mechanism" : mechanism(m[2]);
  };

  /** Form 01a19de8, idea 4: null when this login may use the address, else the refusal. */
  const refusal = async (mailbox: string, address: string): Promise<string | null> => {
    try {
      return (await ports.mayUse(mailbox, address)) ? null : NOT_YOURS;
    } catch {
      return TRY_AGAIN;
    }
  };

  /** RFC 5321 4.1.1.2, RFC 4954 5 and RFC 6409 3.2: a null path "MUST NOT, in itself, be cause for rejecting a message". */
  const mail = async (argument: string): Promise<string> => {
    if (phase.name === "not-authenticated") return "530 Authentication required";
    if (phase.name !== "ready") return BAD_SEQUENCE;
    const { mailbox } = phase;
    const m = MAIL_PATH.exec(argument);
    if (m === null) return BAD_SYNTAX;
    const address = String(m[1]);
    if (address !== "" && addressDomain(address) === null) return BAD_ADDRESS;
    const parameters = m[2]?.split(" ") ?? [];
    if (parameters.some((p) => /^SIZE=\d+$/i.test(p) && Number(p.slice(5)) > maxSize))
      return TOO_LARGE;
    if (parameters.some((p) => !/^(SIZE=\d+|AUTH=.*|BODY=7BIT)$/i.test(p)))
      return "555 Unknown parameter";
    const refused = address === "" ? null : await refusal(mailbox, address);
    if (refused !== null) return refused;
    phase = { name: "envelope", mailbox, from: address === "" ? null : address, to: [] };
    return OK;
  };

  /** RFC 5321 4.1.1.3 and RFC 6409 4.2: a recipient, named once however often it is given. */
  const rcpt = (argument: string): string => {
    if (phase.name !== "envelope") return BAD_SEQUENCE;
    const m = RCPT_PATH.exec(argument);
    if (m === null) return BAD_SYNTAX;
    const address = String(m[1]);
    if (addressDomain(address) === null) return BAD_ADDRESS;
    const repeated = phase.to.includes(address);
    if (!repeated && phase.to.length >= maxRecipients) return "452 Too many recipients";
    if (m[2] !== undefined) return "555 Unknown parameter";
    if (!repeated) phase = { ...phase, to: [...phase.to, address] };
    return OK;
  };

  /** RFC 5321 4.1.1.4: the message follows, and from here until its end no line is a command. */
  const data = (): string => {
    if (phase.name !== "envelope" || phase.to.length === 0) return BAD_SEQUENCE;
    const { mailbox, to } = phase;
    reading = { reader: messageReader(maxSize), mailbox, to };
    phase = { name: "data", mailbox };
    return "354 End data with <CR><LF>.<CR><LF>";
  };

  // RFC 5321 4.1.1: a Map, so a verb of `constructor` finds nothing.
  const commands = new Map<string, (argument: string) => Answer>([
    ["NOOP", () => OK],
    ["VRFY", () => "252 Cannot verify"],
    [
      "QUIT",
      () => {
        phase = { name: "closed" };
        return "221 Bye";
      },
    ],
    [
      "RSET",
      () => {
        reset();
        return OK;
      },
    ],
    [
      "HELO",
      () => {
        reset();
        return `250 ${hostname}`;
      },
    ],
    [
      "EHLO",
      (argument) => {
        if (argument === "") return BAD_SYNTAX;
        reset();
        return `250-${hostname}\r\n250-SIZE ${maxSize}\r\n250 AUTH PLAIN LOGIN`;
      },
    ],
    ["AUTH", auth],
    ["MAIL", mail],
    ["RCPT", rcpt],
    ["DATA", data],
  ]);

  /** RFC 5321 4.1.1: verbs are case-insensitive, and an unknown one is not a failure. */
  const command = (line: string): Answer => {
    const [verb = "", ...rest] = line.split(" ");
    const run = commands.get(verb.toUpperCase());
    return run === undefined ? "502 Not implemented" : run(rest.join(" "));
  };

  /** RFC 5321 6.1: the notice goes before the 250, and anything thrown here is logged and changes nothing. */
  const tell = async (input: SubmitInput, outcomes: Outcome[]): Promise<void> => {
    const told = outcomes.flatMap(failure);
    if (told.length === 0) return;
    const recipients = told.map((f) => f.recipient);
    try {
      const notice = await writeNotice({
        key: `${input.holdKey} ${[...recipients].sort().join(" ")}`,
        from: input.from,
        to: input.from,
        recipients,
        what: told.map((f) => `${f.recipient}: ${f.text}`).join("; "),
        subject: input.subject,
        random,
        now,
      });
      await ports.notify(input.mailbox, notice, input.from);
    } catch (error) {
      console.error(`submit: no notice for ${input.holdKey}: ${String(error)}`);
    }
  };

  /** RFC 5321 6.1: a 250 means mail has an answer of its own; a refusal tells the app to keep it. */
  const answer = async (input: SubmitInput, outcomes: Outcome[]): Promise<string> => {
    const accepted = outcomes.some((o) => o.kind === "accepted");
    const unknown = outcomes.some((o) => o.kind === "unknown");
    const refused = outcomes.flatMap((o) => (o.kind === "refused" ? [o] : []));
    const retriable = refused.some((o) => !o.final);
    if (accepted || (unknown && !retriable)) {
      await tell(input, outcomes);
      return OK;
    }
    const [first] = refused;
    return retriable || first === undefined ? TRY_AGAIN : `554 ${providerText(first.text)}`;
  };

  /** RFC 6409 8 and form 01a19de8, The message: the first rule to apply answers. */
  const finish = async ({ reader, mailbox, to }: Reading): Promise<string> => {
    if (reader.size() > maxSize) return TOO_LARGE;
    const bytes = reader.bytes();
    const received = binary(bytes);
    if (hasBadBytes(received)) return BAD_MESSAGE;
    const read = readMessage(bytes);
    const identities = originators(read);
    const domain = identities === null ? null : addressDomain(identities.from);
    if (identities === null || domain === null) return NOT_YOURS;
    for (const address of identities.all) {
      const refused = await refusal(mailbox, address);
      if (refused !== null) return refused;
    }
    const at = now();
    const day = hasDate(read) ? "" : at.toISOString().slice(0, 10);
    const hash = await digest(holdInput(mailbox, bytes, day));
    const sent = asSent(received, read, { hash, domain, at });
    if (sent.bytes.length > maxSize) return TOO_LARGE;
    const input: SubmitInput = {
      mailbox,
      from: identities.from,
      to,
      bytes: sent.bytes,
      holdKey: `${hash}@hold.invalid`,
      blobKey: `sha256/${await digest(sent.bytes)}`,
      messageId: sent.messageId,
      subject: noticeSubject(read.subject ?? ""),
    };
    try {
      return await answer(input, await ports.submit(input));
    } catch (error) {
      return error instanceof TypeError || error instanceof ZodError ? BAD_MESSAGE : TRY_AGAIN;
    }
  };

  /** The next reply the buffer completes, or null when it needs more bytes. */
  const step = async (): Promise<string | null> => {
    if (reading !== null) {
      const end = reading.reader.read(buffer);
      if (end === null) {
        buffer = "";
        return null;
      }
      buffer = buffer.slice(end);
      const finished = reading;
      reading = null;
      const reply = await finish(finished);
      phase = { name: "ready", mailbox: finished.mailbox };
      return reply;
    }
    const line = readLine(buffer, waiting !== null);
    if (line.kind === "more") return null;
    if (line.kind === "bad") {
      phase = { name: "closed" };
      return line.reply;
    }
    buffer = buffer.slice(line.end);
    const run = waiting ?? command;
    waiting = null;
    return run(line.text);
  };

  return {
    receive: async (input) => {
      if (closed()) return "";
      // A message's lines are never saved, so a session resumed inside one has lost it: reading them
      // as commands could make a line of body text into an envelope (form 01a19de8).
      if (phase.name === "data" && reading === null) {
        phase = { name: "closed" };
        return "421 Connection lost\r\n";
      }
      buffer += input;
      let out = "";
      while (!closed()) {
        const reply = await step();
        if (reply === null) break;
        out += `${reply}\r\n`;
      }
      return out;
    },
    closed,
    snapshot: () => ({ v: 1, failures: failed, phase }),
  };
}
