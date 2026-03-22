// Raw SQL migration for all 10 inbox tables.
// Apps copy this into their own migration files.
// This package never runs migrations directly.

export const migrationSQL = `
-- Mailbox
CREATE TABLE IF NOT EXISTS mailbox (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal',
  email_address TEXT NOT NULL,
  local_part TEXT NOT NULL,
  display_name TEXT,
  owner_id TEXT,
  organization_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
  auto_reply_subject TEXT,
  auto_reply_body TEXT,
  forward_to_email TEXT,
  forward_enabled INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  description TEXT,
  icon TEXT,
  color TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS mailbox_owner_id_idx ON mailbox (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_email_address_idx ON mailbox (email_address);
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_local_part_idx ON mailbox (local_part);
CREATE INDEX IF NOT EXISTS mailbox_type_idx ON mailbox (type);
CREATE INDEX IF NOT EXISTS mailbox_organization_id_idx ON mailbox (organization_id);

-- Inbox Folder
CREATE TABLE IF NOT EXISTS inbox_folder (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailbox (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_folder_mailbox_slug_idx ON inbox_folder (mailbox_id, slug);
CREATE INDEX IF NOT EXISTS inbox_folder_mailbox_id_idx ON inbox_folder (mailbox_id);

-- Inbox Label
CREATE TABLE IF NOT EXISTS inbox_label (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT REFERENCES mailbox (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_label_mailbox_slug_idx ON inbox_label (mailbox_id, slug);
CREATE INDEX IF NOT EXISTS inbox_label_mailbox_id_idx ON inbox_label (mailbox_id);

-- Inbox Thread
CREATE TABLE IF NOT EXISTS inbox_thread (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailbox (id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  snippet TEXT,
  participants TEXT,
  message_count INTEGER NOT NULL DEFAULT 1,
  unread_count INTEGER NOT NULL DEFAULT 1,
  folder_id TEXT REFERENCES inbox_folder (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  started_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  last_message_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  archived_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS inbox_thread_mailbox_id_idx ON inbox_thread (mailbox_id);
CREATE INDEX IF NOT EXISTS inbox_thread_folder_id_idx ON inbox_thread (folder_id);
CREATE INDEX IF NOT EXISTS inbox_thread_last_message_at_idx ON inbox_thread (last_message_at);
CREATE INDEX IF NOT EXISTS inbox_thread_mailbox_folder_idx ON inbox_thread (mailbox_id, folder_id);
CREATE INDEX IF NOT EXISTS inbox_thread_status_idx ON inbox_thread (status);
CREATE INDEX IF NOT EXISTS inbox_thread_priority_idx ON inbox_thread (priority);

-- Inbox Message
CREATE TABLE IF NOT EXISTS inbox_message (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailbox (id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES inbox_thread (id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  "references" TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  cc_emails TEXT,
  bcc_emails TEXT,
  reply_to_email TEXT,
  subject TEXT NOT NULL,
  snippet TEXT,
  blob_key_raw TEXT NOT NULL,
  blob_key_html TEXT,
  blob_key_text TEXT,
  is_outbound INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  ai_category TEXT,
  ai_confidence INTEGER,
  ai_summary TEXT,
  is_spam INTEGER NOT NULL DEFAULT 0,
  spam_score INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  sent_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS inbox_message_mailbox_id_idx ON inbox_message (mailbox_id);
CREATE INDEX IF NOT EXISTS inbox_message_thread_id_idx ON inbox_message (thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_message_message_id_idx ON inbox_message (message_id);
CREATE INDEX IF NOT EXISTS inbox_message_from_email_idx ON inbox_message (from_email);
CREATE INDEX IF NOT EXISTS inbox_message_received_at_idx ON inbox_message (received_at);
CREATE INDEX IF NOT EXISTS inbox_message_mailbox_received_idx ON inbox_message (mailbox_id, received_at);
CREATE INDEX IF NOT EXISTS inbox_message_ai_category_idx ON inbox_message (ai_category);

-- Inbox Message Label
CREATE TABLE IF NOT EXISTS inbox_message_label (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES inbox_message (id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES inbox_label (id) ON DELETE CASCADE,
  applied_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  applied_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_message_label_unique ON inbox_message_label (message_id, label_id);
CREATE INDEX IF NOT EXISTS inbox_message_label_message_id_idx ON inbox_message_label (message_id);
CREATE INDEX IF NOT EXISTS inbox_message_label_label_id_idx ON inbox_message_label (label_id);

-- Inbox Thread Label
CREATE TABLE IF NOT EXISTS inbox_thread_label (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES inbox_thread (id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES inbox_label (id) ON DELETE CASCADE,
  applied_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  applied_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_thread_label_unique ON inbox_thread_label (thread_id, label_id);
CREATE INDEX IF NOT EXISTS inbox_thread_label_thread_id_idx ON inbox_thread_label (thread_id);
CREATE INDEX IF NOT EXISTS inbox_thread_label_label_id_idx ON inbox_thread_label (label_id);

-- Inbox Attachment
CREATE TABLE IF NOT EXISTS inbox_attachment (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL REFERENCES inbox_message (id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  content_id TEXT,
  is_inline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS inbox_attachment_message_id_idx ON inbox_attachment (message_id);
CREATE INDEX IF NOT EXISTS inbox_attachment_content_id_idx ON inbox_attachment (content_id);

-- Thread Assignment
CREATE TABLE IF NOT EXISTS thread_assignment (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES inbox_thread (id) ON DELETE CASCADE,
  assignee_id TEXT NOT NULL,
  assigned_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  assigned_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  completed_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS thread_assignment_thread_id_idx ON thread_assignment (thread_id);
CREATE INDEX IF NOT EXISTS thread_assignment_assignee_id_idx ON thread_assignment (assignee_id);
CREATE INDEX IF NOT EXISTS thread_assignment_status_idx ON thread_assignment (status);
CREATE INDEX IF NOT EXISTS thread_assignment_thread_status_idx ON thread_assignment (thread_id, status);

-- Thread Note
CREATE TABLE IF NOT EXISTS thread_note (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES inbox_thread (id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS thread_note_thread_id_idx ON thread_note (thread_id);
CREATE INDEX IF NOT EXISTS thread_note_author_id_idx ON thread_note (author_id);
`;
