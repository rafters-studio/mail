// Cloudflare's queue event, as an event (Cloudflare event-subscriptions docs): delivered is
// "Triggered when the recipient mail server accepts the message." Each event names Cloudflare's own
// message id, never our Message-ID, so `messageId` is null and the row's provider id is the match.
import { sendEventSchema, type SendEvent } from "@rafters/mail/send";
import { z } from "zod";

const typeSchema = z.object({ type: z.string() });
// A provider's payload is not ours, so z.object: a provider adding a field must not lose an event.
const eventSchema = z.object({
  metadata: z.object({ eventTimestamp: z.string() }),
  payload: z.object({
    eventId: z.string(),
    messageId: z.string(),
    recipient: z.string(),
    delivery: z.unknown(),
    bounce: z
      .object({ type: z.string(), classification: z.string(), reason: z.string() })
      .optional(),
    failure: z.object({ reason: z.string() }).optional(),
    rejection: z.object({ party: z.string(), reason: z.string() }).optional(),
    complaint: z.object({ type: z.string() }).optional(),
  }),
});
const smtpSchema = z.object({
  smtpStatusCode: z.string(),
  smtpEnhancedStatusCode: z.string(),
  smtpResponse: z.string(),
});

// Keyed by outside text, so a Map: a `type` of `...message.constructor` finds nothing.
const TRACKED = new Map<string, SendEvent["kind"]>([
  ["cf.email.sending.message.delivered", "delivered"],
  ["cf.email.sending.message.deferred", "delayed"],
  ["cf.email.sending.message.bounced", "bounced"],
  ["cf.email.sending.message.failed", "failed"],
  ["cf.email.sending.message.rejected", "failed"],
  ["cf.email.sending.message.complained", "complained"],
]);

/**
 * Form 01a19d25: `type` is read first, so a type not tracked is null; a malformed tracked payload
 * throws its ZodError. `smtp` is the delivery's three fields when all three are strings, because
 * the failed, rejected and complained events do not carry them.
 */
export function fromCloudflare(body: unknown): SendEvent | null {
  const kind = TRACKED.get(typeSchema.parse(body).type);
  if (kind === undefined) return null;
  const { metadata, payload } = eventSchema.parse(body);
  const { bounce, failure, rejection, complaint } = payload;
  const smtp = smtpSchema.safeParse(payload.delivery);
  return sendEventSchema.parse({
    provider: "cloudflare",
    eventId: payload.eventId,
    kind,
    recipient: payload.recipient,
    at: new Date(metadata.eventTimestamp),
    messageId: null,
    providerId: payload.messageId,
    permanent: bounce === undefined ? null : bounce.type === "hard",
    smtp: smtp.success
      ? {
          code: smtp.data.smtpStatusCode,
          enhanced: smtp.data.smtpEnhancedStatusCode,
          text: smtp.data.smtpResponse,
        }
      : null,
    detail:
      (bounce && `${bounce.classification}: ${bounce.reason}`) ??
      failure?.reason ??
      (rejection && `${rejection.party}: ${rejection.reason}`) ??
      complaint?.type ??
      null,
  });
}
