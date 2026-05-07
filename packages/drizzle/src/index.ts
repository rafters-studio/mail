export {
  mailbox,
  inboxFolder,
  inboxLabel,
  inboxThread,
  inboxMessage,
  inboxMessageLabel,
  inboxThreadLabel,
  inboxAttachment,
  threadAssignment,
  threadNote,
} from "./tables.js";

export { platformAudience, platformSubscriber, broadcastAudit } from "./newsletter.js";

export {
  createFolderService,
  createLabelService,
  createAssignmentService,
  createNoteService,
  createThreadService,
  createMailServices,
} from "./services/index.js";
export type { MailServices } from "./services/index.js";

export { createInboxEmailService } from "./services/inbox-email.js";
export type { InboxEmailServiceConfig } from "./services/inbox-email.js";
