import { z } from "zod";

export const resendWebhookEventSchema = z.object({
  type: z.enum([
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.complained",
    "email.bounced",
    "email.opened",
    "email.clicked",
  ]),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    from: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.string().optional(),
    created_at: z.string().optional(),
    bounce: z
      .object({
        message: z.string(),
        type: z.enum(["hard", "soft"]).optional(),
      })
      .optional(),
    complaint: z
      .object({
        feedback_type: z.string().optional(),
      })
      .optional(),
  }),
});

export type ResendWebhookEvent = z.infer<typeof resendWebhookEventSchema>;

export type WebhookEventType = ResendWebhookEvent["type"];

export interface WebhookHandlerCallbacks {
  onDelivered?: (emailId: string, event: ResendWebhookEvent) => Promise<void>;
  onBounced?: (
    emailId: string,
    bounceType: string,
    message: string,
    event: ResendWebhookEvent,
  ) => Promise<void>;
  onComplained?: (emailId: string, event: ResendWebhookEvent) => Promise<void>;
  onOpened?: (emailId: string, event: ResendWebhookEvent) => Promise<void>;
  onClicked?: (emailId: string, event: ResendWebhookEvent) => Promise<void>;
}

export interface WebhookVerifyConfig {
  signingSecret?: string;
}

export function createResendWebhookHandler(callbacks: WebhookHandlerCallbacks) {
  return async (payload: unknown): Promise<{ handled: boolean; type: string }> => {
    const event = resendWebhookEventSchema.parse(payload);
    const emailId = event.data.email_id;

    switch (event.type) {
      case "email.delivered":
        if (callbacks.onDelivered) {
          await callbacks.onDelivered(emailId, event);
        }
        break;

      case "email.bounced":
        if (callbacks.onBounced) {
          const bounceType = event.data.bounce?.type ?? "unknown";
          const message = event.data.bounce?.message ?? "Bounce";
          await callbacks.onBounced(emailId, bounceType, message, event);
        }
        break;

      case "email.complained":
        if (callbacks.onComplained) {
          await callbacks.onComplained(emailId, event);
        }
        break;

      case "email.opened":
        if (callbacks.onOpened) {
          await callbacks.onOpened(emailId, event);
        }
        break;

      case "email.clicked":
        if (callbacks.onClicked) {
          await callbacks.onClicked(emailId, event);
        }
        break;

      default:
        break;
    }

    return { handled: true, type: event.type };
  };
}
