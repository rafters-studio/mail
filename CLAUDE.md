# @rafters/mail -- Email Inbox Framework for the Edge

ActionMailbox for Cloudflare Workers. Inbound ingestion, outbound sending, threading, classification, folder/label management, team collaboration, and blob storage -- designed for SQLite-based edge databases (D1, Turso, libSQL) with blob storage (R2, S3).

## Package Architecture

Six packages. Core has zero vendor dependencies. Every external concern is an adapter.

| Package | npm name | Purpose |
|---|---|---|
| packages/core | @rafters/mail | Schema, types, service interfaces, threading logic |
| packages/resend | @rafters/mail-resend | Outbound email via Resend API (fetch, no SDK) |
| packages/cloudflare | @rafters/mail-cloudflare | Inbound via Email Routing, R2 blob storage |
| packages/react-email | @rafters/mail-react-email | React Email templates + renderer |
| packages/workers-ai | @rafters/mail-workers-ai | DeBERTa-v3 zero-shot classifier |
| packages/better-auth-resend | @rafters/better-auth-resend | emailOTP glue (thin, one function) |

## Dependency Chain

```
#1 Schema -> #2 Interfaces -> adapters (#6, #7, #8, #9) -> #10 better-auth-resend -> #14 integration
         -> #3 Threading  -^
         -> #4 Migrations
         -> #5 Auth Adapter
         -> #11 Newsletter Schema
         -> #13 Service Implementations
```

## Design Principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written interfaces first.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, React Email, or Workers AI deps in core.
3. **Drizzle for queries, wrangler owns migrations.** Export raw SQL strings. Never run drizzle-kit push/migrate.
4. **Plain text user references.** ownerId, assigneeId, etc. are `text` columns with no FK to external auth tables.
5. **Platform vocabulary.** MailingList (not Audience), Subscriber (not Contact), Campaign (not Broadcast). Vendor terms only inside adapter implementations.
6. **Factory pattern for adapters.** Use factory functions that return interface implementations, not classes. Example: `createResendProvider(config)` not `new ResendProvider(config)`.
7. **Ship what we use.** Initial adapters cover Cloudflare + Resend + React Email + Workers AI because that runs in production.

## Code Conventions

- pnpm only (never npm/yarn)
- No emoji in code, comments, or commits
- No `any` -- use `unknown` and narrow
- Biome for linting/formatting
- UUIDv7 for all identifiers
- Zod validates at system boundaries. Trust internal code.
- TypeScript 5.9, Vitest 4, Zod 4

## Testing

- `.test.ts` files only (unit tests with Vitest)
- Zocker for mock data from Zod schemas
- Tests live in `tests/` mirroring source tree, never colocated
- One behavior per `it()` block. Name as a sentence.

## V1 Source Reference

Extract code from: `/Volumes/store/projects/ezmode-games/platform-v1/apps/api/src/lib/email/`

Related files:
- `lib/db/schema/inbox.sql.ts` -- Drizzle inbox tables
- `lib/db/schema/email.sql.ts` -- Drizzle newsletter tables
- `lib/db/schema/inbox.zod.ts` -- Zod schemas
- `lib/db/schema/email.zod.ts` -- Zod newsletter schemas
- `lib/services/inbox-email.service.ts` -- Threading, compose, reply
- `lib/services/verification-email.service.ts` -- OTP sending
- `lib/email/classifier.ts` -- AI classification
- `lib/email/resend.service.ts` -- Resend API wrapper (renamed from resend.provider.ts)
- `lib/email/provider.ts` -- ResendProvider
- `lib/email/mock.provider.ts` -- Mock for testing
- `lib/email/provider.schema.ts` -- Resend API types
- `lib/email/templates/` -- React Email templates
- `workflows/classify-email.ts` -- Classification workflow
- `queues/email-classify.ts` -- Queue consumer
- `middleware/mailbox-access.ts` -- Auth middleware

## Open Design Questions

These need Sean's input before implementation:

1. Should newsletter schema be in core or a separate `@rafters/mail-broadcast` package?
2. Should MockEmailProvider live in resend package or separate `@rafters/mail-test-utils`?
3. How much of ClassifyEmailWorkflow is extractable vs app-specific?
4. Should core export a `createMailService()` factory that wires everything together?
5. Should EmailProvider interface split transactional from broadcast (`BroadcastProvider`)?
6. Migration versioning story: export diffs between versions or full schema only?
