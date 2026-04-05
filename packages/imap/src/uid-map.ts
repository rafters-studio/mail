/**
 * UID and sequence number mapping per RFC 3501 Section 2.3.1.1.
 *
 * IMAP uses two numbering schemes:
 * - UIDs: persistent, unique, always increasing, never reused
 * - Sequence numbers: positional (1-based), change on EXPUNGE
 *
 * This module maintains a bidirectional mapping between UIDs,
 * sequence numbers, and @rafters/mail UUIDv7 message IDs.
 * UIDs are derived from creation order within a folder
 * (UUIDv7 timestamp component provides natural ordering).
 */

export class UidMap {
  /**
   * Ordered list of entries. Index + 1 = sequence number.
   * Sorted by UID (ascending), which corresponds to UUIDv7 creation order.
   */
  private entries: UidEntry[] = [];

  /** UID -> index in entries array */
  private uidIndex = new Map<number, number>();

  /** UUIDv7 message ID -> index in entries array */
  private messageIdIndex = new Map<string, number>();

  private _uidValidity: number;
  private _uidNext: number;

  constructor(uidValidity: number, uidNext: number) {
    this._uidValidity = uidValidity;
    this._uidNext = uidNext;
  }

  /**
   * RFC 3501 Section 2.3.1.1: UIDVALIDITY value for this folder.
   * Incremented if the UID mapping is rebuilt.
   */
  get uidValidity(): number {
    return this._uidValidity;
  }

  /**
   * RFC 3501 Section 2.3.1.1: The next UID that will be assigned.
   * Always greater than the highest existing UID.
   */
  get uidNext(): number {
    return this._uidNext;
  }

  /**
   * RFC 3501 Section 2.3.1.1: Total number of messages in the folder.
   */
  totalMessages(): number {
    return this.entries.length;
  }

  /**
   * Load messages from a pre-sorted list (by UID ascending).
   * Called when a folder is selected.
   */
  load(messages: Array<{ uid: number; messageId: string }>): void {
    this.entries = [];
    this.uidIndex.clear();
    this.messageIdIndex.clear();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as { uid: number; messageId: string };
      const entry: UidEntry = { uid: msg.uid, messageId: msg.messageId };
      this.entries.push(entry);
      this.uidIndex.set(msg.uid, i);
      this.messageIdIndex.set(msg.messageId, i);
    }

    if (this.entries.length > 0) {
      const lastEntry = this.entries[this.entries.length - 1] as UidEntry;
      if (lastEntry.uid >= this._uidNext) {
        this._uidNext = lastEntry.uid + 1;
      }
    }
  }

  /**
   * RFC 3501 Section 2.3.1.1: Map a UID to a UUIDv7 message ID.
   */
  uidToMessageId(uid: number): string | undefined {
    const index = this.uidIndex.get(uid);
    if (index === undefined) return undefined;
    return (this.entries[index] as UidEntry).messageId;
  }

  /**
   * Map a UUIDv7 message ID to its UID.
   */
  messageIdToUid(messageId: string): number | undefined {
    const index = this.messageIdIndex.get(messageId);
    if (index === undefined) return undefined;
    return (this.entries[index] as UidEntry).uid;
  }

  /**
   * RFC 3501 Section 2.3.1.2: Map a sequence number to a UID.
   * Sequence numbers are 1-based.
   */
  sequenceToUid(seq: number): number | undefined {
    if (seq < 1 || seq > this.entries.length) return undefined;
    return (this.entries[seq - 1] as UidEntry).uid;
  }

  /**
   * Map a UID to its current sequence number (1-based).
   */
  uidToSequence(uid: number): number | undefined {
    const index = this.uidIndex.get(uid);
    if (index === undefined) return undefined;
    return index + 1;
  }

  /**
   * RFC 3501 Section 2.3.1.1: Add a new message and assign the next UID.
   * Returns the assigned UID.
   */
  addMessage(messageId: string): number {
    const uid = this._uidNext;
    this._uidNext++;

    const index = this.entries.length;
    this.entries.push({ uid, messageId });
    this.uidIndex.set(uid, index);
    this.messageIdIndex.set(messageId, index);

    return uid;
  }

  /**
   * RFC 3501 Section 2.3.2: Expunge a message by UID.
   * Returns the former sequence number (1-based) for the EXPUNGE response.
   * Sequence numbers of all subsequent messages shift down by one.
   */
  expungeUid(uid: number): number {
    const index = this.uidIndex.get(uid);
    if (index === undefined) {
      throw new Error(`UID ${uid} not found in map`);
    }

    const sequenceNumber = index + 1;
    const entry = this.entries[index] as UidEntry;

    // Remove from entries
    this.entries.splice(index, 1);

    // Remove from indexes
    this.uidIndex.delete(uid);
    this.messageIdIndex.delete(entry.messageId);

    // Rebuild indexes for all entries after the removed one
    // (their sequence numbers shifted down)
    for (let i = index; i < this.entries.length; i++) {
      const e = this.entries[i] as UidEntry;
      this.uidIndex.set(e.uid, i);
      this.messageIdIndex.set(e.messageId, i);
    }

    return sequenceNumber;
  }

  /**
   * Resolve a sequence set to an array of UIDs.
   * Handles ranges, wildcards (*), and individual numbers.
   * Returns UIDs in ascending order.
   */
  resolveSequenceSet(ranges: Array<{ start: number | "*"; end?: number | "*" }>): number[] {
    const total = this.entries.length;
    if (total === 0) return [];

    const uids = new Set<number>();

    for (const range of ranges) {
      const start = range.start === "*" ? total : range.start;
      const end = range.end === undefined ? start : range.end === "*" ? total : range.end;

      const lo = Math.min(start, end);
      const hi = Math.max(start, end);

      for (let seq = lo; seq <= hi; seq++) {
        const entry = this.entries[seq - 1];
        if (entry !== undefined) {
          uids.add(entry.uid);
        }
      }
    }

    return [...uids].sort((a, b) => a - b);
  }

  /**
   * Resolve a UID set to an array of UIDs that exist in the map.
   * Same as resolveSequenceSet but input is UID ranges, not sequence ranges.
   */
  resolveUidSet(ranges: Array<{ start: number | "*"; end?: number | "*" }>): number[] {
    const total = this.entries.length;
    if (total === 0) return [];

    const maxUid = (this.entries[total - 1] as UidEntry).uid;
    const uids = new Set<number>();

    for (const range of ranges) {
      const start = range.start === "*" ? maxUid : range.start;
      const end = range.end === undefined ? start : range.end === "*" ? maxUid : range.end;

      const lo = Math.min(start, end);
      const hi = Math.max(start, end);

      // Walk sorted entries array instead of scanning full Map
      for (const entry of this.entries) {
        if (entry.uid > hi) break;
        if (entry.uid >= lo) {
          uids.add(entry.uid);
        }
      }
    }

    return [...uids].sort((a, b) => a - b);
  }
}

interface UidEntry {
  uid: number;
  messageId: string;
}
