// The mailbox object on node:sqlite behind its structural types, refusing more than 100 parameters
// and 2 MB values as Durable Object SQLite does (FR-MAIL-034).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";
import { z } from "zod";
import { criterion } from "../../core/tests/criterion.ts";
import { createImapSession, type ImapSession as Core } from "../../core/src/imap/index.ts";
import { clock } from "./clock.ts";
import { expire, pending } from "./deadline.ts";
import {
  box,
  gate,
  held,
  idAt,
  ImapMailbox,
  mail,
  type Mailbox,
  UpgradeResponse,
  world,
} from "./imap-world.ts";

const T = 0x019cafbf0000 + 600_000 + 1000;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A session with a real serial queue over createImapSession, its store the mailbox object. */
function queued(object: Mailbox, name: string): Core {
  return createImapSession({
    store: {
      login: async () => "account",
      mailboxes: async () => ["INBOX"],
      open: (_a, mailbox) => object.open(mailbox, name),
      held: (_a, _m, uids) => object.held(uids),
      bytes: (_a, _m, uid) => object.bytes(uid),
      setFlags: (_a, _m, uid, flags) => object.setFlags(uid, flags),
      expunge: (_a, _m, uids) => object.expunge(uids),
    },
  });
}

const octets = (line: string) => new TextEncoder().encode(line);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  clock.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

criterion("FR-MAIL-034-c1", async () => {
  const b = box();
  b.deliver(idAt(T, 1), mail("one@x"));
  b.deliver(idAt(T + 1, 2), mail("two@x"));
  await b.object.ping();
  expect(await b.uids()).toEqual([1, 2]);
  await b.object.expunge([2]);
  b.deliver(idAt(T + 2, 3), mail("three@x"));
  await b.object.ping();
  const opened = await b.object.open("INBOX", "reader");
  expect(opened?.messages.map((m) => m.uid)).toEqual([1, 3]);
  expect(opened?.uidNext).toBe(4);
});

criterion("FR-MAIL-034-c2", async () => {
  const b = box();
  b.deliver(idAt(T + 5000, 2), mail("later@x"));
  await b.object.ping();
  b.deliver(idAt(T, 1), mail("earlier@x"));
  await b.object.ping();
  expect(b.rows("SELECT delivery FROM messages ORDER BY uid").map((r) => r["delivery"])).toEqual([
    idAt(T + 5000, 2),
    idAt(T, 1),
  ]);
});

criterion("FR-MAIL-034-c3", async () => {
  const b = box();
  b.deliver(idAt(T), mail("base@x"));
  await b.object.ping();
  const cursor = () => String(b.rows("SELECT v FROM meta WHERE k = 'cursor'")[0]?.["v"]);
  const before = cursor();
  expect(before).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}$/);
  const ahead = idAt(T - 600_000 + 5000, 9);
  expect(ahead.slice(0, 8)).toBe(before.slice(0, 8));
  b.deliver(ahead, mail("ahead@x"));
  await b.object.ping();
  expect(await b.uids()).toEqual([1, 2]);
  expect(cursor()).toBe(before);
});

criterion("FR-MAIL-034-c4", async () => {
  const b = box();
  b.deliver(idAt(T, 1), mail("held@x"));
  b.deliver(idAt(T + 1, 2), mail("gone@x"));
  await b.object.ping();
  await b.object.expunge([2]);
  b.deliver(idAt(T + 2, 3), mail("held@x"));
  b.deliver(idAt(T + 3, 4), mail("gone@x"));
  await b.object.ping();
  expect(b.rows("SELECT uid FROM messages")).toHaveLength(2);
  expect(b.rows("SELECT delivery, reason, message_id FROM skipped ORDER BY delivery")).toEqual([
    { delivery: idAt(T + 2, 3), reason: "held-message-id", message_id: "held@x" },
    { delivery: idAt(T + 3, 4), reason: "held-message-id", message_id: "gone@x" },
  ]);
});

