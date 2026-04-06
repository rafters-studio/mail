/**
 * IMAP extension commands.
 *
 * COPY (RFC 3501 Section 6.4.7): Copy messages between folders.
 * MOVE (RFC 6851): Atomic move (COPY + STORE \Deleted + EXPUNGE).
 * APPEND (RFC 3501 Section 6.3.6): Upload a message to a folder.
 * UNSELECT (RFC 3691): Close folder without expunging.
 */

import { formatTagged, formatExpungeResponse } from "../protocol/formatter.ts";
import { parseSequenceSet } from "../protocol/parser.ts";
import type { ImapSession } from "../session.ts";
import type { UidMap } from "../uid-map.ts";

/**
 * Adapter interface for extension operations.
 */
export interface ExtensionAdapter {
  copyMessage(messageId: string, targetFolderId: string): Promise<{ newUid: number }>;
  moveMessage(messageId: string, targetFolderId: string): Promise<{ newUid: number }>;
  appendMessage(
    folderId: string,
    content: string,
    flags: string[],
    internalDate?: Date,
  ): Promise<{ uid: number; messageId: string }>;
  getFolderIdByName(mailboxId: string, name: string): Promise<string | undefined>;
}

/**
 * RFC 3501 Section 6.4.7: COPY command.
 * Copies messages to another folder. Does not remove from source.
 */
export async function handleCopy(
  tag: string,
  args: string,
  session: ImapSession,
  uidMap: UidMap,
  mailboxId: string,
  adapter: ExtensionAdapter,
  isUidCommand: boolean,
): Promise<string[]> {
  const stateError = session.validateCommand("COPY");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const parsed = parseCopyMoveArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "COPY requires sequence set and target mailbox")];
  }

  const targetFolderId = await adapter.getFolderIdByName(mailboxId, parsed.targetMailbox);
  if (targetFolderId === undefined) {
    return [formatTagged(tag, "NO", `Target mailbox not found: ${parsed.targetMailbox}`)];
  }

  const uids = isUidCommand
    ? uidMap.resolveUidSet(parsed.sequenceSet)
    : uidMap.resolveSequenceSet(parsed.sequenceSet);

  const sourceUids: number[] = [];
  const destUids: number[] = [];

  for (const uid of uids) {
    const msgId = uidMap.uidToMessageId(uid);
    if (msgId === undefined) continue;
    const result = await adapter.copyMessage(msgId, targetFolderId);
    sourceUids.push(uid);
    destUids.push(result.newUid);
  }

  // RFC 4315: COPYUID response code
  const uidValidity = uidMap.uidValidity;
  const copyUid = `[COPYUID ${uidValidity} ${sourceUids.join(",")} ${destUids.join(",")}]`;
  return [formatTagged(tag, "OK", `${copyUid} COPY completed`)];
}

/**
 * RFC 6851: MOVE command.
 * Atomically moves messages to another folder.
 * Equivalent to COPY + STORE \Deleted + EXPUNGE but atomic.
 */
export async function handleMove(
  tag: string,
  args: string,
  session: ImapSession,
  uidMap: UidMap,
  mailboxId: string,
  adapter: ExtensionAdapter,
  isUidCommand: boolean,
): Promise<string[]> {
  const stateError = session.validateCommand("MOVE");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  if (session.isReadOnly()) {
    return [formatTagged(tag, "NO", "Mailbox is read-only (EXAMINE)")];
  }

  const parsed = parseCopyMoveArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "MOVE requires sequence set and target mailbox")];
  }

  const targetFolderId = await adapter.getFolderIdByName(mailboxId, parsed.targetMailbox);
  if (targetFolderId === undefined) {
    return [formatTagged(tag, "NO", `Target mailbox not found: ${parsed.targetMailbox}`)];
  }

  const uids = isUidCommand
    ? uidMap.resolveUidSet(parsed.sequenceSet)
    : uidMap.resolveSequenceSet(parsed.sequenceSet);

  const responses: string[] = [];
  const sourceUids: number[] = [];
  const destUids: number[] = [];

  // Move in reverse order to keep sequence numbers valid for EXPUNGE responses
  for (let i = uids.length - 1; i >= 0; i--) {
    const uid = uids[i] as number;
    const msgId = uidMap.uidToMessageId(uid);
    if (msgId === undefined) continue;

    const result = await adapter.moveMessage(msgId, targetFolderId);
    sourceUids.unshift(uid);
    destUids.unshift(result.newUid);
    const formerSeq = uidMap.expungeUid(uid);
    responses.push(formatExpungeResponse(formerSeq));
  }

  // RFC 6851 Section 4: COPYUID response code
  const uidValidity = uidMap.uidValidity;
  const copyUid = `[COPYUID ${uidValidity} ${sourceUids.join(",")} ${destUids.join(",")}]`;
  responses.push(formatTagged(tag, "OK", `${copyUid} MOVE completed`));
  return responses;
}

