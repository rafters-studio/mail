# @rafters/mail Architecture

Technical reference for the internal design of @rafters/mail, an edge-native email inbox framework.

This document covers the type system, data model, adapter boundaries, data flows, and package structure. Read this before contributing or building adapters.

---

## The gap

There is no open-source email inbox framework for edge/serverless runtimes. ActionMailbox (Rails) covers inbound ingestion only, roughly 15% of the surface needed for a production inbox. It does not handle outbound sending, threading, classification, folder/label management, team collaboration, or blob storage.

Chatwoot has an open GitHub issue for Cloudflare Email Workers support. They cannot add it. Their architecture assumes a traditional server runtime with persistent processes, background jobs, and a PostgreSQL database.

@rafters/mail fills this gap. Inbound, outbound, threading, classification, folders, labels, team collaboration, and blob storage. All designed for SQLite-based edge databases (D1, Turso, libSQL) with object storage (R2, S3).

---

## Architecture principles

### 1. Zod is the source of truth for all types

Every data structure starts as a Zod schema. TypeScript types are derived via `z.infer<>`. No handwritten interfaces for data shapes. This gives three things at once: static types, runtime validation at system boundaries, and mock generation with Zocker for tests.

```typescript
// This is how types are defined. Always.
const threadStatusSchema = z.enum(['open', 'pending', 'resolved', 'closed']);
type ThreadStatus = z.infer<typeof threadStatusSchema>;

// Never this.
interface ThreadStatus { ... }
```

### 2. Zero vendor lock-in in core

`@rafters/mail` has zero dependencies on Resend, Cloudflare, React Email, or Workers AI. Every external concern is an adapter in a separate package. The core defines interfaces. Adapters implement them.

### 3. Drizzle for schema, wrangler owns migrations

The core exports Drizzle table definitions for type-safe queries and raw SQL for migration files. The package never runs `drizzle-kit push` or `drizzle-kit migrate`. Apps copy migration SQL into wrangler-managed migration files and apply them with `wrangler d1 migrations apply`.

### 4. User references are plain text

All user ID columns (`ownerId`, `assigneeId`, `assignedBy`, `authorId`, `appliedBy`) are plain `text` with no foreign key constraints. The `AuthAdapter` interface resolves user identity at runtime. This means the mail schema works with any auth system: better-auth, Lucia, Clerk, a custom JWT, anything.

### 5. Ship what we use

Initial adapters cover Cloudflare Workers + Resend + React Email + Workers AI because that stack runs in production. No speculative adapters. Community contributors can add Postmark, Mailgun, SES, Deno KV, S3, and whatever else they run.

### 6. Platform vocabulary over vendor vocabulary

Internal code uses platform terms. Vendor terms only appear inside adapter implementations.

| Platform term | Vendor term (Resend) |
| ------------- | -------------------- |
| MailingList   | Audience             |
| Subscriber    | Contact              |
| Campaign      | Broadcast            |

### 7. No barrel files

Edge runtimes have bundle size constraints. Workers enforces a 1MB compressed limit. Barrel exports (`index.ts` re-exporting everything) pull the entire module graph into every consumer. All packages use subpath exports in `package.json` so consumers import exactly what they need.

```typescript
// Correct: subpath imports, scoped to what you use
import { createResendProvider } from "@rafters/mail-resend";
import { createR2Storage } from "@rafters/mail-cloudflare/storage";
import { createImapDurableObject } from "@rafters/mail-imap-cloudflare";

// Wrong: would pull the entire module graph into the bundle
import { createResendProvider, createR2Storage } from "@rafters/mail";
```

---

## Package structure

Nine packages. Core has zero vendor dependencies.

```
@rafters/mail                    Core: schema, types, interfaces, threading
@rafters/mail-resend             Outbound adapter (Resend API via raw fetch)
@rafters/mail-cloudflare         Inbound adapter (CF Email Routing) + R2 blob storage
@rafters/mail-react-email        Template renderer (React Email, registry pattern)
@rafters/mail-workers-ai         Classifier (Workers AI, DeBERTa-v3)
@rafters/better-auth-resend      Glue: wires Resend + React Email into better-auth OTP

@rafters/mail-imap               IMAP4rev1 protocol layer (transport-agnostic)
@rafters/mail-imap-cloudflare    IMAP runtime on Cloudflare Durable Objects
@rafters/mail-imap-server        IMAP runtime as a Node TCP/TLS server
```

