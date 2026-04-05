import { describe, it, expect } from "vitest";
import {
  imapFlagsToMailFields,
  mailFieldsToImapFlags,
  applyFlagUpdate,
  SUPPORTED_FLAGS,
  PERMANENT_FLAGS,
} from "../src/flags.ts";

describe("RFC 3501 Section 2.3.2: System Flags", () => {
  it("defines the five system flags", () => {
    expect(SUPPORTED_FLAGS).toEqual(["\\Seen", "\\Answered", "\\Flagged", "\\Deleted", "\\Draft"]);
  });

  it("includes \\* in permanent flags for keyword support", () => {
    expect(PERMANENT_FLAGS).toContain("\\*");
    expect(PERMANENT_FLAGS.length).toBe(SUPPORTED_FLAGS.length + 1);
  });
});

describe("RFC 3501 Section 2.3.2: IMAP Flags to Mail Fields", () => {
  it("maps \\Seen to isRead", () => {
    const { fields } = imapFlagsToMailFields(["\\Seen"]);
    expect(fields.isRead).toBe(true);
  });

  it("maps \\Flagged to isStarred", () => {
    const { fields } = imapFlagsToMailFields(["\\Flagged"]);
    expect(fields.isStarred).toBe(true);
  });

  it("maps \\Deleted to deletedAt (soft delete)", () => {
    const { fields } = imapFlagsToMailFields(["\\Deleted"]);
    expect(fields.deletedAt).toBeInstanceOf(Date);
  });

  it("ignores \\Answered (derived from thread state)", () => {
    const { fields } = imapFlagsToMailFields(["\\Answered"]);
    expect(fields.isRead).toBeUndefined();
    expect(fields.isStarred).toBeUndefined();
    expect(fields.deletedAt).toBeUndefined();
  });

  it("ignores \\Draft (derived from folder)", () => {
    const { fields } = imapFlagsToMailFields(["\\Draft"]);
    expect(fields.isRead).toBeUndefined();
  });

  it("ignores \\Recent (server-managed, read-only)", () => {
    const { fields } = imapFlagsToMailFields(["\\Recent"]);
    expect(fields.isRead).toBeUndefined();
  });

  it("collects non-system flags as keywords", () => {
    const { keywords } = imapFlagsToMailFields(["\\Seen", "important", "todo"]);
    expect(keywords).toEqual(["important", "todo"]);
  });

  it("ignores unknown backslash-prefixed flags", () => {
    const { keywords } = imapFlagsToMailFields(["\\Unknown"]);
    expect(keywords).toEqual([]);
  });

  it("handles multiple flags simultaneously", () => {
    const { fields, keywords } = imapFlagsToMailFields([
      "\\Seen",
      "\\Flagged",
      "\\Deleted",
      "urgent",
    ]);
    expect(fields.isRead).toBe(true);
    expect(fields.isStarred).toBe(true);
    expect(fields.deletedAt).toBeInstanceOf(Date);
    expect(keywords).toEqual(["urgent"]);
  });

  it("returns empty fields and keywords for empty flags", () => {
    const { fields, keywords } = imapFlagsToMailFields([]);
    expect(fields).toEqual({});
    expect(keywords).toEqual([]);
  });
});

describe("RFC 3501 Section 2.3.2: Mail Fields to IMAP Flags", () => {
  const baseMessage = {
    isRead: false,
    isStarred: false,
    deletedAt: null,
    isOutbound: false,
  };

  it("maps isRead to \\Seen", () => {
    const flags = mailFieldsToImapFlags({ ...baseMessage, isRead: true });
    expect(flags).toContain("\\Seen");
  });

  it("maps isStarred to \\Flagged", () => {
    const flags = mailFieldsToImapFlags({ ...baseMessage, isStarred: true });
    expect(flags).toContain("\\Flagged");
  });

  it("maps non-null deletedAt to \\Deleted", () => {
    const flags = mailFieldsToImapFlags({
      ...baseMessage,
      deletedAt: new Date(),
    });
    expect(flags).toContain("\\Deleted");
  });

  it("maps deletedAt string to \\Deleted", () => {
    const flags = mailFieldsToImapFlags({
      ...baseMessage,
      deletedAt: "2026-04-05T00:00:00Z",
    });
    expect(flags).toContain("\\Deleted");
  });

  it("maps drafts folder to \\Draft", () => {
    const flags = mailFieldsToImapFlags(baseMessage, {
      folderSlug: "drafts",
    });
    expect(flags).toContain("\\Draft");
  });

  it("does not add \\Draft for non-drafts folders", () => {
    const flags = mailFieldsToImapFlags(baseMessage, {
      folderSlug: "inbox",
    });
    expect(flags).not.toContain("\\Draft");
  });

  it("maps threadHasOutboundReply to \\Answered", () => {
    const flags = mailFieldsToImapFlags(baseMessage, {
      threadHasOutboundReply: true,
    });
    expect(flags).toContain("\\Answered");
  });

  it("includes label names as keywords", () => {
    const flags = mailFieldsToImapFlags(baseMessage, {
      labelNames: ["important", "todo"],
    });
    expect(flags).toContain("important");
    expect(flags).toContain("todo");
  });

  it("returns empty flags for unread, unflagged, active message", () => {
    const flags = mailFieldsToImapFlags(baseMessage);
    expect(flags).toEqual([]);
  });

  it("combines multiple flags", () => {
    const flags = mailFieldsToImapFlags(
      { isRead: true, isStarred: true, deletedAt: null, isOutbound: false },
      { folderSlug: "drafts", threadHasOutboundReply: true, labelNames: ["urgent"] },
    );
    expect(flags).toContain("\\Seen");
    expect(flags).toContain("\\Flagged");
    expect(flags).toContain("\\Draft");
    expect(flags).toContain("\\Answered");
    expect(flags).toContain("urgent");
    expect(flags).not.toContain("\\Deleted");
  });
});

describe("RFC 3501 Section 6.4.6: STORE Flag Updates", () => {
  it("replaces all flags with FLAGS mode", () => {
    const result = applyFlagUpdate(["\\Seen", "\\Flagged"], ["\\Deleted"], "replace");
    expect(result).toEqual(["\\Deleted"]);
  });

  it("adds flags with +FLAGS mode", () => {
    const result = applyFlagUpdate(["\\Seen"], ["\\Flagged", "important"], "add");
    expect(result).toContain("\\Seen");
    expect(result).toContain("\\Flagged");
    expect(result).toContain("important");
  });

  it("does not duplicate existing flags on add", () => {
    const result = applyFlagUpdate(["\\Seen", "\\Flagged"], ["\\Seen", "important"], "add");
    const seenCount = result.filter((f) => f === "\\Seen").length;
    expect(seenCount).toBe(1);
  });

  it("removes flags with -FLAGS mode", () => {
    const result = applyFlagUpdate(
      ["\\Seen", "\\Flagged", "important"],
      ["\\Flagged", "important"],
      "remove",
    );
    expect(result).toEqual(["\\Seen"]);
  });

  it("ignores removal of non-existent flags", () => {
    const result = applyFlagUpdate(["\\Seen"], ["\\Flagged"], "remove");
    expect(result).toEqual(["\\Seen"]);
  });

  it("returns empty array when all flags removed", () => {
    const result = applyFlagUpdate(["\\Seen", "\\Flagged"], ["\\Seen", "\\Flagged"], "remove");
    expect(result).toEqual([]);
  });

  it("replaces with empty array clears all flags", () => {
    const result = applyFlagUpdate(["\\Seen", "\\Flagged"], [], "replace");
    expect(result).toEqual([]);
  });
});
