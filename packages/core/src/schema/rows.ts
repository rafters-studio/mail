import { z } from "zod";
import {
  aiCategorySchema,
  assignmentStatusSchema,
  mailboxTypeSchema,
  threadPrioritySchema,
  threadStatusSchema,
} from "./enums.js";

export const mailboxRowSchema = z.object({
  id: z.string(),
  type: mailboxTypeSchema,
  emailAddress: z.string(),
  localPart: z.string(),
  displayName: z.string().nullable(),
  ownerId: z.string().nullable(),
  organizationId: z.string(),
  isActive: z.boolean(),
  autoReplyEnabled: z.boolean(),
  autoReplySubject: z.string().nullable(),
  autoReplyBody: z.string().nullable(),
  forwardToEmail: z.string().nullable(),
  forwardEnabled: z.boolean(),
  signature: z.string().nullable(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type Mailbox = z.infer<typeof mailboxRowSchema>;

export const inboxFolderRowSchema = z.object({
  id: z.string(),
  mailboxId: z.string(),
  name: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isSystem: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type Folder = z.infer<typeof inboxFolderRowSchema>;

export const inboxLabelRowSchema = z.object({
  id: z.string(),
  mailboxId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  isSystem: z.boolean(),
  isAiGenerated: z.boolean(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type Label = z.infer<typeof inboxLabelRowSchema>;

export const inboxThreadRowSchema = z.object({
  id: z.string(),
  mailboxId: z.string(),
  subject: z.string(),
  snippet: z.string().nullable(),
  participants: z.array(z.string()).nullable(),
  messageCount: z.number(),
  unreadCount: z.number(),
  folderId: z.string().nullable(),
  status: threadStatusSchema,
  priority: threadPrioritySchema,
  startedAt: z.date(),
  lastMessageAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});
export type Thread = z.infer<typeof inboxThreadRowSchema>;

export const inboxMessageRowSchema = z.object({
  id: z.string(),
  mailboxId: z.string(),
  threadId: z.string(),
  messageId: z.string(),
  inReplyTo: z.string().nullable(),
  references: z.string().nullable(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  toEmail: z.string(),
  toName: z.string().nullable(),
  ccEmails: z.array(z.string()).nullable(),
  bccEmails: z.array(z.string()).nullable(),
  replyToEmail: z.string().nullable(),
  subject: z.string(),
  snippet: z.string().nullable(),
  blobKeyRaw: z.string(),
  blobKeyHtml: z.string().nullable(),
  blobKeyText: z.string().nullable(),
  isOutbound: z.boolean(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  aiCategory: aiCategorySchema.nullable(),
  aiConfidence: z.number().nullable(),
  aiSummary: z.string().nullable(),
  isSpam: z.boolean(),
  spamScore: z.number().nullable(),
  sizeBytes: z.number(),
  attachmentCount: z.number(),
  receivedAt: z.date(),
  sentAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});
export type Message = z.infer<typeof inboxMessageRowSchema>;

export const inboxMessageLabelRowSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  labelId: z.string(),
  appliedAt: z.date(),
  appliedBy: z.string().nullable(),
});
export type MessageLabel = z.infer<typeof inboxMessageLabelRowSchema>;

export const inboxThreadLabelRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelId: z.string(),
  appliedAt: z.date(),
  appliedBy: z.string().nullable(),
});
export type ThreadLabel = z.infer<typeof inboxThreadLabelRowSchema>;

export const inboxAttachmentRowSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  blobKey: z.string(),
  contentId: z.string().nullable(),
  isInline: z.boolean(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type Attachment = z.infer<typeof inboxAttachmentRowSchema>;

export const threadAssignmentRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  assigneeId: z.string(),
  assignedBy: z.string().nullable(),
  status: assignmentStatusSchema,
  note: z.string().nullable(),
  assignedAt: z.date(),
  completedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
});
export type Assignment = z.infer<typeof threadAssignmentRowSchema>;

export const threadNoteRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  authorId: z.string(),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type Note = z.infer<typeof threadNoteRowSchema>;

export const platformAudienceRowSchema = z.object({
  id: z.string(),
  providerListId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  slug: z.string(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type PlatformAudience = z.infer<typeof platformAudienceRowSchema>;

export const platformSubscriberRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  audienceId: z.string(),
  providerSubscriberId: z.string(),
  subscribedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type PlatformSubscriber = z.infer<typeof platformSubscriberRowSchema>;

export const broadcastAuditRowSchema = z.object({
  id: z.string(),
  providerCampaignId: z.string(),
  subject: z.string(),
  contentHash: z.string().nullable(),
  sentBy: z.string().nullable(),
  audienceName: z.string(),
  audienceId: z.string().nullable(),
  recipientCount: z.number().nullable(),
  sentAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type BroadcastAudit = z.infer<typeof broadcastAuditRowSchema>;
