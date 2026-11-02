import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, vi } from "vitest";
import { z } from "zod";
import { criterion } from "./criterion.ts";
import {
  CAPABILITIES,
  createImapSession,
  type ImapSession,
  type ImapStore,
} from "../src/imap/index.ts";
import { ranges, unranges } from "../src/imap/snapshot.ts";
import { binary } from "../src/read/index.ts";
import { latin1, record, type Entry, type Step } from "./imap/record.ts";
import { memoryStore } from "./imap/store.ts";

// FR-MAIL-033-c1 and c6 resume or snapshot after every byte of a 70,000 byte line.
vi.setConfig({ testTimeout: 60_000 });

const GOLDENS = new URL("./fixtures/imap/", import.meta.url);

const goldenSchema = z.array(
  z.strictObject({ client: z.string(), server: z.string(), change: z.string().optional() }),
);

/** One golden transcript of research 01a19b9a, its first entry the greeting. */
function golden(name: string): Entry[] {
  return goldenSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, GOLDENS), "utf8")));
}

/** All eight goldens of research 01a19b9a. */
const EIGHT = [
  "transcript",
  "lockout",
  "toobig",
  "longline",
  "malformed",
  "headers",
  "vanish",
  "idlelong",
];

/** What a golden's client does, after the greeting. */
const scriptOf = (entries: Entry[]): Step[] =>
  entries.slice(1).map((e) => (e.change === undefined ? e.client : { change: e.change }));

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
  const script = scriptOf(entries);
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

const LOGIN = 'L1 LOGIN sean@rafters.studio "pa ss\\"word"\r\n';

/** A session past LOGIN and the given commands, over `store`. */
async function after(store: ImapStore, ...lines: string[]): Promise<ImapSession> {
  const session = createImapSession({ store });
  for (const line of [LOGIN, ...lines]) await session.receive(latin1(line));
  return session;
}

/** A store whose INBOX is `messages`, one for each flag list given. */
function shaped(flags: (i: number) => string[], count: number): ImapStore {
  const messages = Array.from({ length: count }, (_, i) => ({
    uid: i + 1,
    flags: flags(i),
    internalDate: new Date(0),
    size: 1,
  }));
  return {
    ...memoryStore(),
    open: async () => ({ uidValidity: 1, uidNext: count + 1, messages }),
  };
}

criterion("FR-MAIL-033-c1", async () => {
  for (const name of EIGHT) {
    const entries = golden(name);
    expect(await record(scriptOf(entries), false, true), name).toEqual(entries);
    expect(await record(scriptOf(entries), true, true), name).toEqual(entries);
  }
});

criterion("FR-MAIL-033-c2", async () => {
  const store = memoryStore();
  const saved = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
  await store.expunge("acct-sean", "INBOX", [1]);
  const resumed = createImapSession({ store, resume: saved });
  expect(binary(await resumed.receive(latin1("S2 FETCH 1 (UID)\r\n")))).toBe(
    "* 1 FETCH (UID 1)\r\nS2 OK FETCH completed\r\n",
  );
  await resumed.changed();
  expect(binary(await resumed.receive(latin1("S3 NOOP\r\n")))).toBe(
    "* 1 EXPUNGE\r\nS3 OK NOOP completed\r\n",
  );
});

criterion("FR-MAIL-033-c3", async () => {
  const store = memoryStore();
  const saved = (await after(store, "S1 SELECT INBOX\r\n", "S2 IDLE\r\n")).snapshot();
  store.other("idle");
  const resumed = createImapSession({ store, resume: saved });
  expect(binary(await resumed.changed())).toBe(
    "* 3 EXPUNGE\r\n* 1 FETCH (FLAGS (\\Flagged))\r\n* 6 EXISTS\r\n",
  );
  expect(binary(await resumed.receive(latin1("DONE\r\n")))).toBe("S2 OK IDLE terminated\r\n");
});

criterion("FR-MAIL-033-c4", async () => {
  const store = memoryStore();
  const phases = [
    createImapSession({ store }),
    await after(store),
    await after(store, "S1 SELECT INBOX\r\n"),
    await after(store, "S1 SELECT INBOX\r\n", "S2 IDLE\r\n"),
    await after(store, "S1 LOGOUT\r\n"),
  ].map((s) => s.snapshot());
  expect(phases.map((s) => s.phase.name)).toEqual([
    "not-authenticated",
    "authenticated",
    "selected",
    "idling",
    "logged-out",
  ]);
  for (const resume of phases) {
    const resumed = createImapSession({ store, resume });
    expect(resumed.closed()).toBe(resume.phase.name === "logged-out");
    expect(await resumed.receive(new Uint8Array(0))).toEqual(new Uint8Array(0));
    expect(resumed.closed()).toBe(resume.phase.name === "logged-out");
  }
});

criterion("FR-MAIL-033-c5", async () => {
  const store = memoryStore();
  const saved = (
    await after(store, "S1 SELECT INBOX\r\n", "S2 STORE 2 +FLAGS (\\Seen)\r\n")
  ).snapshot();
  await store.setFlags("acct-sean", "INBOX", 2, ["\\Flagged"]);
  await store.setFlags("acct-sean", "INBOX", 3, ["\\Answered"]);
  const resumed = createImapSession({ store, resume: saved });
  await resumed.changed();
  expect(binary(await resumed.receive(latin1("S3 NOOP\r\n")))).toBe(
    "* 2 FETCH (FLAGS (\\Flagged))\r\n* 3 FETCH (FLAGS (\\Answered))\r\nS3 OK NOOP completed\r\n",
  );
});

