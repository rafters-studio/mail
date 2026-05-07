import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type {
  AssignmentService,
  FolderService,
  LabelService,
  NoteService,
  ThreadService,
} from "@rafters/mail";
import { createAssignmentService } from "./assignment.js";
import { createFolderService } from "./folder.js";
import { createLabelService } from "./label.js";
import { createNoteService } from "./note.js";
import { createThreadService } from "./thread.js";

export { createFolderService } from "./folder.js";
export { createLabelService } from "./label.js";
export { createAssignmentService } from "./assignment.js";
export { createNoteService } from "./note.js";
export { createThreadService } from "./thread.js";

type DB = BaseSQLiteDatabase<"async", unknown>;

export interface MailServices {
  threads: ThreadService;
  folders: FolderService;
  labels: LabelService;
  assignments: AssignmentService;
  notes: NoteService;
}

export function createMailServices(db: DB): MailServices {
  return {
    threads: createThreadService(db),
    folders: createFolderService(db),
    labels: createLabelService(db),
    assignments: createAssignmentService(db),
    notes: createNoteService(db),
  };
}
