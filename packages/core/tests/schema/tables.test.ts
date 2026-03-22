import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  inboxAttachment,
  inboxFolder,
  inboxLabel,
  inboxMessage,
  inboxMessageLabel,
  inboxThread,
  inboxThreadLabel,
  mailbox,
  threadAssignment,
  threadNote,
} from "../../src/schema/tables.js";

describe("drizzle table definitions", () => {
  it("defines all 10 tables with correct names", () => {
    expect(getTableName(mailbox)).toBe("mailbox");
    expect(getTableName(inboxFolder)).toBe("inbox_folder");
    expect(getTableName(inboxLabel)).toBe("inbox_label");
    expect(getTableName(inboxThread)).toBe("inbox_thread");
    expect(getTableName(inboxMessage)).toBe("inbox_message");
    expect(getTableName(inboxMessageLabel)).toBe("inbox_message_label");
    expect(getTableName(inboxThreadLabel)).toBe("inbox_thread_label");
    expect(getTableName(inboxAttachment)).toBe("inbox_attachment");
    expect(getTableName(threadAssignment)).toBe("thread_assignment");
    expect(getTableName(threadNote)).toBe("thread_note");
  });

  it("mailbox has all required columns", () => {
    const columns = Object.keys(mailbox);
    expect(columns).toContain("id");
    expect(columns).toContain("type");
    expect(columns).toContain("emailAddress");
    expect(columns).toContain("localPart");
    expect(columns).toContain("ownerId");
    expect(columns).toContain("organizationId");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
    expect(columns).toContain("deletedAt");
  });

  it("inboxMessage has RFC 5322 header columns", () => {
    const columns = Object.keys(inboxMessage);
    expect(columns).toContain("messageId");
    expect(columns).toContain("inReplyTo");
    expect(columns).toContain("references");
    expect(columns).toContain("fromEmail");
    expect(columns).toContain("toEmail");
  });

  it("inboxMessage has blob storage columns instead of R2-specific columns", () => {
    const columns = Object.keys(inboxMessage);
    expect(columns).toContain("blobKeyRaw");
    expect(columns).toContain("blobKeyHtml");
    expect(columns).toContain("blobKeyText");
    expect(columns).not.toContain("r2KeyRaw");
  });

  it("inboxMessage has AI classification columns", () => {
    const columns = Object.keys(inboxMessage);
    expect(columns).toContain("aiCategory");
    expect(columns).toContain("aiConfidence");
    expect(columns).toContain("aiSummary");
  });

  it("all tables have soft delete via deletedAt", () => {
    const tables = [
      mailbox,
      inboxFolder,
      inboxLabel,
      inboxThread,
      inboxMessage,
      inboxAttachment,
      threadAssignment,
      threadNote,
    ];
    for (const table of tables) {
      expect(Object.keys(table)).toContain("deletedAt");
    }
  });

  it("user references are plain text columns without FK", () => {
    expect(mailbox.ownerId.columnType).toBe("SQLiteText");
    expect(threadAssignment.assigneeId.columnType).toBe("SQLiteText");
    expect(threadAssignment.assignedBy.columnType).toBe("SQLiteText");
    expect(threadNote.authorId.columnType).toBe("SQLiteText");
  });
});
