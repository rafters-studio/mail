// IMAP for mail (RFC 3501 2.1): "The IMAP4rev1 protocol assumes a reliable data stream such as
// that provided by TCP." A session is octets in and octets out over a store; the host owns the
// stream, the socket and the store, and says when the selected mailbox changed.
import { binary } from "../read/index.ts";
import { bytes, type Piece } from "./format.ts";
import { startSession } from "./session.ts";
import { snapshotSchema, type Snapshot } from "./snapshot.ts";

export { CAPABILITIES } from "./session.ts";
export { snapshotSchema, type Snapshot } from "./snapshot.ts";

/** One message as the store holds it: its UID, flags, INTERNALDATE and RFC822.SIZE. */
export type Held = { uid: number; flags: string[]; internalDate: Date; size: number };

/** A mailbox when opened; `messages` are in UID order. */
export type Opened = { uidValidity: number; uidNext: number; messages: Held[] };

/** Where the mail is: every call names the account the login returned. */
export type ImapStore = {
  login(user: string, password: string): Promise<string | null>;
  mailboxes(account: string): Promise<string[]>;
  open(account: string, mailbox: string): Promise<Opened | null>;
  /** The named messages, in the order named, including any since expunged. */
  held(account: string, mailbox: string, uids: number[]): Promise<Held[]>;
  bytes(account: string, mailbox: string, uid: number): Promise<Uint8Array | null>;
  setFlags(account: string, mailbox: string, uid: number, flags: string[]): Promise<void>;
  expunge(account: string, mailbox: string, uids: number[]): Promise<void>;
};

/** One connection's IMAP session. */
export type ImapSession = {
  greeting(): Uint8Array;
  receive(bytes: Uint8Array): Promise<Uint8Array>;
  changed(): Promise<Uint8Array>;
  closed(): boolean;
  snapshot(): Snapshot;
};

/** A session that has told its client nothing. */
const FRESH: Snapshot = {
  v: 1,
  buffer: "",
  granted: 0,
  failures: 0,
  dirty: false,
  phase: { name: "not-authenticated" },
};

/**
 * RFC 3501 2.2: a session over `env.store`. Calls run one at a time in the order made, so a host
 * may feed octets and changes as they come; a store failure rejects that call and every later one.
 * With `env.resume`, a snapshot, it continues that session and sends the client nothing; a resume
 * that is not a snapshot throws its ZodError.
 */
export function createImapSession(env: { store: ImapStore; resume?: unknown }): ImapSession {
  const from = env.resume === undefined ? FRESH : snapshotSchema.parse(env.resume);
  const session = startSession(env.store, from);
  let queue: Promise<unknown> = session.restore();
  // A failed restore is the next call's to report; nobody may be waiting on it yet.
  queue.catch(() => {});
  /** One call at a time: each waits for the one before it, and its output is octets. */
  const serial = (work: () => Promise<Piece[]>): Promise<Uint8Array> => {
    const next = queue.then(work).then(bytes);
    queue = next;
    return next;
  };
  return {
    greeting: () => bytes(session.greeting()),
    receive: (input) => serial(() => session.receive(binary(input))),
    changed: () => serial(session.changed),
    closed: session.closed,
    snapshot: session.snapshot,
  };
}
