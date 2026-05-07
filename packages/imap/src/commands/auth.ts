/**
 * IMAP authentication commands per RFC 3501 Sections 6.1 and 6.2.
 *
 * CAPABILITY (Section 6.1.1): Advertise supported extensions.
 * LOGIN (Section 6.2.3): Authenticate with email + app password.
 * LOGOUT (Section 6.1.3): Clean disconnect.
 *
 * Auth model: app-specific passwords only (no traditional passwords).
 * SASL (AUTHENTICATE command) deferred to future when better-auth supports it.
 */

import {
  formatCapability,
  formatTagged,
  formatBye,
  formatGreeting,
} from "../protocol/formatter.ts";
import type { ImapSession } from "../session.ts";

/**
 * The capabilities this server advertises.
 * RFC 3501 Section 6.1.1: CAPABILITY response.
 */
export const SERVER_CAPABILITIES = [
  "IMAP4rev1",
  "IDLE",
  "LITERAL+",
  "UIDPLUS",
  "NAMESPACE",
  "ID",
] as const;

/**
 * Adapter interface for credential verification.
 *
 * The IMAP server delegates all authentication to the consumer. It does
 * not own credential storage, hashing, generation, revocation, or any
 * other part of the credential lifecycle. The consumer implements this
 * interface against whatever auth system they use (their own database,
 * a SaaS auth provider, a remote verification service, etc.).
 *
 * The IMAP server calls `verifyAppPassword` on every LOGIN. The adapter
 * returns `true` for a valid credential and `false` for anything else --
 * wrong password, unknown user, revoked credential, rate-limited, and
 * any other failure mode. The server treats all failures identically
 * to prevent information leakage.
 *
 * Security guarantees enforced by the IMAP server regardless of adapter
 * implementation:
 *   - Generic "LOGIN failed" response on any false return
 *   - Per-session rate limit (`MAX_LOGIN_ATTEMPTS`)
 *   - Disconnect after the attempt limit is hit
 */
export interface ImapAuthAdapter {
  verifyAppPassword(email: string, appPassword: string): Promise<boolean>;
}

/**
 * RFC 3501 Section 6.1.1: CAPABILITY command.
 * Returns the server's capability list. Valid in any state.
 */
export function handleCapability(tag: string): string[] {
  return [
    formatCapability([...SERVER_CAPABILITIES]),
    formatTagged(tag, "OK", "CAPABILITY completed"),
  ];
}

/**
 * Generate the initial server greeting sent on connection.
 * RFC 3501 Section 7.1.1: The greeting includes capabilities.
 */
export function generateGreeting(): string {
  return formatGreeting([...SERVER_CAPABILITIES]);
}

/**
 * RFC 3501 Section 6.2.3: LOGIN command.
 * Authenticates using email address + app-specific password.
 *
 * Security:
 * - No information leakage on failure (generic NO response)
 * - Rate limited to MAX_LOGIN_ATTEMPTS per session
 * - Disconnects after max attempts exceeded
 */
export async function handleLogin(
  tag: string,
  args: string,
  session: ImapSession,
  authAdapter: ImapAuthAdapter,
): Promise<{ responses: string[]; disconnect: boolean }> {
  const stateError = session.validateCommand("LOGIN");
  if (stateError !== null) {
    return {
      responses: [formatTagged(tag, "NO", stateError)],
      disconnect: false,
    };
  }

  const parsed = parseLoginArgs(args);
  if (parsed === null) {
    return {
      responses: [formatTagged(tag, "BAD", "LOGIN requires email and app password")],
      disconnect: false,
    };
  }

  const valid = await authAdapter.verifyAppPassword(parsed.email, parsed.password);

  if (!valid) {
    const maxExceeded = session.recordFailedLogin();
    if (maxExceeded) {
      return {
        responses: [
          formatTagged(tag, "NO", "LOGIN failed"),
          formatBye("Too many failed login attempts"),
        ],
        disconnect: true,
      };
    }
    return {
      responses: [formatTagged(tag, "NO", "LOGIN failed")],
      disconnect: false,
    };
  }

  session.authenticate();
  return {
    responses: [formatTagged(tag, "OK", "LOGIN completed")],
    disconnect: false,
  };
}

/**
 * RFC 3501 Section 6.1.3: LOGOUT command.
 * Cleanly disconnects the session. Valid in any state.
 */
export function handleLogout(
  tag: string,
  session: ImapSession,
): { responses: string[]; disconnect: boolean } {
  session.logout();
  return {
    responses: [formatBye("LOGOUT requested"), formatTagged(tag, "OK", "LOGOUT completed")],
    disconnect: true,
  };
}

/**
 * Parse LOGIN command arguments.
 * RFC 3501 Section 6.2.3: LOGIN SP userid SP password
 * Both userid and password can be quoted strings or atoms.
 */
function parseLoginArgs(args: string): { email: string; password: string } | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  let email: string;
  let remaining: string;

  if (trimmed[0] === '"') {
    const endQuote = findClosingQuote(trimmed, 0);
    if (endQuote === -1) return null;
    email = trimmed.slice(1, endQuote);
    remaining = trimmed.slice(endQuote + 1).trim();
  } else {
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) return null;
    email = trimmed.slice(0, spaceIndex);
    remaining = trimmed.slice(spaceIndex + 1).trim();
  }

  if (remaining.length === 0) return null;

  let password: string;
  if (remaining[0] === '"') {
    const endQuote = findClosingQuote(remaining, 0);
    if (endQuote === -1) return null;
    password = remaining.slice(1, endQuote);
  } else {
    password = remaining;
  }

  if (email.length === 0 || password.length === 0) return null;

  return { email, password };
}

/**
 * Find the closing quote in a string, handling escape sequences.
 * Returns the index of the closing quote, or -1 if not found.
 */
function findClosingQuote(input: string, openQuoteIndex: number): number {
  let pos = openQuoteIndex + 1;
  while (pos < input.length) {
    if (input[pos] === "\\") {
      pos += 2;
      continue;
    }
    if (input[pos] === '"') {
      return pos;
    }
    pos++;
  }
  return -1;
}
