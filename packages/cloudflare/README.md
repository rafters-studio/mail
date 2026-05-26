# @rafters/mail-cloudflare

Cloudflare inbound email adapter for [@rafters/mail](https://github.com/rafters-studio/mail). R2 blob storage implementation, RFC 5322 email header parsing, and content hashing for idempotent ingestion.

Pairs Cloudflare Email Routing (inbound) with R2 (blob storage) to give you the two hardest pieces of edge email: receiving raw messages and storing them somewhere durable.

## Install

```bash
pnpm add @rafters/mail-cloudflare @rafters/mail
```

## Usage

### R2 blob storage

```typescript
import { createR2Storage } from "@rafters/mail-cloudflare/storage";

const storage = createR2Storage(env.BLOB_STORAGE);

await storage.put("messages/msg-123/raw.eml", rawEmailBuffer);
const raw = await storage.get("messages/msg-123/raw.eml");
```

`createR2Storage` implements the `BlobStorage` interface from `@rafters/mail`, so it drops into any service that expects a blob store.

### Email parsing

```typescript
import { parseEmailHeaders, hashContent } from "@rafters/mail-cloudflare/parsing";

const headers = parseEmailHeaders(rawEmail);
// { messageId, from, to, subject, references, inReplyTo, date, ... }

const hash = await hashContent(rawEmail);
// sha256 for dedupe and integrity checks
```

### Inbound Email Routing handler

Wire Email Routing to a Worker that stores the raw email in R2, parses headers, dedupes by hash, and hands off to your threading service:

> **The email Worker must be email-only.** Cloudflare Email Routing only lists Workers whose default export is exclusively `email()`. Do not add a `fetch()` handler -- the Worker will disappear from the destination picker. Deploy HTTP routes as a separate Worker against the same D1 + R2 bindings.

```typescript
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const raw = await new Response(message.raw).arrayBuffer();
    const hash = await hashContent(new Uint8Array(raw));

    if (await env.DB.get("messages", { hash })) return; // already ingested

    const headers = parseEmailHeaders(new TextDecoder().decode(raw));
    const storage = createR2Storage(env.BLOB_STORAGE);
    await storage.put(`messages/${hash}/raw.eml`, new Uint8Array(raw));

    // Thread matching, DB insert, classification dispatch, etc.
  },
};
```

## Exports

| Subpath     | What                                                   |
| ----------- | ------------------------------------------------------ |
| `.`         | Top-level re-exports                                   |
| `./storage` | `createR2Storage` (R2 implementation of `BlobStorage`) |
| `./parsing` | `parseEmailHeaders`, `hashContent`                     |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`quickstart.md`](./docs/quickstart.md) -- Cloudflare Workers + D1 + R2 + Email Routing setup, from zero to receiving email
- [`inbound.md`](./docs/inbound.md) -- Inbound email flow: parsing, dedupe, blob storage, thread matching
- [`blob-storage.md`](./docs/blob-storage.md) -- Raw email + parsed body storage in R2, key schema, retrieval

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the complete framework overview.

## License

MIT
