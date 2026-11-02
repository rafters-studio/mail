// Sending a message, per recipient (RFC 1047): "If the communications link fails during this
// synchronization gap, then the message has been duplicated." So each recipient is recorded as
// unknown before anything leaves, a Worker that dies mid-send leaves the truth behind, and a
// saved message is never sent twice on a guess. Mail itself never retries.
import { z } from "zod";
import type { Written } from "../message/index.ts";
import type { Connection } from "./connection.ts";
import { submit, type Login } from "./smtp.ts";

export { streamConnection, type Connection, type Streams } from "./connection.ts";
export { sendEventSchema, type Events, type SendEvent } from "./events.ts";
export { stuff, submit, type Login } from "./smtp.ts";

export const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    recipient: z.string().min(1),
    kind: z.literal("accepted"),
    providerId: z.string().min(1).nullable(),
    text: z.string().nullable(),
  }),
  z.strictObject({
    recipient: z.string().min(1),
    kind: z.literal("refused"),
    final: z.boolean(), // true: this recipient is held, and will not be tried again
    stage: z.enum(["connect", "greeting", "ehlo", "auth", "mail", "rcpt", "data", "provider"]),
    code: z.number().int().nullable(), // an SMTP reply code; null when there was none
    text: z.string(),
  }),
  z.strictObject({
    recipient: z.string().min(1),
    kind: z.literal("unknown"),
    detail: z.string(),
  }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

export type Outgoing = { bytes: Uint8Array; envelope: Written["envelope"] };
// One Outcome per envelope recipient, in envelope order. A transport does not throw
// for anything a server or provider answered.
export type Transport = { name: string; send: (message: Outgoing) => Promise<Outcome[]> };

export type Claim = {
  messageId: string;
  mailFrom: string;
  provider: string;
  recipient: string;
  at: Date;
};
export type Sends = {
  // Atomically records the recipient as unknown, and returns true, unless its row
  // is accepted, unknown or finally refused.
  claim: (claim: Claim) => Promise<boolean>;
  settle: (messageId: string, outcome: Outcome, at: Date) => Promise<void>;
};
export type Sent = {
  messageId: string;
  provider: string;
  outcomes: Outcome[]; // this attempt's, one per recipient claimed, in envelope order
  held: string[]; // recipients an earlier attempt answers for, in envelope order
};
export type Sender = (written: Written) => Promise<Sent>;

const CR = 0x0d;
const LF = 0x0a;
/** Form 01a19d25: what an address copied into a command line may not hold. */
const UNSAFE_ADDRESS = /[\p{Cc} <>]/u;

/** Form 01a19d25: a bare LF before a period is how SMTP smuggling works, so only 7-bit CRLF passes. */
function checkBytes(bytes: Uint8Array): void {
  for (const [i, byte] of bytes.entries()) {
    if (byte >= 0x80) throw new TypeError(`send: byte ${i} is 0x80 or above`);
    if (byte === CR && bytes[i + 1] !== LF) throw new TypeError(`send: bare CR at byte ${i}`);
    if (byte === LF && bytes[i - 1] !== CR) throw new TypeError(`send: bare LF at byte ${i}`);
  }
  if (bytes.at(-1) !== LF) throw new TypeError("send: the bytes do not end in CRLF");
}

/** Form 01a19d25: an address is copied into a command line, so it cannot hold one of its own. */
function checkAddress(address: string): void {
  if (UNSAFE_ADDRESS.test(address)) throw new TypeError(`send: unsafe address ${address}`);
}

/**
 * RFC 1047 and form 01a19d25: checks the input, claims each recipient as unknown, sends only to
 * those claimed, then settles what the transport answered. There is no `catch`: a transport or
 * port that throws makes `send` throw, and every row not yet settled stays unknown, which is true.
 */
export function createSender(ports: {
  transport: Transport;
  sends: Sends;
  now?: () => Date; // defaults to () => new Date()
}): Sender {
  const { transport, sends } = ports;
  const now = ports.now ?? (() => new Date());
  return async ({ bytes, messageId, envelope }) => {
    checkBytes(bytes);
    checkAddress(envelope.from);
    envelope.to.forEach(checkAddress);

    const at = now();
    const claimed: string[] = [];
    const held: string[] = [];
    for (const recipient of envelope.to) {
      const claim = { messageId, mailFrom: envelope.from, provider: transport.name, recipient, at };
      ((await sends.claim(claim)) ? claimed : held).push(recipient);
    }
    const provider = transport.name;
    if (claimed.length === 0) return { messageId, provider, outcomes: [], held };

    const outcomes = await transport.send({ bytes, envelope: { ...envelope, to: claimed } });
    const settled = now();
    for (const outcome of outcomes) await sends.settle(messageId, outcome, settled);
    return { messageId, provider, outcomes, held };
  };
}

/**
 * RFC 6409 and form 01a19d25: a Transport over one submission session per send. A failure to open
 * handed nothing over, so it is a refusal and not final.
 */
export function smtpTransport(settings: {
  name: string; // the provider, as recorded
  open: () => Promise<Connection>;
  ehlo: string;
  login: Login;
}): Transport {
  const { name, open, ehlo, login } = settings;
  return {
    name,
    send: async (message) => {
      let conn: Connection;
      try {
        conn = await open();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return message.envelope.to.map((recipient) => ({
          recipient,
          kind: "refused",
          final: false,
          stage: "connect",
          code: null,
          text,
        }));
      }
      return submit(conn, { ehlo, login }, message);
    },
  };
}
