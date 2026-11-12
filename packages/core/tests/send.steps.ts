import { once } from "node:events";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { SMTPServer } from "smtp-server";
import { expect } from "vite-plus/test";
import {
  createSender,
  outcomeSchema,
  smtpTransport,
  streamConnection,
  stuff,
  submit,
  type Connection,
  type Outgoing,
  type Sent,
  type Transport,
} from "../src/send/index.ts";
import type { Written } from "../src/message/index.ts";
import { CASE_NAMES, testMail, writeCase } from "./cases.ts";
import { expire, heldDeadline, pending } from "./deadline.ts";
import { feature, owns } from "./feature.ts";
import { jane, mary, sean } from "./fixtures/people.ts";
import {
  clientOf,
  dial,
  FROM,
  golden,
  GOLDENS,
  losingServer,
  memorySends,
  MESSAGE,
  octets,
  outgoing,
  scripted,
  scriptedConnection,
  SETTINGS,
  writtenOf,
  type Golden,
  type Row,
  type Step,
} from "./send/script.ts";

const A = "a@example.net";
const B = "b@example.org";
const C = "c@example.com";

/** Plays a golden through streamConnection and submit. */
async function play(g: Golden, bytewise = false) {
  const { conn, client } = scriptedConnection(g.steps, bytewise);
  const outcomes = await submit(conn, SETTINGS, outgoing(g.to));
  return { outcomes, client: client() };
}

/** Fails unless a golden gives its exact client bytes and outcomes. */
async function expectGolden(name: string) {
  const g = golden(name);
  const { outcomes, client } = await play(g);
  expect(client, name).toBe(clientOf(g.steps));
  expect(outcomes, name).toEqual(g.outcomes);
  return { outcomes, client };
}

/** A server's turns from the greeting up to an EHLO reply of these lines, then QUIT. */
function ehloSteps(reply: string): Step[] {
  return [
    { server: "220 mx\r\n", client: "EHLO client.example\r\n" },
    { server: reply, client: "QUIT\r\n" },
    { server: "221 bye\r\n" },
  ];
}

/** A transport answering accepted, recording what it was given. */
function acceptingTransport(name = "fake") {
  const seen: Outgoing[] = [];
  const transport: Transport = {
    name,
    send: async (message) => {
      seen.push(message);
      return message.envelope.to.map((recipient) => ({
        recipient,
        kind: "accepted",
        providerId: null,
        text: null,
      }));
    },
  };
  return { transport, seen };
}

/** A local smtp-server storing what it takes, with hooks to refuse. */
async function realServer(
  hooks: { rcpt?: (address: string) => number | null; data?: () => number | null } = {},
) {
  const stored: Buffer[] = [];
  const refuse = (code: number) =>
    Object.assign(new Error(`refused ${code}`), { responseCode: code });
  const server = new SMTPServer({
    authMethods: ["PLAIN"],
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onAuth: (auth, _session, done) => done(null, { user: auth.username }),
    onRcptTo: (address, _session, done) => {
      const code = hooks.rcpt?.(address.address) ?? null;
      done(code === null ? undefined : refuse(code));
    },
    onData: (stream, _session, done) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        stored.push(Buffer.concat(chunks));
        const code = hooks.data?.() ?? null;
        done(code === null ? undefined : refuse(code));
      });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server.server, "listening");
  const address = server.server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    stored,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** What submit gives back: one outcome per recipient. */
type Outcomes = Awaited<ReturnType<typeof submit>>;

const FR025 = await feature("FR-MAIL-025");
const FR026 = await feature("FR-MAIL-026");
const FR027 = await feature("FR-MAIL-027");

