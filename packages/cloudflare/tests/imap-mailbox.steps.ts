// The mailbox object on node:sqlite behind its structural types, refusing more than 100 parameters
// and 2 MB values as Durable Object SQLite does (FR-MAIL-034).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { z } from "zod";
import { feature, owns } from "../../core/tests/feature.ts";
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

// A 25 MiB message read in a child process takes seconds, and sampling its peak the longest.
vi.setConfig({ testTimeout: 120_000 });

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

type Box = ReturnType<typeof box>;

const FR034 = await feature("FR-MAIL-034");
const FR045 = await feature("FR-MAIL-045");
const FR046 = await feature("FR-MAIL-046");
const FR047 = await feature("FR-MAIL-047");

describeFeature(
  FR034,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      clock.reset();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario("UIDs rise and are never reused", ({ Given, When, Then }) => {
      let b: Box;

      Given("messages pulled, one expunged, and more pulled", () => {
        b = box();
      });

      When("the rows are read", () => {
        // The pulls and the reads interleave with the Then's expect lines, so they run there.
      });

      Then(
        "every UID is greater than the last and the expunged UID does not come back",
        async () => {
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
        },
      );
    });

    Scenario(
      "A delivery committing behind the newest id is still pulled",
      ({ Given, When, Then }) => {
        let b: Box;

        Given(
          "a delivery with a later id pulled first, then one with an earlier id committed",
          async () => {
            b = box();
            b.deliver(idAt(T + 5000, 2), mail("later@x"));
            await b.object.ping();
            b.deliver(idAt(T, 1), mail("earlier@x"));
          },
        );

        When("pull runs", async () => {
          await b.object.ping();
        });

        Then("both are in the mailbox", () => {
          expect(
            b.rows("SELECT delivery FROM messages ORDER BY uid").map((r) => r["delivery"]),
          ).toEqual([idAt(T + 5000, 2), idAt(T, 1)]);
        });
      },
    );

    Scenario("A delivery just ahead of the cursor is pulled", ({ Given, When, Then }) => {
      let b: Box;
      let cursor: () => string;
      let before: string;

      Given(
        "the cursor, and a delivery 5 seconds after it sharing its first eight hex digits",
        async () => {
          b = box();
          b.deliver(idAt(T), mail("base@x"));
          await b.object.ping();
          cursor = () => String(b.rows("SELECT v FROM meta WHERE k = 'cursor'")[0]?.["v"]);
          before = cursor();
          expect(before).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}$/);
          const ahead = idAt(T - 600_000 + 5000, 9);
          expect(ahead.slice(0, 8)).toBe(before.slice(0, 8));
          b.deliver(ahead, mail("ahead@x"));
        },
      );

      When("pull runs", async () => {
        await b.object.ping();
      });

      Then("it is in the mailbox, and the cursor is dashed and has not fallen", async () => {
        expect(await b.uids()).toEqual([1, 2]);
        expect(cursor()).toBe(before);
      });
    });

    Scenario(
      "A repeated Message-ID adds no message and leaves a record",
      ({ Given, When, Then }) => {
        let b: Box;

        Given("a held Message-ID and an expunged one, delivered again", async () => {
          b = box();
          b.deliver(idAt(T, 1), mail("held@x"));
          b.deliver(idAt(T + 1, 2), mail("gone@x"));
          await b.object.ping();
          await b.object.expunge([2]);
          b.deliver(idAt(T + 2, 3), mail("held@x"));
          b.deliver(idAt(T + 3, 4), mail("gone@x"));
        });

        When("pull runs", async () => {
          await b.object.ping();
        });

        Then("no UID is added and each has a skipped row as held-message-id", () => {
          expect(b.rows("SELECT uid FROM messages")).toHaveLength(2);
          expect(
            b.rows("SELECT delivery, reason, message_id FROM skipped ORDER BY delivery"),
          ).toEqual([
            { delivery: idAt(T + 2, 3), reason: "held-message-id", message_id: "held@x" },
            { delivery: idAt(T + 3, 4), reason: "held-message-id", message_id: "gone@x" },
          ]);
        });
      },
    );

    Scenario(
      "A message with no Message-ID is always added, and an oversized one counts as none",
      ({ Given, When, Then }) => {
        let b: Box;

        Given("two deliveries with no Message-ID, and two with one over 998 octets", () => {
          b = box();
          const long = `${"a".repeat(1000)}@x`;
          b.deliver(idAt(T, 1), mail());
          b.deliver(idAt(T + 1, 2), mail());
          b.deliver(idAt(T + 2, 3), mail(long));
          b.deliver(idAt(T + 3, 4), mail(long));
        });

        When("pull runs", async () => {
          await b.object.ping();
        });

        Then("all four are added", async () => {
          expect(await b.uids()).toEqual([1, 2, 3, 4]);
          expect(b.rows("SELECT message_id FROM messages WHERE message_id IS NOT NULL")).toEqual(
            [],
          );
          expect(b.rows("SELECT * FROM skipped")).toEqual([]);
        });
      },
    );

    Scenario("A blob that is gone stops nothing", ({ Given, When, Then }) => {
      let b: Box;

      Given("a delivery whose blob is gone, and one after it", () => {
        b = box();
        b.deliver(idAt(T, 1), null);
        b.deliver(idAt(T + 1, 2), mail("after@x"));
      });

      When("pull runs", () => {
        // The pull runs inside the Then: Vitest clears mock calls between steps, and console.error is one.
      });

      Then("the first has a skipped row as no-blob and the second is added", async () => {
        await b.object.ping();
        expect(b.rows("SELECT delivery, reason FROM skipped")).toEqual([
          { delivery: idAt(T, 1), reason: "no-blob" },
        ]);
        expect(await b.uids()).toEqual([1]);
        expect(console.error).toHaveBeenCalled();
      });
    });

    Scenario("A row that fails stops nothing", ({ Given, When, Then }) => {
      let b: Box;

      Given("a row that makes the insert throw, and one after it", () => {
        b = box();
        b.state.mem.hook.refuse = (sql, values) =>
          sql.includes("INTO messages") && values.includes(idAt(T, 1));
        b.deliver(idAt(T, 1), mail("bad@x"));
        b.deliver(idAt(T + 1, 2), mail("after@x"));
      });

      When("pull runs", async () => {
        await b.object.ping();
      });

      Then("the first has a skipped row as unreadable and the second is added", () => {
        expect(b.rows("SELECT delivery, reason FROM skipped")).toEqual([
          { delivery: idAt(T, 1), reason: "unreadable" },
        ]);
        expect(b.rows("SELECT delivery FROM messages")).toEqual([{ delivery: idAt(T + 1, 2) }]);
      });
    });

    Scenario("Overlapping pulls add each row once and miss nothing", ({ Given, When, Then }) => {
      let b: Box;

      Given("two pulls at once with no Message-ID, and a ping during a pull", () => {
        b = box();
      });

      When("they finish", async () => {
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
      });

      Then("each row is added once and the ping's row is there", () => {
        expect(b.rows("SELECT delivery FROM messages ORDER BY delivery")).toEqual([
          { delivery: idAt(T, 1) },
          { delivery: idAt(T + 1, 2) },
        ]);
      });
    });

    Scenario("Nothing waits for a tell", ({ Given, When, Then }) => {
      let release: ReturnType<typeof gate<void>>;
      let b: Box;
      let direct: Map<string, Core>;
      let live: Box;
      let busy: Core;
      let idler: Core;

      Given(
        "sessions with a real serial queue over createImapSession, one mid-receive and one in IDLE",
        async () => {
          // A tell every session has yet to answer: each call returns anyway.
          release = gate();
          const sessions = new Map<string, Core>();
          b = box(async (name) => {
            await release.promise;
            return sessions.get(name)?.changed();
          });
          b.deliver(idAt(T, 1), mail("one@x"));
          const idling = queued(b.object, "idler");
          sessions.set("idler", idling);
          await idling.receive(octets("a LOGIN u p\r\nb SELECT INBOX\r\nc IDLE\r\n"));
        },
      );

      When("open, ping and setFlags run", async () => {
        b.deliver(idAt(T + 1, 2), mail("two@x"));
        await b.object.open("INBOX", "reader");
        b.deliver(idAt(T + 2, 3), mail("three@x"));
        await b.object.ping();
        await b.object.setFlags(1, ["\\Seen"]);
        release.open();
        await b.state.settled();
        // No gate: a tell reaches the queue of a session whose receive is waiting on the pull that told.
        direct = new Map<string, Core>();
        live = box(async (name) => direct.get(name)?.changed());
        busy = queued(live.object, "busy");
        idler = queued(live.object, "idler");
        direct.set("busy", busy);
        direct.set("idler", idler);
        await busy.receive(octets("a LOGIN u p\r\n"));
        await idler.receive(octets("a LOGIN u p\r\nb SELECT INBOX\r\nc IDLE\r\n"));
        live.deliver(idAt(T, 1), mail("one@x"));
        await busy.receive(octets("b SELECT INBOX\r\n"));
        await live.state.settled();
      });

      Then("each returns while a tell is outstanding, and no cycle hangs", async () => {
        expect(new TextDecoder().decode(await idler.changed())).toBe("");
      });
    });

    Scenario("A pull that adds a row tells everyone, from any caller", ({ Given, When, Then }) => {
      let w: ReturnType<typeof world>;
      let idler: Awaited<ReturnType<ReturnType<typeof world>["connect"]>>;
      let other: Awaited<ReturnType<ReturnType<typeof world>["connect"]>>;

      Given("a session in IDLE, and another session's open that pulls a new row", async () => {
        vi.stubGlobal("Response", UpgradeResponse);
        w = world();
        idler = await w.connect();
        other = await w.connect();
        const login = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
        await idler.frame(login);
        await idler.frame("b SELECT INBOX\r\n");
        await idler.frame("c IDLE\r\n");
        await other.frame(login);
        w.deliver(idAt(T, 1), mail("new@x"));
      });

      When("the tell finishes", async () => {
        await other.frame("b SELECT INBOX\r\n");
        await w.mailboxState.settled();
      });

      Then("the idler is told", () => {
        expect(idler.server.text()).toContain("* 1 EXISTS");
      });
    });

    Scenario(
      "A flag change and an expunge tell, and an empty expunge does not",
      ({ Given, When, Then }) => {
        let hold: { answer: () => Promise<unknown> };
        let b: Box;

        Given("two sessions", async () => {
          hold = { answer: async (): Promise<unknown> => true };
          b = box(() => hold.answer());
          b.deliver(idAt(T, 1), mail("one@x"));
          await b.object.open("INBOX", "first");
          await b.object.open("INBOX", "second");
          await b.state.settled();
        });

        When("setFlags, expunge and expunge of an empty list run", () => {
          // Each runs inside the Then, between the expect lines that read what it told.
        });

        Then("the first two tell and the last tells nobody", async () => {
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
      },
    );

    Scenario("Telling tolerates a bad session", ({ Given, When, Then }) => {
      let answers: Map<string, () => Promise<unknown>>;
      let b: Box;

      Given(
        "one session answering false, one rejecting, one never settling, one healthy",
        async () => {
          answers = new Map<string, () => Promise<unknown>>([
            ["forgotten", async () => false],
            ["rejecting", () => Promise.reject(new Error("refused"))],
            ["silent", () => new Promise(() => {})],
            ["healthy", async () => true],
          ]);
          b = box((name) => answers.get(name)?.() ?? Promise.resolve(true), held.ImapMailbox);
          for (const name of answers.keys()) await b.object.open("INBOX", name);
          b.deliver(idAt(T, 1), mail("one@x"));
        },
      );

      When("a tell runs", () => {
        // The tell runs inside the Then: Vitest clears mock calls between steps, and console.error is one.
      });

      Then(
        "the first is forgotten, the second kept with a logged line, the third bounded by 10 seconds as a rejection, and the fourth told",
        async () => {
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
        },
      );
    });

    Scenario("A commit with no tell is told by the next alarm", ({ Given, When, Then }) => {
      let b: Box;

      Given("a commit whose tell never ran", async () => {
        b = box();
        await b.object.open("INBOX", "first");
        await b.object.open("INBOX", "second");
        // What a commit leaves behind when the object is evicted before its tell runs.
        b.state.mem.sql.exec("INSERT INTO meta (k, v) VALUES ('tell-owed', '1')");
      });

      When("the alarm fires", async () => {
        const woken: Mailbox = new ImapMailbox(b.state.ctx, b.env);
        await woken.alarm();
        await b.state.settled();
      });

      Then("every session is told and tell-owed is cleared", () => {
        expect(b.told.sort()).toEqual(["first", "second"]);
        expect(b.rows("SELECT v FROM meta WHERE k = 'tell-owed'")).toEqual([]);
      });
    });

    Scenario("A pull that throws leaves an alarm set", ({ Given, When, Then }) => {
      let b: Box;
      let broken: Mailbox;

      Given("a registered session and a pull that throws", async () => {
        b = box();
        await b.object.open("INBOX", "first");
        b.state.alarm.at = null;
        broken = new ImapMailbox(b.state.ctx, {
          ...b.env,
          MAIL_DB: {
            prepare: () => {
              throw new Error("D1 is out");
            },
          },
        });
      });

      When("the alarm fires", () => {
        // The alarm fires inside the Then: Vitest clears mock calls between steps, and console.error is one.
      });

      Then("another alarm is set and the error is logged", async () => {
        await broken.alarm();
        expect(b.state.alarm.at).not.toBeNull();
        expect(console.error).toHaveBeenCalledWith("imap mailbox: pull failed", expect.any(Error));
      });
    });

    Scenario("The alarm finds a delivery no ping announced", ({ Given, When, Then }) => {
      let b: Box;
      let alone: Box;

      Given("a delivery with no ping", async () => {
        b = box();
        await b.object.open("INBOX", "first");
        b.deliver(idAt(T, 1), mail("one@x"));
        // With nobody registered the chain ends, and the pull still runs.
        alone = box();
        alone.deliver(idAt(T, 1), mail("one@x"));
      });

      When("the alarm fires", async () => {
        await b.object.alarm();
        await b.state.settled();
        await alone.object.alarm();
      });

      Then("it is pulled and sessions are told", () => {
        expect(b.rows("SELECT uid FROM messages")).toHaveLength(1);
        expect(new Set(b.told)).toEqual(new Set(["first"]));
        expect(alone.state.alarm.at).toBeNull();
        expect(alone.rows("SELECT uid FROM messages")).toHaveLength(1);
      });
    });

    Scenario("An expunged message stays readable and out of open", ({ Given, When, Then }) => {
      let b: Box;

      Given("an expunged message", async () => {
        b = box();
        b.deliver(idAt(T, 1), mail("one@x", "the body"));
        await b.object.ping();
        await b.object.expunge([1]);
      });

      When("held, bytes and open run", () => {
        // held, bytes and open run inside the Then, wrapped by its expect lines.
      });

      Then("held and bytes give it, and open does not", async () => {
        expect((await b.object.held([1])).map((m) => m.uid)).toEqual([1]);
        const bytes = await b.object.bytes(1);
        expect(text(bytes ?? new Uint8Array())).toContain("the body");
        expect(await b.uids()).toEqual([]);
        // A row or a blob that is not there is not an error here: the session decides what that means.
        expect(await b.object.bytes(99)).toBeNull();
        b.blobs.clear();
        expect(await b.object.bytes(1)).toBeNull();
      });
    });

    Scenario("held takes more than 100 messages", ({ Given, When, Then }) => {
      let b: Box;
      let named: number[];
      let got: Awaited<ReturnType<Mailbox["held"]>>;

      Given(
        "101 messages, and a SQLite wrapper refusing more than 100 parameters and rows over 2 MB",
        async () => {
          b = box();
          for (let i = 0; i < 101; i++) b.deliver(idAt(T + i, i), mail());
          await b.object.ping();
          named = Array.from({ length: 101 }, (_, i) => 101 - i);
        },
      );

      When("held runs", async () => {
        got = await b.object.held(named);
      });

      Then("it returns all 101 in the order named", () => {
        expect(got.map((m) => m.uid)).toEqual(named);
        expect(got[0]?.internalDate).toEqual(new Date("2026-03-02T17:00:00.000Z"));
        expect(() => b.state.mem.sql.exec("SELECT 1", ...named)).toThrow("too many SQL variables");
        expect(() => b.state.mem.sql.exec("SELECT ?", "x".repeat(2 * 1024 * 1024 + 1))).toThrow(
          "too big",
        );
      });
    });

    Scenario("Only INBOX exists", ({ Given, When, Then }) => {
      let b: Box;

      Given("any other mailbox name", () => {
        vi.stubGlobal("Response", UpgradeResponse);
        b = box();
      });

      When("open and mailboxes run", () => {
        // open and LIST run inside the Then, between its expect lines.
      });

      Then("open gives null and mailboxes gives INBOX", async () => {
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
    });

    Scenario("A fresh object has a greater uid_validity", ({ Given, When, Then }) => {
      let first: Box;

      Given("an object created, and a fresh one later on the same mailbox", () => {
        clock.set(Date.parse("2026-03-02T17:00:00Z"));
        first = box();
      });

      When("open runs on each", () => {
        // open runs inside the Then, between its expect lines, as the clock moves.
      });

      Then("the later value is greater, and it never changes within an object", async () => {
        const before = (await first.object.open("INBOX", "s"))?.uidValidity;
        clock.set(Date.parse("2026-03-02T18:00:00Z"));
        const woken: Mailbox = new ImapMailbox(first.state.ctx, first.env);
        expect((await woken.open("INBOX", "s"))?.uidValidity).toBe(before);
        const fresh = box();
        expect((await fresh.object.open("INBOX", "s"))?.uidValidity).toBeGreaterThan(
          Number(before),
        );
      });
    });
  },
  owns(
    "FR-MAIL-034-c1",
    "FR-MAIL-034-c2",
    "FR-MAIL-034-c3",
    "FR-MAIL-034-c4",
    "FR-MAIL-034-c5",
    "FR-MAIL-034-c6",
    "FR-MAIL-034-c7",
    "FR-MAIL-034-c8",
    "FR-MAIL-034-c9",
    "FR-MAIL-034-c10",
    "FR-MAIL-034-c11",
    "FR-MAIL-034-c12",
    "FR-MAIL-034-c13",
    "FR-MAIL-034-c14",
    "FR-MAIL-034-c15",
    "FR-MAIL-034-c16",
    "FR-MAIL-034-c17",
    "FR-MAIL-034-c18",
    "FR-MAIL-034-c19",
  ),
);

describeFeature(
  FR045,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      clock.reset();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario("A hostile message cannot stop a mailbox", ({ Given, When, Then }) => {
      let stdout: string;

      Given("a 25 MiB delivery of each hostile shape, and a good delivery after it", () => {
        // heap-pull.ts delivers each hostile shape and the good delivery in its child process.
      });

      When("the mailbox pulls under a 128 MB heap", async () => {
        ({ stdout } = await promisify(execFile)(process.execPath, [
          "--max-old-space-size=128",
          new URL("heap-pull.ts", import.meta.url).pathname,
        ]));
      });

      Then("the pull finishes, and the good delivery is in the mailbox", () => {
        expect(JSON.parse(stdout)).toEqual([
          "fields@x.test",
          "folded@x.test",
          "parts@x.test",
          "good@x",
        ]);
      });
    });
  },
  owns("FR-MAIL-045-c4"),
);

describeFeature(
  FR046,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      clock.reset();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario("A message at the provider's limit can be read whole", ({ Given, When, Then }) => {
      let fetched: Awaited<ReturnType<typeof fetchUnderHeapLimit>>;

      Given(
        "a child process with a 128 MB heap, the real createImapSession over the real mailbox object, and a 25 MiB message of plain text",
        () => {
          // fetchUnderHeapLimit runs heap-fetch.ts in that child process, on the plain shape.
        },
      );

      When("LOGIN, SELECT and FETCH 1 BODY[] run", async () => {
        fetched = await fetchUnderHeapLimit("plain", ["BODY[]"]);
      });

      Then("the response holds the message byte for byte, and the command completes", () => {
        const { total, results } = fetched;
        expect(total).toBeGreaterThanOrEqual(25 * 1024 * 1024);
        expect(results).toEqual([{ item: "BODY[]", completed: true, size: total, leading: true }]);
      });
    });

    Scenario("Every hostile shape can be read too", ({ Given, When, Then }) => {
      let shapes: string[];

      Given(
        "the same child process, and 25 MiB of many fields, one folded field, millions of parts, and every line empty",
        () => {
          shapes = ["fields", "folded", "parts", "empty"];
        },
      );

      When("FETCH 1 BODY[] runs on each", () => {
        // Each shape is fetched inside the Then, beside the expect line that names it.
      });

      Then("each completes", async () => {
        for (const shape of shapes) {
          const { total, results } = await fetchUnderHeapLimit(shape, ["BODY[]"]);
          expect(results, shape).toEqual([
            { item: "BODY[]", completed: true, size: total, leading: true },
          ]);
        }
      });
    });

    Scenario("The other items a mail app asks for complete", ({ Given, When, Then }) => {
      let asked: string[];
      let results: Awaited<ReturnType<typeof fetchUnderHeapLimit>>["results"];

      Given("the same child process and a 25 MiB message with one large attachment", () => {
        // fetchUnderHeapLimit runs heap-fetch.ts in that child process, on the attachment shape.
      });

      When(
        "FETCH runs for BODYSTRUCTURE, ENVELOPE, RFC822.SIZE, BODY.PEEK[HEADER], BODY.PEEK[1] and BODY.PEEK[]<0.65536>",
        async () => {
          asked = [
            "BODYSTRUCTURE",
            "ENVELOPE",
            "RFC822.SIZE",
            "BODY.PEEK[HEADER]",
            "BODY.PEEK[1]",
            "BODY.PEEK[]<0.65536>",
          ];
          ({ results } = await fetchUnderHeapLimit("attachment", asked));
        },
      );

      Then("each completes, and the partial returns exactly its octets", () => {
        expect(results.map((r) => r.item)).toEqual(asked);
        for (const r of results) expect(r.completed, r.item).toBe(true);
        expect(results.at(-1)).toMatchObject({ size: 65536, leading: true });
      });
    });
  },
  owns("FR-MAIL-046-c1", "FR-MAIL-046-c2", "FR-MAIL-046-c3"),
);

