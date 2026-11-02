-- The send log's tables. RFC 1047: "Until the sending mailer gets the 250 reply, it must assume the message was not
-- delivered." Mail assumes neither: until the reply, the row says unknown.
CREATE TABLE sends (
  message_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  mail_from TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unknown', 'accepted', 'refused')),
  final INTEGER CHECK (final IN (0, 1)),
  stage TEXT CHECK (stage IN ('connect', 'greeting', 'ehlo', 'auth', 'mail', 'rcpt', 'data', 'provider')),
  code INTEGER,
  text TEXT,
  provider_id TEXT,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'refused') = (final IS NOT NULL)),
  CHECK ((state = 'refused') = (stage IS NOT NULL)),
  PRIMARY KEY (message_id, recipient)
);
CREATE INDEX sends_provider_id ON sends (provider, provider_id);
CREATE TABLE send_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivered', 'delayed', 'bounced', 'complained', 'failed')),
  at TEXT NOT NULL,
  message_id TEXT,
  provider_id TEXT,
  permanent INTEGER CHECK (permanent IN (0, 1)),
  smtp_code TEXT,
  smtp_enhanced TEXT,
  smtp_text TEXT,
  detail TEXT,
  PRIMARY KEY (provider, event_id, recipient)
);
CREATE INDEX send_events_message ON send_events (message_id);
CREATE INDEX send_events_provider_id ON send_events (provider, provider_id);