criterion("FR-MAIL-034-c5", async () => {
  const b = box();
  const long = `${"a".repeat(1000)}@x`;
  b.deliver(idAt(T, 1), mail());
  b.deliver(idAt(T + 1, 2), mail());
  b.deliver(idAt(T + 2, 3), mail(long));
  b.deliver(idAt(T + 3, 4), mail(long));
  await b.object.ping();
  expect(await b.uids()).toEqual([1, 2, 3, 4]);
  expect(b.rows("SELECT message_id FROM messages WHERE message_id IS NOT NULL")).toEqual([]);
  expect(b.rows("SELECT * FROM skipped")).toEqual([]);
});

criterion("FR-MAIL-034-c6", async () => {
  const b = box();
  b.deliver(idAt(T, 1), null);
  b.deliver(idAt(T + 1, 2), mail("after@x"));
  await b.object.ping();
  expect(b.rows("SELECT delivery, reason FROM skipped")).toEqual([
    { delivery: idAt(T, 1), reason: "no-blob" },
  ]);
  expect(await b.uids()).toEqual([1]);
  expect(console.error).toHaveBeenCalled();
});

criterion("FR-MAIL-034-c7", async () => {
  const b = box();
  b.state.mem.hook.refuse = (sql, values) =>
    sql.includes("INTO messages") && values.includes(idAt(T, 1));
  b.deliver(idAt(T, 1), mail("bad@x"));
  b.deliver(idAt(T + 1, 2), mail("after@x"));
  await b.object.ping();
  expect(b.rows("SELECT delivery, reason FROM skipped")).toEqual([
    { delivery: idAt(T, 1), reason: "unreadable" },
  ]);
  expect(b.rows("SELECT delivery FROM messages")).toEqual([{ delivery: idAt(T + 1, 2) }]);
});

criterion("FR-MAIL-034-c8", async () => {
  const b = box();
  const held = gate();
  b.hold.blob = () => held.promise;
  b.deliver(idAt(T, 1), mail());
  const first = b.object.ping();
  const second = b.object.ping();
  // The ping's row commits while the first pull waits on R2.
  b.deliver(idAt(T + 1, 2), mail());
  const third = b.object.ping();
  held.open();
  await Promise.all([first, second, third]);
  expect(b.rows("SELECT delivery FROM messages ORDER BY delivery")).toEqual([
    { delivery: idAt(T, 1) },
    { delivery: idAt(T + 1, 2) },
  ]);
});

criterion("FR-MAIL-034-c9", async () => {
  // A tell every session has yet to answer: each call returns anyway.
  const release = gate();
  const sessions = new Map<string, Core>();
  const b = box(async (name) => {
    await release.promise;
    return sessions.get(name)?.changed();
  });
  b.deliver(idAt(T, 1), mail("one@x"));
  const idling = queued(b.object, "idler");
  sessions.set("idler", idling);
  await idling.receive(octets("a LOGIN u p\r\nb SELECT INBOX\r\nc IDLE\r\n"));
  b.deliver(idAt(T + 1, 2), mail("two@x"));
  await b.object.open("INBOX", "reader");
  b.deliver(idAt(T + 2, 3), mail("three@x"));
  await b.object.ping();
  await b.object.setFlags(1, ["\\Seen"]);
  release.open();
  await b.state.settled();
  // No gate: a tell reaches the queue of a session whose receive is waiting on the pull that told.
  const direct = new Map<string, Core>();
  const live = box(async (name) => direct.get(name)?.changed());
  const busy = queued(live.object, "busy");
  const idler = queued(live.object, "idler");
  direct.set("busy", busy);
  direct.set("idler", idler);
  await busy.receive(octets("a LOGIN u p\r\n"));
  await idler.receive(octets("a LOGIN u p\r\nb SELECT INBOX\r\nc IDLE\r\n"));
  live.deliver(idAt(T, 1), mail("one@x"));
  await busy.receive(octets("b SELECT INBOX\r\n"));
  await live.state.settled();
  expect(new TextDecoder().decode(await idler.changed())).toBe("");
});

criterion("FR-MAIL-034-c10", async () => {
  vi.stubGlobal("Response", UpgradeResponse);
  const w = world();
  const idler = await w.connect();
  const other = await w.connect();
  const login = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
  await idler.frame(login);
  await idler.frame("b SELECT INBOX\r\n");
  await idler.frame("c IDLE\r\n");
  await other.frame(login);
  w.deliver(idAt(T, 1), mail("new@x"));
  await other.frame("b SELECT INBOX\r\n");
  await w.mailboxState.settled();
  expect(idler.server.text()).toContain("* 1 EXISTS");
});