describeFeature(
  FR047,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      clock.reset();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario("Peak memory counts ArrayBuffers too", ({ Given, When, Then }) => {
      let asked: [string, string][];

      Given(
        "a child process calling gc() and sampling heapUsed plus arrayBuffers at each step, so that live memory is what counts, and a 25 MiB message of plain text and of one large attachment",
        () => {
          asked = [
            ["plain", "BODY.PEEK[]"],
            ["attachment", "BODY.PEEK[]"],
            ["attachment", "BODY.PEEK[2]"],
          ];
        },
      );

      When(
        "FETCH BODY.PEEK[], and BODY.PEEK[2] on the attachment, run through the real session over the real mailbox object",
        () => {
          // peakOf runs each fetch inside the Then, beside the expect lines that name it.
        },
      );

      Then("the peak stays under 100 MB", async () => {
        for (const [shape, item] of asked) {
          const { peak, completed, size, same } = await peakOf(shape, item);
          const named = `${shape} ${item}`;
          expect(completed, named).toBe(true);
          expect(same, named).toBe(true);
          expect(size, named).toBeGreaterThanOrEqual(25 * 1024 * 1024);
          expect(peak, named).toBeLessThan(100_000_000);
        }
      });
    });
  },
  owns("FR-MAIL-047-c2"),
);
