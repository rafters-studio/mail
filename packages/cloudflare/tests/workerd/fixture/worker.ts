// A test fixture on local workerd. It counts constructor runs, so an eviction can be seen.
import { EmailMessage } from "cloudflare:email";
import { DurableObject, env } from "cloudflare:workers";
import { imapObjects, imapWorker, submitObject } from "../../../src/index.ts";
import { evict } from "./unsafe.ts";

const login = async (user, password) => {
  const row = await env.FIXTURE_LOGINS.get(user, "json");
  return row !== null && row.password === password ? row.mailbox : null;
};
const objects = imapObjects(DurableObject, login);
const Submit = submitObject(
  DurableObject,
  (from, to, raw) => new EmailMessage(from, to, raw),
  login,
);
// Constructor runs are counted in D1, not in module scope (research 01a1ae1d: tests must not rely on module
// scope across eviction) and not in the session's own SQLite, which a revoked session deletes.
const counted = (kind, ctx) =>
  ctx.blockConcurrencyWhile(() =>
    env.MAIL_DB.batch([
      env.MAIL_DB.prepare(
        "CREATE TABLE IF NOT EXISTS fixture_ctor (k TEXT PRIMARY KEY, n INTEGER NOT NULL)",
      ),
      env.MAIL_DB.prepare(
        "INSERT INTO fixture_ctor (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1",
      ).bind(`${kind}:${ctx.id.toString()}`),
    ]),
  );
export class ImapSession extends objects.ImapSession {
  constructor(ctx, e) {
    super(ctx, e);
    counted("imap", ctx);
  }
}
export class SubmitSession extends Submit {
  constructor(ctx, e) {
    super(ctx, e);
    counted("submit", ctx);
  }
}
export class ImapMailbox extends objects.ImapMailbox {
  #sql;
  constructor(ctx, e) {
    super(ctx, e);
    this.#sql = ctx.storage.sql;
  }
  /** For the test alone: the names both tables hold. */
  names() {
    return ["sessions", "submit_sessions"].flatMap((table) =>
      [...this.#sql.exec(`SELECT name FROM ${table}`)].map((row) => String(row.name)),
    );
  }
}

const MESSAGE =
  "From: a@example.com\r\nTo: b@example.com\r\nSubject: fixture\r\nDate: Tue, 03 Nov 2026 12:00:00 +0000\r\nMessage-ID: <fixture@example.com>\r\nContent-Type: text/plain\r\n\r\nhello from the fixture\r\n";

/** A UUIDv7-shaped delivery id, since the mailbox's pull cursor reads its millisecond prefix. */
function deliveryId() {
  const t = Date.now().toString(16).padStart(12, "0");
  const r = [...crypto.getRandomValues(new Uint8Array(10))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${t.slice(0, 8)}-${t.slice(8)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 18)}`;
}

async function seed(mailbox) {
  await env.MAIL_DB.exec(
    "CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, blob TEXT NOT NULL, mailbox TEXT NOT NULL, mail_from TEXT, rcpt_to TEXT NOT NULL, received_at TEXT NOT NULL, via TEXT NOT NULL, UNIQUE (blob, mailbox))",
  );
  await env.MAIL_BLOBS.put("fixture-blob", MESSAGE);
  await env.MAIL_DB.prepare(
    "INSERT OR IGNORE INTO deliveries (id, blob, mailbox, mail_from, rcpt_to, received_at, via) VALUES (?, 'fixture-blob', ?, 'a@example.com', 'b@example.com', ?, 'fixture')",
  )
    .bind(deliveryId(), mailbox, new Date().toISOString())
    .run();
}

const front = imapWorker();
const mailbox = (name) => env.IMAP_MAILBOX.get(env.IMAP_MAILBOX.idFromName(name));

export default {
  async fetch(request, e) {
    const url = new URL(request.url);
    const q = url.searchParams;
    if (url.pathname === "/fixture/put") {
      await env.FIXTURE_LOGINS.put(
        q.get("user"),
        JSON.stringify({ password: q.get("password"), mailbox: q.get("mailbox") }),
      );
      return Response.json(true);
    }
    if (url.pathname === "/fixture/seed") {
      await seed(q.get("mailbox"));
      return Response.json(true);
    }
    if (url.pathname === "/fixture/stats") {
      await env.MAIL_DB.exec(
        "CREATE TABLE IF NOT EXISTS fixture_ctor (k TEXT PRIMARY KEY, n INTEGER NOT NULL)",
      );
      const { results } = await env.MAIL_DB.prepare("SELECT k, n FROM fixture_ctor").all();
      return Response.json(Object.fromEntries(results.map((row) => [row.k, row.n])));
    }
    if (url.pathname === "/fixture/revoke")
      return Response.json(await mailbox(q.get("mailbox")).revoke());
    if (url.pathname === "/fixture/names")
      return Response.json(await mailbox(q.get("mailbox")).names());
    if (url.pathname === "/fixture/evict") {
      const namespace = q.get("kind") === "submit" ? env.SUBMIT_SESSION : env.IMAP_SESSION;
      await evict(namespace.get(namespace.idFromString(q.get("id"))));
      return Response.json(true);
    }
    return front.fetch(request, e);
  },
};
