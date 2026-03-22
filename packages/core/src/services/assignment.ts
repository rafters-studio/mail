import { and, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import { threadAssignment } from "../schema/tables.js";
import type { AssignmentService } from "../interfaces/services.js";

type DB = BaseSQLiteDatabase<"async", unknown>;

export function createAssignmentService(db: DB): AssignmentService {
  return {
    async assign(threadId: string, assigneeId: string, assignedBy?: string) {
      await db.insert(threadAssignment).values({
        id: uuidv7(),
        threadId,
        assigneeId,
        assignedBy: assignedBy ?? null,
        status: "active",
      });
    },

    async reassign(threadId: string, newAssigneeId: string, assignedBy?: string) {
      // Soft-close previous active assignment
      await db
        .update(threadAssignment)
        .set({ status: "reassigned", deletedAt: new Date() })
        .where(and(eq(threadAssignment.threadId, threadId), eq(threadAssignment.status, "active")));

      // Create new assignment
      await db.insert(threadAssignment).values({
        id: uuidv7(),
        threadId,
        assigneeId: newAssigneeId,
        assignedBy: assignedBy ?? null,
        status: "active",
      });
    },

    async complete(threadId: string) {
      await db
        .update(threadAssignment)
        .set({ status: "completed", completedAt: new Date() })
        .where(and(eq(threadAssignment.threadId, threadId), eq(threadAssignment.status, "active")));
    },

    async getActiveAssignment(threadId: string) {
      const row = await db
        .select()
        .from(threadAssignment)
        .where(and(eq(threadAssignment.threadId, threadId), eq(threadAssignment.status, "active")))
        .get();
      return row ?? null;
    },
  };
}
