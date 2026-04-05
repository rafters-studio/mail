import { describe, it, expect, vi } from "vitest";
import {
  handleSelect,
  handleExamine,
  handleList,
  handleLsub,
  handleStatus,
} from "../../src/commands/mailbox.ts";
import type { MailboxAdapter, FolderInfo, FolderStats } from "../../src/commands/mailbox.ts";
import { ImapSession } from "../../src/session.ts";

const INBOX_FOLDER: FolderInfo = {
  id: "folder-inbox",
  name: "INBOX",
  slug: "inbox",
  isSystem: true,
  hasChildren: false,
};

const SENT_FOLDER: FolderInfo = {
  id: "folder-sent",
  name: "Sent",
  slug: "sent",
  isSystem: true,
  hasChildren: false,
};

const INBOX_STATS: FolderStats = {
  messages: 47,
  recent: 3,
  unseen: 12,
  uidValidity: 1,
  uidNext: 100,
};

const MESSAGES = [
  { uid: 10, messageId: "msg-a" },
  { uid: 20, messageId: "msg-b" },
  { uid: 30, messageId: "msg-c" },
];

function mockAdapter(
  folders: FolderInfo[] = [INBOX_FOLDER, SENT_FOLDER],
  stats: FolderStats = INBOX_STATS,
  messages: Array<{ uid: number; messageId: string }> = MESSAGES,
): MailboxAdapter {
  return {
    listFolders: vi.fn(async () => folders),
    getFolderByName: vi.fn(async (_mailboxId: string, name: string) =>
      folders.find((f) => f.name.toUpperCase() === name.toUpperCase()),
    ),
    getFolderStats: vi.fn(async () => stats),
    getMessageUids: vi.fn(async () => messages),
  };
}

function authenticatedSession(): ImapSession {
  const session = new ImapSession();
  session.authenticate();
  return session;
}

