// The Worker and its D1 and R2 ports on node:sqlite and a Map, against the worker goldens of
// reference 01a19a9e (FR-MAIL-017).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import {
  type CloudflareMessage,
  type D1Like,
  d1Deliveries,
  d1Directory,
  emailWorker,
} from "../src/index.ts";

const MIGRATION = readFileSync(
  new URL("../migrations/0001_receiving.sql", import.meta.url),
  "utf8",
);
const PLAIN = new Uint8Array(
  readFileSync(new URL("../../core/tests/fixtures/write/plain.expected.eml", import.meta.url)),
);
// The seed directory of reference 01a19a9e.
const SEED = `
INSERT INTO mailboxes (id) VALUES ('mbx-sean'), ('mbx-ops'), ('mbx-lists'), ('mbx-support');
INSERT INTO domains (name, postmaster, catch_all, masking) VALUES
  ('rafters.studio', 'mbx-ops', NULL, 1),
  ('xn--exempl-gva.fr', 'mbx-ops', 'mbx-sean', 0);
INSERT INTO addresses (local, domain, mailbox, enabled, mask_shown, mask_label, mask_created_at) VALUES
  ('sean', 'rafters.studio', 'mbx-sean', 1, NULL, NULL, NULL),
  ('silvius', 'rafters.studio', 'mbx-sean', 1, NULL, NULL, NULL),
  ('sean+lists', 'rafters.studio', 'mbx-lists', 1, NULL, NULL, NULL),
  ('support', 'rafters.studio', 'mbx-support', 1, NULL, NULL, NULL),
  ('quietotter4821', 'rafters.studio', 'mbx-sean', 0, 'quiet.otter.4821', 'bike shop', '2026-03-01T09:00:00.000Z');
`;
const BLOB = "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b";

/** The migration on node:sqlite with foreign keys on, as a D1Like, seeded unless told not to. */
function world(seed = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATION);
  if (seed) db.exec(SEED);
  const d1: D1Like = {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async () => {
          const row = db.prepare(sql).get(...values);
          return row === undefined ? null : { ...row };
        },
        run: async () => db.prepare(sql).run(...values),
        all: async () => ({
          results: db
            .prepare(sql)
            .all(...values)
            .map((row) => ({ ...row })),
        }),
      }),
    }),
  };
  const blobs = new Map<string, Uint8Array>();
  const env = {
    MAIL_DB: d1,
    MAIL_BLOBS: { put: async (k: string, b: Uint8Array) => blobs.set(k, b) },
  };
  const rows = () =>
    db
      .prepare("SELECT blob, mailbox, mail_from, rcpt_to, via FROM deliveries")
      .all()
      .map((row) => ({ ...row }));
  return { db, d1, blobs, env, rows };
}

/** A message as Email Routing hands it to the Worker, its raw a real ReadableStream. */
function message(from: string, to: string, rawSize = PLAIN.byteLength) {
  const rejects: string[] = [];
  const m: CloudflareMessage = {
    from,
    to,
    raw: new Blob([PLAIN]).stream(),
    rawSize,
    setReject: (reason) => void rejects.push(reason),
  };
  return { m, rejects };
}

/** A mailbox namespace that records each ping by the name it was reached by, throwing when told to. */
function mailboxes(fail = false) {
  const pinged: unknown[] = [];
  const ns = {
    idFromName: (name: string) => name,
    idFromString: () => "by-string",
    newUniqueId: () => "unique",
    get: (id: unknown) => ({
      ping: async () => {
        pinged.push(id);
        if (fail) throw new Error("no answer");
      },
    }),
  };
  return { ns, pinged };
}

type World = ReturnType<typeof world>;

const FR017 = await feature("FR-MAIL-017");
const FR038 = await feature("FR-MAIL-038");

