# @rafters/mail

Email inbox framework for the edge. Inbound ingestion, outbound sending, threading, classification, folder/label management, team collaboration, and blob storage.

## The problem

There is no open-source email inbox framework for edge and serverless runtimes.

Teams building on Cloudflare Workers, AWS Lambda, Deno Deploy, Vercel Edge, or any other modern runtime have two options: build it from scratch, or bolt on a third-party SaaS inbox that owns their data.

## What this is

ActionMailbox for the edge. Ten packages. Core has zero vendor dependencies -- only `uuidv7` and `zod`. Every external concern, including the ORM, is an adapter you can swap.

```
@rafters/mail                 Core: Zod row schemas, validators, interfaces, threading, migration SQL
@rafters/mail-drizzle         Drizzle adapter: table definitions + service implementations
@rafters/mail-resend          Outbound email via Resend API + webhook handler
@rafters/mail-cloudflare      Inbound via Email Routing, R2 blob storage, email parsing
@rafters/mail-react-email     React Email templates (BaseEmail, OtpEmail) + renderer
@rafters/mail-workers-ai      DeBERTa-v3 zero-shot email classifier + priority/tagging
@rafters/better-auth-resend   emailOTP glue for better-auth
@rafters/mail-imap            IMAP4rev1 protocol layer: command handlers, adapters, session state
@rafters/mail-imap-cloudflare Durable Object runtime for mail-imap (WebSocket, hibernation)
@rafters/mail-imap-server     Node TCP/TLS runtime for mail-imap (Fly, Railway, Fargate, VPS)
```

## What core gives you

**13 tables** described as Zod row schemas + raw SQL migrations. Drizzle table definitions live in `@rafters/mail-drizzle`; consumers using a different ORM bring their own.

- Mailboxes (personal and shared/team)
- Folders (system + custom, per-mailbox)
- Labels (system, AI-generated, user-created, many-to-many on messages and threads)
- Threads (RFC 5322 conversation grouping, status, priority)
- Messages (envelope data, AI classification fields, blob storage keys)
- Attachments (metadata in DB, content in blob storage)
- Assignments (thread-level, for shared mailbox collaboration)
- Notes (internal thread notes, markdown, not visible to external parties)
- Platform audiences, subscribers, broadcast audit (newsletter/broadcast)

**Zod validators** for every API boundary operation. Types inferred from schemas, never hand-written.

**Service interfaces** for thread management, folder CRUD, label application, assignments, notes, and compose/reply with RFC 5322 header generation. Implementations live in ORM adapter packages -- ship Drizzle today, Kysely or Prisma later without touching core.

**Adapter interfaces** that decouple core from any vendor:

| Interface        | Purpose                                                | Ships with                   |
| ---------------- | ------------------------------------------------------ | ---------------------------- |
| ORM              | Table definitions + query/mutation service factories   | @rafters/mail-drizzle        |
| EmailProvider    | Send email, manage mailing lists/subscribers/campaigns | @rafters/mail-resend         |
| BlobStorage      | Store/retrieve raw email and parsed bodies             | @rafters/mail-cloudflare     |
| EmailClassifier  | Classify email content into categories                 | @rafters/mail-workers-ai     |
| TemplateRenderer | Render email templates to HTML/text                    | @rafters/mail-react-email    |
| AuthAdapter      | Resolve user identity and access control               | App-specific (you implement) |
| InboundAdapter   | Receive email from external sources                    | @rafters/mail-cloudflare     |

## Design principles

1. **Zod is source of truth.** Types inferred via `z.infer<>`, never hand-written interfaces first.
2. **Zero vendor lock-in in core.** No Resend, Cloudflare, React Email, Workers AI, or Drizzle dependencies in core. Runtime deps are `uuidv7` and `zod`.
3. **ORM-neutral.** Core describes the schema as Zod row schemas + raw SQL migrations. Drizzle tables and service implementations live in `@rafters/mail-drizzle`. Other ORM adapters can slot in identically.
4. **Plain text user references.** `ownerId`, `assigneeId`, `authorId` are text columns with no FK to external auth tables. Works with any auth system.
5. **Platform vocabulary.** MailingList (not Audience), Subscriber (not Contact), Campaign (not Broadcast). Vendor terms stay inside adapters.
6. **Factory pattern for adapters.** `createResendProvider(config)` not `new ResendProvider(config)`.
7. **Ship what we use.** Initial adapters cover Cloudflare + Resend + React Email + Workers AI because that is what runs in production.
8. **No barrel files.** Subpath exports in package.json for edge bundle size. Import only what you need.

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
pnpm add @rafters/mail @rafters/mail-drizzle
```

```typescript
// Validators, types, and Zod row schemas (ORM-neutral, from core)
import { composeEmailSchema, listThreadsSchema } from "@rafters/mail/schema";
import type { Thread, Folder, Label, ComposeEmail } from "@rafters/mail";

