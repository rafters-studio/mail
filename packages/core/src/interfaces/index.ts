export {
  mailingListSchema,
  subscriberSchema,
  subscriberDataSchema,
  subscriberUpdatesSchema,
  campaignParamsSchema,
  campaignStatusSchema,
  audienceSchema,
  emailParamsSchema,
} from "./email-provider.js";

export type {
  MailingList,
  Subscriber,
  SubscriberData,
  SubscriberUpdates,
  CampaignParams,
  CampaignStatus,
  Audience,
  EmailParams,
  EmailProvider,
} from "./email-provider.js";

export { blobPutOptionsSchema, blobGetOptionsSchema } from "./blob-storage.js";

export type { BlobPutOptions, BlobGetOptions, BlobObject, BlobStorage } from "./blob-storage.js";

export { emailClassificationSchema, isLegitimateCategory } from "./classifier.js";

export type { EmailClassification, EmailClassifier } from "./classifier.js";

export type { TemplateRenderer } from "./template-renderer.js";

export { inboundEmailSchema } from "./inbound-adapter.js";

export type { InboundEmail, InboundAdapter } from "./inbound-adapter.js";

export { replyToThreadParamsSchema, composeEmailParamsSchema } from "./services.js";

export type {
  ReplyToThreadParams,
  ComposeEmailParams,
  InboxEmailService,
  ThreadService,
  FolderService,
  LabelService,
  AssignmentService,
  NoteService,
} from "./services.js";