describeFeature(
  FR017,
  ({ Scenario }) => {
    Scenario("The Worker's default export has the email handler alone", ({ Given, When, Then }) => {
      let worker: ReturnType<typeof emailWorker>;
      let keys: string[];

      Given("emailWorker()", () => {
        worker = emailWorker();
      });

      When("its keys are read", () => {
        keys = Object.keys(worker);
      });

      Then('they are exactly ["email"]', () => {
        expect(keys).toEqual(["email"]);
      });
    });

    Scenario("A message for a mailbox is stored through D1 and R2", ({ Given, When, Then }) => {
      let w: World;
      let rejects: string[];

      Given(
        "the migration and the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support) on node:sqlite as D1, and a Map as R2",
        () => {
          w = world();
        },
      );

      When(
        "the Worker handles the plain golden from mary@example.com to sean@rafters.studio",
        async () => {
          const sent = message("mary@example.com", "sean@rafters.studio");
          rejects = sent.rejects;
          await emailWorker().email(sent.m, w.env);
        },
      );

      Then(
        'the blobs and rows are those of the reference golden worker-accept (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), with via "cloudflare"',
        () => {
          expect(rejects).toEqual([]);
          expect([...w.blobs.keys()]).toEqual([BLOB]);
          expect(w.blobs.get(BLOB)).toEqual(PLAIN);
          expect(w.rows()).toEqual([
            {
              blob: BLOB,
              mailbox: "mbx-sean",
              mail_from: "mary@example.com",
              rcpt_to: "sean@rafters.studio",
              via: "cloudflare",
            },
          ]);
        },
      );
    });

    Scenario("A message for no one is rejected and nothing is stored", ({ Given, When, Then }) => {
      let w: World;
      let rejects: string[];

      Given("the same", () => {
        w = world();
      });

      When("the Worker handles the plain golden to nobody@rafters.studio", async () => {
        const sent = message("mary@example.com", "nobody@rafters.studio");
        rejects = sent.rejects;
        await emailWorker().email(sent.m, w.env);
      });

      Then(
        'setReject is called once with "No such user here", and there are no blobs and no rows',
        () => {
          expect(rejects).toEqual(["No such user here"]);
          expect([...w.blobs.keys()]).toEqual([]);
          expect(w.rows()).toEqual([]);
        },
      );
    });

    Scenario("An empty envelope sender is recorded as null", ({ Given, When, Then }) => {
      let w: World;
      let rejects: string[];

      Given("the same", () => {
        w = world();
      });

      When('the Worker handles the plain golden with from "" to sean@rafters.studio', async () => {
        const sent = message("", "sean@rafters.studio");
        rejects = sent.rejects;
        await emailWorker().email(sent.m, w.env);
      });

      Then(
        "the row's mail_from is null, as in the reference golden worker-bounce (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        () => {
          expect(rejects).toEqual([]);
          expect([...w.blobs.keys()]).toEqual([BLOB]);
          expect(w.rows()).toEqual([
            {
              blob: BLOB,
              mailbox: "mbx-sean",
              mail_from: null,
              rcpt_to: "sean@rafters.studio",
              via: "cloudflare",
            },
          ]);
        },
      );
    });

    Scenario("Bytes that do not match rawSize throw", ({ Given, When, Then }) => {
      let w: World;
      let m: CloudflareMessage;

      Given("a message whose rawSize is one more than its bytes", () => {
        w = world();
        ({ m } = message("mary@example.com", "sean@rafters.studio", PLAIN.byteLength + 1));
      });

      When("the Worker handles it", () => {
        // email runs inside the Then, wrapped by its expect.
      });

      Then(
        'it throws "raw is 1522 bytes, rawSize says 1523" for the plain golden, and nothing is stored',
        async () => {
          await expect(emailWorker().email(m, w.env)).rejects.toThrow(
            "raw is 1522 bytes, rawSize says 1523",
          );
          expect([...w.blobs.keys()]).toEqual([]);
          expect(w.rows()).toEqual([]);
        },
      );
    });

    Scenario("The migration refuses rows the form forbids", ({ Given, When, Then }) => {
      let db: DatabaseSync;

      Given("the migration on node:sqlite with foreign keys on", () => {
        ({ db } = world(false));
        db.exec("INSERT INTO mailboxes (id) VALUES ('mbx-sean');");
      });

      When(
        "a domain with no postmaster, and an address with mask_shown but no mask_label, are inserted",
        () => {
          // Each insert runs inside the Then, wrapped by its expect.
        },
      );

      Then("both inserts fail", () => {
        expect(() => db.exec("INSERT INTO domains (name) VALUES ('rafters.studio');")).toThrow();
        db.exec("INSERT INTO domains (name, postmaster) VALUES ('rafters.studio', 'mbx-sean');");
        expect(() =>
          db.exec(
            "INSERT INTO addresses (local, domain, mailbox, mask_shown, mask_created_at) VALUES ('quietotter4821', 'rafters.studio', 'mbx-sean', 'quiet.otter.4821', '2026-03-01T09:00:00.000Z');",
          ),
        ).toThrow();
      });
    });

    Scenario(
      "The D1 directory reads rows into the core's schemas, and a bad row throws",
      ({ Given, When, Then }) => {
        let w: World;
        let directory: ReturnType<typeof d1Directory>;

        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support) on node:sqlite",
          () => {
            w = world();
          },
        );

        When(
          'd1Directory reads rafters.studio and the address quietotter4821, then an address row whose mask_created_at is "not a date"',
          () => {
            directory = d1Directory(w.d1);
            // Each read runs inside the Then, wrapped by its expect.
          },
        );

        Then(
          'it gives masking true, enabled false and mask { shown "quiet.otter.4821", label "bike shop", createdAt 2026-03-01T09:00:00Z }, and the bad row throws',
          async () => {
            expect(await directory.domain("rafters.studio")).toMatchObject({ masking: true });
            expect(await directory.address("quietotter4821", "rafters.studio")).toEqual({
              local: "quietotter4821",
              domain: "rafters.studio",
              mailbox: "mbx-sean",
              enabled: false,
              mask: {
                shown: "quiet.otter.4821",
                label: "bike shop",
                createdAt: new Date("2026-03-01T09:00:00Z"),
              },
            });
            w.db.exec(
              "INSERT INTO addresses (local, domain, mailbox, mask_shown, mask_label, mask_created_at) VALUES ('bad', 'rafters.studio', 'mbx-sean', 'b.a.d', 'x', 'not a date');",
            );
            await expect(directory.address("bad", "rafters.studio")).rejects.toMatchObject({
              name: "ZodError",
            });
          },
        );
      },
    );

    Scenario(
      "Recording the same blob for the same mailbox twice adds one row",
      ({ Given, When, Then }) => {
        let w: World;
        let deliveries: ReturnType<typeof d1Deliveries>;

        Given("d1Deliveries on node:sqlite", () => {
          w = world();
          deliveries = d1Deliveries(w.d1);
        });

        When("one row is recorded twice", async () => {
          const row = {
            id: "019cafbf-c600-7001-8203-040506070809",
            blob: BLOB,
            mailbox: "mbx-sean",
            mailFrom: "mary@example.com",
            rcptTo: "sean@rafters.studio",
            receivedAt: new Date("2026-03-02T17:00:00Z"),
            via: "cloudflare",
          };
          await deliveries.record(row);
          await deliveries.record(row);
        });

        Then("the deliveries table has one row", () => {
          expect(w.rows()).toHaveLength(1);
        });
      },
    );
  },
  owns(
    "FR-MAIL-017-c1",
    "FR-MAIL-017-c2",
    "FR-MAIL-017-c3",
    "FR-MAIL-017-c4",
    "FR-MAIL-017-c5",
    "FR-MAIL-017-c6",
    "FR-MAIL-017-c7",
    "FR-MAIL-017-c8",
  ),
);