// Threading helpers (pure functions, in core)
import { generateMessageId, buildReferences } from "@rafters/mail/threading";

// Auth adapter interface (in core)
import type { AuthAdapter } from "@rafters/mail/auth";

// Drizzle table definitions and service implementations (from the ORM adapter)
import {
  mailbox,
  inboxThread,
  inboxMessage,
  createMailServices,
  createInboxEmailService,
} from "@rafters/mail-drizzle";
```

Add adapters for your stack:

```bash
pnpm add @rafters/mail-resend        # Outbound via Resend
pnpm add @rafters/mail-cloudflare    # Inbound via CF Email Routing + R2
pnpm add @rafters/mail-react-email   # Email templates
pnpm add @rafters/mail-workers-ai    # AI classification
```

```typescript
// Resend outbound
import { createResendProvider } from "@rafters/mail-resend";
import { createMockEmailProvider } from "@rafters/mail-resend/mock";
import { createResendWebhookHandler } from "@rafters/mail-resend/webhooks";

// Cloudflare inbound + storage
import { createR2Storage } from "@rafters/mail-cloudflare/storage";
import { parseEmailHeaders, hashContent } from "@rafters/mail-cloudflare/parsing";

// React Email templates
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OtpEmail } from "@rafters/mail-react-email/otp";

// Workers AI classifier
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";
import { DEFAULT_TAG_PATTERNS } from "@rafters/mail-workers-ai/config";

// better-auth OTP glue
import { resendOTP } from "@rafters/better-auth-resend";
```

## IMAP

Standard email clients (Apple Mail, Thunderbird, Outlook, K-9 Mail) connect directly over IMAP4rev1 on port 993. No local proxy, no polling, no mailbox-service shim.

```
@rafters/mail-imap              Transport-agnostic IMAP4rev1 protocol layer
@rafters/mail-imap-cloudflare   Cloudflare Durable Object runtime (WebSocket, hibernation)
@rafters/mail-imap-server       Node TCP/TLS runtime (Fly, Railway, Fargate, Docker, VPS)
```

The protocol layer is vendor-free: command handlers (CAPABILITY, LOGIN, SELECT, FETCH, STORE, SEARCH, EXPUNGE, IDLE, COPY, MOVE, APPEND, UNSELECT, UID), session state machine, UID mapping, and adapter interfaces (AuthAdapter, MailboxAdapter, MessageAdapter, ExtensionAdapter). Two runtimes ship today: a Durable Object adapter that hibernates IDLE sessions for near-zero cost, and a Node TCP server for any runtime where Node runs.

You bring the auth adapter. The framework does not own credential storage, hashing, or app-password generation -- that stays in your auth system (better-auth, Clerk, Supabase Auth, whatever).

## Status

All packages implemented. 634 tests across 38 files. CI in place.

| Package                       | Status                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| @rafters/mail                 | Zod row schemas, validators, interfaces, threading, migrations, auth adapter |
| @rafters/mail-drizzle         | Drizzle table definitions + 6 service implementations                        |
| @rafters/mail-resend          | ResendService, createResendProvider, MockEmailProvider, webhook handler      |
| @rafters/mail-cloudflare      | R2 storage adapter, RFC 5322 email parsing, content hashing                  |
| @rafters/mail-react-email     | BaseEmail, OtpEmail templates, createReactEmailRenderer                      |
| @rafters/mail-workers-ai      | DeBERTa-v3 classifier, priority determination, auto-tagging                  |
| @rafters/better-auth-resend   | resendOTP() one-line integration for emailOTP plugin                         |
| @rafters/mail-imap            | IMAP4rev1 protocol layer: parser, formatter, session, commands, adapters     |
| @rafters/mail-imap-cloudflare | Durable Object runtime with hibernation and inbound-signal bridge            |
| @rafters/mail-imap-server     | Node TCP/TLS runtime with TLS-terminating-proxy mode                         |

## Contributing

```bash
git clone https://github.com/rafters-studio/mail.git
cd mail
pnpm install
pnpm test          # Unit + integration tests (vitest)
pnpm lint          # oxlint
pnpm format        # oxfmt
pnpm format:check  # Verify formatting
pnpm typecheck     # tsc
```

## License

MIT