criterion("FR-MAIL-034-c11", async () => {
  const hold = { answer: async (): Promise<unknown> => true };
  const b = box(() => hold.answer());
  b.deliver(idAt(T, 1), mail("one@x"));
  await b.object.open("INBOX", "first");
  await b.object.open("INBOX", "second");
  await b.state.settled();
  b.told.length = 0;
  await b.object.setFlags(1, ["\\Seen"]);
  await b.state.settled();
  expect(b.told.sort()).toEqual(["first", "second"]);
  b.told.length = 0;
  await b.object.expunge([1]);
  await b.state.settled();
  expect(b.told.sort()).toEqual(["first", "second"]);
  b.told.length = 0;
  await b.object.expunge([]);
  await b.state.settled();
  expect(b.told).toEqual([]);
  // A burst during a pass makes one more pass, and that pass settles what is owed.
  const release = gate<unknown>();
  hold.answer = () => release.promise;
  await b.object.setFlags(1, ["\\Flagged"]);
  await b.object.setFlags(1, ["\\Seen"]);
  await b.object.setFlags(1, ["\\Draft"]);
  hold.answer = async () => true;
  release.open(true);
  await b.state.settled();
  expect(b.told).toHaveLength(4);
  expect(b.rows("SELECT v FROM meta WHERE k = 'tell-owed'")).toEqual([]);
  // The same three from a real client, through its session object: STORE, EXPUNGE, and the CLOSE
  // that sends an empty list.
  vi.stubGlobal("Response", UpgradeResponse);
  const w = world();
  w.deliver(idAt(T, 1), mail("one@x"));
  const login = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
  const client = await w.connect();
  const watcher = await w.connect();
  for (const c of [client, watcher]) {
    await c.frame(login);
    await c.frame("b SELECT INBOX\r\n");
  }
  await w.mailboxState.settled();
  await watcher.frame("c IDLE\r\n");
  await client.frame("d STORE 1 +FLAGS (\\Deleted)\r\n");
  await w.mailboxState.settled();
  expect(watcher.server.text()).toContain("* 1 FETCH (FLAGS (\\Deleted))");
  await client.frame("e EXPUNGE\r\n");
  await w.mailboxState.settled();
  expect(watcher.server.text()).toContain("* 1 EXPUNGE");
  const before = w.mailboxState.waits.length;
  await client.frame("f CLOSE\r\n");
  expect(w.mailboxState.waits).toHaveLength(before);
});

criterion("FR-MAIL-034-c12", async () => {
  const answers = new Map<string, () => Promise<unknown>>([
    ["forgotten", async () => false],
    ["rejecting", () => Promise.reject(new Error("refused"))],
    ["silent", () => new Promise(() => {})],
    ["healthy", async () => true],
  ]);
  const b = box((name) => answers.get(name)?.() ?? Promise.resolve(true), held.ImapMailbox);
  for (const name of answers.keys()) await b.object.open("INBOX", name);
  b.deliver(idAt(T, 1), mail("one@x"));
  await b.object.ping();
  const work = b.state.settled();
  await new Promise((resolve) => setImmediate(resolve));
  expect(b.told.sort()).toEqual(["forgotten", "healthy", "rejecting", "silent"]);
  expect(pending("tell")).toEqual([{ ms: 10_000, reason: "no answer in 10 seconds" }]);
  expire("tell");
  await work;
  expect(b.rows("SELECT name FROM sessions ORDER BY name").map((r) => r["name"])).toEqual([
    "healthy",
    "rejecting",
    "silent",
  ]);
  const lines = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
  expect(lines.filter((line) => line.includes("telling rejecting"))).toHaveLength(1);
  expect(lines.filter((line) => line.includes("telling silent"))).toHaveLength(1);
  expect(b.rows("SELECT v FROM meta WHERE k = 'tell-owed'")).toHaveLength(1);
});

