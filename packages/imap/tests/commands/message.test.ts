import { describe, it, expect, vi } from "vitest";
import {
  handleFetch,
  handleStore,
  handleSearch,
  handleExpunge,
  handleNoop,
  handleClose,
} from "../../src/commands/message.ts";
import type { MessageAdapter, MessageData } from "../../src/commands/message.ts";
import { ImapSession } from "../../src/session.ts";
import { UidMap } from "../../src/uid-map.ts";

function makeMessage(id: string, overrides: Partial<MessageData> = {}): MessageData {
  return {
    id,
    messageId: `<${id}@example.com>`,
    fromEmail: "alice@example.com",
    fromName: "Alice",
    toEmail: "bob@example.com",
    toName: "Bob",
    ccEmails: null,
    bccEmails: null,
    replyToEmail: null,
    subject: `Subject for ${id}`,
    snippet: "Preview text",
    blobKeyRaw: `blobs/raw/${id}`,
    blobKeyHtml: `blobs/html/${id}`,
    blobKeyText: `blobs/text/${id}`,
    isOutbound: false,
    isRead: false,
    isStarred: false,
    deletedAt: null,
    sizeBytes: 1234,
    receivedAt: new Date("2026-04-05T10:00:00Z"),
    sentAt: null,
    inReplyTo: null,
    threadId: "thread-1",
    ...overrides,
  };
}

const MSG_A = makeMessage("msg-a");
const MSG_B = makeMessage("msg-b", { isRead: true });
const MSG_C = makeMessage("msg-c", { deletedAt: new Date("2026-04-05T11:00:00Z") });

function mockAdapter(messages: MessageData[] = [MSG_A, MSG_B, MSG_C]): MessageAdapter {
  const msgMap = new Map(messages.map((m) => [m.id, m]));
  return {
    getMessage: vi.fn(async (id: string) => msgMap.get(id)),
    getMessagesByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => msgMap.get(id)).filter((m): m is MessageData => m !== undefined),
    ),
    updateMessageFlags: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    getBlob: vi.fn(async () => "Message body content"),
    searchMessages: vi.fn(async () => messages.map((m) => m.id)),
  };
}

function selectedSession(): ImapSession {
  const session = new ImapSession();
  session.authenticate();
  session.select({
    folderId: "folder-1",
    folderName: "INBOX",
    uidValidity: 1,
    uidNext: 100,
    isReadOnly: false,
  });
  return session;
}

function readOnlySession(): ImapSession {
  const session = new ImapSession();
  session.authenticate();
  session.examine({
    folderId: "folder-1",
    folderName: "INBOX",
    uidValidity: 1,
    uidNext: 100,
    isReadOnly: false,
  });
  return session;
}

function loadedUidMap(): UidMap {
  const map = new UidMap(1, 1);
  map.load([
    { uid: 10, messageId: "msg-a" },
    { uid: 20, messageId: "msg-b" },
    { uid: 30, messageId: "msg-c" },
  ]);
  return map;
}

describe("RFC 3501 Section 6.4.5: FETCH Command", () => {
  it("fetches FLAGS for a single message", async () => {
    const responses = await handleFetch(
      "a001",
      "1 FLAGS",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("FLAGS"))).toBe(true);
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });

  it("fetches UID for messages", async () => {
    const responses = await handleFetch(
      "a001",
      "1:* (FLAGS UID)",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("UID 10"))).toBe(true);
    expect(responses.some((r) => r.includes("UID 20"))).toBe(true);
  });

  it("fetches ENVELOPE data", async () => {
    const responses = await handleFetch(
      "a001",
      "1 ENVELOPE",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("ENVELOPE"))).toBe(true);
    expect(responses.some((r) => r.includes("alice"))).toBe(true);
  });

  it("fetches RFC822.SIZE", async () => {
    const responses = await handleFetch(
      "a001",
      "1 RFC822.SIZE",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("RFC822.SIZE 1234"))).toBe(true);
  });

  it("fetches BODY[] via blob storage", async () => {
    const responses = await handleFetch(
      "a001",
      "1 BODY[]",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("BODY[]"))).toBe(true);
    expect(responses.some((r) => r.includes("Message body content"))).toBe(true);
  });

  it("supports UID FETCH variant", async () => {
    const responses = await handleFetch(
      "a001",
      "10 FLAGS",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      true,
    );
    expect(responses.some((r) => r.includes("FLAGS"))).toBe(true);
  });

  it("rejects FETCH in non-selected state", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleFetch(
      "a001",
      "1 FLAGS",
      session,
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects FETCH with invalid arguments", async () => {
    const responses = await handleFetch(
      "a001",
      "",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 BAD");
  });

  it("handles missing blob gracefully (undefined from getBlob)", async () => {
    const adapter = mockAdapter();
    adapter.getBlob = vi.fn(async () => undefined);
    const responses = await handleFetch(
      "a001",
      "1 BODY[]",
      selectedSession(),
      loadedUidMap(),
      adapter,
      false,
    );
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });
});

