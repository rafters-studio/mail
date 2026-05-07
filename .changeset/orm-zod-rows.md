---
"@rafters/mail": minor
---

Add Zod row schemas for all 13 tables (`mailboxRowSchema`, `inboxThreadRowSchema`, etc.) as the ORM-neutral source of row types. `Thread`, `Folder`, `Label`, `Assignment`, `Note` types now derive from Zod via `z.infer`, removing the `drizzle-orm` import from `interfaces/services.ts`. Phase 0+1 of the ORM abstraction (#88). Drizzle still provides the table definitions and runtime services in core; later phases extract those to `@rafters/mail-drizzle`.
