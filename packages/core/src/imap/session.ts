// The session (RFC 3501 3): "Once the connection between client and server is established, an
// IMAP4rev1 connection is in one of four states." Each state is the set of commands it accepts
// (RFC 3501 6), so a command outside the current state's set is BAD; IDLE is a fifth reading
// mode inside the selected state (RFC 2177), and the logout state reads nothing.
import { fetchItems, load, UID_ITEM } from "./fetch.ts";
import { string } from "./format.ts";
import type { Held, ImapStore, Opened } from "./index.ts";
import { readCommand, sequenceSet, text, type Command, type Value } from "./reader.ts";
import { hasFlag, searchTest } from "./search.ts";
import { chosen, contains, expunged, largestUid } from "./sequence.ts";

/** RFC 3501 7.2.1: what this server advertises. */
export const CAPABILITIES = "IMAP4rev1 LITERAL+ IDLE UIDPLUS UNSELECT";

/** RFC 3501 2.3.2: the system flags a client may store (\Recent is the server's). */
const SYSTEM = ["\\Seen", "\\Answered", "\\Flagged", "\\Deleted", "\\Draft"];

/** Every command name this server knows, in any state. */
const KNOWN = new Set([
  "CAPABILITY",
  "NOOP",
  "LOGOUT",
  "LOGIN",
  "LIST",
  "LSUB",
  "STATUS",
  "SELECT",
  "EXAMINE",
  "CHECK",
  "CLOSE",
  "UNSELECT",
  "EXPUNGE",
  "SEARCH",
  "FETCH",
  "STORE",
  "UID",
  "IDLE",
]);

type Run = (cmd: Command) => Promise<void>;
type Sub = (tag: string, args: Value[], byUid: boolean) => Promise<void>;
/** A state: how it reads the buffer (true when it consumed something), and what a host change does. */
type State = { consume: () => Promise<boolean>; changed: () => Promise<void> };
/** The selected mailbox as this session sees it: messages in UID order, sequence number = place + 1. */
type Box = {
  name: string;
  uidValidity: number;
  uidNext: number;
  readOnly: boolean;
  messages: Held[];
};