Dependency graph:

```
@rafters/mail  <--  @rafters/mail-resend
               <--  @rafters/mail-cloudflare
               <--  @rafters/mail-react-email
               <--  @rafters/mail-workers-ai
               <--  @rafters/mail-imap

@rafters/mail-resend + @rafters/mail-react-email  <--  @rafters/better-auth-resend

@rafters/mail-imap  <--  @rafters/mail-imap-cloudflare
                    <--  @rafters/mail-imap-server
```

Every core adapter depends only on `@rafters/mail`. The IMAP runtime adapters depend on `@rafters/mail-imap` (the protocol layer) rather than on core directly, which keeps the protocol surface independent of the database schema. The `better-auth-resend` glue is the only non-IMAP package with two workspace dependencies.

---

## Data model

### Schema: 10 inbox tables + 3 newsletter tables

All IDs are UUIDv7 via `$defaultFn`. All timestamps use `integer` with `mode: 'timestamp_ms'` and `unixepoch('subsecond') * 1000` defaults (the D1/SQLite pattern). All tables have soft delete via `deletedAt`. JSON columns use SQLite text with `mode: 'json'`.

#### Inbox tables

| Table                 | Purpose                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `mailbox`             | Email addresses that send/receive. Personal (one owner) or shared (team).                  |
| `inbox_folder`        | System folders + custom folders. Per-mailbox.                                              |
| `inbox_label`         | System, AI-generated, and user-created labels. Per-mailbox.                                |
| `inbox_thread`        | Conversation grouping. Subject, snippet, participants, folder, status, priority.           |
| `inbox_message`       | Individual messages. RFC 5322 headers, envelope data, AI classification fields, blob keys. |
| `inbox_message_label` | Many-to-many: message to label. Tracks who/what applied the label.                         |
| `inbox_thread_label`  | Many-to-many: thread to label. Thread-level filtering.                                     |
| `inbox_attachment`    | Attachment metadata. Content in blob storage. Supports inline (Content-ID) and regular.    |
| `thread_assignment`   | Thread assignment for shared mailbox collaboration. Status: active/completed/reassigned.   |
| `thread_note`         | Internal notes on threads. Markdown. Not visible to external parties.                      |

#### Newsletter tables

| Table                 | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `platform_audience`   | Platform-wide mailing lists.                                               |
| `platform_subscriber` | User subscriptions to audiences.                                           |
| `broadcast_audit`     | Compliance trail: who sent what, when, to which audience, recipient count. |

The email provider (Resend) is the source of truth for subscriber data. The local tables store the registry, mappings, and provider sync identifiers. Subscriber email addresses, unsubscribe status, and campaign content live in the provider.

### System folders

Every mailbox gets six immutable system folders on creation:

| Slug      | Purpose                                  |
| --------- | ---------------------------------------- |
| `inbox`   | Default landing folder for inbound email |
| `sent`    | Outbound emails                          |
| `drafts`  | Unsent drafts                            |
| `spam`    | AI-classified or manually flagged spam   |
| `trash`   | Soft-deleted, auto-purge after 30 days   |
| `archive` | Archived conversations                   |

Custom folders can be created per-mailbox.

### Label types

Three kinds:

- **System labels**: `important`, `starred`, `unread`. Immutable.
- **AI-generated labels**: created by the classifier. `isAiGenerated = true`. Based on regex patterns (e.g., `bug-report`, `feature-request`).
- **User-created labels**: custom tags created by staff.

Labels are many-to-many on both messages and threads. Junction tables track who applied the label and when. Null `appliedBy` means system or AI.

### Zod schema layer

Every table has corresponding Zod schemas:

- **Insert schemas** for creating records
- **Select schemas** for reading records
- **Update schemas** for partial updates
- **Enum schemas**: `mailboxTypeSchema`, `threadStatusSchema`, `threadPrioritySchema`, `aiCategorySchema`, `systemFolderSchema`

