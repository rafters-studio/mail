import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import type { AiCategory, AssignmentStatus, MailboxType, ThreadPriority, ThreadStatus } from './enums.js';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' }).default(
    sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
  );

const requiredTimestamp = (name: string) =>
  timestamp(name).notNull();

const deletedAt = () => integer('deleted_at', { mode: 'timestamp_ms' });

// ===== MAILBOX =====

export const mailbox = sqliteTable(
  'mailbox',
  {
    id: id(),
    type: text('type').$type<MailboxType>().notNull().default('personal'),
    emailAddress: text('email_address').notNull(),
    localPart: text('local_part').notNull(),
    displayName: text('display_name'),
    ownerId: text('owner_id'),
    organizationId: text('organization_id').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    autoReplyEnabled: integer('auto_reply_enabled', { mode: 'boolean' }).notNull().default(false),
    autoReplySubject: text('auto_reply_subject'),
    autoReplyBody: text('auto_reply_body'),
    forwardToEmail: text('forward_to_email'),
    forwardEnabled: integer('forward_enabled', { mode: 'boolean' }).notNull().default(false),
    signature: text('signature'),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    createdAt: requiredTimestamp('created_at'),
    updatedAt: requiredTimestamp('updated_at').$onUpdate(() => new Date()),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('mailbox_owner_id_idx').on(table.ownerId),
    uniqueIndex('mailbox_email_address_idx').on(table.emailAddress),
    uniqueIndex('mailbox_local_part_idx').on(table.localPart),
    index('mailbox_type_idx').on(table.type),
    index('mailbox_organization_id_idx').on(table.organizationId),
  ],
);

// ===== INBOX FOLDER =====

