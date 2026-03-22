import { and, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import { threadNote } from "../schema/tables.js";
import type { NoteService } from "../interfaces/services.js";

type DB = BaseSQLiteDatabase<"async", unknown>;

export function createNoteService(db: DB): NoteService {
  return {
    async addNote(threadId: string, authorId: string, content: string) {
      const id = uuidv7();
      await db.insert(threadNote).values({ id, threadId, authorId, content });
      const row = await db.select().from(threadNote).where(eq(threadNote.id, id)).get();
      return row!;
    },

    async listNotes(threadId: string) {
      return db
        .select()
        .from(threadNote)
        .where(and(eq(threadNote.threadId, threadId), isNull(threadNote.deletedAt)))
        .orderBy(threadNote.createdAt)
        .all();
    },

    async deleteNote(noteId: string) {
      await db.update(threadNote).set({ deletedAt: new Date() }).where(eq(threadNote.id, noteId));
    },
  };
}