describeFeature(
  FR025,
  ({ Scenario }) => {
    Scenario("A session writes exactly the form's commands, in order", ({ Given, When, Then }) => {
      Given("a server answering every command positively", () => {
        // The golden accepted scripts a server answering every command positively.
      });

      When("submit sends a message to two recipients", () => {
        // expectGolden plays the golden inside the Then, around its expect lines.
      });

      Then(
        "the client's bytes equal the golden: EHLO, AUTH PLAIN, MAIL FROM, two RCPT TO, DATA, the stuffed message and QUIT, each command followed by CRLF",
        async () => {
          const { client } = await expectGolden("accepted");
          expect(client).toBe(
            "EHLO client.example\r\n" +
              "AUTH PLAIN AHVzZXIAcGFzc3dvcmQ=\r\n" +
              `MAIL FROM:<${FROM}>\r\n` +
              `RCPT TO:<${A}>\r\nRCPT TO:<${B}>\r\n` +
              "DATA\r\n" +
              "Subject: x\r\n\r\n..lead\r\nbody\r\n.\r\n" +
              "QUIT\r\n",
          );
        },
      );
    });

    Scenario("A real server stores the bytes exactly", ({ Given, When, Then }) => {
      let server: Awaited<ReturnType<typeof realServer>>;
      let inputs: Uint8Array[];
      let outcomes: Outcomes[];

      Given("smtp-server on 127.0.0.1", async () => {
        server = await realServer();
      });

      When("each writer golden and a variant with period-led lines is submitted", async () => {
        const variant = octets(
          "From: sean@rafters.studio\r\n\r\n.one\r\n..two\r\nmid.dle\r\n.\r\nend\r\n",
        );
        inputs = [...CASE_NAMES.map((name) => writeCase(name).bytes), variant];
        outcomes = [];
        for (const bytes of inputs) {
          outcomes.push(
            await submit(await dial(server.port), SETTINGS, {
              bytes,
              envelope: { from: FROM, to: [A] },
            }),
          );
        }
        await server.close();
      });

      Then("the bytes the server stored equal the input", () => {
        for (const each of outcomes) expect(each[0]?.kind).toBe("accepted");
        expect(server.stored.map((b) => b.toString("latin1"))).toEqual(
          inputs.map((b) => Buffer.from(b).toString("latin1")),
        );
      });
    });

    Scenario(
      "A refusal before the message refuses every recipient, not final, and writes no message byte",
      ({ Given, When, Then }) => {
        let stages: Record<string, string>;

        Given(
          "a server answering not 2yz at the greeting, EHLO, AUTH or MAIL FROM, or not 3yz at DATA",
          () => {
            stages = {
              "greeting-refused": "greeting",
              "ehlo-refused": "ehlo",
              "auth-refused": "auth",
              "mail-refused": "mail",
              "data-refused": "data",
            };
          },
        );

        When("submit runs", () => {
          // expectGolden plays each golden inside the Then, around its expect lines.
        });

        Then(
          "every recipient is refused at that stage with final false, and no byte of the message was written",
          async () => {
            for (const [name, stage] of Object.entries(stages)) {
              const { outcomes, client } = await expectGolden(name);
              expect(outcomes).toHaveLength(2);
              for (const outcome of outcomes)
                expect(outcome).toMatchObject({ kind: "refused", stage, final: false });
              expect(client).not.toContain("Subject");
            }
          },
        );
      },
    );

    Scenario("A server not offering AUTH PLAIN gets no credential", ({ Given, When, Then }) => {
      let replies: string[];
      let runs: { outcomes: Outcomes; client: string }[];

      Given(
        "EHLO replies with no AUTH line, with AUTH LOGIN PLAIN-CLIENTTOKEN, with AUTH=PLAIN, and with a first line reading AUTH.example.com PLAIN greeting",
        () => {
          replies = [
            "250 mx\r\n",
            "250-mx\r\n250 AUTH LOGIN PLAIN-CLIENTTOKEN\r\n",
            "250-mx\r\n250 AUTH=PLAIN\r\n",
            "250-AUTH.example.com PLAIN greeting\r\n250 SIZE 1\r\n",
          ];
        },
      );

      When("submit runs", async () => {
        runs = [];
        for (const reply of replies) {
          const { conn, client } = scriptedConnection(ehloSteps(reply));
          const outcomes = await submit(conn, SETTINGS, outgoing([A, B]));
          runs.push({ outcomes, client: client() });
        }
      });

      Then(
        "every recipient is refused at stage auth with code null and the form's text, and no AUTH command was written",
        () => {
          for (const { outcomes, client } of runs) {
            for (const outcome of outcomes) {
              expect(outcome).toMatchObject({
                kind: "refused",
                stage: "auth",
                code: null,
                text: "server does not offer AUTH PLAIN",
                final: false,
              });
            }
            expect(client).not.toContain("AUTH");
          }
        },
      );
    });

    Scenario("AUTH PLAIN is recognised in any case", ({ Given, When, Then }) => {
      let steps: Step[];
      let client: () => string;

      Given("an EHLO reply line of auth login plain", () => {
        steps = [
          { server: "220 mx\r\n", client: "EHLO client.example\r\n" },
          {
            server: "250-mx\r\n250 auth login plain\r\n",
            client: "AUTH PLAIN AHVzZXIAcGFzc3dvcmQ=\r\n",
          },
          { server: "535 no\r\n", client: "QUIT\r\n" },
          { server: "221 bye\r\n" },
        ];
      });

      When("submit runs", async () => {
        const scripted = scriptedConnection(steps);
        client = scripted.client;
        await submit(scripted.conn, SETTINGS, outgoing([A]));
      });

      Then("the AUTH PLAIN command is written", () => {
        expect(client()).toBe(clientOf(steps));
      });
    });

    Scenario(
      "The credential is RFC 4616's message as UTF-8 then base64",
      ({ Given, When, Then }) => {
        let login: { user: string; password: string };
        let client: () => string;

        Given("a login whose password holds a character above Latin-1", () => {
          login = { user: "user", password: "p€ss" };
        });

        When("submit runs", async () => {
          const steps = golden("auth-refused").steps;
          const scripted = scriptedConnection(steps);
          client = scripted.client;
          await submit(scripted.conn, { ...SETTINGS, login }, outgoing([A]));
        });

        Then(
          "the AUTH PLAIN argument decodes to NUL, the user, NUL and the password in UTF-8",
          () => {
            const argument = /AUTH PLAIN (\S+)\r\n/.exec(client())?.[1] ?? "";
            expect(Buffer.from(argument, "base64").toString("utf8")).toBe("\0user\0p€ss");
          },
        );
      },
    );

    Scenario("A login too long for one command line is not sent", ({ Given, When, Then }) => {
      let sized: (octets: number) => { user: string; password: string };
      let fits: ReturnType<typeof scriptedConnection>;
      let client: () => string;
      let outcomes: Outcomes;

      Given("a login whose AUTH line would pass 512 octets", () => {
        // 372 octets of credential are 496 of base64, a line of 509; the next size up is 513.
        sized = (octets: number) => ({ user: "u", password: "p".repeat(octets - 3) });
      });

      When("submit runs", async () => {
        fits = scriptedConnection(golden("auth-refused").steps);
        await submit(fits.conn, { ...SETTINGS, login: sized(372) }, outgoing([A]));

        const over = scriptedConnection(ehloSteps("250-mx\r\n250 AUTH PLAIN\r\n"));
        client = over.client;
        outcomes = await submit(over.conn, { ...SETTINGS, login: sized(373) }, outgoing([A, B]));
      });

      Then(
        "every recipient is refused at stage auth, code null, not final, and no AUTH command was written",
        () => {
          expect(fits.client()).toContain("AUTH PLAIN");
          for (const outcome of outcomes) {
            expect(outcome).toMatchObject({
              kind: "refused",
              stage: "auth",
              code: null,
              text: "credential too long for AUTH PLAIN",
              final: false,
            });
          }
          expect(client()).not.toContain("AUTH");
        },
      );
    });

    Scenario("A refusal at RCPT is that recipient's alone", ({ Given, When, Then }) => {
      let server: Awaited<ReturnType<typeof realServer>>;
      let outcomes: Outcomes;

      Given(
        "RCPT answers 550 for the first of three recipients and 451 for the second",
        async () => {
          // The form: the real server "also serves a partial RCPT rejection".
          server = await realServer({
            rcpt: (address) => (address === A ? 550 : address === B ? 451 : null),
          });
        },
      );

      When("submit runs", async () => {
        outcomes = await submit(await dial(server.port), SETTINGS, outgoing([A, B, C]));
        await server.close();
      });

      Then(
        "the first is refused with final true, the second with final false, and the third is accepted after the message",
        async () => {
          await expectGolden("rcpt-refused");
          await expectGolden("rcpt-then-data-refused");
          expect(outcomes[0]).toMatchObject({
            kind: "refused",
            stage: "rcpt",
            code: 550,
            final: true,
          });
          expect(outcomes[1]).toMatchObject({
            kind: "refused",
            stage: "rcpt",
            code: 451,
            final: false,
          });
          expect(outcomes[2]).toMatchObject({ kind: "accepted", recipient: C });
        },
      );
    });

    Scenario(
      "A connection closed during RCPT refuses all but those already refused",
      ({ Given, When, Then }) => {
        Given(
          "the connection closes after the second of three RCPT commands, the first having been refused",
          () => {
            // The golden rcpt-closed scripts that server.
          },
        );

        When("submit runs", () => {
          // expectGolden plays the golden inside the Then, around its expect lines.
        });

        Then(
          "the first keeps its own refusal and the others are refused at stage rcpt, code null, text connection closed, not final",
          async () => {
            const { outcomes, client } = await expectGolden("rcpt-closed");
            expect(outcomes[1]).toEqual({
              recipient: B,
              kind: "refused",
              final: false,
              stage: "rcpt",
              code: null,
              text: "connection closed",
            });
            expect(client).not.toContain("QUIT");
          },
        );
      },
    );

    Scenario("With no recipient accepted, no message is sent", ({ Given, When, Then }) => {
      Given("RCPT refuses every recipient", () => {
        // The golden none-accepted scripts that server.
      });

      When("submit runs", () => {
        // expectGolden plays the golden inside the Then, around its expect lines.
      });

      Then("QUIT is written, and DATA is not", async () => {
        const { client } = await expectGolden("none-accepted");
        expect(client).toContain("QUIT\r\n");
        expect(client).not.toContain("DATA");
      });
    });

    Scenario("Any 2yz at the terminator is accepted", ({ Given, When, Then }) => {
      let names: string[];

      Given(
        "the terminator is answered with 250, then in another session with 251 and with 200",
        () => {
          names = ["accepted", "terminator-251", "terminator-200"];
        },
      );

      When("submit runs", () => {
        // expectGolden plays each golden inside the Then, around its expect lines.
      });

      Then(
        "every recipient RCPT accepted is accepted, with providerId null and the reply's text",
        async () => {
          for (const name of names) {
            const { outcomes } = await expectGolden(name);
            for (const outcome of outcomes)
              expect(outcome).toMatchObject({ kind: "accepted", providerId: null });
          }
          expect((await expectGolden("terminator-251")).outcomes[0]).toMatchObject({
            text: "forwarded",
          });
        },
      );
    });

    Scenario("At the terminator 4yz is not final and 5yz is final", ({ Given, When, Then }) => {
      let real: Outcomes[];

      Given("the terminator is answered with 451, then in another session with 554", () => {
        // The goldens terminator-451 and terminator-554 script those servers, and so does the real one.
      });

      When("submit runs", async () => {
        // The form: the real server also serves "451 and 554 at DATA".
        real = [];
        for (const code of [451, 554]) {
          const { port, close } = await realServer({ data: () => code });
          real.push(await submit(await dial(port), SETTINGS, outgoing([A])));
          await close();
        }
      });

      Then("those recipients are refused at stage data, not final and then final", async () => {
        const later = await expectGolden("terminator-451");
        expect(later.outcomes[0]).toMatchObject({ kind: "refused", stage: "data", final: false });
        const never = await expectGolden("terminator-554");
        expect(never.outcomes[0]).toMatchObject({ kind: "refused", stage: "data", final: true });
        for (const [i, [code, final]] of (
          [
            [451, false],
            [554, true],
          ] as const
        ).entries()) {
          expect(real[i]?.[0]).toMatchObject({ kind: "refused", stage: "data", code, final });
        }
      });
    });

    Scenario("Any other reply at the terminator is unknown", ({ Given, When, Then }) => {
      Given("the terminator is answered with 354", () => {
        // The golden terminator-354 scripts that server.
      });

      When("submit runs", () => {
        // expectGolden plays the golden inside the Then, around its expect lines.
      });

      Then(
        "those recipients are unknown, with detail unexpected reply: 354 and the text",
        async () => {
          const { outcomes } = await expectGolden("terminator-354");
          expect(outcomes[0]).toEqual({
            recipient: A,
            kind: "unknown",
            detail: "unexpected reply: 354 odd",
          });
        },
      );
    });

    Scenario(
      "A connection really lost after the terminator is unknown",
      ({ Given, When, Then }) => {
        let lost: Awaited<ReturnType<typeof losingServer>>;
        let outcomes: Outcomes;

        Given("a node:net server destroying its socket after reading the terminator", async () => {
          lost = await losingServer("after");
        });

        When("submit runs over a real socket", async () => {
          outcomes = await submit(await dial(lost.port), SETTINGS, outgoing([A, B]));
          lost.server.close();
        });

        Then(
          "those recipients are unknown, with detail connection lost after the message began",
          () => {
            expect(outcomes).toEqual(
              [A, B].map((recipient) => ({
                recipient,
                kind: "unknown",
                detail: "connection lost after the message began",
              })),
            );
          },
        );
      },
    );

    Scenario(
      "A connection really lost during the message is unknown, not a throw",
      ({ Given, When, Then }) => {
        let lost: Awaited<ReturnType<typeof losingServer>>;
        let outcomes: Outcomes;

        Given(
          "a node:net server destroying its socket while a large message is being written",
          async () => {
            lost = await losingServer("during");
          },
        );

        When("submit runs over a real socket", async () => {
          const bytes = octets(`Subject: x\r\n\r\n${"x".repeat(76)}\r\n`.repeat(100_000));
          outcomes = await submit(await dial(lost.port, 2_000), SETTINGS, {
            bytes,
            envelope: { from: FROM, to: [A] },
          });
          lost.server.close();
        });

        Then("submit returns those recipients as unknown", () => {
          expect(outcomes).toEqual([
            { recipient: A, kind: "unknown", detail: "connection lost after the message began" },
          ]);
        });
      },
    );

    Scenario("A server silent at QUIT does not delay a known result", ({ Given, When, Then }) => {
      let steps: Step[];
      let asked: { ms: number; reason: string }[];
      let running: Promise<Outcomes>;

      Given(
        "a server answering 250 at the terminator and never answering QUIT, and a deadline the test holds",
        () => {
          steps = golden("accepted").steps.slice(0, -1);
        },
      );

      When(
        "submit runs with a quitWaitMs of 60000, and once QUIT is written the test fires the 60000 ms the deadline was asked for",
        async () => {
          const { conn, client } = scriptedConnection(steps);
          running = submit(
            conn,
            { ...SETTINGS, quitWaitMs: 60_000, deadline: heldDeadline("quit") },
            outgoing([A, B]),
          );
          // An event: QUIT is written. Each turn lets every settled promise run, with no time passing.
          while (!client().endsWith("QUIT\r\n"))
            await new Promise((resolve) => setImmediate(resolve));
          asked = pending("quit");
          expire("quit");
        },
      );

      Then("it returns accepted, with no real time passing", async () => {
        expect(asked).toEqual([{ ms: 60_000, reason: "quit wait" }]);
        expect((await running)[0]).toMatchObject({ kind: "accepted" });
      });
    });

    Scenario("close can neither replace nor lose a result", ({ Given, When, Then }) => {
      let closes: (() => Promise<void>)[];
      let results: Outcomes[];

      Given("a close that throws, and one that never resolves", () => {
        closes = [
          async () => {
            throw new Error("close failed");
          },
          () => new Promise<void>(() => undefined),
        ];
      });

      When("submit runs to an accepted result", async () => {
        results = [];
        for (const close of closes) {
          const { conn } = scriptedConnection(golden("accepted").steps);
          results.push(
            await submit({ ...conn, close }, { ...SETTINGS, quitWaitMs: 20 }, outgoing([A, B])),
          );
        }
      });

      Then("accepted is returned in both", () => {
        for (const outcomes of results) expect(outcomes[0]).toMatchObject({ kind: "accepted" });
      });
    });

    Scenario("Replies are read as RFC 5321 4.2.1 says", ({ Given, When, Then }) => {
      let bad: ReturnType<typeof scriptedConnection>;
      let mixed: ReturnType<typeof scriptedConnection>;
      let closed: Outcomes;
      let refused: Outcomes;

      Given(
        "a reply of 2500 x before the message, and a multi-line reply whose lines have different codes",
        () => {
          bad = scriptedConnection([{ server: "2500 x\r\n" }]);
          mixed = scriptedConnection(ehloSteps("250-one\r\n550 two\r\n"));
        },
      );

      When("submit runs", async () => {
        closed = await submit(bad.conn, SETTINGS, outgoing([A]));
        refused = await submit(mixed.conn, SETTINGS, outgoing([A]));
      });

      Then(
        "the first counts as a closed connection, and the second's code is its last line's",
        () => {
          expect(closed[0]).toMatchObject({
            stage: "greeting",
            code: null,
            text: "connection closed",
          });
          expect(bad.client()).toBe("");
          expect(refused[0]).toMatchObject({ stage: "ehlo", code: 550, text: "one\ntwo" });
        },
      );
    });

    Scenario(
      "A line or write that throws before the message counts as a closed connection",
      ({ Given, When, Then }) => {
        let atMail: (conn: Connection, bad: "write" | "line") => Connection;
        let runs: { outcomes: Outcomes; client: string }[];

        Given("a connection whose line or write throws during MAIL FROM", () => {
          atMail = (conn, bad) => {
            let mail = false;
            return {
              ...conn,
              write: (bytes) => {
                mail = Buffer.from(bytes).toString("latin1").startsWith("MAIL FROM");
                if (mail && bad === "write") throw new Error("write failed");
                return conn.write(bytes);
              },
              line: () => {
                if (mail && bad === "line") throw new Error("line failed");
                return conn.line();
              },
            };
          };
        });

        When("submit runs", async () => {
          runs = [];
          for (const bad of ["write", "line"] as const) {
            const { conn, client } = scriptedConnection(golden("accepted").steps);
            const outcomes = await submit(atMail(conn, bad), SETTINGS, outgoing([A, B]));
            runs.push({ outcomes, client: client() });
          }
        });

        Then("every recipient is refused at stage mail, code null, not final", () => {
          for (const { outcomes, client } of runs) {
            for (const outcome of outcomes) {
              expect(outcome).toMatchObject({
                kind: "refused",
                stage: "mail",
                code: null,
                text: "connection closed",
                final: false,
              });
            }
            expect(client).not.toContain("QUIT");
          }
        });
      },
    );

    Scenario(
      "Stuffing doubles a period at the start and after each CRLF, and ends the data",
      ({ Given, When, Then }) => {
        let text: (s: string) => string;

        Given(
          "bytes beginning with a period, holding CRLF then a period, and holding a period mid-line",
          () => {
            // The Then names each input beside what stuff makes of it.
          },
        );

        When("stuff runs", () => {
          text = (s: string) => Buffer.from(stuff(octets(s))).toString("latin1");
        });

        Then("only the first two gain a period, and the result ends in a period and CRLF", () => {
          expect(text(".a\r\n")).toBe("..a\r\n.\r\n");
          expect(text("a\r\n.b\r\n")).toBe("a\r\n..b\r\n.\r\n");
          expect(text("a.b\r\n")).toBe("a.b\r\n.\r\n");
          expect(text("a\n.b\r\n")).toBe("a\n.b\r\n.\r\n");
          expect(text("")).toBe(".\r\n");
        });
      },
    );

    Scenario("A failure to open is a refusal", ({ Given, When, Then }) => {
      let thrown: [unknown, string][];
      let runs: { outcomes: Outcomes; text: string }[];

      Given("an open that throws an Error, then one that throws a string", () => {
        thrown = [
          [new Error("no route"), "no route"],
          ["refused by string", "refused by string"],
        ];
      });

      When("smtpTransport sends", async () => {
        runs = [];
        for (const [value, text] of thrown) {
          const transport = smtpTransport({
            name: "fake",
            open: async () => {
              throw value;
            },
            ...SETTINGS,
          });
          runs.push({ outcomes: await transport.send(outgoing([A, B])), text });
        }
      });

      Then(
        "every recipient is refused at stage connect, code null, not final, with the message, then with String of the value",
        () => {
          for (const { outcomes, text } of runs) {
            for (const [i, recipient] of [A, B].entries()) {
              expect(outcomes[i]).toEqual({
                recipient,
                kind: "refused",
                final: false,
                stage: "connect",
                code: null,
                text,
              });
            }
            expect(outcomes.map((o) => outcomeSchema.parse(o))).toEqual(outcomes);
          }
        },
      );
    });
  },
  owns(
    "FR-MAIL-025-c1",
    "FR-MAIL-025-c2",
    "FR-MAIL-025-c3",
    "FR-MAIL-025-c4",
    "FR-MAIL-025-c5",
    "FR-MAIL-025-c6",
    "FR-MAIL-025-c7",
    "FR-MAIL-025-c8",
    "FR-MAIL-025-c9",
    "FR-MAIL-025-c10",
    "FR-MAIL-025-c11",
    "FR-MAIL-025-c12",
    "FR-MAIL-025-c13",
    "FR-MAIL-025-c14",
    "FR-MAIL-025-c15",
    "FR-MAIL-025-c16",
    "FR-MAIL-025-c17",
    "FR-MAIL-025-c18",
    "FR-MAIL-025-c19",
    "FR-MAIL-025-c20",
    "FR-MAIL-025-c21",
  ),
);

