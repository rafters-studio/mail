// Keeping what was sent, answering a retry from its row, and one object per connection, on the real
// send log and directory (FR-MAIL-042, FR-MAIL-043).
import { DatabaseSync } from "node:sqlite";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { binary } from "../../core/src/read/index.ts";
import { feature, owns } from "../../core/tests/feature.ts";
import { bindingTransport, imapWorker } from "../src/index.ts";
import { fakeState, gate, MAILBOX, migration, UpgradeResponse, USER } from "./imap-world.ts";
import { BYTES, input, submitWorld, SubmitSession } from "./submit-world.ts";
import { clock } from "./clock.ts";

// A 26 MB message takes seconds to decode, and each login derives a key.
vi.setConfig({ testTimeout: 60_000 });

const T = Date.parse("2026-11-02T12:00:00.000Z");
const SENT = `${MAILBOX}/Sent`;
const WINDOW = 900_000;

type World = ReturnType<typeof submitWorld>;
type Outcomes = Awaited<ReturnType<ReturnType<World["ports"]>["submit"]>>;
type Client = Awaited<ReturnType<World["connect"]>>;

/** A row in `sends` as an earlier attempt left it. */
function seed(
  w: World,
  recipient: string,
  state: string,
  updatedAt: number,
  columns: { final?: number; stage?: string; text?: string; providerId?: string } = {},
) {
  w.db
    .prepare(
      "INSERT INTO sends (message_id, recipient, mail_from, provider, state, final, stage, text, provider_id, updated_at) VALUES (?, ?, ?, 'cloudflare', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "h1@hold.invalid",
      recipient,
      USER,
      state,
      columns.final ?? null,
      columns.stage ?? null,
      columns.text ?? null,
      columns.providerId ?? null,
      new Date(updatedAt).toISOString(),
    );
}

const before = () => {
  vi.stubGlobal("Response", UpgradeResponse);
  vi.spyOn(console, "error").mockImplementation(() => {});
};
const after = () => {
  clock.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
};

const FR042 = await feature("FR-MAIL-042");
const FR043 = await feature("FR-MAIL-043");