describeFeature(
  FR038,
  ({ Scenario }) => {
    Scenario("An accept pings each mailbox", ({ Given, When, Then }) => {
      let pinged: unknown[];
      let env: World["env"] & { IMAP_MAILBOX: ReturnType<typeof mailboxes>["ns"] };

      Given("IMAP_MAILBOX bound and two deliveries, one per email call, to two mailboxes", () => {
        const w = world();
        const bound = mailboxes();
        pinged = bound.pinged;
        env = { ...w.env, IMAP_MAILBOX: bound.ns };
      });

      When("email runs", async () => {
        // Email Routing invokes the Worker once per recipient, so two mailboxes are two invocations.
        await emailWorker().email(message("mary@example.com", "sean@rafters.studio").m, env);
        await emailWorker().email(message("mary@example.com", "support@rafters.studio").m, env);
      });

      Then("ping is called on the mailbox each one accepted for", async () => {
        expect(pinged).toEqual(["mbx-sean", "mbx-support"]);
        // Nothing was accepted, so nothing is announced.
        await emailWorker().email(message("mary@example.com", "nobody@rafters.studio").m, env);
        expect(pinged).toHaveLength(2);
      });
    });

    Scenario("A ping that throws still accepts", ({ Given, When, Then }) => {
      let w: World;
      let ns: ReturnType<typeof mailboxes>["ns"];
      let pinged: unknown[];
      let logged: ReturnType<typeof vi.spyOn>;
      let errors: unknown[][];
      let rejects: string[];
      let sent: ReturnType<typeof message>;

      Given("a ping that throws", () => {
        w = world();
        ({ ns, pinged } = mailboxes(true));
        logged = vi.spyOn(console, "error").mockImplementation(() => {});
      });

      When("email runs", async () => {
        sent = message("mary@example.com", "sean@rafters.studio");
        rejects = sent.rejects;
        await emailWorker().email(sent.m, { ...w.env, IMAP_MAILBOX: ns });
        errors = [...logged.mock.calls];
      });

      Then("the message is stored, the sender sees nothing, and it is logged", () => {
        expect(pinged).toEqual(["mbx-sean"]);
        expect(rejects).toEqual([]);
        expect(w.rows()).toHaveLength(1);
        expect(errors).toHaveLength(1);
        logged.mockRestore();
      });
    });

    Scenario("With no binding nothing changes", ({ Given, When, Then }) => {
      let w: World;
      let logged: ReturnType<typeof vi.spyOn>;
      let errors: unknown[][];
      let rejects: string[];
      let sent: ReturnType<typeof message>;

      Given("IMAP_MAILBOX unbound", () => {
        w = world();
        logged = vi.spyOn(console, "error").mockImplementation(() => {});
      });

      When("email runs", async () => {
        sent = message("mary@example.com", "sean@rafters.studio");
        rejects = sent.rejects;
        await emailWorker().email(sent.m, w.env);
        errors = [...logged.mock.calls];
      });

      Then("nothing is called and receiving behaves as before", () => {
        expect(rejects).toEqual([]);
        expect(w.rows()).toHaveLength(1);
        expect(errors).toEqual([]);
        logged.mockRestore();
      });
    });
  },
  owns("FR-MAIL-038-c3", "FR-MAIL-038-c4", "FR-MAIL-038-c5"),
);
