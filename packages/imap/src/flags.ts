/**
 * IMAP flag mapping per RFC 3501 Section 2.3.2.
 *
 * Maps between IMAP system flags and @rafters/mail inboxMessage fields.
 * Custom IMAP keywords map to labels via inboxMessageLabel.
 *
 * System flags defined in RFC 3501:
 *   \Seen     - Message has been read
 *   \Answered - Message has been answered
 *   \Flagged  - Message is "flagged" for attention
 *   \Deleted  - Message is marked for deletion
 *   \Draft    - Message is a draft
 *   \Recent   - Message recently arrived (session-scoped, read-only)
 */

/**
 * RFC 3501 Section 2.3.2: The set of system flags the server supports.
 * \Recent is not included because it is server-managed and read-only.
 */
export const SUPPORTED_FLAGS = [
  "\\Seen",
  "\\Answered",
  "\\Flagged",
  "\\Deleted",
  "\\Draft",
] as const;

/**
 * RFC 3501 Section 2.3.2: Permanent flags that can be changed by the client.
 * \* means the server supports client-defined keywords (mapped to labels).
 */
export const PERMANENT_FLAGS = [...SUPPORTED_FLAGS, "\\*"] as const;

/**
 * Fields on inboxMessage that IMAP flags map to.
 */
export interface MessageFlagFields {
  isRead?: boolean;
  isStarred?: boolean;
  deletedAt?: Date | null;
}

/**
 * RFC 3501 Section 2.3.2: Convert IMAP flags to @rafters/mail message fields.
 *
 * System flag mapping:
 *   \Seen    -> isRead = true
 *   \Flagged -> isStarred = true
 *   \Deleted -> deletedAt = now (soft delete)
 *
 * Flags not mapped to fields:
 *   \Answered -> derived from thread state (has outbound reply), not stored on message
 *   \Draft    -> derived from folder (drafts folder), not stored on message
 *   \Recent   -> server-managed, not settable by client
 *
 * Custom keywords (non-system flags) are returned separately for label mapping.
 */
export function imapFlagsToMailFields(flags: string[]): {
  fields: MessageFlagFields;
  keywords: string[];
} {
  const fields: MessageFlagFields = {};
  const keywords: string[] = [];

  for (const flag of flags) {
    switch (flag) {
      case "\\Seen":
        fields.isRead = true;
        break;
      case "\\Flagged":
        fields.isStarred = true;
        break;
      case "\\Deleted":
        fields.deletedAt = new Date();
        break;
      case "\\Answered":
      case "\\Draft":
      case "\\Recent":
        // These flags are derived, not stored directly on the message
        break;
      default:
        // RFC 3501 Section 2.3.2: non-system flags are keywords
        if (!flag.startsWith("\\")) {
          keywords.push(flag);
        }
        break;
    }
  }

  return { fields, keywords };
}

/**
 * RFC 3501 Section 2.3.2: Convert @rafters/mail message fields to IMAP flags.
 *
 * @param message - The message fields to convert
 * @param options - Additional context for derived flags
 */
export function mailFieldsToImapFlags(
  message: {
    isRead: boolean;
    isStarred: boolean;
    deletedAt: Date | string | null;
    isOutbound: boolean;
  },
  options: {
    folderSlug?: string;
    threadHasOutboundReply?: boolean;
    labelNames?: string[];
  } = {},
): string[] {
  const flags: string[] = [];

  // \Seen: RFC 3501 Section 2.3.2 - "Message has been read"
  if (message.isRead) {
    flags.push("\\Seen");
  }

  // \Flagged: RFC 3501 Section 2.3.2 - "Message is flagged for urgent/special attention"
  if (message.isStarred) {
    flags.push("\\Flagged");
  }

  // \Deleted: RFC 3501 Section 2.3.2 - "Message is marked for removal"
  if (message.deletedAt !== null) {
    flags.push("\\Deleted");
  }

  // \Draft: RFC 3501 Section 2.3.2 - "Message has not completed composition"
  if (options.folderSlug === "drafts") {
    flags.push("\\Draft");
  }

  // \Answered: RFC 3501 Section 2.3.2 - "Message has been answered"
  // Derived from thread state, not stored on message
  if (options.threadHasOutboundReply) {
    flags.push("\\Answered");
  }

  // Custom keywords from labels
  if (options.labelNames !== undefined) {
    for (const label of options.labelNames) {
      flags.push(label);
    }
  }

  return flags;
}

/**
 * RFC 3501 Section 6.4.6: Apply flag changes per STORE command.
 *
 * Three modes:
 *   FLAGS     - Replace all flags
 *   +FLAGS    - Add flags
 *   -FLAGS    - Remove flags
 */
export function applyFlagUpdate(
  currentFlags: string[],
  updateFlags: string[],
  mode: "replace" | "add" | "remove",
): string[] {
  switch (mode) {
    case "replace":
      return [...updateFlags];
    case "add": {
      const result = new Set(currentFlags);
      for (const flag of updateFlags) {
        result.add(flag);
      }
      return [...result];
    }
    case "remove": {
      const toRemove = new Set(updateFlags);
      return currentFlags.filter((f) => !toRemove.has(f));
    }
  }
}
