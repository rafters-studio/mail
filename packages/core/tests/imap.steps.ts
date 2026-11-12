import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { z } from "zod";
import {
  CAPABILITIES,
  createImapSession,
  type ImapSession,
  type ImapStore,
} from "../src/imap/index.ts";
import { fetchItems, load } from "../src/imap/fetch.ts";
import { ranges, unranges } from "../src/imap/snapshot.ts";
import { binary, readMessage } from "../src/read/index.ts";
import { feature, owns } from "./feature.ts";
import { encode, everyFixture } from "./fixtures/read.ts";
import { latin1, record, type Entry, type Step } from "./imap/record.ts";
import { memoryStore } from "./imap/store.ts";

// FR-MAIL-047-c3 watches the reader; every call still does what it does.
vi.mock("../src/read/index.ts", async (original) => {
  const read = await original<typeof import("../src/read/index.ts")>();
  return { ...read, binary: vi.fn(read.binary), readMessage: vi.fn(read.readMessage) };
});

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

/** All eight goldens, run whole, one byte at a time, and resumed. */
async function everyGolden(): Promise<void> {
  for (const name of EIGHT) {
    const entries = golden(name);
    const [whole, bytewise] = await driven(name, entries);
    expect(whole, name).toEqual(entries);
    expect(bytewise, name).toEqual(entries);
    expect(await record(scriptOf(entries), false, true), name).toEqual(entries);
    expect(await record(scriptOf(entries), true, true), name).toEqual(entries);
  }
}

// A message of two parts: text, then 8-bit octets.
const TWO_PARTS = [
  "From: a@x.test\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n",
  "--b\r\n\r\nplain\r\n--b\r\n\r\ncaf\xe9\r\n--b--\r\n",
].join("");

/** A store holding one message, handing out the same array every time. */
const holding = (stored: Uint8Array): ImapStore => ({
  login: async () => "a",
  mailboxes: async () => ["INBOX"],
  open: async () => ({
    uidValidity: 1,
    uidNext: 2,
    messages: [{ uid: 1, flags: [], internalDate: new Date(0), size: stored.length }],
  }),
  held: async () => [],
  bytes: async () => stored,
  setFlags: async () => {},
  expunge: async () => {},
});

/** What the session answers to `FETCH 1 <item>` over a store holding `stored`, as binary text. */
async function answer(stored: Uint8Array, item: string): Promise<string> {
  const session = createImapSession({ store: holding(stored) });
  const send = (line: string) => session.receive(latin1(`${line}\r\n`));
  await send("A1 LOGIN u p");
  await send("A2 EXAMINE INBOX");
  return binary(await send(`A3 FETCH 1 ${item}`));
}

const FR021 = await feature("FR-MAIL-021");
const FR022 = await feature("FR-MAIL-022");
const FR023 = await feature("FR-MAIL-023");
const FR024 = await feature("FR-MAIL-024");
const FR033 = await feature("FR-MAIL-033");
const FR046 = await feature("FR-MAIL-046");
const FR047 = await feature("FR-MAIL-047");
const FR048 = await feature("FR-MAIL-048");

