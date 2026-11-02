// A verified webhook, as events (Svix manual verification): the svix-id header "will be the same
// when the same webhook is being resent". An unverified endpoint would let anyone forge a bounce,
// so a webhook is verified before it is read, and each event is recorded once under that id.
import { sendEventSchema, type SendEvent } from "@rafters/mail/send";
import { z } from "zod";

// Svix states no tolerance; 300 is mail's choice (form 01a19d25).
const TOLERANCE_SECONDS = 300;

/** Svix manual verification: base64 to bytes, or null when the text does not decode. */
function decoded(base64: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Svix manual verification: HMAC-SHA256 under the base64 key after `whsec_`, over
 * `${id}.${timestamp}.${body}`, against each `v1` entry of the list, through `crypto.subtle.verify`,
 * which compares in constant time. A malformed secret is the operator's error, so it throws and the
 * provider retries once it is fixed; anything wrong with the request is false.
 */
export async function verifyWebhook(input: {
  secret: string; // whsec_ and base64
  id: string | null; // the svix-id header
  timestamp: string | null; // the svix-timestamp header
  signature: string | null; // the svix-signature header
  body: string; // the raw request body
  now: Date;
}): Promise<boolean> {
  const { secret, id, timestamp, signature, body, now } = input;
  const bytes = secret.startsWith("whsec_") ? decoded(secret.slice("whsec_".length)) : null;
  if (bytes === null || bytes.length === 0) throw new Error("malformed webhook secret");
  if (id === null || timestamp === null || signature === null) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const entry of signature.split(" ").filter((e) => e.startsWith("v1,"))) {
    const candidate = decoded(entry.slice("v1,".length));
    if (candidate !== null && (await crypto.subtle.verify("HMAC", key, candidate, signed))) {
      return true;
    }
  }
  return false;
}

const typeSchema = z.object({ type: z.string() });
// A provider's payload is not ours, so z.object: a provider adding a field must not lose an event.
const eventSchema = z.object({
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    to: z.array(z.string()),
    message_id: z.string().optional(),
    bounce: z.object({ type: z.string() }).optional(),
  }),
});
const bouncedSchema = z.object({
  data: z.object({
    bounce: z.object({
      subType: z.string(),
      message: z.string(),
      diagnosticCode: z.array(z.string()).optional(),
    }),
  }),
});
const failedSchema = z.object({ data: z.object({ failed: z.object({ reason: z.string() }) }) });
const suppressedSchema = z.object({
  data: z.object({ suppressed: z.object({ type: z.string(), message: z.string() }) }),
});

/** Form 01a19d25: the email.bounced row of the table, its diagnostics joined when there are any. */
function bouncedDetail(body: unknown): string {
  const { subType, message, diagnosticCode } = bouncedSchema.parse(body).data.bounce;
  const diagnostics = diagnosticCode?.length ? ` (${diagnosticCode.join("; ")})` : "";
  return `${subType}: ${message}${diagnostics}`;
}

// Keyed by outside text, so a Map: a `type` of `constructor` finds nothing.
const TRACKED = new Map<
  string,
  { kind: SendEvent["kind"]; detail: (body: unknown) => string | null }
>([
  ["email.delivered", { kind: "delivered", detail: () => null }],
  ["email.delivery_delayed", { kind: "delayed", detail: () => null }],
  ["email.bounced", { kind: "bounced", detail: bouncedDetail }],
  ["email.complained", { kind: "complained", detail: () => null }],
  [
    "email.failed",
    { kind: "failed", detail: (body) => failedSchema.parse(body).data.failed.reason },
  ],
  [
    "email.suppressed",
    {
      kind: "failed",
      detail: (body) => {
        const { type, message } = suppressedSchema.parse(body).data.suppressed;
        return `${type}: ${message}`;
      },
    },
  ],
]);

/**
 * Form 01a19d25: `type` is read first, so a type not tracked returns nothing whatever its data
 * holds. One event per entry of `data.to`, each under the svix-id; a malformed tracked payload
 * throws its ZodError. `smtp` is null because Resend's diagnostics are free text.
 */
export function fromResend(id: string, body: unknown): SendEvent[] {
  const tracked = TRACKED.get(typeSchema.parse(body).type);
  if (tracked === undefined) return [];
  const { created_at: createdAt, data } = eventSchema.parse(body);
  const detail = tracked.detail(body);
  return data.to.map((recipient) =>
    sendEventSchema.parse({
      provider: "resend",
      eventId: id,
      kind: tracked.kind,
      recipient,
      at: new Date(createdAt),
      messageId: data.message_id?.replace(/^<|>$/g, "") ?? null,
      providerId: data.email_id,
      permanent: data.bounce === undefined ? null : data.bounce.type === "Permanent",
      smtp: null,
      detail,
    }),
  );
}
