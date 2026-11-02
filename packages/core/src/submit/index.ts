// The session a host runs (RFC 6409): "This memo splits message submission from message relay,
// allowing each service to operate according to its own rules". A session owns no socket and knows
// no provider: a host gives it octets and ports, and sends the octets it answers with.
import { z } from "zod";
import type { Outcome } from "../send/index.ts";
import { binary } from "../read/index.ts";
import { startSession } from "./session.ts";

export { writeNotice } from "./notice.ts";

export const submitSnapshotSchema = z.strictObject({
  v: z.literal(1),
  failures: z.number().int().min(0),
  phase: z.discriminatedUnion("name", [
    z.strictObject({ name: z.literal("not-authenticated") }),
    z.strictObject({ name: z.literal("ready"), mailbox: z.string().min(1) }),
    z.strictObject({
      name: z.literal("envelope"),
      mailbox: z.string().min(1),
      from: z.string().nullable(),
      to: z.array(z.string()),
    }),
    z.strictObject({ name: z.literal("data"), mailbox: z.string().min(1) }),
    z.strictObject({ name: z.literal("closed") }),
  ]),
});
export type SubmitSnapshot = z.infer<typeof submitSnapshotSchema>;

export type SubmitInput = {
  mailbox: string;
  from: string; // the one From: address as written, whatever MAIL FROM said (see The envelope)
  to: string[];
  bytes: Uint8Array; // as sent: Bcc gone, any missing field written
  holdKey: string; // a MessageId, see The hold
  blobKey: string; // "sha256/" and the hex digest of bytes
  messageId: string; // the visible Message-ID, for the submissions row
  subject: string; // decoded and normalised, as Notices says
};
export type SubmitPorts = {
  // Binary text, as IMAP's login has it. Returns the mailbox, or null. A throw answers 454.
  login(user: string, password: string): Promise<string | null>;
  // Is this the row findMailbox would use, tagged then untagged, enabled, on this mailbox?
  // A postmaster or catch-all fallback grants nothing. A throw answers 451.
  mayUse(mailbox: string, address: string): Promise<boolean>;
  // Sends and keeps. One Outcome per recipient, in envelope order, a held one from its recorded row.
  // Never throws for a provider's answer. May throw TypeError for input the sender refuses.
  submit(input: SubmitInput): Promise<Outcome[]>;
  // Delivers a notice to the mailbox's INBOX. A throw is logged by the session and never changes a reply.
  notify(mailbox: string, bytes: Uint8Array, to: string): Promise<void>;
};
export type SubmitSession = {
  greeting(): Uint8Array;
  receive(bytes: Uint8Array): Promise<Uint8Array>;
  closed(): boolean;
  snapshot(): SubmitSnapshot;
};

/** A session that has told its client nothing. */
const FRESH: SubmitSnapshot = { v: 1, failures: 0, phase: { name: "not-authenticated" } };

/**
 * RFC 6409 and RFC 5321 4.3.1: one connection's session. Calls run one at a time in the order made,
 * so a host may feed octets as they come. With `env.resume`, a snapshot, it continues that session
 * and sends the client nothing; a resume that is not a snapshot throws its ZodError.
 */
export function createSubmission(env: {
  ports: SubmitPorts;
  hostname: string;
  resume?: unknown;
  random?: (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
  now?: () => Date;
  limits?: { maxSize?: number; maxRecipients?: number }; // 26_214_000 and 50
}): SubmitSession {
  const { ports, hostname } = env;
  const session = startSession({
    ports,
    hostname,
    from: env.resume === undefined ? FRESH : submitSnapshotSchema.parse(env.resume),
    random: env.random ?? ((into) => crypto.getRandomValues(into)),
    now: env.now ?? (() => new Date()),
    maxSize: env.limits?.maxSize ?? 26_214_000,
    maxRecipients: env.limits?.maxRecipients ?? 50,
  });
  const encoder = new TextEncoder();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    greeting: () => encoder.encode(`220 ${hostname} ESMTP\r\n`),
    receive: (input) => {
      const next = queue.then(() => session.receive(binary(input))).then((s) => encoder.encode(s));
      queue = next;
      return next;
    },
    closed: session.closed,
    snapshot: session.snapshot,
  };
}