describeFeature(
  FR021,
  ({ Scenario }) => {
    Scenario(
      "The greeting and CAPABILITY name exactly IMAP4rev1 LITERAL+ IDLE UIDPLUS UNSELECT",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps greeting and A1",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", ["greeting", "A1"]);
        });
      },
    );

    Scenario("A command outside its state is BAD with its tag", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A3 and A19",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A3", "A19"]);
      });
    });

    Scenario(
      "A failed login is NO, and a login sent as synchronising literals gets a continuation for each",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A4 to A6",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A4", "A6"]]);
        });
      },
    );

    Scenario("LOGIN once authenticated is BAD", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A7",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A7"]);
      });
    });

    Scenario(
      "A non-synchronising literal gets no continuation, and a synchronising one over 1 MiB is BAD",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A16 to A18",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A16", "A18"]]);
        });
      },
    );

    Scenario("The third failed login ends the session", ({ Given, When, Then }) => {
      Given(
        "the lockout golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("lockout", "all");
      });
    });

    Scenario(
      "A non-synchronising literal over 1 MiB, or a line over 64 KiB, ends the session",
      ({ Given, When, Then }) => {
        Given(
          "the toobig golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all and the longline golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("toobig", "all");
          await matches("longline", "all");
        });
      },
    );

    Scenario(
      "Each malformed command is answered with its reason, and the next command is read",
      ({ Given, When, Then }) => {
        Given(
          "the malformed golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps E1 to E35",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("malformed", [["E1", "E35"]]);
        });
      },
    );

    Scenario(
      "An unknown command or UID command, and an unterminated string, are BAD",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A76 to A78",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A76", "A78"]]);
        });
      },
    );

    Scenario("LOGOUT says BYE and the session reads nothing more", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A86 and A87",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A86", "A87"]);
      });
    });

    Scenario("Every step of every golden transcript matches", ({ Given, When, Then }) => {
      let names: string[];

      Given(
        "the seven goldens of goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens, every entry",
        () => {
          names = ["transcript", "lockout", "toobig", "longline", "malformed", "headers", "vanish"];
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        for (const name of names) {
          const entries = golden(name);
          expect(chosen(entries, "all")).toEqual(entries.map((_, i) => i));
          await matches(name, "all");
        }
      });
    });

    Scenario(
      "A line in IDLE that never ends is cut off as any long line is",
      ({ Given, When, Then }) => {
        let whole: Entry[];
        let bytewise: Entry[];

        Given(
          "the idlelong golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), all steps",
          () => {
            // matches and driven read the idlelong golden.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines; driven gives its runs.
          },
        );

        Then(
          'every server response equals the golden, byte for byte, the last "* BYE line too long", and the session is closed',
          async () => {
            await matches("idlelong", "all");
            [whole, bytewise] = await driven("idlelong", golden("idlelong"));
            expect(whole.at(-1)?.server).toBe("* BYE line too long\r\n");
            expect(bytewise.at(-1)?.server).toBe("* BYE line too long\r\n");
          },
        );
      },
    );

    Scenario(
      "A store call that rejects rejects that session call and every later one",
      ({ Given, When, Then }) => {
        let down: Error;
        let send: (line: string) => Promise<Uint8Array>;

        Given("a session over the test store whose open() rejects, logged in", async () => {
          down = new Error("the store is down");
          const store = { ...memoryStore(), open: () => Promise.reject(down) };
          const session = createImapSession({ store });
          send = (line: string) => session.receive(new TextEncoder().encode(line));
          expect(await send('L1 LOGIN sean@rafters.studio "pa ss\\"word"\r\n')).toEqual(
            new TextEncoder().encode(`L1 OK [CAPABILITY ${CAPABILITIES}] LOGIN completed\r\n`),
          );
        });

        When("SELECT INBOX is sent, then NOOP", () => {
          // send runs inside the Then, wrapped by its expect.
        });

        Then("both receive calls reject with the store's error", async () => {
          await expect(send("L2 SELECT INBOX\r\n")).rejects.toBe(down);
          await expect(send("L3 NOOP\r\n")).rejects.toBe(down);
        });
      },
    );
  },
  owns(
    "FR-MAIL-021-c1",
    "FR-MAIL-021-c2",
    "FR-MAIL-021-c3",
    "FR-MAIL-021-c4",
    "FR-MAIL-021-c5",
    "FR-MAIL-021-c6",
    "FR-MAIL-021-c7",
    "FR-MAIL-021-c8",
    "FR-MAIL-021-c9",
    "FR-MAIL-021-c10",
    "FR-MAIL-021-c11",
    "FR-MAIL-021-c12",
    "FR-MAIL-021-c13",
  ),
);

describeFeature(
  FR022,
  ({ Scenario }) => {
    Scenario("LIST and LSUB match patterns as RFC 3501 does", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A8 to A12",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", [["A8", "A12"]]);
      });
    });

    Scenario(
      "STATUS answers MESSAGES, UIDNEXT, UIDVALIDITY and UNSEEN, and refuses other items",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A13 to A15, A69 and A83",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A13", "A15"], "A69", "A83"]);
        });
      },
    );

    Scenario(
      "SELECT and EXAMINE answer in the stated order, and a failed SELECT leaves the session authenticated",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A20, A21, A27 and A80",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", ["A20", "A21", "A27", "A80"]);
        });
      },
    );

    Scenario(
      "A read-only mailbox refuses STORE, EXPUNGE and UID EXPUNGE",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A22 to A25",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A22", "A25"]]);
        });
      },
    );

    Scenario("CLOSE expunges silently, UNSELECT does not", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A26, A79, A81 and A82",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A26", "A79", "A81", "A82"]);
      });
    });

    Scenario(
      "Another client's changes are reported at NOOP, CHECK and UID commands, and not during FETCH by sequence number",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps the change flag-2, A65, A70, the change expunge-6, A71 and A72",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [
            "the change flag-2",
            "A65",
            "A70",
            "the change expunge-6",
            "A71",
            "A72",
          ]);
        });
      },
    );

    Scenario("A mailbox that disappears reports each message expunged", ({ Given, When, Then }) => {
      Given(
        "the vanish golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("vanish", "all");
      });
    });
  },
  owns(
    "FR-MAIL-022-c1",
    "FR-MAIL-022-c2",
    "FR-MAIL-022-c3",
    "FR-MAIL-022-c4",
    "FR-MAIL-022-c5",
    "FR-MAIL-022-c6",
    "FR-MAIL-022-c7",
  ),
);

