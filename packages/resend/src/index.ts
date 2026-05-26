export { ResendService, ResendError } from "./resend-service.js";
export type { ResendConfig } from "./resend-service.js";
export { createResendProvider } from "./resend-provider.js";
export { createMockEmailProvider } from "./mock-provider.js";

export { createResendWebhookHandler, resendWebhookEventSchema } from "./webhook-handler.js";
export type {
  ResendWebhookEvent,
  WebhookEventType,
  WebhookHandlerCallbacks,
  WebhookVerifyConfig,
} from "./webhook-handler.js";

export type {
  ResendAudience,
  ResendContact,
  ResendBroadcast,
  ResendBroadcastDetail,
  ResendIdResponse,
  CreateAudienceRequest,
  AddContactRequest,
  UpdateContactRequest,
  CreateBroadcastRequest,
  SendTransactionalRequest,
  EmailAttachment,
} from "./resend-types.js";

export {
  resendAudienceSchema,
  resendContactSchema,
  resendBroadcastSchema,
  resendBroadcastDetailSchema,
  resendIdResponseSchema,
  createAudienceRequestSchema,
  addContactRequestSchema,
  updateContactRequestSchema,
  createBroadcastRequestSchema,
  sendTransactionalRequestSchema,
  emailAttachmentSchema,
} from "./resend-types.js";
