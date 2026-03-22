import { z } from "zod";
import type { ThreadPriority, ThreadStatus } from "../schema/enums.js";

// ===== INBOX EMAIL SERVICE =====

export const replyToThreadParamsSchema = z.object({
  threadId: z.string(),
  mailboxId: z.string(),
  senderId: z.string(),
  body: z.string().min(1),
  bodyHtml: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
});
export type ReplyToThreadParams = z.infer<typeof replyToThreadParamsSchema>;

export const composeEmailParamsSchema = z.object({
  mailboxId: z.string(),
  senderId: z.string(),
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  bodyHtml: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
});
export type ComposeEmailParams = z.infer<typeof composeEmailParamsSchema>;

export interface InboxEmailService {
  replyToThread(params: ReplyToThreadParams): Promise<{ messageId: string }>;
  composeEmail(params: ComposeEmailParams): Promise<{ threadId: string; messageId: string }>;
}

// ===== THREAD SERVICE =====

export interface ThreadService {
  getThread(threadId: string): Promise<unknown>;
  listThreads(mailboxId: string, folderId?: string): Promise<unknown[]>;
  moveToFolder(threadId: string, folderId: string): Promise<void>;
  updateStatus(threadId: string, status: ThreadStatus): Promise<void>;
  updatePriority(threadId: string, priority: ThreadPriority): Promise<void>;
  archive(threadId: string): Promise<void>;
  trash(threadId: string): Promise<void>;
}

// ===== FOLDER SERVICE =====

export interface FolderService {
  createFolder(mailboxId: string, name: string): Promise<unknown>;
  listFolders(mailboxId: string): Promise<unknown[]>;
  deleteFolder(folderId: string): Promise<void>;
  initSystemFolders(mailboxId: string): Promise<void>;
}

// ===== LABEL SERVICE =====

export interface LabelService {
  createLabel(mailboxId: string, name: string): Promise<unknown>;
  listLabels(mailboxId: string): Promise<unknown[]>;
  applyToMessage(messageId: string, labelId: string, appliedBy?: string): Promise<void>;
  applyToThread(threadId: string, labelId: string, appliedBy?: string): Promise<void>;
  removeFromMessage(messageId: string, labelId: string): Promise<void>;
  removeFromThread(threadId: string, labelId: string): Promise<void>;
}

// ===== ASSIGNMENT SERVICE =====

export interface AssignmentService {
  assign(threadId: string, assigneeId: string, assignedBy?: string): Promise<void>;
  reassign(threadId: string, newAssigneeId: string, assignedBy?: string): Promise<void>;
  complete(threadId: string): Promise<void>;
  getActiveAssignment(threadId: string): Promise<unknown | null>;
}

// ===== NOTE SERVICE =====

export interface NoteService {
  addNote(threadId: string, authorId: string, content: string): Promise<unknown>;
  listNotes(threadId: string): Promise<unknown[]>;
  deleteNote(noteId: string): Promise<void>;
}
