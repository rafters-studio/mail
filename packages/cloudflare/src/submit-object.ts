// The object for one submission connection (Cloudflare Durable Objects hibernation docs): "When a
// Durable Object receives no events (such as alarms or messages) for a short period, it is evicted from
// memory." A message is held in memory and never saved, so a pause during an upload must not evict it.
// Its ports send through the binding and keep what was sent in the same journal as what was received.
// A Durable Object is a class by Cloudflare's definition, so this is the exception to the writer's one.
import { messageIdSchema, uuidv7 } from "@rafters/mail/message-id";
import { recipient } from "@rafters/mail/receive";
import { createSender, type Outcome } from "@rafters/mail/send";
import {
  createSubmission,
  type SubmitInput,
  type SubmitPorts,
  type SubmitSession,
} from "@rafters/mail/submit";
import { z } from "zod";
import { bindingTransport, type EmailBinding, type MakeMessage } from "./binding.ts";
import { type D1Like, d1Deliveries, d1Directory } from "./d1.ts";
import { d1Logins, hex } from "./imap-logins.ts";
import {
  type DurableObjectStateLike,
  frameBytes,
  type ImapBindings,
  type MailboxStub,
  type NamespaceOf,
  type R2Reader,
  readState,
  saveState,
  sendFrames,
  type SessionStub,
  type SocketLike,
} from "./imap-objects.ts";
import { type R2Like, r2Blobs } from "./r2.ts";
import { d1Sends, outcomeFrom } from "./send-log.ts";

