# Migrations

How the database schema is created and updated.

---

## Design principle

@rafters/mail exports raw SQL migration strings. It does not run migrations. Your deployment tool is responsible for applying them to your database.

This separation means the framework works with any SQLite-compatible database without assuming a specific migration runner.

---

## Schema

The core schema currently ships **10 inbox tables** in the exported migration SQL. An additional 3 newsletter tables are defined in the Drizzle schema but are not yet part of the migration SQL and are not written to by any shipped service -- they are reserved for future platform-side broadcast tracking and can be ignored at install time.

### Inbox tables (10) -- in `migrationSQL`

| Table                 | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `mailbox`             | Email addresses that send and receive                           |
| `inbox_folder`        | Folders per mailbox (inbox, sent, drafts, spam, trash, archive) |
| `inbox_label`         | Labels for categorization (system and custom)                   |
| `inbox_thread`        | Conversation threads                                            |
| `inbox_message`       | Individual email messages                                       |
| `inbox_message_label` | Message-to-label associations                                   |
| `inbox_thread_label`  | Thread-to-label associations                                    |
| `inbox_attachment`    | File attachments                                                |
| `thread_assignment`   | Team member assignments to threads                              |
| `thread_note`         | Internal notes on threads                                       |

### Newsletter tables (3) -- schema-only, NOT in `migrationSQL`

| Table                 | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `platform_audience`   | Platform-side mirror of the provider's mailing list |
| `platform_subscriber` | Platform-side mirror of a subscriber on an audience |
| `broadcast_audit`     | Audit trail for campaign sends                      |

These are available as Zod row schemas (`platformAudienceRowSchema`, `platformSubscriberRowSchema`, `broadcastAuditRowSchema` from `@rafters/mail`) and as Drizzle table definitions (`platformAudience`, `platformSubscriber`, `broadcastAudit` from `@rafters/mail-drizzle`) if you want to include them in your own migrations, but the shipped `migrationSQL` string does not create them. The `EmailProvider` mailing list / subscriber / campaign methods talk to the provider's API (Resend, etc.), not to these tables.

---

## System folders

System folders are not created automatically at migration time. Apply the migration, create a mailbox, then call `FolderService.initSystemFolders(mailboxId)` to populate the following folders for that mailbox:

| Folder  | Slug      | Purpose                            |
| ------- | --------- | ---------------------------------- |
| Inbox   | `inbox`   | Default landing for incoming email |
| Sent    | `sent`    | Outbound messages                  |
| Drafts  | `drafts`  | Unsent compositions                |
| Spam    | `spam`    | Spam-classified messages           |
| Trash   | `trash`   | Soft-deleted messages              |
| Archive | `archive` | Archived threads                   |

System folders have `isSystem = true` and cannot be deleted via `FolderService.delete`. Custom folders can be created with `FolderService.create`.

---

## Conventions

All tables follow these conventions:

- **IDs**: UUIDv7 via default function. Text primary keys. Timestamp-ordered, so sort-by-id is chronological.
- **Timestamps**: `integer` with `mode: 'timestamp_ms'`, default `unixepoch('subsecond') * 1000`. Millisecond precision.
- **Soft delete**: all tables have `deletedAt` except the two label join tables (`inbox_message_label`, `inbox_thread_label`), where deletion is a direct row removal because there is nothing semantic to "soft delete" -- a label is either applied or not.
- **JSON columns**: SQLite `text` with `mode: 'json'`. Stored as serialized JSON strings, parsed at read time.
- **User references**: plain `text` columns (`ownerId`, `assigneeId`, `authorId`, `appliedBy`, etc.). No foreign keys to external auth tables. The `AuthAdapter` resolves identity at runtime.

---

## Applying migrations

The migration SQL strings are exported from the core package. Apply them with whatever tool manages your database.

The schema is designed to be extended. Add columns to existing tables or create new tables for your application. The core schema provides email infrastructure. Your application adds business logic on top.

Foreign keys from your tables to mail tables work normally. Foreign keys from mail tables to your tables are intentionally avoided (the ownerId pattern) to keep the core decoupled.
