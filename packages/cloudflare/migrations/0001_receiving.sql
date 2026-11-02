-- RFC 5321 4.5.1: "Any system that includes an SMTP server supporting mail
-- relaying or delivery MUST support the reserved mailbox postmaster". Every domain names its
-- postmaster mailbox; the bytes live in R2 under their SHA-256, and deliveries records which
-- mailbox each copy is for.
CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  mask_form TEXT NOT NULL DEFAULT 'words-digits' CHECK (mask_form IN ('words', 'words-digits')),
  mask_separator TEXT NOT NULL DEFAULT 'period' CHECK (mask_separator IN ('camel', 'underscore', 'period'))
);
CREATE TABLE domains (
  name TEXT PRIMARY KEY,
  postmaster TEXT NOT NULL REFERENCES mailboxes(id),
  catch_all TEXT REFERENCES mailboxes(id),
  masking INTEGER NOT NULL DEFAULT 0 CHECK (masking IN (0, 1))
);
CREATE TABLE addresses (
  local TEXT NOT NULL,
  domain TEXT NOT NULL REFERENCES domains(name),
  mailbox TEXT NOT NULL REFERENCES mailboxes(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  mask_shown TEXT,
  mask_label TEXT,
  mask_created_at TEXT,
  CHECK ((mask_shown IS NULL) = (mask_label IS NULL) AND (mask_label IS NULL) = (mask_created_at IS NULL)),
  PRIMARY KEY (local, domain)
);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  mailbox TEXT NOT NULL REFERENCES mailboxes(id),
  mail_from TEXT,
  rcpt_to TEXT NOT NULL,
  received_at TEXT NOT NULL,
  via TEXT NOT NULL,
  UNIQUE (blob, mailbox)
);
