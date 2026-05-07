# @rafters/mail-drizzle

Drizzle ORM adapter for [@rafters/mail](https://www.npmjs.com/package/@rafters/mail). Ships the Drizzle table definitions for all 13 tables and the service implementations that satisfy the core service interfaces.

Pair this with `@rafters/mail`. Other ORM adapters (`@rafters/mail-kysely`, `@rafters/mail-prisma`) can slot in identically without touching core.

## Install

```bash
pnpm add @rafters/mail @rafters/mail-drizzle
```

## What you get

- **Table definitions** for all 10 inbox tables (`mailbox`, `inboxFolder`, `inboxThread`, `inboxMessage`, `inboxMessageLabel`, `inboxThreadLabel`, `inboxAttachment`, `threadAssignment`, `threadNote`, `inboxLabel`)
- **Newsletter tables** (`platformAudience`, `platformSubscriber`, `broadcastAudit`) -- consumer opt-in
- **Service factories** for thread, folder, label, assignment, note management plus the `InboxEmailService` for compose/reply
- **`createMailServices(db)`** -- wires every service interface in one call

## Usage

```typescript
import { drizzle } from "drizzle-orm/d1";
import {
  mailbox,
  inboxThread,
  createMailServices,
  createInboxEmailService,
} from "@rafters/mail-drizzle";

// Wire the services to a Drizzle DB instance
const db = drizzle(env.DB);
const services = createMailServices(db);

await services.threads.listThreads(mailboxId);
await services.folders.initSystemFolders(mailboxId);

// Compose/reply needs additional adapters
const emailService = createInboxEmailService({
  db,
  blobStorage, // BlobStorage from @rafters/mail-cloudflare or your own
  emailProvider, // EmailProvider from @rafters/mail-resend or your own
});
```

## Subpath exports

Import only what you need. Each subpath ships independently for tree-shaking:

```typescript
import { mailbox, inboxThread } from "@rafters/mail-drizzle/tables";
import { platformAudience } from "@rafters/mail-drizzle/newsletter";
import { createMailServices } from "@rafters/mail-drizzle/services";
```

The package's main entry re-exports everything for convenience.

## Migrations

This package does not own migrations. Apply the SQL from `@rafters/mail/migrations` to your database with your own tooling (`wrangler d1 migrations apply`, etc.). The Drizzle table definitions in this package match the SQL exactly so you can write type-safe queries against the migrated schema.

## Why a separate package?

Core describes the schema as Zod row schemas (the shape of every SELECT row) and raw SQL. ORM-specific code -- table builders, query DSL, service implementations -- lives in adapter packages so consumers using a different query layer are not forced to install Drizzle. See [the architecture doc](https://github.com/rafters-studio/mail/blob/main/docs/architecture.md#orm-adapters) for the full rationale.

## License

MIT
