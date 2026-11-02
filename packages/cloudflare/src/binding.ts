// Sending raw through the binding (Cloudflare send-email docs): the raw EmailMessage path is
// "supported for backward compatibility", and it is the only raw path on the binding; the
// structured send() would rebuild the message. It carries one recipient, so each is one send.
import type { Outcome, Transport } from "@rafters/mail/send";

export type RawMessage = { readonly from: string; readonly to: string };
export type EmailBinding = { send(message: RawMessage): Promise<unknown> };
export type MakeMessage = (from: string, to: string, raw: string) => RawMessage;

// Keyed by outside text, so a Map: a `code` of `constructor` finds nothing. The value is `final`.
const REFUSALS = new Map<string, boolean>([
  // About this recipient or this message.
  ["E_RECIPIENT_SUPPRESSED", true],
  ["E_VALIDATION_ERROR", true],
  ["E_FIELD_MISSING", true],
  ["E_TOO_MANY_RECIPIENTS", true],
  ["E_TOO_MANY_ATTACHMENTS", true],
  ["E_CONTENT_TOO_LARGE", true],
  // About the account or the binding's own list, so fixing it must be able to send the mail.
  ["E_RECIPIENT_NOT_ALLOWED", false],
  ["E_RATE_LIMIT_EXCEEDED", false],
  ["E_DAILY_LIMIT_EXCEEDED", false],
  ["E_SENDER_NOT_VERIFIED", false],
  ["E_SENDER_DOMAIN_NOT_AVAILABLE", false],
  ["E_ACCOUNT_SUSPENDED", false],
]);

/** Form 01a19d25: the fields of what was thrown, a `code` that is not a string counting as none. */
function fields(error: unknown): { code: string | null; message: string } {
  const { code, message }: { code?: unknown; message?: unknown } =
    typeof error === "object" && error !== null ? error : {};
  return {
    code: typeof code === "string" ? code : null,
    message: typeof message === "string" ? message : String(error),
  };
}

/** Form 01a19d25: the code table, tried exactly first and then by the `E_HEADER` prefix. */
function thrown(recipient: string, error: unknown): Outcome {
  const { code, message } = fields(error);
  const final = code !== null && (REFUSALS.get(code) ?? (code.startsWith("E_HEADER") || null));
  if (final === null || code === null) {
    return { recipient, kind: "unknown", detail: `${code ?? "no code"}: ${message}` };
  }
  return {
    recipient,
    kind: "refused",
    final,
    stage: "provider",
    code: null,
    text: `${code}: ${message}`,
  };
}

/** Cloudflare send-email docs: `messageId` of the result when it is a non-empty string, else null. */
function providerId(result: unknown): string | null {
  const { messageId }: { messageId?: unknown } =
    typeof result === "object" && result !== null ? result : {};
  return typeof messageId === "string" && messageId !== "" ? messageId : null;
}

/**
 * Form 01a19d25: one message per recipient, in order, a throw for one stopping no other. `make`
 * throwing handed nothing over, so it is a refusal and not final. `raw` is decoded byte for byte,
 * not by `TextDecoder`, whose `ascii` label is really windows-1252.
 */
export function bindingTransport(email: EmailBinding, make: MakeMessage): Transport {
  const one = async (from: string, recipient: string, raw: string): Promise<Outcome> => {
    let message: RawMessage;
    try {
      message = make(from, recipient, raw);
    } catch (error) {
      const text = fields(error).message;
      return { recipient, kind: "refused", final: false, stage: "provider", code: null, text };
    }
    try {
      const result = await email.send(message);
      return { recipient, kind: "accepted", providerId: providerId(result), text: null };
    } catch (error) {
      return thrown(recipient, error);
    }
  };
  return {
    name: "cloudflare",
    send: async ({ bytes, envelope }) => {
      const raw = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
      const outcomes: Outcome[] = [];
      for (const recipient of envelope.to) outcomes.push(await one(envelope.from, recipient, raw));
      return outcomes;
    },
  };
}
