// Revoking on local workerd (FR-MAIL-049, research 01a1a4c4 and 01a1ae1d): six logged-in sessions,
// each evicted with workerd's evict, are closed by one revoke, and another password reconnects.
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "../../../core/tests/feature.ts";
import { client, evictSession, type Fixture, route, startFixture } from "./harness.ts";

type Client = Awaited<ReturnType<typeof client>>;
type Stats = Record<string, number>;
type Closed = { kind: "imap" | "submit"; code: number; ms: number };
type Round = {
  mailbox: string;
  before: Stats;
  after: Stats;
  objects: { kind: "imap" | "submit"; id: string; key: string }[];
  first: unknown;
  names: unknown;
  closed: Closed[];
  reread: string;
};

const ROUNDS = Number(process.env["REVOKE_ROUNDS"] ?? 1);
const ADDRESS = "198.51.100.1";
const statsSchema = (value: unknown): Stats => {
  if (typeof value !== "object" || value === null) throw new Error("stats are not an object");
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, Number(v)]));
};
const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Sends one line and waits for `text` in what answers it. */
async function say(c: Client, line: string, text: string): Promise<void> {
  const from = c.received().length;
  c.send(`${line}\r\n`);
  await c.until(text, from);
}

/** An IMAP client past LOGIN, and past SELECT and IDLE when asked. */
async function imap(
  worker: Fixture,
  user: string,
  password: string,
  then: "select" | "idle" | "none",
): Promise<Client> {
  const c = await client(worker, "/imap", ADDRESS);
  await say(c, `a LOGIN ${user} ${password}`, "a OK");
  if (then === "none") return c;
  await say(c, "b SELECT INBOX", "b OK");
  if (then === "idle") await say(c, "c IDLE", "+ idling");
  return c;
}

/** A submission client past AUTH PLAIN. */
async function submit(worker: Fixture, user: string, password: string): Promise<Client> {
  const c = await client(worker, "/submit", ADDRESS);
  await say(c, "EHLO x", "250 AUTH");
  await say(c, `AUTH PLAIN ${btoa(`\0${user}\0${password}`)}`, "235 Ok");
  return c;
}

/** One round of the list in the issue: six sessions, evicted, revoked, and a reconnect. */
async function round(worker: Fixture): Promise<Round> {
  const mailbox = `box-${hex(4)}`;
  const password = `pw-${hex(4)}`;
  const first = `first-${hex(4)}@fixture.test`;
  const second = `second-${hex(4)}@fixture.test`;
  for (const user of [first, second]) {
    await route(worker, `/fixture/put?user=${user}&password=${password}&mailbox=${mailbox}`);
  }
  await route(worker, `/fixture/seed?mailbox=${mailbox}`);

  const start = statsSchema(await route(worker, "/fixture/stats"));
  const imaps = [
    await imap(worker, first, password, "select"),
    await imap(worker, first, password, "idle"),
    await imap(worker, first, password, "none"),
    await imap(worker, second, password, "select"),
  ];
  const submits = [await submit(worker, first, password), await submit(worker, second, password)];

  const before = statsSchema(await route(worker, "/fixture/stats"));
  const objects = Object.keys(before)
    .filter((key) => !(key in start))
    .map((key): Round["objects"][number] => {
      const [kind, id] = key.split(":");
      if ((kind !== "imap" && kind !== "submit") || id === undefined) throw new Error(key);
      return { kind, id, key };
    });
  expect(objects).toHaveLength(6);
  for (const { kind, id } of objects) await evictSession(worker, kind, id);
  const at = performance.now(); // no-timing: recorded, never asserted
  const result = await route(worker, `/fixture/revoke?mailbox=${mailbox}`);
  expect(result).toEqual({ told: 6, closed: 6, failed: 0 });

  const closed: Closed[] = [];
  const ending = (kind: Closed["kind"], c: Client, text: string) =>
    (async () => {
      await c.until(text);
      const code = await c.closed;
      const ms = performance.now() - at; // no-timing: recorded, never asserted
      closed.push({ kind, code, ms });
    })();
  await Promise.all([
    ...imaps.map((c) => ending("imap", c, "* BYE credential revoked")),
    ...submits.map((c) => ending("submit", c, "421 Credential revoked")),
  ]);

  const after = statsSchema(await route(worker, "/fixture/stats"));
  const names = await route(worker, `/fixture/names?mailbox=${mailbox}`);

  const again = await imap(worker, second, password, "select");
  await say(again, "c FETCH 1 (RFC822)", "hello from the fixture");
  const reread = again.received();
  again.ws.close();
  await again.closed;

  return { mailbox, before, after, objects, first: result, names, closed, reread };
}