describe("RFC 3501 Section 6.3.1: SELECT Command", () => {
  it("opens folder and returns EXISTS, RECENT, FLAGS, UIDVALIDITY, UIDNEXT", async () => {
    const session = authenticatedSession();
    const result = await handleSelect("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.responses.some((r) => r.includes("47 EXISTS"))).toBe(true);
    expect(result.responses.some((r) => r.includes("3 RECENT"))).toBe(true);
    expect(result.responses.some((r) => r.includes("UIDVALIDITY 1"))).toBe(true);
    expect(result.responses.some((r) => r.includes("FLAGS"))).toBe(true);
    expect(result.responses.some((r) => r.includes("READ-WRITE"))).toBe(true);
  });

  it("transitions session to selected state", async () => {
    const session = authenticatedSession();
    await handleSelect("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(session.state).toBe("selected");
    expect(session.selectedFolder?.folderName).toBe("INBOX");
  });

  it("returns UID map for the folder", async () => {
    const session = authenticatedSession();
    const result = await handleSelect("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.uidMap).not.toBeNull();
    expect(result.uidMap?.totalMessages()).toBe(3);
  });

  it("rejects SELECT for non-existent folder", async () => {
    const session = authenticatedSession();
    const result = await handleSelect("a001", "NonExistent", session, "mbx-1", mockAdapter());
    expect(result.responses[0]).toContain("a001 NO");
    expect(result.uidMap).toBeNull();
  });

  it("rejects SELECT in not-authenticated state", async () => {
    const session = new ImapSession();
    const result = await handleSelect("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.responses[0]).toContain("a001 NO");
  });

  it("allows re-SELECT from selected state (Section 6.3.1)", async () => {
    const session = authenticatedSession();
    await handleSelect("a001", "INBOX", session, "mbx-1", mockAdapter());
    const result = await handleSelect("a002", "Sent", session, "mbx-1", mockAdapter());
    expect(session.selectedFolder?.folderName).toBe("Sent");
    expect(result.responses.some((r) => r.includes("a002 OK"))).toBe(true);
  });

  it("handles quoted folder names", async () => {
    const session = authenticatedSession();
    const result = await handleSelect("a001", '"INBOX"', session, "mbx-1", mockAdapter());
    expect(result.responses.some((r) => r.includes("a001 OK"))).toBe(true);
  });

  it("rejects SELECT with missing folder name", async () => {
    const session = authenticatedSession();
    const result = await handleSelect("a001", "", session, "mbx-1", mockAdapter());
    expect(result.responses[0]).toContain("a001 BAD");
  });
});

describe("RFC 3501 Section 6.3.2: EXAMINE Command", () => {
  it("opens folder as read-only", async () => {
    const session = authenticatedSession();
    const result = await handleExamine("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.responses.some((r) => r.includes("READ-ONLY"))).toBe(true);
    expect(session.isReadOnly()).toBe(true);
  });

  it("returns same folder stats as SELECT", async () => {
    const session = authenticatedSession();
    const result = await handleExamine("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.responses.some((r) => r.includes("47 EXISTS"))).toBe(true);
    expect(result.responses.some((r) => r.includes("UIDVALIDITY"))).toBe(true);
  });

  it("returns UID map", async () => {
    const session = authenticatedSession();
    const result = await handleExamine("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(result.uidMap).not.toBeNull();
  });
});

describe("RFC 3501 Section 6.3.8: LIST Command", () => {
  it("returns all folders matching * pattern", async () => {
    const session = authenticatedSession();
    const responses = await handleList("a001", '"" *', session, "mbx-1", mockAdapter());
    expect(responses.some((r) => r.includes("INBOX"))).toBe(true);
    expect(responses.some((r) => r.includes("Sent"))).toBe(true);
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });

  it("returns hierarchy delimiter for empty pattern (Section 6.3.8)", async () => {
    const session = authenticatedSession();
    const responses = await handleList("a001", '"" ""', session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("\\Noselect");
    expect(responses[0]).toContain('"/"');
  });

  it("includes system folder flags (\\Inbox, \\Sent, etc.)", async () => {
    const session = authenticatedSession();
    const responses = await handleList("a001", '"" *', session, "mbx-1", mockAdapter());
    const inboxLine = responses.find((r) => r.includes("INBOX"));
    expect(inboxLine).toContain("\\Inbox");
    const sentLine = responses.find((r) => r.includes("Sent"));
    expect(sentLine).toContain("\\Sent");
  });

  it("includes \\HasNoChildren flag for leaf folders", async () => {
    const session = authenticatedSession();
    const responses = await handleList("a001", '"" *', session, "mbx-1", mockAdapter());
    const inboxLine = responses.find((r) => r.includes("INBOX"));
    expect(inboxLine).toContain("\\HasNoChildren");
  });

  it("includes \\HasChildren flag for parent folders", async () => {
    const parentFolder: FolderInfo = { ...INBOX_FOLDER, hasChildren: true };
    const session = authenticatedSession();
    const responses = await handleList(
      "a001",
      '"" *',
      session,
      "mbx-1",
      mockAdapter([parentFolder]),
    );
    expect(responses[0]).toContain("\\HasChildren");
  });

  it("rejects LIST in not-authenticated state", async () => {
    const session = new ImapSession();
    const responses = await handleList("a001", '"" *', session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects LIST with missing arguments", async () => {
    const session = authenticatedSession();
    const responses = await handleList("a001", "", session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 BAD");
  });
});

describe("RFC 3501 Section 6.3.9: LSUB Command", () => {
  it("returns same results as LIST (MVP: all folders subscribed)", async () => {
    const session = authenticatedSession();
    const listResponses = await handleList("a001", '"" *', session, "mbx-1", mockAdapter());
    const lsubResponses = await handleLsub("a002", '"" *', session, "mbx-1", mockAdapter());
    expect(lsubResponses.length).toBe(listResponses.length);
  });
});

describe("RFC 3501 Section 6.3.10: STATUS Command", () => {
  it("returns requested status items", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus(
      "a001",
      "INBOX (MESSAGES RECENT UNSEEN)",
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("MESSAGES 47");
    expect(responses[0]).toContain("RECENT 3");
    expect(responses[0]).toContain("UNSEEN 12");
  });

  it("returns UIDNEXT and UIDVALIDITY", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus(
      "a001",
      "INBOX (UIDNEXT UIDVALIDITY)",
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("UIDNEXT 100");
    expect(responses[0]).toContain("UIDVALIDITY 1");
  });

  it("rejects STATUS for non-existent folder", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus(
      "a001",
      "NonExistent (MESSAGES)",
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects STATUS with missing item list", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus("a001", "INBOX", session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 BAD");
  });

  it("rejects STATUS with invalid items", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus("a001", "INBOX (FOOBAR)", session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 BAD");
  });

  it("rejects STATUS in not-authenticated state", async () => {
    const session = new ImapSession();
    const responses = await handleStatus(
      "a001",
      "INBOX (MESSAGES)",
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("handles quoted mailbox names", async () => {
    const session = authenticatedSession();
    const responses = await handleStatus(
      "a001",
      '"INBOX" (MESSAGES)',
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("MESSAGES 47");
  });
});