/** RFC 3501 2.3.2: a flag as stored, a system flag in its canonical case or a keyword atom; null when neither. */
function flagName(f: string): string | null {
  if (f.startsWith("\\")) return SYSTEM.find((s) => s.toLowerCase() === f.toLowerCase()) ?? null;
  // oxlint-disable-next-line no-control-regex -- an atom excludes the controls RFC 3501 9 names
  return /^[^\x00-\x20\x7f-\xff(){%*"\\\]]+$/.test(f) ? f : null;
}

/** RFC 3501 6.4.6: flags as one list or as flags separated by SP, each once; null when one is not storable. */
function storeFlags(args: Value[]): string[] | null {
  const [first, ...more] = args;
  const given = first?.kind === "list" && more.length === 0 ? first.items : args;
  const names = given.map((v) => flagName(text(v) ?? ""));
  return names.every((n) => n !== null)
    ? names.filter((f, i) => names.findIndex((g) => hasFlag([g], f)) === i)
    : null;
}

/** RFC 3501 6.3.8: "*" matches anything, "%" anything but the hierarchy delimiter "/"; INBOX ignores case. */
function matches(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/%/g, "[^/]*");
  return new RegExp(`^${re}$`, /^inbox/i.test(pattern) ? "i" : "").test(name);
}

/** RFC 3501 5.1: INBOX in any case is INBOX; every other name is the store's as given. */
const mailboxName = (name: string): string => (name.toUpperCase() === "INBOX" ? "INBOX" : name);
/** The session's own copy of a held message, so the store's state is only read when asked. */
const copy = (h: Held): Held => ({ ...h, flags: [...h.flags] });
/** RFC 3501 7.4.2 FLAGS: a message's flags as a parenthesised list. */
const flagList = (h: Held): string => `FLAGS (${h.flags.join(" ")})`;
const EMPTY = new Uint8Array(0);

// RFC 3501 6.3.10: the STATUS items.
const STATUS_ITEMS = new Map<string, (o: Opened) => number>([
  ["MESSAGES", (o) => o.messages.length],
  ["UIDNEXT", (o) => o.uidNext],
  ["UIDVALIDITY", (o) => o.uidValidity],
  ["UNSEEN", (o) => o.messages.filter((h) => !hasFlag(h.flags, "\\Seen")).length],
]);

/** RFC 3501 3, 6: one connection's session over a store; strings in and out are binary strings. */
export function startSession(store: ImapStore): {
  greeting: () => string;
  receive: (input: string) => Promise<string>;
  changed: () => Promise<string>;
  closed: () => boolean;
} {
  let out = "";
  let buffer = "";
  let granted = 0;
  let failures = 0;
  let dirty = false;
  /** RFC 3501 2.2.2: an untagged response or continuation, queued for the host. */
  const send = (s: string): void => {
    out += s;
  };
  /** RFC 3501 2.2.2: a command's tagged completion. */
  const reply = (tag: string, s: string): void => send(`${tag} ${s}\r\n`);
  /** Everything queued since the last call, handed to the host. */
  const take = (): string => {
    const s = out;
    out = "";
    return s;
  };
  /** RFC 3501 5.2: outside the selected state a mailbox change has nothing to report. */
  const nothing = async (): Promise<void> => {};

  /** RFC 3501 3.4: the logout state reads nothing more. */
  const loggedOut: State = { consume: async () => ((buffer = ""), false), changed: nothing };
  let state: State = loggedOut;

  /** RFC 3501 2.2, 7.5: read the next command and run it if this state accepts it. */
  const commandState = (commands: Map<string, Run>, changed: () => Promise<void>): State => ({
    changed,
    consume: async () => {
      const r = readCommand(buffer);
      if (r.kind === "more") {
        // RFC 3501 7.5: "+" asks for a synchronising literal's octets, once per literal.
        if (r.literal > granted) {
          granted = r.literal;
          send("+ Ready\r\n");
        }
        return false;
      }
      if (r.kind === "fatal") {
        send(`* BYE ${r.why}\r\n`);
        state = loggedOut;
        return false;
      }
      buffer = buffer.slice(r.end);
      granted = 0;
      if (r.kind === "bad") {
        reply(r.tag, `BAD ${r.why}`);
        return true;
      }
      // Narrowed to "command", the last kind of Reading: a new kind fails to type-check here.
      const { tag, name } = r.command;
      const run = commands.get(name);
      if (run === undefined)
        reply(tag, KNOWN.has(name) ? `BAD ${name} not allowed now` : "BAD unknown command");
      else await run(r.command);
      return true;
    },
  });

  /** RFC 3501 6.1: the commands valid in any state. */
  const always = (): [string, Run][] => [
    [
      "CAPABILITY",
      async ({ tag }) => {
        send(`* CAPABILITY ${CAPABILITIES}\r\n`);
        reply(tag, "OK CAPABILITY completed");
      },
    ],
    ["NOOP", async ({ tag }) => reply(tag, "OK NOOP completed")],
    [
      "LOGOUT",
      async ({ tag }) => {
        send("* BYE logging out\r\n");
        state = loggedOut;
        reply(tag, "OK LOGOUT completed");
      },
    ],
  ];

  /** RFC 3501 6.2.3: LOGIN; the account the store returns is the only mailbox owner from here on. */
  const login: Run = async ({ tag, args }) => {
    const [user, password, ...extra] = args.map(text);
    if (typeof user !== "string" || typeof password !== "string" || extra.length > 0)
      return reply(tag, "BAD LOGIN needs a user and a password");
    const account = await store.login(user, password);
    if (account !== null) {
      state = authenticated(account);
      return reply(tag, `OK [CAPABILITY ${CAPABILITIES}] LOGIN completed`);
    }
    failures++;
    reply(tag, "NO [AUTHENTICATIONFAILED] Authentication failed");
    if (failures >= 3) {
      send("* BYE too many failed logins\r\n");
      state = loggedOut;
    }
  };

  /** RFC 3501 6.2: the not authenticated state. */
  const notAuthenticated = (): State =>
    commandState(new Map([...always(), ["LOGIN", login]]), nothing);

  /** RFC 3501 6.3: the commands of the authenticated state, which the selected state keeps. */
  const authCommands = (account: string): [string, Run][] => {
    /** RFC 3501 6.3.8, 6.3.9: LIST, and LSUB as LIST (every mailbox counts as subscribed). */
    const listing =
      (kind: string): Run =>
      async ({ tag, args }) => {
        const [ref, pattern, ...extra] = args.map(text);
        if (typeof ref !== "string" || typeof pattern !== "string" || extra.length > 0)
          return reply(tag, `BAD ${kind} needs a reference and a pattern`);
        // RFC 3501 6.3.8: an empty pattern asks for the hierarchy delimiter and the root.
        if (pattern === "") send(`* ${kind} (\\Noselect) "/" ""\r\n`);
        else
          for (const name of await store.mailboxes(account))
            if (matches(name, ref + pattern)) send(`* ${kind} () "/" ${string(name)}\r\n`);
        reply(tag, `OK ${kind} completed`);
      };
    /** RFC 3501 6.3.10: STATUS of the items asked, in the order asked, read fresh from the store. */
    const status: Run = async ({ tag, args }) => {
      const [nameArg, itemsArg, ...extra] = args;
      const name = text(nameArg);
      const wanted =
        itemsArg?.kind === "list" ? itemsArg.items.map((v) => text(v)?.toUpperCase() ?? "") : [];
      const counts = wanted.map((w) => STATUS_ITEMS.get(w));
      if (
        name === null ||
        wanted.length === 0 ||
        extra.length > 0 ||
        !counts.every((c) => c !== undefined)
      )
        return reply(tag, "BAD STATUS needs a mailbox and items");
      const mailbox = mailboxName(name);
      const opened = await store.open(account, mailbox);
      if (opened === null) return reply(tag, "NO [NONEXISTENT] no such mailbox");
      send(
        `* STATUS ${string(mailbox)} (${counts.map((c, i) => `${wanted[i]} ${c(opened)}`).join(" ")})\r\n`,
      );
      reply(tag, "OK STATUS completed");
    };
    /** RFC 3501 6.3.1, 6.3.2: SELECT and EXAMINE; a failed one leaves no mailbox selected. */
    const open =
      (verb: string, readOnly: boolean): Run =>
      async ({ tag, args }) => {
        const [arg, ...extra] = args;
        const name = text(arg);
        if (name === null || extra.length > 0)
          return reply(tag, `BAD ${verb} needs a mailbox name`);
        state = authenticated(account);
        const mailbox = mailboxName(name);
        const opened = await store.open(account, mailbox);
        if (opened === null) return reply(tag, "NO [NONEXISTENT] no such mailbox");
        const box: Box = {
          name: mailbox,
          uidValidity: opened.uidValidity,
          uidNext: opened.uidNext,
          readOnly,
          messages: opened.messages.map(copy),
        };
        send(`* ${box.messages.length} EXISTS\r\n* 0 RECENT\r\n* FLAGS (${SYSTEM.join(" ")})\r\n`);
        send(`* OK [PERMANENTFLAGS (${readOnly ? "" : `${SYSTEM.join(" ")} \\*`})] flags\r\n`);
        const unseen = box.messages.findIndex((h) => !hasFlag(h.flags, "\\Seen"));
        if (unseen !== -1) send(`* OK [UNSEEN ${unseen + 1}] first unseen\r\n`);
        send(
          `* OK [UIDVALIDITY ${box.uidValidity}] UIDs valid\r\n* OK [UIDNEXT ${box.uidNext}] next UID\r\n`,
        );
        dirty = false;
        state = selected(account, box);
        reply(tag, `OK [${readOnly ? "READ-ONLY" : "READ-WRITE"}] ${verb} completed`);
      };
    return [
      ["LIST", listing("LIST")],
      ["LSUB", listing("LSUB")],
      ["STATUS", status],
      ["SELECT", open("SELECT", false)],
      ["EXAMINE", open("EXAMINE", true)],
    ];
  };

  /** RFC 3501 6.3: the authenticated state. */
  const authenticated = (account: string): State =>
    commandState(new Map([...always(), ...authCommands(account)]), nothing);

  /** RFC 3501 6.4: the selected state; a host change is held for the next command that may report it. */
  const selected = (account: string, box: Box): State =>
    commandState(
      new Map([...always(), ...authCommands(account), ...selectedCommands(account, box)]),
      async () => {
        dirty = true;
      },
    );

  /** RFC 3501 6.4: the commands of the selected state, over its view of the mailbox. */
  const selectedCommands = (account: string, box: Box): [string, Run][] => {
    /** RFC 3501 7.4.1: one "* n EXPUNGE" per number, in order. */
    const expungeLines = (numbers: number[]): void => {
      for (const n of numbers) send(`* ${n} EXPUNGE\r\n`);
    };

    /**
     * RFC 3501 7.4.1, 7.3.1, 7.4.2: what changed in the store since the view was taken, as EXPUNGE,
     * then FETCH FLAGS, then EXISTS; a mailbox that is gone reads as empty.
     */
    const sync = async (): Promise<void> => {
      if (!dirty) return;
      dirty = false;
      const opened = (await store.open(account, box.name)) ?? {
        uidValidity: box.uidValidity,
        uidNext: box.uidNext,
        messages: [],
      };
      const before = new Map(box.messages.map((h) => [h.uid, h.flags.join(" ")]));
      const now = new Set(opened.messages.map((h) => h.uid));
      expungeLines(
        expunged(
          box.messages,
          new Set(box.messages.filter((h) => !now.has(h.uid)).map((h) => h.uid)),
        ),
      );
      const kept = opened.messages.filter((h) => before.has(h.uid)).map(copy);
      for (const [i, h] of kept.entries())
        if (before.get(h.uid) !== h.flags.join(" ")) send(`* ${i + 1} FETCH (${flagList(h)})\r\n`);
      const arrived = opened.messages.filter((h) => !before.has(h.uid)).map(copy);
      box.messages = [...kept, ...arrived];
      box.uidNext = opened.uidNext;
      if (arrived.length > 0) send(`* ${box.messages.length} EXISTS\r\n`);
    };

    /** RFC 3501 6.4.3: remove the \Deleted messages `pick` names from the store and the view; their EXPUNGE numbers. */
    const removeDeleted = async (pick: (h: Held) => boolean): Promise<number[]> => {
      const doomed = box.messages
        .filter((h) => hasFlag(h.flags, "\\Deleted") && pick(h))
        .map((h) => h.uid);
      await store.expunge(account, box.name, doomed);
      const gone = new Set(doomed);
      const numbers = expunged(box.messages, gone);
      box.messages = box.messages.filter((h) => !gone.has(h.uid));
      return numbers;
    };

    /** RFC 3501 6.4.5, 6.4.8: FETCH; a body item without PEEK sets \Seen and reports the new flags. */
    const fetch: Sub = async (tag, args, byUid) => {
      const [setArg, itemsArg, ...extra] = args;
      const set = sequenceSet(text(setArg) ?? "");
      const asked = fetchItems(itemsArg);
      if (set === null || asked === null || extra.length > 0)
        return reply(tag, "BAD FETCH needs a sequence set and items");
      const items = byUid && !asked.some((i) => i.name === "UID") ? [UID_ITEM, ...asked] : asked;
      const body = items.some((i) => i.body);
      const seen = items.some((i) => i.seen) && !box.readOnly;
      const flagsAsked = items.some((i) => i.name === "FLAGS");
      // The implicit FLAGS goes before the first body item, so before any literal (and after a
      // UID asked first); it is only added when a body item without PEEK was asked.
      const flagsAt = items.findIndex((i) => i.body);
      for (const { seq, message: held } of chosen(set, box.messages, byUid)) {
        const octets = body ? await store.bytes(account, box.name, held.uid) : EMPTY;
        // RFC 2180 4.1: a message another session expunged, not yet reported here, is left out.
        if (octets === null) continue;
        const marks = seen && !hasFlag(held.flags, "\\Seen");
        if (marks) {
          held.flags.push("\\Seen");
          await store.setFlags(account, box.name, held.uid, [...held.flags]);
        }
        const fetched = { held, message: load(octets) };
        const parts = items.map((i) => i.render(fetched));
        if (marks && !flagsAsked) parts.splice(flagsAt, 0, flagList(held));
        send(`* ${seq} FETCH (${parts.join(" ")})\r\n`);
      }
      reply(tag, `OK ${byUid ? "UID " : ""}FETCH completed`);
    };

    /** RFC 3501 6.4.6: STORE FLAGS, +FLAGS, -FLAGS, each optionally .SILENT. */
    const storeCommand: Sub = async (tag, args, byUid) => {
      const [setArg, itemArg, ...flagArgs] = args;
      const set = sequenceSet(text(setArg) ?? "");
      const mode = /^([+-]?)FLAGS(\.SILENT)?$/i.exec(text(itemArg) ?? "");
      const flags = storeFlags(flagArgs);
      if (set === null || mode === null || flags === null)
        return reply(tag, "BAD STORE needs a sequence set, an item and flags");
      if (box.readOnly) return reply(tag, "NO [READ-ONLY] mailbox is read-only");
      const sign = mode[1];
      const silent = mode[2] !== undefined;
      const next =
        sign === "+"
          ? (old: string[]): string[] => [...old, ...flags.filter((f) => !hasFlag(old, f))]
          : sign === "-"
            ? (old: string[]): string[] => old.filter((f) => !hasFlag(flags, f))
            : (): string[] => [...flags];
      for (const { seq, message: held } of chosen(set, box.messages, byUid)) {
        held.flags = next(held.flags);
        await store.setFlags(account, box.name, held.uid, [...held.flags]);
        if (!silent)
          send(`* ${seq} FETCH (${byUid ? `UID ${held.uid} ` : ""}${flagList(held)})\r\n`);
      }
      reply(tag, `OK ${byUid ? "UID " : ""}STORE completed`);
    };

    /** RFC 3501 6.4.4, 6.4.8: SEARCH, answered with sequence numbers or UIDs. */
    const search: Sub = async (tag, args, byUid) => {
      const test = searchTest(args, box.messages);
      if (test === null) return reply(tag, "BAD bad search key");
      const hits = box.messages.map((held, i) => ({ seq: i + 1, held })).filter(test);
      send(`* SEARCH${hits.map(({ seq, held }) => ` ${byUid ? held.uid : seq}`).join("")}\r\n`);
      reply(tag, `OK ${byUid ? "UID " : ""}SEARCH completed`);
    };

    /** RFC 4315 2.1: UID EXPUNGE removes only the \Deleted messages of the UID set. */
    const uidExpunge: Sub = async (tag, args) => {
      const [setArg, ...extra] = args;
      const set = sequenceSet(text(setArg) ?? "");
      if (set === null || extra.length > 0) return reply(tag, "BAD UID EXPUNGE needs a UID set");
      if (box.readOnly) return reply(tag, "NO [READ-ONLY] mailbox is read-only");
      const largest = largestUid(box.messages);
      expungeLines(await removeDeleted((h) => contains(set, h.uid, largest)));
      reply(tag, "OK UID EXPUNGE completed");
    };

    const UID_COMMANDS = new Map<string, Sub>([
      ["FETCH", fetch],
      ["STORE", storeCommand],
      ["SEARCH", search],
      ["EXPUNGE", uidExpunge],
    ]);

    /** RFC 2177 3: IDLE reads one line, which ends it; host changes are sent as they come. */
    const idling = (tag: string): State => ({
      changed: async () => {
        dirty = true;
        await sync();
      },
      consume: async () => {
        const lf = buffer.indexOf("\n");
        if (lf === -1) return false;
        const line = buffer.slice(0, lf).replace(/\r$/, "");
        buffer = buffer.slice(lf + 1);
        state = selected(account, box);
        reply(tag, line.toUpperCase() === "DONE" ? "OK IDLE terminated" : "BAD expected DONE");
        return true;
      },
    });

    // FETCH, STORE and SEARCH by sequence number report no held change: an EXPUNGE then would
    // renumber what the client just named (RFC 3501 7.4.1). Every other command here may.
    return [
      [
        "NOOP",
        async ({ tag }) => {
          await sync();
          reply(tag, "OK NOOP completed");
        },
      ],
      [
        "CHECK",
        async ({ tag }) => {
          await sync();
          reply(tag, "OK CHECK completed");
        },
      ],
      [
        "CLOSE",
        async ({ tag }) => {
          // RFC 3501 6.4.2: CLOSE expunges silently, and only a mailbox opened read-write.
          if (!box.readOnly) await removeDeleted(() => true);
          state = authenticated(account);
          reply(tag, "OK CLOSE completed");
        },
      ],
      [
        "UNSELECT",
        async ({ tag }) => {
          state = authenticated(account);
          reply(tag, "OK UNSELECT completed");
        },
      ],
      [
        "EXPUNGE",
        async ({ tag }) => {
          await sync();
          if (box.readOnly) return reply(tag, "NO [READ-ONLY] mailbox is read-only");
          expungeLines(await removeDeleted(() => true));
          reply(tag, "OK EXPUNGE completed");
        },
      ],
      ["SEARCH", ({ tag, args }) => search(tag, args, false)],
      ["FETCH", ({ tag, args }) => fetch(tag, args, false)],
      ["STORE", ({ tag, args }) => storeCommand(tag, args, false)],
      [
        "UID",
        async ({ tag, args }) => {
          const [sub, ...rest] = args;
          const run = UID_COMMANDS.get(text(sub)?.toUpperCase() ?? "");
          if (run === undefined) return reply(tag, "BAD UID needs FETCH, STORE, SEARCH or EXPUNGE");
          await sync();
          await run(tag, rest, true);
        },
      ],
      [
        "IDLE",
        async ({ tag }) => {
          send("+ idling\r\n");
          state = idling(tag);
          await sync();
        },
      ],
    ];
  };

  state = notAuthenticated();
  return {
    greeting: () => `* OK [CAPABILITY ${CAPABILITIES}] IMAP4rev1 ready\r\n`,
    receive: async (input) => {
      buffer += input;
      while (await state.consume());
      return take();
    },
    changed: async () => {
      await state.changed();
      return take();
    },
    closed: () => state === loggedOut,
  };
}
