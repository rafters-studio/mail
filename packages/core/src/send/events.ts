// What happened afterwards, in one shape (form 01a19d25): "Events can arrive more than once, so
// each is recorded once under the provider's event id." Every provider's report maps to this.
import { z } from "zod";

export const sendEventSchema = z.strictObject({
  provider: z.string().min(1),
  eventId: z.string().min(1), // the provider's id; a redelivery repeats it
  kind: z.enum(["delivered", "delayed", "bounced", "complained", "failed"]),
  recipient: z.string().min(1),
  at: z.date(),
  messageId: z.string().min(1).nullable(), // RFC 5322 id, no brackets, when reported
  providerId: z.string().min(1).nullable(), // the provider's id for the message
  permanent: z.boolean().nullable(), // for a bounce or a delay: hard is true
  smtp: z.strictObject({ code: z.string(), enhanced: z.string(), text: z.string() }).nullable(),
  detail: z.string().nullable(),
});
export type SendEvent = z.infer<typeof sendEventSchema>;
// record ignores a second row for the same (provider, eventId, recipient).
export type Events = { record: (event: SendEvent) => Promise<void> };
