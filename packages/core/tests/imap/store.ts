// An in-memory ImapStore: INBOX holds the six writer goldens (UIDs 1..6); "Fixtures" holds the
// header cases the goldens lack (UIDs 1..2). It also makes the changes "another client" makes
// during a session, for the transcript driver.
import { readFileSync } from "node:fs";
import type { Held, ImapStore } from "../../src/imap/index.ts";

export const USER = "sean@rafters.studio";
export const PASSWORD = 'pa ss"word';
export const UIDVALIDITY = 1772470800;
export const GOLDENS = ["plain", "attachment", "forward", "rich", "intl", "reply"];
export const FIXTURES = ["headers", "empty-reply"];
const ACCOUNT = "acct-sean";
const INTERNALDATE = new Date("2026-03-02T17:00:00Z");
const WRITE_FIXTURES = new URL("../fixtures/write/", import.meta.url);
const OWN_FIXTURES = new URL("../fixtures/imap/", import.meta.url);

type Stored = { held: Held; bytes: Uint8Array };
type Box = { messages: Stored[]; uidNext: number };

/** The store, and `other(name)`: a named change another client makes. */
export type MemoryStore = ImapStore & { other: (change: string) => void };

/** The bytes of a fixture: a writer golden, or one of the IMAP goldens' own. */
export function fixture(name: string): Uint8Array {
  const file = FIXTURES.includes(name)
    ? new URL(`${name}.eml`, OWN_FIXTURES)
    : new URL(`${name}.expected.eml`, WRITE_FIXTURES);
  return new Uint8Array(readFileSync(file));
}

/** A fresh store, every message unflagged. */
export function memoryStore(): MemoryStore {
  const stored = (uid: number, name: string): Stored => {
    const bytes = fixture(name);
    return { held: { uid, flags: [], internalDate: INTERNALDATE, size: bytes.length }, bytes };
  };
  const box = (names: string[]): Box => ({
    messages: names.map((n, i) => stored(i + 1, n)),
    uidNext: names.length + 1,
  });
  const boxes = new Map<string, Box>([
    ["INBOX", box(GOLDENS)],
    ["Fixtures", box(FIXTURES)],
  ]);
  // Every message the store ever held, by mailbox, so an expunged or vanished one can be named.
  const ever = new Map([...boxes].map(([name, b]) => [name, b.messages.map((s) => s.held)]));
  const get = (account: string, mailbox: string): Box | undefined =>
    account === ACCOUNT ? boxes.get(mailbox) : undefined;
  const inbox = (): Box => {
    const b = boxes.get("INBOX");
    if (b === undefined) throw new Error("no INBOX");
    return b;
  };
  const flag = (uid: number, f: string): void => {
    const s = inbox().messages.find((m) => m.held.uid === uid);
    if (s !== undefined) s.held.flags = [...s.held.flags, f];
  };
  const remove = (b: Box, uids: number[]): void => {
    b.messages = b.messages.filter((s) => !uids.includes(s.held.uid));
  };
  const changes = new Map<string, () => void>([
    ["flag-2", () => flag(2, "$Other")],
    ["expunge-6", () => remove(inbox(), [6])],
    [
      "idle",
      () => {
        const b = inbox();
        remove(b, [3]);
        flag(1, "\\Flagged");
        const arrived = stored(b.uidNext++, "plain");
        b.messages.push(arrived);
        ever.get("INBOX")?.push(arrived.held);
      },
    ],
    ["vanish", () => boxes.delete("Fixtures")],
    ["nothing", () => {}],
  ]);
  return {
    login: async (user, password) => (user === USER && password === PASSWORD ? ACCOUNT : null),
    mailboxes: async () => [...boxes.keys()],
    open: async (account, mailbox) => {
      const b = get(account, mailbox);
      return b === undefined
        ? null
        : {
            uidValidity: UIDVALIDITY,
            uidNext: b.uidNext,
            messages: b.messages.map((s) => ({ ...s.held, flags: [...s.held.flags] })),
          };
    },
    held: async (account, mailbox, uids) => {
      const all = account === ACCOUNT ? (ever.get(mailbox) ?? []) : [];
      return uids.flatMap((uid) => all.filter((h) => h.uid === uid));
    },
    bytes: async (account, mailbox, uid) =>
      get(account, mailbox)?.messages.find((s) => s.held.uid === uid)?.bytes ?? null,
    setFlags: async (account, mailbox, uid, flags) => {
      const s = get(account, mailbox)?.messages.find((m) => m.held.uid === uid);
      if (s !== undefined) s.held.flags = [...flags];
    },
    expunge: async (account, mailbox, uids) => {
      const b = get(account, mailbox);
      if (b !== undefined) remove(b, uids);
    },
    other: (change) => {
      const run = changes.get(change);
      if (run === undefined) throw new Error(`no change ${change}`);
      run();
    },
  };
}