criterion("FR-MAIL-033-c6", async () => {
  const user = "sean@rafters.studio";
  const secret = 'pa ss"word';
  const logins = [
    LOGIN,
    `L1 LOGIN {${user.length}}\r\n${user} {${secret.length}}\r\n${secret}\r\n`,
    `L1 LOGIN {${user.length}+}\r\n${user} {${secret.length}+}\r\n${secret}\r\n`,
    `L1 LOGIN ${user} "pa ss\\"word${"x".repeat(70_000)}`,
    `L1 LOGIN ${user} {${secret.length}}\r\n${secret}${"x".repeat(70_000)}`,
  ];
  for (const login of logins) {
    const session = createImapSession({ store: memoryStore() });
    for (const c of login) {
      await session.receive(latin1(c));
      const saved = session.snapshot();
      if (saved.phase.name === "not-authenticated") {
        expect(saved.buffer).toBe("");
        expect(saved.granted).toBe(0);
      }
      const written = JSON.stringify(saved);
      for (const part of ["pa ", "ss\\", "word"]) expect(written).not.toContain(part);
    }
    expect(session.snapshot().phase.name).not.toBe("not-authenticated");
  }
});

criterion("FR-MAIL-033-c7", async () => {
  const out = await after(memoryStore(), "S1 LOGOUT\r\nS2 NOOP\r\n");
  const fatal = createImapSession({ store: memoryStore() });
  await fatal.receive(latin1(`S1 NOOP ${"x".repeat(70_000)}`));
  for (const session of [out, fatal]) {
    expect(session.closed()).toBe(true);
    expect(session.snapshot().phase).toEqual({ name: "logged-out" });
    expect(session.snapshot().buffer).toBe("");
  }
});

criterion("FR-MAIL-033-c8", async () => {
  const size = async (store: ImapStore): Promise<number> =>
    JSON.stringify((await after(store, "S1 SELECT INBOX\r\n")).snapshot()).length;
  expect(await size(shaped(() => [], 100_000))).toBeLessThan(1 << 10);
  expect(await size(shaped((i) => (i % 2 === 0 ? ["\\Seen"] : []), 100_000))).toBeLessThan(1 << 20);
});

criterion("FR-MAIL-033-c9", () => {
  for (const list of [[], [7], [1, 2, 3, 4], [1, 3, 4, 9, 20, 21, 22]]) {
    expect(unranges(ranges(list))).toEqual(list);
  }
  expect(ranges([1, 2, 3, 7])).toEqual([
    [1, 3],
    [7, 7],
  ]);
});

criterion("FR-MAIL-033-c10", async () => {
  const store = memoryStore();
  const selected = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
  const wrongVersion = { ...selected, v: 2 };
  const tagged = { ...selected, phase: { ...selected.phase, tag: "S2" } };
  expect(() => createImapSession({ store, resume: wrongVersion })).toThrow(z.ZodError);
  expect(() => createImapSession({ store, resume: tagged })).toThrow(z.ZodError);
});

criterion("FR-MAIL-033-c11", async () => {
  const store = memoryStore();
  const resume = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
  const short = { ...store, held: async () => [] };
  const resumed = createImapSession({ store: short, resume });
  await expect(resumed.receive(latin1("S2 NOOP\r\n"))).rejects.toThrow(RangeError);
  await expect(resumed.receive(latin1("S3 NOOP\r\n"))).rejects.toThrow(RangeError);
});

criterion("FR-MAIL-033-c12", async () => {
  const store = memoryStore();
  const entered = Promise.withResolvers<void>();
  const open = Promise.withResolvers<void>();
  const gated: ImapStore = {
    ...store,
    open: async (account, mailbox) => {
      entered.resolve();
      await open.promise;
      return store.open(account, mailbox);
    },
  };
  const session = await after(gated);
  const finished = session.snapshot();
  // S2 is still in the live buffer while S1 waits on the store, so a live reading would show it.
  const queued = session.receive(latin1("S1 SELECT INBOX\r\nS2 NOOP\r\n"));
  await entered.promise;
  expect(session.snapshot()).toEqual(finished);
  open.resolve();
  await queued;
  const selected = session.snapshot();
  expect(selected.phase.name).toBe("selected");
  const resumed = createImapSession({ store, resume: selected });
  expect(resumed.snapshot()).toEqual(selected);
});

criterion("FR-MAIL-033-c13", async () => {
  const whole = createImapSession({ store: memoryStore() });
  const answer = binary(await whole.receive(latin1("N NOOP\r\n".repeat(200_000))));
  expect(answer).toBe("N OK NOOP completed\r\n".repeat(200_000));
  expect(whole.closed()).toBe(false);

  const literal = `{${1 << 19}+}\r\n${"x".repeat(1 << 19)} `;
  const many = createImapSession({ store: memoryStore() });
  expect(binary(await many.receive(latin1(`M LIST ${literal.repeat(3)}`)))).toBe(
    "* BYE command too long\r\n",
  );
  expect(many.closed()).toBe(true);
  expect(many.snapshot().buffer).toBe("");
});

criterion("FR-MAIL-046-c4", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--max-old-space-size=50",
    new URL("heap-octets.ts", import.meta.url).pathname,
  ]);
  expect(stdout).toBe("equal\n");
});

criterion("FR-MAIL-046-c5", async () => {
  for (const name of EIGHT) {
    const entries = golden(name);
    const [whole, bytewise] = await driven(name, entries);
    expect(whole, name).toEqual(entries);
    expect(bytewise, name).toEqual(entries);
    expect(await record(scriptOf(entries), false, true), name).toEqual(entries);
    expect(await record(scriptOf(entries), true, true), name).toEqual(entries);
  }
});
