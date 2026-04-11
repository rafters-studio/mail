# @rafters/mail Core Reference

Version: 0.1.0
Package: `@rafters/mail`
Runtime: Edge-native (Cloudflare Workers, Deno Deploy, Vercel Edge, any V8 isolate)
Database: SQLite (D1, Turso, libSQL)
ORM: Drizzle
Dependencies: Zero vendor dependencies. All external concerns are adapters.

---

## Table of Contents

1. [Schema Reference](#schema-reference)
2. [Service Interfaces](#service-interfaces)
3. [Adapter Interfaces](#adapter-interfaces)
4. [Threading](#threading)
5. [Folders](#folders)
6. [Labels](#labels)
7. [Assignments](#assignments)
8. [Notes](#notes)
9. [Newsletter Tables](#newsletter-tables)
10. [Zod Schemas and Enums](#zod-schemas-and-enums)
11. [Migrations](#migrations)
12. [Design Decisions](#design-decisions)

---

## Schema Reference

10 inbox tables. 3 newsletter tables. All tables follow these conventions:

- **IDs**: UUIDv7 via `$defaultFn`. Primary keys are `text` type.
- **Timestamps**: `integer` with `mode: 'timestamp_ms'`. Default: `unixepoch('subsecond') * 1000`. Millisecond precision.
- **Soft delete**: Every table has a `deletedAt` column. Null means active. Populated means soft-deleted.
- **JSON columns**: SQLite `text` with `mode: 'json'`. Stored as serialized JSON strings, parsed at read time.
- **User references**: Plain `text` columns (`ownerId`, `assigneeId`, `assignedBy`, `authorId`, `appliedBy`). No foreign key constraints to external auth tables. The AuthAdapter resolves identity at runtime.

---

### mailbox

Email addresses that can send and receive. Each mailbox is either personal (one owner) or shared (team-operated).

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| emailAddress | text | -- | No | The email address. Unique. Column: `email_address`. |
| displayName | text | -- | Yes | Display name for the mailbox. Column: `display_name`. |
| type | text | 'personal' | No | `personal` or `shared`. See `mailboxTypeSchema`. |
| ownerId | text | -- | Yes | User who owns this mailbox. Plain text, no FK. Nullable (shared mailboxes may have no single owner). |
| organizationId | text | -- | No | Organization this mailbox belongs to. Plain text, no FK. Required. |
| isActive | integer | 1 | No | Whether the mailbox can send/receive. |
| autoReplyEnabled | integer | 0 | No | Whether auto-reply is enabled. |
| autoReplySubject | text | -- | Yes | Subject line for auto-reply messages. |
| autoReplyBody | text | -- | Yes | Body content for auto-reply messages. |
| forwardToEmail | text | -- | Yes | Email address to forward incoming messages to. |
| forwardEnabled | integer | 0 | No | Whether forwarding is enabled. |
| signature | text | -- | Yes | Default email signature for this mailbox. |
| description | text | -- | Yes | Description of the mailbox purpose. |
| icon | text | -- | Yes | Icon identifier for UI rendering. |
| color | text | -- | Yes | Hex color for UI rendering. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| updatedAt | integer | unixepoch('subsecond') * 1000 | No | Last update timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: unique on `emailAddress`.

**Notes**: A personal mailbox has one owner. A shared mailbox has one owner (typically an admin) and additional access is granted through the AuthAdapter. The `organizationId` column is required for multi-tenant deployments. The `ownerId` is nullable because shared mailboxes may not have a single owner.

---

### inbox_folder

System and custom folders. Per-mailbox. System folders are created via `FolderService.initSystemFolders()` and cannot be renamed or deleted.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| mailboxId | text (FK -> mailbox.id) | -- | No | Parent mailbox. |
| name | text | -- | No | Display name. |
| slug | text | -- | No | URL-safe identifier. System folders use fixed slugs. |
| isSystem | integer | 0 | No | 1 for system folders, 0 for custom. |
| sortOrder | integer | 0 | No | Display order. System folders sort first. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: unique on `(mailboxId, slug)`.

**System folder slugs**: `inbox`, `sent`, `drafts`, `spam`, `trash`, `archive`. See [Folders](#folders) for details.

---

### inbox_label

Labels for categorizing messages and threads. Three types: system, AI-generated, and user-created. Per-mailbox.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| mailboxId | text (FK -> mailbox.id) | -- | Yes | Parent mailbox. Nullable for global system labels shared across mailboxes. |
| name | text | -- | No | Display name. |
| slug | text | -- | No | URL-safe identifier. |
| color | text | -- | Yes | Hex color for UI rendering. |
| isSystem | integer | 0 | No | 1 for system labels (important, starred, unread). |
| isAiGenerated | integer | 0 | No | 1 for labels created by the classifier. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: unique on `(mailboxId, slug)`.

**Notes**: See [Labels](#labels) for the three label types and how they interact with messages and threads.

---

### inbox_thread

Conversation grouping. One thread contains one or more messages. Threads track aggregate state: latest snippet, all participants, current folder, status, and priority.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| mailboxId | text (FK -> mailbox.id) | -- | No | Parent mailbox. |
| folderId | text (FK -> inbox_folder.id) | -- | Yes | Current folder. Nullable (onDelete: "set null"). |
| subject | text | -- | No | Thread subject. Set from the first message. |
| snippet | text | -- | Yes | Preview text. First 200 chars of the latest message's plain text body. |
| participants | text (JSON) | '[]' | No | JSON array of email addresses that have participated. |
| messageCount | integer | 0 | No | Total messages in the thread. |
| unreadCount | integer | 0 | No | Number of unread messages in the thread. |
| status | text | 'open' | No | `open`, `pending`, `resolved`, `closed`. See `threadStatusSchema`. |
| priority | text | 'normal' | No | `low`, `normal`, `high`, `urgent`. See `threadPrioritySchema`. |
| lastMessageAt | integer | -- | No | Timestamp of the most recent message. Used for sort. Required. |
| startedAt | integer | -- | No | Timestamp when the thread was created/started. |
| updatedAt | integer | unixepoch('subsecond') * 1000 | No | Last update timestamp in ms. |
| archivedAt | integer | -- | Yes | Timestamp when the thread was archived. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: on `(mailboxId, folderId)`, on `(mailboxId, status)`, on `lastMessageAt`.

---

### inbox_message

Individual email messages. Stores RFC 5322 header data, envelope information, AI classification fields, and blob storage keys pointing to the raw email and parsed bodies.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| threadId | text (FK -> inbox_thread.id) | -- | No | Parent thread. |
| mailboxId | text (FK -> mailbox.id) | -- | No | Parent mailbox. |
| messageId | text | -- | No | RFC 5322 Message-ID header value. Format: `<uuidv7@domain>` for outbound. |
| inReplyTo | text | -- | Yes | RFC 5322 In-Reply-To header. References the parent message's Message-ID. |
| references | text | -- | Yes | RFC 5322 References header. Space-separated list of Message-IDs in the thread chain. |
| fromEmail | text | -- | No | Sender email address. |
| fromName | text | -- | Yes | Sender display name. |
| toEmail | text | -- | No | Primary recipient email address. |
| toName | text | -- | Yes | Primary recipient display name. |
| replyToEmail | text | -- | Yes | Reply-To email address (if different from fromEmail). |
| ccEmails | text (JSON) | '[]' | No | JSON array of CC recipient email addresses. |
| bccEmails | text (JSON) | '[]' | No | JSON array of BCC recipient email addresses. |
| subject | text | -- | No | Message subject line. |
| blobKeyRaw | text | -- | No | Blob storage key for the raw .eml file. Required. |
| blobKeyHtml | text | -- | Yes | Blob storage key for the parsed HTML body. |
| blobKeyText | text | -- | Yes | Blob storage key for the parsed plain text body. |
| isOutbound | integer | 0 | No | Whether this is an outbound message. 0 = inbound, 1 = outbound. |
| isRead | integer | 0 | No | Read status. |
| isStarred | integer | 0 | No | Star status. |
| aiCategory | text | -- | Yes | AI-assigned category. See `aiCategorySchema`. |
| aiConfidence | integer | -- | Yes | AI classification confidence score. 0-100. |
| aiSummary | text | -- | Yes | AI-generated summary of the message content. |
| isSpam | integer | 0 | No | Whether the message is classified as spam. |
| spamScore | integer | -- | Yes | Spam score from classifier. 0-100. |
| sizeBytes | integer | -- | Yes | Total size of the message in bytes. |
| attachmentCount | integer | 0 | No | Number of attachments on the message. |
| sentAt | integer | -- | Yes | When the message was sent (from Date header or send time). |
| receivedAt | integer | -- | Yes | When the message was received by the system. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: unique on `messageId`, on `(threadId)`, on `(mailboxId, receivedAt)`, on `fromEmail`, on `receivedAt`, on `aiCategory`.

**Notes**: This table has no `createdAt` or `updatedAt` columns. Temporal data is tracked via `receivedAt`, `sentAt`, and `deletedAt`. Content is blob-only: the `bodyPlainText` and `bodyHtml` inline columns do not exist. All message content is stored in blob storage and referenced by `blobKeyRaw` (required), `blobKeyHtml`, and `blobKeyText`.

**Blob storage pattern**: Raw email is the source of truth. D1 stores parsed metadata for fast queries. If metadata is wrong, re-derive from the raw email in blob storage. Key format: `emails/{year}/{month}/{sha256-first-16-chars}.{eml|html|txt}` (month is zero-padded).

---

### inbox_message_label

Join table. Many-to-many between messages and labels. Tracks who or what applied the label.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| messageId | text (FK -> inbox_message.id) | -- | No | The message. |
| labelId | text (FK -> inbox_label.id) | -- | No | The label. |
| appliedBy | text | -- | Yes | User ID of who applied the label. Null means system or AI. |
| appliedAt | integer | unixepoch('subsecond') * 1000 | No | When the label was applied. |

**Indexes**: unique on `(messageId, labelId)`.

---

### inbox_thread_label

Join table. Many-to-many between threads and labels. Used for thread-level filtering and organization.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| threadId | text (FK -> inbox_thread.id) | -- | No | The thread. |
| labelId | text (FK -> inbox_label.id) | -- | No | The label. |
| appliedBy | text | -- | Yes | User ID of who applied the label. Null means system or AI. |
| appliedAt | integer | unixepoch('subsecond') * 1000 | No | When the label was applied. |

**Indexes**: unique on `(threadId, labelId)`.

---

### inbox_attachment

Attachment metadata. Actual content lives in blob storage. Supports both inline attachments (referenced by Content-ID in HTML body) and regular file attachments.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| messageId | text (FK -> inbox_message.id) | -- | No | Parent message. |
| filename | text | -- | Yes | Original filename. |
| contentType | text | -- | No | MIME type (e.g., `application/pdf`, `image/png`). |
| sizeBytes | integer | -- | No | File size in bytes. |
| blobKey | text | -- | No | Blob storage key for the attachment content. |
| contentId | text | -- | Yes | Content-ID for inline attachments. Used in HTML `cid:` references. |
| isInline | integer | 0 | No | 1 if this is an inline attachment (embedded in HTML body). |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: on `messageId`, on `contentId`.

---

### thread_assignment

Thread-level assignment for shared mailbox collaboration. One active assignment per thread at a time. See [Assignments](#assignments).

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| threadId | text (FK -> inbox_thread.id) | -- | No | The thread being assigned. |
| assigneeId | text | -- | No | User ID of the assignee. Plain text, no FK. |
| assignedBy | text | -- | Yes | User ID of who made the assignment. Null for system assignment. |
| status | text | 'active' | No | `active`, `completed`, `reassigned`. |
| note | text | -- | Yes | Optional note about the assignment. |
| assignedAt | integer | unixepoch('subsecond') * 1000 | No | When the assignment was created. |
| completedAt | integer | -- | Yes | When the assignment was completed. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. Used for audit trail. |

**Indexes**: on `(threadId, status)`, on `assigneeId`.

**Constraint**: Only one row with `status = 'active'` per `threadId` at any time. Enforced at the service layer, not the database.

---

### thread_note

Internal notes on threads. Markdown content. Not visible to external parties. Used for team collaboration on shared mailbox threads.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| threadId | text (FK -> inbox_thread.id) | -- | No | Parent thread. |
| authorId | text | -- | No | User ID of the note author. Plain text, no FK. |
| content | text | -- | No | Note body. Markdown. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| updatedAt | integer | unixepoch('subsecond') * 1000 | No | Last update timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: on `threadId`.

---

## Service Interfaces

All service interfaces are defined in `@rafters/mail`. Implementations receive a Drizzle database instance and any required adapters via constructor or factory function.

---

### InboxEmailService

Outbound email operations from the inbox. Handles composing new emails and replying within existing threads.

```typescript
interface InboxEmailService {
  replyToThread(params: ReplyToThreadParams): Promise<{ messageId: string }>;
  composeEmail(params: ComposeEmailParams): Promise<{ threadId: string; messageId: string }>;
}
```

#### replyToThread

Send a reply within an existing thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| params.threadId | string | Yes | Thread to reply to. |
| params.senderId | string | Yes | User ID of the sender. |
| params.bodyHtml | string | Yes | HTML body of the reply. |
| params.body | string | No | Plain text alternative. |
| params.ccEmails | string[] | No | CC recipients. |
| params.bccEmails | string[] | No | BCC recipients. |

**Returns**: `{ messageId: string }` -- the ID of the newly created message.

**Behavior**:
1. Looks up the thread and its latest message.
2. Generates a new Message-ID via `generateMessageId()`.
3. Sets `In-Reply-To` to the latest message's Message-ID.
4. Builds the `References` header by appending `In-Reply-To` to the existing chain.
5. Sends via the EmailProvider adapter.
6. Stores the outbound message in `inbox_message` with `isOutbound = true`.
7. Moves the thread to the `sent` folder context and updates `lastMessageAt`, `snippet`, and `messageCount`.

#### composeEmail

Create a new thread with an outbound message.

| Parameter | Type | Required | Description |
|---|---|---|---|
| params.mailboxId | string | Yes | Sending mailbox. |
| params.to | string | Yes | Recipient email address. |
| params.subject | string | Yes | Subject line. |
| params.body | string | Yes | HTML body. |
| params.plainText | string | No | Plain text alternative. |
| params.ccEmails | string[] | No | CC recipients. |
| params.bccEmails | string[] | No | BCC recipients. |

**Returns**: `{ threadId: string; messageId: string }`.

**Behavior**:
1. Creates a new `inbox_thread` with the subject and initial participants.
2. Creates a new `inbox_message` with `isOutbound = true` and a generated Message-ID.
3. Sends via the EmailProvider adapter.
4. Places the thread in the `sent` folder.

---

### ThreadService

Thread management: retrieval, folder movement, status updates, and bulk operations.

```typescript
interface ThreadService {
  getThread(threadId: string): Promise<Thread | undefined>;
  listThreads(mailboxId: string, folderId?: string): Promise<Thread[]>;
  moveToFolder(threadId: string, folderId: string): Promise<void>;
  updateStatus(threadId: string, status: ThreadStatus): Promise<void>;
  updatePriority(threadId: string, priority: ThreadPriority): Promise<void>;
  archive(threadId: string): Promise<void>;
  trash(threadId: string): Promise<void>;
}
```

#### getThread

Retrieve a single thread with its messages.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to retrieve. |

**Returns**: `Thread | undefined` -- thread record with nested messages, labels, and assignment. Returns `undefined` if the thread does not exist or is soft-deleted.

#### listThreads

List threads in a mailbox, optionally filtered by folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Mailbox to list threads from. |
| folderId | string | No | Filter to a specific folder. If omitted, returns all threads. |

**Returns**: `Thread[]` -- ordered by `lastMessageAt` descending.

#### moveToFolder

Move a thread to a different folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to move. |
| folderId | string | Yes | Target folder. |

**Behavior**: Updates `inbox_thread.folderId`. Validates the target folder exists and belongs to the same mailbox.

#### updateStatus

Set the thread's workflow status.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to update. |
| status | ThreadStatus | Yes | New status: `open`, `pending`, `resolved`, `closed`. |

#### updatePriority

Set the thread's priority level.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to update. |
| priority | ThreadPriority | Yes | New priority: `low`, `normal`, `high`, `urgent`. |

#### archive

Move a thread to the archive folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to archive. |

**Behavior**: Finds the `archive` system folder for the thread's mailbox and updates `folderId`. Equivalent to `moveToFolder(threadId, archiveFolderId)`.

#### trash

Move a thread to the trash folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to trash. |

**Behavior**: Finds the `trash` system folder for the thread's mailbox and updates `folderId`. Trash auto-purge (30 days) is an app-level concern, not implemented in core.

---

### FolderService

Folder CRUD and system folder initialization.

```typescript
interface FolderService {
  createFolder(mailboxId: string, name: string): Promise<Folder>;
  listFolders(mailboxId: string): Promise<Folder[]>;
  deleteFolder(folderId: string): Promise<void>;
  initSystemFolders(mailboxId: string): Promise<void>;
}
```

#### createFolder

Create a custom folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Parent mailbox. |
| name | string | Yes | Folder display name. |

**Returns**: `Folder` -- the created folder. Slug is derived from the name.

**Behavior**: Sets `isSystem = 0`. Validates the slug does not collide with system folder slugs.

#### listFolders

List all folders for a mailbox.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Parent mailbox. |

**Returns**: `Folder[]` -- ordered by `sortOrder`. System folders first, then custom folders.

#### deleteFolder

Soft-delete a custom folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| folderId | string | Yes | Folder to delete. |

**Throws**: If the folder is a system folder (`isSystem = 1`). System folders cannot be deleted.

**Behavior**: Sets `deletedAt`. Threads in the deleted folder should be moved by the app (core does not auto-relocate).

#### initSystemFolders

Create the six system folders for a mailbox. Idempotent.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Mailbox to initialize. |

**Behavior**: Creates `inbox`, `sent`, `drafts`, `spam`, `trash`, `archive` folders with `isSystem = 1`. Skips any that already exist. Should be called when a mailbox is created.

---

### LabelService

Label CRUD and application to messages and threads.

```typescript
interface LabelService {
  createLabel(mailboxId: string, name: string): Promise<Label>;
  listLabels(mailboxId: string): Promise<Label[]>;
  applyToMessage(messageId: string, labelId: string, appliedBy?: string): Promise<void>;
  applyToThread(threadId: string, labelId: string, appliedBy?: string): Promise<void>;
  removeFromMessage(messageId: string, labelId: string): Promise<void>;
  removeFromThread(threadId: string, labelId: string): Promise<void>;
}
```

#### createLabel

Create a user-defined label.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Parent mailbox. |
| name | string | Yes | Label display name. |

**Returns**: `Label` -- the created label with `isSystem = 0`, `isAiGenerated = 0`.

#### listLabels

List all labels for a mailbox.

| Parameter | Type | Required | Description |
|---|---|---|---|
| mailboxId | string | Yes | Parent mailbox. |

**Returns**: `Label[]` -- all label types (system, AI, user).

#### applyToMessage

Apply a label to a message.

| Parameter | Type | Required | Description |
|---|---|---|---|
| messageId | string | Yes | Target message. |
| labelId | string | Yes | Label to apply. |
| appliedBy | string | No | User ID. Null means system or AI applied it. |

**Behavior**: Inserts into `inbox_message_label`. No-op if the label is already applied.

#### applyToThread

Apply a label to a thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Target thread. |
| labelId | string | Yes | Label to apply. |
| appliedBy | string | No | User ID. Null means system or AI applied it. |

**Behavior**: Inserts into `inbox_thread_label`. No-op if the label is already applied.

#### removeFromMessage

Remove a label from a message.

| Parameter | Type | Required | Description |
|---|---|---|---|
| messageId | string | Yes | Target message. |
| labelId | string | Yes | Label to remove. |

**Behavior**: Deletes the row from `inbox_message_label`.

#### removeFromThread

Remove a label from a thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Target thread. |
| labelId | string | Yes | Label to remove. |

**Behavior**: Deletes the row from `inbox_thread_label`.

---

### AssignmentService

Thread assignment for shared mailbox collaboration. See [Assignments](#assignments).

```typescript
interface AssignmentService {
  assign(threadId: string, assigneeId: string, assignedBy?: string): Promise<void>;
  reassign(threadId: string, newAssigneeId: string, assignedBy?: string): Promise<void>;
  complete(threadId: string): Promise<void>;
  getActiveAssignment(threadId: string): Promise<Assignment | null>;
}
```

#### assign

Assign a thread to a user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to assign. |
| assigneeId | string | Yes | User ID of the assignee. |
| assignedBy | string | No | User ID of who made the assignment. |

**Throws**: If the thread already has an active assignment. Use `reassign` instead.

**Behavior**: Creates a `thread_assignment` row with `status = 'active'`.

#### reassign

Reassign a thread to a different user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to reassign. |
| newAssigneeId | string | Yes | User ID of the new assignee. |
| assignedBy | string | No | User ID of who initiated the reassignment. |

**Behavior**: Sets the current active assignment's status to `reassigned` and soft-deletes it. Creates a new `thread_assignment` row with `status = 'active'` for the new assignee. The old assignment is preserved for audit.

#### complete

Mark the active assignment as completed.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread whose assignment to complete. |

**Behavior**: Sets `status = 'completed'` on the active assignment. Does not soft-delete. A completed assignment is a terminal state.

#### getActiveAssignment

Get the current active assignment for a thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Thread to query. |

**Returns**: `Assignment | null`. Null if no active assignment exists.

---

### NoteService

Internal notes on threads. See [Notes](#notes).

```typescript
interface NoteService {
  addNote(threadId: string, authorId: string, content: string): Promise<Note>;
  listNotes(threadId: string): Promise<Note[]>;
  deleteNote(noteId: string): Promise<void>;
}
```

#### addNote

Add an internal note to a thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Parent thread. |
| authorId | string | Yes | User ID of the note author. |
| content | string | Yes | Markdown content. |

**Returns**: `Note` -- the created note.

#### listNotes

List all notes on a thread.

| Parameter | Type | Required | Description |
|---|---|---|---|
| threadId | string | Yes | Parent thread. |

**Returns**: `Note[]` -- ordered by `createdAt` ascending. Excludes soft-deleted notes.

#### deleteNote

Soft-delete a note.

| Parameter | Type | Required | Description |
|---|---|---|---|
| noteId | string | Yes | Note to delete. |

**Behavior**: Sets `deletedAt`. The note is preserved for audit trail but excluded from `listNotes` results.

---

## Adapter Interfaces

Adapters are contracts that the consuming app must implement (or use a provided adapter package). The core package defines the interfaces as Zod schemas with inferred TypeScript types. The core has zero dependency on any adapter implementation.

---

### AuthAdapter

Resolves user identity and access control. The app provides the implementation. No default implementation is shipped.

```typescript
const inboxUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

const inboxRoleSchema = z.enum(['owner', 'admin', 'agent', 'viewer']);

type InboxUser = z.infer<typeof inboxUserSchema>;
type InboxRole = z.infer<typeof inboxRoleSchema>;

interface AuthAdapter {
  getCurrentUser(): Promise<InboxUser>;
  getUserById(id: string): Promise<InboxUser | null>;
  hasMailboxAccess(userId: string, mailboxId: string): Promise<boolean>;
  getUserRole(userId: string, mailboxId: string): Promise<InboxRole | null>;
}
```

#### getCurrentUser

Return the authenticated user for the current request.

**Returns**: `InboxUser`.

**Notes**: How authentication works is entirely the app's concern. This could read from a session cookie, JWT, or any other mechanism.

#### getUserById

Look up a user by ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| id | string | Yes | User ID. |

**Returns**: `InboxUser | null`. Null if the user does not exist.

#### hasMailboxAccess

Check whether a user has any level of access to a mailbox.

| Parameter | Type | Required | Description |
|---|---|---|---|
| userId | string | Yes | User to check. |
| mailboxId | string | Yes | Mailbox to check against. |

**Returns**: `boolean`.

#### getUserRole

Get the user's role for a specific mailbox.

| Parameter | Type | Required | Description |
|---|---|---|---|
| userId | string | Yes | User to check. |
| mailboxId | string | Yes | Mailbox to check against. |

**Returns**: `InboxRole | null`. Null if the user has no role (no access).

**Roles**:
- `owner`: Full control. Can delete the mailbox.
- `admin`: Manage folders, labels, assignments. Cannot delete the mailbox.
- `agent`: Can read, reply, assign, add notes. Cannot manage folders or labels.
- `viewer`: Read-only access.

---

### InboundAdapter

Receives email from an external source, parses it, stores it, and creates/updates the thread.

```typescript
const inboundEmailSchema = z.object({
  raw: z.instanceof(ArrayBuffer),
  from: z.string().email(),
  to: z.string().email(),
  headers: z.record(z.string()),
});

type InboundEmail = z.infer<typeof inboundEmailSchema>;

interface InboundAdapter {
  handleIncoming(email: InboundEmail): Promise<{ messageId: string; threadId: string }>;
}
```

#### handleIncoming

Process an inbound email.

| Parameter | Type | Required | Description |
|---|---|---|---|
| email.raw | ArrayBuffer | Yes | Raw RFC 5322 email bytes. |
| email.from | string | Yes | Sender email address (from envelope). |
| email.to | string | Yes | Recipient email address (from envelope). |
| email.headers | Record<string, string> | Yes | Parsed headers. Must include Message-ID. Should include In-Reply-To, References, Subject, Date. |

**Returns**: `{ messageId: string; threadId: string }`.

**Behavior**:
1. Store raw `.eml` in blob storage.
2. Parse and store HTML and plain text bodies separately in blob storage.
3. Insert metadata into `inbox_message`.
4. Match to an existing thread via In-Reply-To/References headers. Create a new thread if no match.
5. Update thread's `snippet`, `lastMessageAt`, `messageCount`, `participants`.
6. Dispatch to classification queue/workflow.

**Implementations**: `@rafters/mail-cloudflare` (Cloudflare Email Routing + R2).

---

### EmailProvider (OutboundAdapter)

Sends email via an external provider. Also manages mailing lists, subscribers, and campaigns for newsletter functionality.

```typescript
const emailParamsSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
});

type EmailParams = z.infer<typeof emailParamsSchema>;

interface EmailProvider {
  // Transactional
  sendEmail(params: EmailParams): Promise<{ id: string }>;

  // Mailing lists
  createMailingList(name: string): Promise<MailingList>;
  getMailingList(id: string): Promise<MailingList>;
  deleteMailingList(id: string): Promise<void>;

  // Subscribers
  addSubscriber(listId: string, email: string, data?: SubscriberData): Promise<Subscriber>;
  removeSubscriber(listId: string, subscriberId: string): Promise<void>;
  updateSubscriber(subscriberId: string, updates: SubscriberUpdates): Promise<Subscriber>;
  listSubscribers(listId: string): Promise<Subscriber[]>;

  // Campaigns
  sendCampaign(params: CampaignParams): Promise<{ id: string }>;
  getCampaign(id: string): Promise<{ id: string; subject: string; sentAt: Date }>;
  createCampaignDraft(params: CampaignParams): Promise<{ id: string }>;
  sendCampaignDraft(campaignId: string): Promise<{ id: string }>;
  getCampaignStatus(campaignId: string): Promise<CampaignStatus>;

  // Audiences
  listAudiences(): Promise<Audience[]>;
}
```

#### sendEmail

Send a single transactional email.

| Parameter | Type | Required | Description |
|---|---|---|---|
| params.to | string | Yes | Recipient. |
| params.subject | string | Yes | Subject line. |
| params.html | string | No | HTML body. |
| params.text | string | No | Plain text body. |
| params.from | string | No | Sender override. Uses default if omitted. |
| params.replyTo | string | No | Reply-To address. |

**Returns**: `{ id: string }` -- provider-assigned message ID.

#### Mailing list methods

`createMailingList`, `getMailingList`, `deleteMailingList` manage platform-wide mailing lists. These map to the `platform_audience` table and the provider's concept of audiences/lists.

#### Subscriber methods

`addSubscriber`, `removeSubscriber`, `updateSubscriber`, `listSubscribers` manage individual subscriptions. These map to `platform_subscriber` and the provider's subscriber/contact records.

#### Campaign methods

`sendCampaign` sends immediately. `createCampaignDraft` + `sendCampaignDraft` supports a two-step draft-then-send flow. `getCampaign` and `getCampaignStatus` retrieve campaign state and delivery status.

**Vocabulary mapping**: The core uses platform vocabulary (MailingList, Subscriber, Campaign). Adapter implementations translate to vendor vocabulary at the boundary. Example: Resend uses Audience, Contact, Broadcast.

**Implementations**: `@rafters/mail-resend` (Resend API via fetch).

---

### TemplateRenderer

Renders email templates to HTML and optional plain text.

```typescript
interface TemplateRenderer {
  render(
    template: string,
    props: Record<string, unknown>
  ): Promise<{ html: string; text?: string }>;
}
```

#### render

| Parameter | Type | Required | Description |
|---|---|---|---|
| template | string | Yes | Template identifier (e.g., `'otp'`, `'welcome'`). |
| props | Record<string, unknown> | Yes | Template data. Shape depends on the template. |

**Returns**: `{ html: string; text?: string }`. The `text` field is optional; not all renderers produce a plain text version.

**Implementations**: `@rafters/mail-react-email` (React Email).

---

### EmailClassifier

Classifies email content into categories with confidence scores and auto-generated tags.

```typescript
const emailClassificationSchema = z.object({
  category: z.enum([
    'support', 'feedback', 'abuse', 'partnership',
    'spam', 'billing', 'legal', 'other'
  ]),
  confidence: z.number().min(0).max(100),
  tags: z.array(z.string()),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
});

type EmailClassification = z.infer<typeof emailClassificationSchema>;

interface EmailClassifier {
  classify(
    from: string,
    subject: string,
    body: string
  ): Promise<EmailClassification>;
}
```

#### classify

| Parameter | Type | Required | Description |
|---|---|---|---|
| from | string | Yes | Sender email address. |
| subject | string | Yes | Message subject. |
| body | string | Yes | Plain text body (truncated to classifier's max input length). |

**Returns**: `EmailClassification`.

**Category-to-priority defaults**:
- `abuse`, `legal`: always `high`.
- `support`, `billing`: default `normal`.
- `feedback`, `partnership`: default `normal`.
- `other`: default `low`.
- Keyword overrides can escalate to `urgent` or `high` regardless of category.

**Helper function**:

```typescript
function isLegitimateCategory(category: EmailCategory): boolean;
```

Returns `true` for all categories except `spam`. Used by the inbound flow to decide whether a message stays in the inbox or moves to the spam folder.

**Implementations**: `@rafters/mail-workers-ai` (Cloudflare Workers AI, DeBERTa-v3 zero-shot).

---

### BlobStorage

Stores and retrieves raw email content, parsed bodies, and attachments.

```typescript
interface BlobObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

interface BlobStorage {
  put(
    key: string,
    content: string | ArrayBuffer,
    options?: BlobPutOptions
  ): Promise<void>;

  get(
    key: string,
    options?: BlobGetOptions
  ): Promise<BlobObject | null>;

  delete(key: string): Promise<void>;

  generateKey(contentHash: string, extension: string): string;
}
```

#### put

Store content at a key.

| Parameter | Type | Required | Description |
|---|---|---|---|
| key | string | Yes | Storage key. |
| content | string or ArrayBuffer | Yes | Content to store. |
| options | BlobPutOptions | No | Metadata, content type, etc. |

#### get

Retrieve content by key.

| Parameter | Type | Required | Description |
|---|---|---|---|
| key | string | Yes | Storage key. |
| options | BlobGetOptions | No | Range reads, etc. |

**Returns**: `BlobObject | null`. Null if the key does not exist.

#### delete

Remove content by key.

| Parameter | Type | Required | Description |
|---|---|---|---|
| key | string | Yes | Storage key. |

#### generateKey

Generate a storage key from a content hash and file extension.

| Parameter | Type | Required | Description |
|---|---|---|---|
| contentHash | string | Yes | SHA-256 hash of the content (first 16 chars used). |
| extension | string | Yes | File extension: `eml`, `html`, `txt`. |

**Returns**: `string`. Format: `emails/{year}/{month}/{hash}.{extension}` (month is zero-padded, e.g. `01` not `1`).

**Implementations**: `@rafters/mail-cloudflare` (Cloudflare R2). Community can add S3, GCS, etc.

---

## Threading

RFC 5322 compliant. Gmail-style conversation grouping.

### Message-ID Generation

```typescript
function generateMessageId(domain: string): string;
```

Returns: `<{uuidv7}@{domain}>`. Example: `<01912345-6789-7abc-def0-123456789abc@example.com>`.

UUIDv7 guarantees uniqueness and provides natural time-ordering. The domain portion identifies the originating system.

### References Chain

```typescript
function buildReferences(
  existingReferences: string | null,
  inReplyTo: string | null
): string;
```

Appends the `In-Reply-To` value to the existing `References` chain. If `existingReferences` is null, the result is just the `In-Reply-To` value. If both are null, returns an empty string.

**Example chain for a 4-message thread**:

```
Message 1: Message-ID: <A@ex.com>
Message 2: Message-ID: <B@ex.com>, In-Reply-To: <A@ex.com>, References: <A@ex.com>
Message 3: Message-ID: <C@ex.com>, In-Reply-To: <B@ex.com>, References: <A@ex.com> <B@ex.com>
Message 4: Message-ID: <D@ex.com>, In-Reply-To: <C@ex.com>, References: <A@ex.com> <B@ex.com> <C@ex.com>
```

### Inbound Thread Matching

When a new inbound message arrives:

1. **Check In-Reply-To**: Look up `inbox_message` where `messageId = incomingMessage.inReplyTo`. If found, use that message's `threadId`.
2. **Check References**: If In-Reply-To match fails, iterate the `References` header (newest to oldest) and look for any matching `inbox_message.messageId`. If found, use that message's `threadId`.
3. **New thread**: If no match on either header, create a new `inbox_thread`.

### Snippet Generation

Thread snippet is the first 200 characters of the latest message's plain text body. Updated on every new message (inbound or outbound).

---

## Folders

### System Folders

Created by `FolderService.initSystemFolders()`. Cannot be renamed or deleted.

| Slug | Name | Purpose |
|---|---|---|
| `inbox` | Inbox | Default landing folder for inbound email. |
| `sent` | Sent | Outbound emails. |
| `drafts` | Drafts | Unsent drafts. |
| `spam` | Spam | AI-classified or manually flagged spam. |
| `trash` | Trash | Soft-deleted threads. Auto-purge after 30 days is an app-level concern. |
| `archive` | Archive | Archived conversations. |

### Custom Folders

Created via `FolderService.createFolder()`. `isSystem = 0`. Can be renamed and deleted. Slug is derived from the name.

### Folder Scope

Folders are per-mailbox. Each mailbox has its own complete set of system and custom folders. There are no global or cross-mailbox folders.

### Thread-Folder Relationship

A thread exists in exactly one folder at a time (`inbox_thread.folderId`). Moving a thread moves it entirely. Individual messages do not have their own folder assignment.

---

## Labels

### Three Label Types

**System labels**: Created during mailbox initialization. `isSystem = 1`. Cannot be renamed or deleted.

| Slug | Purpose |
|---|---|
| `important` | High-importance flag. |
| `starred` | User-starred for quick access. |
| `unread` | Tracks unread state at the label level. |

**AI-generated labels**: Created by the EmailClassifier. `isAiGenerated = 1`. Based on regex tag patterns applied during classification. Examples: `bug-report`, `feature-request`, `billing`, `account`.

**User-created labels**: Created via `LabelService.createLabel()`. `isSystem = 0`, `isAiGenerated = 0`. Custom tags for organization.

### Label Application

Labels can be applied to both messages (via `inbox_message_label`) and threads (via `inbox_thread_label`). Both junction tables track:

- **Who applied it**: `appliedBy` column. Null means system or AI.
- **When**: `appliedAt` column.

A label can be applied to a message, a thread, or both independently. Message-level labels are for granular classification. Thread-level labels are for filtering and views.

### Label Uniqueness

The `(mailboxId, slug)` pair is unique. Two labels in different mailboxes can have the same slug. Within a mailbox, each label slug is unique.

---

## Assignments

Thread-level assignment for shared mailbox collaboration.

### Rules

- A thread can have at most one active assignment at a time.
- The active assignment has `status = 'active'`.
- `assign()` fails if an active assignment already exists. Use `reassign()` to change assignees.
- `reassign()` sets the old assignment to `status = 'reassigned'`, soft-deletes it, and creates a new active assignment.
- `complete()` sets `status = 'completed'`. This is a terminal state. The assignment row is not soft-deleted.
- Assignment history is preserved via soft delete on reassignment. Completed assignments remain as active records. This provides a full audit trail.

### Status Values

| Status | Meaning |
|---|---|
| `active` | Currently assigned and in progress. |
| `completed` | Work finished. Terminal state. |
| `reassigned` | Was active, then reassigned to someone else. Soft-deleted. |

### Workflow Integration

When an agent replies to a thread, the app should update the thread status from `open` to `pending` (awaiting customer response). This is an app-level convention, not enforced by core.

---

## Notes

Internal notes on threads. Not visible to external parties. Markdown content.

### Purpose

Team collaboration on shared mailbox threads. Agents can leave context for each other: escalation reasons, customer history, resolution steps.

### Behavior

- Notes belong to a thread (`threadId`).
- Notes have an author (`authorId`). Plain text user ID, no FK.
- Content is Markdown.
- `listNotes()` returns notes ordered by `createdAt` ascending. Excludes soft-deleted notes.
- `deleteNote()` soft-deletes. The note is preserved for audit but hidden from the list.

---

## Newsletter Tables

Three tables for outbound newsletter/broadcast functionality. Separate from the inbox schema but share the same database and the EmailProvider adapter.

### platform_audience

Platform-wide mailing lists.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| name | text | -- | No | Audience name (e.g., "Newsletter", "Product Updates"). |
| providerListId | text | -- | Yes | External ID from the email provider. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| updatedAt | integer | unixepoch('subsecond') * 1000 | No | Last update timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

### platform_subscriber

User subscriptions to platform audiences.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| audienceId | text (FK -> platform_audience.id) | -- | No | Parent audience. |
| userId | text | -- | No | User ID. Plain text, no FK. |
| providerSubscriberId | text | -- | Yes | External ID from the email provider. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Creation timestamp in ms. |
| deletedAt | integer | -- | Yes | Soft delete timestamp. |

**Indexes**: unique on `(audienceId, userId)`.

### broadcast_audit

Compliance trail for sent broadcasts.

| Column | Type | Default | Nullable | Description |
|---|---|---|---|---|
| id | text (PK) | UUIDv7 | No | Primary key. |
| audienceId | text (FK -> platform_audience.id) | -- | No | Target audience. |
| subject | text | -- | No | Broadcast subject line. |
| sentBy | text | -- | No | User ID of who triggered the send. |
| recipientCount | integer | -- | No | Number of recipients at send time. |
| providerCampaignId | text | -- | Yes | External campaign ID from the provider. |
| sentAt | integer | -- | No | Send timestamp in ms. |
| createdAt | integer | unixepoch('subsecond') * 1000 | No | Row creation timestamp in ms. |

### Design Principle

The email provider is the source of truth for subscriber data. These tables store:
- Which audiences exist (registry).
- Which users subscribe to which audiences (mapping).
- Provider identifiers for sync.
- Minimal audit trail for compliance.

These tables do NOT store subscriber email addresses, unsubscribe status, or campaign content. The provider owns that data.

---

## Zod Schemas and Enums

Every table has three Zod schemas: insert, select, update. Types are always inferred via `z.infer<>`, never written as TypeScript interfaces first.

### Enum Schemas

```typescript
const mailboxTypeSchema = z.enum(['personal', 'shared']);
type MailboxType = z.infer<typeof mailboxTypeSchema>;

const threadStatusSchema = z.enum(['open', 'pending', 'resolved', 'closed']);
type ThreadStatus = z.infer<typeof threadStatusSchema>;

const threadPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
type ThreadPriority = z.infer<typeof threadPrioritySchema>;

const aiCategorySchema = z.enum([
  'support', 'feedback', 'abuse', 'partnership',
  'spam', 'billing', 'legal', 'other'
]);
type AiCategory = z.infer<typeof aiCategorySchema>;

const systemFolderSchema = z.enum([
  'inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'
]);
type SystemFolder = z.infer<typeof systemFolderSchema>;
```

### Schema Pattern

For each table (example: `inbox_thread`):

```typescript
// Insert: required fields for creating a record
const insertInboxThreadSchema = z.object({
  mailboxId: z.string().uuid(),
  folderId: z.string().uuid(),
  subject: z.string().min(1),
  // ... other required fields
});

// Select: full record shape as returned from the database
const selectInboxThreadSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  folderId: z.string().uuid(),
  subject: z.string(),
  snippet: z.string().nullable(),
  participants: z.array(z.string()),
  messageCount: z.number(),
  status: threadStatusSchema,
  priority: threadPrioritySchema,
  lastMessageAt: z.number(),
  unreadCount: z.number(),
  startedAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
});

// Update: all fields optional except id
const updateInboxThreadSchema = z.object({
  folderId: z.string().uuid().optional(),
  subject: z.string().min(1).optional(),
  snippet: z.string().optional(),
  // ... other updatable fields
});

// Inferred types
type InsertInboxThread = z.infer<typeof insertInboxThreadSchema>;
type SelectInboxThread = z.infer<typeof selectInboxThreadSchema>;
type UpdateInboxThread = z.infer<typeof updateInboxThreadSchema>;
```

### Exports

All schemas and inferred types are exported from the package. Apps use them for:
- Runtime validation at API boundaries.
- Type inference for service method parameters and return types.
- Mock data generation with Zocker.

---

## Migrations

The package exports raw SQL strings for table creation. It never runs migrations itself. Apps own their migration workflow.

```typescript
import { migrationSQL } from '@rafters/mail/migrations';
```

### Usage with Wrangler (D1)

1. `wrangler d1 migrations create add-mail-tables`
2. Copy `migrationSQL` into the generated `.sql` file.
3. `wrangler d1 migrations apply`

### Upgrade Migrations

When the package adds columns or tables in a new version, apps must generate new migration files with the appropriate `ALTER TABLE` or `CREATE TABLE` statements. The package exports the full current schema SQL, not diffs between versions.

---

## Design Decisions

### Why UUIDv7

UUIDv7 encodes a Unix timestamp in the high bits. IDs are naturally time-ordered, which means:
- B-tree indexes on ID columns are insert-optimized (new rows append, no page splits).
- IDs double as coarse timestamps for ordering.
- No coordination required for ID generation (no auto-increment, no sequence table).

### Why integer timestamps in milliseconds

SQLite has no native datetime type. Storing millisecond timestamps as integers avoids timezone ambiguity, string parsing overhead, and SQLite's inconsistent date function behavior. The `unixepoch('subsecond') * 1000` default generates values server-side.

### Why soft delete everywhere

Audit trail. Email systems need to answer "what happened and when." Hard deletes destroy evidence. Soft deletes preserve history while keeping it out of default queries. The `deletedAt IS NULL` filter is the convention for all read operations.

### Why plain text user IDs with no FK

The mail schema is designed to work with any auth system. Foreign keys to a `user` table would create a hard dependency on a specific auth schema. Plain text user IDs let the AuthAdapter resolve identity at runtime. Trade-off: no referential integrity at the database level. Accepted because the AuthAdapter enforces validity at the application level.

### Why JSON columns

SQLite stores JSON as text. Drizzle's `mode: 'json'` handles serialization/deserialization transparently. For `participants`, `ccEmails`, and `bccEmails`, the alternative would be separate junction tables. JSON columns are simpler for read-heavy workloads where the data is always loaded with the parent row. Trade-off: no indexed lookups on individual array elements. Accepted because these fields are displayed, not queried.

### Why no barrel files

Edge runtimes have bundle size constraints (Cloudflare Workers: 1MB compressed). Barrel exports (`index.ts` re-exporting everything) pull the entire module graph into every consumer. Subpath exports in `package.json` let consumers import exactly what they need. Example: `import { threadStatusSchema } from '@rafters/mail/schemas'` loads only the schemas, not the Drizzle tables or service interfaces.

### Why Zod is source of truth

Types inferred from Zod schemas via `z.infer<>` guarantee that runtime validation and compile-time types are always in sync. Writing TypeScript interfaces first and then duplicating the shape in Zod is a maintenance burden and a bug vector. Zod-first means one definition, two outputs (types + validation). This also enables mock data generation with Zocker for testing.