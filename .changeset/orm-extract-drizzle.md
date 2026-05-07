---
"@rafters/mail": minor
"@rafters/mail-drizzle": minor
---

Extract Drizzle out of `@rafters/mail` core into a new `@rafters/mail-drizzle` package. Phase 2 of the ORM abstraction (#88). **Breaking.**

Core (`@rafters/mail`) now has zero `drizzle-orm` imports and ships only `uuidv7 + zod` as runtime dependencies. It still exports the schema (Zod row schemas, validators, enums), service interfaces, threading helpers, auth adapter interface, and migration SQL.

`@rafters/mail-drizzle` (new) exports the Drizzle table definitions (`mailbox`, `inboxThread`, ...), the newsletter tables (`platformAudience`, `platformSubscriber`, `broadcastAudit`), and all six service factories (`createMailServices`, `createInboxEmailService`, `createThreadService`, `createFolderService`, `createLabelService`, `createAssignmentService`, `createNoteService`).

Migration for consumers using Drizzle: change `import { ..., createMailServices } from "@rafters/mail"` to `import { ..., createMailServices } from "@rafters/mail-drizzle"`. Schema imports move from `@rafters/mail/schema` (table values) to `@rafters/mail-drizzle`. Type-only imports for `Thread`, `Folder`, etc. continue to come from `@rafters/mail`. The `@rafters/mail/services` subpath is removed.

Future `@rafters/mail-kysely` or `@rafters/mail-prisma` adapters can now slot in the same way without touching core.
