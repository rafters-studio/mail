-- Who may log in, and who keeps failing. NIST SP 800-132 5.1: "The length of the randomly-generated
-- portion of the salt shall be at least 128 bits." So each login holds its own 16 bytes.
CREATE TABLE imap_logins (
  user TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL REFERENCES mailboxes(id),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);
-- Keyed by "user:<sha256 of user>:<address>" and by "address:<address>".
CREATE TABLE imap_login_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
