/**
 * IMAP IDLE command per RFC 2177.
 *
 * IDLE lets the client say "I'm listening" and the server push
 * notifications when new mail arrives. The client sends DONE to exit.
 *
 * On Cloudflare DOs, IDLE maps to WebSocket hibernation:
 * - Client enters IDLE -> DO sets alarm for 30min timeout
 * - New mail arrives -> inbound adapter signals DO -> DO wakes and pushes EXISTS
 * - Client sends DONE -> IDLE ends, normal command processing resumes
 *
 * This module provides the protocol-level IDLE handling.
 * The DO hibernation integration is in @rafters/mail-imap-cloudflare.
 */

import { formatTagged, formatContinuation, formatExistsResponse } from "../protocol/formatter.ts";
import type { ImapSession } from "../session.ts";

export interface IdleState {
  tag: string;
  active: boolean;
}

/**
 * RFC 2177: IDLE command.
 * Begins the IDLE state. Server responds with continuation (+).
 * Client must send DONE to exit IDLE.
 */
export function handleIdleStart(
  tag: string,
  session: ImapSession,
): { response: string; idleState: IdleState } | { response: string; idleState: null } {
  const stateError = session.validateCommand("IDLE");
  if (stateError !== null) {
    return { response: formatTagged(tag, "NO", stateError), idleState: null };
  }

  return {
    response: formatContinuation("idling"),
    idleState: { tag, active: true },
  };
}

/**
 * RFC 2177: Client sends DONE to exit IDLE.
 * Returns the tagged OK response using the original IDLE tag.
 */
export function handleIdleDone(idleState: IdleState): string {
  idleState.active = false;
  return formatTagged(idleState.tag, "OK", "IDLE completed");
}

/**
 * RFC 2177: Generate EXISTS notification for IDLE clients.
 * Called when new mail arrives while client is in IDLE.
 */
export function generateIdleNotification(newMessageCount: number): string {
  return formatExistsResponse(newMessageCount);
}

/**
 * Check if a line received during IDLE is the DONE command.
 * RFC 2177: only DONE is valid during IDLE. Anything else is BAD.
 */
export function isIdleDone(line: string): boolean {
  return line.trim().toUpperCase() === "DONE";
}

/**
 * RFC 2177: Response for invalid input during IDLE.
 */
export function handleIdleBadInput(idleState: IdleState): string {
  return formatTagged(idleState.tag, "BAD", "Expected DONE during IDLE");
}
