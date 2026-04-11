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
|---|---|
| MailingList | Audience |
| Subscriber | Contact |
| Campaign | Broadcast |

### 7. No barrel files

Edge runtimes have bundle size constraints. Workers enforces a 1MB compressed limit. Barrel exports (`index.ts` re-exporting everything) pull the entire module graph into every consumer. All packages use subpath exports in `package.json` so consumers import exactly what they need.

```typescript
// Correct: subpath import
import { createResendProvider } from '@rafters/mail-resend';
import { createR2BlobStorage } from '@rafters/mail-cloudflare/storage';

// Wrong: barrel import that pulls in everything
import { createResendProvider, createR2BlobStorage } from '@rafters/mail';
```

---

## Package structure

Six packages. Core has zero vendor dependencies.

```
@rafters/mail                  Core: schema, types, interfaces, threading
@rafters/mail-resend           Outbound adapter (Resend API via raw fetch)
@rafters/mail-cloudflare       Inbound adapter (CF Email Routing) + R2 blob storage
@rafters/mail-react-email      Template renderer (React Email)
@rafters/mail-workers-ai       Classifier (Workers AI, DeBERTa-v3)
@rafters/better-auth-resend    Glue: wires Resend + React Email into better-auth OTP
```

Dependency graph:

```
@rafters/mail  <--  @rafters/mail-resend
               <--  @rafters/mail-cloudflare
               <--  @rafters/mail-react-email
               <--  @rafters/mail-workers-ai

@rafters/mail-resend + @rafters/mail-react-email  <--  @rafters/better-auth-resend
```

Every adapter depends only on `@rafters/mail`. The `better-auth-resend` glue is the only package with two adapter dependencies.

---

## Data model

### Schema: 10 inbox tables + 3 newsletter tables

All IDs are UUIDv7 via `$defaultFn`. All timestamps use `integer` with `mode: 'timestamp_ms'` and `unixepoch('subsecond') * 1000` defaults (the D1/SQLite pattern). All tables have soft delete via `deletedAt`. JSON columns use SQLite text with `mode: 'json'`.

#### Inbox tables

| Table | Purpose |
|---|---|
| `mailbox` | Email addresses that send/receive. Personal (one owner) or shared (team). |
| `inbox_folder` | System folders + custom folders. Per-mailbox. |
| `inbox_label` | System, AI-generated, and user-created labels. Per-mailbox. |
| `inbox_thread` | Conversation grouping. Subject, snippet, participants, folder, status, priority. |
| `inbox_message` | Individual messages. RFC 5322 headers, envelope data, AI classification fields, blob keys. |
| `inbox_message_label` | Many-to-many: message to label. Tracks who/what applied the label. |
| `inbox_thread_label` | Many-to-many: thread to label. Thread-level filtering. |
| `inbox_attachment` | Attachment metadata. Content in blob storage. Supports inline (Content-ID) and regular. |
| `thread_assignment` | Thread assignment for shared mailbox collaboration. Status: active/completed/reassigned. |
| `thread_note` | Internal notes on threads. Markdown. Not visible to external parties. |

#### Newsletter tables

| Table | Purpose |
|---|---|
| `platform_audience` | Platform-wide mailing lists. |
| `platform_subscriber` | User subscriptions to audiences. |
| `broadcast_audit` | Compliance trail: who sent what, when, to which audience, recipient count. |

The email provider (Resend) is the source of truth for subscriber data. The local tables store the registry, mappings, and provider sync identifiers. Subscriber email addresses, unsubscribe status, and campaign content live in the provider.

### System folders

Every mailbox gets six immutable system folders on creation:

| Slug | Purpose |
|---|---|
| `inbox` | Default landing folder for inbound email |
| `sent` | Outbound emails |
| `drafts` | Unsent drafts |
| `spam` | AI-classified or manually flagged spam |
| `trash` | Soft-deleted, auto-purge after 30 days |
| `archive` | Archived conversations |

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
  render(template: string, props: Record<string, unknown>): Promise<{ html: string; text?: string }>;
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
  category: z.enum(['support', 'feedback', 'abuse', 'partnership', 'spam', 'billing', 'legal', 'other']),
  confidence: z.number().min(0).max(100),
  tags: z.array(z.string()),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
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

An email arrives from the outside world and lands in the inbox.

