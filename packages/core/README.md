# @rafters/mail

Email inbox framework for the edge. The core package: Zod row schemas, validators, service interfaces, threading logic, and raw SQL migrations. Zero vendor dependencies -- only `uuidv7` and `zod`.

Part of [@rafters/mail](https://github.com/rafters-studio/mail), an email inbox framework for teams building on Cloudflare Workers, AWS Lambda, Deno Deploy, Vercel Edge, or anywhere Node runs.

## Install

```bash
pnpm add @rafters/mail @rafters/mail-drizzle
```

`@rafters/mail-drizzle` is the default ORM adapter. Other ORM adapters (Kysely, Prisma) can slot in identically.

## What you get

**13 tables** covering the full inbox + newsletter data model -- described as Zod row schemas (`mailboxRowSchema`, `inboxThreadRowSchema`, ...) and raw SQL in `migrationSQL`. Drizzle table definitions live in `@rafters/mail-drizzle`.

**Zod validators** for every API boundary operation. Types are inferred from schemas with `z.infer<>`, never hand-written.

**Service interfaces** for thread management, folder CRUD, label application, assignments, internal notes, and compose/reply with RFC 5322 header generation. Implementations ship in ORM adapter packages.

**Adapter interfaces** that decouple core from any vendor:

| Interface          | Purpose                                        | Ships in                    |
| ------------------ | ---------------------------------------------- | --------------------------- |
| ORM (services)     | Table definitions + service factories          | `@rafters/mail-drizzle`     |
| `EmailProvider`    | Send email and manage mailing lists            | `@rafters/mail-resend`      |
| `BlobStorage`      | Store and retrieve raw email and parsed bodies | `@rafters/mail-cloudflare`  |
| `EmailClassifier`  | Classify email content                         | `@rafters/mail-workers-ai`  |
| `TemplateRenderer` | Render email templates to HTML and text        | `@rafters/mail-react-email` |
| `AuthAdapter`      | Resolve user identity and access control       | You implement               |
| `InboundAdapter`   | Receive email from external sources            | `@rafters/mail-cloudflare`  |

## Usage

```typescript
// Validators (API boundaries) and Zod row schemas (ORM-neutral)
import { composeEmailSchema, listThreadsSchema, mailboxRowSchema } from "@rafters/mail/schema";

// Threading (pure functions)
import { generateMessageId, buildReferences } from "@rafters/mail/threading";

// Auth adapter interface
import type { AuthAdapter } from "@rafters/mail/auth";

// Types
import type { Thread, Folder, Label, ComposeEmail } from "@rafters/mail";

// Drizzle table definitions and service factories from the ORM adapter
import {
  mailbox,
  inboxThread,
  inboxMessage,
  createMailServices,
  createInboxEmailService,
} from "@rafters/mail-drizzle";
```

## Design principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, React Email, Workers AI, or Drizzle dependencies here.
3. **ORM-neutral.** Schema is Zod row schemas + raw SQL. Drizzle tables and service implementations live in `@rafters/mail-drizzle`. Other ORMs slot in identically.
4. **Plain text user references.** `ownerId`, `assigneeId`, and `authorId` are text columns with no FK to external auth tables.
5. **Platform vocabulary.** `MailingList` (not Audience), `Subscriber` (not Contact), `Campaign` (not Broadcast). Vendor terms stay inside adapters.

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`reference.md`](./docs/reference.md) -- Full schema and API reference (Zod row schemas for all 13 tables, service interfaces, validators, design decisions)
- [`threading.md`](./docs/threading.md) -- RFC 5322 threading via `In-Reply-To` and `References`
- [`migrations.md`](./docs/migrations.md) -- Database migration workflow
- [`newsletters.md`](./docs/newsletters.md) -- Mailing lists, subscribers, campaigns, and broadcast audit
- [`adapters.md`](./docs/adapters.md) -- How adapters connect core to external services

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the wider framework overview and package list.

## License

MIT
