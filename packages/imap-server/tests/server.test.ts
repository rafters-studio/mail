import { describe, it, expect, vi } from "vitest";
import { createImapServer } from "../src/server.ts";
import type { ImapServerConfig } from "../src/server.ts";
import type { AuthAdapter, MailboxAdapter, MessageAdapter } from "@rafters/mail-imap";

function mockConfig(overrides: Partial<ImapServerConfig> = {}): ImapServerConfig {
  return {
    adapters: {
      authAdapter: { verifyAppPassword: vi.fn(async () => true) } as AuthAdapter,
      mailboxAdapter: {
        listFolders: vi.fn(async () => []),
        getFolderByName: vi.fn(async () => undefined),
        getFolderStats: vi.fn(async () => ({
          messages: 0,
          recent: 0,
          unseen: 0,
          uidValidity: 1,
          uidNext: 1,
        })),
        getMessageUids: vi.fn(async () => []),
      } as MailboxAdapter,
      messageAdapter: {
        getMessage: vi.fn(async () => undefined),
        getMessagesByIds: vi.fn(async () => []),
        updateMessageFlags: vi.fn(async () => {}),
        deleteMessage: vi.fn(async () => {}),
        getBlob: vi.fn(async () => undefined),
        searchMessages: vi.fn(async () => []),
      } as MessageAdapter,
    },
    tls: {
      cert: "mock-cert",
      key: "mock-key",
    },
    resolveMailboxId: vi.fn(async () => "mbx-1"),
    ...overrides,
  };
}

describe("createImapServer", () => {
  it("returns a server object with listen, close, and connections", () => {
    const server = createImapServer(mockConfig());
    expect(typeof server.listen).toBe("function");
    expect(typeof server.close).toBe("function");
    expect(server.connections).toBe(0);
  });

  it("accepts custom host and port", () => {
    const server = createImapServer(mockConfig({ host: "127.0.0.1", port: 9993 }));
    expect(server).toBeDefined();
  });

  it("accepts custom max connections", () => {
    const server = createImapServer(mockConfig({ maxConnections: 500 }));
    expect(server).toBeDefined();
  });

  it("accepts custom session timeout", () => {
    const server = createImapServer(mockConfig({ sessionTimeoutMs: 60000 }));
    expect(server).toBeDefined();
  });

  it("starts with zero connections", () => {
    const server = createImapServer(mockConfig());
    expect(server.connections).toBe(0);
  });
});