describeFeature(
  FR023,
  ({ Scenario }) => {
    Scenario(
      "FLAGS, RFC822.SIZE, INTERNALDATE, ENVELOPE and BODYSTRUCTURE, and the macros, answer for every message",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A28 to A30",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A28", "A30"]]);
        });
      },
    );

    Scenario(
      "Sections HEADER, TEXT, MIME, part numbers, a message's parts and HEADER.FIELDS are those octets",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A31 to A33 and A38",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A31", "A33"], "A38"]);
        });
      },
    );

    Scenario(
      "UID FETCH puts UID first, and RFC822, RFC822.HEADER and RFC822.TEXT answer",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A34, A36 and A37",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", ["A34", "A36", "A37"]);
        });
      },
    );

    Scenario(
      "A partial returns its octets and echoes its origin, and a zero count is BAD",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A35 and A40",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", ["A35", "A40"]);
        });
      },
    );

    Scenario("An unknown item is BAD", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A39",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A39"]);
      });
    });

    Scenario(
      "Groups, Sender, Reply-To, a language list and a type with no subtype appear as RFC 3501 7.4.2 says",
      ({ Given, When, Then }) => {
        Given(
          "the headers golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("headers", "all");
        });
      },
    );
  },
  owns(
    "FR-MAIL-023-c1",
    "FR-MAIL-023-c2",
    "FR-MAIL-023-c3",
    "FR-MAIL-023-c4",
    "FR-MAIL-023-c5",
    "FR-MAIL-023-c6",
  ),
);

describeFeature(
  FR024,
  ({ Scenario }) => {
    Scenario(
      "FLAGS, +FLAGS and -FLAGS, with and without .SILENT, leave exactly the stated set",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A41 to A47",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A41", "A47"]]);
        });
      },
    );

    Scenario("An unknown system flag is BAD", ({ Given, When, Then }) => {
      Given(
        "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A48",
        () => {
          // matches reads the golden and the steps named.
        },
      );

      When(
        "createImapSession is driven with each client step, whole and one byte at a time",
        () => {
          // matches drives the session inside the Then, around its expect lines.
        },
      );

      Then("every server response equals the golden, byte for byte", async () => {
        await matches("transcript", ["A48"]);
      });
    });

    Scenario(
      "SEARCH answers every supported key, and an unknown key is BAD",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A49 to A64",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A49", "A64"]]);
        });
      },
    );

    Scenario(
      "EXPUNGE and UID EXPUNGE remove only deleted messages and report each",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A66 to A68",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", [["A66", "A68"]]);
        });
      },
    );

    Scenario(
      "IDLE reports a change at once and ends at DONE; any other line ends it with BAD",
      ({ Given, When, Then }) => {
        Given(
          "the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A73, the change idle, DONE, A74 and A75",
          () => {
            // matches reads the golden and the steps named.
          },
        );

        When(
          "createImapSession is driven with each client step, whole and one byte at a time",
          () => {
            // matches drives the session inside the Then, around its expect lines.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          await matches("transcript", ["A73", "the change idle", "DONE", "A74", "A75"]);
        });
      },
    );
  },
  owns("FR-MAIL-024-c1", "FR-MAIL-024-c2", "FR-MAIL-024-c3", "FR-MAIL-024-c4", "FR-MAIL-024-c5"),
);

