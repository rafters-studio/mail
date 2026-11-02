// Sequence numbers and UIDs (RFC 3501 2.3.1.2): "A relative position from 1 to the number of
// messages in the mailbox." A session's view of its mailbox is its messages in UID order, so a
// message's sequence number is its place in that list; sets are ranges, never enumerated.
import type { SeqRange } from "./reader.ts";

/** RFC 3501 9 seq-range: n is in the set; "*" is `largest`, and a range covers both orders. */
export function contains(set: SeqRange[], n: number, largest: number): boolean {
  return set.some(({ from, to }) => {
    const a = from === "*" ? largest : from;
    const b = to === "*" ? largest : to;
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  });
}

/** The largest UID in a view (0 when empty): what "*" means in a UID set (RFC 3501 6.4.8). */
export function largestUid(messages: { uid: number }[]): number {
  return messages.reduce((top, m) => Math.max(top, m.uid), 0);
}

/**
 * RFC 3501 6.4.8: the messages a set names, by sequence number or by UID, each with its
 * sequence number; numbers past the last message name nothing.
 */
export function chosen<T extends { uid: number }>(
  set: SeqRange[],
  messages: T[],
  byUid: boolean,
): { seq: number; message: T }[] {
  const largest = byUid ? largestUid(messages) : messages.length;
  return messages
    .map((message, i) => ({ seq: i + 1, message }))
    .filter(({ seq, message }) => contains(set, byUid ? message.uid : seq, largest));
}

/**
 * RFC 3501 7.4.1: the sequence numbers to report as "* n EXPUNGE" when the `gone` UIDs leave
 * the view, in order, each number counted after the ones before it took effect.
 */
export function expunged(messages: { uid: number }[], gone: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const [i, m] of messages.entries()) if (gone.has(m.uid)) out.push(i + 1 - out.length);
  return out;
}
