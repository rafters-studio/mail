# IMAP Server Quickstart

Deploy an IMAP server for your edge email inbox. Standard email clients (Apple Mail, Thunderbird, Outlook) connect directly.

---

## Two runtimes, one protocol

| Runtime       | Package                         | Deploys on                    | TLS                   |
| ------------- | ------------------------------- | ----------------------------- | --------------------- |
| Cloudflare DO | `@rafters/mail-imap-cloudflare` | Cloudflare Workers            | Cloudflare edge       |
| Node TCP      | `@rafters/mail-imap-server`     | Fly.io, Railway, Fargate, VPS | Proxy or self-managed |

Both use the same protocol layer (`@rafters/mail-imap`) and the same adapter interfaces. Pick the runtime that fits your infrastructure.

---

## Option A: Fly.io (recommended for standard IMAP clients)

### 1. Install

```bash
pnpm add @rafters/mail-imap @rafters/mail-imap-server
```

### 2. Create the server

```typescript
import { createImapServer } from "@rafters/mail-imap-server";

const server = createImapServer({
  // No TLS config -- Fly handles TLS termination
  port: 1993,
  adapters: {
    authAdapter: {
      async verifyAppPassword(email, password) {
        // Verify against your D1/database
      },
    },
    mailboxAdapter: {
      // Implement: listFolders, getFolderByName, getFolderStats, getMessageUids
    },
    messageAdapter: {
      // Implement: getMessage, getMessagesByIds, updateMessageFlags,
      //            deleteMessage, getBlob, searchMessages
    },
  },
  async resolveMailboxId(email) {
    // Map email address to mailbox ID in your database
  },
});

await server.listen();
```

### 3. Configure Fly

```toml
# fly.toml
app = "my-mail-imap"

[[services]]
  internal_port = 1993
  protocol = "tcp"

  [[services.ports]]
    port = 993
    handlers = ["tls"]
```

### 4. Deploy

```bash
fly launch
fly certs add mail.yourdomain.com
fly deploy
```

### 5. DNS

CNAME `mail.yourdomain.com` to `my-mail-imap.fly.dev`.

### 6. Connect Apple Mail

- Incoming Mail Server: `mail.yourdomain.com`
- Port: 993
- SSL: Yes
- Authentication: Password (use an app-specific password)

---

## Option B: Cloudflare Durable Objects (WebSocket clients)

For web-based email clients or custom apps that connect via WebSocket.

### 1. Install

```bash
pnpm add @rafters/mail-imap @rafters/mail-imap-cloudflare
```

### 2. Create the DO and Worker

```typescript
// src/index.ts
import { createImapDurableObject, createImapWorker } from "@rafters/mail-imap-cloudflare";

export const ImapMailboxDO = createImapDurableObject({
  createAdapters(env) {
    return {
      authAdapter: {
        /* verify against env.DB */
      },
      mailboxAdapter: {
        /* query env.DB */
      },
      messageAdapter: {
        /* query env.DB, fetch env.BLOB_STORAGE */
      },
    };
  },
});

const worker = createImapWorker();
export default worker;
```

### 3. Configure wrangler

```jsonc
// wrangler.jsonc
{
  "name": "mail-imap",
  "durable_objects": {
    "bindings": [{ "name": "IMAP_MAILBOX", "class_name": "ImapMailboxDO" }],
  },
  "migrations": [{ "tag": "v1", "new_classes": ["ImapMailboxDO"] }],
}
```

### 4. Deploy

```bash
wrangler types
wrangler deploy
```

### 5. Connect

WebSocket to `wss://mail-imap.yourdomain.workers.dev/?email=user@example.com&mailboxId=...`

---

## Authentication

The IMAP server delegates all authentication to your own auth system via the `AuthAdapter` interface:

```typescript
interface AuthAdapter {
  verifyAppPassword(email: string, appPassword: string): Promise<boolean>;
}
```

You bring the storage, hashing, generation, and revocation. The server calls `verifyAppPassword` on every LOGIN and trusts the return value. See [`authentication.md`](./authentication.md) on the `@rafters/mail-imap` package for the full contract.

---

## Multi-domain

Both runtimes support multiple domains from a single deployment. The email address is the routing key. `user@silvius.me` and `user@runlegion.dev` are served by the same server, routed to different mailboxes by `resolveMailboxId`.

---

## IDLE (push notifications)

The server supports IMAP IDLE (RFC 2177). When a client enters IDLE, it receives real-time `EXISTS` notifications when new mail arrives.

For the Cloudflare runtime: the inbound email Worker signals the IMAP DO via `POST /notify?count=N`. The DO pushes to all IDLE sessions bound to that mailbox.

For the Node runtime: call `server.notify(mailboxId, newMessageCount)` after storing a new message in your inbound handler:

```typescript
const server = createImapServer({
  /* ... */
});
await server.listen();

// In your inbound email handler, after the message is persisted:
async function onInboundMessage(mailboxId: string, storedMessage: Message) {
  const totalMessages = await countMessagesInInbox(mailboxId);
  server.notify(mailboxId, totalMessages);
}
```

`notify` delivers an `EXISTS` response to every session that is (a) currently in IDLE state and (b) bound to the specified mailbox. Sessions on other mailboxes, and sessions that are not in IDLE, are not affected. `newMessageCount` is the total number of messages in the mailbox after the insertion, not a delta -- IMAP clients read the `EXISTS` value as the new total.