describeFeature(
  FR033,
  ({ Scenario }) => {
    Scenario(
      "Resuming after every step of every golden gives the same bytes",
      ({ Given, When, Then }) => {
        Given("all eight IMAP goldens", () => {
          // EIGHT names all eight goldens.
        });

        When(
          "each is driven whole and one byte at a time, the session discarded and resumed from its snapshot after every step, not inside a command while not authenticated",
          () => {
            // record drives each inside the Then, wrapped by its expect.
          },
        );

        Then("every server response equals the golden, byte for byte", async () => {
          for (const name of EIGHT) {
            const entries = golden(name);
            expect(await record(scriptOf(entries), false, true), name).toEqual(entries);
            expect(await record(scriptOf(entries), true, true), name).toEqual(entries);
          }
        });
      },
    );

    Scenario(
      "A resumed session names the same message after another client expunges",
      ({ Given, When, Then }) => {
        let store: ReturnType<typeof memoryStore>;
        let saved: ReturnType<ImapSession["snapshot"]>;
        let resumed: ImapSession;
        let fetched: string;
        let noop: string;

        Given(
          "a session that saw UID 1 as message 1, and a store that then expunged UID 1",
          async () => {
            store = memoryStore();
            saved = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
            await store.expunge("acct-sean", "INBOX", [1]);
          },
        );

        When("the session resumes and FETCH 1 (UID) is sent, then changed() and NOOP", async () => {
          resumed = createImapSession({ store, resume: saved });
          fetched = binary(await resumed.receive(latin1("S2 FETCH 1 (UID)\r\n")));
          await resumed.changed();
          noop = binary(await resumed.receive(latin1("S3 NOOP\r\n")));
        });

        Then("FETCH says UID 1, and NOOP tells * 1 EXPUNGE", () => {
          expect(fetched).toBe("* 1 FETCH (UID 1)\r\nS2 OK FETCH completed\r\n");
          expect(noop).toBe("* 1 EXPUNGE\r\nS3 OK NOOP completed\r\n");
        });
      },
    );

    Scenario("A session in IDLE resumes and tells new mail", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let saved: ReturnType<ImapSession["snapshot"]>;
      let resumed: ImapSession;
      let told: string;

      Given("a session idling, and a store with a new message", async () => {
        store = memoryStore();
        saved = (await after(store, "S1 SELECT INBOX\r\n", "S2 IDLE\r\n")).snapshot();
        store.other("idle");
      });

      When("it resumes and changed() is called", async () => {
        resumed = createImapSession({ store, resume: saved });
        told = binary(await resumed.changed());
      });

      Then("it tells the new message, with no second + idling", async () => {
        expect(told).toBe("* 3 EXPUNGE\r\n* 1 FETCH (FLAGS (\\Flagged))\r\n* 6 EXISTS\r\n");
        expect(binary(await resumed.receive(latin1("DONE\r\n")))).toBe("S2 OK IDLE terminated\r\n");
      });
    });

    Scenario("Resuming sends the client nothing", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let phases: ReturnType<ImapSession["snapshot"]>[];

      Given("a snapshot in each phase", async () => {
        store = memoryStore();
        phases = [
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
      });

      When("a session resumes", () => {
        // Each session resumes inside the Then, beside its expect lines.
      });

      Then("no bytes are produced until the next call", async () => {
        for (const resume of phases) {
          const resumed = createImapSession({ store, resume });
          expect(resumed.closed()).toBe(resume.phase.name === "logged-out");
          expect(await resumed.receive(new Uint8Array(0))).toEqual(new Uint8Array(0));
          expect(resumed.closed()).toBe(resume.phase.name === "logged-out");
        }
      });
    });

    Scenario(
      "A flag the client was told comes from the snapshot, not the store",
      ({ Given, When, Then }) => {
        let store: ReturnType<typeof memoryStore>;
        let saved: ReturnType<ImapSession["snapshot"]>;
        let noop: string;

        Given("a snapshot with a flag the store has since changed", async () => {
          store = memoryStore();
          saved = (
            await after(store, "S1 SELECT INBOX\r\n", "S2 STORE 2 +FLAGS (\\Seen)\r\n")
          ).snapshot();
          await store.setFlags("acct-sean", "INBOX", 2, ["\\Flagged"]);
          await store.setFlags("acct-sean", "INBOX", 3, ["\\Answered"]);
        });

        When("the session resumes, changed() and NOOP", async () => {
          const resumed = createImapSession({ store, resume: saved });
          await resumed.changed();
          noop = binary(await resumed.receive(latin1("S3 NOOP\r\n")));
        });

        Then("the difference is told as a FETCH FLAGS", () => {
          expect(noop).toBe(
            "* 2 FETCH (FLAGS (\\Flagged))\r\n* 3 FETCH (FLAGS (\\Answered))\r\nS3 OK NOOP completed\r\n",
          );
        });
      },
    );

    Scenario("No password reaches a snapshot", ({ Given, When, Then }) => {
      let logins: string[];

      Given(
        "a login split at every byte, plain and as literals, and a fatal over-long line",
        () => {
          const user = "sean@rafters.studio";
          const secret = 'pa ss"word';
          logins = [
            LOGIN,
            `L1 LOGIN {${user.length}}\r\n${user} {${secret.length}}\r\n${secret}\r\n`,
            `L1 LOGIN {${user.length}+}\r\n${user} {${secret.length}+}\r\n${secret}\r\n`,
            `L1 LOGIN ${user} "pa ss\\"word${"x".repeat(70_000)}`,
            `L1 LOGIN ${user} {${secret.length}}\r\n${secret}${"x".repeat(70_000)}`,
          ];
        },
      );

      When("the snapshot is read after every byte", () => {
        // Each snapshot is read inside the Then, after every byte, beside its expect lines.
      });

      Then(
        "none holds any part of the password, and while not authenticated buffer is empty and granted is 0",
        async () => {
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
        },
      );
    });

    Scenario("A logged-out snapshot holds no buffer", ({ Given, When, Then }) => {
      let out: ImapSession;
      let fatal: ImapSession;

      Given("a session that logged out, and one closed by a fatal line", async () => {
        out = await after(memoryStore(), "S1 LOGOUT\r\nS2 NOOP\r\n");
        fatal = createImapSession({ store: memoryStore() });
        await fatal.receive(latin1(`S1 NOOP ${"x".repeat(70_000)}`));
      });

      When("the snapshot is read", () => {
        // snapshot is read inside the Then, wrapped by its expect.
      });

      Then("it is logged-out with an empty buffer", () => {
        for (const session of [out, fatal]) {
          expect(session.closed()).toBe(true);
          expect(session.snapshot().phase).toEqual({ name: "logged-out" });
          expect(session.snapshot().buffer).toBe("");
        }
      });
    });

    Scenario("A snapshot is small for a mailbox's shape", ({ Given, When, Then }) => {
      let plainStore: ImapStore;
      let seenStore: ImapStore;

      Given("100,000 contiguous UIDs with no flags, and 100,000 with alternating \\Seen", () => {
        plainStore = shaped(() => [], 100_000);
        seenStore = shaped((i) => (i % 2 === 0 ? ["\\Seen"] : []), 100_000);
      });

      When("the snapshot is serialised", () => {
        // size serialises each snapshot inside the Then, wrapped by its expect.
      });

      Then("the first is under 1 KiB and the second under 1 MiB", async () => {
        const size = async (store: ImapStore): Promise<number> =>
          JSON.stringify((await after(store, "S1 SELECT INBOX\r\n")).snapshot()).length;
        expect(await size(plainStore)).toBeLessThan(1 << 10);
        expect(await size(seenStore)).toBeLessThan(1 << 20);
      });
    });

    Scenario("ranges and unranges round trip", ({ Given, When, Then }) => {
      let lists: number[][];

      Given("sorted UID lists, empty, single, contiguous and scattered", () => {
        lists = [[], [7], [1, 2, 3, 4], [1, 3, 4, 9, 20, 21, 22]];
      });

      When("ranges then unranges runs", () => {
        // ranges and unranges run inside the Then, wrapped by its expect.
      });

      Then("the list comes back", () => {
        for (const list of lists) {
          expect(unranges(ranges(list))).toEqual(list);
        }
        expect(ranges([1, 2, 3, 7])).toEqual([
          [1, 3],
          [7, 7],
        ]);
      });
    });

    Scenario("A bad snapshot throws", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let wrongVersion: unknown;
      let tagged: unknown;

      Given("a snapshot of the wrong version, and a selected phase with a tag", async () => {
        store = memoryStore();
        const selected = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
        wrongVersion = { ...selected, v: 2 };
        tagged = { ...selected, phase: { ...selected.phase, tag: "S2" } };
      });

      When("createImapSession is given it", () => {
        // createImapSession runs inside the Then, wrapped by its expect.
      });

      Then("it throws a ZodError", () => {
        expect(() => createImapSession({ store, resume: wrongVersion })).toThrow(z.ZodError);
        expect(() => createImapSession({ store, resume: tagged })).toThrow(z.ZodError);
      });
    });

    Scenario("A held of the wrong count rejects", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let resume: ReturnType<ImapSession["snapshot"]>;
      let short: ImapStore;
      let resumed: ImapSession;

      Given("a store whose held returns fewer messages than named", async () => {
        store = memoryStore();
        resume = (await after(store, "S1 SELECT INBOX\r\n")).snapshot();
        short = { ...store, held: async () => [] };
      });

      When("the session resumes and a command is sent", () => {
        resumed = createImapSession({ store: short, resume });
      });

      Then("the call rejects, as a store failure does", async () => {
        await expect(resumed.receive(latin1("S2 NOOP\r\n"))).rejects.toThrow(RangeError);
        await expect(resumed.receive(latin1("S3 NOOP\r\n"))).rejects.toThrow(RangeError);
      });
    });

    Scenario("snapshot is defined at any moment", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let entered: PromiseWithResolvers<void>;
      let open: PromiseWithResolvers<void>;
      let session: ImapSession;
      let finished: ReturnType<ImapSession["snapshot"]>;
      let queued: Promise<Uint8Array>;

      Given("a call queued but not finished, and a session just resumed", async () => {
        store = memoryStore();
        entered = Promise.withResolvers<void>();
        open = Promise.withResolvers<void>();
        const gated: ImapStore = {
          ...store,
          open: async (account, mailbox) => {
            entered.resolve();
            await open.promise;
            return store.open(account, mailbox);
          },
        };
        session = await after(gated);
        finished = session.snapshot();
        // S2 is still in the live buffer while S1 waits on the store, so a live reading would show it.
        queued = session.receive(latin1("S1 SELECT INBOX\r\nS2 NOOP\r\n"));
        await entered.promise;
      });

      When("snapshot is read", () => {
        // snapshot is read inside the Then, wrapped by its expect.
      });

      Then("it gives the state as of the last finished call, or the parsed resume", async () => {
        expect(session.snapshot()).toEqual(finished);
        open.resolve();
        await queued;
        const selected = session.snapshot();
        expect(selected.phase.name).toBe("selected");
        const resumed = createImapSession({ store, resume: selected });
        expect(resumed.snapshot()).toEqual(selected);
      });
    });

    Scenario(
      "A buffer past the bound gets the BYE, and whole commands do not",
      ({ Given, When, Then }) => {
        let pipelined: string;
        let literal: string;
        let whole: ImapSession;
        let many: ImapSession;
        let answer: string;
        let bye: string;

        Given(
          "a frame of 200,000 pipelined NOOPs, and a command of many literals past MAX_LITERAL plus MAX_LINE",
          () => {
            pipelined = "N NOOP\r\n".repeat(200_000);
            literal = `{${1 << 19}+}\r\n${"x".repeat(1 << 19)} `;
          },
        );

        When("receive runs", async () => {
          whole = createImapSession({ store: memoryStore() });
          answer = binary(await whole.receive(latin1(pipelined)));
          many = createImapSession({ store: memoryStore() });
          bye = binary(await many.receive(latin1(`M LIST ${literal.repeat(3)}`)));
        });

        Then(
          "the first is answered in full, and the second gets * BYE command too long and closes with an empty buffer",
          () => {
            expect(answer).toBe("N OK NOOP completed\r\n".repeat(200_000));
            expect(whole.closed()).toBe(false);

            expect(bye).toBe("* BYE command too long\r\n");
            expect(many.closed()).toBe(true);
            expect(many.snapshot().buffer).toBe("");
          },
        );
      },
    );
  },
  owns(
    "FR-MAIL-033-c1",
    "FR-MAIL-033-c2",
    "FR-MAIL-033-c3",
    "FR-MAIL-033-c4",
    "FR-MAIL-033-c5",
    "FR-MAIL-033-c6",
    "FR-MAIL-033-c7",
    "FR-MAIL-033-c8",
    "FR-MAIL-033-c9",
    "FR-MAIL-033-c10",
    "FR-MAIL-033-c11",
    "FR-MAIL-033-c12",
    "FR-MAIL-033-c13",
  ),
);

