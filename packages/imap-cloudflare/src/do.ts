/**
 * IMAP Mailbox Durable Object for Cloudflare Workers.
 *
 * One DO per mailbox. Handles WebSocket connections for IMAP sessions.
 * Uses hibernation API for IDLE (near-zero cost when idle).
 * Routes IMAP commands to @rafters/mail-imap command handlers.
 *
 * Adapter wiring is done by the consumer via createAdapters callback.
 * Secrets and bindings come from env (`.dev.vars` in dev, Wrangler secrets in production).
 */

import {
  parseCommand,
  ImapSession,
  UidMap,
  generateGreeting,
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
} from "@rafters/mail-imap";
import type { AuthAdapter, MailboxAdapter, MessageAdapter } from "@rafters/mail-imap";
import {
  handleIdleStart,
  handleIdleDone,
  isIdleDone,
  handleIdleBadInput,
  generateIdleNotification,
} from "@rafters/mail-imap/commands/session";
import type { IdleState } from "@rafters/mail-imap/commands/session";

/**
 * Consumer provides a function that wires adapters from env bindings.
 * This is where D1, R2, and auth secrets get connected.
 */
export interface AdapterFactory<E = Env> {
  createAdapters(env: E): {
    authAdapter: AuthAdapter;
    mailboxAdapter: MailboxAdapter;
    messageAdapter: MessageAdapter;
  };
}

export interface ImapDOOptions {
  maxSessionsPerMailbox?: number;
  sessionTimeoutMs?: number;
}

interface SessionState {
  session: ImapSession;
  uidMap: UidMap | null;
  mailboxId: string;
  idleState: IdleState | null;
}

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Factory function to create an IMAP Durable Object class.
 *
 * The consumer provides an AdapterFactory that wires storage adapters
 * from env bindings. Secrets come from .dev.vars (dev) or Wrangler secrets (production).
 *
 * Usage:
 *   export const ImapMailboxDO = createImapDurableObject({
 *     createAdapters(env) {
 *       return {
 *         authAdapter: createAuthAdapter(env.DB),
 *         mailboxAdapter: createMailboxAdapter(env.DB),
 *         messageAdapter: createMessageAdapter(env.DB, env.BLOB_STORAGE),
 *       };
 *     },
 *   });
 */
