import { describe, it, expect, vi } from "vitest";
import {
  handleCopy,
  handleMove,
  handleAppend,
  handleUnselect,
} from "../../src/commands/extensions.ts";
import type { ExtensionAdapter } from "../../src/commands/extensions.ts";
import { ImapSession } from "../../src/session.ts";
import { UidMap } from "../../src/uid-map.ts";

function mockAdapter(): ExtensionAdapter {
  return {
    copyMessage: vi.fn(async () => ({ newUid: 200, uidValidity: 42 })),
    moveMessage: vi.fn(async () => ({ newUid: 201, uidValidity: 42 })),
    appendMessage: vi.fn(async () => ({
      uid: 300,
      uidValidity: 42,
      messageId: "new-msg",
    })),
    getFolderIdByName: vi.fn(async (_mbx: string, name: string) =>
      name.toUpperCase() === "SENT" ? "folder-sent" : undefined,
    ),
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

describe("RFC 3501 Section 6.4.7: COPY Command", () => {
  it("copies messages to target folder", async () => {
    const adapter = mockAdapter();
    const responses = await handleCopy(
      "a001",
      "1:3 Sent",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      adapter,
      false,
    );
    expect(adapter.copyMessage).toHaveBeenCalledTimes(3);
    expect(responses[0]).toContain("a001 OK");
    expect(responses[0]).toContain("COPYUID");
  });

  // RFC 4315 Section 3: COPYUID response code returns the DESTINATION
  // mailbox's UIDVALIDITY as its first argument, not the source's. The
  // source session has uidValidity: 1 (selectedSession) and the mock
  // adapter returns copies from a folder with uidValidity: 42. The
  // response must carry 42 -- not 1 (source) and not any other constant.
  it("returns destination UIDVALIDITY in COPYUID response (RFC 4315 Section 3)", async () => {
    const adapter = mockAdapter();
    const responses = await handleCopy(
      "a001",
      "1:3 Sent",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      adapter,
      false,
    );
    expect(responses[0]).toContain("[COPYUID 42 ");
  });

  it("supports UID COPY", async () => {
    const adapter = mockAdapter();
    await handleCopy("a001", "10 Sent", selectedSession(), loadedUidMap(), "mbx-1", adapter, true);
    expect(adapter.copyMessage).toHaveBeenCalledWith("msg-a", "folder-sent");
  });

  it("rejects COPY to non-existent folder", async () => {
    const responses = await handleCopy(
      "a001",
      "1 NonExistent",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects COPY with missing arguments", async () => {
    const responses = await handleCopy(
      "a001",
      "",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 BAD");
  });

  it("rejects COPY in non-selected state", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleCopy(
      "a001",
      "1 Sent",
      session,
      loadedUidMap(),
      "mbx-1",
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
  });
});

describe("RFC 6851: MOVE Command", () => {
  it("moves messages and returns EXPUNGE responses", async () => {
    const adapter = mockAdapter();
    const uidMap = loadedUidMap();
    const responses = await handleMove(
      "a001",
      "1 Sent",
      selectedSession(),
      uidMap,
      "mbx-1",
      adapter,
      false,
    );
    expect(adapter.moveMessage).toHaveBeenCalledWith("msg-a", "folder-sent");
    expect(responses.some((r) => r.startsWith("*") && r.includes("EXPUNGE"))).toBe(true);
    expect(responses[responses.length - 1]).toContain("a001 OK");
    expect(responses[responses.length - 1]).toContain("COPYUID");
    expect(uidMap.totalMessages()).toBe(2);
  });

  // RFC 6851 Section 4 inherits the RFC 4315 COPYUID semantics for MOVE.
  // The first argument is the DESTINATION mailbox's UIDVALIDITY. The mock
  // moveMessage returns uidValidity: 42; the response must carry 42, not
  // the source validity of 1.
  it("returns destination UIDVALIDITY in MOVE's COPYUID response (RFC 6851 Section 4)", async () => {
    const adapter = mockAdapter();
    const responses = await handleMove(
      "a001",
      "1 Sent",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      adapter,
      false,
    );
    const tagged = responses[responses.length - 1];
    expect(tagged).toContain("[COPYUID 42 ");
  });

  it("rejects MOVE on read-only folder", async () => {
    const responses = await handleMove(
      "a001",
      "1 Sent",
      readOnlySession(),
      loadedUidMap(),
      "mbx-1",
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
    expect(responses[0]).toContain("read-only");
  });

  it("rejects MOVE to non-existent folder", async () => {
    const responses = await handleMove(
      "a001",
      "1 NonExistent",
      selectedSession(),
      loadedUidMap(),
      "mbx-1",
      mockAdapter(),
      false,
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("supports UID MOVE", async () => {
    const adapter = mockAdapter();
    const uidMap = loadedUidMap();
    await handleMove("a001", "10 Sent", selectedSession(), uidMap, "mbx-1", adapter, true);
    expect(adapter.moveMessage).toHaveBeenCalledWith("msg-a", "folder-sent");
  });
});

describe("RFC 3501 Section 6.3.6: APPEND Command", () => {
  it("appends message to folder", async () => {
    const adapter = mockAdapter();
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleAppend(
      "a001",
      "Sent Message content here",
      session,
      "mbx-1",
      adapter,
    );
    expect(adapter.appendMessage).toHaveBeenCalledWith(
      "folder-sent",
      "Message content here",
      [],
      undefined,
    );
    expect(responses[0]).toContain("a001 OK");
    expect(responses[0]).toContain("APPENDUID");
  });

  // RFC 4315 Section 3: APPENDUID response code returns the destination
  // mailbox's UIDVALIDITY as its first argument. The mock adapter returns
  // uidValidity: 42; the response must carry that value, not a constant.
  it("returns destination UIDVALIDITY in APPENDUID response (RFC 4315 Section 3)", async () => {
    const adapter = mockAdapter();
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleAppend(
      "a001",
      "Sent Message content here",
      session,
      "mbx-1",
      adapter,
    );
    expect(responses[0]).toContain("[APPENDUID 42 300]");
  });

  it("appends with flags", async () => {
    const adapter = mockAdapter();
    const session = new ImapSession();
    session.authenticate();
    await handleAppend(
      "a001",
      "Sent (\\Seen \\Flagged) Message content",
      session,
      "mbx-1",
      adapter,
    );
    expect(adapter.appendMessage).toHaveBeenCalledWith(
      "folder-sent",
      "Message content",
      ["\\Seen", "\\Flagged"],
      undefined,
    );
  });

  it("rejects APPEND to non-existent folder", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleAppend(
      "a001",
      "NonExistent Message content",
      session,
      "mbx-1",
      mockAdapter(),
    );
    expect(responses[0]).toContain("a001 NO");
  });

  it("rejects APPEND with missing content", async () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = await handleAppend("a001", "Sent", session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 BAD");
  });

  it("rejects APPEND in not-authenticated state", async () => {
    const session = new ImapSession();
    const responses = await handleAppend("a001", "Sent content", session, "mbx-1", mockAdapter());
    expect(responses[0]).toContain("a001 NO");
  });
});

describe("RFC 3691: UNSELECT Command", () => {
  it("closes folder without expunging", () => {
    const session = selectedSession();
    const responses = handleUnselect("a001", session);
    expect(responses[0]).toContain("a001 OK");
    expect(session.state).toBe("authenticated");
    expect(session.selectedFolder).toBeNull();
  });

  it("rejects UNSELECT in non-selected state", () => {
    const session = new ImapSession();
    session.authenticate();
    const responses = handleUnselect("a001", session);
    expect(responses[0]).toContain("a001 NO");
  });
});
