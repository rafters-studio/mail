// Revoking a mailbox ends every session logged in to it (FR-MAIL-049, research 01a1a4c4): sessions
// register at login, and revoke reaches each, bounded as telling is.
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import { readState } from "../src/imap-objects.ts";
import { clock } from "./clock.ts";
import { expire, pending } from "./deadline.ts";
import { box, gate, held, UpgradeResponse, USER, world } from "./imap-world.ts";
import { submitWorld } from "./submit-world.ts";

const LOGIN = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
const AUTH = `AUTH PLAIN ${btoa(`\0${USER}\0correct horse`)}\r\n`;
const T = Date.parse("2026-11-02T12:00:00.000Z");
const NONE = { told: 0, closed: 0, failed: 0 };

type Box = ReturnType<typeof box>;
type World = ReturnType<typeof world>;
type Imap = Awaited<ReturnType<World["connect"]>>;
type Submit = Awaited<ReturnType<ReturnType<typeof submitWorld>["connect"]>>;
type Revoked = Awaited<ReturnType<Box["object"]["revoke"]>>;

const names = (rows: Iterable<Record<string, unknown>>) => [...rows].map((row) => row["name"]);
/** The names a world's mailbox holds in one table. */
const registered = (w: Pick<World, "mailboxState">, table: "sessions" | "submit_sessions") =>
  names(w.mailboxState.mem.sql.exec(`SELECT name FROM ${table} ORDER BY name`));
const lines = (calls: unknown[][]) => calls.map(([line]) => String(line));
const clearing = () => vi.spyOn(globalThis, "clearInterval");

const FR049 = await feature("FR-MAIL-049");