criterion("FR-MAIL-034-c13", async () => {
  const b = box();
  await b.object.open("INBOX", "first");
  await b.object.open("INBOX", "second");
  // What a commit leaves behind when the object is evicted before its tell runs.
  b.state.mem.sql.exec("INSERT INTO meta (k, v) VALUES ('tell-owed', '1')");
  const woken: Mailbox = new ImapMailbox(b.state.ctx, b.env);
  await woken.alarm();
  await b.state.settled();
  expect(b.told.sort()).toEqual(["first", "second"]);
  expect(b.rows("SELECT v FROM meta WHERE k = 'tell-owed'")).toEqual([]);
});

criterion("FR-MAIL-034-c14", async () => {
  const b = box();
  await b.object.open("INBOX", "first");
  b.state.alarm.at = null;
  const broken = new ImapMailbox(b.state.ctx, {
    ...b.env,
    MAIL_DB: {
      prepare: () => {
        throw new Error("D1 is out");
      },
    },
  });
  await broken.alarm();
  expect(b.state.alarm.at).not.toBeNull();
  expect(console.error).toHaveBeenCalledWith("imap mailbox: pull failed", expect.any(Error));
});

criterion("FR-MAIL-034-c15", async () => {
  const b = box();
  await b.object.open("INBOX", "first");
  b.deliver(idAt(T, 1), mail("one@x"));
  await b.object.alarm();
  await b.state.settled();
  expect(b.rows("SELECT uid FROM messages")).toHaveLength(1);
  expect(new Set(b.told)).toEqual(new Set(["first"]));
  // With nobody registered the chain ends, and the pull still runs.
  const alone = box();
  alone.deliver(idAt(T, 1), mail("one@x"));
  await alone.object.alarm();
  expect(alone.state.alarm.at).toBeNull();
  expect(alone.rows("SELECT uid FROM messages")).toHaveLength(1);
});

criterion("FR-MAIL-034-c16", async () => {
  const b = box();
  b.deliver(idAt(T, 1), mail("one@x", "the body"));
  await b.object.ping();
  await b.object.expunge([1]);
  expect((await b.object.held([1])).map((m) => m.uid)).toEqual([1]);
  const bytes = await b.object.bytes(1);
  expect(text(bytes ?? new Uint8Array())).toContain("the body");
  expect(await b.uids()).toEqual([]);
  // A row or a blob that is not there is not an error here: the session decides what that means.
  expect(await b.object.bytes(99)).toBeNull();
  b.blobs.clear();
  expect(await b.object.bytes(1)).toBeNull();
});

criterion("FR-MAIL-034-c17", async () => {
  const b = box();
  for (let i = 0; i < 101; i++) b.deliver(idAt(T + i, i), mail());
  await b.object.ping();
  const named = Array.from({ length: 101 }, (_, i) => 101 - i);
  const held = await b.object.held(named);
  expect(held.map((m) => m.uid)).toEqual(named);
  expect(held[0]?.internalDate).toEqual(new Date("2026-03-02T17:00:00.000Z"));
  expect(() => b.state.mem.sql.exec("SELECT 1", ...named)).toThrow("too many SQL variables");
  expect(() => b.state.mem.sql.exec("SELECT ?", "x".repeat(2 * 1024 * 1024 + 1))).toThrow(
    "too big",
  );
});

criterion("FR-MAIL-034-c18", async () => {
  vi.stubGlobal("Response", UpgradeResponse);
  const b = box();
  expect(await b.object.open("Trash", "first")).toBeNull();
  expect(b.rows("SELECT name FROM sessions")).toEqual([]);
  const opened = await b.object.open("INBOX", "first");
  expect(opened).toMatchObject({ uidNext: 1, messages: [] });
  const w = world();
  const client = await w.connect();
  await client.frame('a LOGIN sean@rafters.studio "correct horse"\r\n');
  await client.frame('b LIST "" "*"\r\n');
  expect(client.server.text()).toMatch(/\* LIST \(\) "\/" "?INBOX"?\r\n/);
  expect(client.server.text().match(/\* LIST/g)).toHaveLength(1);
  await client.frame("c SELECT Trash\r\n");
  expect(client.server.text()).toContain("c NO");
  expect(client.server.closes).toEqual([]);
});

