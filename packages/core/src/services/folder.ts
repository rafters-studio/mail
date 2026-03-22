import { and, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import { systemFolderSchema } from "../schema/enums.js";
import { inboxFolder } from "../schema/tables.js";
import type { FolderService } from "../interfaces/services.js";

type DB = BaseSQLiteDatabase<"async", unknown>;

const SYSTEM_FOLDERS = systemFolderSchema.options.map((slug, i) => ({
  slug,
  name: slug.charAt(0).toUpperCase() + slug.slice(1),
  isSystem: true,
  sortOrder: i,
}));

export function createFolderService(db: DB): FolderService {
  return {
    async createFolder(mailboxId: string, name: string) {
      const slug = name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const id = uuidv7();
      await db
        .insert(inboxFolder)
        .values({ id, mailboxId, name, slug, isSystem: false, sortOrder: 100 });
      const row = await db.select().from(inboxFolder).where(eq(inboxFolder.id, id)).get();
      return row!;
    },

    async listFolders(mailboxId: string) {
      return db
        .select()
        .from(inboxFolder)
        .where(and(eq(inboxFolder.mailboxId, mailboxId), isNull(inboxFolder.deletedAt)))
        .orderBy(inboxFolder.sortOrder)
        .all();
    },

    async deleteFolder(folderId: string) {
      const folder = await db
        .select({ isSystem: inboxFolder.isSystem })
        .from(inboxFolder)
        .where(eq(inboxFolder.id, folderId))
        .get();

      if (folder?.isSystem) {
        throw new Error("Cannot delete system folders");
      }

      await db
        .update(inboxFolder)
        .set({ deletedAt: new Date() })
        .where(eq(inboxFolder.id, folderId));
    },

    async initSystemFolders(mailboxId: string) {
      for (const folder of SYSTEM_FOLDERS) {
        await db.insert(inboxFolder).values({
          id: uuidv7(),
          mailboxId,
          ...folder,
        });
      }
    },
  };
}
