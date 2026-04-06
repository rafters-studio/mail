/**
 * IMAP message commands per RFC 3501 Section 6.4.
 *
 * FETCH (Section 6.4.5): Retrieve message data.
 * STORE (Section 6.4.6): Update message flags.
 * SEARCH (Section 6.4.4): Find messages by criteria.
 * EXPUNGE (Section 6.4.3): Permanently remove \Deleted messages.
 * NOOP (Section 6.1.2): Keepalive / check for updates.
 * CLOSE (Section 6.4.2): Close selected folder, expunge deleted.
 */

import {
  formatTagged,
  formatFetchResponse,
  formatSearchResponse,
  formatExpungeResponse,
} from "../protocol/formatter.ts";
import type { FetchResponseData, EnvelopeData } from "../protocol/formatter.ts";
import { parseFetchItems, parseSequenceSet, parseSearchCriteria } from "../protocol/parser.ts";
import type { FetchItem, SearchCriterion } from "../protocol/parser.ts";
import type { ImapSession } from "../session.ts";
import type { UidMap } from "../uid-map.ts";
import { mailFieldsToImapFlags, imapFlagsToMailFields, applyFlagUpdate } from "../flags.ts";

/**
 * Adapter interface for message operations.
 */
export interface MessageAdapter {
  getMessage(messageId: string): Promise<MessageData | undefined>;
  getMessagesByIds(messageIds: string[]): Promise<MessageData[]>;
  updateMessageFlags(messageId: string, fields: Record<string, unknown>): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  getBlob(blobKey: string): Promise<string | undefined>;
  searchMessages(folderId: string, criteria: SearchCriterion[]): Promise<string[]>;
}

export interface MessageData {
  id: string;
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  toName: string | null;
  ccEmails: string[] | null;
  bccEmails: string[] | null;
  replyToEmail: string | null;
  subject: string;
  snippet: string | null;
  blobKeyRaw: string;
  blobKeyHtml: string | null;
  blobKeyText: string | null;
  isOutbound: boolean;
  isRead: boolean;
  isStarred: boolean;
  deletedAt: Date | string | null;
  sizeBytes: number;
  receivedAt: Date | string;
  sentAt: Date | string | null;
  inReplyTo: string | null;
  threadId: string;
  folderSlug?: string;
  threadHasOutboundReply?: boolean;
  labelNames?: string[];
}

/**
 * RFC 3501 Section 6.4.5: FETCH command.
 * Retrieves message data for the specified sequence set and items.
 */
export async function handleFetch(
  tag: string,
  args: string,
  session: ImapSession,
  uidMap: UidMap,
  adapter: MessageAdapter,
  isUidCommand: boolean,
): Promise<string[]> {
  const stateError = session.validateCommand("FETCH");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const parsed = parseFetchArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "FETCH requires sequence set and data items")];
  }

  const uids = isUidCommand
    ? uidMap.resolveUidSet(parsed.sequenceSet)
    : uidMap.resolveSequenceSet(parsed.sequenceSet);

  const messageIds: string[] = [];
  for (const uid of uids) {
    const msgId = uidMap.uidToMessageId(uid);
    if (msgId !== undefined) {
      messageIds.push(msgId);
    }
  }

  const messages = await adapter.getMessagesByIds(messageIds);
  const responses: string[] = [];

  for (const message of messages) {
    const uid = uidMap.messageIdToUid(message.id);
    if (uid === undefined) continue;

    const seq = uidMap.uidToSequence(uid);
    if (seq === undefined) continue;

    const fetchData = await buildFetchResponse(message, uid, parsed.items, adapter);
    responses.push(formatFetchResponse(seq, fetchData));
  }

  responses.push(formatTagged(tag, "OK", "FETCH completed"));
  return responses;
}

/**
 * RFC 3501 Section 6.4.6: STORE command.
 * Updates flags on messages.
 */
