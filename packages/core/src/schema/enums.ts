import { z } from "zod";

export const mailboxTypeSchema = z.enum(["personal", "shared"]);
export type MailboxType = z.infer<typeof mailboxTypeSchema>;

export const threadStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const threadPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type ThreadPriority = z.infer<typeof threadPrioritySchema>;

export const assignmentStatusSchema = z.enum(["active", "completed", "reassigned"]);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const aiCategorySchema = z.enum([
  "support",
  "feedback",
  "abuse",
  "partnership",
  "spam",
  "billing",
  "legal",
  "other",
]);
export type AiCategory = z.infer<typeof aiCategorySchema>;

export const systemFolderSchema = z.enum(["inbox", "sent", "drafts", "spam", "trash", "archive"]);
export type SystemFolder = z.infer<typeof systemFolderSchema>;
