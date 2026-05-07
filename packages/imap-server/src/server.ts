/**
 * Node TCP/TLS IMAP server.
 *
 * Listens on port 993 (IMAPS). One TCP connection = one IMAP session.
 * Uses the same protocol layer and adapter interfaces as the Cloudflare
 * DO runtime, but runs as a persistent Node process.
 *
 * Deploys on Fly, Railway, Fargate, VPS, Docker -- anywhere Node runs.
 */

import * as net from "node:net";
import * as tls from "node:tls";
import {
  parseCommand,
  formatTagged,
  formatBye,
  ImapSession,
  UidMap,
  generateGreeting,
  generateIdleNotification,
  handleCapability,
  handleLogin,
  handleLogout,
  handleSelect,
  handleExamine,
  handleList,
  handleLsub,
  handleStatus,
  handleFetch,
  handleStore,
  handleSearch,
  handleExpunge,
  handleNoop,
  handleClose,
  handleIdleStart,
  handleIdleDone,
  isIdleDone,
  handleIdleBadInput,
  handleCopy,
  handleMove,
  handleAppend,
  handleUnselect,
} from "@rafters/mail-imap";
import type {
  ImapAuthAdapter,
  MailboxAdapter,
  MessageAdapter,
  ExtensionAdapter,
  IdleState,
} from "@rafters/mail-imap";

export interface ImapServerConfig {
  adapters: {
    authAdapter: ImapAuthAdapter;
    mailboxAdapter: MailboxAdapter;
    messageAdapter: MessageAdapter;
    extensionAdapter?: ExtensionAdapter;
  };
  /** TLS config. Omit when behind a TLS-terminating proxy (Fly, Railway, ALB). */
  tls?: {
    cert: string | Buffer;
    key: string | Buffer;
  };
  host?: string;
  port?: number;
  maxConnections?: number;
  sessionTimeoutMs?: number;
  /**
   * Called to resolve the mailbox ID from an authenticated email.
   * The TCP server needs this because unlike the DO (routed by email),
   * the server handles all mailboxes on one listener.
   */
  resolveMailboxId(email: string): Promise<string | undefined>;
}

interface ConnectionState {
  session: ImapSession;
  uidMap: UidMap | null;
  mailboxId: string | null;
  email: string | null;
  idleState: IdleState | null;
  buffer: string;
}

interface ConnectionEntry {
  socket: net.Socket;
  state: ConnectionState;
}

