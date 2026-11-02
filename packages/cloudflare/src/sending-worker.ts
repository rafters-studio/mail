// The Worker that hears what happened (Cloudflare Queues docs): "You can also call `retry()` to
// explicitly force a message to be redelivered in a subsequent batch." So one bad event does not
// redeliver its batch. Email Routing lists a Worker only when it has `email` alone, so events cannot
// live in the receiving Worker: this is a second one, with `fetch` and `queue` and no `email`.
import type { SendEvent } from "@rafters/mail/send";
import { writeNotice } from "@rafters/mail/submit";
import { z } from "zod";
import type { D1Like } from "./d1.ts";
import { fromCloudflare } from "./events.ts";
import type { MailboxStub, NamespaceOf } from "./imap-objects.ts";
import type { R2Like } from "./r2.ts";
import { d1Events } from "./send-log.ts";
import { deliverNotice } from "./submit-object.ts";

export type QueueBatch = {
  readonly messages: readonly { readonly body: unknown; ack(): void; retry(): void }[];
};
export type SendingBindings = {
  MAIL_DB: D1Like;
  MAIL_BLOBS?: R2Like;
  IMAP_MAILBOX?: NamespaceOf<Pick<MailboxStub, "ping">>;
};
// Each webhook handles its own path, /webhooks/<key>, and returns the events to record,
// or null when the request is not authentic. E is the Worker's own env, so a handler
// can read its secret.
export type Webhooks<E extends SendingBindings> = Record<
  string,
  (request: Request, env: E) => Promise<SendEvent[] | null>
>;

const PREFIX = "/webhooks/";
// `provider_id` is written only after the transport returns, and a bounce can beat it.
const UNTRACED_MS = 3_600_000;
const appSendSchema = z.object({ mail_from: z.string(), mailbox: z.string(), subject: z.string() });

/**
 * RFC 5321 6.1 and form 01a19de8, A later bounce: the send an event is about, by the provider's id,
 * then the visible id of a submission, then a send's own id, which is how a provider reports mail not
 * from an app. The mailbox comes from `submissions`, never the directory, so an address since moved
 * cannot tell another person.
 */
function traced(db: D1Like, event: SendEvent): Promise<Record<string, unknown> | null> {
  return db
    .prepare(
      `SELECT s.mail_from, sub.mailbox, sub.subject FROM sends s
LEFT JOIN submissions sub ON sub.hold_key = s.message_id WHERE s.provider = ? AND s.provider_id = ?
UNION ALL
SELECT s.mail_from, sub.mailbox, sub.subject FROM submissions sub
JOIN sends s ON s.message_id = sub.hold_key WHERE sub.message_id = ?
UNION ALL
SELECT mail_from, NULL, NULL FROM sends WHERE message_id = ?
LIMIT 1`,
    )
    .bind(event.provider, event.providerId, event.messageId, event.messageId)
    .first();
}

/**
 * RFC 5321 6.1: "If there is a delivery failure after acceptance of a message, the receiver-SMTP MUST
 * formulate and mail a notification message." It runs even when recording did nothing, since a crash
 * between them must not lose it on redelivery, and the notice's key collapses a repeat. A failure
 * throws, so a queue retries and a webhook answers 500. So does an untraced event within the hour;
 * older, it is logged. Mail not from an app tells nobody.
 */
async function tell(event: SendEvent, env: SendingBindings): Promise<void> {
  const { MAIL_DB, MAIL_BLOBS, IMAP_MAILBOX } = env;
  if (MAIL_BLOBS === undefined || IMAP_MAILBOX === undefined) return;
  if (event.kind !== "bounced" && event.kind !== "failed") return;
  const row = await traced(MAIL_DB, event);
  if (row === null) {
    const message = `sending: no send for event ${event.provider} ${event.eventId}`;
    if (Date.now() - event.at.getTime() < UNTRACED_MS) throw new Error(message);
    console.error(message);
    return;
  }
  if (row["mailbox"] === null) return;
  const { mail_from: person, mailbox, subject } = appSendSchema.parse(row);
  const notice = await writeNotice({
    key: `${event.provider} ${event.eventId} ${event.recipient}`,
    from: person,
    to: person,
    recipients: [event.recipient],
    what: event.detail ?? event.kind,
    subject,
    random: (into) => crypto.getRandomValues(into),
    now: () => new Date(),
  });
  await deliverNotice({ MAIL_DB, MAIL_BLOBS, IMAP_MAILBOX }, mailbox, notice, person);
}

/** Form 01a19d25 and form 01a19de8: an event is recorded, and then its person told. */
async function hear(event: SendEvent, env: SendingBindings): Promise<void> {
  await d1Events(env.MAIL_DB).record(event);
  await tell(event, env);
}

/**
 * Form 01a19d25: `fetch` runs the handler a POST names, and a throw is not caught, so the provider
 * sees a failure and retries, which recording's ignored repeats make safe. `queue` retries only the
 * message that failed.
 */
export function sendingWorker<E extends SendingBindings>(
  webhooks: Webhooks<E>,
): {
  fetch(request: Request, env: E): Promise<Response>;
  queue(batch: QueueBatch, env: E): Promise<void>;
} {
  return {
    fetch: async (request, env) => {
      const { pathname } = new URL(request.url);
      const key = pathname.slice(PREFIX.length);
      const handler =
        request.method === "POST" && pathname.startsWith(PREFIX) && Object.hasOwn(webhooks, key)
          ? webhooks[key]
          : undefined;
      if (handler === undefined) return new Response(null, { status: 404 });
      const events = await handler(request, env);
      if (events === null) return new Response(null, { status: 401 });
      for (const event of events) await hear(event, env);
      return new Response(null, { status: 200 });
    },
    queue: async (batch, env) => {
      for (const message of batch.messages) {
        try {
          const event = fromCloudflare(message.body);
          if (event !== null) await hear(event, env);
          message.ack();
        } catch {
          message.retry();
        }
      }
    },
  };
}