describeFeature(
  FR042,
  ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
    BeforeEachScenario(before);
    AfterEachScenario(after);

    Scenario("A send keeps its bytes and its link", ({ Given, When, Then }) => {
      let w: World;
      let to: string[];
      let outcomes: Outcomes;

      Given("a message accepted", () => {
        w = submitWorld();
        to = ["a@x.example", "b@x.example"];
      });

      When("ports.submit runs", async () => {
        outcomes = await w.ports().submit(input({ to }));
      });

      Then(
        "the blob, a delivery row to mailbox/Sent with via submission, and a submissions row exist, and the mailbox is pinged",
        () => {
          expect(outcomes.map((o) => [o.recipient, o.kind])).toEqual([
            ["a@x.example", "accepted"],
            ["b@x.example", "accepted"],
          ]);
          expect(w.handed.map((m) => m.to)).toEqual(to);
          expect(w.blobs.get("sha256/k1")).toEqual(BYTES);
          expect(w.rows("SELECT blob, mailbox, mail_from, rcpt_to, via FROM deliveries")).toEqual([
            {
              blob: "sha256/k1",
              mailbox: SENT,
              mail_from: USER,
              rcpt_to: "a@x.example, b@x.example",
              via: "submission",
            },
          ]);
          expect(
            w.rows("SELECT hold_key, mailbox, message_id, subject, blob FROM submissions"),
          ).toEqual([
            {
              hold_key: "h1@hold.invalid",
              mailbox: MAILBOX,
              message_id: "v1@rafters.studio",
              subject: "Hi",
              blob: "sha256/k1",
            },
          ]);
          expect(w.pings).toEqual([`name:${SENT}`]);
        },
      );
    });

    Scenario("A send refused entirely keeps nothing but its link", ({ Given, When, Then }) => {
      let w: World;
      let outcome: Outcomes[number] | undefined;

      Given("every recipient refused", () => {
        w = submitWorld();
        w.email.answer = () => ({ code: "E_RECIPIENT_SUPPRESSED", message: "no" });
      });

      When("ports.submit runs", async () => {
        [outcome] = await w.ports().submit(input());
      });

      Then("there is no blob and no Sent row, and a submissions row exists", () => {
        expect(outcome?.kind).toBe("refused");
        expect(w.blobs.size).toBe(0);
        expect(w.rows("SELECT * FROM deliveries")).toEqual([]);
        expect(w.rows("SELECT hold_key FROM submissions")).toEqual([
          { hold_key: "h1@hold.invalid" },
        ]);
        expect(w.pings).toEqual([]);
      });
    });

    Scenario("A failure keeping never changes the reply", ({ Given, When, Then }) => {
      let failing: ((w: World) => void)[];

      Given("a failing put, row and ping, each after an accepted send", () => {
        failing = [
          (w) => {
            w.r2.put = async () => {
              throw new Error("put");
            };
          },
          (w) => {
            w.fails.sql = /INSERT INTO deliveries/;
          },
          (w) => {
            w.swap.reach = () => ({
              ping: async () => {
                throw new Error("ping");
              },
            });
          },
        ];
      });

      When("ports.submit runs", () => {
        // Each world's submit runs inside the Then's loop, beside its expect lines.
      });

      Then("each returns the outcomes, and it is logged", async () => {
        for (const fail of failing) {
          const w = submitWorld();
          fail(w);
          const logged = vi.mocked(console.error);
          logged.mockClear();
          const outcomes = await w.ports().submit(input());
          expect(outcomes.map((o) => o.kind)).toEqual(["accepted"]);
          expect(logged).toHaveBeenCalledOnce();
          expect(String(logged.mock.calls[0]?.[0])).toContain("h1@hold.invalid");
        }
      });
    });

    Scenario("A crash after the send still ends with one Sent copy", ({ Given, When, Then }) => {
      let steps: ((w: World) => () => void)[];

      Given(
        "a crash at each step of Keeping, against the real createSender and d1Sends on node:sqlite",
        () => {
          clock.set(T);
          // Each step of Keeping failing leaves what a crash there leaves; the first two also throw out of the port.
          steps = [
            (w) => {
              w.fails.sql = /INTO submissions/;
              return () => {
                w.fails.sql = null;
              };
            },
            (w) => {
              w.fails.sql = /UPDATE sends/;
              return () => {
                w.fails.sql = null;
              };
            },
            (w) => {
              const { put } = w.r2;
              w.r2.put = async () => {
                throw new Error("put");
              };
              return () => {
                w.r2.put = put;
              };
            },
            (w) => {
              w.fails.sql = /INTO mailboxes/;
              return () => {
                w.fails.sql = null;
              };
            },
            (w) => {
              w.fails.sql = /INTO deliveries/;
              return () => {
                w.fails.sql = null;
              };
            },
            (w) => {
              w.swap.reach = () => ({
                ping: async () => {
                  throw new Error("ping");
                },
              });
              return () => {
                w.swap.reach = () => ({ ping: async () => undefined });
              };
            },
          ];
        },
      );

      When("the same bytes are retried, past the running window", () => {
        // Each crash and its retries run inside the Then's loop, beside its expect lines.
      });

      Then(
        "each ends with the recipient sent to once and at most one Sent UID after a pull where any was accepted",
        async () => {
          for (const crash of steps) {
            const w = submitWorld();
            const recover = crash(w);
            await w
              .ports()
              .submit(input())
              .catch(() => undefined);
            recover();
            clock.advance(WINDOW + 1);
            const retried = await w.ports().submit(input());
            const again = await w.ports().submit(input());
            expect(w.handed).toHaveLength(1);
            expect(retried.map((o) => o.kind)).toEqual(again.map((o) => o.kind));
            expect(await w.uids(SENT)).toBe(1);
          }
        },
      );
    });

    Scenario("A retry answers from its row, in envelope order", ({ Given, When, Then }) => {
      let w: World;
      let outcomes: Outcomes;

      Given(
        "held rows accepted, final and unknown, in an order unlike the envelope, and a row for a recipient outside this envelope",
        () => {
          clock.set(T);
          w = submitWorld();
          const old = T - WINDOW - 1;
          seed(w, "z@x.example", "accepted", old);
          seed(w, "c@x.example", "unknown", old, { text: "code: lost" });
          seed(w, "b@x.example", "refused", old, {
            final: 1,
            stage: "provider",
            text: "suppressed",
          });
          seed(w, "a@x.example", "accepted", old, { providerId: "cf-a" });
        },
      );

      When("ports.submit runs", async () => {
        outcomes = await w
          .ports()
          .submit(input({ to: ["a@x.example", "new@x.example", "b@x.example", "c@x.example"] }));
      });

      Then(
        "each recipient has its row's outcome in envelope order, and the outside row is left out",
        async () => {
          expect(outcomes).toEqual([
            { recipient: "a@x.example", kind: "accepted", providerId: "cf-a", text: null },
            {
              recipient: "new@x.example",
              kind: "accepted",
              providerId: "cf-new@x.example",
              text: null,
            },
            {
              recipient: "b@x.example",
              kind: "refused",
              final: true,
              stage: "provider",
              code: null,
              text: "suppressed",
            },
            { recipient: "c@x.example", kind: "unknown", detail: "code: lost" },
          ]);
          expect(w.handed.map((m) => m.to)).toEqual(["new@x.example"]);

          // An unknown row is told of as mail, to the sender's own INBOX with no send.
          const notice = new TextEncoder().encode(
            "Message-ID: <n@rafters.studio>\r\n\r\nmay not have gone\r\n",
          );
          await w.ports().notify(MAILBOX, notice, USER);
          expect(
            w.rows("SELECT mailbox, mail_from, rcpt_to FROM deliveries WHERE via = 'notice'"),
          ).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
          expect(w.pings.at(-1)).toBe(`name:${MAILBOX}`);
        },
      );
    });

    Scenario(
      "A young unknown row says still sending, and tells nobody",
      ({ Given, When, Then }) => {
        let w: World;
        let young: Outcomes[number] | undefined;
        let old: Outcomes[number] | undefined;

        Given("an unknown row younger and older than 900 seconds", () => {
          clock.set(T);
          w = submitWorld();
          seed(w, "young@x.example", "unknown", T - WINDOW + 1);
          seed(w, "old@x.example", "unknown", T - WINDOW);
        });

        When("ports.submit runs", async () => {
          [young, old] = await w
            .ports()
            .submit(input({ to: ["young@x.example", "old@x.example"] }));
        });

        Then(
          "the younger is refused not final with the text still sending, and the older is unknown",
          async () => {
            expect(young).toEqual({
              recipient: "young@x.example",
              kind: "refused",
              final: false,
              stage: "provider",
              code: null,
              text: "still sending",
            });
            expect(old).toEqual({
              recipient: "old@x.example",
              kind: "unknown",
              detail: "no answer recorded",
            });
            expect(w.handed).toEqual([]);

            // The session tells nobody of a row still sending: the app is asked to try again.
            const alone = submitWorld();
            seed(alone, "young@x.example", "unknown", T);
            const [only] = await alone.ports().submit(input({ to: ["young@x.example"] }));
            expect(only?.kind).toBe("refused");
            expect(alone.rows("SELECT * FROM deliveries")).toEqual([]);
          },
        );
      },
    );

    Scenario("Every mailbox has a Sent", ({ Given, When, Then }) => {
      let db: DatabaseSync;
      let w: World;

      Given("the migration run twice, and a mailbox made after it", () => {
        db = new DatabaseSync(":memory:");
        db.exec(migration("0001_receiving.sql"));
        db.exec("INSERT INTO mailboxes (id) VALUES ('a'), ('b');");
        const sql = migration("0004_sent.sql");
        const statement = /^INSERT[^;]+;/m.exec(sql)?.[0] ?? "";
        db.exec(statement);
        db.exec(statement);
        // The world's mailbox is made after the migration, and foreign keys are on.
        w = submitWorld();
      });

      When("a send runs", () => {
        // The send runs inside the Then, between the expect lines on the world's mailboxes.
      });

      Then(
        "rows are added once, there is no /Sent/Sent, and the later mailbox gets its Sent",
        async () => {
          const ids = db.prepare("SELECT id FROM mailboxes ORDER BY id").all();
          expect(ids.map((row) => row["id"])).toEqual(["a", "a/Sent", "b", "b/Sent"]);
          expect(w.rows(`SELECT id FROM mailboxes WHERE id = '${SENT}'`)).toEqual([]);
          await w.ports().submit(input());
          expect(w.rows(`SELECT id FROM mailboxes WHERE id = '${SENT}'`)).toEqual([{ id: SENT }]);
          expect(w.rows("SELECT mailbox FROM deliveries")).toEqual([{ mailbox: SENT }]);
        },
      );
    });

    Scenario("The binding decodes to one flat string", ({ Given, When, Then }) => {
      let bytes: Uint8Array;
      let raw = "";
      let perByte: unknown[];

      Given("26 MB of 7-bit bytes", () => {
        bytes = new Uint8Array(26 * 1000 * 1000).fill(0x61);
        bytes.set([0x0d, 0x0a], bytes.length - 2);
      });

      When("bindingTransport sends them", async () => {
        const transport = bindingTransport({ send: async () => undefined }, (from, to, given) => {
          raw = given;
          return { from, to };
        });
        const from = vi.spyOn(Array, "from");
        await transport.send({ bytes, envelope: { from: "me@x.example", to: ["a@x.example"] } });
        perByte = from.mock.calls.filter(([items]) => items === bytes);
        from.mockRestore();
      });

      Then("the text equals the bytes, built without one element per byte", () => {
        expect(perByte).toEqual([]);
        expect(raw === Buffer.from(bytes).toString("latin1")).toBe(true);
      });
    });

    Scenario("mayUse follows the directory's own row", ({ Given, When, Then }) => {
      let w: World;

      Given(
        "a mailbox's own row, its tagged row, another mailbox's tagged row, a disabled row, and a catch-all",
        () => {
          w = submitWorld();
          w.db
            .exec(`INSERT INTO addresses (local, domain, mailbox) VALUES ('sean+tag', 'rafters.studio', '${MAILBOX}');
INSERT INTO addresses (local, domain, mailbox) VALUES ('sean+theirs', 'rafters.studio', 'mbx-other');
INSERT INTO addresses (local, domain, mailbox, enabled) VALUES ('off', 'rafters.studio', '${MAILBOX}', 0);`);
        },
      );

      When("mayUse runs", () => {
        // Each mayUse call runs inside the Then, wrapped by its expect.
      });

      Then("only the first two are true", async () => {
        const { mayUse } = w.ports();
        expect(await mayUse(MAILBOX, "Se.an@rafters.studio")).toBe(true);
        expect(await mayUse(MAILBOX, "sean+tag@rafters.studio")).toBe(true);
        expect(await mayUse(MAILBOX, "sean+theirs@rafters.studio")).toBe(false);
        expect(await mayUse(MAILBOX, "off@rafters.studio")).toBe(false);
        expect(await mayUse(MAILBOX, "ceo@rafters.studio")).toBe(false);
        expect(await mayUse(MAILBOX, "no-domain")).toBe(false);
      });
    });
  },
  owns(
    "FR-MAIL-042-c1",
    "FR-MAIL-042-c2",
    "FR-MAIL-042-c3",
    "FR-MAIL-042-c4",
    "FR-MAIL-042-c5",
    "FR-MAIL-042-c6",
    "FR-MAIL-042-c12",
    "FR-MAIL-042-c13",
    "FR-MAIL-042-c14",
  ),
);