Types are always inferred:

```typescript
type ThreadStatus = z.infer<typeof threadStatusSchema>;
type InboxMessage = z.infer<typeof inboxMessageSelectSchema>;
```

---

## Adapter interfaces

All adapter interfaces are defined as Zod schemas in `@rafters/mail`. Types are inferred. Adapter packages implement the interfaces.

### EmailProvider (outbound)

Sends email. Manages mailing lists, subscribers, and campaigns.

```typescript
interface EmailProvider {
  sendEmail(params: EmailParams): Promise<{ id: string }>;
  createMailingList(name: string): Promise<MailingList>;
  addSubscriber(listId: string, email: string, data?: SubscriberData): Promise<Subscriber>;
  sendCampaign(params: CampaignParams): Promise<{ id: string }>;
  // + getMailingList, removeSubscriber, listSubscribers, campaign draft flow, etc.
}
```

Implementation: `@rafters/mail-resend` (Resend API via raw `fetch`, no SDK dependency).

### InboundAdapter

Receives email from an external source, stores it.

```typescript
interface InboundAdapter {
  handleIncoming(email: InboundEmail): Promise<{ messageId: string; threadId: string }>;
}
```

Implementation: `@rafters/mail-cloudflare` (Cloudflare Email Routing).

### BlobStorage

Stores and retrieves raw email content and parsed bodies.

```typescript
interface BlobStorage {
  put(key: string, content: string | ArrayBuffer, options?: BlobPutOptions): Promise<void>;
  get(key: string, options?: BlobGetOptions): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  generateKey(contentHash: string, extension: string): string;
}
```

Key format: `emails/{year}/{month}/{sha256-first-16-chars}.{eml|html|txt}` (month is zero-padded)

Implementation: `@rafters/mail-cloudflare` (R2).

### TemplateRenderer

Renders email templates to HTML and plain text.

```typescript
interface TemplateRenderer {
  render(
    template: string,
    props: Record<string, unknown>,
  ): Promise<{ html: string; text?: string }>;
}
```

Implementation: `@rafters/mail-react-email`.

### EmailClassifier

Classifies email content into categories with confidence scores.

```typescript
interface EmailClassifier {
  classify(from: string, subject: string, body: string): Promise<EmailClassification>;
}
```

Where `EmailClassification` is:

```typescript
const emailClassificationSchema = z.object({
  category: z.enum([
    "support",
    "feedback",
    "abuse",
    "partnership",
    "spam",
    "billing",
    "legal",
    "other",
  ]),
  confidence: z.number().min(0).max(100),
  tags: z.array(z.string()),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});
```

Implementation: `@rafters/mail-workers-ai` (DeBERTa-v3 zero-shot on Workers AI).

### AuthAdapter

Resolves user identity and mailbox access. App-provided, no default implementation.

```typescript
interface AuthAdapter {
  getCurrentUser(): Promise<InboxUser>;
  getUserById(id: string): Promise<InboxUser | null>;
  hasMailboxAccess(userId: string, mailboxId: string): Promise<boolean>;
  getUserRole(userId: string, mailboxId: string): Promise<InboxRole | null>;
}
```

Roles: `owner`, `admin`, `agent`, `viewer`.

---

## Data flows

### Inbound flow

An email arrives from the outside world and the consumer's Email Worker composes the building blocks from `@rafters/mail-cloudflare` to land it in the inbox. The framework does NOT ship a pre-baked `handleInboundEmail` because steps 5-8 depend on consumer-specific schema extensions, auth context, and pipeline topology.

