# @rafters/mail

Email inbox framework for the edge. The core package: schema, types, service interfaces, threading logic, and database migrations.

Part of [@rafters/mail](https://github.com/rafters-studio/mail), an email inbox framework for teams building on Cloudflare Workers, AWS Lambda, Deno Deploy, Vercel Edge, or anywhere Node runs.

## Install

```bash
pnpm add @rafters/mail
```

## What you get

**13 Drizzle tables** covering the full inbox + newsletter data model: mailboxes (personal and shared), folders, labels (system, AI, user), threads, messages, attachments, assignments, notes, audiences, subscribers, and broadcast audit.

**Zod validators** for every API boundary operation. Types are inferred from schemas with `z.infer<>`, never hand-written.

**Service implementations** for thread management, folder CRUD, label application, assignments, internal notes, and compose/reply with RFC 5322 header generation.

**Adapter interfaces** that decouple core from any vendor:

| Interface          | Purpose                                        | Ships in                     |
| ------------------ | ---------------------------------------------- | ---------------------------- |
| `EmailProvider`    | Send email and manage mailing lists            | `@rafters/mail-resend`       |
| `BlobStorage`      | Store and retrieve raw email and parsed bodies | `@rafters/mail-cloudflare`   |
| `EmailClassifier`  | Classify email content                         | `@rafters/mail-workers-ai`   |
| `TemplateRenderer` | Render email templates to HTML and text        | `@rafters/mail-react-email`  |
| `AuthAdapter`      | Resolve user identity and access control       | You implement                |
| `InboundAdapter`   | Receive email from external sources            | `@rafters/mail-cloudflare`   |

## Usage

```typescript
// Schema (Drizzle tables)
import { mailbox, inboxThread, inboxMessage } from "@rafters/mail/schema";

// Validators (API boundaries)
import { composeEmailSchema, listThreadsSchema } from "@rafters/mail/schema";

// Service implementations
import { createMailServices, createInboxEmailService } from "@rafters/mail/services";

// Threading
import { generateMessageId, buildReferences } from "@rafters/mail/threading";

// Auth adapter interface
import type { AuthAdapter } from "@rafters/mail/auth";

// Types
import type { Thread, Folder, Label, ComposeEmail } from "@rafters/mail";
```

## Design principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, or React Email dependencies here.
3. **Drizzle for queries, you own migrations.** Core exports schema and raw SQL; your app runs migrations with your tooling.
4. **Plain text user references.** `ownerId`, `assigneeId`, and `authorId` are text columns with no FK to external auth tables.
5. **Platform vocabulary.** `MailingList` (not Audience), `Subscriber` (not Contact), `Campaign` (not Broadcast). Vendor terms stay inside adapters.

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`reference.md`](./docs/reference.md) -- Full schema and API reference (all 13 tables, service interfaces, Zod schemas, design decisions)
- [`threading.md`](./docs/threading.md) -- RFC 5322 threading via `In-Reply-To` and `References`
- [`migrations.md`](./docs/migrations.md) -- Database migration workflow
- [`newsletters.md`](./docs/newsletters.md) -- Mailing lists, subscribers, campaigns, and broadcast audit
- [`adapters.md`](./docs/adapters.md) -- How adapters connect core to external services

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the wider framework overview and package list.

## License

MIT