describeFeature(
  FR026,
  ({ Scenario }) => {
    Scenario("Every recipient is claimed before the transport runs", ({ Given, When, Then }) => {
      let sends: ReturnType<typeof memorySends>;
      let claims: Date[];
      let seen: (Row | undefined)[];
      let transport: Transport;
      let at: Date;

      Given("a transport that reads the rows when called", () => {
        sends = memorySends();
        claims = [];
        const claim = sends.claim;
        sends.claim = (c) => {
          claims.push(c.at);
          return claim(c);
        };
        seen = [];
        transport = {
          name: "fake",
          send: async ({ envelope }) => {
            seen.push(...envelope.to.map((r) => sends.rows.get(r)));
            return [];
          },
        };
      });

      When("send runs", async () => {
        at = new Date("2026-03-02T17:00:00Z");
        await createSender({ transport, sends, now: () => at })(
          writtenOf(octets(MESSAGE), FROM, [A, B]),
        );
      });

      Then("it sees every recipient as unknown", () => {
        expect(seen).toEqual([{ state: "unknown" }, { state: "unknown" }]);
        expect(claims).toEqual([at, at]);
      });
    });

    Scenario(
      "A transport that throws leaves the rows unknown, and send throws",
      ({ Given, When, Then }) => {
        let sends: ReturnType<typeof memorySends>;
        let transport: Transport;

        Given("a transport that throws", () => {
          sends = memorySends();
          transport = {
            name: "fake",
            send: async () => {
              throw new Error("transport failed");
            },
          };
        });

        When("send runs", () => {
          // send runs inside the Then, wrapped by its expect.
        });

        Then("send throws, and every row remains unknown", async () => {
          const send = createSender({ transport, sends });
          await expect(send(writtenOf(octets(MESSAGE), FROM, [A, B]))).rejects.toThrow(
            "transport failed",
          );
          expect([...sends.rows.values()]).toEqual([{ state: "unknown" }, { state: "unknown" }]);
        });
      },
    );

    Scenario("A recipient already answered is held", ({ Given, When, Then }) => {
      let sends: ReturnType<typeof memorySends>;
      let accepting: ReturnType<typeof acceptingTransport>;
      let sent: Sent;

      Given("rows accepted, unknown and finally refused", () => {
        sends = memorySends(
          new Map<string, Row>([
            [C, { state: "refused", final: true }],
            [A, { state: "accepted" }],
            [B, { state: "unknown" }],
          ]),
        );
      });

      When("the same Written is sent again", async () => {
        accepting = acceptingTransport();
        sent = await createSender({ transport: accepting.transport, sends })(
          writtenOf(octets(MESSAGE), FROM, [A, B, C]),
        );
      });

      Then(
        "the transport is not called, outcomes is empty, and held lists them in envelope order",
        () => {
          expect(accepting.seen).toEqual([]);
          expect(sent).toMatchObject({ provider: "fake", outcomes: [], held: [A, B, C] });
        },
      );
    });

    Scenario(
      "Only recipients with no row or a row not final are sent to",
      ({ Given, When, Then }) => {
        let sends: ReturnType<typeof memorySends>;
        let accepting: ReturnType<typeof acceptingTransport>;
        let sent: Sent;

        Given("one recipient refused not final, one accepted, and one new", () => {
          sends = memorySends(
            new Map<string, Row>([
              [A, { state: "refused", final: false }],
              [B, { state: "accepted" }],
            ]),
          );
        });

        When("the same Written is sent again", async () => {
          accepting = acceptingTransport();
          sent = await createSender({ transport: accepting.transport, sends })(
            writtenOf(octets(MESSAGE), FROM, [A, B, C]),
          );
        });

        Then(
          "the transport's envelope holds exactly the first and third, in order, and the second is held",
          () => {
            expect(accepting.seen[0]?.envelope).toEqual({ from: FROM, to: [A, C] });
            expect(sent.held).toEqual([B]);
            expect(sent.outcomes.map((o) => o.recipient)).toEqual([A, C]);
            expect(sends.rows.get(A)).toEqual({ state: "accepted" });
          },
        );
      },
    );

    Scenario(
      "A credential failure does not stop another provider sending",
      ({ Given, When, Then }) => {
        let sends: ReturnType<typeof memorySends>;
        let written: Written;
        let first: Sent;
        let accepting: ReturnType<typeof acceptingTransport>;
        let second: Sent;

        Given("a 535 at AUTH through one transport", async () => {
          sends = memorySends();
          written = writtenOf(octets(MESSAGE), FROM, [A]);
          const refusing = smtpTransport({
            name: "first",
            open: async () => scriptedConnection(golden("auth-refused").steps).conn,
            ...SETTINGS,
          });
          first = await createSender({ transport: refusing, sends })(written);
        });

        When("the same Written is sent through another transport", async () => {
          accepting = acceptingTransport("second");
          second = await createSender({ transport: accepting.transport, sends })(written);
        });

        Then("the recipient is reached", () => {
          expect(first.outcomes[0]).toMatchObject({
            kind: "refused",
            stage: "auth",
            code: 535,
            final: false,
          });
          expect(accepting.seen[0]?.envelope.to).toEqual([A]);
          expect(second.outcomes[0]).toMatchObject({ kind: "accepted", recipient: A });
        });
      },
    );

    Scenario("A 251 at the terminator is not sent again", ({ Given, When, Then }) => {
      let written: Written;
      let send: ReturnType<typeof createSender>;
      let first: Sent;
      let again: Sent;

      Given("a 251 at the terminator", async () => {
        const sends = memorySends();
        written = writtenOf(octets(MESSAGE), FROM, [A, B]);
        const transport = smtpTransport({
          name: "fake",
          open: async () => scriptedConnection(golden("terminator-251").steps).conn,
          ...SETTINGS,
        });
        send = createSender({ transport, sends });
        first = await send(written);
      });

      When("the same Written is sent again", async () => {
        again = await send(written);
      });

      Then("the recipient is held", () => {
        expect(first.outcomes[0]).toMatchObject({ kind: "accepted" });
        expect(again.outcomes).toEqual([]);
        expect(again.held).toEqual([A, B]);
      });
    });

    Scenario("Smuggling input throws, writing no row", ({ Given, When, Then }) => {
      let inputs: Written[];

      Given(
        "bytes with a byte of 0x80, with a bare CR, with a bare LF, and with no final CRLF, and an address with a control character, a space, a less-than and a greater-than",
        () => {
          const good = octets(MESSAGE);
          inputs = [
            writtenOf(Uint8Array.of(0x41, 0x80, 0x0d, 0x0a), FROM, [A]),
            writtenOf(octets("a\rb\r\n"), FROM, [A]),
            writtenOf(octets("a\nb\r\n"), FROM, [A]),
            writtenOf(octets("a\r\nb"), FROM, [A]),
            writtenOf(good, "a\u0001@example.net", [A]),
            writtenOf(good, FROM, ["a b@example.net"]),
            writtenOf(good, FROM, ["<a@example.net"]),
            writtenOf(good, FROM, ["a@example.net>"]),
          ];
        },
      );

      When("send runs", () => {
        // send runs inside the Then, wrapped by its expect.
      });

      Then("each throws a TypeError, and no claim was made", async () => {
        for (const written of inputs) {
          const sends = memorySends();
          const { transport, seen } = acceptingTransport();
          await expect(createSender({ transport, sends })(written)).rejects.toThrow(TypeError);
          expect(sends.claims).toBe(0);
          expect(seen).toEqual([]);
        }
      });
    });

    Scenario("Everything the writer makes passes the checks", ({ Given, When, Then }) => {
      let period: Written;
      let written: Written[];
      let sent: { message: Written; sent: Sent }[];

      Given("every writer golden, and a real message with Bcc and a leading period", () => {
        period = testMail().compose({ from: sean, to: [mary], bcc: [jane], subject: "Dots" })({
          doc: [{ p: [".a line led by a period"] }],
        });
        written = [...CASE_NAMES.map((name) => writeCase(name)), period];
      });

      When("send runs", async () => {
        sent = [];
        for (const message of written) {
          const { transport } = acceptingTransport();
          sent.push({
            message,
            sent: await createSender({ transport, sends: memorySends() })(message),
          });
        }
      });

      Then("none throws", () => {
        expect(Buffer.from(period.bytes).toString("latin1")).toMatch(/\r\n\.a line/);
        expect(period.envelope.to).toContain("j-brown@other.example");
        for (const { message, sent: one } of sent) {
          expect(one.outcomes).toHaveLength(message.envelope.to.length);
        }
      });
    });
  },
  owns(
    "FR-MAIL-026-c1",
    "FR-MAIL-026-c2",
    "FR-MAIL-026-c3",
    "FR-MAIL-026-c4",
    "FR-MAIL-026-c5",
    "FR-MAIL-026-c6",
    "FR-MAIL-026-c7",
    "FR-MAIL-026-c8",
  ),
);

