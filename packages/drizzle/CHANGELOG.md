# @rafters/mail-drizzle

## 0.1.0

### Minor Changes

- [#94](https://github.com/rafters-studio/mail/pull/94) [`87522ed`](https://github.com/rafters-studio/mail/commit/87522ed398169773c17320437a0c0f65c4912caf) Thanks [@ssilvius](https://github.com/ssilvius)! - Extract Drizzle out of `@rafters/mail` core into a new `@rafters/mail-drizzle` package. Phase 2 of the ORM abstraction ([#88](https://github.com/rafters-studio/mail/issues/88)). **Breaking.**

  Core (`@rafters/mail`) now has zero `drizzle-orm` imports and ships only `uuidv7 + zod` as runtime dependencies. It still exports the schema (Zod row schemas, validators, enums), service interfaces, threading helpers, auth adapter interface, and migration SQL.

  `@rafters/mail-drizzle` (new) exports the Drizzle table definitions (`mailbox`, `inboxThread`, ...), the newsletter tables (`platformAudience`, `platformSubscriber`, `broadcastAudit`), and all six service factories (`createMailServices`, `createInboxEmailService`, `createThreadService`, `createFolderService`, `createLabelService`, `createAssignmentService`, `createNoteService`).

  Migration for consumers using Drizzle: change `import { ..., createMailServices } from "@rafters/mail"` to `import { ..., createMailServices } from "@rafters/mail-drizzle"`. Schema imports move from `@rafters/mail/schema` (table values) to `@rafters/mail-drizzle`. Type-only imports for `Thread`, `Folder`, etc. continue to come from `@rafters/mail`. The `@rafters/mail/services` subpath is removed.

  Future `@rafters/mail-kysely` or `@rafters/mail-prisma` adapters can now slot in the same way without touching core.

### Patch Changes

- [#95](https://github.com/rafters-studio/mail/pull/95) [`50a2f58`](https://github.com/rafters-studio/mail/commit/50a2f5883fe374f8f4e44f43cd4d9fa0150754a3) Thanks [@ssilvius](https://github.com/ssilvius)! - Documentation update for the ORM abstraction split (Phase 3 of [#88](https://github.com/rafters-studio/mail/issues/88)). Top-level README, getting-started, and architecture docs updated to reflect ten packages, the @rafters/mail-drizzle adapter package, and the ORM-neutral core surface. New README in @rafters/mail-drizzle. Resend outbound doc fixes the @rafters/mail/services subpath reference. Includes a migration guide section in architecture.md for consumers updating from pre-extraction layouts.

- Updated dependencies [[`13d4c9d`](https://github.com/rafters-studio/mail/commit/13d4c9d52090681b0f454dbced70020d85ba9f37), [`50a2f58`](https://github.com/rafters-studio/mail/commit/50a2f5883fe374f8f4e44f43cd4d9fa0150754a3), [`87522ed`](https://github.com/rafters-studio/mail/commit/87522ed398169773c17320437a0c0f65c4912caf), [`66839c8`](https://github.com/rafters-studio/mail/commit/66839c8aa77bcd8e950dddb1924dd63ad2c60108)]:
  - @rafters/mail@0.1.0
