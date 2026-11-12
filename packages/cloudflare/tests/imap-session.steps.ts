// The session object with real mailbox and core sessions behind fake state and sockets (FR-MAIL-035).
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import {
  fakeState,
  gate,
  idAt,
  ImapSession,
  login,
  mail,
  MAILBOX,
  UpgradeResponse,
  world,
} from "./imap-world.ts";

// A 25 MiB message takes seconds to read, write and frame.
vi.setConfig({ testTimeout: 60_000 });

const T = 0x019cafbf0000 + 600_000;
const LOGIN = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
const MIB = 1024 * 1024;

/** A world, and one connection past LOGIN and SELECT of one message. */
async function selected() {
  const w = world();
  w.deliver(idAt(T, 1), mail("one@x", "the body"));
  const client = await w.connect();
  await client.frame(LOGIN);
  await client.frame("b SELECT INBOX\r\n");
  await w.mailboxState.settled();
  return { w, client };
}

type Selected = Awaited<ReturnType<typeof selected>>;

/** How many mailboxes' sessions are registered. */
const registered = (w: ReturnType<typeof world>) =>
  [...w.mailboxState.mem.sql.exec("SELECT name FROM sessions")].map((r) => r["name"]);

const FR035 = await feature("FR-MAIL-035");

describeFeature(
  FR035,
  ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
    BeforeEachScenario(() => {
      vi.stubGlobal("Response", UpgradeResponse);
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    AfterEachScenario(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    Scenario("It saves before it sends", ({ Given, When, Then }) => {
      let client: Selected["client"];

      Given("a fake state recording order", async () => {
        const w = world();
        client = await w.connect();
        client.own.length = 0;
        await client.frame("a CAPABILITY\r\nb BAD\r\n");
        await client.frame("c\r\n");
        client.own.length = 0;
      });

      When("a command is received", async () => {
        await client.frame(LOGIN);
      });

      Then("the write comes before the send", () => {
        expect(client.own.slice(0, 2)).toEqual(["write", "write"]);
        expect(client.own.at(-1)).toBe("send");
        expect(client.own.indexOf("send")).toBeGreaterThan(client.own.lastIndexOf("write"));
      });
    });

    Scenario("A fresh instance continues the conversation", ({ Given, When, Then }) => {
      let client: Selected["client"];
      let before: number;

      Given(
        "a logged-in session with a selected mailbox and a partial command buffered",
        async () => {
          ({ client } = await selected());
          await client.frame("c FETCH 1 (U");
          before = client.server.text().length;
        },
      );

      When("a new instance on the same state receives the rest", async () => {
        const woken = client.evict();
        await client.frame("ID)\r\n", woken);
      });

      Then("it answers as the first would have", () => {
        expect(client.server.text().slice(before)).toBe(
          "* 1 FETCH (UID 1)\r\nc OK FETCH completed\r\n",
        );
      });
    });

    Scenario(
      "A silent loop before login writes nothing, and the frame cap closes",
      ({ Given, When, Then }) => {
        let client: Selected["client"];

        Given(
          "1,000 NOOPs before login, one per frame, across fresh instances on one state, 100 to each, since the count is in memory, and 101 frames to one instance",
          async () => {
            const w = world();
            client = await w.connect();
            client.own.length = 0;
          },
        );

        When("they are received", () => {
          // The frames are received inside the Then, between its expect lines.
        });

        Then(
          "no row is written by the NOOPs, and frame 101 to one instance closes with 1000 and ends",
          async () => {
            for (let i = 0; i < 10; i++) {
              const instance = client.evict();
              for (let j = 0; j < 100; j++) await client.frame(`n NOOP\r\n`, instance);
            }
            expect(client.own.filter((entry) => entry === "write")).toEqual([]);
            expect(client.own.filter((entry) => entry === "send")).toHaveLength(1000);
            expect(client.server.closes).toEqual([]);
            const instance = client.evict();
            for (let j = 0; j < 100; j++) await client.frame(`n NOOP\r\n`, instance);
            expect(client.server.closes).toEqual([]);
            await client.frame(`n NOOP\r\n`, instance);
            expect(client.server.closes).toEqual([1000]);
            expect(client.own.at(-1)).toBe("deleteAll");
            expect(client.own.filter((entry) => entry === "send")).toHaveLength(1100);
          },
        );
      },
    );

    Scenario("A long reply goes in small frames", ({ Given, When, Then }) => {
      let client: Selected["client"];
      let body: Uint8Array;

      Given("a 25 MiB reply", async () => {
        let w: Selected["w"];
        ({ w, client } = await selected());
        body = Uint8Array.from({ length: 25 * MIB }, (_, i) => 65 + (i % 26));
        w.deliver(idAt(T + 1, 2), mail("big@x", new TextDecoder().decode(body)));
        await client.frame("c NOOP\r\n");
        await w.mailbox().ping();
        await w.mailboxState.settled();
        client.server.frames.length = 0;
      });

      When("it is sent", async () => {
        await client.frame("d UID FETCH 2 (BODY[])\r\n");
      });

      Then("every frame is at most 1 MiB and the bytes are in order", () => {
        const { frames } = client.server;
        expect(frames.length).toBeGreaterThan(25);
        expect(Math.max(...frames.map((f) => f.length))).toBeLessThanOrEqual(MIB);
        const joined = client.server.text();
        const start = joined.indexOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        expect(joined.slice(start, start + 25 * MIB)).toBe(new TextDecoder().decode(body));
      });
    });

    Scenario("It is reached by its id, never by name", ({ Given, When, Then }) => {
      let w: Selected["w"];
      let client: Selected["client"];

      Given("a fake namespace telling idFromName from idFromString", async () => {
        ({ w, client } = await selected());
        await client.frame("c IDLE\r\n");
      });

      When("a mailbox tells a session by its name", async () => {
        w.deliver(idAt(T + 1, 2), mail("two@x"));
        await w.mailbox().ping();
        await w.mailboxState.settled();
      });

      Then("the session with the socket is reached", () => {
        expect(client.server.text()).toContain("* 2 EXISTS");
        expect(registered(w)).toEqual([client.hex]);
      });
    });

    Scenario("A session not logged in is closed by its alarm", ({ Given, When, Then }) => {
      let w: Selected["w"];
      let silent: Selected["client"];
      let logged: Selected["client"];
      let blank: ReturnType<typeof fakeState>;

      Given(
        "a session at the alarm, not logged in, one logged in, and one with no snapshot",
        async () => {
          w = world();
          silent = await w.connect();
          expect(silent.state.alarm.at).not.toBeNull();
          logged = await w.connect();
          await logged.frame(LOGIN);
          expect(logged.state.alarm.at).toBeNull();
          blank = fakeState({ hex: "blank" });
        },
      );

      When("the alarm fires", async () => {
        await new ImapSession(blank.ctx, w.env()).alarm();
        await logged.object.alarm();
        await silent.object.alarm();
      });

      Then("the first closes with 1000 and ends, and the others stay as they are", () => {
        expect(silent.server.closes).toEqual([1000]);
        expect(silent.own.at(-1)).toBe("deleteAll");
        expect(logged.server.closes).toEqual([]);
        expect(logged.own).not.toContain("deleteAll");
      });
    });

    Scenario("Ending tells the mailbox, then deallocates", ({ Given, When, Then }) => {
      let endings: [string, (c: Selected["client"]) => Promise<void>][];

      Given(
        "logout, a client close, a socket error, a fatal line and a store failure, each while selected",
        () => {
          endings = [
            ["logout", (c) => c.frame("c LOGOUT\r\n")],
            ["close", (c) => c.object.webSocketClose(c.server.socket)],
            ["error", (c) => c.object.webSocketError(c.server.socket)],
            ["fatal line", (c) => c.frame("x".repeat(70_000))],
            [
              "store failure",
              (c) => {
                c.state.mem.hook.refuse = (sql) => sql.startsWith("INSERT INTO state");
                return c.frame("c NOOP\r\nd SELECT INBOX\r\n");
              },
            ],
          ];
        },
      );

      When("the session ends", () => {
        // Each session ends inside the Then, between its expect lines.
      });

      Then("forget is called with the account from the account row before deleteAll", async () => {
        for (const [name, ending] of endings) {
          const { w, client } = await selected();
          const forgets: [string, string][] = [];
          const real = w.mailbox();
          w.swap.reach = (id) => ({
            forget: async (session) => {
              forgets.push([id, session]);
              client.own.push("forget");
              await real.forget(session);
            },
          });
          await ending(client);
          expect(forgets, name).toEqual([[`name:${MAILBOX}`, client.hex]]);
          expect(client.own.slice(-2), name).toEqual(["forget", "deleteAll"]);
          expect(registered(w), name).toEqual([]);
        }
      });
    });

    Scenario("A forget that rejects still deallocates", ({ Given, When, Then }) => {
      let client: Selected["client"];
      let errors: unknown[][];

      Given("a forget that rejects", async () => {
        let w: Selected["w"];
        ({ w, client } = await selected());
        w.swap.mailbox = { forget: () => Promise.reject(new Error("no answer")) };
      });

      When("the session ends", async () => {
        await client.object.webSocketClose(client.server.socket);
        errors = [...vi.mocked(console.error).mock.calls];
      });

      Then("it is logged and deleteAll runs", () => {
        expect(errors).toContainEqual(["imap session: forget failed", expect.any(Error)]);
        expect(client.own.at(-1)).toBe("deleteAll");
      });
    });

    Scenario("A call finishing after the end does nothing", ({ Given, When, Then }) => {
      let finishes: string[];

      Given("a client closing during a receive", () => {
        finishes = ["answers", "fails"];
      });

      When("the receive finishes", () => {
        // Each receive closes and finishes inside the Then, between its expect lines.
      });

      Then("nothing is saved or sent", async () => {
        for (const finish of finishes) {
          const { w, client } = await selected();
          const held = gate<Uint8Array>();
          w.swap.mailbox = { bytes: () => held.promise };
          const sent = client.server.frames.length;
          const receiving = client.frame("c FETCH 1 (BODY[])\r\n");
          await client.object.webSocketClose(client.server.socket);
          client.own.length = 0;
          client.server.closes.length = 0;
          if (finish === "answers") held.open(new TextEncoder().encode("late"));
          else held.fail(new Error("late"));
          await receiving;
          expect(client.own, finish).toEqual([]);
          expect(client.server.frames.length, finish).toBe(sent);
          expect(client.server.closes, finish).toEqual([]);
        }
      });
    });

    Scenario("A failure closes with 1011", ({ Given, When, Then }) => {
      let failing: Selected;
      let client: Selected["client"];

      Given("a store failure, and a save past 2 MB", async () => {
        failing = await selected();
        failing.w.swap.mailbox = { bytes: () => Promise.reject(new Error("no answer")) };
        const w = world();
        client = await w.connect();
        await client.frame(LOGIN);
        // 100,000 scattered flags: past 2 MB of saved view, as only a real mailbox shows.
        const messages = Array.from({ length: 100_000 }, (_, i) => ({
          uid: i * 2 + 1,
          flags: ["\\Seen"],
          internalDate: new Date("2026-03-02T17:00:00Z"),
          size: 1,
        }));
        w.swap.mailbox = { open: async () => ({ uidValidity: 1, uidNext: 200_001, messages }) };
      });

      When("a command is received", async () => {
        await failing.client.frame("c FETCH 1 (BODY[])\r\n");
        await client.frame("b SELECT INBOX\r\n");
      });

      Then("the socket closes with 1011 and the session ends", () => {
        expect(failing.client.server.closes).toEqual([1011]);
        expect(failing.client.own.at(-1)).toBe("deleteAll");
        expect(client.server.closes).toEqual([1011]);
        expect(client.own.at(-1)).toBe("deleteAll");
      });
    });

    Scenario("changed answers truthfully", ({ Given, When, Then }) => {
      let w: Selected["w"];
      let empty: ReturnType<typeof fakeState>;
      let unsaved: ReturnType<typeof fakeState>;
      let closes: (number | undefined)[];
      let client: Selected["client"];
      let live: Selected["w"];

      Given("no socket, no snapshot, and a live session", async () => {
        w = world();
        empty = fakeState({ hex: "empty" });
        closes = [];
        unsaved = fakeState({ hex: "unsaved" });
        unsaved.ctx.acceptWebSocket({ send: () => {}, close: (code) => void closes.push(code) });
        ({ w: live, client } = await selected());
        live.deliver(idAt(T + 1, 2), mail("two@x"));
        await live.mailbox().ping();
        await client.frame("c IDLE\r\n");
      });

      When("changed is called", () => {
        // changed runs inside the Then, wrapped by each expect.
      });

      Then(
        "the first two return false and close any socket, and the third returns true and sends what the session told",
        async () => {
          expect(await new ImapSession(empty.ctx, w.env()).changed()).toBe(false);
          expect(await new ImapSession(unsaved.ctx, w.env()).changed()).toBe(false);
          expect(closes).toHaveLength(1);
          // The third delivery and the open that pulls it stay beside changed: a step boundary between
          // them lets the open's tell reach the session first, leaving changed nothing to send.
          live.deliver(idAt(T + 2, 3), mail("three@x"));
          await live.mailbox().open("INBOX", "someone");
          const before = client.server.text().length;
          expect(await client.object.changed()).toBe(true);
          expect(client.server.text().slice(before)).toContain("EXISTS");
        },
      );
    });

    Scenario("A client address is required, and kept", ({ Given, When, Then }) => {
      let w: Selected["w"];
      let object: InstanceType<typeof ImapSession>;
      let blank: Request;

      Given("a request with no X-Client-Address, and one with it, then an eviction", () => {
        w = world();
        object = new ImapSession(fakeState({ hex: "no-address" }).ctx, w.env());
        blank = new Request("https://mail.example/imap", { headers: { "X-Client-Address": "" } });
      });

      When("fetch runs, and a login after waking", () => {
        // fetch and the login run inside the Then, between its expect lines.
      });

      Then("the first answers 400, and the login uses the stored address", async () => {
        expect((await object.fetch(new Request("https://mail.example/imap"))).status).toBe(400);
        expect((await object.fetch(blank)).status).toBe(400);
        const client = await w.connect("198.51.100.44");
        expect(client.response.status).toBe(101);
        await client.frame('a LOGIN sean@rafters.studio "wrong"\r\n', client.evict());
        expect(login).toHaveBeenLastCalledWith("sean@rafters.studio", "wrong", "198.51.100.44");
      });
    });

    Scenario("A string frame is encoded", ({ Given, When, Then }) => {
      const user = "josé@example.es";
      let client: Selected["client"];
      let logins: unknown[][];

      Given("a string message", async () => {
        const w = world();
        client = await w.connect();
      });

      When("it is received", async () => {
        await client.object.webSocketMessage(
          client.server.socket,
          `a LOGIN {${new TextEncoder().encode(user).length}+}\r\n${user} "correct horse"\r\n`,
        );
        logins = [...login.mock.calls];
      });

      Then("it is handled as its UTF-8 octets", () => {
        expect(client.server.text()).toContain("a OK");
        // The user's octets, as binary text.
        const octets = String.fromCharCode(...new TextEncoder().encode(user));
        expect(logins.at(-1)).toEqual([octets, "correct horse", "203.0.113.9"]);
      });
    });
  },
  owns(
    "FR-MAIL-035-c1",
    "FR-MAIL-035-c2",
    "FR-MAIL-035-c3",
    "FR-MAIL-035-c4",
    "FR-MAIL-035-c5",
    "FR-MAIL-035-c6",
    "FR-MAIL-035-c7",
    "FR-MAIL-035-c8",
    "FR-MAIL-035-c9",
    "FR-MAIL-035-c10",
    "FR-MAIL-035-c11",
    "FR-MAIL-035-c12",
    "FR-MAIL-035-c13",
  ),
);