describeFeature(
  FR027,
  ({ Scenario }) => {
    Scenario(
      "Every row of the session table gives the same result whole and one byte at a time",
      ({ Given, When, Then }) => {
        let goldens: Golden[];
        let runs: {
          g: Golden;
          whole: Awaited<ReturnType<typeof play>>;
          bytewise: Awaited<ReturnType<typeof play>>;
        }[];

        Given("the session goldens over in-memory streams", () => {
          goldens = GOLDENS;
        });

        When("each is driven through streamConnection whole and one byte at a time", async () => {
          runs = [];
          for (const g of goldens) {
            runs.push({ g, whole: await play(g), bytewise: await play(g, true) });
          }
        });

        Then("the client's bytes and the outcomes are identical", () => {
          for (const { g, whole, bytewise } of runs) {
            expect(whole.client, g.name).toBe(clientOf(g.steps));
            expect(whole.outcomes, g.name).toEqual(g.outcomes);
            expect(bytewise).toEqual(whole);
          }
        });
      },
    );

    Scenario("A read past the timeout returns null, and null stays", ({ Given, When, Then }) => {
      let quiet: Connection;
      let slow: Connection;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let quietAsked: { ms: number; reason: string }[];
      let quietFirst: string | null;
      let quietSecond: string | null;
      let quietAfter: { ms: number; reason: string }[];
      let slowAsked: { ms: number; reason: string }[];
      let slowFirst: string | null;
      let slowSecond: string | null;

      Given(
        "a stream that sends nothing, and a server trickling a line one byte at a time past the timeout",
        () => {
          const silent = scripted([]);
          quiet = streamConnection(silent.streams, {
            timeoutMs: 20,
            deadline: heldDeadline("quiet"),
          });
          const readable = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
          });
          slow = streamConnection(
            { readable, writable: new WritableStream(), close: async () => undefined },
            { timeoutMs: 50, deadline: heldDeadline("slow") },
          );
        },
      );

      When("line is called, and called again", async () => {
        const first = quiet.line();
        quietAsked = pending("quiet");
        expire("quiet");
        quietFirst = await first;
        // Closed stays closed: the second read asks for nothing.
        quietSecond = await quiet.line();
        quietAfter = pending("quiet");

        const trickled = slow.line();
        // A byte at a time and never a line end: each is read, and none asks for a new bound.
        for (let i = 0; i < 10; i += 1) {
          controller?.enqueue(octets("x"));
          await new Promise((resolve) => setImmediate(resolve));
        }
        slowAsked = pending("slow");
        expire("slow");
        slowFirst = await trickled;
        slowSecond = await slow.line();
      });

      Then("it returns null both times", () => {
        expect(quietAsked).toEqual([{ ms: 20, reason: "no answer within 20 ms" }]);
        expect(quietFirst).toBeNull();
        expect(quietSecond).toBeNull();
        expect(quietAfter).toEqual([]);
        expect(slowAsked).toEqual([{ ms: 50, reason: "no answer within 50 ms" }]);
        expect(slowFirst).toBeNull();
        expect(slowSecond).toBeNull();
      });
    });

    Scenario("A write past the timeout throws", ({ Given, When, Then }) => {
      let conn: Connection;
      let written: Promise<void>;
      let asked: { ms: number; reason: string }[];

      Given("a writable that never accepts", () => {
        const writable = new WritableStream<Uint8Array>({
          write: () => new Promise(() => undefined),
        });
        conn = streamConnection(
          { readable: new ReadableStream(), writable, close: async () => undefined },
          { timeoutMs: 20, deadline: heldDeadline("write") },
        );
      });

      When("write is called", () => {
        written = conn.write(octets("x"));
        // Caught here so the rejection is handled before the Then awaits it.
        written.catch(() => undefined);
        asked = pending("write");
        expire("write");
      });

      Then("it throws", async () => {
        expect(asked).toEqual([{ ms: 20, reason: "no answer within 20 ms" }]);
        await expect(written).rejects.toThrow("no answer within 20 ms");
      });
    });

    Scenario(
      "maxLine excludes the CRLF, and passing it closes for good",
      ({ Given, When, Then }) => {
        let maxLine: number;
        let exact: string;
        let reads: (string | null)[][];

        Given(
          "a line of exactly maxLine bytes, and one a byte longer followed by a good line",
          () => {
            maxLine = 8;
            exact = "x".repeat(maxLine);
          },
        );

        When("line is called", async () => {
          reads = [];
          for (const bytewise of [false, true]) {
            const over = "x".repeat(maxLine + 1);
            const { streams } = scripted([{ server: `${exact}\r\n${over}\r\ngood\r\n` }], bytewise);
            const conn = streamConnection(streams, { maxLine, timeoutMs: 1_000 });
            reads.push([await conn.line(), await conn.line(), await conn.line()]);
          }
        });

        Then("the first is returned, and the second gives null, as does every later call", () => {
          for (const [first, second, third] of reads) {
            expect(first).toBe(exact);
            expect(second).toBeNull();
            expect(third).toBeNull();
          }
        });
      },
    );

    Scenario(
      "Only CRLF ends a line, and bytes that do not decode cannot throw",
      ({ Given, When, Then }) => {
        let conn: Connection;
        let first: string | null;
        let second: string | null;

        Given("a line holding a bare LF, and a line holding invalid UTF-8", () => {
          ({ conn } = scriptedConnection([{ server: "a\nb\r\n\xff\xfe\r\n" }]));
        });

        When("line is called", async () => {
          first = await conn.line();
          second = await conn.line();
        });

        Then("the first is one line with the LF in it, and the second returns text", () => {
          expect(first).toBe("a\nb");
          expect(second).toBe("��");
        });
      },
    );
  },
  owns("FR-MAIL-027-c1", "FR-MAIL-027-c2", "FR-MAIL-027-c3", "FR-MAIL-027-c4", "FR-MAIL-027-c5"),
);
