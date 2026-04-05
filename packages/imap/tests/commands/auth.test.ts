import { describe, it, expect, vi } from "vitest";
import {
  handleCapability,
  handleLogin,
  handleLogout,
  generateGreeting,
  SERVER_CAPABILITIES,
} from "../../src/commands/auth.ts";
import type { AuthAdapter } from "../../src/commands/auth.ts";
import { ImapSession } from "../../src/session.ts";

function mockAuthAdapter(result: boolean): AuthAdapter {
  return {
    verifyAppPassword: vi.fn(async () => result),
  };
}

function successAdapter(): AuthAdapter {
  return mockAuthAdapter(true);
}

function failAdapter(): AuthAdapter {
  return mockAuthAdapter(false);
}

describe("RFC 3501 Section 6.1.1: CAPABILITY Command", () => {
  it("returns IMAP4rev1 in capability list", () => {
    const [capLine] = handleCapability("a001");
    expect(capLine).toContain("IMAP4rev1");
  });

  it("returns IDLE capability", () => {
    const [capLine] = handleCapability("a001");
    expect(capLine).toContain("IDLE");
  });

  it("returns LITERAL+ capability", () => {
    const [capLine] = handleCapability("a001");
    expect(capLine).toContain("LITERAL+");
  });

  it("returns tagged OK response", () => {
    const responses = handleCapability("a001");
    expect(responses[1]).toContain("a001 OK");
  });

  it("includes all advertised capabilities", () => {
    const [capLine] = handleCapability("a001");
    for (const cap of SERVER_CAPABILITIES) {
      expect(capLine).toContain(cap);
    }
  });
});

describe("RFC 3501 Section 7.1.1: Server Greeting", () => {
  it("starts with * OK", () => {
    const greeting = generateGreeting();
    expect(greeting).toMatch(/^\* OK/);
  });

  it("includes CAPABILITY in greeting", () => {
    const greeting = generateGreeting();
    expect(greeting).toContain("CAPABILITY");
    expect(greeting).toContain("IMAP4rev1");
  });

  it("includes server identification", () => {
    const greeting = generateGreeting();
    expect(greeting).toContain("@rafters/mail ready");
  });

  it("ends with CRLF", () => {
    const greeting = generateGreeting();
    expect(greeting).toMatch(/\r\n$/);
  });
});

describe("RFC 3501 Section 6.2.3: LOGIN Command", () => {
  it("authenticates with valid app password", async () => {
    const session = new ImapSession();
    const result = await handleLogin(
      "a001",
      "user@example.com apppassword123",
      session,
      successAdapter(),
    );
    expect(result.responses[0]).toContain("a001 OK");
    expect(result.disconnect).toBe(false);
    expect(session.state).toBe("authenticated");
  });

  it("authenticates with quoted email and password", async () => {
    const session = new ImapSession();
    const result = await handleLogin(
      "a001",
      '"user@example.com" "app password with spaces"',
      session,
      successAdapter(),
    );
    expect(result.responses[0]).toContain("a001 OK");
    expect(session.state).toBe("authenticated");
  });

  it("rejects invalid credentials with generic NO (no information leakage)", async () => {
    const session = new ImapSession();
    const result = await handleLogin(
      "a001",
      "user@example.com wrongpassword",
      session,
      failAdapter(),
    );
    expect(result.responses[0]).toContain("a001 NO");
    expect(result.responses[0]).toContain("LOGIN failed");
    expect(result.responses[0]).not.toContain("password");
    expect(result.responses[0]).not.toContain("user");
    expect(result.disconnect).toBe(false);
    expect(session.state).toBe("not-authenticated");
  });

  it("disconnects after maximum failed attempts", async () => {
    const session = new ImapSession();
    const adapter = failAdapter();
    await handleLogin("a001", "user@example.com wrong1", session, adapter);
    await handleLogin("a002", "user@example.com wrong2", session, adapter);
    const result = await handleLogin("a003", "user@example.com wrong3", session, adapter);
    expect(result.disconnect).toBe(true);
    expect(result.responses.some((r) => r.includes("BYE"))).toBe(true);
  });

  it("rejects LOGIN when already authenticated (Section 6.2.3)", async () => {
    const session = new ImapSession();
    session.authenticate();
    const result = await handleLogin("a001", "user@example.com pass", session, successAdapter());
    expect(result.responses[0]).toContain("a001 NO");
    expect(result.responses[0]).toContain("Already authenticated");
  });

  it("rejects LOGIN with missing arguments", async () => {
    const session = new ImapSession();
    const result = await handleLogin("a001", "", session, successAdapter());
    expect(result.responses[0]).toContain("a001 BAD");
  });

  it("rejects LOGIN with only email (no password)", async () => {
    const session = new ImapSession();
    const result = await handleLogin("a001", "user@example.com", session, successAdapter());
    expect(result.responses[0]).toContain("a001 BAD");
  });

  it("delegates credential verification to AuthAdapter", async () => {
    const session = new ImapSession();
    const adapter = successAdapter();
    await handleLogin("a001", "sean@silvius.me myapppassword", session, adapter);
    expect(adapter.verifyAppPassword).toHaveBeenCalledWith("sean@silvius.me", "myapppassword");
  });

  it("handles quoted email with escaped characters", async () => {
    const session = new ImapSession();
    const adapter = successAdapter();
    await handleLogin("a001", '"user\\"name@example.com" password', session, adapter);
    expect(adapter.verifyAppPassword).toHaveBeenCalled();
  });
});

describe("RFC 3501 Section 6.1.3: LOGOUT Command", () => {
  it("sends BYE response before tagged OK", () => {
    const session = new ImapSession();
    const result = handleLogout("a001", session);
    expect(result.responses[0]).toContain("BYE");
    expect(result.responses[1]).toContain("a001 OK");
  });

  it("transitions session to logout state", () => {
    const session = new ImapSession();
    handleLogout("a001", session);
    expect(session.state).toBe("logout");
  });

  it("disconnects the client", () => {
    const session = new ImapSession();
    const result = handleLogout("a001", session);
    expect(result.disconnect).toBe(true);
  });

  it("works from authenticated state", () => {
    const session = new ImapSession();
    session.authenticate();
    const result = handleLogout("a001", session);
    expect(result.disconnect).toBe(true);
    expect(session.state).toBe("logout");
  });

  it("works from not-authenticated state", () => {
    const session = new ImapSession();
    const result = handleLogout("a001", session);
    expect(result.disconnect).toBe(true);
    expect(session.state).toBe("logout");
  });
});
