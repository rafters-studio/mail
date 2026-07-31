# IMAP Deployment Guide (Cloudflare)

Deploy `@rafters/mail-imap-cloudflare` as a Durable Object runtime on Cloudflare Workers.

This is the serverless path: one Durable Object per mailbox, IMAP over WebSocket, hibernation while idle. If you need native TCP on port 993 so that Thunderbird and Apple Mail connect without a bridge, this is **not** the guide you want -- see [`@rafters/mail-imap-server`](https://www.npmjs.com/package/@rafters/mail-imap-server) and the "Native clients" section at the bottom.

---

## Prerequisites

- A Cloudflare account with Workers enabled. Durable Objects require a **paid Workers plan**; they are not on the free tier.
- A D1 database and R2 bucket already provisioned, with the mail schema applied. See the [`@rafters/mail-cloudflare` quickstart](https://www.npmjs.com/package/@rafters/mail-cloudflare).
- An auth adapter you supply. `@rafters/mail-imap` ships the `ImapAuthAdapter` contract, not an implementation.
- `wrangler` 4.x.

---

## 1. Write the Worker

Two exports: the Durable Object class, and the Worker that routes to it.

```typescript
// src/worker.ts
import { createImapDurableObject, createImapWorker } from "@rafters/mail-imap-cloudflare";
import { createAuthAdapter } from "./adapters/auth.ts";
import { createMailboxAdapter } from "./adapters/mailbox.ts";
import { createMessageAdapter } from "./adapters/message.ts";

export const ImapMailboxDO = createImapDurableObject({
  createAdapters(env) {
    return {
      authAdapter: createAuthAdapter(env.DB),
      mailboxAdapter: createMailboxAdapter(env.DB),
      messageAdapter: createMessageAdapter(env.DB, env.BLOB_STORAGE),
    };
  },
});

export default createImapWorker();
```

Both exports are required. Wrangler resolves `class_name` against the module's named exports, so omitting `export const ImapMailboxDO` fails at deploy time with a class-not-found error rather than at runtime.

### Tuning

`createImapDurableObject` takes two optional limits:

```typescript
createImapDurableObject({
  createAdapters,
  maxSessionsPerMailbox: 5, // reject further connections beyond this
  sessionTimeoutMs: 1_800_000, // drop idle sessions after 30 minutes
});
```

`maxSessionsPerMailbox` is worth setting deliberately. Mail clients open several concurrent connections -- Apple Mail commonly holds one per folder it is watching -- so a limit of 1 or 2 will break normal use in a way that looks like a flaky server.

---

## 2. Configure wrangler

```jsonc
// wrangler.jsonc
{
  "name": "mail-imap",
  "compatibility_date": "2025-04-01",
  "durable_objects": {
    "bindings": [{ "name": "IMAP_MAILBOX", "class_name": "ImapMailboxDO" }],
  },
  "migrations": [{ "tag": "v1", "new_classes": ["ImapMailboxDO"] }],
  "d1_databases": [{ "binding": "DB", "database_name": "mail", "database_id": "your-database-id" }],
  "r2_buckets": [{ "binding": "BLOB_STORAGE", "bucket_name": "mail-blobs" }],
}
```

The `migrations` block is not optional and is not about your database. It is how Cloudflare tracks Durable Object class lifecycle; a first deploy without a `new_classes` entry is rejected. If you later rename the class you need a new tag with `renamed_classes`, not an edit to `v1`.

Bind the **same** D1 database and R2 bucket the inbound Worker writes to. The IMAP runtime is a reader over that storage; pointing it at a different database yields an IMAP server that authenticates fine and shows an empty mailbox.

---

## 3. Deploy

```bash
wrangler deploy
```

---

## 4. Wire the new-mail signal

Hibernation means the DO is not running when mail arrives, so it cannot notice on its own. The inbound Worker tells it:

```typescript
// in your inbound email Worker, after the message row is committed
const id = env.IMAP_MAILBOX.idFromName(recipientAddress);
await env.IMAP_MAILBOX.get(id).fetch("https://do/notify?count=1", { method: "POST" });
```

That POST is what turns an IDLE client's `EXISTS` notification from a polling artifact into a push. Skip it and mail still arrives -- clients just do not see it until they next poll or reconnect, which for Apple Mail can be minutes.

Signal **after** the D1 write commits. Signalling first races the DO into reading a row that is not there yet, and the client gets an `EXISTS` for a message it cannot then fetch.

`count` must be greater than zero. The DO parses it and returns `200 OK` regardless, but a missing, zero, or unparseable `count` notifies nobody -- so a typo in the query string looks like a successful signal and produces no client notification. It is the one part of this wiring with no feedback when you get it wrong.

---

## 5. Connect a client

There is no native TCP listener here, so a standard mail client cannot connect directly. Test over WebSocket:

```bash
wscat -c "wss://mail-imap.<your-subdomain>.workers.dev/?email=you@yourdomain.com&mailboxId=<mailbox-uuid>"
# * OK IMAP4rev1 Service Ready
a1 LOGIN you@yourdomain.com hunter2
a2 SELECT INBOX
a3 FETCH 1 (FLAGS BODY[HEADER.FIELDS (SUBJECT FROM)])
a4 LOGOUT
```

**Both query parameters are required.** The Worker returns `400 Missing or invalid email parameter` without `email`, and `400 Missing mailboxId parameter` without `mailboxId` -- it will not derive one from the other. `email` selects the Durable Object (`idFromName(email)`, so one DO per address); `mailboxId` is forwarded to the DO to identify which mailbox row the session reads. A request without the `Upgrade: websocket` header gets a plain 200 and no upgrade, which is what makes an uptime probe harmless.

The protocol on the wire is ordinary IMAP4rev1 -- the parser and handlers are transport-agnostic, so anything you can do over TCP works here, framed in WebSocket messages.

---

## 6. Monitoring

```bash
wrangler tail                                    # live logs
wrangler d1 execute mail --command "SELECT COUNT(*) FROM inbox_message"
```

Durable Object metrics live under Workers & Pages > your worker > Durable Objects in the dashboard. The number worth watching is **active duration**, not request count: a DO that never hibernates because a client holds a connection open indefinitely is the failure mode that turns a near-zero bill into a steady one.

There is no health-check endpoint. The Worker responds to a plain GET with a short message rather than upgrading, which is enough for an uptime probe.

---

## Cost

Hibernation is the whole economic argument for this runtime. A hibernated DO holds its WebSockets open without being billed for wall-clock time, so an idle mailbox with a connected-but-quiet client costs storage and little else.

Charges land on:

- **Requests** -- one per WebSocket upgrade and one per `/notify` signal, not per IMAP command.
- **Active duration** -- billed while the DO is awake and processing. Hibernated time is not billed.
- **Storage** -- the DO's own state, plus the D1 and R2 you were already paying for.

Practical shape: a handful of mailboxes with normal client behavior sits in the low single-digit dollars per month, dominated by whatever D1 and R2 already cost. The thing that breaks that model is a client that keeps the DO awake continuously; `sessionTimeoutMs` is the lever.

Durable Objects require a paid Workers plan, so there is a floor regardless of usage.

---

## Native clients (Thunderbird, Apple Mail, Outlook)

Standard mail clients speak TCP on port 993 and do not speak WebSocket. Cloudflare Workers cannot open a TCP listener, so this runtime cannot serve them directly. Two options:

1. **Run `@rafters/mail-imap-server`** on Fly.io, Railway, Fargate, or a VPS. Same protocol layer, real TCP, real TLS on 993. See that package's deployment guide.
2. **A local WebSocket-to-TCP bridge** on the client machine. Works, but it is per-machine setup, which defeats the point for anything but your own laptop.

Cloudflare Spectrum can proxy raw TCP to a Worker and would remove this limitation, but it is an enterprise add-on. Tracked in [#57](https://github.com/rafters-studio/mail/issues/57).

---

## Not supported

**Native TCP on 993 from Workers.** No listener API exists. See above.

**Cloudflare Containers.** Would give real TCP, but the container has to stay running, which discards the hibernation economics that motivate this package. If you want an always-on process, use `@rafters/mail-imap-server` on a platform built for it.

**The Workers free tier.** Durable Objects are paid-plan only.