export async function handleStore(
  tag: string,
  args: string,
  session: ImapSession,
  uidMap: UidMap,
  adapter: MessageAdapter,
  isUidCommand: boolean,
): Promise<string[]> {
  const stateError = session.validateCommand("STORE");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  if (session.isReadOnly()) {
    return [formatTagged(tag, "NO", "Mailbox is read-only (EXAMINE)")];
  }

  const parsed = parseStoreArgs(args);
  if (parsed === null) {
    return [formatTagged(tag, "BAD", "STORE requires sequence set, flag operation, and flags")];
  }

  const uids = isUidCommand
    ? uidMap.resolveUidSet(parsed.sequenceSet)
    : uidMap.resolveSequenceSet(parsed.sequenceSet);

  const responses: string[] = [];

  for (const uid of uids) {
    const msgId = uidMap.uidToMessageId(uid);
    if (msgId === undefined) continue;

    const message = await adapter.getMessage(msgId);
    if (message === undefined) continue;

    const currentFlags = mailFieldsToImapFlags(message, buildFlagOptions(message));

    const newFlags = applyFlagUpdate(currentFlags, parsed.flags, parsed.mode);
    const { fields } = imapFlagsToMailFields(newFlags);
    await adapter.updateMessageFlags(msgId, fields as Record<string, unknown>);

    if (!parsed.silent) {
      const seq = uidMap.uidToSequence(uid);
      if (seq !== undefined) {
        responses.push(formatFetchResponse(seq, { flags: newFlags }));
      }
    }
  }

  responses.push(formatTagged(tag, "OK", "STORE completed"));
  return responses;
}

/**
 * RFC 3501 Section 6.4.4: SEARCH command.
 * Finds messages matching criteria.
 */
export async function handleSearch(
  tag: string,
  args: string,
  session: ImapSession,
  uidMap: UidMap,
  adapter: MessageAdapter,
  isUidCommand: boolean,
): Promise<string[]> {
  const stateError = session.validateCommand("SEARCH");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  const folderId = session.selectedFolder?.folderId;
  if (folderId === undefined) {
    return [formatTagged(tag, "NO", "No folder selected")];
  }

  let criteria: SearchCriterion[];
  try {
    criteria = parseSearchCriteria(args);
  } catch {
    return [formatTagged(tag, "BAD", "Invalid search criteria")];
  }

  const matchingIds = await adapter.searchMessages(folderId, criteria);

  const results: number[] = [];
  for (const msgId of matchingIds) {
    const uid = uidMap.messageIdToUid(msgId);
    if (uid === undefined) continue;

    if (isUidCommand) {
      results.push(uid);
    } else {
      const seq = uidMap.uidToSequence(uid);
      if (seq !== undefined) {
        results.push(seq);
      }
    }
  }

  return [formatSearchResponse(results), formatTagged(tag, "OK", "SEARCH completed")];
}

/**
 * RFC 3501 Section 6.4.3: EXPUNGE command.
 * Permanently removes messages with \Deleted flag.
 */
export async function handleExpunge(
  tag: string,
  session: ImapSession,
  uidMap: UidMap,
  adapter: MessageAdapter,
): Promise<string[]> {
  const stateError = session.validateCommand("EXPUNGE");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  if (session.isReadOnly()) {
    return [formatTagged(tag, "NO", "Mailbox is read-only (EXAMINE)")];
  }

  const responses: string[] = [];
  const toExpunge: number[] = [];

  // Collect UIDs of deleted messages
  for (let seq = 1; seq <= uidMap.totalMessages(); seq++) {
    const uid = uidMap.sequenceToUid(seq);
    if (uid === undefined) continue;

    const msgId = uidMap.uidToMessageId(uid);
    if (msgId === undefined) continue;

    const message = await adapter.getMessage(msgId);
    if (message !== undefined && message.deletedAt !== null) {
      toExpunge.push(uid);
    }
  }

  // Expunge in reverse order so sequence numbers stay valid.
  // Delete from storage BEFORE mutating UID map -- if the delete fails,
  // the UID map stays consistent with storage.
  for (let i = toExpunge.length - 1; i >= 0; i--) {
    const uid = toExpunge[i] as number;
    const msgId = uidMap.uidToMessageId(uid);
    if (msgId === undefined) continue;

    await adapter.deleteMessage(msgId);
    const formerSeq = uidMap.expungeUid(uid);
    responses.push(formatExpungeResponse(formerSeq));
  }

  responses.push(formatTagged(tag, "OK", "EXPUNGE completed"));
  return responses;
}