```
External sender
  |
  v
Cloudflare Email Routing
  |
  v
Consumer's Email Worker
  |
  +---> [1] Read raw bytes: new Response(message.raw).arrayBuffer()
  |
  +---> [2] parseEmailHeaders(...) from @rafters/mail-cloudflare/parsing
  |         Returns: from, to, subject, messageId, inReplyTo, references, date
  |
  +---> [3] hashContent(raw) for a SHA-256 content hash
  |
  +---> [4] createR2Storage + storage.put(key, raw) for the raw .eml
  |         Key: emails/{year}/{month-zero-padded}/{contentHash}.eml
  |         Parsed HTML + text blobs are optional.
  |
  +---> [5] Consumer-written: insert metadata row in inbox_message
  |         Drizzle queries against your D1 binding.
  |         Columns: subject, from/to, blob keys, isOutbound=false
  |
  +---> [6] Consumer-written: thread matching
  |         Look up inReplyTo against existing inbox_message.messageIdHeader
  |         If no match, walk the References header
  |         If still no match, create a new thread
  |         Update snippet (generateSnippet) and participant list
  |
  +---> [7] Consumer-written: dispatch to classification
  |         Inline, queue, or workflow -- your latency and cost choice.
  |
  +---> [8] Wake IDLE clients
            DO runtime:   POST /notify?count=N against the mailbox DO
            Node runtime: server.notify(mailboxId, newTotal)
```

The raw `.eml` is the source of truth. D1 stores parsed metadata for fast queries. If metadata is ever wrong, it can be re-derived from the raw email in blob storage.

### Outbound flow

A user replies to a thread or composes a new email.

```
App calls InboxEmailService.replyToThread() or composeEmail()
  |
  +---> [1] Look up thread and latest message
  |
  +---> [2] Generate Message-ID: <uuidv7@domain>
  |
  +---> [3] Set In-Reply-To to latest message's Message-ID
  |         Append to References chain (RFC 5322)
  |
  +---> [4] Render template via TemplateRenderer
  |         Pass props (brandName, logoUrl, content, etc.)
  |         Returns { html, text }
  |
  +---> [5] Send via EmailProvider (Resend adapter)
  |         Provider returns { id }
  |
  +---> [6] Store outbound message in D1
  |         isOutbound=true, blob keys for raw RFC 822 content
  |         Store rendered content in blob storage
  |
  +---> [7] Update thread
            Set snippet to first 200 chars of plain text
            Update participant list with any new addresses
            Move to sent folder if new compose, keep in current folder if reply
```

### Classification flow

Steps 1-4 happen inside `createWorkersAIClassifier` from `@rafters/mail-workers-ai`. Steps 5-8 are consumer-written: the classifier returns an `EmailClassification` object, and the consumer decides how to persist it, which folder a spam message moves to, and how labels are applied.

```
Consumer's classification step (inline or async)
  |
  +---> [1] Fetch the first 4KB of message body from blob storage
  |         (via your BlobStorage adapter). Truncation is intentional --
  |         classification does not need the full body. 4KB covers
  |         subject + opening content.
  |
  +---> [2] classifier.classify(from, subject, body)
  |         Internally:
  |           - Zero-shot classify with Workers AI model
  |             @cf/microsoft/deberta-v3-base-zeroshot-v1.1-all-33
  |           - Labels: support, feedback, abuse, partnership, spam,
  |             billing, legal, other
  |           - Priority rules: abuse/legal -> high; urgent keywords
  |             (urgent, emergency, asap, immediately, critical,
  |             broken, down, outage) -> urgent; high keywords
  |             (important, priority, help, issue, problem, error,
  |             bug, crash) -> high; support/billing -> normal; rest -> low
  |           - Regex-based tag extraction against default patterns
  |             (installation, bug-report, feature-request, account,
  |             billing) merged with consumer's ClassifierConfig.tagPatterns
  |         Returns: { category, confidence (0-100), tags[], priority }
  |
  +---> [3] Consumer-written: update the inbox_message row
  |         Set aiCategory, aiConfidence, isSpam.
  |         Update the thread's priority if you derive it from
  |         classification.
  |
  +---> [4] Consumer-written: optional spam handling
  |         If classification.category === 'spam', move the thread to
  |         the spam folder via FolderService.
  |
  +---> [5] Consumer-written: optional label application
            Find-or-create labels from classification.tags and insert
            into inbox_message_label with appliedBy=null to indicate
            AI-applied.
```

Steps 1 and 3-5 are consumer code because fetch semantics, schema extensions, and label policy are all application decisions. The classifier is a pure function.

