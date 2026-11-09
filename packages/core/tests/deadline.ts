// Deadlines a test fires (research 01a1ae1d): "deadlines behind a port can be fired by the test".
import type { Deadline } from "../src/send/index.ts";

type Held = { ms: number; reason: string; fire(): void };
const held = new Map<string, Held[]>();

/** A deadline that never fires on its own: `expire(owner)` fires it, and `pending(owner)` shows what was asked. */
export function heldDeadline(owner: string): Deadline {
  return (ms, reason) => {
    const abort = new AbortController();
    const one: Held = { ms, reason, fire: () => abort.abort(new Error(reason)) };
    held.set(owner, [...(held.get(owner) ?? []), one]);
    return {
      signal: abort.signal,
      clear: () =>
        held.set(
          owner,
          (held.get(owner) ?? []).filter((h) => h !== one),
        ),
    };
  };
}

/** The bounds asked for and not yet cleared or fired. */
export function pending(owner: string): { ms: number; reason: string }[] {
  return (held.get(owner) ?? []).map(({ ms, reason }) => ({ ms, reason }));
}

/** Fires every pending bound of `owner`, and gives what it fired. */
export function expire(owner: string): { ms: number; reason: string }[] {
  const due = held.get(owner) ?? [];
  held.delete(owner);
  for (const h of due) h.fire();
  return due.map(({ ms, reason }) => ({ ms, reason }));
}