/**
 * RFC 3501 Section 6.1.2: NOOP command.
 * No operation. Returns any pending untagged responses.
 */
export function handleNoop(tag: string, session: ImapSession): string[] {
  const stateError = session.validateCommand("NOOP");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }
  return [formatTagged(tag, "OK", "NOOP completed")];
}

/**
 * RFC 3501 Section 6.4.2: CLOSE command.
 * Close selected folder. Silently expunge deleted messages (no EXPUNGE responses).
 */
export async function handleClose(
  tag: string,
  session: ImapSession,
  uidMap: UidMap,
  adapter: MessageAdapter,
): Promise<string[]> {
  const stateError = session.validateCommand("CLOSE");
  if (stateError !== null) {
    return [formatTagged(tag, "NO", stateError)];
  }

  // Silently expunge deleted messages (no EXPUNGE responses per RFC)
  if (!session.isReadOnly()) {
    for (let seq = uidMap.totalMessages(); seq >= 1; seq--) {
      const uid = uidMap.sequenceToUid(seq);
      if (uid === undefined) continue;

      const msgId = uidMap.uidToMessageId(uid);
      if (msgId === undefined) continue;

      const message = await adapter.getMessage(msgId);
      if (message !== undefined && message.deletedAt !== null) {
        await adapter.deleteMessage(msgId);
      }
    }
  }

  session.close();
  return [formatTagged(tag, "OK", "CLOSE completed")];
}

/**
 * Build a FetchResponseData from a message and requested items.
 */
async function buildFetchResponse(
  message: MessageData,
  uid: number,
  items: FetchItem[],
  adapter: MessageAdapter,
): Promise<FetchResponseData> {
  const data: FetchResponseData = {};

  for (const item of items) {
    if (typeof item === "string") {
      switch (item) {
        case "FLAGS":
          data.flags = mailFieldsToImapFlags(message, buildFlagOptions(message));
          break;
        case "UID":
          data.uid = uid;
          break;
        case "RFC822.SIZE":
          data.rfc822Size = message.sizeBytes;
          break;
        case "INTERNALDATE":
          data.internalDate =
            message.receivedAt instanceof Date ? message.receivedAt : new Date(message.receivedAt);
          break;
        case "ENVELOPE":
          data.envelope = buildEnvelope(message);
          break;
        case "BODYSTRUCTURE":
          data.bodyStructure = '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 0 0)';
          break;
        case "BODY":
          data.bodyStructure = '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 0 0)';
          break;
      }
    } else {
      // BODY[section] fetch
      const content = await fetchBodySection(message, item.section, adapter);
      if (content !== undefined) {
        data.body = { section: item.section, content };
      }
    }
  }

  return data;
}

function buildEnvelope(message: MessageData): EnvelopeData {
  const receivedDate =
    message.receivedAt instanceof Date ? message.receivedAt : new Date(message.receivedAt);

  return {
    date: receivedDate.toUTCString(),
    subject: message.subject,
    from: [parseAddress(message.fromEmail, message.fromName)],
    sender: [parseAddress(message.fromEmail, message.fromName)],
    replyTo: message.replyToEmail
      ? [parseAddress(message.replyToEmail, null)]
      : [parseAddress(message.fromEmail, message.fromName)],
    to: [parseAddress(message.toEmail, message.toName)],
    cc: (message.ccEmails ?? []).map((e) => parseAddress(e, null)),
    bcc: (message.bccEmails ?? []).map((e) => parseAddress(e, null)),
    inReplyTo: message.inReplyTo ?? "",
    messageId: message.messageId,
  };
}

function parseAddress(
  email: string,
  name: string | null,
): { name: string | null; adl: string | null; mailbox: string; host: string } {
  const atIndex = email.indexOf("@");
  const mailbox = atIndex === -1 ? email : email.slice(0, atIndex);
  const host = atIndex === -1 ? "" : email.slice(atIndex + 1);
  return { name, adl: null, mailbox, host };
}