describeFeature(
  FR049,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.stubGlobal("Response", UpgradeResponse);
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      clock.reset();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario(
      "A session registers when it logs in, before it is told so",
      ({ Given, When, Then }) => {
        let w: World;
        let client: Imap;

        Given(
          "a client that sends LOGIN with a correct password and has not selected",
          async () => {
            w = world();
            client = await w.connect();
            w.swap.mailbox = {
              register: async (session) => {
                await w.mailbox().register(session);
                client.own.push("register");
              },
            };
            client.own.length = 0;
          },
        );

        When("the session answers OK", async () => {
          await client.frame(LOGIN);
        });

        Then(
          "the session's name is registered with the account's mailbox, and the registration completed before the OK was sent",
          () => {
            expect(client.server.text()).toContain("a OK");
            expect(registered(w, "sessions")).toEqual([client.hex]);
            expect(client.own.filter((step) => step === "send")).toHaveLength(1);
            expect(client.own.indexOf("register")).toBeGreaterThanOrEqual(0);
            expect(client.own.indexOf("register")).toBeLessThan(client.own.indexOf("send"));
          },
        );
      },
    );

    Scenario("A registration that fails gives no login", ({ Given, When, Then }) => {
      let imap: Imap;
      let submit: Submit;

      Given("the mailbox rejects a registration at login", async () => {
        const w = world();
        w.swap.mailbox = { register: () => Promise.reject(new Error("refused")) };
        imap = await w.connect();
        const s = submitWorld();
        s.swap.mailbox = { registerSubmission: () => Promise.reject(new Error("refused")) };
        submit = await s.connect();
      });

      When("a client sends IMAP LOGIN or submission AUTH with a correct password", async () => {
        await imap.frame(LOGIN);
        await submit.frame(AUTH);
      });

      Then(
        "the client gets no success reply, the socket closes with 1011, and the session's state is deleted",
        () => {
          expect(imap.server.text()).not.toContain("a OK");
          expect(imap.server.closes).toEqual([1011]);
          expect(imap.own).toContain("deleteAll");
          expect(readState(imap.state.mem.sql).size).toBe(0);
          expect(submit.text()).not.toContain("235");
          expect(submit.server.closes).toEqual([1011]);
          expect(submit.own).toContain("deleteAll");
          expect(readState(submit.state.mem.sql).size).toBe(0);
        },
      );
    });

    Scenario("A message still being uploaded is dropped", ({ Given, When, Then }) => {
      let w: ReturnType<typeof submitWorld>;
      let client: Submit;
      let ended: ReturnType<typeof clearing>;
      let endedCalls: unknown[][];
      let count: number;

      Given("a submission session inside DATA with a message partly received", async () => {
        w = submitWorld();
        ended = clearing();
        client = await w.inData();
        await client.frame(`From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\npart\r\n`);
      });

      When("revoked runs", async () => {
        ended.mockClear();
        count = await client.conn.object.revoked();
        endedCalls = [...ended.mock.calls];
      });

      Then(
        "the client receives 421 Credential revoked, its socket closes, the message is not handed to the binding, and the hold timer is cleared",
        () => {
          expect(count).toBe(1);
          expect(client.text().endsWith("421 Credential revoked\r\n")).toBe(true);
          expect(client.server.closes).toHaveLength(1);
          expect(w.handed).toEqual([]);
          expect(endedCalls).toHaveLength(1);
          expect(w.rows("SELECT * FROM submissions")).toEqual([]);
        },
      );
    });

    Scenario("A message already handed to the binding is not recalled", ({ Given, When, Then }) => {
      let w: ReturnType<typeof submitWorld>;
      let client: Submit;
      let reached: ReturnType<typeof gate<void>>;
      let answer: ReturnType<typeof gate<void>>;

      Given(
        "a submission session whose message has been handed to the binding and has not been answered",
        async () => {
          w = submitWorld();
          client = await w.inData();
          reached = gate();
          answer = gate();
          w.hold.send = async () => {
            reached.open();
            await answer.promise;
          };
        },
      );

      When("revoked runs and the binding then answers", () => {
        // The send is in flight from the message to its answer, across revoked, so the Then runs it all.
      });

      Then(
        "nothing throws, no further reply is sent, and nothing is written back to the session's state",
        async () => {
          let thrown: unknown = null;
          const sending = client.frame(
            `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nbody\r\n.\r\n`,
          );
          await reached.promise;
          await client.conn.object.revoked();
          const after = { text: client.text().length, own: client.own.length };
          answer.open();
          await sending.catch((error: unknown) => {
            thrown = error;
          });
          const errors = [...vi.mocked(console.error).mock.calls];
          expect(thrown).toBeNull();
          expect(lines(errors).filter((line) => line.includes("submit session: failed"))).toEqual(
            [],
          );
          expect(w.handed).toHaveLength(1);
          expect(client.text().endsWith("421 Credential revoked\r\n")).toBe(true);
          expect(client.text().length).toBe(after.text);
          expect(client.own.slice(after.own)).toEqual([]);
          expect(readState(client.state.mem.sql).size).toBe(0);
        },
      );
    });

    Scenario(
      "A logged-in unselected session hears nothing of a change",
      ({ Given, When, Then }) => {
        let w: World;
        let client: Imap;
        let before: number;
        let answered: unknown[];

        Given("a logged-in unselected IMAP session", async () => {
          w = world();
          client = await w.connect();
          await client.frame(LOGIN);
          before = client.server.text().length;
        });

        When("the mailbox tells its sessions of a change", async () => {
          const changed = vi.spyOn(client.object, "changed");
          await w.mailbox().setFlags(1, []);
          await w.mailboxState.settled();
          answered = await Promise.all(changed.mock.results.map((result) => result.value));
        });

        Then("changed gives true, the client receives no bytes, and the socket stays open", () => {
          expect(answered).toEqual([true]);
          expect(client.server.text().length).toBe(before);
          expect(client.server.closes).toEqual([]);
          expect(registered(w, "sessions")).toEqual([client.hex]);
        });
      },
    );

    Scenario("Telling reaches IMAP sessions alone", ({ Given, When, Then }) => {
      let b: Box;
      let reached: unknown[][];

      Given("a mailbox with both an IMAP session and a submission session registered", async () => {
        b = box();
        await b.object.register("imap-one");
        await b.object.registerSubmission("submit-one");
      });

      When("it tells its sessions of a change", async () => {
        const ids = vi.spyOn(b.env.IMAP_SESSION, "idFromString");
        await b.object.setFlags(1, []);
        await b.state.settled();
        reached = [...ids.mock.calls];
      });

      Then(
        "changed is called only for the IMAP session, no call goes through the IMAP session namespace with the submission session's name, and no tell stays owed",
        () => {
          expect(b.told).toEqual(["imap-one"]);
          expect(reached).toEqual([["imap-one"]]);
          expect(b.rows("SELECT v FROM meta WHERE k = 'tell-owed'")).toEqual([]);
        },
      );
    });

    Scenario("A submission session that ends forgets its name", ({ Given, When, Then }) => {
      type Ending = { w: ReturnType<typeof submitWorld>; client: Submit };
      let endings: Record<"quit" | "close" | "idle" | "rejected", Ending>;
      let errors: unknown[][];

      Given("a logged-in submission session", async () => {
        clock.set(T);
        const ending = async (): Promise<Ending> => {
          const w = submitWorld();
          const client = await w.loggedIn();
          expect(registered(w, "submit_sessions")).toEqual(["submit"]);
          return { w, client };
        };
        endings = {
          quit: await ending(),
          close: await ending(),
          idle: await ending(),
          rejected: await ending(),
        };
        endings.rejected.w.swap.mailbox = {
          forgetSubmission: () => Promise.reject(new Error("refused")),
        };
      });

      When(
        "it ends by QUIT, by the client closing, or by its idle alarm, and again when the forget rejects",
        async () => {
          await endings.quit.client.frame("QUIT\r\n");
          await endings.close.client.conn.object.webSocketClose(endings.close.client.server.socket);
          clock.set(T + 300_000);
          await endings.idle.client.fire();
          const rejected = endings.rejected.client;
          await rejected.conn.object.webSocketClose(rejected.server.socket);
          errors = [...vi.mocked(console.error).mock.calls];
        },
      );

      Then(
        "its name is no longer registered with the mailbox; and when the forget rejects, the failure is logged and the session's state is still deleted",
        () => {
          for (const way of ["quit", "close", "idle"] as const) {
            expect(registered(endings[way].w, "submit_sessions")).toEqual([]);
            expect(endings[way].client.own).toContain("deleteAll");
          }
          expect(endings.idle.client.text().endsWith("421 Idle\r\n")).toBe(true);
          expect(
            lines(errors).filter((line) => line === "submit session: forget failed"),
          ).toHaveLength(1);
          const rejected = endings.rejected.client;
          expect(rejected.own).toContain("deleteAll");
          expect(readState(rejected.state.mem.sql).size).toBe(0);
        },
      );
    });

    Scenario("A connection that has not logged in is not touched", ({ Given, When, Then }) => {
      let empty: World;
      let full: World;
      let fresh: Imap[];
      let logged: Imap;
      let before: number[];
      let results: Revoked[];

      Given(
        "a connection that has not logged in, and a mailbox with no registered session",
        async () => {
          empty = world();
          full = world();
          fresh = [await empty.connect(), await full.connect()];
          logged = await full.connect();
          await logged.frame(LOGIN);
          before = fresh.map((client) => client.server.text().length);
        },
      );

      When("revoke runs, and runs again after a first that closed every session", async () => {
        const first = await empty.mailbox().revoke();
        const closing = await full.mailbox().revoke();
        const again = await full.mailbox().revoke();
        results = [first, closing, again];
      });

      Then(
        "that connection is not told and stays open, and revoke gives told 0, closed 0 and failed 0",
        () => {
          const [first, closing, again] = results;
          expect(first).toEqual(NONE);
          expect(closing).toEqual({ told: 1, closed: 1, failed: 0 });
          expect(logged.server.text().endsWith("* BYE credential revoked\r\n")).toBe(true);
          expect(again).toEqual(NONE);
          expect(fresh.map((client) => client.server.text().length)).toEqual(before);
          expect(fresh.map((client) => client.server.closes)).toEqual([[], []]);
          expect(registered(full, "sessions")).toEqual([]);
        },
      );
    });

    Scenario(
      "A session that does not answer counts as failed and is told again",
      ({ Given, When, Then }) => {
        let b: Box;
        let reached: string[];
        let asked: { ms: number; reason: string }[];
        let result: Revoked;
        let errors: unknown[][];

        Given(
          "one registered session that never answers revoked and one that answers, with revoke's bound held by the test",
          async () => {
            reached = [];
            b = box(
              async () => true,
              (name) => {
                reached.push(name);
                return name === "silent" ? new Promise(() => {}) : Promise.resolve(1);
              },
              true,
              held.ImapMailbox,
            );
            await b.object.register("silent");
            await b.object.register("answering");
          },
        );

        When(
          "revoke runs, and the test reads the bound revoke asked for and fires it",
          async () => {
            const revoking = b.object.revoke();
            await new Promise((resolve) => setImmediate(resolve));
            asked = pending("tell");
            expire("tell");
            result = await revoking;
            errors = [...vi.mocked(console.error).mock.calls];
          },
        );

        Then(
          "the bound asked for is 10 seconds, revoke gives told 2, closed 1 and failed 1 and logs the failure, the unanswering name stays registered, and a later revoke, its bound fired the same way, tells it again",
          async () => {
            expect(asked).toEqual([{ ms: 10_000, reason: "no answer in 10 seconds" }]);
            expect(result).toEqual({ told: 2, closed: 1, failed: 1 });
            expect(
              lines(errors).filter((line) => line === "imap mailbox: revoking silent failed"),
            ).toHaveLength(1);
            expect(names(b.rows("SELECT name FROM sessions"))).toContain("silent");

            const later = b.object.revoke();
            await new Promise((resolve) => setImmediate(resolve));
            expect(pending("tell")).toEqual([{ ms: 10_000, reason: "no answer in 10 seconds" }]);
            expire("tell");
            expect((await later).failed).toBe(1);
            expect(reached.filter((name) => name === "silent")).toHaveLength(2);
          },
        );
      },
    );

    Scenario("A name with no socket goes", ({ Given, When, Then }) => {
      let b: Box;
      let result: Revoked;

      Given(
        "a registered IMAP name and a registered submission name whose revoked each gives 0 because the object has no socket",
        async () => {
          b = box(
            async () => true,
            async () => 0,
          );
          await b.object.register("imap-one");
          await b.object.registerSubmission("submit-one");
        },
      );

      When("revoke returns", async () => {
        result = await b.object.revoke();
      });

      Then("both names are no longer registered, and they count in told and not in failed", () => {
        expect(b.rows("SELECT name FROM sessions")).toEqual([]);
        expect(b.rows("SELECT name FROM submit_sessions")).toEqual([]);
        expect(result).toEqual({ told: 2, closed: 0, failed: 0 });
      });
    });

    Scenario(
      "A Worker with no submission binding still closes its IMAP sessions",
      ({ Given, When, Then }) => {
        let b: Box;
        let result: Revoked;
        let errors: unknown[][];

        Given(
          "a mailbox whose Worker binds no submission namespace and which holds a registered submission name",
          async () => {
            b = box(
              async () => true,
              async () => 1,
              false,
            );
            await b.object.register("imap-one");
            await b.object.registerSubmission("submit-one");
          },
        );

        When("revoke runs", async () => {
          result = await b.object.revoke();
          errors = [...vi.mocked(console.error).mock.calls];
        });

        Then(
          "its IMAP sessions still close, the name counts in failed, and the failure is logged",
          () => {
            expect(result).toEqual({ told: 2, closed: 1, failed: 1 });
            expect(
              lines(errors).filter((line) => line === "imap mailbox: revoking submit-one failed"),
            ).toHaveLength(1);
            expect(names(b.rows("SELECT name FROM submit_sessions"))).toEqual(["submit-one"]);
          },
        );
      },
    );

    Scenario("Registering at login adds to what SELECT does", ({ Given, When, Then }) => {
      let b: Box;

      Given("a name the mailbox was never told to register", () => {
        b = box();
        expect(b.rows("SELECT name FROM sessions")).toEqual([]);
      });

      When("open runs for INBOX with that name", async () => {
        await b.object.open("INBOX", "named");
      });

      Then("the name is registered", () => {
        expect(names(b.rows("SELECT name FROM sessions"))).toEqual(["named"]);
      });
    });
  },
  owns(
    "FR-MAIL-049-c1",
    "FR-MAIL-049-c2",
    "FR-MAIL-049-c6",
    "FR-MAIL-049-c7",
    "FR-MAIL-049-c8",
    "FR-MAIL-049-c9",
    "FR-MAIL-049-c10",
    "FR-MAIL-049-c11",
    "FR-MAIL-049-c12",
    "FR-MAIL-049-c13",
    "FR-MAIL-049-c14",
    "FR-MAIL-049-c17",
  ),
);
