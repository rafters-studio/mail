// The IMAP objects on node:sqlite behind their structural types: a SQLite wrapper that refuses what
// Durable Object SQLite refuses, fake state and sockets, and a world wiring real objects together.
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { vi } from "vitest";
import { binary } from "../../core/src/read/index.ts";
import {
  type D1Like,
  type DurableObjectStateLike,
  type ImapBindings,
  imapObjects,
  type MailboxStub,
  type NamespaceOf,
  type SessionStub,
  type SocketLike,
  type SqlLike,
} from "../src/index.ts";
import { clock } from "./clock.ts";
import { heldDeadline } from "./deadline.ts";

export const migration = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const MAX_PARAMETERS = 100;
const MAX_VALUE = 2 * 1024 * 1024;
const WRITES = /^\s*(INSERT|UPDATE|DELETE|CREATE)/i;

export const MAILBOX = "mbx-sean";
export const USER = "sean@rafters.studio";
export const PASSWORD = "correct horse";

/** A log shared by a state and its socket, so a test can read what came before what. */
export type Log = string[];

/** Durable Object SQLite on node:sqlite: 100 parameters, 2 MB values, BLOBs as ArrayBuffers. */
export function memory(log: Log = []) {
  let db = new DatabaseSync(":memory:");
  const hook = { refuse: (_sql: string, _values: unknown[]): boolean => false };
  const sql: SqlLike = {
    exec: (text, ...values) => {
      if (values.length > MAX_PARAMETERS) throw new Error("too many SQL variables");
      for (const value of values) {
        const size = value instanceof Uint8Array ? value.length : String(value).length;
        if (size > MAX_VALUE) throw new Error("string or blob too big");
      }
      if (hook.refuse(text, values)) throw new Error("refused");
      if (WRITES.test(text)) log.push("write");
      const given: SQLInputValue[] = values;
      return db
        .prepare(text)
        .all(...given)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              v instanceof Uint8Array ? Uint8Array.from(v).buffer : v,
            ]),
          ),
        );
    },
  };
  return {
    sql,
    hook,
    transactionSync: <T>(run: () => T): T => {
      db.exec("BEGIN");
      try {
        const result = run();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    clear: () => {
      db = new DatabaseSync(":memory:");
    },
  };
}

/** A hibernating WebSocket that keeps what it is sent. */
export function fakeSocket(log: Log = []) {
  const frames: Uint8Array[] = [];
  const closes: (number | undefined)[] = [];
  const socket: SocketLike = {
    send: (data) => {
      log.push("send");
      frames.push(Uint8Array.from(data));
    },
    close: (code) => void closes.push(code),
  };
  /** Everything sent so far, as binary text. */
  const text = () => frames.map(binary).join("");
  return { socket, frames, closes, text };
}

/** A fake DurableObjectState over `memory`, with its alarm, its sockets and its waitUntil work. */
export function fakeState(id: { name?: string; hex: string }, log: Log = []) {
  const mem = memory(log);
  const alarm: { at: number | null } = { at: null };
  const sockets: SocketLike[] = [];
  const waits: Promise<unknown>[] = [];
  const ctx: DurableObjectStateLike = {
    id: { ...(id.name === undefined ? {} : { name: id.name }), toString: () => id.hex },
    storage: {
      sql: mem.sql,
      transactionSync: mem.transactionSync,
      deleteAll: async () => {
        log.push("deleteAll");
        mem.clear();
        alarm.at = null;
      },
      getAlarm: async () => alarm.at,
      setAlarm: async (at) => {
        alarm.at = at;
      },
      deleteAlarm: async () => {
        alarm.at = null;
      },
    },
    acceptWebSocket: (socket) => void sockets.push(socket),
    getWebSockets: () => sockets,
    waitUntil: (work) => void waits.push(work),
  };
  /** Waits until every piece of waitUntil work, and what it started, has finished. */
  const settled = async () => {
    for (let i = 0; i < waits.length; i++) await waits[i];
  };
  return { ctx, mem, alarm, sockets, waits, settled };
}

/** The base class the Worker hands over, reduced to what the objects need of it. */
class Base {
  constructor(_ctx: DurableObjectStateLike, _env: ImapBindings) {}
}

/** Who may log in: anyone with the password, holding no hash and writing no row. */
export const login = vi.fn(async (_user: string, password: string, _address: string) =>
  password === PASSWORD ? MAILBOX : null,
);

export const { ImapSession, ImapMailbox } = imapObjects(Base, login, { now: () => clock.now() });
/** The objects again, with the tell bound held for the test to fire. */
export const held = imapObjects(Base, login, {
  deadline: heldDeadline("tell"),
  now: () => clock.now(),
});
export type Session = InstanceType<typeof ImapSession>;
export type Mailbox = InstanceType<typeof ImapMailbox>;

/** A UUIDv7-shaped delivery id for one millisecond. */
export function idAt(ms: number, n = 0): string {
  const h = ms.toString(16).padStart(12, "0");
  return `${h.slice(0, 8)}-${h.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** The receiving and sending tables on node:sqlite as a D1Like, with a count of its queries. */
export function d1World() {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_receiving.sql"));
  db.exec(migration("0002_sending.sql"));
  db.exec(migration("0004_sent.sql"));
  db.exec(`INSERT INTO mailboxes (id) VALUES ('${MAILBOX}'), ('mbx-other');`);
  const counts = { queries: 0 };
  const d1: D1Like = {
    prepare: (sql) => {
      counts.queries += 1;
      return {
        bind: (...values) => ({
          first: async () => {
            const row = db.prepare(sql).get(...values);
            return row === undefined ? null : { ...row };
          },
          run: async () => db.prepare(sql).run(...values),
          all: async () => ({
            results: db
              .prepare(sql)
              .all(...values)
              .map((row) => ({ ...row })),
          }),
        }),
      };
    },
  };
  return { db, d1, counts };
}

/** A mailbox object whose sessions answer as `answers` says, recording who was told. */
export function box(
  answers: (name: string) => Promise<unknown> = async () => true,
  Mailbox: typeof ImapMailbox = ImapMailbox,
) {
  const d = d1World();
  const blobs = new Map<string, Uint8Array>();
  const state = fakeState({ name: MAILBOX, hex: "mailbox" });
  const told: string[] = [];
  const hold = { blob: async (): Promise<void> => {} };
  const env: ImapBindings = {
    MAIL_DB: d.d1,
    MAIL_BLOBS: {
      get: async (key) => {
        await hold.blob();
        const bytes = blobs.get(key);
        return bytes === undefined
          ? null
          : { arrayBuffer: async () => Uint8Array.from(bytes).buffer };
      },
    },
    IMAP_SESSION: {
      idFromName: () => "by-name",
      idFromString: (hex) => hex,
      newUniqueId: () => "unique",
      get: (id) => ({
        fetch: async () => new Response(null),
        changed: async () => {
          told.push(String(id));
          return answers(String(id));
        },
      }),
    },
    IMAP_MAILBOX: {
      idFromName: () => {
        throw new Error("a mailbox does not call a mailbox");
      },
      idFromString: () => "",
      newUniqueId: () => "",
      get: () => {
        throw new Error("a mailbox does not call a mailbox");
      },
    },
    BRIDGE_SECRET: "secret",
  };
  const object: Mailbox = new Mailbox(state.ctx, env);
  const deliver = (id: string, bytes: Uint8Array | null) => {
    const blob = `blob/${id}`;
    if (bytes !== null) blobs.set(blob, bytes);
    d.db
      .prepare(
        "INSERT INTO deliveries (id, blob, mailbox, rcpt_to, received_at, via) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, blob, MAILBOX, "sean@rafters.studio", "2026-03-02T17:00:00.000Z", "cloudflare");
  };
  const rows = (sql: string) => [...state.mem.sql.exec(sql)];
  const uids = async () =>
    ((await object.open("INBOX", "reader")) ?? { messages: [] }).messages.map((m) => m.uid);
  return { ...d, object, state, env, blobs, told, hold, deliver, rows, uids };
}

/** A message of its own bytes; with an id it carries that Message-ID. */
export function mail(messageId: string | null = null, body = "hello"): Uint8Array {
  const id = messageId === null ? "" : `Message-ID: <${messageId}>\r\n`;
  return new TextEncoder().encode(
    `From: mary@example.net\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n${id}\r\n${body}\r\n`,
  );
}

/** A namespace whose stubs `reach` makes from the id; a name and a hex are never one id. */
export function namespace<S>(reach: (id: string) => S): NamespaceOf<S> {
  let unique = 0;
  return {
    idFromName: (name) => `name:${name}`,
    idFromString: (hex) => `hex:${hex}`,
    newUniqueId: () => `hex:unique-${++unique}`,
    get: (id) => reach(String(id)),
  };
}

/** Real objects wired together: deliveries in D1, blobs in a Map, one mailbox object. */
export function world() {
  const d = d1World();
  const blobs = new Map<string, Uint8Array>();
  const mailboxState = fakeState({ name: MAILBOX, hex: "mailbox" });
  const r2 = {
    put: async (key: string, value: Uint8Array) => {
      blobs.set(key, Uint8Array.from(value));
    },
    get: async (key: string) => {
      const bytes = blobs.get(key);
      return bytes === undefined
        ? null
        : { arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    },
  };
  // The mailbox stub the session reaches; a test may replace any of its calls.
  const stub = (): MailboxStub => {
    const box = mailboxObject;
    return {
      open: (name, session) => box.open(name, session),
      held: (uids) => box.held(uids),
      bytes: (uid) => box.bytes(uid),
      setFlags: (uid, flags) => box.setFlags(uid, flags),
      expunge: (uids) => box.expunge(uids),
      forget: (session) => box.forget(session),
      ping: () => box.ping(),
    };
  };
  // `reach` is given the id, `name:<the name passed to idFromName>`, so a test can see which mailbox.
  const swap: { mailbox: Partial<MailboxStub>; reach: (id: string) => Partial<MailboxStub> } = {
    mailbox: {},
    reach: () => ({}),
  };
  const mailboxes = namespace<MailboxStub>((id) => ({
    ...stub(),
    ...swap.mailbox,
    ...swap.reach(id),
  }));
  const live = new Map<string, Session>();
  const sessions = namespace<SessionStub>((key) => {
    // A dead or wrong name reaches an object with nothing stored, as idFromName would.
    const reached = live.get(key) ?? new ImapSession(fakeState({ hex: key }).ctx, env());
    return { fetch: (request) => reached.fetch(request), changed: () => reached.changed() };
  });
  const env = (): ImapBindings => ({
    MAIL_DB: d.d1,
    MAIL_BLOBS: r2,
    IMAP_SESSION: sessions,
    IMAP_MAILBOX: mailboxes,
    BRIDGE_SECRET: "secret",
  });
  const mailboxObject: Mailbox = new ImapMailbox(mailboxState.ctx, env());
  let count = 0;

  /** A delivery row in D1 and, unless told not to, its blob in R2. */
  const deliver = (id: string, bytes: Uint8Array | null, mailbox = MAILBOX) => {
    const blob = `blob/${id}`;
    if (bytes !== null) blobs.set(blob, bytes);
    d.db
      .prepare(
        "INSERT INTO deliveries (id, blob, mailbox, rcpt_to, received_at, via) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, blob, mailbox, USER, "2026-03-02T17:00:00.000Z", "cloudflare");
  };

  /** A new connection: a session object on its own state, past its greeting. */
  const connect = async (address = "203.0.113.9") => {
    const hex = `session-${++count}`;
    const own: Log = [];
    const state = fakeState({ hex }, own);
    const client = fakeSocket();
    const server = fakeSocket(own);
    vi.stubGlobal(
      "WebSocketPair",
      class {
        0 = client.socket;
        1 = server.socket;
      },
    );
    const object = new ImapSession(state.ctx, env());
    live.set(`hex:${hex}`, object);
    const request = new Request("https://mail.example/imap", {
      headers: { "X-Client-Address": address },
    });
    const response = await object.fetch(request);
    const conn = { hex, state, server, own, object, response };
    /** One frame from the client, to the instance `to`. */
    const frame = (text: string, to: Session = conn.object) =>
      to.webSocketMessage(server.socket, Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer);
    /** A new instance on the same state, as after an eviction; the mailbox reaches it from now on. */
    const evict = (): Session => {
      conn.object = new ImapSession(state.ctx, env());
      live.set(`hex:${hex}`, conn.object);
      return conn.object;
    };
    return { ...conn, frame, evict };
  };

  return {
    ...d,
    blobs,
    r2,
    mailboxState,
    mailbox: () => mailboxObject,
    swap,
    env,
    deliver,
    connect,
  };
}

/** A promise a test settles by hand. */
export function gate<T = void>() {
  let open: (value: T) => void = () => {};
  let fail: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

/** A global Response that can answer 101, which Node refuses. */
export class UpgradeResponse {
  readonly status: number;
  readonly webSocket: unknown;
  constructor(_body: unknown, init: { status: number; webSocket?: unknown }) {
    this.status = init.status;
    this.webSocket = init.webSocket;
  }
}
