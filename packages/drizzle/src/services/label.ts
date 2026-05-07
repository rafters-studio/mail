import { and, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import { inboxLabel, inboxMessageLabel, inboxThreadLabel } from "../tables.js";
import type { LabelService } from "@rafters/mail";

type DB = BaseSQLiteDatabase<"async", unknown>;

export function createLabelService(db: DB): LabelService {
  return {
    async createLabel(mailboxId: string, name: string) {
      const slug = name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const id = uuidv7();
      await db
        .insert(inboxLabel)
        .values({ id, mailboxId, name, slug, isSystem: false, isAiGenerated: false });
      const row = await db.select().from(inboxLabel).where(eq(inboxLabel.id, id)).get();
      return row!;
    },

    async listLabels(mailboxId: string) {
      return db
        .select()
        .from(inboxLabel)
        .where(and(eq(inboxLabel.mailboxId, mailboxId), isNull(inboxLabel.deletedAt)))
        .all();
    },

    async applyToMessage(messageId: string, labelId: string, appliedBy?: string) {
      await db.insert(inboxMessageLabel).values({
        id: uuidv7(),
        messageId,
        labelId,
        appliedBy: appliedBy ?? null,
      });
    },

    async applyToThread(threadId: string, labelId: string, appliedBy?: string) {
      await db.insert(inboxThreadLabel).values({
        id: uuidv7(),
        threadId,
        labelId,
        appliedBy: appliedBy ?? null,
      });
    },

    async removeFromMessage(messageId: string, labelId: string) {
      await db
        .delete(inboxMessageLabel)
        .where(
          and(eq(inboxMessageLabel.messageId, messageId), eq(inboxMessageLabel.labelId, labelId)),
        );
    },

    async removeFromThread(threadId: string, labelId: string) {
      await db
        .delete(inboxThreadLabel)
        .where(and(eq(inboxThreadLabel.threadId, threadId), eq(inboxThreadLabel.labelId, labelId)));
    },
  };
}
