import { describe, it, expect } from "vitest";
import {
  handleIdleStart,
  handleIdleDone,
  isIdleDone,
  handleIdleBadInput,
  generateIdleNotification,
} from "../../src/commands/session.ts";
import { ImapSession } from "../../src/session.ts";

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

describe("RFC 2177: IDLE Command", () => {
  it("returns continuation response when entering IDLE", () => {
    const result = handleIdleStart("a001", selectedSession());
    expect(result.response).toContain("+ idling");
    expect(result.idleState).not.toBeNull();
  });

  it("creates active idle state with original tag", () => {
    const result = handleIdleStart("a001", selectedSession());
    expect(result.idleState?.active).toBe(true);
    expect(result.idleState?.tag).toBe("a001");
  });

  it("rejects IDLE in non-selected state", () => {
    const session = new ImapSession();
    session.authenticate();
    const result = handleIdleStart("a001", session);
    expect(result.response).toContain("a001 NO");
    expect(result.idleState).toBeNull();
  });

  it("rejects IDLE in not-authenticated state", () => {
    const session = new ImapSession();
    const result = handleIdleStart("a001", session);
    expect(result.response).toContain("a001 NO");
    expect(result.idleState).toBeNull();
  });
});

describe("RFC 2177: DONE Command", () => {
  it("returns tagged OK with original IDLE tag", () => {
    const result = handleIdleStart("a001", selectedSession());
    if (!result.idleState) throw new Error("Expected idle state");
    const response = handleIdleDone(result.idleState);
    expect(response).toContain("a001 OK");
    expect(response).toContain("IDLE completed");
  });

  it("deactivates idle state", () => {
    const result = handleIdleStart("a001", selectedSession());
    if (!result.idleState) throw new Error("Expected idle state");
    handleIdleDone(result.idleState);
    expect(result.idleState.active).toBe(false);
  });
});

describe("RFC 2177: IDLE Input Validation", () => {
  it("recognizes DONE command (case-insensitive)", () => {
    expect(isIdleDone("DONE")).toBe(true);
    expect(isIdleDone("done")).toBe(true);
    expect(isIdleDone("Done")).toBe(true);
    expect(isIdleDone("  DONE  ")).toBe(true);
  });

  it("rejects non-DONE input", () => {
    expect(isIdleDone("a001 NOOP")).toBe(false);
    expect(isIdleDone("")).toBe(false);
    expect(isIdleDone("DONEX")).toBe(false);
  });

  it("returns BAD for invalid input during IDLE", () => {
    const result = handleIdleStart("a001", selectedSession());
    if (!result.idleState) throw new Error("Expected idle state");
    const response = handleIdleBadInput(result.idleState);
    expect(response).toContain("a001 BAD");
    expect(response).toContain("Expected DONE");
  });
});

describe("RFC 2177: IDLE Notifications", () => {
  it("generates EXISTS response for new mail", () => {
    const notification = generateIdleNotification(48);
    expect(notification).toContain("* 48 EXISTS");
  });

  it("generates correct count for single new message", () => {
    const notification = generateIdleNotification(1);
    expect(notification).toContain("* 1 EXISTS");
  });
});
