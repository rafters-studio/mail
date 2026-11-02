-- Every mailbox's Sent, and what links a send back. RFC 6409 8: "Sites MAY modify submissions to ensure
-- compliance with standards and site policy." So the bytes kept are the bytes sent, not those received.
INSERT OR IGNORE INTO mailboxes (id) SELECT id || '/Sent' FROM mailboxes WHERE id NOT LIKE '%/Sent';
-- What links a send back to the person, its subject, its visible id and its bytes.
CREATE TABLE submissions (
  hold_key TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL REFERENCES mailboxes(id),
  message_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  blob TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX submissions_message_id ON submissions (message_id);