The classifier ships a default set of tag patterns. Apps extend or override via `ClassifierConfig`:

```typescript
interface ClassifierConfig {
  tagPatterns?: Array<{ pattern: RegExp; tag: string }>;
  urgentKeywords?: string[];
  highPriorityKeywords?: string[];
  classificationLabels?: string[];
  maxInputLength?: number; // default: 4000
}
```

### Threading logic

RFC 5322 `References` / `In-Reply-To`, Gmail-style. `@rafters/mail/threading` ships three building blocks: `generateMessageId(domain)`, `buildReferences(existing, inReplyTo)` (caps the chain at 50 entries), and `generateSnippet(body, maxLength)`.

- **Inbound** (consumer-written): match `In-Reply-To` against existing `inbox_message.messageIdHeader`. If no match, walk the `References` header. If still no match, create a new thread. The framework does not ship this matching logic because it depends on your database layer.
- **Outbound** (shipped in `InboxEmailService`): `composeEmail` generates `<uuidv7@domain>` as Message-ID via `generateMessageId`. `replyToThread` sets `In-Reply-To` to the latest message in the thread and calls `buildReferences` to append to the chain.
- **Thread subject**: from the first message.
- **Thread snippet**: first 200 characters of the latest message's plain text body via `generateSnippet`.
- **Thread participants**: JSON array of all email addresses that have appeared in From, To, or CC across all messages in the thread.

---

## Service interfaces

Core exports six service interfaces. Apps compose them from adapters.

```typescript
interface InboxEmailService {
  replyToThread(params: ReplyToThreadParams): Promise<{ messageId: string }>;
  composeEmail(params: ComposeEmailParams): Promise<{ threadId: string; messageId: string }>;
}

interface ThreadService {
  getThread(threadId: string): Promise<Thread | undefined>;
  listThreads(mailboxId: string, folderId?: string): Promise<Thread[]>;
  moveToFolder(threadId: string, folderId: string): Promise<void>;
  updateStatus(threadId: string, status: ThreadStatus): Promise<void>;
  updatePriority(threadId: string, priority: ThreadPriority): Promise<void>;
  archive(threadId: string): Promise<void>;
  trash(threadId: string): Promise<void>;
}

interface FolderService {
  createFolder(mailboxId: string, name: string): Promise<Folder>;
  listFolders(mailboxId: string): Promise<Folder[]>;
  deleteFolder(folderId: string): Promise<void>;
  initSystemFolders(mailboxId: string): Promise<void>;
}

interface LabelService {
  createLabel(mailboxId: string, name: string): Promise<Label>;
  listLabels(mailboxId: string): Promise<Label[]>;
  applyToMessage(messageId: string, labelId: string, appliedBy?: string): Promise<void>;
  applyToThread(threadId: string, labelId: string, appliedBy?: string): Promise<void>;
  removeFromMessage(messageId: string, labelId: string): Promise<void>;
  removeFromThread(threadId: string, labelId: string): Promise<void>;
}

interface AssignmentService {
  assign(threadId: string, assigneeId: string, assignedBy?: string): Promise<void>;
  reassign(threadId: string, newAssigneeId: string, assignedBy?: string): Promise<void>;
  complete(threadId: string): Promise<void>;
  getActiveAssignment(threadId: string): Promise<Assignment | null>;
}

interface NoteService {
  addNote(threadId: string, authorId: string, content: string): Promise<Note>;
  listNotes(threadId: string): Promise<Note[]>;
  deleteNote(noteId: string): Promise<void>;
}
```

---

## Extraction boundary

What ships in `@rafters/mail` packages vs. what stays app-specific.

### Extracted

