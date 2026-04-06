/**
 * IMAP mailbox commands per RFC 3501 Sections 6.3.1-6.3.10.
 *
 * SELECT (Section 6.3.1): Open a folder read-write.
 * EXAMINE (Section 6.3.2): Open a folder read-only.
 * LIST (Section 6.3.8): List available folders.
 * LSUB (Section 6.3.9): List subscribed folders (MVP: same as LIST).
 * STATUS (Section 6.3.10): Get folder stats without selecting.
 */

import {
  formatTagged,
  formatListResponse,
  formatStatusResponse,
  formatSelectResponse,
} from "../protocol/formatter.ts";
import type { ImapSession } from "../session.ts";
import { UidMap } from "../uid-map.ts";
import { SUPPORTED_FLAGS, PERMANENT_FLAGS } from "../flags.ts";

/**
 * Adapter interface for folder operations.
 * The IMAP server delegates storage to the consumer's implementation.
 */
export interface MailboxAdapter {
  listFolders(mailboxId: string): Promise<FolderInfo[]>;
  getFolderByName(mailboxId: string, name: string): Promise<FolderInfo | undefined>;
  getFolderStats(folderId: string): Promise<FolderStats>;
  getMessageUids(folderId: string): Promise<Array<{ uid: number; messageId: string }>>;
}

export interface FolderInfo {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  hasChildren: boolean;
}

export interface FolderStats {
  messages: number;
  recent: number;
  unseen: number;
  uidValidity: number;
  uidNext: number;
}

/**
 * RFC 3501 Section 6.3.1: SELECT command.
 * Opens a folder for read-write access. Loads UID map.
 */
export async function handleSelect(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: MailboxAdapter,
): Promise<{ responses: string[]; uidMap: UidMap | null }> {
  const stateError = session.validateCommand("SELECT");
  if (stateError !== null) {
    return { responses: [formatTagged(tag, "NO", stateError)], uidMap: null };
  }

  const folderName = parseMailboxName(args);
  if (folderName === null) {
    return {
      responses: [formatTagged(tag, "BAD", "SELECT requires a mailbox name")],
      uidMap: null,
    };
  }

  const folder = await adapter.getFolderByName(mailboxId, folderName);
  if (folder === undefined) {
    return {
      responses: [formatTagged(tag, "NO", `Mailbox not found: ${folderName}`)],
      uidMap: null,
    };
  }

  const stats = await adapter.getFolderStats(folder.id);
  const messages = await adapter.getMessageUids(folder.id);

  const uidMap = new UidMap(stats.uidValidity, stats.uidNext);
  uidMap.load(messages);

  session.select({
    folderId: folder.id,
    folderName: folder.name,
    uidValidity: stats.uidValidity,
    uidNext: uidMap.uidNext,
    isReadOnly: false,
  });

  const selectLines = formatSelectResponse({
    exists: stats.messages,
    recent: stats.recent,
    unseen: stats.unseen > 0 ? 1 : null,
    uidValidity: stats.uidValidity,
    uidNext: uidMap.uidNext,
    flags: [...SUPPORTED_FLAGS],
    permanentFlags: [...PERMANENT_FLAGS],
    readWrite: true,
  });

  return {
    responses: [...selectLines, formatTagged(tag, "OK", "[READ-WRITE] SELECT completed")],
    uidMap,
  };
}

/**
 * RFC 3501 Section 6.3.2: EXAMINE command.
 * Opens a folder for read-only access.
 */
export async function handleExamine(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: MailboxAdapter,
): Promise<{ responses: string[]; uidMap: UidMap | null }> {
  const stateError = session.validateCommand("EXAMINE");
  if (stateError !== null) {
    return { responses: [formatTagged(tag, "NO", stateError)], uidMap: null };
  }

  const folderName = parseMailboxName(args);
  if (folderName === null) {
    return {
      responses: [formatTagged(tag, "BAD", "EXAMINE requires a mailbox name")],
      uidMap: null,
    };
  }

  const folder = await adapter.getFolderByName(mailboxId, folderName);
  if (folder === undefined) {
    return {
      responses: [formatTagged(tag, "NO", `Mailbox not found: ${folderName}`)],
      uidMap: null,
    };
  }

  const stats = await adapter.getFolderStats(folder.id);
  const messages = await adapter.getMessageUids(folder.id);

  const uidMap = new UidMap(stats.uidValidity, stats.uidNext);
  uidMap.load(messages);

  session.examine({
    folderId: folder.id,
    folderName: folder.name,
    uidValidity: stats.uidValidity,
    uidNext: uidMap.uidNext,
    isReadOnly: false,
  });

  const selectLines = formatSelectResponse({
    exists: stats.messages,
    recent: stats.recent,
    unseen: stats.unseen > 0 ? 1 : null,
    uidValidity: stats.uidValidity,
    uidNext: uidMap.uidNext,
    flags: [...SUPPORTED_FLAGS],
    permanentFlags: [...PERMANENT_FLAGS],
    readWrite: false,
  });

  return {
    responses: [...selectLines, formatTagged(tag, "OK", "[READ-ONLY] EXAMINE completed")],
    uidMap,
  };
}

/**
 * RFC 3501 Section 6.3.8: LIST command.
 * Returns all folders matching a pattern.
 * Hierarchy delimiter is "/".
 */