describeFeature(
  FR046,
  ({ Scenario }) => {
    Scenario("A response becomes octets without one element per byte", ({ Given, When, Then }) => {
      let stdout: string;

      Given("the function turning a response into octets", () => {
        // heap-octets.ts holds the function's input and runs it in a child process.
      });

      When("it runs on 25 MiB", async () => {
        ({ stdout } = await promisify(execFile)(process.execPath, [
          "--max-old-space-size=50",
          new URL("heap-octets.ts", import.meta.url).pathname,
        ]));
      });

      Then("the octets equal the text, and heap use stays under twice the input", () => {
        expect(stdout).toBe("equal\n");
      });
    });

    Scenario("Every IMAP golden is unchanged", ({ Given, When, Then }) => {
      Given("all eight goldens", () => {
        // EIGHT names all eight goldens.
      });

      When("they run whole, one byte at a time, and resumed", () => {
        // everyGolden runs them inside the Then, around its expect lines.
      });

      Then("every response is byte for byte the same", async () => {
        await everyGolden();
      });
    });
  },
  owns("FR-MAIL-046-c4", "FR-MAIL-046-c5"),
);

describeFeature(
  FR047,
  ({ Scenario }) => {
    Scenario(
      "A body leaves as a slice of the stored bytes, not a copy",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let asked: [string, number, number][];

        Given("a FETCH of BODY[], BODY.PEEK[], RFC822, a part and a partial", () => {
          stored = latin1(TWO_PARTS);
          const part = TWO_PARTS.indexOf("plain");
          asked = [
            ["BODY[]", 0, stored.length],
            ["BODY.PEEK[]", 0, stored.length],
            ["RFC822", 0, stored.length],
            ["BODY.PEEK[1]", part, part + 5],
            ["BODY.PEEK[]<4.9>", 4, 13],
            ["BODY.PEEK[1]<1.3>", part + 1, part + 4],
          ];
        });

        When("the session answers", () => {
          // Each item is rendered, and the session answers, inside the Then, around its expect lines.
        });

        Then(
          "each literal is a view on the bytes the store returned, with no string holding the body while the response is built, and the octets on the wire are exactly as before",
          async () => {
            const held = { uid: 1, flags: [], internalDate: new Date(0), size: stored.length };
            for (const [item, start, end] of asked) {
              const [one] = fetchItems({ kind: "atom", text: item }) ?? [];
              const pieces = one?.render({ held, message: load(stored) }) ?? [];
              const views = pieces.filter((p) => p instanceof Uint8Array);
              expect(
                views.map((v) => [v.buffer, v.byteOffset, v.length]),
                item,
              ).toEqual([[stored.buffer, start, end - start]]);
              // Only the words around the literal are text, so no string holds the body.
              expect(
                pieces.filter((p) => typeof p === "string").join("").length,
                item,
              ).toBeLessThan(40);
            }
            const done = "A3 OK FETCH completed\r\n";
            const literal = (label: string, value: string): string =>
              `* 1 FETCH (${label} {${value.length}}\r\n${value})\r\n${done}`;
            expect(await answer(stored, "BODY.PEEK[]")).toBe(literal("BODY[]", TWO_PARTS));
            expect(await answer(stored, "RFC822")).toBe(literal("RFC822", TWO_PARTS));
            expect(await answer(stored, "BODY.PEEK[2]")).toBe(literal("BODY[2]", "caf\xe9"));
            // RFC 3501 4.3: what needs no literal stays quoted, as it did when it was a string.
            expect(await answer(stored, "BODY.PEEK[1]")).toBe(
              `* 1 FETCH (BODY[1] "plain")\r\n${done}`,
            );
            expect(await answer(stored, "BODY.PEEK[]<0.5>")).toBe(
              `* 1 FETCH (BODY[]<0> "From:")\r\n${done}`,
            );
            // Past the end, and a part the message does not have, are empty and quoted.
            expect(await answer(stored, "BODY.PEEK[]<9999.5>")).toBe(
              `* 1 FETCH (BODY[]<9999> "")\r\n${done}`,
            );
            expect(await answer(stored, "BODY.PEEK[9]")).toBe(`* 1 FETCH (BODY[9] "")\r\n${done}`);
            // What is built, not cut from the bytes, is a literal under the same rule.
            expect(await answer(latin1('Subject: "hi"\r\n\r\nbody'), "ENVELOPE")).toContain(
              '{4}\r\n"hi"',
            );
            // Each octet that needs a literal, alone.
            for (const special of ["\r", "\n", "\0", '"', "\\", "\x80", "\xff"]) {
              const message = `From: a\r\n\r\n${special}`;
              expect(await answer(latin1(message), "BODY.PEEK[TEXT]"), special).toBe(
                literal("BODY[TEXT]", special),
              );
            }
          },
        );
      },
    );

    Scenario("The parse does not outlive its use", ({ Given, When, Then }) => {
      let stored: Uint8Array;
      let session: ImapSession;
      let response: Uint8Array;

      Given("a FETCH asking only for BODY.PEEK[]", async () => {
        stored = latin1(TWO_PARTS);
        vi.mocked(readMessage).mockClear();
        vi.mocked(binary).mockClear();
        session = createImapSession({ store: holding(stored) });
        await session.receive(latin1("A1 LOGIN u p\r\nA2 EXAMINE INBOX\r\n"));
      });

      When("the session answers", () => {
        // The session answers inside the Then: the runner clears a spy's calls between steps.
      });

      Then("the message is not parsed, and no binary text of it is made", async () => {
        response = await session.receive(latin1("A3 FETCH 1 BODY.PEEK[]\r\n"));
        /** Whether a call to the reader was given the stored bytes, or a view on them. */
        const given = (calls: [Uint8Array][]): boolean =>
          calls.some(([b]) => b.buffer === stored.buffer);
        expect(response.length).toBeGreaterThan(stored.length);
        expect(readMessage).not.toHaveBeenCalled();
        expect(given(vi.mocked(binary).mock.calls)).toBe(false);
        // A part needs the tree, so the same watch sees the parse when there is one.
        await session.receive(latin1("A4 FETCH 1 BODY.PEEK[1]\r\n"));
        expect(readMessage).toHaveBeenCalledTimes(1);
        expect(given(vi.mocked(readMessage).mock.calls)).toBe(true);
      });
    });

    Scenario("Every IMAP golden is unchanged", ({ Given, When, Then }) => {
      Given("all eight goldens", () => {
        // EIGHT names all eight goldens.
      });

      When("they run whole, one byte at a time, and resumed", () => {
        // everyGolden runs them inside the Then, around its expect lines.
      });

      Then("every response is byte for byte the same", async () => {
        await everyGolden();
      });
    });
  },
  owns("FR-MAIL-047-c1", "FR-MAIL-047-c3", "FR-MAIL-047-c4"),
);

