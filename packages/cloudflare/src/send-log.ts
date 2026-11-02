// The send log on D1 (RFC 1047): "If the communications link fails during this synchronization
// gap, then the message has been duplicated." So a row says unknown until the server's reply is
// recorded, and one statement claims a recipient, which is what makes a claim atomic.
import {
  type Events,
  type Outcome,
  outcomeSchema,
  sendEventSchema,
  type SendEvent,
  type Sends,
} from "@rafters/mail/send";
import { z } from "zod";
import type { D1Like } from "./d1.ts";

export type History = { outcomes: Outcome[]; events: SendEvent[] };

type Row = Record<string, unknown>;
type Columns = {
  state: Outcome["kind"];
  final: number | null;
  stage: string | null;
  code: number | null;
  text: string | null;
  providerId: string | null;
};
type ByKind = { [O in Outcome as O["kind"]]: O };
type OutcomeOf<K extends keyof ByKind> = { [P in K]: ByKind[P] }[K];

const COLUMNS: { [K in keyof ByKind]: (outcome: ByKind[K]) => Columns } = {
  accepted: ({ providerId, text }) => ({
    state: "accepted",
    final: null,
    stage: null,
    code: null,
    text,
    providerId,
  }),
  refused: ({ final, stage, code, text }) => ({
    state: "refused",
    final: Number(final),
    stage,
    code,
    text,
    providerId: null,
  }),
  // The state stays unknown: only the server's reply can end it.
  unknown: ({ detail }) => ({
    state: "unknown",
    final: null,
    stage: null,
    code: null,
    text: detail,
    providerId: null,
  }),
};

/** Form 01a19d25: the columns of one outcome, a lookup on its kind rather than a chain. */
function columns<K extends keyof ByKind>(outcome: OutcomeOf<K> & { kind: K }): Columns {
  const write: (outcome: ByKind[K]) => Columns = COLUMNS[outcome.kind];
  return write(outcome);
}

/**
 * RFC 1047 and form 01a19d25: `claim` is one statement, taking a new row or a row refused and not
 * final. `settle` changes only an unknown row, so an attempt outliving a hand release cannot
 * overwrite a later result.
 */
export function d1Sends(db: D1Like): Sends {
  return {
    claim: async ({ messageId, recipient, mailFrom, provider, at }) => {
      const row = await db
        .prepare(
          `INSERT INTO sends (message_id, recipient, mail_from, provider, state, updated_at)
VALUES (?, ?, ?, ?, 'unknown', ?)
ON CONFLICT (message_id, recipient) DO UPDATE SET
  provider = excluded.provider, state = 'unknown', final = NULL, stage = NULL,
  code = NULL, text = NULL, provider_id = NULL, updated_at = excluded.updated_at
WHERE sends.state = 'refused' AND sends.final = 0
RETURNING recipient`,
        )
        .bind(messageId, recipient, mailFrom, provider, at.toISOString())
        .first();
      return row !== null;
    },
    settle: async (messageId, outcome, at) => {
      const { state, final, stage, code, text, providerId } = columns(outcome);
      await db
        .prepare(
          `UPDATE sends SET state = ?, final = ?, stage = ?, code = ?, text = ?, provider_id = ?, updated_at = ?
WHERE message_id = ? AND recipient = ? AND state = 'unknown'`,
        )
        .bind(
          state,
          final,
          stage,
          code,
          text,
          providerId,
          at.toISOString(),
          messageId,
          outcome.recipient,
        )
        .run();
    },
  };
}

/** Form 01a19d25: a second row for the same (provider, event id, recipient) does nothing. */
export function d1Events(db: D1Like): Events {
  return {
    record: async (event) => {
      const permanent = event.permanent === null ? null : Number(event.permanent);
      await db
        .prepare(
          `INSERT INTO send_events (provider, event_id, recipient, kind, at, message_id, provider_id, permanent, smtp_code, smtp_enhanced, smtp_text, detail)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (provider, event_id, recipient) DO NOTHING`,
        )
        .bind(
          event.provider,
          event.eventId,
          event.recipient,
          event.kind,
          event.at.toISOString(),
          event.messageId,
          event.providerId,
          permanent,
          event.smtp?.code ?? null,
          event.smtp?.enhanced ?? null,
          event.smtp?.text ?? null,
          event.detail,
        )
        .run();
    },
  };
}

const READ: Record<Outcome["kind"], (row: Row) => unknown> = {
  accepted: ({ recipient, provider_id: providerId, text }) => ({
    recipient,
    kind: "accepted",
    providerId,
    text,
  }),
  refused: ({ recipient, final, stage, code, text }) => ({
    recipient,
    kind: "refused",
    final: final === 1,
    stage,
    code,
    text,
  }),
  // A crash row: claimed and never settled.
  unknown: ({ recipient, text }) => ({
    recipient,
    kind: "unknown",
    detail: text ?? "no answer recorded",
  }),
};
const stateSchema = z.object({ state: z.enum(["accepted", "refused", "unknown"]) });

/** Form 01a19d25: a row of `send_events` as an event; a row that fails its schema throws. */
function eventFrom(row: Row): SendEvent {
  return sendEventSchema.parse({
    provider: row.provider,
    eventId: row.event_id,
    kind: row.kind,
    recipient: row.recipient,
    at: new Date(String(row.at)),
    messageId: row.message_id,
    providerId: row.provider_id,
    permanent: row.permanent === null ? null : row.permanent === 1,
    smtp:
      row.smtp_code === null
        ? null
        : { code: row.smtp_code, enhanced: row.smtp_enhanced, text: row.smtp_text },
    detail: row.detail,
  });
}

/** Form 01a19d25: a row of `sends` as its outcome; a row that fails its schema throws. */
export function outcomeFrom(row: Row): Outcome {
  return outcomeSchema.parse(READ[stateSchema.parse(row).state](row));
}

/**
 * Form 01a19d25: a message's rows as outcomes, by recipient, and every event whose `message_id` is
 * its id or whose (provider, provider_id) matches one of its rows, by `at`. Resend reports our
 * Message-ID; Cloudflare reports its own id, which the row holds.
 */
export function d1History(db: D1Like): (messageId: string) => Promise<History> {
  return async (messageId) => {
    const sends = await db
      .prepare(
        "SELECT recipient, state, final, stage, code, text, provider_id FROM sends WHERE message_id = ? ORDER BY recipient",
      )
      .bind(messageId)
      .all();
    const events = await db
      .prepare(
        `SELECT e.* FROM send_events e WHERE e.message_id = ? OR EXISTS (
  SELECT 1 FROM sends s WHERE s.message_id = ? AND s.provider = e.provider AND s.provider_id = e.provider_id
) ORDER BY e.at`,
      )
      .bind(messageId, messageId)
      .all();
    return {
      outcomes: sends.results.map(outcomeFrom),
      events: events.results.map(eventFrom),
    };
  };
}
