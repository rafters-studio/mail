import { z } from "zod";
import {
  aiCategorySchema,
  mailboxTypeSchema,
  threadPrioritySchema,
  threadStatusSchema,
} from "./enums.js";

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color");

// ===== MAILBOX =====

export const createMailboxSchema = z
  .object({
    type: mailboxTypeSchema,
    localPart: z
      .string()
      .min(2, "Local part must be at least 2 characters")
      .max(64, "Local part must be less than 64 characters")
      .regex(
        /^[a-z0-9._-]+$/,
        "Local part can only contain lowercase letters, numbers, dots, underscores, and hyphens",
      ),
    displayName: z.string().max(100).optional(),
    ownerId: z.string().optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(50).optional(),
    color: hexColorSchema.optional(),
  })
  .refine((data) => data.type !== "personal" || data.ownerId !== undefined, {
    message: "Personal mailboxes require an owner ID",
    path: ["ownerId"],
  });

export const updateMailboxSchema = z
  .object({
    displayName: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
    autoReplyEnabled: z.boolean().optional(),
    autoReplySubject: z.string().max(200).optional(),
    autoReplyBody: z.string().max(5000).optional(),
    forwardToEmail: z.string().email().optional().nullable(),
    forwardEnabled: z.boolean().optional(),
    signature: z.string().max(2000).optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(50).optional(),
    color: hexColorSchema.optional(),
  })
  .refine(
    (data) =>
      data.forwardEnabled !== true ||
      (data.forwardToEmail !== undefined && data.forwardToEmail !== null),
    { message: "forwardToEmail is required when forwarding is enabled", path: ["forwardToEmail"] },
  );

// ===== FOLDER =====

export const createFolderSchema = z.object({
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(50, "Folder name must be less than 50 characters"),
  icon: z.string().max(50).optional(),
  color: hexColorSchema.optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(50).optional(),
  color: hexColorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ===== LABEL =====

export const createLabelSchema = z.object({
  name: z
    .string()
    .min(1, "Label name is required")
    .max(50, "Label name must be less than 50 characters"),
  color: hexColorSchema.optional(),
  icon: z.string().max(50).optional(),
});

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: hexColorSchema.optional(),
  icon: z.string().max(50).optional(),
});

const paginationSchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ===== THREAD =====

export const updateThreadSchema = z.object({
  folderId: z.string().optional(),
  status: threadStatusSchema.optional(),
  priority: threadPrioritySchema.optional(),
});

export const listThreadsSchema = paginationSchema.extend({
  mailboxId: z.string().optional(),
  folderId: z.string().optional(),
  labelId: z.string().optional(),
  status: threadStatusSchema.optional(),
  priority: threadPrioritySchema.optional(),
  assigneeId: z.string().optional(),
  isArchived: z.coerce.boolean().optional(),
});

// ===== MESSAGE =====

export const listMessagesSchema = paginationSchema.extend({
  mailboxId: z.string().optional(),
  folderId: z.string().optional(),
  labelId: z.string().optional(),
  threadId: z.string().optional(),
  isRead: z.coerce.boolean().optional(),
  isStarred: z.coerce.boolean().optional(),
  aiCategory: aiCategorySchema.optional(),
});

// ===== COMPOSE =====

export const composeEmailSchema = z.object({
  mailboxId: z.string().min(1, "Mailbox ID is required"),
  to: z.array(z.string().email()).min(1, "At least one recipient required"),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1, "Subject is required").max(500),
  body: z.string().min(1, "Body is required"),
  bodyHtml: z.string().optional(),
  replyToThreadId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export const saveDraftSchema = z.object({
  mailboxId: z.string().min(1, "Mailbox ID is required"),
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().optional(),
  bodyHtml: z.string().optional(),
  replyToThreadId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

// ===== LABEL APPLICATION =====

export const applyLabelSchema = z.object({
  labelId: z.string().min(1, "Label ID is required"),
});

// ===== BULK ACTIONS =====

export const bulkActionSchema = z
  .object({
    ids: z.array(z.string()).min(1, "At least one ID required").max(100, "Maximum 100 items"),
    action: z.enum([
      "markRead",
      "markUnread",
      "star",
      "unstar",
      "archive",
      "delete",
      "moveToFolder",
      "setStatus",
      "setPriority",
    ]),
    folderId: z.string().optional(),
    status: threadStatusSchema.optional(),
    priority: threadPrioritySchema.optional(),
  })
  .refine((data) => data.action !== "moveToFolder" || data.folderId !== undefined, {
    message: "folderId is required for moveToFolder action",
    path: ["folderId"],
  })
  .refine((data) => data.action !== "setStatus" || data.status !== undefined, {
    message: "status is required for setStatus action",
    path: ["status"],
  })
  .refine((data) => data.action !== "setPriority" || data.priority !== undefined, {
    message: "priority is required for setPriority action",
    path: ["priority"],
  });

// ===== ASSIGNMENT =====

export const assignThreadSchema = z.object({
  assigneeId: z.string().min(1, "Assignee ID is required"),
  note: z.string().max(500).optional(),
});

// ===== NOTES =====

export const addThreadNoteSchema = z.object({
  content: z.string().min(1, "Note content is required").max(10000),
});

export const updateThreadNoteSchema = z.object({
  content: z.string().min(1).max(10000),
});

// ===== INFERRED TYPES =====

export type CreateMailbox = z.infer<typeof createMailboxSchema>;
export type UpdateMailbox = z.infer<typeof updateMailboxSchema>;
export type CreateFolder = z.infer<typeof createFolderSchema>;
export type UpdateFolder = z.infer<typeof updateFolderSchema>;
export type CreateLabel = z.infer<typeof createLabelSchema>;
export type UpdateLabel = z.infer<typeof updateLabelSchema>;
export type UpdateThread = z.infer<typeof updateThreadSchema>;
export type ListThreads = z.infer<typeof listThreadsSchema>;
export type ListMessages = z.infer<typeof listMessagesSchema>;
export type ComposeEmail = z.infer<typeof composeEmailSchema>;
export type SaveDraft = z.infer<typeof saveDraftSchema>;
export type ApplyLabel = z.infer<typeof applyLabelSchema>;
export type BulkAction = z.infer<typeof bulkActionSchema>;
export type AssignThread = z.infer<typeof assignThreadSchema>;
export type AddThreadNote = z.infer<typeof addThreadNoteSchema>;
export type UpdateThreadNote = z.infer<typeof updateThreadNoteSchema>;