describe("RFC 3501 Section 6.4.6: STORE Command", () => {
  it("adds flags with +FLAGS", async () => {
    const adapter = mockAdapter();
    const responses = await handleStore(
      "a001",
      "1 +FLAGS (\\Seen)",
      selectedSession(),
      loadedUidMap(),
      adapter,
      false,
    );
    expect(adapter.updateMessageFlags).toHaveBeenCalled();
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });

  it("returns updated flags in response", async () => {
    const responses = await handleStore(
      "a001",
      "1 +FLAGS (\\Seen)",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses.some((r) => r.includes("FETCH") && r.includes("FLAGS"))).toBe(true);
  });

  it("suppresses response with .SILENT modifier", async () => {
    const responses = await handleStore(
      "a001",
      "1 +FLAGS.SILENT (\\Seen)",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    const fetchResponses = responses.filter((r) => r.includes("FETCH"));
    expect(fetchResponses.length).toBe(0);
  });

  it("replaces all flags with FLAGS", async () => {
    const adapter = mockAdapter();
    await handleStore(
      "a001",
      "1 FLAGS (\\Flagged)",
      selectedSession(),
      loadedUidMap(),
      adapter,
      false,
    );
    expect(adapter.updateMessageFlags).toHaveBeenCalled();
  });

  it("removes flags with -FLAGS", async () => {
    const adapter = mockAdapter();
    await handleStore(
      "a001",
      "2 -FLAGS (\\Seen)",
      selectedSession(),
      loadedUidMap(),
      adapter,
      false,
    );
    expect(adapter.updateMessageFlags).toHaveBeenCalled();
  });

  it("supports UID STORE variant", async () => {
    const adapter = mockAdapter();
    const responses = await handleStore(
      "a001",
      "10 +FLAGS (\\Seen)",
      selectedSession(),
      loadedUidMap(),
      adapter,
      true,
    );
    expect(adapter.updateMessageFlags).toHaveBeenCalled();
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });

  it("rejects STORE on read-only folder (Section 6.4.6)", async () => {
    const responses = await handleStore(
      "a001",
      "1 +FLAGS (\\Seen)",
      readOnlySession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
    expect(responses[0]).toContain("read-only");
  });

  it("rejects STORE with invalid arguments", async () => {
    const responses = await handleStore(
      "a001",
      "",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 BAD");
  });
});

describe("RFC 3501 Section 6.4.4: SEARCH Command", () => {
  it("returns matching message sequence numbers", async () => {
    const responses = await handleSearch(
      "a001",
      "ALL",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("SEARCH");
    expect(responses[1]).toContain("a001 OK");
  });

  it("returns UIDs for UID SEARCH", async () => {
    const responses = await handleSearch(
      "a001",
      "ALL",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      true,
    );
    expect(responses[0]).toContain("SEARCH");
  });

  it("delegates criteria to MessageAdapter", async () => {
    const adapter = mockAdapter();
    await handleSearch("a001", "UNSEEN", selectedSession(), loadedUidMap(), adapter, false);
    expect(adapter.searchMessages).toHaveBeenCalled();
  });

  it("rejects SEARCH in non-selected state", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleSearch(
      "a001",
      "ALL",
      session,
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects SEARCH with invalid criteria", async () => {
    const responses = await handleSearch(
      "a001",
      "INVALIDCRITERIA",
      selectedSession(),
      loadedUidMap(),
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 BAD");
  });
});

describe("RFC 3501 Section 6.4.3: EXPUNGE Command", () => {
  it("removes messages with \\Deleted flag", async () => {
    const adapter = mockAdapter();
    const uidMap = loadedUidMap();
    const responses = await handleExpunge("a001", selectedSession(), uidMap, adapter);
    expect(adapter.deleteMessage).toHaveBeenCalledWith("msg-c");
    expect(responses.some((r) => r.includes("EXPUNGE"))).toBe(true);
    expect(responses[responses.length - 1]).toContain("a001 OK");
  });

  it("returns former sequence numbers in EXPUNGE responses", async () => {
    const responses = await handleExpunge("a001", selectedSession(), loadedUidMap(), mockAdapter());
    const expungeLines = responses.filter((r) => r.startsWith("*") && r.includes("EXPUNGE"));
    expect(expungeLines.length).toBe(1);
    expect(expungeLines[0]).toContain("3 EXPUNGE");
  });

  it("updates UID map after expunge", async () => {
    const uidMap = loadedUidMap();
    await handleExpunge("a001", selectedSession(), uidMap, mockAdapter());
    expect(uidMap.totalMessages()).toBe(2);
  });

  it("rejects EXPUNGE on read-only folder", async () => {
    const responses = await handleExpunge("a001", readOnlySession(), loadedUidMap(), mockAdapter());
    expect(responses[0]).toContain("a001 NO");
    expect(responses[0]).toContain("read-only");
  });

  it("rejects EXPUNGE in non-selected state", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleExpunge("a001", session, loadedUidMap(), mockAdapter());
    expect(responses[0]).toContain("a001 NO");
  });

  it("handles multiple deleted messages with correct sequence numbers", async () => {
    const multiDeleted = [
      makeMessage("msg-a", { deletedAt: new Date() }),
      makeMessage("msg-b"),
      makeMessage("msg-c", { deletedAt: new Date() }),
    ];
    const adapter = mockAdapter(multiDeleted);
    const uidMap = loadedUidMap();
    const responses = await handleExpunge("a001", selectedSession(), uidMap, adapter);
    const expungeLines = responses.filter((r) => r.startsWith("*") && r.includes("EXPUNGE"));
    expect(expungeLines.length).toBe(2);
    expect(uidMap.totalMessages()).toBe(1);
  });

  it("deletes from storage before mutating UID map", async () => {
    const callOrder: string[] = [];
    const adapter = mockAdapter();
    adapter.deleteMessage = vi.fn(async () => {
      callOrder.push("delete");
    });
    const uidMap = loadedUidMap();
    const origExpunge = uidMap.expungeUid.bind(uidMap);
    uidMap.expungeUid = (uid: number) => {
      callOrder.push("expunge");
      return origExpunge(uid);
    };
    await handleExpunge("a001", selectedSession(), uidMap, adapter);
    expect(callOrder).toEqual(["delete", "expunge"]);
  });
});

describe("RFC 3501 Section 6.1.2: NOOP Command", () => {
  it("returns tagged OK", () => {
    const responses = handleNoop("a001", selectedSession());
    expect(responses[0]).toContain("a001 OK");
  });

  it("works in any authenticated state", () => {
    const session = new ImapSession();
    const responses = handleNoop("a001", session);
    expect(responses[0]).toContain("a001 OK");
  });
});

describe("RFC 3501 Section 6.4.2: CLOSE Command", () => {
  it("silently expunges deleted messages", async () => {
    const adapter = mockAdapter();
    const responses = await handleClose("a001", selectedSession(), loadedUidMap(), adapter);
    expect(adapter.deleteMessage).toHaveBeenCalledWith("msg-c");
    expect(responses.some((r) => r.includes("EXPUNGE"))).toBe(false);
    expect(responses[0]).toContain("a001 OK");
  });

  it("returns session to authenticated state", async () => {
    const session = selectedSession();
    await handleClose("a001", session, loadedUidMap(), mockAdapter());
    expect(session.state).toBe("authenticated");
    expect(session.selectedFolder).toBeNull();
  });

  it("does not expunge on read-only folder", async () => {
    const adapter = mockAdapter();
    const session = readOnlySession();
    await handleClose("a001", session, loadedUidMap(), adapter);
    expect(adapter.deleteMessage).not.toHaveBeenCalled();
  });

  it("rejects CLOSE in non-selected state", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleClose("a001", session, loadedUidMap(), mockAdapter());
    expect(responses[0]).toContain("a001 NO");
  });
});