/**
 * RFC 3501 Section 6.3.6: APPEND command.
 * Uploads a message to a folder.
 */
export async function handleAppend(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: ExtensionAdapter,
): Promise<string[]> {
  const stateError = session.validateCommand("APPEND");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const parsed = parseAppendArgs(args);
  if (parsed === null) {
    return [
      formatTagged(tag, "BAD", "APPEND requires mailbox, optional flags/date, and message literal"),
    ];
  }

  const folderId = await adapter.getFolderIdByName(mailboxId, parsed.mailbox);
  if (folderId === undefined) {
    return [formatTagged(tag, "NO", `Mailbox not found: ${parsed.mailbox}`)];
  }

  const result = await adapter.appendMessage(folderId, parsed.content, parsed.flags, parsed.date);

  // RFC 4315: APPENDUID response code
  return [formatTagged(tag, "OK", `[APPENDUID 1 ${result.uid}] APPEND completed`)];
}

/**
 * RFC 3691: UNSELECT command.
 * Close selected folder WITHOUT expunging deleted messages.
 */
export function handleUnselect(tag: string, session: ImapSession): string[] {
  const stateError = session.validateCommand("UNSELECT");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  session.close();
  return [formatTagged(tag, "OK", "UNSELECT completed")];
}

/**
 * Parse COPY/MOVE arguments: sequence-set SP mailbox
 */
function parseCopyMoveArgs(args: string): {
  sequenceSet: Array<{ start: number | "*"; end?: number | "*" }>;
  targetMailbox: string;
} | null {
  const trimmed = args.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return null;

  const seqStr = trimmed.slice(0, spaceIndex);
  let targetMailbox = trimmed.slice(spaceIndex + 1).trim();

  if (targetMailbox.startsWith('"') && targetMailbox.endsWith('"')) {
    targetMailbox = targetMailbox.slice(1, -1);
  }

  if (targetMailbox.length === 0) return null;

  try {
    const sequenceSet = parseSequenceSet(seqStr);
    return { sequenceSet, targetMailbox };
  } catch {
    return null;
  }
}

/**
 * Parse APPEND arguments: mailbox [flags] [date] literal
 * Simplified: expects mailbox and literal content inline for now.
 */
function parseAppendArgs(
  args: string,
): { mailbox: string; flags: string[]; date?: Date; content: string } | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  let mailbox: string;
  let remaining: string;

  if (trimmed[0] === '"') {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote === -1) return null;
    mailbox = trimmed.slice(1, endQuote);
    remaining = trimmed.slice(endQuote + 1).trim();
  } else {
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) return null;
    mailbox = trimmed.slice(0, spaceIndex);
    remaining = trimmed.slice(spaceIndex + 1).trim();
  }

  const flags: string[] = [];

  // Parse optional flags list
  if (remaining.startsWith("(")) {
    const closeIndex = remaining.indexOf(")");
    if (closeIndex === -1) return null;
    const flagStr = remaining.slice(1, closeIndex).trim();
    if (flagStr.length > 0) {
      flags.push(...flagStr.split(/\s+/));
    }
    remaining = remaining.slice(closeIndex + 1).trim();
  }

  // The rest is the message content (simplified -- real IMAP uses literals)
  if (remaining.length === 0) return null;

  return { mailbox, flags, content: remaining };
}