/** The object's bindings, by the names wrangler.jsonc gives them. */
export type SubmitBindings = Omit<ImapBindings, "MAIL_BLOBS"> & {
  MAIL_BLOBS: R2Like & R2Reader;
  EMAIL: EmailBinding;
  SUBMIT_SESSION: NamespaceOf<Pick<SessionStub, "fetch">>;
  SUBMIT_HOSTNAME: string; // the name the session greets with
};
/** What delivering a notice needs, which a Worker hearing of a later bounce has too. */
type NoticeBindings = {
  MAIL_DB: D1Like;
  MAIL_BLOBS: R2Like;
  IMAP_MAILBOX: NamespaceOf<Pick<MailboxStub, "ping">>;
};
/** What the runtime calls on a submission object. */
type SubmitObject = {
  fetch(request: Request): Promise<Response>;
  webSocketMessage(ws: SocketLike, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(ws: SocketLike): Promise<void>;
  webSocketError(ws: SocketLike): Promise<void>;
  alarm(): Promise<void>;
};

declare const WebSocketPair: new () => { 0: SocketLike; 1: SocketLike };

const GREETING_ALARM_MS = 60_000;
const IDLE_ALARM_MS = 300_000;
const MAX_FRAMES_BEFORE_LOGIN = 100;
// On local workerd a stall of 12 seconds evicted the object, so a timer well inside that.
const HOLD_MS = 5_000;
// Past this a run of 50 recipients has finished or died, so a row is no attempt still running.
const RUNNING_MS = 900_000;
const IDLE = new TextEncoder().encode("421 Idle\r\n");
const hostnameSchema = z.string().min(1);

/** RFC 9562 5.7: a delivery's id, whose millisecond prefix the mailbox's pull cursor reads. */
function deliveryId(at: Date): string {
  return uuidv7(at.getTime(), (into) => crypto.getRandomValues(into));
}

/** Form 01a19daa, Receiving: a delivery was recorded, and the mailbox pulls it. */
async function ping(mailboxes: NoticeBindings["IMAP_MAILBOX"], mailbox: string): Promise<void> {
  await mailboxes.get(mailboxes.idFromName(mailbox)).ping();
}

/**
 * RFC 5321 6.1: a notice is a delivery to the sender's own INBOX with no send, so it cannot loop or
 * reach another person. A retry's notice is another row and one UID, by the mailbox's `held-message-id`
 * rule. Anything thrown is the caller's: a session logs it, and a Worker has its event retried.
 */
export async function deliverNotice(
  env: NoticeBindings,
  mailbox: string,
  bytes: Uint8Array,
  to: string,
): Promise<void> {
  const at = new Date();
  const blob = `sha256/${hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))}`;
  await r2Blobs(env.MAIL_BLOBS).put(blob, bytes);
  await d1Deliveries(env.MAIL_DB).record({
    id: deliveryId(at),
    blob,
    mailbox,
    mailFrom: null,
    rcptTo: to,
    receivedAt: at,
    via: "notice",
  });
  await ping(env.IMAP_MAILBOX, mailbox);
}

/**
 * Form 01a19de8, Keeping it: the bytes sent, a delivery row and a ping, each after the mail has gone. A
 * failure is logged and changes nothing: answering 451 now would have the app retry forever. A retry
 * that claimed nothing still writes, so a crash after the send cannot leave the person with no copy;
 * `UNIQUE (blob, mailbox)` and the mailbox's `held-message-id` rule make it one Sent UID. The mailbox row
 * comes first, since a mailbox made after the migration has no Sent yet.
 */
async function keep(env: SubmitBindings, input: SubmitInput, at: Date): Promise<void> {
  const sent = `${input.mailbox}/Sent`;
  try {
    await r2Blobs(env.MAIL_BLOBS).put(input.blobKey, input.bytes);
    await env.MAIL_DB.prepare("INSERT OR IGNORE INTO mailboxes (id) VALUES (?)").bind(sent).run();
    await d1Deliveries(env.MAIL_DB).record({
      id: deliveryId(at),
      blob: input.blobKey,
      mailbox: sent,
      mailFrom: input.from,
      rcptTo: input.to.join(", "),
      receivedAt: at,
      via: "submission",
    });
    await ping(env.IMAP_MAILBOX, sent);
  } catch (error) {
    console.error(`submit: not kept for ${input.holdKey}`, error);
  }
}

/**
 * Form 01a19de8, A held recipient answers from its row: with one query, at this clock. A row unknown and
 * younger than the running window may belong to an attempt still running, so the app is told to try
 * again later and nobody is told it failed.
 */
async function heldOutcomes(
  db: D1Like,
  holdKey: string,
  held: string[],
  at: Date,
): Promise<Outcome[]> {
  if (held.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT recipient, state, final, stage, code, text, provider_id, updated_at FROM sends
WHERE message_id = ? AND recipient IN (SELECT value FROM json_each(?))`,
    )
    .bind(holdKey, JSON.stringify(held))
    .all();
  return results.map((row) =>
    row["state"] === "unknown" && at.getTime() - Date.parse(String(row["updated_at"])) < RUNNING_MS
      ? outcomeFrom({
          recipient: row["recipient"],
          state: "refused",
          final: 0,
          stage: "provider",
          code: null,
          text: "still sending",
        })
      : outcomeFrom(row),
  );
}

/**
 * Form 01a19de8: the session's ports on Cloudflare. `login` is the IMAP form's, with its throttle and the
 * client's address. `mayUse` reads the row `findMailbox` would use, so a postmaster or catch-all fallback
 * grants nothing. `submit` writes its link, sends, answers each recipient in envelope order, and keeps.
 */
export function submitPorts(
  env: SubmitBindings,
  make: MakeMessage,
  address: () => string,
): SubmitPorts {
  const db = env.MAIL_DB;
  return {
    login: (user, password) => d1Logins(db).verify(user, password, address(), new Date()),
    mayUse: async (mailbox, used) => {
      const { local, tag, domain } = recipient(used);
      if (domain === null) return false;
      const directory = d1Directory(db);
      const tagged = tag === null ? null : await directory.address(`${local}+${tag}`, domain);
      const row = tagged ?? (await directory.address(local, domain));
      return row?.enabled === true && row.mailbox === mailbox;
    },
    submit: async (input) => {
      await db
        .prepare(
          "INSERT OR IGNORE INTO submissions (hold_key, mailbox, message_id, subject, blob, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.holdKey,
          input.mailbox,
          input.messageId,
          input.subject,
          input.blobKey,
          new Date().toISOString(),
        )
        .run();
      const send = createSender({
        transport: bindingTransport(env.EMAIL, make),
        sends: d1Sends(db),
      });
      const sent = await send({
        bytes: input.bytes,
        messageId: messageIdSchema.parse(input.holdKey),
        envelope: { from: input.from, to: input.to },
      });
      const at = new Date();
      const merged = [...sent.outcomes, ...(await heldOutcomes(db, input.holdKey, sent.held, at))];
      const outcomes = merged.sort(
        (a, b) => input.to.indexOf(a.recipient) - input.to.indexOf(b.recipient),
      );
      if (outcomes.some((o) => o.kind === "accepted" || o.kind === "unknown")) {
        await keep(env, input, at);
      }
      return outcomes;
    },
    notify: (mailbox, bytes, to) => deliverNotice(env, mailbox, bytes, to),
  };
}

/**
 * Form 01a19de8, Closures: the Durable Object class, built on the Worker's own base class, so no package
 * imports `cloudflare:workers`, with `make` written where `cloudflare:email` can be imported. It follows
 * the IMAP session object's rules, by reference, and differs where a message's lines are not commands.
 */
export function submitObject<C extends DurableObjectStateLike, E extends SubmitBindings>(
  Base: abstract new (ctx: C, env: E) => object,
  make: MakeMessage,
): new (ctx: C, env: E) => SubmitObject {
  return class SubmitSessionObject extends Base implements SubmitObject {
    readonly #ctx: C;
    readonly #env: E;
    #session: SubmitSession | null = null;
    #stored: Map<string, string> | null = null;
    #ended = false;
    // In memory: counting in a row would write the rows the cap exists to save.
    #frames = 0;
    #hold: ReturnType<typeof setInterval> | null = null;

    constructor(ctx: C, env: E) {
      super(ctx, env);
      this.#ctx = ctx;
      this.#env = env;
    }

    /** What is stored, read once per instance, since nothing else writes it. */
    #state(): Map<string, string> {
      this.#stored ??= readState(this.#ctx.storage.sql);
      return this.#stored;
    }

    /** Form 01a19de8: a session greeting with the name in env, so it needs no state row. */
    #create(resume?: unknown): SubmitSession {
      const ports = submitPorts(this.#env, make, () =>
        z.string().parse(this.#state().get("address")),
      );
      return createSubmission({ ports, hostname: this.#env.SUBMIT_HOSTNAME, resume });
    }

    /** Form 01a19daa: the session in memory, or a new one resumed from what is stored. */
    #live(): SubmitSession {
      this.#session ??= this.#create(JSON.parse(z.string().parse(this.#state().get("snapshot"))));
      return this.#session;
    }

    /** Form 01a19daa: saves what differs. No message is here: a snapshot holds an envelope at most. */
    #save(session: SubmitSession, also: [string, string][] = []): void {
      const snapshot = session.snapshot();
      const wanted: [string, string][] = [["snapshot", JSON.stringify(snapshot)], ...also];
      if ("mailbox" in snapshot.phase) wanted.push(["account", snapshot.phase.mailbox]);
      saveState(this.#ctx.storage, this.#state(), wanted);
    }

    /**
     * Form 01a19de8, The message is never saved: Cloudflare's docs say a timer prevents hibernation, so
     * one is held only while a message is on its way in, and an upload that pauses is not evicted.
     */
    #holdWhileInData(session: SubmitSession): void {
      const inData = session.snapshot().phase.name === "data";
      if (inData && this.#hold === null) this.#hold = setInterval(() => undefined, HOLD_MS);
      if (!inData) this.#release();
    }

    /** The timer goes as soon as it is not needed, since the object is billed while it runs. */
    #release(): void {
      if (this.#hold !== null) clearInterval(this.#hold);
      this.#hold = null;
    }

    /** Form 01a19daa, Ending: deleteAll deallocates the object; a call finishing later saves and sends nothing. */
    async #end(): Promise<void> {
      this.#ended = true;
      this.#release();
      await this.#ctx.storage.deleteAll();
      this.#stored = null;
    }

    /** RFC 5321 4.3.2 lets a server close a connection; the socket goes first, then the state. */
    async #close(ws: SocketLike, code: number): Promise<void> {
      ws.close(code);
      await this.#end();
    }

    /** Form 01a19daa: one object per connection, with the client address it will log in from. */
    async fetch(request: Request): Promise<Response> {
      const address = request.headers.get("X-Client-Address");
      if (!address) return new Response(null, { status: 400 });
      hostnameSchema.parse(this.#env.SUBMIT_HOSTNAME);
      const { 0: client, 1: server } = new WebSocketPair();
      this.#ctx.acceptWebSocket(server);
      const session = this.#create();
      this.#session = session;
      this.#save(session, [["address", address]]);
      await this.#ctx.storage.setAlarm(Date.now() + GREETING_ALARM_MS);
      sendFrames(server, session.greeting());
      const upgraded: ResponseInit & { webSocket: SocketLike } = { status: 101, webSocket: client };
      return new Response(null, upgraded);
    }

    /**
     * Form 01a19de8: received, saved, then sent, so 354 goes out only after `data` is saved. After login
     * every frame moves the idle alarm, since lines inside DATA are not commands and a slow upload must
     * not die; a failure closes with 1011 and ends, and the client reconnects.
     */
    async webSocketMessage(ws: SocketLike, message: string | ArrayBuffer): Promise<void> {
      try {
        const session = this.#live();
        if (!this.#state().has("account")) {
          this.#frames += 1;
          if (this.#frames > MAX_FRAMES_BEFORE_LOGIN) {
            await this.#close(ws, 1000);
            return;
          }
        }
        const reply = await session.receive(frameBytes(message));
        if (this.#ended) return;
        this.#save(session);
        if (this.#state().has("account")) {
          await this.#ctx.storage.setAlarm(Date.now() + IDLE_ALARM_MS);
        }
        this.#holdWhileInData(session);
        sendFrames(ws, reply);
        if (session.closed()) await this.#close(ws, 1000);
      } catch (error) {
        console.error("submit session: failed", error);
        await this.#close(ws, 1011);
      }
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

    /**
     * Form 01a19de8: a login never made closes, and passing the idle alarm answers 421 and closes, or an
     * idle session holds a bridge slot through the bridge's pings. With nothing stored the client went first.
     */
    async alarm(): Promise<void> {
      const stored = this.#state();
      if (!stored.has("snapshot")) return;
      for (const ws of this.#ctx.getWebSockets()) {
        if (stored.has("account")) ws.send(IDLE);
        ws.close(1000);
      }
      await this.#end();
    }
  };
}