/** How many of a round's session objects ran their constructor again after eviction. */
const woken = (r: Round) =>
  r.objects.filter(({ key }) => (r.after[key] ?? 0) > (r.before[key] ?? 0)).length;

const FR049 = await feature("FR-MAIL-049");

describeFeature(
  FR049,
  ({ BeforeAllScenarios, AfterAllScenarios, Scenario }) => {
    let worker: Fixture | null = null;
    const rounds: Round[] = [];

    BeforeAllScenarios(async () => {
      worker = await startFixture(new URL("./fixture/wrangler.jsonc", import.meta.url));
      for (let i = 0; i < ROUNDS; i += 1) rounds.push(await round(worker));
      for (const [i, r] of rounds.entries()) {
        console.log(
          `round ${i + 1}: ${r.mailbox} ${JSON.stringify(r.first)} woken ${woken(r)} of ${r.objects.length} closes ${r.closed
            .map(({ kind, code, ms }) => `${kind} ${code} ${ms.toFixed(1)} ms`)
            .join(", ")}`,
        );
      }
    });
    AfterAllScenarios(async () => {
      await worker?.dispose();
    });

    /** Every round's objects of one kind rose in constructor count, and each client of it closed. */
    const closedAndRose = (kind: "imap" | "submit", count: number) => {
      expect(rounds).toHaveLength(ROUNDS);
      for (const r of rounds) {
        const own = r.objects.filter((o) => o.kind === kind);
        expect(own).toHaveLength(count);
        for (const { key } of own) {
          expect(r.after[key] ?? 0).toBeGreaterThan(r.before[key] ?? 0);
        }
        expect(r.closed.filter((c) => c.kind === kind)).toHaveLength(count);
      }
    };

    Scenario(
      "Revoking closes every logged-in IMAP session, evicted or not",
      ({ Given, When, Then }) => {
        Given(
          "four IMAP sessions on one mailbox, one selected, one in IDLE, one logged in and unselected, and one logged in with another valid password, each evicted by the test with workerd's evict, its socket kept hibernating, after the session's last reply was read",
          () => {
            // BeforeAllScenarios opened and evicted them, in each round: steps 1 to 3 of the issue.
          },
        );

        When("revoke runs on that mailbox", () => {
          // BeforeAllScenarios ran it, in each round: step 3 of the issue.
        });

        Then(
          "each client receives * BYE credential revoked and its socket closes, and the constructor count of each session object rose",
          () => {
            closedAndRose("imap", 4);
          },
        );
      },
    );

    Scenario(
      "Revoking closes every logged-in submission session, evicted or not",
      ({ Given, When, Then }) => {
        Given(
          "two logged-in submission sessions on the same mailbox, one with another valid password, each evicted by the test with workerd's evict, its socket kept hibernating, after the session's last reply was read",
          () => {
            // BeforeAllScenarios opened and evicted them, in each round: steps 1 to 3 of the issue.
          },
        );

        When("revoke runs on that mailbox", () => {
          // BeforeAllScenarios ran it, in each round: step 3 of the issue.
        });

        Then(
          "each client receives 421 Credential revoked and its socket closes, and the constructor count of each session object rose",
          () => {
            closedAndRose("submit", 2);
          },
        );
      },
    );

    Scenario(
      "Revoke reports what it did, and another valid password can reconnect",
      ({ Given, When, Then }) => {
        Given("the four IMAP sessions and two submission sessions of the scenarios above", () => {
          // BeforeAllScenarios opened them, in each round: steps 1 and 2 of the issue.
        });

        When("revoke returns", () => {
          // BeforeAllScenarios kept what it returned, in each round: step 4 of the issue.
        });

        Then(
          "it gives told 6, closed 6 and failed 0, the mailbox holds no registered name, and a client logging in again with the other valid password selects and fetches the seeded message",
          () => {
            expect(rounds).toHaveLength(ROUNDS);
            for (const r of rounds) {
              expect(r.first).toEqual({ told: 6, closed: 6, failed: 0 });
              expect(r.names).toEqual([]);
              expect(r.reread).toContain("hello from the fixture");
            }
          },
        );
      },
    );
  },
  owns("FR-MAIL-049-c3", "FR-MAIL-049-c4", "FR-MAIL-049-c5"),
);