export interface ImapServer {
  listen(): Promise<void>;
  close(): Promise<void>;
  readonly connections: number;
  /**
   * The port the server is bound to, available after `listen()` resolves.
   * Returns `null` before `listen()` or after `close()`. Useful when the
   * server is started on port `0` (ephemeral) and the caller needs the
   * actual assigned port -- typical in tests and integration harnesses.
   */
  readonly port: number | null;
  /**
   * Push an EXISTS notification to all IDLE sessions for a specific mailbox.
   *
   * Call after storing a new inbound message to wake any connected email
   * clients that are currently in IMAP IDLE (RFC 2177). Sessions that are
   * not in IDLE, or that belong to a different mailbox, are not affected.
   *
   * @param mailboxId The mailbox to notify. Matches `resolveMailboxId` output.
   * @param newMessageCount Total messages in the mailbox after the insertion.
   *   This becomes the `EXISTS` value. IMAP clients read it as the new total,
   *   not a delta. Pass the mailbox's full message count, not the number
   *   appended.
   */
  notify(mailboxId: string, newMessageCount: number): void;
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 993;
const DEFAULT_MAX_CONNECTIONS = 1000;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function createImapServer(config: ImapServerConfig): ImapServer {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  const maxConnections = config.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const sessionTimeoutMs = config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const { adapters } = config;

  const activeConnections = new Set<ConnectionEntry>();
  let server: net.Server | tls.Server | null = null;

  const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

  function handleConnection(socket: net.Socket): void {
    if (activeConnections.size >= maxConnections) {
      socket.write(formatBye("Server too busy"));
      socket.end();
      return;
    }

    const state: ConnectionState = {
      session: new ImapSession(),
      uidMap: null,
      mailboxId: null,
      email: null,
      idleState: null,
      buffer: "",
    };

    const entry: ConnectionEntry = { socket, state };
    activeConnections.add(entry);

    // Prevent double-removal: error fires before close on Node sockets
    let cleaned = false;
    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      activeConnections.delete(entry);
      clearTimeout(timeout);
    }

    socket.write(generateGreeting());

    const timeout = setTimeout(() => {
      socket.write(formatBye("Session timeout"));
      socket.end();
    }, sessionTimeoutMs);

    socket.on("data", (data: Buffer) => {
      state.buffer += data.toString("utf-8");

      // Guard against unbounded buffer growth (malformed clients, large literals)
      if (state.buffer.length > MAX_BUFFER_SIZE) {
        socket.write(formatBye("Buffer size exceeded"));
        socket.destroy();
        return;
      }

      const lines = state.buffer.split("\r\n");
      // Last element is incomplete (no trailing CRLF yet)
      state.buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length === 0) continue;

        timeout.refresh();

        processLine(line, state, socket).catch(() => {
          socket.write(formatTagged("*", "BAD", "Internal server error"));
        });
      }
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  async function processLine(
    line: string,
    state: ConnectionState,
    socket: net.Socket,
  ): Promise<void> {
    // RFC 2177: During IDLE, only DONE is valid
    if (state.idleState?.active) {
      if (isIdleDone(line)) {
        socket.write(handleIdleDone(state.idleState));
        state.idleState = null;
      } else {
        socket.write(handleIdleBadInput(state.idleState));
      }
      return;
    }

    let parsed;
    try {
      parsed = parseCommand(line);
    } catch {
      socket.write(formatTagged("*", "BAD", "Syntax error in command"));
      return;
    }

    const { tag, command, args } = parsed;
    const responses = await dispatchCommand(tag, command, args, state);

    for (const response of responses.lines) {
      socket.write(response);
    }

    if (responses.disconnect) {
      socket.end();
    }
  }

  async function dispatchCommand(
    tag: string,
    command: string,
    args: string,
    state: ConnectionState,
  ): Promise<{ lines: string[]; disconnect: boolean }> {
    const { session } = state;

    switch (command) {
      case "CAPABILITY":
        return { lines: handleCapability(tag), disconnect: false };

      case "LOGIN": {
        const result = await handleLogin(tag, args, session, adapters.authAdapter);
        if (!result.disconnect && session.state === "authenticated") {
          // Extract email from LOGIN args for mailbox resolution
          const email = extractEmailFromLoginArgs(args);
          if (email) {
            state.email = email;
            state.mailboxId = (await config.resolveMailboxId(email)) ?? null;
          }
        }
        return { lines: result.responses, disconnect: result.disconnect };
      }

      case "LOGOUT": {
        const result = handleLogout(tag, session);
        return { lines: result.responses, disconnect: result.disconnect };
      }

      case "SELECT": {
        if (!state.mailboxId) {
          return {
            lines: [formatTagged(tag, "NO", "No mailbox resolved for this session")],
            disconnect: false,
          };
        }
        const result = await handleSelect(
          tag,
          args,
          session,
          state.mailboxId,
          adapters.mailboxAdapter,
        );
        if (result.uidMap) state.uidMap = result.uidMap;
        return { lines: result.responses, disconnect: false };
      }

      case "EXAMINE": {
        if (!state.mailboxId) {
          return {
            lines: [formatTagged(tag, "NO", "No mailbox resolved for this session")],
            disconnect: false,
          };
        }
        const result = await handleExamine(
          tag,
          args,
          session,
          state.mailboxId,
          adapters.mailboxAdapter,
        );
        if (result.uidMap) state.uidMap = result.uidMap;
        return { lines: result.responses, disconnect: false };
      }

      case "LIST": {
        if (!state.mailboxId) {
          return { lines: [formatTagged(tag, "NO", "No mailbox resolved")], disconnect: false };
        }
        return {
          lines: await handleList(tag, args, session, state.mailboxId, adapters.mailboxAdapter),
          disconnect: false,
        };
      }

      case "LSUB": {
        if (!state.mailboxId) {
          return { lines: [formatTagged(tag, "NO", "No mailbox resolved")], disconnect: false };
        }
        return {
          lines: await handleLsub(tag, args, session, state.mailboxId, adapters.mailboxAdapter),
          disconnect: false,
        };
      }

      case "STATUS": {
        if (!state.mailboxId) {
          return { lines: [formatTagged(tag, "NO", "No mailbox resolved")], disconnect: false };
        }
        return {
          lines: await handleStatus(tag, args, session, state.mailboxId, adapters.mailboxAdapter),
          disconnect: false,
        };
      }

      case "FETCH":
        return requireUidMap(tag, state, (uidMap) =>
          handleFetch(tag, args, session, uidMap, adapters.messageAdapter, false),
        );

      case "STORE":
        return requireUidMap(tag, state, (uidMap) =>
          handleStore(tag, args, session, uidMap, adapters.messageAdapter, false),
        );

      case "SEARCH":
        return requireUidMap(tag, state, (uidMap) =>
          handleSearch(tag, args, session, uidMap, adapters.messageAdapter, false),
        );

      case "EXPUNGE":
        return requireUidMap(tag, state, (uidMap) =>
          handleExpunge(tag, session, uidMap, adapters.messageAdapter),
        );

      case "NOOP":
        return { lines: handleNoop(tag, session), disconnect: false };

      case "IDLE": {
        const result = handleIdleStart(tag, session);
        if (result.idleState) {
          state.idleState = result.idleState;
        }
        return { lines: [result.response], disconnect: false };
      }

      case "CLOSE":
        return requireUidMap(tag, state, async (uidMap) => {
          const result = await handleClose(tag, session, uidMap, adapters.messageAdapter);
          state.uidMap = null;
          return result;
        });

      case "UNSELECT": {
        return { lines: handleUnselect(tag, session), disconnect: false };
      }

      case "COPY": {
        if (!state.mailboxId || !state.uidMap) {
          return { lines: [formatTagged(tag, "NO", "No folder selected")], disconnect: false };
        }
        if (!adapters.extensionAdapter) {
          return { lines: [formatTagged(tag, "NO", "COPY not supported")], disconnect: false };
        }
        return {
          lines: await handleCopy(
            tag,
            args,
            session,
            state.uidMap,
            state.mailboxId,
            adapters.extensionAdapter,
            false,
          ),
          disconnect: false,
        };
      }

      case "MOVE": {
        if (!state.mailboxId || !state.uidMap) {
          return { lines: [formatTagged(tag, "NO", "No folder selected")], disconnect: false };
        }
        if (!adapters.extensionAdapter) {
          return { lines: [formatTagged(tag, "NO", "MOVE not supported")], disconnect: false };
        }
        return {
          lines: await handleMove(
            tag,
            args,
            session,
            state.uidMap,
            state.mailboxId,
            adapters.extensionAdapter,
            false,
          ),
          disconnect: false,
        };
      }

      case "APPEND": {
        if (!state.mailboxId) {
          return { lines: [formatTagged(tag, "NO", "No mailbox resolved")], disconnect: false };
        }
        if (!adapters.extensionAdapter) {
          return { lines: [formatTagged(tag, "NO", "APPEND not supported")], disconnect: false };
        }
        return {
          lines: await handleAppend(tag, args, session, state.mailboxId, adapters.extensionAdapter),
          disconnect: false,
        };
      }

      case "UID":
        return handleUidCommand(tag, args, state);

      default:
        return {
          lines: [formatTagged(tag, "BAD", `Unknown command: ${command}`)],
          disconnect: false,
        };
    }
  }

  async function handleUidCommand(
    tag: string,
    args: string,
    state: ConnectionState,
  ): Promise<{ lines: string[]; disconnect: boolean }> {
    const { session } = state;

    const spaceIndex = args.indexOf(" ");
    if (spaceIndex === -1) {
      return { lines: [formatTagged(tag, "BAD", "UID requires a subcommand")], disconnect: false };
    }

    const subcommand = args.slice(0, spaceIndex).toUpperCase();
    const subargs = args.slice(spaceIndex + 1);

    return requireUidMap(tag, state, (uidMap) => {
      switch (subcommand) {
        case "FETCH":
          return handleFetch(tag, subargs, session, uidMap, adapters.messageAdapter, true);
        case "STORE":
          return handleStore(tag, subargs, session, uidMap, adapters.messageAdapter, true);
        case "SEARCH":
          return handleSearch(tag, subargs, session, uidMap, adapters.messageAdapter, true);
        case "COPY": {
          if (!state.mailboxId || !adapters.extensionAdapter) {
            return Promise.resolve([formatTagged(tag, "NO", "COPY not available")]);
          }
          return handleCopy(
            tag,
            subargs,
            session,
            uidMap,
            state.mailboxId,
            adapters.extensionAdapter,
            true,
          );
        }
        case "MOVE": {
          if (!state.mailboxId || !adapters.extensionAdapter) {
            return Promise.resolve([formatTagged(tag, "NO", "MOVE not available")]);
          }
          return handleMove(
            tag,
            subargs,
            session,
            uidMap,
            state.mailboxId,
            adapters.extensionAdapter,
            true,
          );
        }
        default:
          return Promise.resolve([
            formatTagged(tag, "BAD", `Unknown UID subcommand: ${subcommand}`),
          ]);
      }
    });
  }

  async function requireUidMap(
    tag: string,
    state: ConnectionState,
    handler: (uidMap: UidMap) => Promise<string[]>,
  ): Promise<{ lines: string[]; disconnect: boolean }> {
    if (!state.uidMap) {
      return { lines: [formatTagged(tag, "NO", "No folder selected")], disconnect: false };
    }
    const result = await handler(state.uidMap);
    return { lines: result, disconnect: false };
  }

  return {
    get connections() {
      return activeConnections.size;
    },

    get port() {
      if (!server) return null;
      const addr = server.address();
      // net.Server.address() returns an object for TCP sockets, or a string
      // for Unix sockets. This server only binds TCP, so the object branch
      // is the only one we care about.
      return addr && typeof addr === "object" ? addr.port : null;
    },

    notify(mailboxId: string, newMessageCount: number): void {
      // RFC 2177: EXISTS is a broadcast of the total message count for the
      // selected mailbox. Only deliver to sessions currently in IDLE state
      // and bound to the target mailbox.
      const notification = generateIdleNotification(newMessageCount);
      for (const { socket, state } of activeConnections) {
        if (state.mailboxId === mailboxId && state.idleState?.active) {
          socket.write(notification);
        }
      }
    },

    listen() {
      return new Promise<void>((resolve, reject) => {
        if (config.tls) {
          server = tls.createServer(
            { cert: config.tls.cert, key: config.tls.key },
            handleConnection,
          );
        } else {
          // Plain TCP mode: for deployment behind a TLS-terminating proxy
          // (Fly.io, Railway, ALB). The proxy handles TLS on port 993 and
          // forwards plain TCP to this server's internal port.
          server = net.createServer(handleConnection);
        }

        server.on("error", reject);
        server.listen(port, host, () => resolve());
      });
    },

    close() {
      return new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((err) => {
          if (err) reject(err);
          else resolve();
          server = null;
        });
      });
    },
  };
}

/**
 * Extract email from LOGIN args (first argument, quoted or atom).
 */
function extractEmailFromLoginArgs(args: string): string | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  if (trimmed[0] === '"') {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote === -1) return null;
    return trimmed.slice(1, endQuote);
  }

  const spaceIndex = trimmed.indexOf(" ");
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}