```
External sender
  |
  v
Cloudflare Email Routing
  |
  v
CF Email Worker (InboundAdapter)
  |
  +---> [1] Parse RFC 5322 headers
  |         From, To, CC, Subject, Message-ID, In-Reply-To, References, Date
  |
  +---> [2] Store raw .eml in blob storage (R2)
  |         Key: emails/{year}/{month-zero-padded}/{sha256-16}.eml
  |
  +---> [3] Store parsed HTML and plain text as separate blobs
  |         Keys: .../{sha256-16}.html, .../{sha256-16}.txt
  |
  +---> [4] Insert metadata row into D1 (inbox_message)
  |         Columns: message ID, subject, from/to/cc, blob keys,
  |         isRead=false, isOutbound=false
  |
  +---> [5] Thread matching
  |         Look up In-Reply-To against existing inbox_message.messageId
  |         If no match, check References header entries
  |         If no match, create new thread
  |         Update thread snippet and participant list
  |
  +---> [6] Dispatch to classification queue/workflow
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

Runs asynchronously after inbound storage. Triggered by a Cloudflare Queue message or Workflow step.

```
Queue/Workflow picks up message
  |
  +---> [1] Fetch first 4KB of message body from blob storage
  |         Truncation is intentional. Classification does not need
  |         the full body. 4KB covers subject + opening content.
  |
  +---> [2] Zero-shot classify with Workers AI
  |         Model: @cf/microsoft/deberta-v3-base-zeroshot-v1.1-all-33
  |         Labels: support, feedback, abuse, partnership, spam, billing, legal, other
  |         Returns: category + confidence score (0-100)
  |
  +---> [3] Determine priority
  |         abuse, legal -> always high
  |         Urgent keywords (urgent, emergency, asap, immediately,
  |           critical, broken, down, outage) -> urgent
  |         High keywords (important, priority, help, issue,
  |           problem, error, bug, crash) -> high
  |         support, billing -> normal
  |         feedback, partnership -> normal
  |         Everything else -> low
  |
  +---> [4] Auto-tag via regex patterns
  |         install|setup|download       -> installation
  |         crash|error|bug|broken       -> bug-report
  |         feature|request|suggest      -> feature-request
  |         account|login|password|auth  -> account
  |         payment|billing|subscribe|refund -> billing
  |         (Apps add domain-specific patterns via config)
  |
  +---> [5] Update D1 record
  |         Set aiCategory, aiConfidence, aiPriority on inbox_message
  |
  +---> [6] Update R2 metadata
  |         Attach classification data to the blob object
  |
  +---> [7] Spam handling
  |         If category=spam, move thread to spam folder
  |
  +---> [8] Apply AI-generated labels
            Find-or-create labels from tags
            Insert into inbox_message_label with appliedBy=null (AI)
```

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

RFC 5322 References/In-Reply-To, Gmail-style:

- **Inbound**: match `In-Reply-To` against existing `inbox_message.messageId`. If no match, walk the `References` header. If still no match, create a new thread.
- **Outbound**: generate `<uuidv7@domain>` as Message-ID. Set `In-Reply-To` to the latest message in the thread. Append all prior Message-IDs to the References chain.
- **Thread subject**: from the first message.
- **Thread snippet**: first 200 characters of the latest message's plain text body.
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

- All 10 inbox tables and 3 newsletter tables (Drizzle definitions + raw SQL)
- All Zod schemas and inferred types
- `EmailProvider` interface and `ResendProvider` implementation
- `ResendService` (fetch-based API wrapper, no SDK)
- `MockEmailProvider` (in-memory mock for testing)
- All Resend API type schemas
- `InboxEmailService` (reply-to-thread, compose-email)
- Threading logic (Message-ID generation, References chain building)
- Email classifier (classify function, priority rules, tag extraction)
- `ClassifyEmailWorkflow` (Cloudflare Workflow, step-based)
- Queue consumer (`handleEmailClassifyQueue`)
- `BaseEmail` template (configurable branding via props)
- OTP template
- R2 storage key generation
- Raw email RFC 822 generation for outbound storage

### Not extracted (app-specific)

- Domain-specific tag patterns (apps add their own regex patterns via `ClassifierConfig`)
- App-specific environment bindings (bucket names, domain constants)
- App-specific templates beyond base/OTP
- Hardcoded branding (logos, URLs, copyright text)
- Domain-specific database tables that reference app models

---

## IMAP on the edge (planned)

Status: designed, not built. Planned for post-0.1.0. A full design document exists.

### Concept

An IMAP server running on Cloudflare Durable Objects. Every standard email client (Thunderbird, Apple Mail, Outlook) becomes a frontend for an @rafters/mail inbox. No one is running IMAP servers on edge runtimes today.

### Why Durable Objects

IMAP is a stateful, long-lived protocol. Each client session maintains state: selected mailbox, message flags, sequence numbers.

- **Per-mailbox DO isolation.** Each mailbox is a Durable Object. Connection state is colocated with the mailbox data.
- **WebSocket hibernation for IDLE.** IMAP IDLE ("notify me when new mail arrives") maps directly to DO hibernation. The DO sleeps at near-zero cost and wakes only when new mail arrives or the client sends a command.
- **Alarms for session timeouts.** RFC 2177 recommends 29-minute IDLE refresh. DO alarms handle this natively.
- **Cost model.** Hibernated DOs are essentially free. You pay for command processing and new mail delivery.

### Command set (MVP)

CAPABILITY, LOGIN, LOGOUT, SELECT, EXAMINE, LIST, LSUB, STATUS, FETCH, SEARCH, STORE, EXPUNGE, CLOSE, NOOP, IDLE.

### Flag mapping

| IMAP flag | @rafters/mail field |
|---|---|
| `\Seen` | `inboxMessage.isRead` |
| `\Flagged` | `inboxMessage.isStarred` |
| `\Deleted` | soft delete (`deletedAt`) |
| `\Draft` | folder slug = `drafts` |
| `\Answered` | thread has outbound reply |

Custom IMAP flags (keywords) map to labels via `inbox_message_label`.

### UID mapping

IMAP UIDs are derived from UUIDv7 natural ordering. The DO maintains a UID-to-UUIDv7 mapping and a session-scoped sequence number index. UIDVALIDITY is incremented if the mapping is rebuilt.

### Transport

Two options, both using the same protocol handler:

- **IMAP-over-WebSocket**: works on any Cloudflare plan. Requires a thin local proxy for standard clients.
- **Cloudflare Spectrum**: native TCP on port 993. Standard clients connect directly. Requires Enterprise or paid add-on.

Recommendation: ship WebSocket first, add Spectrum when demand justifies it.

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
