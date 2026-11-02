// The session and mailbox objects (Cloudflare Durable Objects hibernation docs): "When a Durable Object
// receives no events (such as alarms or messages) for a short period, it is evicted from memory." A mail
// app holds a connection for hours and says almost nothing, so everything a session told its client is
// saved before it is sent, and a woken object goes on from what was saved. Durable Objects are classes by
// Cloudflare's definition, so these are the exception to the writer's one class.
import { createImapSession, type ImapSession, type ImapStore } from "@rafters/mail/imap";
import { binary, readMessage } from "@rafters/mail/read";
import { z } from "zod";
import type { D1Like } from "./d1.ts";
import { d1Logins, octets } from "./imap-logins.ts";

/** The part of an R2 object a mailbox reads. */
export type R2ObjectLike = { arrayBuffer(): Promise<ArrayBuffer> };
/** A new type, since the existing R2Like has put alone and its fakes must keep working. */
export type R2Reader = { get(key: string): Promise<R2ObjectLike | null> };
/** The part of a hibernating WebSocket the session object uses. */
export type SocketLike = {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
};
/** Durable Object SQLite; a BLOB comes back as an ArrayBuffer. */
export type SqlLike = {
  exec(
    sql: string,
    ...values: (string | number | Uint8Array | null)[]
  ): Iterable<Record<string, unknown>>;
};
/** The parts of DurableObjectState the objects use. */
export type DurableObjectStateLike = {
  readonly id: { readonly name?: string; toString(): string };
  readonly storage: {
    readonly sql: SqlLike;
    transactionSync<T>(run: () => T): T;
    deleteAll(): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  acceptWebSocket(socket: SocketLike): void;
  getWebSockets(): SocketLike[];
  waitUntil(work: Promise<unknown>): void;
};
/** A session object over RPC; results are unknown here and parsed where they are read. */
export type SessionStub = {
  fetch(request: Request): Promise<Response>;
  changed(): Promise<unknown>;
};
/** A mailbox object over RPC; results are unknown here and parsed where they are read. */
export type MailboxStub = {
  open(mailbox: string, session: string): Promise<unknown>;
  held(uids: number[]): Promise<unknown>;
  bytes(uid: number): Promise<unknown>;
  setFlags(uid: number, flags: string[]): Promise<unknown>;
  expunge(uids: number[]): Promise<unknown>;
  forget(session: string): Promise<unknown>;
  ping(): Promise<unknown>;
};
/** The parts of a Durable Object namespace the objects use. */
export type NamespaceOf<S> = {
  idFromName(name: string): unknown;
  idFromString(hex: string): unknown;
  newUniqueId(): unknown;
  get(id: unknown): S;
};
/** The objects' bindings, by the names wrangler.jsonc gives them. */
export type ImapBindings = {
  MAIL_DB: D1Like;
  MAIL_BLOBS: R2Reader;
  IMAP_SESSION: NamespaceOf<SessionStub>;
  IMAP_MAILBOX: NamespaceOf<MailboxStub>;
  BRIDGE_SECRET: string;
};

/** What the runtime calls on a session object. */
type SessionObject = {
  fetch(request: Request): Promise<Response>;
  webSocketMessage(ws: SocketLike, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(ws: SocketLike): Promise<void>;
  webSocketError(ws: SocketLike): Promise<void>;
  alarm(): Promise<void>;
  changed(): Promise<boolean>;
};
/** What the runtime and the sessions call on a mailbox object. */
type MailboxObject = {
  open(mailbox: string, session: string): Promise<z.output<typeof openedSchema> | null>;
  held(uids: number[]): Promise<z.output<typeof heldSchema>[]>;
  bytes(uid: number): Promise<Uint8Array | null>;
  setFlags(uid: number, flags: string[]): Promise<void>;
  expunge(uids: number[]): Promise<void>;
  forget(session: string): Promise<void>;
  ping(): Promise<void>;
  alarm(): Promise<void>;
};

/** Why a delivery gave no message, as the skipped table's CHECK has it. */
type SkipReason = "held-message-id" | "no-blob" | "unreadable";

declare const WebSocketPair: new () => { 0: SocketLike; 1: SocketLike };

const MIB = 1024 * 1024;
const GREETING_ALARM_MS = 60_000;
const MAX_FRAMES_BEFORE_LOGIN = 100;
const MAILBOX_ALARM_MS = 300_000;
const TELL_BOUND_MS = 10_000;
const PAGE = 100;
const CURSOR_BEHIND_MS = 600_000;
// RFC 5322 2.1.1: a stranger can fold a Message-ID of any size in legal lines, and a row holds 2 MB.
const MAX_MESSAGE_ID = 998;

const heldSchema = z.object({
  uid: z.number(),
  flags: z.array(z.string()),
  internalDate: z.date(),
  size: z.number(),
});
const openedSchema = z.object({
  uidValidity: z.number(),
  uidNext: z.number(),
  messages: z.array(heldSchema),
});
const bytesSchema = z.instanceof(Uint8Array).nullable();
const stateRowSchema = z.object({
  k: z.string(),
  v: z.union([z.string(), z.instanceof(ArrayBuffer).transform((b) => binary(new Uint8Array(b)))]),
});
const savedSchema = z.object({ snapshot: z.string(), buffer: z.string() });
const phaseOnlySchema = z.object({ phase: z.object({ name: z.string() }) });
const messageRowSchema = z
  .object({ uid: z.number(), flags: z.string(), internal_date: z.string(), size: z.number() })
  .transform((row) => ({
    uid: row.uid,
    flags: z.array(z.string()).parse(JSON.parse(row.flags)),
    internalDate: new Date(row.internal_date),
    size: row.size,
  }));
const deliverySchema = z.object({ id: z.string(), blob: z.string(), received_at: z.string() });

const MAILBOX_TABLES = [
  `CREATE TABLE IF NOT EXISTS messages (
    uid INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery TEXT NOT NULL UNIQUE,
    blob TEXT NOT NULL,
    message_id TEXT,
    internal_date TEXT NOT NULL,
    size INTEGER NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    expunged INTEGER NOT NULL DEFAULT 0 CHECK (expunged IN (0, 1))
  )`,
  "CREATE INDEX IF NOT EXISTS messages_message_id ON messages (message_id)",
  `CREATE TABLE IF NOT EXISTS skipped (
    delivery TEXT PRIMARY KEY,
    reason TEXT NOT NULL CHECK (reason IN ('held-message-id', 'no-blob', 'unreadable')),
    message_id TEXT
  )`,
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (name TEXT PRIMARY KEY)",
];
const MESSAGE_COLUMNS = "uid, flags, internal_date, size";

/**
 * Form 01a19daa: what a session object has stored, read as binary text. The table is made on the
 * first write, so a dead name reached by a late tell finds nothing and leaves no database behind.
 */
function readState(sql: SqlLike): Map<string, string> {
  const made = [...sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'state'")];
  if (made.length === 0) return new Map();
  return new Map(
    [...sql.exec("SELECT k, v FROM state")].map((row) => {
      const { k, v } = stateRowSchema.parse(row);
      return [k, v];
    }),
  );
}

/** Form 01a19daa: a reply goes in frames of at most 1 MiB, in order. */
function sendFrames(ws: SocketLike, bytes: Uint8Array): void {
  for (let at = 0; at < bytes.length; at += MIB) ws.send(bytes.subarray(at, at + MIB));
}

/** Cloudflare WebSockets docs: a frame is text or binary, and a string is handled as its UTF-8 octets. */
function frameBytes(message: string | ArrayBuffer): Uint8Array {
  return typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
}

/**
 * Form 01a19daa, Pulling: a delivery's id is a UUIDv7 of its receipt time, so the cursor is its 48-bit
 * millisecond prefix lowered by ten minutes, dashed like the ids it is compared with, because a `-`
 * sorts below any hex digit.
 */
function cursorBehind(id: string): string {
  const millis = parseInt(id.replace("-", "").slice(0, 12), 16) - CURSOR_BEHIND_MS;
  const prefix = millis.toString(16).padStart(12, "0");
  return `${prefix.slice(0, 8)}-${prefix.slice(8)}`;
}

/** Form 01a19daa, Telling: a call that passes its bound counts as a rejection. */
function bounded(work: () => Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no answer in 10 seconds")), TELL_BOUND_MS);
    work()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Form 01a19daa, Closures: the two Durable Object classes, built on the Worker's own base class, so
 * no package imports `cloudflare:workers`.
 */
export function imapObjects<C extends DurableObjectStateLike, E extends ImapBindings>(
  Base: abstract new (ctx: C, env: E) => object,
): {
  ImapSession: new (ctx: C, env: E) => SessionObject;
  ImapMailbox: new (ctx: C, env: E) => MailboxObject;
} {
  class ImapSessionObject extends Base implements SessionObject {
    readonly #ctx: C;
    readonly #env: E;
    #session: ImapSession | null = null;
    #stored: Map<string, string> | null = null;
    #ended = false;
    // In memory: counting in a row would write the rows the cap exists to save.
    #frames = 0;

    constructor(ctx: C, env: E) {
      super(ctx, env);
      this.#ctx = ctx;
      this.#env = env;
    }

    /** Form 01a19daa: every store call goes to the account's mailbox, so this object holds no mail. */
    #mailbox(account: string): MailboxStub {
      const mailboxes = this.#env.IMAP_MAILBOX;
      return mailboxes.get(mailboxes.idFromName(account));
    }

    /** What is stored, read once per instance, since nothing else writes it. */
    #state(): Map<string, string> {
      this.#stored ??= readState(this.#ctx.storage.sql);
      return this.#stored;
    }

    /** Form 01a19daa: the session's store; login goes to D1 with the client address stored at fetch. */
    #store(): ImapStore {
      const name = this.#ctx.id.toString();
      return {
        login: (user, password) =>
          d1Logins(this.#env.MAIL_DB).verify(
            user,
            password,
            z.string().parse(this.#state().get("address")),
            new Date(),
          ),
        mailboxes: async () => ["INBOX"],
        open: async (account, mailbox) =>
          openedSchema.nullable().parse(await this.#mailbox(account).open(mailbox, name)),
        held: async (account, _mailbox, uids) =>
          z.array(heldSchema).parse(await this.#mailbox(account).held(uids)),
        bytes: async (account, _mailbox, uid) =>
          bytesSchema.parse(await this.#mailbox(account).bytes(uid)),
        setFlags: async (account, _mailbox, uid, flags) => {
          await this.#mailbox(account).setFlags(uid, flags);
        },
        expunge: async (account, _mailbox, uids) => {
          await this.#mailbox(account).expunge(uids);
        },
      };
    }

    /** Form 01a19daa: the session in memory, or a new one resumed from what is stored. */
    #live(): ImapSession {
      if (this.#session !== null) return this.#session;
      const { snapshot, buffer } = savedSchema.parse(Object.fromEntries(this.#state()));
      const saved = z.record(z.string(), z.unknown()).parse(JSON.parse(snapshot));
      this.#session = createImapSession({ store: this.#store(), resume: { ...saved, buffer } });
      return this.#session;
    }

    /**
     * Form 01a19daa: one transaction writing only what differs from what is stored, so a NOOP loop
     * before login costs no rows. Becoming authenticated deletes the alarm that closes a silent login.
     */
    async #save(session: ImapSession, also: [string, string][] = []): Promise<void> {
      const stored = this.#state();
      const { buffer, ...rest } = session.snapshot();
      const wanted: [string, string][] = [
        ["snapshot", JSON.stringify(rest)],
        ["buffer", buffer],
        ...also,
      ];
      if ("account" in rest.phase) wanted.push(["account", rest.phase.account]);
      const changes = wanted.filter(([k, v]) => stored.get(k) !== v);
      if (changes.length === 0) return;
      const { storage } = this.#ctx;
      storage.transactionSync(() => {
        storage.sql.exec("CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v BLOB)");
        for (const [k, v] of changes) {
          // The buffer is a raw BLOB, so binary bytes do not expand.
          const value = k === "buffer" ? octets(v) : v;
          storage.sql.exec(
            "INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
            k,
            value,
          );
        }
      });
      const becameAuthenticated = changes.some(([k]) => k === "account");
      for (const [k, v] of changes) stored.set(k, v);
      if (becameAuthenticated) await this.#ctx.storage.deleteAlarm();
    }

    /**
     * Form 01a19daa, Ending: the mailbox is told before the state goes, since deleting first loses the
     * account and a dead name keeps its mailbox waking. deleteAll deallocates the object; a forget that
     * rejects is logged and the state still goes, since a tell's false cleans the name.
     */
    async #end(): Promise<void> {
      this.#ended = true;
      const account = readState(this.#ctx.storage.sql).get("account");
      if (account !== undefined) {
        try {
          await this.#mailbox(account).forget(this.#ctx.id.toString());
        } catch (error) {
          console.error("imap session: forget failed", error);
        }
      }
      await this.#ctx.storage.deleteAll();
      this.#stored = null;
    }

    /** RFC 3501 5.4 lets a server close a connection; the socket goes first, then the state. */
    async #close(ws: SocketLike, code: number): Promise<void> {
      ws.close(code);
      await this.#end();
    }

    /** Form 01a19daa: saves, then sends, so a crash loses a reply and never leaves the client ahead. */
    async #deliver(ws: SocketLike, session: ImapSession, reply: Uint8Array): Promise<boolean> {
      if (this.#ended) return false;
      await this.#save(session);
      sendFrames(ws, reply);
      return true;
    }

    /** Form 01a19daa: a store failure or a failed save closes with 1011 and ends; the client reconnects. */
    async #guarded(ws: SocketLike, work: () => Promise<boolean>): Promise<boolean> {
      try {
        return await work();
      } catch (error) {
        if (!this.#ended) {
          console.error("imap session: failed", error);
          await this.#close(ws, 1011);
        }
        return false;
      }
    }

    /** Form 01a19daa: one object per connection, with the client address it will log in from. */
    async fetch(request: Request): Promise<Response> {
      const address = request.headers.get("X-Client-Address");
      if (!address) return new Response(null, { status: 400 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.#ctx.acceptWebSocket(server);
      const session = createImapSession({ store: this.#store() });
      this.#session = session;
      await this.#save(session, [["address", address]]);
      await this.#ctx.storage.setAlarm(Date.now() + GREETING_ALARM_MS);
      sendFrames(server, session.greeting());
      const upgraded: ResponseInit & { webSocket: SocketLike } = { status: 101, webSocket: client };
      return new Response(null, upgraded);
    }

    /** Form 01a19daa: received, saved, then sent; past 100 frames before login it closes with 1000. */
    async webSocketMessage(ws: SocketLike, message: string | ArrayBuffer): Promise<void> {
      await this.#guarded(ws, async () => {
        const session = this.#live();
        if (session.snapshot().phase.name === "not-authenticated") {
          this.#frames += 1;
          if (this.#frames > MAX_FRAMES_BEFORE_LOGIN) {
            await this.#close(ws, 1000);
            return false;
          }
        }
        const reply = await session.receive(frameBytes(message));
        const delivered = await this.#deliver(ws, session, reply);
        if (delivered && session.closed()) await this.#close(ws, 1000);
        return delivered;
      });
    }

    /** Form 01a19daa: the client went; the object ends, and the socket closes. */
    async webSocketClose(ws: SocketLike): Promise<void> {
      await this.#end();
      ws.close();
    }

    /** Form 01a19daa: a socket error ends the object as a close does. */
    async webSocketError(ws: SocketLike): Promise<void> {
      await this.webSocketClose(ws);
    }

    /** RFC 3501 5.4: a connection that never logs in closes, or it holds a bridge slot for good. */
    async alarm(): Promise<void> {
      const snapshot = this.#state().get("snapshot");
      if (snapshot === undefined) return;
      const { phase } = phaseOnlySchema.parse(JSON.parse(snapshot));
      if (phase.name !== "not-authenticated") return;
      for (const ws of this.#ctx.getWebSockets()) ws.close(1000);
      await this.#end();
    }

    /** Form 01a19daa: false tells the mailbox to forget this name; true means the session told its client. */
    async changed(): Promise<boolean> {
      const [ws] = this.#ctx.getWebSockets();
      if (ws === undefined || !this.#state().has("snapshot")) {
        ws?.close(1000);
        return false;
      }
      return this.#guarded(ws, async () => {
        const session = this.#live();
        return this.#deliver(ws, session, await session.changed());
      });
    }
  }

  class ImapMailboxObject extends Base implements MailboxObject {
    readonly #ctx: C;
    readonly #env: E;
    #pulling: Promise<void> | null = null;
    #pullAgain = false;
    #telling = false;
    #tellAgain = false;

    constructor(ctx: C, env: E) {
      super(ctx, env);
      this.#ctx = ctx;
      this.#env = env;
      const { sql } = ctx.storage;
      ctx.storage.transactionSync(() => {
        for (const table of MAILBOX_TABLES) sql.exec(table);
        // RFC 3501 2.3.1.1: D1's deliveries outlive this SQLite, so a rebuilt object takes a greater value.
        sql.exec(
          "INSERT OR IGNORE INTO meta (k, v) VALUES ('uid_validity', ?)",
          String(Math.floor(Date.now() / 1000)),
        );
      });
    }

    /** One meta row's value, or null. */
    #meta(k: string): string | null {
      const [row] = this.#ctx.storage.sql.exec("SELECT v FROM meta WHERE k = ?", k);
      return row === undefined ? null : String(row["v"]);
    }

    /** Form 01a19daa: a commit that changes what a session should hear owes it a tell, in its own transaction. */
    #owe(): void {
      this.#ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('tell-owed', '1')");
    }

    /** Form 01a19daa, Pulling: the cursor only rises, so a row read behind it does not lower it. */
    #raiseCursor(id: string): void {
      this.#ctx.storage.sql.exec(
        "INSERT INTO meta (k, v) VALUES ('cursor', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE excluded.v > v",
        cursorBehind(id),
      );
    }

    /** Form 01a19daa: a delivery that gave no message, and why, so it is not read again and can be found. */
    #skip(id: string, reason: SkipReason, messageId: string | null): void {
      console.error(`imap mailbox: skipped delivery ${id}: ${reason}`);
      this.#ctx.storage.transactionSync(() => {
        this.#ctx.storage.sql.exec(
          "INSERT INTO skipped (delivery, reason, message_id) VALUES (?, ?, ?)",
          id,
          reason,
          messageId,
        );
        this.#raiseCursor(id);
      });
    }

    /**
     * Form 01a19daa, Pulling: one delivery becomes one message or one skipped row. A Message-ID is
     * shown to the person once, expunged or not; a failure on one row, from a stranger or from damage,
     * must not stop every later pull. It says whether a message was added.
     */
    async #take(row: z.output<typeof deliverySchema>): Promise<boolean> {
      const { sql } = this.#ctx.storage;
      try {
        const object = await this.#env.MAIL_BLOBS.get(row.blob);
        if (object === null) {
          this.#skip(row.id, "no-blob", null);
          return false;
        }
        const bytes = new Uint8Array(await object.arrayBuffer());
        const found = readMessage(bytes).messageId;
        const messageId = found !== null && found.length <= MAX_MESSAGE_ID ? found : null;
        const [held] = sql.exec("SELECT 1 FROM messages WHERE message_id = ?", messageId);
        if (held !== undefined) {
          this.#skip(row.id, "held-message-id", messageId);
          return false;
        }
        this.#ctx.storage.transactionSync(() => {
          sql.exec(
            "INSERT OR IGNORE INTO messages (delivery, blob, message_id, internal_date, size) VALUES (?, ?, ?, ?, ?)",
            row.id,
            row.blob,
            messageId,
            row.received_at,
            bytes.length,
          );
          this.#raiseCursor(row.id);
          this.#owe();
        });
        return true;
      } catch (error) {
        console.error(`imap mailbox: delivery ${row.id}`, error);
        this.#skip(row.id, "unreadable", null);
        return false;
      }
    }

    /**
     * Form 01a19daa, Pulling: id order is not commit order, so the page starts ten minutes behind the
     * newest id seen, and rows already held or skipped are passed over before R2 is read.
     */
    async #pullOnce(): Promise<void> {
      const { sql } = this.#ctx.storage;
      const mailbox = z.string().parse(this.#ctx.id.name);
      let after = this.#meta("cursor") ?? "";
      let added = false;
      let page: Record<string, unknown>[];
      do {
        ({ results: page } = await this.#env.MAIL_DB.prepare(
          `SELECT id, blob, received_at FROM deliveries WHERE mailbox = ? AND id > ? ORDER BY id LIMIT ${PAGE}`,
        )
          .bind(mailbox, after)
          .all());
        for (const raw of page) {
          const row = deliverySchema.parse(raw);
          const [known] = sql.exec(
            "SELECT 1 FROM messages WHERE delivery = ? UNION ALL SELECT 1 FROM skipped WHERE delivery = ?",
            row.id,
            row.id,
          );
          if (known === undefined && (await this.#take(row))) added = true;
          after = row.id;
        }
      } while (page.length === PAGE);
      if (added) this.#tellLater();
    }

    /** Form 01a19daa: one pull at a time, and one asked for during it runs once more, so a ping is not missed. */
    #pull(): Promise<void> {
      if (this.#pulling !== null) {
        this.#pullAgain = true;
        return this.#pulling;
      }
      const run = async (): Promise<void> => {
        do {
          this.#pullAgain = false;
          await this.#pullOnce();
        } while (this.#pullAgain);
      };
      this.#pulling = run().finally(() => {
        this.#pulling = null;
      });
      return this.#pulling;
    }

    /**
     * Form 01a19daa, Telling: every registered session, each bounded. False removes the name; a
     * rejection leaves it, with a logged line; a pass with no rejection clears what is owed, unless
     * another pass is coming to do that.
     */
    async #tellPass(): Promise<void> {
      const { sql } = this.#ctx.storage;
      const sessions = this.#env.IMAP_SESSION;
      const names = [...sql.exec("SELECT name FROM sessions")].map((row) => String(row["name"]));
      const told = await Promise.allSettled(
        names.map((name) =>
          bounded(async () => sessions.get(sessions.idFromString(name)).changed()),
        ),
      );
      let rejected = false;
      told.forEach((result, i) => {
        if (result.status === "rejected") {
          rejected = true;
          console.error(`imap mailbox: telling ${names[i]} failed`, result.reason);
        } else if (result.value === false) {
          sql.exec("DELETE FROM sessions WHERE name = ?", String(names[i]));
        }
      });
      if (!rejected && !this.#tellAgain) sql.exec("DELETE FROM meta WHERE k = 'tell-owed'");
    }

    /** Form 01a19daa, Telling: one pass at a time with one more after it, so a burst makes few calls. */
    async #tell(): Promise<void> {
      if (this.#telling) {
        this.#tellAgain = true;
        return;
      }
      this.#telling = true;
      try {
        do {
          this.#tellAgain = false;
          await this.#tellPass();
        } while (this.#tellAgain);
      } finally {
        this.#telling = false;
      }
    }

    /**
     * Form 01a19daa, Telling: nothing waits for a tell. A session's receive waits on open, and a tell
     * waits on that session's changed, queued behind that receive; waiting here hangs the mailbox.
     */
    #tellLater(): void {
      this.#ctx.waitUntil(this.#tell());
    }

    /** Form 01a19daa: INBOX alone; registers the session, pulls, and gives the rows not expunged. */
    async open(mailbox: string, session: string): Promise<z.output<typeof openedSchema> | null> {
      if (mailbox !== "INBOX") return null;
      const { storage } = this.#ctx;
      const { sql } = storage;
      sql.exec("INSERT OR IGNORE INTO sessions (name) VALUES (?)", session);
      await this.#pull();
      if ((await storage.getAlarm()) === null)
        await storage.setAlarm(Date.now() + MAILBOX_ALARM_MS);
      const [sequence] = sql.exec("SELECT seq FROM sqlite_sequence WHERE name = 'messages'");
      return {
        uidValidity: Number(this.#meta("uid_validity")),
        uidNext: Number(sequence?.["seq"] ?? 0) + 1,
        messages: [
          ...sql.exec(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE expunged = 0 ORDER BY uid`),
        ].map((row) => messageRowSchema.parse(row)),
      };
    }

    /**
     * Form 01a19daa: those rows, expunged or not, in the order named. Durable Object SQLite allows 100
     * bound parameters, so the UIDs go as one JSON parameter.
     */
    async held(uids: number[]): Promise<z.output<typeof heldSchema>[]> {
      return [
        ...this.#ctx.storage.sql.exec(
          `SELECT ${MESSAGE_COLUMNS} FROM json_each(?) AS named JOIN messages ON uid = named.value ORDER BY named.key`,
          JSON.stringify(uids),
        ),
      ].map((row) => messageRowSchema.parse(row));
    }

    /** Form 01a19daa: expunge hides and does not erase, so the blob is served, expunged or not. */
    async bytes(uid: number): Promise<Uint8Array | null> {
      const [row] = this.#ctx.storage.sql.exec("SELECT blob FROM messages WHERE uid = ?", uid);
      if (row === undefined) return null;
      const object = await this.#env.MAIL_BLOBS.get(String(row["blob"]));
      return object === null ? null : new Uint8Array(await object.arrayBuffer());
    }

    /** Form 01a19daa: the row's flags change, and every session hears of it. */
    async setFlags(uid: number, flags: string[]): Promise<void> {
      this.#ctx.storage.transactionSync(() => {
        this.#ctx.storage.sql.exec(
          "UPDATE messages SET flags = ? WHERE uid = ?",
          JSON.stringify(flags),
          uid,
        );
        this.#owe();
      });
      this.#tellLater();
    }

    /** Form 01a19daa: hides the rows and keeps them; an empty list, which every CLOSE sends, does nothing. */
    async expunge(uids: number[]): Promise<void> {
      if (uids.length === 0) return;
      this.#ctx.storage.transactionSync(() => {
        this.#ctx.storage.sql.exec(
          "UPDATE messages SET expunged = 1 WHERE uid IN (SELECT value FROM json_each(?))",
          JSON.stringify(uids),
        );
        this.#owe();
      });
      this.#tellLater();
    }

    /** Form 01a19daa: a session that ended is not told again. */
    async forget(session: string): Promise<void> {
      this.#ctx.storage.sql.exec("DELETE FROM sessions WHERE name = ?", session);
    }

    /** Form 01a19daa: receiving says a delivery was recorded; the mailbox pulls it. */
    async ping(): Promise<void> {
      await this.#pull();
    }

    /**
     * Form 01a19daa: the next alarm is set first, so a D1 outage cannot end the chain once Cloudflare's
     * retries stop; so a lost ping delays mail by minutes, not forever. Then it pulls and tells what is owed.
     */
    async alarm(): Promise<void> {
      const [registered] = this.#ctx.storage.sql.exec("SELECT 1 FROM sessions LIMIT 1");
      if (registered !== undefined) {
        await this.#ctx.storage.setAlarm(Date.now() + MAILBOX_ALARM_MS);
      }
      try {
        await this.#pull();
      } catch (error) {
        console.error("imap mailbox: pull failed", error);
      }
      if (this.#meta("tell-owed") !== null) this.#tellLater();
    }
  }

  return { ImapSession: ImapSessionObject, ImapMailbox: ImapMailboxObject };
}