function buildFlagOptions(message: MessageData): {
  folderSlug?: string;
  threadHasOutboundReply?: boolean;
  labelNames?: string[];
} {
  const opts: { folderSlug?: string; threadHasOutboundReply?: boolean; labelNames?: string[] } = {};
  if (message.folderSlug !== undefined) opts.folderSlug = message.folderSlug;
  if (message.threadHasOutboundReply !== undefined)
    opts.threadHasOutboundReply = message.threadHasOutboundReply;
  if (message.labelNames !== undefined) opts.labelNames = message.labelNames;
  return opts;
}

async function fetchBodySection(
  message: MessageData,
  section: string,
  adapter: MessageAdapter,
): Promise<string | undefined> {
  const upper = section.toUpperCase();

  if (upper === "" || upper === "TEXT") {
    const key = message.blobKeyText ?? message.blobKeyHtml ?? message.blobKeyRaw;
    return adapter.getBlob(key);
  }

  if (upper === "HEADER") {
    // Reconstruct headers from message fields
    const headers = [
      `From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}`,
      `To: ${message.toName ? `${message.toName} <${message.toEmail}>` : message.toEmail}`,
      `Subject: ${message.subject}`,
      `Message-ID: ${message.messageId}`,
      `Date: ${message.receivedAt instanceof Date ? message.receivedAt.toUTCString() : new Date(message.receivedAt).toUTCString()}`,
    ];
    if (message.inReplyTo) {
      headers.push(`In-Reply-To: ${message.inReplyTo}`);
    }
    if (message.replyToEmail) {
      headers.push(`Reply-To: ${message.replyToEmail}`);
    }
    return headers.join("\r\n") + "\r\n\r\n";
  }

  // Full message
  return adapter.getBlob(message.blobKeyRaw);
}

/**
 * Parse FETCH arguments: sequence-set SP fetch-items
 */
function parseFetchArgs(
  args: string,
): { sequenceSet: Array<{ start: number | "*"; end?: number | "*" }>; items: FetchItem[] } | null {
  const trimmed = args.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return null;

  const seqStr = trimmed.slice(0, spaceIndex);
  const itemStr = trimmed.slice(spaceIndex + 1);

  try {
    const sequenceSet = parseSequenceSet(seqStr);
    const items = parseFetchItems(itemStr);
    return { sequenceSet, items };
  } catch {
    return null;
  }
}

/**
 * Parse STORE arguments: sequence-set SP flag-operation SP (flags)
 */
function parseStoreArgs(args: string): {
  sequenceSet: Array<{ start: number | "*"; end?: number | "*" }>;
  mode: "replace" | "add" | "remove";
  flags: string[];
  silent: boolean;
} | null {
  const trimmed = args.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return null;

  const seqStr = trimmed.slice(0, spaceIndex);
  const rest = trimmed.slice(spaceIndex + 1);

  const opSpaceIndex = rest.indexOf(" ");
  if (opSpaceIndex === -1) return null;

  const operation = rest.slice(0, opSpaceIndex).toUpperCase();
  const flagStr = rest.slice(opSpaceIndex + 1).trim();

  let mode: "replace" | "add" | "remove";
  let silent = false;

  if (operation === "FLAGS" || operation === "FLAGS.SILENT") {
    mode = "replace";
    silent = operation.endsWith(".SILENT");
  } else if (operation === "+FLAGS" || operation === "+FLAGS.SILENT") {
    mode = "add";
    silent = operation.endsWith(".SILENT");
  } else if (operation === "-FLAGS" || operation === "-FLAGS.SILENT") {
    mode = "remove";
    silent = operation.endsWith(".SILENT");
  } else {
    return null;
  }

  let flagList = flagStr;
  if (flagList.startsWith("(") && flagList.endsWith(")")) {
    flagList = flagList.slice(1, -1).trim();
  }

  const flags = flagList.length > 0 ? flagList.split(/\s+/) : [];

  try {
    const sequenceSet = parseSequenceSet(seqStr);
    return { sequenceSet, mode, flags, silent };
  } catch {
    return null;
  }
}
