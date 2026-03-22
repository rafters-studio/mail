import Database from "better-sqlite3";
import { type BaseSQLiteDatabase, drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { migrationSQL } from "../../src/migrations/index.js";
import {
  createAssignmentService,
  createFolderService,
  createLabelService,
  createNoteService,
  createThreadService,
} from "../../src/services/index.js";
import { inboxMessage, inboxThread, mailbox } from "../../src/schema/tables.js";

type AsyncDB = BaseSQLiteDatabase<"async", unknown>;

let sqlite: InstanceType<typeof Database>;
let db: AsyncDB;
let mailboxId: string;

function createDB(): { sqlite: InstanceType<typeof Database>; db: AsyncDB } {
  const raw = new Database(":memory:");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(migrationSQL);
  // Drizzle better-sqlite3 returns a sync DB. The services expect async,
  // but sync .all()/.get() return values that can be safely awaited.
  const d = drizzle(raw) as unknown as AsyncDB;
  return { sqlite: raw, db: d };
}

async function seedMailbox(database: AsyncDB): Promise<string> {
  const id = uuidv7();
  await database.insert(mailbox).values({
    id,
    emailAddress: `test-${id.slice(0, 8)}@example.com`,
    localPart: `test-${id.slice(0, 8)}`,
    organizationId: "org-test",
  });
  return id;
}

async function seedThread(database: AsyncDB, mbId: string, folderId?: string): Promise<string> {
  const id = uuidv7();
  await database.insert(inboxThread).values({
    id,
    mailboxId: mbId,
    subject: `Thread ${id.slice(0, 8)}`,
    folderId: folderId ?? null,
  });
  return id;
}

async function seedMessage(database: AsyncDB, mbId: string, threadId: string): Promise<string> {
  const id = uuidv7();
  await database.insert(inboxMessage).values({
    id,
    mailboxId: mbId,
    threadId,
    messageId: `<${uuidv7()}@example.com>`,
    fromEmail: "sender@example.com",
    toEmail: "receiver@example.com",
    subject: "Test message",
    blobKeyRaw: `raw/${id}`,
  });
  return id;
}

beforeEach(async () => {
  const created = createDB();
  sqlite = created.sqlite;
  db = created.db;
  mailboxId = await seedMailbox(db);
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------
// FolderService
// ---------------------------------------------------------------------------

describe("createFolderService", () => {
  it("initializes 6 system folders for a mailbox", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);

    const list = await folders.listFolders(mailboxId);
    expect(list).toHaveLength(6);

    const slugs = (list as Array<{ slug: string }>).map((f) => f.slug);
    expect(slugs).toContain("inbox");
    expect(slugs).toContain("sent");
    expect(slugs).toContain("drafts");
    expect(slugs).toContain("spam");
    expect(slugs).toContain("trash");
    expect(slugs).toContain("archive");
  });

  it("creates a custom folder", async () => {
    const folders = createFolderService(db);
    const created = (await folders.createFolder(mailboxId, "Receipts")) as { slug: string };
    expect(created.slug).toBe("receipts");

    const list = await folders.listFolders(mailboxId);
    expect(list).toHaveLength(1);
  });

  it("soft-deletes a custom folder", async () => {
    const folders = createFolderService(db);
    const created = (await folders.createFolder(mailboxId, "Temp")) as { id: string };

    await folders.deleteFolder(created.id);

    const list = await folders.listFolders(mailboxId);
    expect(list).toHaveLength(0);
  });

  it("throws when deleting a system folder", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);

    const list = (await folders.listFolders(mailboxId)) as Array<{
      id: string;
      slug: string;
    }>;
    const inboxFolder = list.find((f) => f.slug === "inbox");

    await expect(folders.deleteFolder(inboxFolder!.id)).rejects.toThrow(
      "Cannot delete system folders",
    );
  });
});

// ---------------------------------------------------------------------------
// LabelService
// ---------------------------------------------------------------------------

describe("createLabelService", () => {
  it("creates a label and lists it", async () => {
    const labels = createLabelService(db);
    const created = (await labels.createLabel(mailboxId, "Urgent")) as { slug: string };
    expect(created.slug).toBe("urgent");

    const list = await labels.listLabels(mailboxId);
    expect(list).toHaveLength(1);
  });

  it("applies a label to a message and removes it", async () => {
    const labels = createLabelService(db);
    const label = (await labels.createLabel(mailboxId, "VIP")) as { id: string };

    const threadId = await seedThread(db, mailboxId);
    const messageId = await seedMessage(db, mailboxId, threadId);

    // Apply should not throw
    await labels.applyToMessage(messageId, label.id, "user-1");

    // Remove should not throw
    await labels.removeFromMessage(messageId, label.id);
  });

  it("applies a label to a thread and removes it", async () => {
    const labels = createLabelService(db);
    const label = (await labels.createLabel(mailboxId, "Followup")) as { id: string };
    const threadId = await seedThread(db, mailboxId);

    await labels.applyToThread(threadId, label.id, "user-1");
    await labels.removeFromThread(threadId, label.id);
  });
});

