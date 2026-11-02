# @rafters/mail

Writes email messages as exact bytes every client reads: addresses, Message-IDs, documents and MIME.

## Package Architecture

Version 0.3.0: the writer, receiving, one template plugin and the Cloudflare receiving adapter. Core depends only on `zod`.

| Package               | npm name                   | Purpose                                                  |
| --------------------- | -------------------------- | -------------------------------------------------------- |
| packages/core         | @rafters/mail              | The writer: messages as RFC 5322 / MIME bytes; receiving |
| packages/cloudflare   | @rafters/mail-cloudflare   | Receive on Cloudflare Email Routing, R2 and D1           |
| packages/react-email  | @rafters/mail-react-email  | React Email templates rendered as `{ html, text }`       |
| packages/test-readers | @rafters/mail-test-readers | Private: reads written messages back, for the tests      |

Parsing, threading, classification and IMAP are not built. The 0.1.0 packages that claimed them were removed; they remain in git history at the `v0.1.0` tag.

## Design Principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written interfaces first.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, React Email, or Workers AI deps in core.
3. **Wrangler owns migrations, as `.sql` files a package ships; queries are written with D1's `prepare` and `bind`.**
4. **Plain text user references.** ownerId, assigneeId, etc. are `text` columns with no FK to external auth tables.
5. **Platform vocabulary.** MailingList (not Audience), Subscriber (not Contact), Campaign (not Broadcast). Vendor terms only inside adapter implementations.
6. **Factory pattern for adapters.** Use factory functions that return interface implementations, not classes. Example: `createResendProvider(config)` not `new ResendProvider(config)`.
7. **Ship what we use.** Initial adapters cover Cloudflare + Resend + React Email + Workers AI because that runs in production.

## Code Conventions

- pnpm only (never npm/yarn)
- No emoji in code, comments, or commits
- No `any` -- use `unknown` and narrow
- oxlint for linting, oxfmt for formatting -- never Biome
- UUIDv7 for all identifiers
- Zod validates at system boundaries. Trust internal code.
- TypeScript 5.9, Vitest 4, Zod 4
- No barrel files. Use subpath exports in package.json for edge bundle size. Consumers import from specific paths, not a barrel that pulls the entire module graph.

## Testing

Three-tier testing, all in `tests/` mirroring source tree (never colocated):

| Tier     | Runner         | Pattern     | Purpose                                 |
| -------- | -------------- | ----------- | --------------------------------------- |
| Unit     | vitest         | `*.test.ts` | Pure logic, schemas, services           |
| Behavior | vitest-browser | `*.spec.ts` | Browser behavior, component interaction |
| E2E      | playwright     | e2e tests   | Full integration flows                  |

- Zocker for mock data from Zod schemas
- One behavior per `it()` block. Name as a sentence.
- Constructor mocks use `class` syntax: `vi.fn(class )` not arrow functions (Vitest 4)
- Use `mockReset()` not `clearAllMocks()` for mocks with rejection overrides

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