criterion("FR-MAIL-034-c19", async () => {
  clock.set(Date.parse("2026-03-02T17:00:00Z"));
  const first = box();
  const before = (await first.object.open("INBOX", "s"))?.uidValidity;
  clock.set(Date.parse("2026-03-02T18:00:00Z"));
  const woken: Mailbox = new ImapMailbox(first.state.ctx, first.env);
  expect((await woken.open("INBOX", "s"))?.uidValidity).toBe(before);
  const fresh = box();
  expect((await fresh.object.open("INBOX", "s"))?.uidValidity).toBeGreaterThan(Number(before));
});

criterion(
  "FR-MAIL-045-c4",
  async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--max-old-space-size=128",
      new URL("heap-pull.ts", import.meta.url).pathname,
    ]);
    expect(JSON.parse(stdout)).toEqual([
      "fields@x.test",
      "folded@x.test",
      "parts@x.test",
      "good@x",
    ]);
  },
  60_000,
);

const heapFetch = z.object({
  total: z.number(),
  results: z.array(
    z.object({ item: z.string(), completed: z.boolean(), size: z.number(), leading: z.boolean() }),
  ),
});

/** The real session over the real mailbox object, in a child process with a 128 MB heap. */
async function fetchUnderHeapLimit(shape: string, items: string[]) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--max-old-space-size=128",
    new URL("heap-fetch.ts", import.meta.url).pathname,
    shape,
    ...items,
  ]);
  return heapFetch.parse(JSON.parse(stdout));
}

criterion(
  "FR-MAIL-046-c1",
  async () => {
    const { total, results } = await fetchUnderHeapLimit("plain", ["BODY[]"]);
    expect(total).toBeGreaterThanOrEqual(25 * 1024 * 1024);
    expect(results).toEqual([{ item: "BODY[]", completed: true, size: total, leading: true }]);
  },
  60_000,
);

criterion(
  "FR-MAIL-046-c2",
  async () => {
    for (const shape of ["fields", "folded", "parts", "empty"]) {
      const { total, results } = await fetchUnderHeapLimit(shape, ["BODY[]"]);
      expect(results, shape).toEqual([
        { item: "BODY[]", completed: true, size: total, leading: true },
      ]);
    }
  },
  60_000,
);

criterion(
  "FR-MAIL-046-c3",
  async () => {
    const asked = [
      "BODYSTRUCTURE",
      "ENVELOPE",
      "RFC822.SIZE",
      "BODY.PEEK[HEADER]",
      "BODY.PEEK[1]",
      "BODY.PEEK[]<0.65536>",
    ];
    const { results } = await fetchUnderHeapLimit("attachment", asked);
    expect(results.map((r) => r.item)).toEqual(asked);
    for (const r of results) expect(r.completed, r.item).toBe(true);
    expect(results.at(-1)).toMatchObject({ size: 65536, leading: true });
  },
  60_000,
);

const heapPeak = z.object({
  item: z.string(),
  peak: z.number(),
  completed: z.boolean(),
  size: z.number(),
  same: z.boolean(),
});

/** The real session over the real mailbox object in a child process, with the peak it sampled. */
async function peakOf(shape: string, item: string) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--expose-gc",
    new URL("heap-peak.ts", import.meta.url).pathname,
    shape,
    item,
  ]);
  return heapPeak.parse(JSON.parse(stdout));
}

criterion(
  "FR-MAIL-047-c2",
  async () => {
    const asked: [string, string][] = [
      ["plain", "BODY.PEEK[]"],
      ["attachment", "BODY.PEEK[]"],
      ["attachment", "BODY.PEEK[2]"],
    ];
    for (const [shape, item] of asked) {
      const { peak, completed, size, same } = await peakOf(shape, item);
      const named = `${shape} ${item}`;
      expect(completed, named).toBe(true);
      expect(same, named).toBe(true);
      expect(size, named).toBeGreaterThanOrEqual(25 * 1024 * 1024);
      expect(peak, named).toBeLessThan(100_000_000);
    }
  },
  120_000,
);