- All 10 inbox tables (Drizzle definitions + raw SQL in `migrationSQL`)
- 3 newsletter tables (Drizzle definitions only; not in `migrationSQL` -- consumer opt-in)
- All Zod schemas and inferred types
- `EmailProvider` interface and `createResendProvider` factory implementation
- `ResendService` class (fetch-based API wrapper, no SDK) -- used internally by the provider
- `createMockEmailProvider` factory (in-memory mock for testing)
- All Resend API type schemas
- `InboxEmailService` (`replyToThread`, `composeEmail`)
- Threading building blocks (`generateMessageId`, `buildReferences`, `generateSnippet`)
- Email classifier (`createWorkersAIClassifier` factory + helper functions)
- Classifier config defaults (`DEFAULT_TAG_PATTERNS`, urgent/high-priority keyword lists)
- `BaseEmail` template (configurable branding via props)
- `OtpEmail` template
- `createReactEmailRenderer` factory with name-keyed registry
- `createR2Storage` factory (R2 `BlobStorage` implementation, generates content-addressed keys)
- `parseEmailHeaders` and `hashContent` helpers for inbound parsing
- IMAP4rev1 protocol layer (`@rafters/mail-imap`): parser, formatter, session state, UID map, flag mapper, command handlers (CAPABILITY, LOGIN, LOGOUT, SELECT, EXAMINE, LIST, LSUB, STATUS, FETCH, STORE, SEARCH, EXPUNGE, NOOP, CLOSE, UNSELECT, IDLE, COPY, MOVE, APPEND, UID prefix)
- IMAP Cloudflare runtime (`@rafters/mail-imap-cloudflare`): `createImapDurableObject` + `createImapWorker` factories, WebSocket transport, hibernation, inbound `POST /notify` bridge
- IMAP Node runtime (`@rafters/mail-imap-server`): `createImapServer` factory, TCP or TLS listener, `notify(mailboxId, count)` for IDLE push

### Not extracted (app-specific)

- Domain-specific tag patterns (apps add their own regex patterns via `ClassifierConfig`)
- App-specific environment bindings (bucket names, domain constants)
- App-specific templates beyond base/OTP
- Hardcoded branding (logos, URLs, copyright text)
- Domain-specific database tables that reference app models

---

## IMAP on the edge

Status: **shipped in 0.1.0** across three packages.

### Concept

An IMAP4rev1 server for edge and Node runtimes. Every standard email client (Thunderbird, Apple Mail, Outlook, K-9) becomes a frontend for a `@rafters/mail` inbox. Two runtime adapters share the same protocol layer so consumers can choose their deployment topology:

- `@rafters/mail-imap-cloudflare` -- Durable Object + WebSocket, for serverless or web-client deployments
- `@rafters/mail-imap-server` -- Node TCP/TLS listener on port 993, for standard-client deployments on Fly/Railway/Fargate/VPS

### Why Durable Objects (for the serverless runtime)

IMAP is a stateful, long-lived protocol. Each client session maintains state: selected mailbox, message flags, sequence numbers.

- **Per-mailbox DO isolation.** Each mailbox is a Durable Object. Connection state is colocated with the mailbox data.
- **WebSocket hibernation for IDLE.** IMAP IDLE ("notify me when new mail arrives") maps directly to DO hibernation. The DO sleeps at near-zero cost and wakes only when new mail arrives or the client sends a command.
- **Alarms for session timeouts.** RFC 2177 recommends 29-minute IDLE refresh. DO alarms handle this natively.
- **Cost model.** Hibernated DOs are essentially free. You pay for command processing and new mail delivery.

### Command set

RFC 3501 IMAP4rev1 plus common extensions, all shipped in `@rafters/mail-imap`:

- **Any state:** `CAPABILITY`, `NOOP`, `LOGOUT`
- **Not authenticated:** `LOGIN`
- **Authenticated:** `SELECT`, `EXAMINE`, `LIST`, `LSUB`, `STATUS`, `APPEND` (RFC 4315 APPENDUID)
- **Selected:** `FETCH`, `STORE`, `SEARCH`, `EXPUNGE`, `CLOSE`, `UID` prefix, `COPY` (RFC 4315 COPYUID), `MOVE` (RFC 6851), `UNSELECT` (RFC 3691)
- **Extensions:** `IDLE` (RFC 2177)

Advertised capabilities on connection: `IMAP4rev1 IDLE LITERAL+ UIDPLUS NAMESPACE ID`.

### Flag mapping

