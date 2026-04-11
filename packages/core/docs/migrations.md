# Migrations

How the database schema is created and updated.

---

## Design principle

@rafters/mail exports raw SQL migration strings. It does not run migrations. Your deployment tool is responsible for applying them to your database.

This separation means the framework works with any SQLite-compatible database without assuming a specific migration runner.

---

## Schema

The core schema has 13 tables across two domains:

### Inbox tables (10)

| Table | Purpose |
|---|---|
| mailbox | Email addresses that send and receive |
| inbox_folder | Folders per mailbox (inbox, sent, drafts, spam, trash, archive) |
| inbox_label | Labels for categorization (system and custom) |
| inbox_thread | Conversation threads |
| inbox_message | Individual email messages |
| inbox_message_label | Message-to-label associations |
| inbox_thread_label | Thread-to-label associations |
| inbox_attachment | File attachments |
| thread_assignment | Team member assignments to threads |
| thread_note | Internal notes on threads |

### Newsletter tables (3)

| Table | Purpose |
|---|---|
| mailing_list | Named subscriber lists |
| subscriber | People on mailing lists |
| campaign | Broadcast messages sent to lists |

---

## System folders

When a mailbox is created, these folders are initialized automatically:

| Folder | Slug | Purpose |
|---|---|---|
| Inbox | inbox | Default landing for incoming email |
| Sent | sent | Outbound messages |
| Drafts | drafts | Unsent compositions |
| Spam | spam | Spam-classified messages |
| Trash | trash | Soft-deleted messages |
| Archive | archive | Archived threads |

System folders cannot be deleted. Custom folders can be created by the user.

---

## Conventions

All tables follow these conventions:

- **IDs**: UUIDv7 via default function. Text primary keys. Timestamp-ordered.
- **Timestamps**: integer milliseconds.
- **Soft delete**: every table has deletedAt. Null means active.
- **JSON columns**: SQLite text with JSON mode. Parsed at read time.
- **User references**: plain text columns (ownerId, assigneeId, etc.). No foreign keys to external auth tables. The auth adapter resolves identity at runtime.

---

## Applying migrations

The migration SQL strings are exported from the core package. Apply them with whatever tool manages your database.

The schema is designed to be extended. Add columns to existing tables or create new tables for your application. The core schema provides email infrastructure. Your application adds business logic on top.

Foreign keys from your tables to mail tables work normally. Foreign keys from mail tables to your tables are intentionally avoided (the ownerId pattern) to keep the core decoupled.
