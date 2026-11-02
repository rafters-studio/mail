// SEARCH (RFC 3501 6.4.4): "The SEARCH command searches the mailbox for messages that match the
// given searching criteria." The keys here are the flag keys, ALL, UID and sequence sets, NOT,
// and parenthesised groups; keys side by side must all hold.
import type { Held } from "./index.ts";
import { sequenceSet, text, type Value } from "./reader.ts";
import { contains, largestUid } from "./sequence.ts";

/** One message as a search sees it. */
export type Candidate = { seq: number; held: Held };
type Test = (c: Candidate) => boolean;

/** RFC 3501 2.3.2: whether a message has a flag; flags compare without case, keywords too. */
export const hasFlag = (flags: string[], flag: string): boolean =>
  flags.some((f) => f.toLowerCase() === flag.toLowerCase());

// RFC 3501 6.4.4: each flag key, the flag it tests and whether the message must have it.
const FLAG_KEYS = new Map<string, [string, boolean]>([
  ["SEEN", ["\\Seen", true]],
  ["UNSEEN", ["\\Seen", false]],
  ["FLAGGED", ["\\Flagged", true]],
  ["UNFLAGGED", ["\\Flagged", false]],
  ["DELETED", ["\\Deleted", true]],
  ["UNDELETED", ["\\Deleted", false]],
  ["ANSWERED", ["\\Answered", true]],
  ["UNANSWERED", ["\\Answered", false]],
  ["DRAFT", ["\\Draft", true]],
  ["UNDRAFT", ["\\Draft", false]],
]);

/** RFC 3501 6.4.4: "When multiple keys are specified, the result is the intersection". */
const all =
  (tests: Test[]): Test =>
  (c) =>
    tests.every((t) => t(c));

/**
 * RFC 3501 6.4.4: the test the keys make over `messages` (for what "*" means), or null when
 * they are not search keys. A leading CHARSET is read and ignored: no key here compares text.
 */
export function searchTest(args: Value[], messages: Held[]): Test | null {
  const [first, , ...rest] = args;
  const keys = text(first)?.toUpperCase() === "CHARSET" ? rest : args;
  const seqLargest = messages.length;
  const uidLargest = largestUid(messages);
  let at = 0;
  /** One search key from `from` at `at`, or null. */
  const key = (from: Value[]): Test | null => {
    const v = from[at++];
    if (v?.kind === "list") return group(v.items);
    const name = text(v)?.toUpperCase() ?? "";
    const flag = FLAG_KEYS.get(name);
    if (flag !== undefined) return ({ held }) => hasFlag(held.flags, flag[0]) === flag[1];
    if (name === "ALL") return () => true;
    if (name === "NOT") {
      const inner = key(from);
      return inner === null ? null : (c) => !inner(c);
    }
    if (name === "UID") {
      const set = sequenceSet(text(from[at++]) ?? "");
      return set === null ? null : ({ held }) => contains(set, held.uid, uidLargest);
    }
    const set = sequenceSet(text(v) ?? "");
    return set === null ? null : ({ seq }) => contains(set, seq, seqLargest);
  };
  /** RFC 3501 6.4.4: keys side by side, all of which must hold; a group restarts the cursor. */
  const group = (items: Value[]): Test | null => {
    const saved = at;
    at = 0;
    const tests: Test[] = [];
    while (at < items.length) {
      const t = key(items);
      if (t === null) return null;
      tests.push(t);
    }
    at = saved;
    return tests.length === 0 ? null : all(tests);
  };
  return group(keys);
}