export function createImapDurableObject<E = Env>(
  factory: AdapterFactory<E>,
  options: ImapDOOptions = {},
) {
  const maxSessions = options.maxSessionsPerMailbox ?? DEFAULT_MAX_SESSIONS;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;

  return class ImapMailboxDO {
    private doState: DurableObjectState;
    private sessions = new Map<WebSocket, SessionState>();
    private adapters: ReturnType<AdapterFactory<E>["createAdapters"]>;

    constructor(state: DurableObjectState, env: E) {
      this.doState = state;
      this.adapters = factory.createAdapters(env);
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      // Inbound signal: POST /notify?count=N
      // Called by the inbound email Worker after storing a new message.
      if (request.method === "POST" && url.pathname === "/notify") {
        const countStr = url.searchParams.get("count");
        const count = countStr ? Number.parseInt(countStr, 10) : 0;
        if (count > 0) {
          this.notifyIdleClients(count);
        }
        return new Response("OK", { status: 200 });
      }

      const mailboxId = url.searchParams.get("mailboxId");

      if (!mailboxId) {
        return new Response("Missing mailboxId parameter", { status: 400 });
      }

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      if (this.sessions.size >= maxSessions) {
        return new Response("Too many sessions for this mailbox", { status: 503 });
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.doState.acceptWebSocket(server);

      const sessionState: SessionState = {
        session: new ImapSession(),
        uidMap: null,
        mailboxId,
        idleState: null,
      };
      this.sessions.set(server, sessionState);

      server.send(generateGreeting());

      this.doState.storage.setAlarm(Date.now() + sessionTimeoutMs);

      return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
      if (typeof message !== "string") return;

      const sessionState = this.sessions.get(ws);
      if (!sessionState) return;

      const lines = message.split("\r\n").filter((l) => l.length > 0);

      for (const line of lines) {
        // RFC 2177: During IDLE, only DONE is valid
        if (sessionState.idleState?.active) {
          if (isIdleDone(line)) {
            ws.send(handleIdleDone(sessionState.idleState));
            sessionState.idleState = null;
          } else {
            ws.send(handleIdleBadInput(sessionState.idleState));
          }
          continue;
        }

        const responses = await this.handleCommand(line, sessionState);

        for (const response of responses.lines) {
          ws.send(response);
        }

        if (responses.disconnect) {
          this.sessions.delete(ws);
          ws.close(1000, "LOGOUT");
          this.cleanupIfEmpty();
          return;
        }
      }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
      this.sessions.delete(ws);
      this.cleanupIfEmpty();
    }

    async webSocketError(ws: WebSocket): Promise<void> {
      this.sessions.delete(ws);
      this.cleanupIfEmpty();
    }

    async alarm(): Promise<void> {
      if (this.sessions.size === 0) return;
      this.doState.storage.setAlarm(Date.now() + sessionTimeoutMs);
    }

    /**
     * Push EXISTS notification to all IDLE clients.
     * Called when inbound email Worker signals new mail via POST /notify.
     */
    private notifyIdleClients(newMessageCount: number): void {
      const notification = generateIdleNotification(newMessageCount);
      for (const [ws, state] of this.sessions) {
        if (state.idleState?.active) {
          ws.send(notification);
        }
      }
    }

    private cleanupIfEmpty(): void {
      if (this.sessions.size === 0) {
        this.doState.storage.deleteAlarm();
      }
    }

    private async handleCommand(
      line: string,
      sessionState: SessionState,
    ): Promise<{ lines: string[]; disconnect: boolean }> {
      const { session, mailboxId } = sessionState;
      const { authAdapter, mailboxAdapter, messageAdapter } = this.adapters;

      let parsed;
      try {
        parsed = parseCommand(line);
      } catch {
        return { lines: [`* BAD Syntax error in command\r\n`], disconnect: false };
      }

      const { tag, command, args } = parsed;

      switch (command) {
        case "CAPABILITY":
          return { lines: handleCapability(tag), disconnect: false };

        case "LOGIN": {
          const result = await handleLogin(tag, args, session, authAdapter);
          return { lines: result.responses, disconnect: result.disconnect };
        }

        case "LOGOUT": {
          const result = handleLogout(tag, session);
          return { lines: result.responses, disconnect: result.disconnect };
        }

        case "SELECT": {
          const result = await handleSelect(tag, args, session, mailboxId, mailboxAdapter);
          if (result.uidMap) sessionState.uidMap = result.uidMap;
          return { lines: result.responses, disconnect: false };
        }

        case "EXAMINE": {
          const result = await handleExamine(tag, args, session, mailboxId, mailboxAdapter);
          if (result.uidMap) sessionState.uidMap = result.uidMap;
          return { lines: result.responses, disconnect: false };
        }

        case "LIST": {
          const result = await handleList(tag, args, session, mailboxId, mailboxAdapter);
          return { lines: result, disconnect: false };
        }

        case "LSUB": {
          const result = await handleLsub(tag, args, session, mailboxId, mailboxAdapter);
          return { lines: result, disconnect: false };
        }

        case "STATUS": {
          const result = await handleStatus(tag, args, session, mailboxId, mailboxAdapter);
          return { lines: result, disconnect: false };
        }

        case "FETCH":
          return this.requireUidMap(tag, sessionState, (uidMap) =>
            handleFetch(tag, args, session, uidMap, messageAdapter, false),
          );

        case "STORE":
          return this.requireUidMap(tag, sessionState, (uidMap) =>
            handleStore(tag, args, session, uidMap, messageAdapter, false),
          );

        case "SEARCH":
          return this.requireUidMap(tag, sessionState, (uidMap) =>
            handleSearch(tag, args, session, uidMap, messageAdapter, false),
          );

        case "EXPUNGE":
          return this.requireUidMap(tag, sessionState, (uidMap) =>
            handleExpunge(tag, session, uidMap, messageAdapter),
          );

        case "NOOP":
          return { lines: handleNoop(tag, session), disconnect: false };

        case "IDLE": {
          const result = handleIdleStart(tag, session);
          if (result.idleState) {
            sessionState.idleState = result.idleState;
          }
          return { lines: [result.response], disconnect: false };
        }

        case "CLOSE":
          return this.requireUidMap(tag, sessionState, async (uidMap) => {
            const result = await handleClose(tag, session, uidMap, messageAdapter);
            sessionState.uidMap = null;
            return result;
          });

        case "UID":
          return this.handleUidCommand(tag, args, sessionState);

        default:
          return { lines: [`${tag} BAD Unknown command: ${command}\r\n`], disconnect: false };
      }
    }

    private async requireUidMap(
      tag: string,
      sessionState: SessionState,
      handler: (uidMap: UidMap) => Promise<string[]>,
    ): Promise<{ lines: string[]; disconnect: boolean }> {
      if (!sessionState.uidMap) {
        return { lines: [`${tag} NO No folder selected\r\n`], disconnect: false };
      }
      const result = await handler(sessionState.uidMap);
      return { lines: result, disconnect: false };
    }

    private async handleUidCommand(
      tag: string,
      args: string,
      sessionState: SessionState,
    ): Promise<{ lines: string[]; disconnect: boolean }> {
      const { session } = sessionState;
      const { messageAdapter } = this.adapters;

      const spaceIndex = args.indexOf(" ");
      if (spaceIndex === -1) {
        return { lines: [`${tag} BAD UID requires a subcommand\r\n`], disconnect: false };
      }

      const subcommand = args.slice(0, spaceIndex).toUpperCase();
      const subargs = args.slice(spaceIndex + 1);

      return this.requireUidMap(tag, sessionState, (uidMap) => {
        switch (subcommand) {
          case "FETCH":
            return handleFetch(tag, subargs, session, uidMap, messageAdapter, true);
          case "STORE":
            return handleStore(tag, subargs, session, uidMap, messageAdapter, true);
          case "SEARCH":
            return handleSearch(tag, subargs, session, uidMap, messageAdapter, true);
          default:
            return Promise.resolve([`${tag} BAD Unknown UID subcommand: ${subcommand}\r\n`]);
        }
      });
    }
  };
}
