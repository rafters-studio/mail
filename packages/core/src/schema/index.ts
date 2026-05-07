export {
  mailboxTypeSchema,
  threadStatusSchema,
  threadPrioritySchema,
  assignmentStatusSchema,
  aiCategorySchema,
  systemFolderSchema,
} from "./enums.js";

export type {
  MailboxType,
  ThreadStatus,
  ThreadPriority,
  AssignmentStatus,
  AiCategory,
  SystemFolder,
} from "./enums.js";

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

export {
  createMailboxSchema,
  updateMailboxSchema,
  createFolderSchema,
  updateFolderSchema,
  createLabelSchema,
  updateLabelSchema,
  updateThreadSchema,
  listThreadsSchema,
  listMessagesSchema,
  composeEmailSchema,
  saveDraftSchema,
  applyLabelSchema,
  bulkActionSchema,
  assignThreadSchema,
  addThreadNoteSchema,
  updateThreadNoteSchema,
} from "./validators.js";

export { platformAudience, platformSubscriber, broadcastAudit } from "./newsletter.js";

export {
  mailboxRowSchema,
  inboxFolderRowSchema,
  inboxLabelRowSchema,
  inboxThreadRowSchema,
  inboxMessageRowSchema,
  inboxMessageLabelRowSchema,
  inboxThreadLabelRowSchema,
  inboxAttachmentRowSchema,
  threadAssignmentRowSchema,
  threadNoteRowSchema,
  platformAudienceRowSchema,
  platformSubscriberRowSchema,
  broadcastAuditRowSchema,
} from "./rows.js";

export type {
  Mailbox,
  Folder,
  Label,
  Thread,
  Message,
  MessageLabel,
  ThreadLabel,
  Attachment,
  Assignment,
  Note,
  PlatformAudience,
  PlatformSubscriber,
  BroadcastAudit,
} from "./rows.js";

export type {
  CreateMailbox,
  UpdateMailbox,
  CreateFolder,
  UpdateFolder,
  CreateLabel,
  UpdateLabel,
  UpdateThread,
  ListThreads,
  ListMessages,
  ComposeEmail,
  SaveDraft,
  ApplyLabel,
  BulkAction,
  AssignThread,
  AddThreadNote,
  UpdateThreadNote,
} from "./validators.js";
