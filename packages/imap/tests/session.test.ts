import { describe, it, expect } from "vitest";
import { ImapSession } from "../src/session.ts";
import type { SelectedFolderInfo } from "../src/session.ts";

const FOLDER: SelectedFolderInfo = {
  folderId: "folder-001",
  folderName: "INBOX",
  uidValidity: 1,
  uidNext: 100,
  isReadOnly: false,
};

describe("RFC 3501 Section 3: Session States", () => {
  it("starts in not-authenticated state", () => {
    const session = new ImapSession();
    expect(session.state).toBe("not-authenticated");
  });

  it("transitions to authenticated after LOGIN", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(session.state).toBe("authenticated");
  });

  it("transitions to selected after SELECT", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    expect(session.state).toBe("selected");
    expect(session.selectedFolder).toEqual(FOLDER);
  });

  it("transitions back to authenticated after CLOSE", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    session.close();
    expect(session.state).toBe("authenticated");
    expect(session.selectedFolder).toBeNull();
  });

  it("transitions to logout from any state", () => {
    const session = new ImapSession();
    session.logout();
    expect(session.state).toBe("logout");
  });

  it("allows re-SELECT from selected state (Section 6.3.1)", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    const otherFolder: SelectedFolderInfo = {
      ...FOLDER,
      folderId: "folder-002",
      folderName: "Sent",
    };
    session.select(otherFolder);
    expect(session.state).toBe("selected");
    expect(session.selectedFolder?.folderName).toBe("Sent");
  });

  it("EXAMINE sets read-only flag (Section 6.3.2)", () => {
    const session = new ImapSession();
    session.authenticate();
    session.examine(FOLDER);
    expect(session.state).toBe("selected");
    expect(session.isReadOnly()).toBe(true);
  });
});

describe("RFC 3501 Section 6: Command State Requirements", () => {
  it("allows CAPABILITY in any state (Section 6.1.1)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("CAPABILITY")).toBeNull();
    session.authenticate();
    expect(session.validateCommand("CAPABILITY")).toBeNull();
    session.select(FOLDER);
    expect(session.validateCommand("CAPABILITY")).toBeNull();
  });

  it("allows NOOP in any state (Section 6.1.2)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("NOOP")).toBeNull();
  });

  it("allows LOGOUT in any state (Section 6.1.3)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("LOGOUT")).toBeNull();
  });

  it("allows LOGIN only in not-authenticated state (Section 6.2.3)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("LOGIN")).toBeNull();
    session.authenticate();
    expect(session.validateCommand("LOGIN")).toBe("Already authenticated");
  });

  it("rejects SELECT in not-authenticated state (Section 6.3.1)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("SELECT")).toContain("requires authenticated");
  });

  it("allows SELECT in authenticated state (Section 6.3.1)", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(session.validateCommand("SELECT")).toBeNull();
  });

  it("allows SELECT in selected state for re-selecting (Section 6.3.1)", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    expect(session.validateCommand("SELECT")).toBeNull();
  });

  it("rejects FETCH in not-authenticated state (Section 6.4.5)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("FETCH")).toContain("requires selected");
  });

  it("rejects FETCH in authenticated state (Section 6.4.5)", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(session.validateCommand("FETCH")).toContain("requires selected");
  });

  it("allows FETCH in selected state (Section 6.4.5)", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    expect(session.validateCommand("FETCH")).toBeNull();
  });

  it("rejects STORE in not-authenticated state (Section 6.4.6)", () => {
    const session = new ImapSession();
    expect(session.validateCommand("STORE")).toContain("requires selected");
  });

  it("allows LIST in authenticated state (Section 6.3.8)", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(session.validateCommand("LIST")).toBeNull();
  });

  it("allows LIST in selected state (Section 6.3.8)", () => {
    const session = new ImapSession();
    session.authenticate();
    session.select(FOLDER);
    expect(session.validateCommand("LIST")).toBeNull();
  });

  it("rejects all commands in logout state", () => {
    const session = new ImapSession();
    session.logout();
    expect(session.validateCommand("CAPABILITY")).toBe("Session is in logout state");
    expect(session.validateCommand("FETCH")).toBe("Session is in logout state");
  });

  it("rejects unknown commands", () => {
    const session = new ImapSession();
    expect(session.validateCommand("FOOBAR")).toContain("Unknown command");
  });
});

describe("RFC 3501 Section 6.2.3: LOGIN Rate Limiting", () => {
  it("tracks failed login attempts", () => {
    const session = new ImapSession();
    expect(session.loginAttempts).toBe(0);
    session.recordFailedLogin();
    expect(session.loginAttempts).toBe(1);
  });

  it("returns true when max attempts exceeded", () => {
    const session = new ImapSession();
    expect(session.recordFailedLogin()).toBe(false);
    expect(session.recordFailedLogin()).toBe(false);
    expect(session.recordFailedLogin()).toBe(true);
  });

  it("enforces 3-attempt maximum", () => {
    expect(ImapSession.MAX_LOGIN_ATTEMPTS).toBe(3);
  });
});

describe("Session State Machine Error Cases", () => {
  it("throws when authenticating from authenticated state", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(() => session.authenticate()).toThrow("not in not-authenticated state");
  });

  it("throws when selecting from not-authenticated state", () => {
    const session = new ImapSession();
    expect(() => session.select(FOLDER)).toThrow("not in authenticated or selected state");
  });

  it("throws when closing from authenticated state", () => {
    const session = new ImapSession();
    session.authenticate();
    expect(() => session.close()).toThrow("not in selected state");
  });
});
