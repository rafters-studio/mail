# @rafters/mail

Email inbox framework for the edge. Inbound ingestion, outbound sending, threading, classification, folder/label management, team collaboration, and blob storage.

## The problem

There is no open-source email inbox framework for edge and serverless runtimes.

Teams building on Cloudflare Workers, AWS Lambda, Deno Deploy, Vercel Edge, or any other modern runtime have two options: build it from scratch, or bolt on a third-party SaaS inbox that owns their data.

## What this is

ActionMailbox for the edge. Six packages. Core has zero vendor dependencies. Every external concern is an adapter you can swap.

```
@rafters/mail              Core: schema, types, interfaces, threading
@rafters/mail-resend       Outbound email via Resend API
@rafters/mail-cloudflare   Inbound via Email Routing, R2 blob storage
@rafters/mail-react-email  React Email templates + renderer
@rafters/mail-workers-ai   DeBERTa-v3 zero-shot email classifier
@rafters/better-auth-resend  emailOTP glue for better-auth
```

## What core gives you

**10 Drizzle tables** for a complete inbox data model:

- Mailboxes (personal and shared/team)
- Folders (system + custom, per-mailbox)
- Labels (system, AI-generated, user-created, many-to-many on messages and threads)
- Threads (RFC 5322 conversation grouping, status, priority)
- Messages (envelope data, AI classification fields, blob storage keys)
- Attachments (metadata in DB, content in blob storage)
- Assignments (thread-level, for shared mailbox collaboration)
- Notes (internal thread notes, markdown, not visible to external parties)

**Zod validators** for every API boundary operation. Types inferred from schemas, never hand-written.

**Adapter interfaces** that decouple core from any vendor:

| Interface        | Purpose                                                | Ships with                   |
| ---------------- | ------------------------------------------------------ | ---------------------------- |
| EmailProvider    | Send email, manage mailing lists/subscribers/campaigns | @rafters/mail-resend         |
| BlobStorage      | Store/retrieve raw email and parsed bodies             | @rafters/mail-cloudflare     |
| EmailClassifier  | Classify email content into categories                 | @rafters/mail-workers-ai     |
| TemplateRenderer | Render email templates to HTML/text                    | @rafters/mail-react-email    |
| AuthAdapter      | Resolve user identity and access control               | App-specific (you implement) |
| InboundAdapter   | Receive email from external sources                    | @rafters/mail-cloudflare     |

## Design principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written interfaces first.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, React Email, or Workers AI dependencies in core.
3. **Drizzle for queries, you own migrations.** Core exports schema and raw SQL. Your app runs migrations with your tooling (wrangler, drizzle-kit, whatever).
4. **Plain text user references.** `ownerId`, `assigneeId`, `authorId` are text columns with no FK to external auth tables. Works with any auth system.
5. **Platform vocabulary.** MailingList (not Audience), Subscriber (not Contact), Campaign (not Broadcast). Vendor terms stay inside adapters.
6. **Factory pattern for adapters.** `createResendProvider(config)` not `new ResendProvider(config)`.
7. **Ship what we use.** Initial adapters cover Cloudflare + Resend + React Email + Workers AI because that is what runs in production.

## How email flows

### Inbound

```
Email arrives -> Cloudflare Email Routing -> Parse RFC 5322 headers
  -> Store raw .eml in blob storage (R2, S3, etc.)
  -> Store parsed HTML + text in blob storage
  -> Insert metadata row in DB with blob storage keys
  -> Match thread by In-Reply-To / References headers (or create new)
  -> Dispatch to classification queue
```

The raw email in blob storage is the source of truth. The database stores metadata for fast queries. If metadata is ever wrong, re-derive from the raw email.

### Outbound

```
Compose / Reply -> Validate with Zod -> Generate RFC 5322 Message-ID
  -> Build References chain -> Send via EmailProvider (Resend, etc.)
  -> Store copy in blob storage -> Insert message row -> Update thread
```

### Classification

```
Queue receives message -> Fetch first 4KB from blob storage
  -> DeBERTa-v3 zero-shot classification -> Category + confidence + tags
  -> Update message in DB -> Apply AI-generated labels
  -> Move spam to spam folder
```

## Quick start

```bash
pnpm add @rafters/mail
```

```typescript
// Use the schema with Drizzle
import { mailbox, inboxThread, inboxMessage } from "@rafters/mail/schema";

// Use validators at API boundaries
import { composeEmailSchema, listThreadsSchema } from "@rafters/mail";

// Use types
import type { ComposeEmail, ThreadStatus } from "@rafters/mail";
```

Add adapters for your stack:

```bash
pnpm add @rafters/mail-resend        # Outbound via Resend
pnpm add @rafters/mail-cloudflare    # Inbound via CF Email Routing + R2
pnpm add @rafters/mail-react-email   # Email templates
pnpm add @rafters/mail-workers-ai    # AI classification
```

## Status

Early development. The core schema and validators are implemented. Service interfaces, threading logic, adapters, and migrations are in progress.

| Package                     | Status                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| @rafters/mail               | Schema and validators shipped. Interfaces, threading, migrations in progress. |
| @rafters/mail-resend        | Not started                                                                   |
| @rafters/mail-cloudflare    | Not started                                                                   |
| @rafters/mail-react-email   | Not started                                                                   |
| @rafters/mail-workers-ai    | Not started                                                                   |
| @rafters/better-auth-resend | Not started                                                                   |

## Contributing

```bash
git clone https://github.com/rafters-studio/mail.git
cd mail
pnpm install
pnpm test        # Unit tests (vitest)
pnpm lint        # oxlint
pnpm format      # oxfmt
pnpm typecheck   # tsc
```

## License

MIT