// ---------------------------------------------------------------------------
// NoteService
// ---------------------------------------------------------------------------

describe("createNoteService", () => {
  it("adds a note and lists it", async () => {
    const notes = createNoteService(db);
    const threadId = await seedThread(db, mailboxId);

    const note = (await notes.addNote(threadId, "user-1", "Remember to follow up")) as {
      id: string;
    };
    expect(note.id).toBeDefined();

    const list = await notes.listNotes(threadId);
    expect(list).toHaveLength(1);
  });

  it("soft-deletes a note", async () => {
    const notes = createNoteService(db);
    const threadId = await seedThread(db, mailboxId);

    const note = (await notes.addNote(threadId, "user-1", "Temporary note")) as { id: string };
    await notes.deleteNote(note.id);

    const list = await notes.listNotes(threadId);
    expect(list).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AssignmentService
// ---------------------------------------------------------------------------

describe("createAssignmentService", () => {
  it("assigns a thread and retrieves the active assignment", async () => {
    const assignments = createAssignmentService(db);
    const threadId = await seedThread(db, mailboxId);

    await assignments.assign(threadId, "agent-1", "manager-1");

    const active = (await assignments.getActiveAssignment(threadId)) as {
      assigneeId: string;
    };
    expect(active).not.toBeNull();
    expect(active.assigneeId).toBe("agent-1");
  });

  it("reassign soft-deletes the previous assignment", async () => {
    const assignments = createAssignmentService(db);
    const threadId = await seedThread(db, mailboxId);

    await assignments.assign(threadId, "agent-1");
    await assignments.reassign(threadId, "agent-2", "manager-1");

    const active = (await assignments.getActiveAssignment(threadId)) as {
      assigneeId: string;
    };
    expect(active.assigneeId).toBe("agent-2");
  });

  it("completes the active assignment", async () => {
    const assignments = createAssignmentService(db);
    const threadId = await seedThread(db, mailboxId);

    await assignments.assign(threadId, "agent-1");
    await assignments.complete(threadId);

    const active = await assignments.getActiveAssignment(threadId);
    expect(active).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ThreadService
// ---------------------------------------------------------------------------

describe("createThreadService", () => {
  it("lists threads for a mailbox", async () => {
    const threads = createThreadService(db);
    await seedThread(db, mailboxId);
    await seedThread(db, mailboxId);

    const list = await threads.listThreads(mailboxId);
    expect(list).toHaveLength(2);
  });

  it("filters threads by folder", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);
    const folderList = (await folders.listFolders(mailboxId)) as Array<{
      id: string;
      slug: string;
    }>;
    const inboxFolderId = folderList.find((f) => f.slug === "inbox")!.id;

    const threads = createThreadService(db);
    await seedThread(db, mailboxId, inboxFolderId);
    await seedThread(db, mailboxId); // no folder

    const filtered = await threads.listThreads(mailboxId, inboxFolderId);
    expect(filtered).toHaveLength(1);
  });

  it("moves a thread to a different folder", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);
    const folderList = (await folders.listFolders(mailboxId)) as Array<{
      id: string;
      slug: string;
    }>;
    const sentFolderId = folderList.find((f) => f.slug === "sent")!.id;

    const threads = createThreadService(db);
    const threadId = await seedThread(db, mailboxId);

    await threads.moveToFolder(threadId, sentFolderId);

    const thread = (await threads.getThread(threadId)) as { folderId: string };
    expect(thread.folderId).toBe(sentFolderId);
  });

  it("updates thread status", async () => {
    const threads = createThreadService(db);
    const threadId = await seedThread(db, mailboxId);

    await threads.updateStatus(threadId, "resolved");

    const thread = (await threads.getThread(threadId)) as { status: string };
    expect(thread.status).toBe("resolved");
  });

  it("updates thread priority", async () => {
    const threads = createThreadService(db);
    const threadId = await seedThread(db, mailboxId);

    await threads.updatePriority(threadId, "urgent");

    const thread = (await threads.getThread(threadId)) as { priority: string };
    expect(thread.priority).toBe("urgent");
  });

  it("archives a thread into the archive folder", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);
    const folderList = (await folders.listFolders(mailboxId)) as Array<{
      id: string;
      slug: string;
    }>;
    const archiveFolderId = folderList.find((f) => f.slug === "archive")!.id;

    const threads = createThreadService(db);
    const threadId = await seedThread(db, mailboxId);

    await threads.archive(threadId);

    const thread = (await threads.getThread(threadId)) as {
      folderId: string;
      archivedAt: unknown;
    };
    expect(thread.folderId).toBe(archiveFolderId);
    expect(thread.archivedAt).not.toBeNull();
  });

  it("trashes a thread into the trash folder and sets deletedAt", async () => {
    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);

    const threads = createThreadService(db);
    const threadId = await seedThread(db, mailboxId);

    await threads.trash(threadId);

    // Thread is now soft-deleted, so getThread (which filters deleted_at IS NULL) returns undefined
    const thread = await threads.getThread(threadId);
    expect(thread).toBeUndefined();
  });
});
