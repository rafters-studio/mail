import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { z } from "zod";
import { criterion } from "./criterion.ts";
import { CAPABILITIES, createImapSession } from "../src/imap/index.ts";
import { record, type Entry, type Step } from "./imap/record.ts";
import { memoryStore } from "./imap/store.ts";

const GOLDENS = new URL("./fixtures/imap/", import.meta.url);

const goldenSchema = z.array(
  z.strictObject({ client: z.string(), server: z.string(), change: z.string().optional() }),
);

/** One golden transcript of research 01a19b9a, its first entry the greeting. */
function golden(name: string): Entry[] {
  return goldenSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, GOLDENS), "utf8")));
}

/**
 * The name a scenario gives the step an entry begins: its tag, "DONE", "the change <name>", or
 * null for an entry that carries on the step before it (a literal's octets, a line inside IDLE).
 */
function label(entry: Entry, index: number): string | null {
  if (index === 0) return "greeting";
  if (entry.change !== undefined) return `the change ${entry.change}`;
  if (entry.client === "DONE\r\n") return "DONE";
  return /^([A-Z]\d+)[ (]/.exec(entry.client)?.[1] ?? null;
}

/** The steps of a golden, each its label and the indices of its entries, in order. */
function steps(entries: Entry[]): { label: string; at: number[] }[] {
  const out: { label: string; at: number[] }[] = [];
  for (const [i, entry] of entries.entries()) {
    const name = label(entry, i);
    const last = out.at(-1);
    if (name !== null) out.push({ label: name, at: [i] });
    else if (last !== undefined) last.at.push(i);
  }
  return out;
}

/** A step of a scenario: one label, or a range of them, both ends included. */
type Pick = string | [string, string];

/** The entry indices the scenario's steps name; every label must name a step of the golden. */
function chosen(entries: Entry[], picks: Pick[] | "all"): number[] {
  const all = steps(entries);
  if (picks === "all") return all.flatMap((s) => s.at);
  const place = (name: string): number => {
    const i = all.findIndex((s) => s.label === name);
    if (i === -1) throw new Error(`no step ${name}`);
    return i;
  };
  return picks.flatMap((p) => {
    const [from, to] = typeof p === "string" ? [p, p] : p;
    return all.slice(place(from), place(to) + 1).flatMap((s) => s.at);
  });
}

const runs = new Map<string, Promise<[Entry[], Entry[]]>>();

/** A golden's session driven whole and one byte at a time, each run once per golden. */
function driven(name: string, entries: Entry[]): Promise<[Entry[], Entry[]]> {
  const known = runs.get(name);
  if (known !== undefined) return known;
  const script: Step[] = entries
    .slice(1)
    .map((e) => (e.change === undefined ? e.client : { change: e.change }));
  const run = Promise.all([record(script), record(script, true)]);
  runs.set(name, run);
  return run;
}

/** Every server response of the named steps equals the golden, whole and one byte at a time. */
async function matches(name: string, picks: Pick[] | "all"): Promise<void> {
  const entries = golden(name);
  const at = chosen(entries, picks);
  expect(at.length).toBeGreaterThan(0);
  const [whole, bytewise] = await driven(name, entries);
  const want = at.map((i) => entries[i]);
  expect(at.map((i) => whole[i])).toEqual(want);
  expect(at.map((i) => bytewise[i])).toEqual(want);
}

criterion("FR-MAIL-021-c1", () => matches("transcript", ["greeting", "A1"]));
criterion("FR-MAIL-021-c2", () => matches("transcript", ["A3", "A19"]));
criterion("FR-MAIL-021-c3", () => matches("transcript", [["A4", "A6"]]));
criterion("FR-MAIL-021-c4", () => matches("transcript", ["A7"]));
criterion("FR-MAIL-021-c5", () => matches("transcript", [["A16", "A18"]]));
criterion("FR-MAIL-021-c6", () => matches("lockout", "all"));
criterion("FR-MAIL-021-c7", async () => {
  await matches("toobig", "all");
  await matches("longline", "all");
});
criterion("FR-MAIL-021-c8", () => matches("malformed", [["E1", "E35"]]));
criterion("FR-MAIL-021-c9", () => matches("transcript", [["A76", "A78"]]));
criterion("FR-MAIL-021-c10", () => matches("transcript", ["A86", "A87"]));
criterion("FR-MAIL-021-c11", async () => {
  for (const name of [
    "transcript",
    "lockout",
    "toobig",
    "longline",
    "malformed",
    "headers",
    "vanish",
  ]) {
    const entries = golden(name);
    expect(chosen(entries, "all")).toEqual(entries.map((_, i) => i));
    await matches(name, "all");
  }
});

criterion("FR-MAIL-021-c12", async () => {
  await matches("idlelong", "all");
  const [whole, bytewise] = await driven("idlelong", golden("idlelong"));
  expect(whole.at(-1)?.server).toBe("* BYE line too long\r\n");
  expect(bytewise.at(-1)?.server).toBe("* BYE line too long\r\n");
});

criterion("FR-MAIL-021-c13", async () => {
  const down = new Error("the store is down");
  const store = { ...memoryStore(), open: () => Promise.reject(down) };
  const session = createImapSession({ store });
  const send = (line: string) => session.receive(new TextEncoder().encode(line));
  expect(await send('L1 LOGIN sean@rafters.studio "pa ss\\"word"\r\n')).toEqual(
    new TextEncoder().encode(`L1 OK [CAPABILITY ${CAPABILITIES}] LOGIN completed\r\n`),
  );
  await expect(send("L2 SELECT INBOX\r\n")).rejects.toBe(down);
  await expect(send("L3 NOOP\r\n")).rejects.toBe(down);
});

criterion("FR-MAIL-022-c1", () => matches("transcript", [["A8", "A12"]]));
criterion("FR-MAIL-022-c2", () => matches("transcript", [["A13", "A15"], "A69", "A83"]));
criterion("FR-MAIL-022-c3", () => matches("transcript", ["A20", "A21", "A27", "A80"]));
criterion("FR-MAIL-022-c4", () => matches("transcript", [["A22", "A25"]]));
criterion("FR-MAIL-022-c5", () => matches("transcript", ["A26", "A79", "A81", "A82"]));
criterion("FR-MAIL-022-c6", () =>
  matches("transcript", ["the change flag-2", "A65", "A70", "the change expunge-6", "A71", "A72"]),
);
criterion("FR-MAIL-022-c7", () => matches("vanish", "all"));

criterion("FR-MAIL-023-c1", () => matches("transcript", [["A28", "A30"]]));
criterion("FR-MAIL-023-c2", () => matches("transcript", [["A31", "A33"], "A38"]));
criterion("FR-MAIL-023-c3", () => matches("transcript", ["A34", "A36", "A37"]));
criterion("FR-MAIL-023-c4", () => matches("transcript", ["A35", "A40"]));
criterion("FR-MAIL-023-c5", () => matches("transcript", ["A39"]));
criterion("FR-MAIL-023-c6", () => matches("headers", "all"));

criterion("FR-MAIL-024-c1", () => matches("transcript", [["A41", "A47"]]));
criterion("FR-MAIL-024-c2", () => matches("transcript", ["A48"]));
criterion("FR-MAIL-024-c3", () => matches("transcript", [["A49", "A64"]]));
criterion("FR-MAIL-024-c4", () => matches("transcript", [["A66", "A68"]]));
criterion("FR-MAIL-024-c5", () =>
  matches("transcript", ["A73", "the change idle", "DONE", "A74", "A75"]),
);