| IMAP flag   | @rafters/mail field or derivation  |
| ----------- | ---------------------------------- |
| `\Seen`     | `inboxMessage.isRead`              |
| `\Flagged`  | `inboxMessage.isStarred`           |
| `\Deleted`  | soft delete (`deletedAt`)          |
| `\Draft`    | derived: folder slug = `drafts`    |
| `\Answered` | derived: thread has outbound reply |

Custom IMAP flags (keywords) map to labels via `inbox_message_label`.

### UID mapping

IMAP UIDs are derived from UUIDv7 natural ordering. The session maintains a UID-to-UUIDv7 mapping and a session-scoped sequence number index. UIDVALIDITY is incremented if the mapping is rebuilt.

### Transport

Three transport options, all using the same protocol handler from `@rafters/mail-imap`:

- **Durable Object + WebSocket** (`@rafters/mail-imap-cloudflare`): works on any Cloudflare plan. Web clients connect directly; standard email clients need a local bridge because they speak raw TCP, not WebSocket.
- **Node TCP/TLS server** (`@rafters/mail-imap-server`): runs on any platform with persistent TCP. Standard clients connect directly on port 993. Use TLS-terminating-proxy mode when deploying behind Fly, Railway, or an AWS NLB that terminates TLS.
- **Cloudflare Spectrum** (future, not shipped): native TCP on port 993 inside Cloudflare's edge. Requires Enterprise. Issue #57 tracks the TCP-to-WebSocket bridge Worker that would enable it; blocked on Spectrum being an Enterprise-tier feature.

For standard-client deployments, the Node runtime is the primary path today.

### Inbound signaling (IDLE push)

Both runtimes expose a way for your inbound handler to wake IDLE clients after storing new mail:

- **DO runtime:** `POST /notify?count=N` against the DO URL delivers an `EXISTS` to every IDLE session bound to that mailbox.
- **Node runtime:** `server.notify(mailboxId, newMessageCount)` (same method, in-process call) iterates the connection set and writes the `EXISTS` notification to matching sessions.

Your inbound pipeline calls one of these after persisting a new message. Without it, IDLE clients only see new mail on reselect or timeout.

---

## Future: multi-channel messaging

The adapter pattern is designed to support channels beyond email. Social posting, push notifications, and in-app messages could become adapter packages sharing the same core thread/message/label model.

The data model already supports this. Threads group messages. Messages have a direction flag (`isOutbound`) and metadata fields. Labels and folders organize them. The `EmailProvider` interface is channel-specific, but `ThreadService`, `LabelService`, `FolderService`, `AssignmentService`, and `NoteService` are channel-agnostic.

This expansion is roadmapped but not in current scope. Ship email complete first.

---

## Design decisions log

**Why raw fetch instead of the Resend SDK?**
The Resend SDK pulls in dependencies and assumes Node.js APIs. Edge runtimes provide `fetch` natively. A raw fetch wrapper with Zod validation on both request and response is smaller, has zero transitive dependencies, and runs on any runtime.

**Why SQLite (D1) instead of Postgres?**
Edge runtimes colocate compute and data. D1 is Cloudflare's edge SQLite. Turso and libSQL provide the same model on other platforms. Postgres requires a connection to a centralized database, which adds latency and defeats the purpose of edge compute.

**Why R2 for blob storage instead of D1 BLOBs?**
Emails with attachments can be large. D1 rows have size limits. R2 stores arbitrarily large objects, supports range reads (for fetching the first 4KB during classification), and costs less per GB than database storage. D1 holds the metadata, R2 holds the content.

**Why UUIDv7?**
Sortable by creation time. No coordination required. Works as both a database primary key and an IMAP UID source (natural ordering).

**Why 4KB truncation for classification?**
DeBERTa-v3 has a 512-token context window. 4KB of text comfortably fits within that after tokenization. Fetching the full email body for classification wastes bandwidth and R2 read operations. The subject line and opening paragraph contain the signal needed for categorization.

**Why no barrel files?**
Measured impact: a barrel export that re-exports all of `@rafters/mail` pulls ~45KB into any consumer that imports a single type. With subpath exports, consumers import only what they reference. On Workers with a 1MB compressed limit, this matters.