describeFeature(
  FR048,
  ({ Scenario }) => {
    Scenario(
      "Reading a message's structure does not make a text copy of its bodies",
      ({ Given, When, Then }) => {
        let line: string;
        let count: number;
        let stored: Uint8Array;
        let response: string;
        let octets: number;

        Given("a message with a large attachment", () => {
          // A text part, then a text attachment of 1 MiB, so its boundary and its lines are found too.
          line = `${"x".repeat(76)}\r\n`;
          count = Math.ceil((1024 * 1024) / line.length);
          const head = "From: a@x.test\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n";
          const message = `${head}--b\r\n\r\nplain\r\n--b\r\nContent-Type: text/csv\r\n\r\n${line.repeat(count)}--b--\r\n`;
          stored = latin1(message);
        });

        When("readMessage and BODYSTRUCTURE run", async () => {
          const decoded = vi.spyOn(String, "fromCharCode");
          response = await answer(stored, "BODYSTRUCTURE");
          octets = decoded.mock.calls.reduce((all, call) => all + call.length, 0);
          decoded.mockRestore();
        });

        Then(
          "no binary text of the whole message is made: headers are decoded where they are read, and boundaries and line counts are found on the bytes",
          () => {
            // The last line's CRLF belongs to the delimiter (RFC 2046 5.1.1).
            const size = count * line.length - 2;
            expect(response).toContain(
              `(("text" "plain" NIL NIL NIL "7bit" 5 1 NIL NIL NIL NIL)("text" "csv" NIL NIL NIL "7bit" ${size} ${count} `,
            );
            // The session's commands and the message's header sections are all that was decoded.
            expect(octets).toBeLessThan(1024);

            // Lines like a delimiter are not one: a longer boundary, one dash, and `--` with more after it.
            const lookalikes = "one\r\n--bc\r\n--b-x\r\n--b--x";
            const bounded = encode(
              `Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n\r\n${lookalikes}\r\n--b \t\r\n\r\ntwo\r\n--b--\r\n`,
            );
            const bodies = readMessage(bounded).root.children.map((p) =>
              binary(bounded.subarray(p.body.start, p.body.end)),
            );
            expect(bodies).toEqual([lookalikes, "two"]);
            // The message's header ends at any line break, a CR alone too, or at once when it opens with one.
            expect(readMessage(encode("Subject: s\r\rbody")).subject).toBe("s");
            expect(readMessage(encode("\r\nSubject: s\r\n\r\nbody")).fields).toEqual([]);
          },
        );
      },
    );

    Scenario("Every read and IMAP golden is unchanged", ({ Given, When, Then }) => {
      Given(
        "the read fixtures against golden.json, and all eight IMAP goldens whole, one byte at a time and resumed",
        () => {
          // everyFixture lists the read fixtures and golden.json; EIGHT names the IMAP goldens.
        },
      );

      When("they run", () => {
        // everyFixture and everyGolden run them inside the Then, around their expect lines.
      });

      Then("every result is exactly as before", async () => {
        everyFixture();
        await everyGolden();
      });
    });
  },
  owns("FR-MAIL-048-c1", "FR-MAIL-048-c2"),
);