describeFeature(
  FR043,
  ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
    BeforeEachScenario(before);
    AfterEachScenario(after);

    Scenario("354 goes out after data is saved", ({ Given, When, Then }) => {
      let client: Client;

      Given("a fake state recording order", async () => {
        const w = submitWorld();
        client = await w.loggedIn();
        await client.frame(`MAIL FROM:<${USER}>\r\nRCPT TO:<a@x.example>\r\n`);
        client.own.length = 0;
      });

      When("DATA runs", async () => {
        await client.frame("DATA\r\n");
      });

      Then("the save comes before the 354", () => {
        expect(client.own.at(0)).toBe("write");
        expect(client.own.at(-1)).toBe("send");
        expect(client.own.filter((step) => step === "send")).toHaveLength(1);
        const [saved] = client.state.mem.sql.exec("SELECT v FROM state WHERE k = 'snapshot'");
        expect(String(saved?.["v"])).toContain('"name":"data"');
        expect(client.text()).toContain("354 ");
      });
    });

    Scenario("A stall in DATA keeps the message", ({ Given, When, Then }) => {
      let w: World;
      const timers = () => ({
        started: vi.spyOn(globalThis, "setInterval"),
        ended: vi.spyOn(globalThis, "clearInterval"),
      });
      let started: ReturnType<typeof timers>["started"];
      let ended: ReturnType<typeof timers>["ended"];
      let client: Client;
      let before: number;
      let endedCalls: ReturnType<typeof timers>["ended"]["mock"]["calls"];

      Given("a timer held while in data, and a stall", async () => {
        w = submitWorld();
        ({ started, ended } = timers());
        client = await w.inData();
        expect(started).toHaveBeenCalledOnce();
        expect(started.mock.calls[0]?.[1]).toBe(5_000);
        await client.frame(
          `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nfirst\r\n`,
        );
        // A pause: the timer runs, and the message is still in memory.
        started.mock.calls[0]?.[0]();
        expect(started).toHaveBeenCalledOnce();
        expect(ended).not.toHaveBeenCalled();
        before = client.text().length;
      });

      When("the rest of the message arrives", async () => {
        await client.frame("second\r\n.\r\n");
        endedCalls = [...ended.mock.calls];
      });

      Then("the message is answered, and the timer has ended", async () => {
        expect(client.text(before)).toBe("250 Ok\r\n");
        expect(w.handed).toHaveLength(1);
        expect(endedCalls).toHaveLength(1);

        // Evicted in spite of it, a restart reads nothing as a command.
        const lost = await submitWorld().inData();
        lost.evict();
        const at = lost.text().length;
        await lost.frame(`MAIL FROM:<${USER}>\r\n`);
        expect(lost.text(at)).toBe("421 Connection lost\r\n");
        expect(lost.server.closes).toEqual([1000]);
        expect([...endedCalls, ...ended.mock.calls]).toHaveLength(1);
      });
    });

    Scenario("Nothing of a message reaches storage", ({ Given, When, Then }) => {
      let w: World;
      let client: Client;
      const writes: string[] = [];

      Given("a message with a marker in it", async () => {
        w = submitWorld();
        client = await w.loggedIn();
        client.state.mem.hook.refuse = (sql, values) => {
          writes.push(
            `${sql} ${values.map((value) => binary(new TextEncoder().encode(String(value)))).join(" ")}`,
          );
          return false;
        };
        await client.frame(`MAIL FROM:<${USER}>\r\nRCPT TO:<a@x.example>\r\nDATA\r\n`);
        await client.frame(
          `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nthe-marker\r\n.\r\n`,
        );
        await client.frame("NOOP\r\n");
      });

      When("every write is read", () => {
        // The writes were recorded by the refuse hook as they happened; the Then reads them.
      });

      Then("none holds the marker", () => {
        expect(w.handed).toHaveLength(1);
        expect(writes.length).toBeGreaterThan(0);
        for (const write of writes) expect(write).not.toContain("the-marker");
      });
    });

    Scenario("A frame moves the idle alarm, and passing it closes", ({ Given, When, Then }) => {
      let moving: Client;
      let silent: Client;

      Given("a session in DATA receiving frames, and one silent", async () => {
        clock.set(T);
        moving = await submitWorld().inData();
        silent = await submitWorld().inData();
        expect(moving.state.alarm.at).toBe(T + 300_000);

        clock.set(T + 299_000);
        await moving.frame(`From: ${USER}\r\n`);
        expect(moving.state.alarm.at).toBe(T + 599_000);
      });

      When("300 seconds pass", async () => {
        clock.set(T + 300_000);
        await moving.fire();
        await silent.fire();
      });

      Then("the first stays open, and the second answers 421 Idle and closes", () => {
        expect(moving.server.closes).toEqual([]);
        expect(silent.text().endsWith("421 Idle\r\n")).toBe(true);
        expect(silent.server.closes).toEqual([1000]);
        expect(silent.state.alarm.at).toBeNull();
      });
    });

    Scenario("It ends as the IMAP object does", ({ Given, When, Then }) => {
      const ended = (client: { own: string[] }) => expect(client.own).toContain("deleteAll");

      Given("a QUIT, a client close, a store failure and a login never made", () => {
        // Each session is made inside the Then, beside the expect lines on how it ends.
      });

      When("the session ends", () => {
        // Each session ends inside the Then, between its expect lines.
      });

      Then(
        "it calls deleteAll, and a call finishing afterward saves and sends nothing",
        async () => {
          const quit = await submitWorld().connect();
          await quit.frame("NOOP\r\n");
          quit.own.length = 0;
          await quit.frame("NOOP\r\n");
          expect(quit.own).toEqual(["send"]);
          await quit.frame("QUIT\r\n");
          expect(quit.text().endsWith("221 Bye\r\n")).toBe(true);
          expect(quit.server.closes).toEqual([1000]);
          ended(quit);

          for (const leave of ["webSocketClose", "webSocketError"] as const) {
            const gone = await submitWorld().connect();
            await gone.conn.object[leave](gone.server.socket);
            expect(gone.server.closes).toEqual([undefined]);
            ended(gone);
            // With nothing stored the alarm does nothing.
            await gone.conn.object.alarm();
            expect(gone.server.closes).toEqual([undefined]);
          }

          const failing = await submitWorld().loggedIn();
          failing.state.mem.hook.refuse = () => true;
          await failing.frame(`MAIL FROM:<${USER}>\r\n`);
          expect(failing.server.closes).toEqual([1011]);
          ended(failing);

          clock.set(T);
          const never = await submitWorld().connect();
          expect(never.state.alarm.at).toBe(T + 60_000);
          await never.frame("NOOP\r\n");
          expect(never.state.alarm.at).toBe(T + 60_000);
          clock.set(T + 60_000);
          await never.fire();
          expect(never.text()).not.toContain("421");
          expect(never.server.closes).toEqual([1000]);
          ended(never);
          clock.reset();

          const talking = await submitWorld().connect();
          for (let i = 0; i < 100; i++) await talking.frame("NOOP\r\n");
          expect(talking.server.closes).toEqual([]);
          await talking.frame("NOOP\r\n");
          expect(talking.server.closes).toEqual([1000]);
          ended(talking);

          // A call finishing afterward saves and sends nothing.
          const w = submitWorld();
          const late = await w.inData();
          const held = gate();
          const { send } = w.env.EMAIL;
          const reached = gate();
          w.env.EMAIL.send = async (message) => {
            reached.open();
            await held.promise;
            return send(message);
          };
          const finishing = late.frame(
            `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nbody\r\n.\r\n`,
          );
          // The event: the session has called the binding, and it writes the sends row before that call.
          await reached.promise;
          expect(w.rows("SELECT * FROM sends")).toHaveLength(1);
          const before = late.text().length;
          await late.conn.object.webSocketClose(late.server.socket);
          late.own.length = 0;
          held.open();
          await finishing;
          expect(late.text(before)).toBe("");
          expect(late.own).toEqual([]);
        },
      );
    });

    Scenario("The Worker reaches it", ({ Given, When, Then }) => {
      let w: World;
      const reached: unknown[] = [];
      const environment = (w: World) => {
        const made = {
          idFromName: () => "by-name",
          idFromString: () => "by-string",
          newUniqueId: () => `unique-${reached.length + 1}`,
          get: (id: unknown) => {
            reached.push(id);
            return {
              fetch: async () => new UpgradeResponse(null, { status: 101 }) as unknown as Response,
            };
          },
        };
        return { IMAP_SESSION: w.env.IMAP_SESSION, SUBMIT_SESSION: made, BRIDGE_SECRET: "secret" };
      };
      let env: ReturnType<typeof environment>;
      let fetch: ReturnType<typeof imapWorker>["fetch"];
      let request: (headers: Record<string, string>) => Request;
      const upgrade = { upgrade: "websocket" };
      const good = { authorization: "Bearer secret", ...upgrade };

      Given("/submit with a good secret and with none", () => {
        w = submitWorld();
        env = environment(w);
        request = (headers) => new Request("https://mail.example/submit", { headers });
      });

      When("fetch runs", () => {
        ({ fetch } = imapWorker());
        // Each fetch runs inside the Then, wrapped by its expect.
      });

      Then("it reaches a new object, and answers 401", async () => {
        expect((await fetch(request(good), env)).status).toBe(101);
        expect((await fetch(request(good), env)).status).toBe(101);
        expect(reached).toEqual(["unique-1", "unique-2"]);
        expect((await fetch(request(upgrade), env)).status).toBe(401);
        expect(reached).toHaveLength(2);
        const { SUBMIT_SESSION: _, ...imapOnly } = env;
        expect((await fetch(request(good), imapOnly)).status).toBe(404);

        // The object it reaches greets with the name in env, then and after a resume.
        const client = await w.connect();
        expect(client.response.status).toBe(101);
        expect(client.text()).toBe("220 smtp.example ESMTP\r\n");
        client.evict();
        await client.frame("HELO me\r\n");
        expect(client.text()).toBe("220 smtp.example ESMTP\r\n250 smtp.example\r\n");

        // Without a client address it answers 400, and without a name it throws rather than greet wrongly.
        const object = (over: { SUBMIT_HOSTNAME: string }) =>
          new SubmitSession(fakeState({ hex: "alone" }).ctx, { ...w.env, ...over });
        const named = object({ SUBMIT_HOSTNAME: "smtp.example" });
        expect((await named.fetch(new Request("https://mail.example/submit"))).status).toBe(400);
        const nameless = object({ SUBMIT_HOSTNAME: "" });
        await expect(
          nameless.fetch(
            new Request("https://mail.example/submit", {
              headers: { "X-Client-Address": "192.0.2.1" },
            }),
          ),
        ).rejects.toThrow();
      });
    });
  },
  owns(
    "FR-MAIL-043-c1",
    "FR-MAIL-043-c2",
    "FR-MAIL-043-c3",
    "FR-MAIL-043-c4",
    "FR-MAIL-043-c5",
    "FR-MAIL-043-c6",
  ),
);
