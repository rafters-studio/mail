# @rafters/mail-imap-cloudflare

Cloudflare Durable Object runtime for [`@rafters/mail-imap`](https://www.npmjs.com/package/@rafters/mail-imap). One Durable Object per mailbox, WebSocket transport, hibernation for IDLE, and an inbound-signal bridge so new mail wakes idle clients with an EXISTS notification.

Near-zero idle cost: when no clients are connected, the DO hibernates. When a client holds IDLE, the DO stays warm only long enough to serve the connection and then hibernates again until new mail arrives or the client disconnects.

## Install

```bash
pnpm add @rafters/mail-imap-cloudflare @rafters/mail-imap @rafters/mail
```

## Usage

```typescript
// src/worker.ts
import { createImapDurableObject, createImapWorker } from "@rafters/mail-imap-cloudflare";
import { createAuthAdapter } from "./adapters/auth.ts";
import { createMailboxAdapter } from "./adapters/mailbox.ts";
import { createMessageAdapter } from "./adapters/message.ts";

// The DO class. Export the return value from your worker entry.
export const ImapMailboxDO = createImapDurableObject({
  createAdapters(env) {
    return {
      authAdapter: createAuthAdapter(env.DB),
      mailboxAdapter: createMailboxAdapter(env.DB),
      messageAdapter: createMessageAdapter(env.DB, env.BLOB_STORAGE),
    };
  },
});

// The worker entry that routes WebSocket upgrades to the correct DO
// (one DO per email address).
export default createImapWorker();
```

```jsonc
// wrangler.jsonc
{
  "name": "mail-imap",
  "compatibility_date": "2025-04-01",
  "durable_objects": {
    "bindings": [{ "name": "IMAP_MAILBOX", "class_name": "ImapMailboxDO" }],
  },
  "migrations": [{ "tag": "v1", "new_classes": ["ImapMailboxDO"] }],
  "d1_databases": [{ "binding": "DB", "database_name": "mail", "database_id": "..." }],
  "r2_buckets": [{ "binding": "BLOB_STORAGE", "bucket_name": "mail-blobs" }],
}
```

Clients connect with `wss://imap.example.com/?email=user@example.com&mailboxId=mbx-123`. Standard email clients do not speak IMAP-over-WebSocket natively; this runtime is designed for web clients and custom bridges. For native TCP on port 993, use [`@rafters/mail-imap-server`](https://www.npmjs.com/package/@rafters/mail-imap-server).

## Inbound signaling

The DO exposes a `POST /notify?count=N` endpoint that your inbound email Worker calls after storing a new message. IDLE clients receive an EXISTS notification on the next tick.

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`deployment.md`](./docs/deployment.md) -- Deployment guide covering Cloudflare Workers + Durable Objects setup, bindings, cost model, and monitoring

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the complete IMAP architecture.

## License

MIT
