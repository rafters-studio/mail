// What a session told its client, saved (RFC 3501 2.3.1.2): "A relative position from 1 to the
// number of messages in the mailbox." A sequence number means what this client was last told, not
// what the mailbox holds now, so the view is saved and never derived (research 01a19d7e: rebuilt
// from the mailbox, FETCH 1 named another message after another client expunged).
import { z } from "zod";

// Inclusive UID ranges, ascending, so a mailbox of 100,000 messages in a row is one pair.
const rangesSchema = z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)]));

const viewShape = {
  account: z.string().min(1),
  mailbox: z.string().min(1),
  uidValidity: z.number().int().min(1),
  uidNext: z.number().int().min(1),
  readOnly: z.boolean(),
  uids: rangesSchema, // every UID in the client's view
  flags: z.array(z.tuple([z.array(z.string()), rangesSchema])), // those with any flag
};

export const snapshotSchema = z.strictObject({
  v: z.literal(1),
  // Bytes received and not yet a whole command, as binary text (one char per byte).
  // Always empty while not authenticated and once logged out.
  buffer: z.string(),
  granted: z.number().int().min(0),
  failures: z.number().int().min(0),
  dirty: z.boolean(),
  phase: z.discriminatedUnion("name", [
    z.strictObject({ name: z.literal("not-authenticated") }),
    z.strictObject({ name: z.literal("authenticated"), account: z.string().min(1) }),
    z.strictObject({ name: z.literal("selected"), ...viewShape }),
    z.strictObject({ name: z.literal("idling"), tag: z.string().min(1), ...viewShape }),
    z.strictObject({ name: z.literal("logged-out") }),
  ]),
});

/** A session as saved: what it told its client, and the bytes it holds of the next command. */
export type Snapshot = z.infer<typeof snapshotSchema>;

/** RFC 3501 2.3.1.1: UIDs ascend, so a sorted list folds into inclusive ranges. */
export function ranges(sorted: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const uid of sorted) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === uid - 1) last[1] = uid;
    else out.push([uid, uid]);
  }
  return out;
}

/** The list `ranges` folded, each UID once, in order. */
export function unranges(given: readonly [number, number][]): number[] {
  return given.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i));
}