export const inboxFolder = sqliteTable(
  'inbox_folder',
  {
    id: id(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'),
    color: text('color'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: requiredTimestamp('created_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('inbox_folder_mailbox_slug_idx').on(table.mailboxId, table.slug),
    index('inbox_folder_mailbox_id_idx').on(table.mailboxId),
  ],
);

// ===== INBOX LABEL =====

export const inboxLabel = sqliteTable(
  'inbox_label',
  {
    id: id(),
    mailboxId: text('mailbox_id').references(() => mailbox.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color'),
    icon: text('icon'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    isAiGenerated: integer('is_ai_generated', { mode: 'boolean' }).notNull().default(false),
    createdAt: requiredTimestamp('created_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('inbox_label_mailbox_slug_idx').on(table.mailboxId, table.slug),
    index('inbox_label_mailbox_id_idx').on(table.mailboxId),
  ],
);

// ===== INBOX THREAD =====

export const inboxThread = sqliteTable(
  'inbox_thread',
  {
    id: id(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    snippet: text('snippet'),
    participants: text('participants', { mode: 'json' }).$type<string[]>(),
    messageCount: integer('message_count').notNull().default(1),
    unreadCount: integer('unread_count').notNull().default(1),
    folderId: text('folder_id').references(() => inboxFolder.id, { onDelete: 'set null' }),
    status: text('status').$type<ThreadStatus>().notNull().default('open'),
    priority: text('priority').$type<ThreadPriority>().notNull().default('normal'),
    startedAt: requiredTimestamp('started_at'),
    lastMessageAt: requiredTimestamp('last_message_at'),
    updatedAt: requiredTimestamp('updated_at').$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('inbox_thread_mailbox_id_idx').on(table.mailboxId),
    index('inbox_thread_folder_id_idx').on(table.folderId),
    index('inbox_thread_last_message_at_idx').on(table.lastMessageAt),
    index('inbox_thread_mailbox_folder_idx').on(table.mailboxId, table.folderId),
    index('inbox_thread_status_idx').on(table.status),
    index('inbox_thread_priority_idx').on(table.priority),
  ],
);

// ===== INBOX MESSAGE =====

export const inboxMessage = sqliteTable(
  'inbox_message',
  {
    id: id(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThread.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    toEmail: text('to_email').notNull(),
    toName: text('to_name'),
    ccEmails: text('cc_emails', { mode: 'json' }).$type<string[]>(),
    bccEmails: text('bcc_emails', { mode: 'json' }).$type<string[]>(),
    replyToEmail: text('reply_to_email'),
    subject: text('subject').notNull(),
    snippet: text('snippet'),
    blobKeyRaw: text('blob_key_raw').notNull(),
    blobKeyHtml: text('blob_key_html'),
    blobKeyText: text('blob_key_text'),
    isOutbound: integer('is_outbound', { mode: 'boolean' }).notNull().default(false),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
    aiCategory: text('ai_category').$type<AiCategory>(),
    aiConfidence: integer('ai_confidence'),
    aiSummary: text('ai_summary'),
    isSpam: integer('is_spam', { mode: 'boolean' }).notNull().default(false),
    spamScore: integer('spam_score'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    attachmentCount: integer('attachment_count').notNull().default(0),
    receivedAt: requiredTimestamp('received_at'),
    sentAt: timestamp('sent_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('inbox_message_mailbox_id_idx').on(table.mailboxId),
    index('inbox_message_thread_id_idx').on(table.threadId),
    uniqueIndex('inbox_message_message_id_idx').on(table.messageId),
    index('inbox_message_from_email_idx').on(table.fromEmail),
    index('inbox_message_received_at_idx').on(table.receivedAt),
    index('inbox_message_mailbox_received_idx').on(table.mailboxId, table.receivedAt),
    index('inbox_message_ai_category_idx').on(table.aiCategory),
  ],
);

// ===== INBOX MESSAGE LABEL =====

export const inboxMessageLabel = sqliteTable(
  'inbox_message_label',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => inboxMessage.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => inboxLabel.id, { onDelete: 'cascade' }),
    appliedAt: requiredTimestamp('applied_at'),
    appliedBy: text('applied_by'),
  },
  (table) => [
    uniqueIndex('inbox_message_label_unique').on(table.messageId, table.labelId),
    index('inbox_message_label_message_id_idx').on(table.messageId),
    index('inbox_message_label_label_id_idx').on(table.labelId),
  ],
);

// ===== INBOX THREAD LABEL =====

export const inboxThreadLabel = sqliteTable(
  'inbox_thread_label',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThread.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => inboxLabel.id, { onDelete: 'cascade' }),
    appliedAt: requiredTimestamp('applied_at'),
    appliedBy: text('applied_by'),
  },
  (table) => [
    uniqueIndex('inbox_thread_label_unique').on(table.threadId, table.labelId),
    index('inbox_thread_label_thread_id_idx').on(table.threadId),
    index('inbox_thread_label_label_id_idx').on(table.labelId),
  ],
);

// ===== INBOX ATTACHMENT =====

export const inboxAttachment = sqliteTable(
  'inbox_attachment',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => inboxMessage.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    blobKey: text('blob_key').notNull(),
    contentId: text('content_id'),
    isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
    createdAt: requiredTimestamp('created_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('inbox_attachment_message_id_idx').on(table.messageId),
    index('inbox_attachment_content_id_idx').on(table.contentId),
  ],
);

// ===== THREAD ASSIGNMENT =====

export const threadAssignment = sqliteTable(
  'thread_assignment',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThread.id, { onDelete: 'cascade' }),
    assigneeId: text('assignee_id').notNull(),
    assignedBy: text('assigned_by'),
    status: text('status').$type<AssignmentStatus>().notNull().default('active'),
    note: text('note'),
    assignedAt: requiredTimestamp('assigned_at'),
    completedAt: timestamp('completed_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('thread_assignment_thread_id_idx').on(table.threadId),
    index('thread_assignment_assignee_id_idx').on(table.assigneeId),
    index('thread_assignment_status_idx').on(table.status),
    index('thread_assignment_thread_status_idx').on(table.threadId, table.status),
  ],
);

// ===== THREAD NOTE =====

export const threadNote = sqliteTable(
  'thread_note',
  {
    id: id(),
    threadId: text('thread_id')
      .notNull()
      .references(() => inboxThread.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    content: text('content').notNull(),
    createdAt: requiredTimestamp('created_at'),
    updatedAt: requiredTimestamp('updated_at').$onUpdate(() => new Date()),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('thread_note_thread_id_idx').on(table.threadId),
    index('thread_note_author_id_idx').on(table.authorId),
  ],
);
