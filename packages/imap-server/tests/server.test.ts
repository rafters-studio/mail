import { describe, it, expect, vi } from "vitest";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { createImapServer } from "../src/server.ts";
import type { ImapServerConfig } from "../src/server.ts";
import type { AuthAdapter, MailboxAdapter, MessageAdapter } from "@rafters/mail-imap";

function mockConfig(overrides: Partial<ImapServerConfig> = {}): ImapServerConfig {
  return {
    adapters: {
      authAdapter: { verifyAppPassword: vi.fn(async () => true) } as AuthAdapter,
      mailboxAdapter: {
        listFolders: vi.fn(async () => [
          { id: "folder-1", name: "INBOX", type: "inbox", mailboxId: "mbx-1" },
        ]),
        getFolderByName: vi.fn(async (_mailboxId: string, name: string) =>
          name === "INBOX"
            ? { id: "folder-1", name: "INBOX", type: "inbox", mailboxId: "mbx-1" }
            : undefined,
        ),
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
  it("returns a server object with listen, close, connections, and notify", () => {
    const server = createImapServer(mockConfig());
    expect(typeof server.listen).toBe("function");
    expect(typeof server.close).toBe("function");
    expect(typeof server.notify).toBe("function");
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

describe("ImapServer.notify (RFC 2177 IDLE push)", () => {
  it("is safe to call with no active connections", () => {
    const server = createImapServer(mockConfig());
    expect(() => server.notify("mbx-1", 5)).not.toThrow();
  });

  it("is safe to call with zero as the new message count", () => {
    const server = createImapServer(mockConfig());
    expect(() => server.notify("mbx-1", 0)).not.toThrow();
  });

  it("delivers EXISTS to an IDLE client bound to the matching mailbox", async () => {
    const server = await startPlainTextServer(mockConfig());
    try {
      const client = await connectAndAuthenticate(server.port);

      try {
        client.socket.write("a002 SELECT INBOX\r\n");
        await readUntilLine(client, (line) => line.startsWith("a002 "));

        client.socket.write("a003 IDLE\r\n");
        await readUntilLine(client, (line) => line.startsWith("+ "));

        // Push notification from outside the IMAP session. This simulates
        // the inbound email worker notifying the IMAP server after storing
        // a new message.
        server.notify("mbx-1", 7);

        // RFC 2177: EXISTS response during IDLE has the form "* <n> EXISTS"
        const line = await readUntilLine(client, (l) => l.endsWith("EXISTS"));
        expect(line).toBe("* 7 EXISTS");
      } finally {
        client.socket.end();
      }
    } finally {
      await server.close();
    }
  });

  it("does not deliver EXISTS to a client bound to a different mailbox", async () => {
    // Use a resolver that routes a specific login to a different mailbox.
    const config = mockConfig({
      async resolveMailboxId(email) {
        return email === "other@example.com" ? "mbx-other" : "mbx-1";
      },
    });

    const server = await startPlainTextServer(config);
    try {
      const client = await connectAndAuthenticate(server.port, "other@example.com");

      try {
        client.socket.write("a002 SELECT INBOX\r\n");
        await readUntilLine(client, (line) => line.startsWith("a002 "));

        client.socket.write("a003 IDLE\r\n");
        await readUntilLine(client, (line) => line.startsWith("+ "));

        // Notify a mailbox the client is NOT bound to. Client should
        // not receive the EXISTS.
        server.notify("mbx-1", 7);

        const line = await readLineWithTimeout(client, 150);
        // No notification should arrive within the timeout window.
        expect(line).toBeNull();
      } finally {
        client.socket.end();
      }
    } finally {
      await server.close();
    }
  });

  it("does not deliver EXISTS to a client that is not in IDLE", async () => {
    const server = await startPlainTextServer(mockConfig());
    try {
      const client = await connectAndAuthenticate(server.port);

      try {
        client.socket.write("a002 SELECT INBOX\r\n");
        await readUntilLine(client, (line) => line.startsWith("a002 "));

        // Authenticated and selected, but not in IDLE.
        server.notify("mbx-1", 7);

        const line = await readLineWithTimeout(client, 150);
        expect(line).toBeNull();
      } finally {
        client.socket.end();
      }
    } finally {
      await server.close();
    }
  });
});

// ---------- test helpers ----------

interface ServerHandle {
  port: number;
  close(): Promise<void>;
  notify(mailboxId: string, count: number): void;
}

/**
 * Start an IMAP server on a random plain TCP port (no TLS). The test
 * helper intentionally omits the tls config to get plain TCP mode, which
 * the server supports for deployment behind a TLS-terminating proxy.
 *
 * Uses port 0 (ephemeral) so tests can run in parallel without colliding
 * on a fixed port. The server's `port` getter returns the actual assigned
 * port after `listen()` resolves.
 */
async function startPlainTextServer(config: ImapServerConfig): Promise<ServerHandle> {
  const { tls: _tls, ...rest } = config;
  const server = createImapServer({ ...rest, host: "127.0.0.1", port: 0 });
  await server.listen();

  const port = server.port;
  if (port === null) {
    throw new Error("server did not report a bound port after listen");
  }

  return {
    port,
    close: () => server.close(),
    notify: (mailboxId: string, count: number) => server.notify(mailboxId, count),
  };
}

interface Client {
  socket: Socket;
  buffer: string;
}

async function connectAndAuthenticate(
  port: number,
  email: string = "user@example.com",
): Promise<Client> {
  const socket = connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const client: Client = { socket, buffer: "" };
  socket.on("data", (data: Buffer) => {
    client.buffer += data.toString("utf-8");
  });

  // Consume the greeting: "* OK [CAPABILITY ...] @rafters/mail ready"
  await readUntilLine(client, (line) => line.startsWith("* OK"));

  // Authenticate. LOGIN emits a tagged completion response on success.
  client.socket.write(`a001 LOGIN ${email} password\r\n`);
  await readUntilLine(client, (line) => line.startsWith("a001 "));

  return client;
}

/**
 * Read and consume lines from the buffer until one matches the predicate.
 * Returns the matching line. Lines that do not match are still consumed --
 * this mirrors an IMAP client draining untagged responses before the
 * tagged completion.
 */
async function readUntilLine(
  client: Client,
  matcher: (line: string) => boolean,
  timeoutMs: number = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = tryConsumeLine(client);
    if (line !== null) {
      if (matcher(line)) return line;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for matching line\nbuffer: ${client.buffer}`);
}

/**
 * Read the next line but return null if nothing arrives within the timeout.
 * Used for negative-path assertions ("client should NOT receive X").
 */
async function readLineWithTimeout(client: Client, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = tryConsumeLine(client);
    if (line !== null) return line;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

function tryConsumeLine(client: Client): string | null {
  const idx = client.buffer.indexOf("\r\n");
  if (idx < 0) return null;
  const line = client.buffer.slice(0, idx);
  client.buffer = client.buffer.slice(idx + 2);
  return line;
}
