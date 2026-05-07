import { and, desc, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { inboxThread, inboxFolder } from "../tables.js";
import type { ThreadStatus, ThreadPriority } from "@rafters/mail";
import type { ThreadService } from "@rafters/mail";

type DB = BaseSQLiteDatabase<"async", unknown>;

export function createThreadService(db: DB): ThreadService {
  return {
    async getThread(threadId: string) {
      return db
        .select()
        .from(inboxThread)
        .where(and(eq(inboxThread.id, threadId), isNull(inboxThread.deletedAt)))
        .get();
    },

    async listThreads(mailboxId: string, folderId?: string) {
      const conditions = [eq(inboxThread.mailboxId, mailboxId), isNull(inboxThread.deletedAt)];
      if (folderId) {
        conditions.push(eq(inboxThread.folderId, folderId));
      }
      return db
        .select()
        .from(inboxThread)
        .where(and(...conditions))
        .orderBy(desc(inboxThread.lastMessageAt))
        .all();
    },

    async moveToFolder(threadId: string, folderId: string) {
      await db.update(inboxThread).set({ folderId }).where(eq(inboxThread.id, threadId));
    },

    async updateStatus(threadId: string, status: ThreadStatus) {
      await db.update(inboxThread).set({ status }).where(eq(inboxThread.id, threadId));
    },

    async updatePriority(threadId: string, priority: ThreadPriority) {
      await db.update(inboxThread).set({ priority }).where(eq(inboxThread.id, threadId));
    },

    async archive(threadId: string) {
      // Find archive folder for this thread's mailbox
      const thread = await db
        .select({ mailboxId: inboxThread.mailboxId })
        .from(inboxThread)
        .where(eq(inboxThread.id, threadId))
        .get();

      if (!thread) return;

      const archiveFolder = await db
        .select({ id: inboxFolder.id })
        .from(inboxFolder)
        .where(
          and(
            eq(inboxFolder.mailboxId, thread.mailboxId),
            eq(inboxFolder.slug, "archive"),
            isNull(inboxFolder.deletedAt),
          ),
        )
        .get();

      await db
        .update(inboxThread)
        .set({
          folderId: archiveFolder?.id ?? null,
          archivedAt: new Date(),
        })
        .where(eq(inboxThread.id, threadId));
    },

    async trash(threadId: string) {
      const thread = await db
        .select({ mailboxId: inboxThread.mailboxId })
        .from(inboxThread)
        .where(eq(inboxThread.id, threadId))
        .get();

      if (!thread) return;

      const trashFolder = await db
        .select({ id: inboxFolder.id })
        .from(inboxFolder)
        .where(
          and(
            eq(inboxFolder.mailboxId, thread.mailboxId),
            eq(inboxFolder.slug, "trash"),
            isNull(inboxFolder.deletedAt),
          ),
        )
        .get();

      await db
        .update(inboxThread)
        .set({
          folderId: trashFolder?.id ?? null,
          deletedAt: new Date(),
        })
        .where(eq(inboxThread.id, threadId));
    },
  };
}