export async function handleList(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: MailboxAdapter,
): Promise<string[]> {
  const stateError = session.validateCommand("LIST");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const parsed = parseListArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "LIST requires reference and mailbox pattern")];
  }

  // RFC 3501 Section 6.3.8: empty mailbox pattern returns hierarchy delimiter
  if (parsed.pattern === "") {
    return [formatListResponse(["\\Noselect"], "/", ""), formatTagged(tag, "OK", "LIST completed")];
  }

  const folders = await adapter.listFolders(mailboxId);
  const responses: string[] = [];

  for (const folder of folders) {
    if (!matchesPattern(folder.name, parsed.pattern)) continue;

    const flags: string[] = [];
    if (folder.hasChildren) {
      flags.push("\\HasChildren");
    } else {
      flags.push("\\HasNoChildren");
    }

    const systemFlag = SYSTEM_FOLDER_FLAGS[folder.slug];
    if (systemFlag !== undefined) {
      flags.push(systemFlag);
    }

    responses.push(formatListResponse(flags, "/", folder.name));
  }

  responses.push(formatTagged(tag, "OK", "LIST completed"));
  return responses;
}

/**
 * RFC 3501 Section 6.3.9: LSUB command.
 * MVP: treat all folders as subscribed. Same as LIST.
 */
export async function handleLsub(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: MailboxAdapter,
): Promise<string[]> {
  return handleList(tag, args, session, mailboxId, adapter);
}

/**
 * RFC 3501 Section 6.3.10: STATUS command.
 * Returns folder stats without selecting it.
 */
export async function handleStatus(
  tag: string,
  args: string,
  session: ImapSession,
  mailboxId: string,
  adapter: MailboxAdapter,
): Promise<string[]> {
  const stateError = session.validateCommand("STATUS");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const parsed = parseStatusArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "STATUS requires mailbox name and item list")];
  }

  const folder = await adapter.getFolderByName(mailboxId, parsed.mailbox);
  if (folder === undefined) {
    return [formatTagged(tag, "NO", `Mailbox not found: ${parsed.mailbox}`)];
  }

  const stats = await adapter.getFolderStats(folder.id);
  const items: Record<string, number> = {};

  for (const item of parsed.items) {
    switch (item) {
      case "MESSAGES":
        items["MESSAGES"] = stats.messages;
        break;
      case "RECENT":
        items["RECENT"] = stats.recent;
        break;
      case "UIDNEXT":
        items["UIDNEXT"] = stats.uidNext;
        break;
      case "UIDVALIDITY":
        items["UIDVALIDITY"] = stats.uidValidity;
        break;
      case "UNSEEN":
        items["UNSEEN"] = stats.unseen;
        break;
    }
  }

  return [formatStatusResponse(parsed.mailbox, items), formatTagged(tag, "OK", "STATUS completed")];
}

/**
 * RFC 3501 Section 7.2.2: System folder flag mapping.
 */
const SYSTEM_FOLDER_FLAGS: Record<string, string> = {
  inbox: "\\Inbox",
  sent: "\\Sent",
  drafts: "\\Drafts",
  spam: "\\Junk",
  trash: "\\Trash",
  archive: "\\Archive",
};

/**
 * Parse a mailbox name from command arguments.
 * Handles both quoted and unquoted names.
 */
function parseMailboxName(args: string): string | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  if (trimmed[0] === '"') {
    const endQuote = findClosingQuote(trimmed, 0);
    if (endQuote === -1) return null;
    return trimmed.slice(1, endQuote);
  }

  const spaceIndex = trimmed.indexOf(" ");
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}

/**
 * Parse LIST command arguments: reference SP mailbox-pattern
 */
function parseListArgs(args: string): { reference: string; pattern: string } | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  let reference: string;
  let remaining: string;

  if (trimmed[0] === '"') {
    const endQuote = findClosingQuote(trimmed, 0);
    if (endQuote === -1) return null;
    reference = trimmed.slice(1, endQuote);
    remaining = trimmed.slice(endQuote + 1).trim();
  } else {
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) return null;
    reference = trimmed.slice(0, spaceIndex);
    remaining = trimmed.slice(spaceIndex + 1).trim();
  }

  if (remaining.length === 0) return null;

  let pattern: string;
  if (remaining[0] === '"') {
    const endQuote = findClosingQuote(remaining, 0);
    if (endQuote === -1) return null;
    pattern = remaining.slice(1, endQuote);
  } else {
    pattern = remaining;
  }

  return { reference, pattern };
}

/**
 * Parse STATUS command arguments: mailbox SP (items)
 */
function parseStatusArgs(args: string): { mailbox: string; items: string[] } | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) return null;

  let mailbox: string;
  let remaining: string;

  if (trimmed[0] === '"') {
    const endQuote = findClosingQuote(trimmed, 0);
    if (endQuote === -1) return null;
    mailbox = trimmed.slice(1, endQuote);
    remaining = trimmed.slice(endQuote + 1).trim();
  } else {
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) return null;
    mailbox = trimmed.slice(0, spaceIndex);
    remaining = trimmed.slice(spaceIndex + 1).trim();
  }

  if (!remaining.startsWith("(") || !remaining.endsWith(")")) return null;

  const itemStr = remaining.slice(1, -1).trim();
  if (itemStr.length === 0) return null;

  const items = itemStr.split(/\s+/).map((s) => s.toUpperCase());
  const validItems = new Set(["MESSAGES", "RECENT", "UIDNEXT", "UIDVALIDITY", "UNSEEN"]);
  if (items.some((i) => !validItems.has(i))) return null;

  return { mailbox, items };
}

/**
 * RFC 3501 Section 6.3.8: Match a folder name against a pattern.
 * * matches zero or more characters including hierarchy delimiter.
 * % matches zero or more characters excluding hierarchy delimiter.
 */
function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;

  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, "[^/]*")
    .replace(/\*/g, ".*");

  return new RegExp(`^${regexStr}$`, "i").test(name);
}

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
