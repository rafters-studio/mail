import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { z } from "zod";
import {
  binary,
  bodyLines,
  contentType,
  decodeWords,
  partFields,
  partText,
  readAddresses,
  readDate,
  readMessage,
  sameMailbox,
  section,
  transferDecode,
  type Address,
  type Part,
  type Read,
} from "../src/read/index.ts";
import { feature, owns } from "./feature.ts";
import { encode, everyFixture, FIXTURES } from "./fixtures/read.ts";
import { SHAPES } from "./hostile.ts";

// FR-MAIL-045-c3 runs a child process for each shape.
vi.setConfig({ testTimeout: 60_000 });

/** The bytes of one fixture of research 01a19b44. */
function bytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`${name}.eml`, FIXTURES)));
}

/** One fixture, read. */
function read(name: string): Read {
  return readMessage(bytes(name));
}

/** A message from a@x.test with this Date and a one-line body, read. */
function dated(date: string): Read {
  return readMessage(new TextEncoder().encode(`From: a@x.test\r\nDate: ${date}\r\n\r\nbody\r\n`));
}

/** The part at a section of a fixture, which must exist. */
function part(name: string, path: string): Part {
  const found = section(read(name).root, path);
  if (found === null) throw new Error(`${name} has no section ${path}`);
  return found;
}

/** The text of a range of a fixture. */
function slice(name: string, range: { start: number; end: number }): string {
  return binary(bytes(name)).slice(range.start, range.end);
}

const unparsed = (field: string) => expect.objectContaining({ code: "unparsed-value", field });

// What Python email (compat32) finds in the six writer goldens: research 01a19b44's oracle, run
// on these fixtures.
const oracle = z
  .record(
    z.string(),
    z.object({
      leaves: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          raw: z.string().nullable(),
          text: z.string().nullable(),
        }),
      ),
      subject: z.string().nullable(),
    }),
  )
  .parse(JSON.parse(readFileSync(new URL("oracle.json", FIXTURES), "utf8")));

const goldens: unknown = JSON.parse(readFileSync(new URL("read.json", FIXTURES), "utf8"));

/** Expects a read whose date has no instant, whose Date text is kept and with an invalid-date problem. */
function expectInvalid(r: Read, date: string, problem: string): void {
  expect(r.date).toEqual({ instant: null, problem });
  expect(r.fields).toContainEqual({ name: "Date", value: date });
  expect(r.problems).toContainEqual({ code: "invalid-date", field: "date", detail: problem });
}

const MIB = 1024 * 1024;
const codes = (r: Read, code: string) => r.problems.filter((p) => p.code === code);

/** The header of a message from a@x.test, then the fields of `fill`, up to `size` bytes in all. */
function header(fill: string, size: number): string {
  const start = "From: a@x.test\r\nMessage-ID: <early@x.test>\r\n";
  return start + fill.repeat(Math.ceil((size - start.length) / fill.length));
}

const FR002 = await feature("FR-MAIL-002");
const FR003 = await feature("FR-MAIL-003");
const FR004 = await feature("FR-MAIL-004");
const FR005 = await feature("FR-MAIL-005");
const FR006 = await feature("FR-MAIL-006");
const FR007 = await feature("FR-MAIL-007");
const FR019 = await feature("FR-MAIL-019");
const FR045 = await feature("FR-MAIL-045");

describeFeature(
  FR002,
  ({ Scenario }) => {
    Scenario(
      "The RFC 5322 A.4 message is read as two Received fields, in order, then From, To, Subject, Date and Message-ID",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.4 message with two Received fields", () => {
          stored = bytes("a4-trace");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          "its fields are Received, Received, From, To, Subject, Date and Message-ID, in that order",
          () => {
            expect(r.fields.map((f) => f.name)).toEqual([
              "Received",
              "Received",
              "From",
              "To",
              "Subject",
              "Date",
              "Message-ID",
            ]);
          },
        );
      },
    );

    Scenario(
      "The RFC 5322 A.3 message is read with Resent-From, Resent-To, Resent-Date and Resent-Message-ID before the original fields",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.3 resent message", () => {
          stored = bytes("a3-resent");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          "its first four fields are Resent-From, Resent-To, Resent-Date and Resent-Message-ID, followed by From, To, Subject, Date and Message-ID",
          () => {
            expect(r.fields.map((f) => f.name)).toEqual([
              "Resent-From",
              "Resent-To",
              "Resent-Date",
              "Resent-Message-ID",
              "From",
              "To",
              "Subject",
              "Date",
              "Message-ID",
            ]);
          },
        );
      },
    );

    Scenario(
      "A message with two Subject fields is read with both, in order, and a problem recorded for the repeated Subject",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given('a message with Subject "first" followed by Subject "second"', () => {
          stored = bytes("m2-two-subjects");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          "both Subject fields are kept in order and a repeated-field problem names Subject",
          () => {
            expect(r.fields.filter((f) => f.name === "Subject").map((f) => f.value)).toEqual([
              "first",
              "second",
            ]);
            expect(r.problems).toContainEqual({
              code: "repeated-field",
              field: "subject",
              detail: "2 times",
            });
          },
        );
      },
    );
  },
  owns("FR-MAIL-002-c1", "FR-MAIL-002-c2", "FR-MAIL-002-c3"),
);

describeFeature(
  FR003,
  ({ Scenario }) => {
    Scenario(
      "The first Received field of the RFC 5322 A.4 message is read as one line",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the RFC 5322 Appendix A.4 message, whose first Received field is folded over six lines",
          () => {
            stored = bytes("a4-trace");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          'the field reads "from x.y.test   by example.net   via TCP   with ESMTP   id ABC12345   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600"',
          () => {
            expect(r.fields[0]?.value).toBe(
              "from x.y.test   by example.net   via TCP   with ESMTP   id ABC12345   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600",
            );
          },
        );
      },
    );
  },
  owns("FR-MAIL-003-c1"),
);

describeFeature(
  FR004,
  ({ Scenario }) => {
    Scenario(
      "The To field of RFC 5322 A.1.2 is read as Mary Smith <mary@x.test>, jdoe@example.org and Who? <one@y.test>",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.1.2 message", () => {
          stored = bytes("a1.2-mailboxes");
        });

        When("mail reads its To field", () => {
          r = readMessage(stored);
        });

        Then(
          "it has three mailboxes: Mary Smith at mary@x.test, jdoe@example.org with no name, and Who? at one@y.test",
          () => {
            expect(r.to).toEqual([
              { name: "Mary Smith", local: "mary", domain: "x.test" },
              { name: null, local: "jdoe", domain: "example.org" },
              { name: "Who?", local: "one", domain: "y.test" },
            ]);
          },
        );
      },
    );

    Scenario(
      'The Cc field of RFC 5322 A.1.2 is read with the display name Giant; "Big" Box',
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.1.2 message", () => {
          stored = bytes("a1.2-mailboxes");
        });

        When("mail reads its Cc field", () => {
          r = readMessage(stored);
        });

        Then('its second mailbox is named Giant; "Big" Box at sysservices@example.net', () => {
          expect(r.cc?.[1]).toEqual({
            name: 'Giant; "Big" Box',
            local: "sysservices",
            domain: "example.net",
          });
        });
      },
    );

    Scenario(
      "The To field of RFC 5322 A.1.3 is read as the group A Group with three members",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.1.3 message", () => {
          stored = bytes("a1.3-groups");
        });

        When("mail reads its To field", () => {
          r = readMessage(stored);
        });

        Then(
          "it is one group named A Group with members Ed Jones at c@a.test, joe@where.test and John at jdoe@one.test",
          () => {
            expect(r.to).toEqual([
              {
                group: "A Group",
                members: [
                  { name: "Ed Jones", local: "c", domain: "a.test" },
                  { name: null, local: "joe", domain: "where.test" },
                  { name: "John", local: "jdoe", domain: "one.test" },
                ],
              },
            ]);
          },
        );
      },
    );

    Scenario(
      "The Cc field of RFC 5322 A.1.3 is read as the empty group Undisclosed recipients",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.1.3 message", () => {
          stored = bytes("a1.3-groups");
        });

        When("mail reads its Cc field", () => {
          r = readMessage(stored);
        });

        Then("it is one group named Undisclosed recipients with no members", () => {
          expect(r.cc).toEqual([{ group: "Undisclosed recipients", members: [] }]);
        });
      },
    );

    Scenario(
      "The commented From field of RFC 5322 A.5 is read as Pete <pete@silly.test>",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.5 message", () => {
          stored = bytes("a5-oddities");
        });

        When("mail reads its From field", () => {
          r = readMessage(stored);
        });

        Then("it is one mailbox named Pete at pete@silly.test", () => {
          expect(r.from).toEqual([{ name: "Pete", local: "pete", domain: "silly.test" }]);
        });
      },
    );

    Scenario(
      "The commented To field of RFC 5322 A.5 is read as the group A Group with exactly three members",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.5 message", () => {
          stored = bytes("a5-oddities");
        });

        When("mail reads its To field", () => {
          r = readMessage(stored);
        });

        Then(
          "it is one group named A Group with members Chris Jones at c@public.example, joe@example.org and John at jdoe@one.test, and nothing else",
          () => {
            expect(r.to).toEqual([
              {
                group: "A Group",
                members: [
                  { name: "Chris Jones", local: "c", domain: "public.example" },
                  { name: null, local: "joe", domain: "example.org" },
                  { name: "John", local: "jdoe", domain: "one.test" },
                ],
              },
            ]);
          },
        );
      },
    );

    Scenario(
      "The commented Cc field of RFC 5322 A.5 is read as the empty group Hidden recipients",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.5 message", () => {
          stored = bytes("a5-oddities");
        });

        When("mail reads its Cc field", () => {
          r = readMessage(stored);
        });

        Then("it is one group named Hidden recipients with no members", () => {
          expect(r.cc).toEqual([{ group: "Hidden recipients", members: [] }]);
        });
      },
    );

    Scenario(
      "The obsolete To field of RFC 5322 A.6.1 is read as Mary Smith <mary@example.net> and jdoe@test.example",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the RFC 5322 Appendix A.6.1 message, whose To field has a route, an empty element and a spaced dot",
          () => {
            stored = bytes("a6.1-obs-address");
          },
        );

        When("mail reads its To field", () => {
          r = readMessage(stored);
        });

        Then("it has two mailboxes: Mary Smith at mary@example.net and jdoe@test.example", () => {
          expect(r.to).toEqual([
            { name: "Mary Smith", local: "mary", domain: "example.net" },
            { name: null, local: "jdoe", domain: "test.example" },
          ]);
        });
      },
    );

    Scenario(
      "The obsolete From field of RFC 5322 A.6.3 is read as John Doe <jdoe@machine.example>",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.6.3 message", () => {
          stored = bytes("a6.3-obs-ws");
        });

        When("mail reads its From field", () => {
          r = readMessage(stored);
        });

        Then("it is one mailbox named John Doe at jdoe@machine.example", () => {
          expect(r.from).toEqual([{ name: "John Doe", local: "jdoe", domain: "machine.example" }]);
        });
      },
    );

    Scenario(
      "Two addresses that differ only in the case of their domain are the same address",
      ({ Given, When, Then }) => {
        let a: Address;
        let b: Address;
        let same: boolean;

        Given("the addresses mary@example.net and mary@EXAMPLE.NET", () => {
          a = { name: null, local: "mary", domain: "example.net" };
          b = { ...a, domain: "EXAMPLE.NET" };
        });

        When("mail compares them", () => {
          same = sameMailbox(a, b);
        });

        Then("they are the same address", () => {
          expect(same).toBe(true);
        });
      },
    );

    Scenario(
      "Two addresses that differ only in the case of their local part are different addresses",
      ({ Given, When, Then }) => {
        let a: Address;
        let b: Address;
        let same: boolean;

        Given("the addresses mary@example.net and Mary@example.net", () => {
          a = { name: null, local: "mary", domain: "example.net" };
          b = { ...a, local: "Mary" };
        });

        When("mail compares them", () => {
          same = sameMailbox(a, b);
        });

        Then("they are different addresses", () => {
          expect(same).toBe(false);
        });
      },
    );

    Scenario(
      "A quoted local part and a domain literal are read as written",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r1-literal-quoted (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r1-literal-quoted");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          'From is the local part "\\"john doe\\"" at example.com, and To is jdoe at "[192.0.2.1]"',
          () => {
            expect(r.from).toEqual([{ name: null, local: '"john doe"', domain: "example.com" }]);
            expect(r.to).toEqual([{ name: null, local: "jdoe", domain: "[192.0.2.1]" }]);
          },
        );
      },
    );

    Scenario("Quoted words between the dots of a local part are kept", ({ Given, When, Then }) => {
      let stored: Uint8Array;
      let r: Read;

      Given(
        "the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
        () => {
          stored = bytes("r11-edges");
        },
      );

      When("mail reads it", () => {
        r = readMessage(stored);
      });

      Then('From is the local part a."b c" at x.test', () => {
        expect(r.from).toEqual([{ name: null, local: 'a."b c"', domain: "x.test" }]);
      });
    });

    Scenario(
      "An unclosed comment, quoted string or domain literal makes the field unreadable",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r2-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r2-unclosed");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then("From, To and Cc are each null with an unparsed-value problem", () => {
          expect([r.from, r.to, r.cc]).toEqual([null, null, null]);
          expect(r.problems).toEqual(
            expect.arrayContaining([unparsed("from"), unparsed("to"), unparsed("cc")]),
          );
        });
      },
    );

    Scenario(
      "An address with no domain, or a group member that fits no grammar, makes the field unreadable",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r11-edges");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          'Cc ("lone@") and To ("G: <bad;") are each null with an unparsed-value problem',
          () => {
            expect([r.cc, r.to]).toEqual([null, null]);
            expect(r.problems).toEqual(
              expect.arrayContaining([
                { code: "unparsed-value", field: "cc", detail: "lone@" },
                { code: "unparsed-value", field: "to", detail: "G: <bad;" },
              ]),
            );
          },
        );
      },
    );

    Scenario("From names mailboxes and Sender exactly one", ({ Given, When, Then }) => {
      let group: Read;
      let senders: Read[];

      Given(
        "the fixture r5-group-from (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures), the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
        () => {
          // read takes each fixture by name.
        },
      );

      When("mail reads it", () => {
        group = read("r5-group-from");
        senders = [read("r4-one-each"), read("r11-edges")];
      });

      Then(
        "a group in From, two Senders and an empty Sender are each null with an unparsed-value problem",
        () => {
          expect(group.from).toBeNull();
          expect(group.problems).toContainEqual(unparsed("from"));
          for (const r of senders) {
            expect(r.sender).toBeNull();
            expect(r.problems).toContainEqual(unparsed("sender"));
          }
        },
      );
    });

    Scenario("Domains compare ignoring ASCII case only", ({ Given, When, Then }) => {
      let a: Address;
      let b: Address;
      let same: boolean;

      Given('the domains "\\u212Aelvin.test" (Kelvin sign) and "kelvin.test"', () => {
        a = { name: null, local: "a", domain: "Kelvin.test" };
        b = { name: null, local: "a", domain: "kelvin.test" };
      });

      When("sameMailbox compares a@ each", () => {
        same = sameMailbox(a, b);
      });

      Then("they are different mailboxes", () => {
        expect(same).toBe(false);
      });
    });

    Scenario("Group members are separated by commas", ({ Given, When, Then }) => {
      let fields: string[];
      let reads: ReturnType<typeof readAddresses>[];

      Given('the field "G: a@x.test b@x.test;" and the field "G: a@x.test, b@x.test;"', () => {
        fields = ["G: a@x.test b@x.test;", "G: a@x.test, b@x.test;"];
      });

      When("mail reads each", () => {
        reads = fields.map(readAddresses);
      });

      Then("the first is null and the second is the group G with two members", () => {
        expect(reads[0]).toBeNull();
        expect(reads[1]).toEqual([
          {
            group: "G",
            members: [
              { name: null, local: "a", domain: "x.test" },
              { name: null, local: "b", domain: "x.test" },
            ],
          },
        ]);
      });
    });
  },
  owns(
    "FR-MAIL-004-c1",
    "FR-MAIL-004-c2",
    "FR-MAIL-004-c3",
    "FR-MAIL-004-c4",
    "FR-MAIL-004-c5",
    "FR-MAIL-004-c6",
    "FR-MAIL-004-c7",
    "FR-MAIL-004-c8",
    "FR-MAIL-004-c9",
    "FR-MAIL-004-c10",
    "FR-MAIL-004-c11",
    "FR-MAIL-004-c12",
    "FR-MAIL-004-c13",
    "FR-MAIL-004-c14",
    "FR-MAIL-004-c15",
    "FR-MAIL-004-c16",
    "FR-MAIL-004-c17",
    "FR-MAIL-004-c18",
  ),
);

describeFeature(
  FR005,
  ({ Scenario }) => {
    Scenario(
      "The third message of RFC 5322 A.2 is read with In-Reply-To 3456@example.net and References 1234@local.machine.example then 3456@example.net",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the third message of RFC 5322 Appendix A.2", () => {
          stored = bytes("a2-3-reply");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          "its In-Reply-To is 3456@example.net and its References are 1234@local.machine.example followed by 3456@example.net",
          () => {
            expect(r.inReplyTo).toEqual(["3456@example.net"]);
            expect(r.references).toEqual(["1234@local.machine.example", "3456@example.net"]);
          },
        );
      },
    );

    Scenario(
      "The obsolete Message-ID of RFC 5322 A.6.3 is read as 1234@local.machine.example",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.6.3 message", () => {
          stored = bytes("a6.3-obs-ws");
        });

        When("mail reads its Message-ID", () => {
          r = readMessage(stored);
        });

        Then("it is 1234@local.machine.example", () => {
          expect(r.messageId).toBe("1234@local.machine.example");
        });
      },
    );

    Scenario(
      "The Message-ID of RFC 5322 A.5, preceded by white space, is read as testabcd.1234@silly.test",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("the RFC 5322 Appendix A.5 message", () => {
          stored = bytes("a5-oddities");
        });

        When("mail reads its Message-ID", () => {
          r = readMessage(stored);
        });

        Then("it is testabcd.1234@silly.test", () => {
          expect(r.messageId).toBe("testabcd.1234@silly.test");
        });
      },
    );

    Scenario("A Message-ID holding two identifiers is unreadable", ({ Given, When, Then }) => {
      let stored: Uint8Array;
      let r: Read;

      Given(
        "the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
        () => {
          stored = bytes("r4-one-each");
        },
      );

      When("mail reads it", () => {
        r = readMessage(stored);
      });

      Then("Message-ID is null with an unparsed-value problem", () => {
        expect(r.messageId).toBeNull();
        expect(r.problems).toContainEqual(unparsed("message-id"));
      });
    });

    Scenario(
      'An identifier without "@", without its ">", or with an unclosed comment makes the field unreadable',
      ({ Given, When, Then }) => {
        let cases: [Read, "inReplyTo" | "messageId", string][];

        Given(
          "the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures), the fixture r2-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            // read takes each fixture by name.
          },
        );

        When("mail reads it", () => {
          cases = [
            [read("r4-one-each"), "inReplyTo", "in-reply-to"],
            [read("r2-unclosed"), "messageId", "message-id"],
            [read("r11-edges"), "inReplyTo", "in-reply-to"],
          ];
        });

        Then(
          "In-Reply-To, Message-ID and In-Reply-To are each null with an unparsed-value problem",
          () => {
            for (const [r, key, field] of cases) {
              expect(r[key]).toBeNull();
              expect(r.problems).toContainEqual(unparsed(field));
            }
          },
        );
      },
    );

    Scenario("Words between identifiers in References are skipped", ({ Given, When, Then }) => {
      let stored: Uint8Array;
      let r: Read;

      Given(
        "the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
        () => {
          stored = bytes("r4-one-each");
        },
      );

      When("mail reads it", () => {
        r = readMessage(stored);
      });

      Then('References is ["1@x.test", "2@x.test"]', () => {
        expect(r.references).toEqual(["1@x.test", "2@x.test"]);
      });
    });

    Scenario(
      "An identifier with a quoted left side and a literal right side is read as written",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r1-literal-quoted (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r1-literal-quoted");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then('Message-ID is "\\"quoted\\"@[192.0.2.1]"', () => {
          expect(r.messageId).toBe('"quoted"@[192.0.2.1]');
        });
      },
    );
  },
  owns(
    "FR-MAIL-005-c1",
    "FR-MAIL-005-c2",
    "FR-MAIL-005-c3",
    "FR-MAIL-005-c4",
    "FR-MAIL-005-c5",
    "FR-MAIL-005-c6",
    "FR-MAIL-005-c7",
  ),
);

describeFeature(
  FR006,
  ({ Scenario }) => {
    Scenario(
      "The obsolete date of RFC 5322 A.6.2 is read as 21 November 1997, 09:55:06 Universal Time",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given('the RFC 5322 Appendix A.6.2 message dated "21 Nov 97 09:55:06 GMT"', () => {
          stored = bytes("a6.2-obs-date");
        });

        When("mail reads its date", () => {
          r = readMessage(stored);
        });

        Then("the instant is 1997-11-21 09:55:06 UTC and the zone is Universal Time", () => {
          expect(r.date).toEqual({
            instant: new Date("1997-11-21T09:55:06Z"),
            zone: "GMT",
          });
        });
      },
    );

    Scenario(
      "The obsolete date of RFC 5322 A.6.3 is read as 21 November 1997, 15:55:06 Universal Time",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the RFC 5322 Appendix A.6.3 message with comments and spaces inside its date",
          () => {
            stored = bytes("a6.3-obs-ws");
          },
        );

        When("mail reads its date", () => {
          r = readMessage(stored);
        });

        Then(
          "the instant is 1997-11-21 15:55:06 UTC and the zone is six hours behind Universal Time",
          () => {
            expect(r.date).toEqual({
              instant: new Date("1997-11-21T15:55:06Z"),
              zone: "-0600",
            });
          },
        );
      },
    );

    Scenario(
      "The folded date of RFC 5322 A.5 is read as 14 February 1969, 03:02:00 Universal Time",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the RFC 5322 Appendix A.5 message dated 13 Feb 1969 23:32 -0330 over several lines",
          () => {
            stored = bytes("a5-oddities");
          },
        );

        When("mail reads its date", () => {
          r = readMessage(stored);
        });

        Then("the instant is 1969-02-14 03:02:00 UTC", () => {
          expect(r.date).toEqual({
            instant: new Date("1969-02-14T03:02:00Z"),
            zone: "-0330",
          });
        });
      },
    );

    Scenario(
      "A date of 30 February has no instant and records an invalid-date problem",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given('a message dated "Mon, 30 Feb 2026 10:00:00 +0000"', () => {
          stored = bytes("m5-feb30");
        });

        When("mail reads its date", () => {
          r = readMessage(stored);
        });

        Then(
          "the date has no instant, its text is kept, and an invalid-date problem is recorded",
          () => {
            expectInvalid(r, "Mon, 30 Feb 2026 10:00:00 +0000", "not a day of that month");
          },
        );
      },
    );

    Scenario(
      "A date whose day of the week does not match has no instant and records an invalid-date problem",
      ({ Given, When, Then }) => {
        let date: string;
        let r: Read;

        Given('a message dated "Fri, 2 Mar 2026 10:00:00 +0000", a Monday', () => {
          date = "Fri, 2 Mar 2026 10:00:00 +0000";
        });

        When("mail reads its date", () => {
          r = dated(date);
        });

        Then(
          "the date has no instant, its text is kept, and an invalid-date problem is recorded",
          () => {
            expectInvalid(r, date, "day of the week does not match");
          },
        );
      },
    );

    Scenario(
      "A date whose zone minutes are over 59 has no instant and records an invalid-date problem",
      ({ Given, When, Then }) => {
        let date: string;
        let r: Read;

        Given('a message dated "Mon, 2 Mar 2026 10:00:00 +0060"', () => {
          date = "Mon, 2 Mar 2026 10:00:00 +0060";
        });

        When("mail reads its date", () => {
          r = dated(date);
        });

        Then(
          "the date has no instant, its text is kept, and an invalid-date problem is recorded",
          () => {
            expectInvalid(r, date, "zone minutes over 59");
          },
        );
      },
    );

    Scenario(
      "A date in zone -0000 keeps its instant and an unknown zone",
      ({ Given, When, Then }) => {
        let date: string;
        let r: Read;

        Given('a message dated "Mon, 2 Mar 2026 10:00:00 -0000"', () => {
          date = "Mon, 2 Mar 2026 10:00:00 -0000";
        });

        When("mail reads its date", () => {
          r = dated(date);
        });

        Then(
          "the instant is 2026-03-02 10:00:00 UTC and the zone is unknown, not Universal Time",
          () => {
            expect(r.date).toEqual({
              instant: new Date("2026-03-02T10:00:00Z"),
              zone: null,
            });
          },
        );
      },
    );

    Scenario("A date in a military zone keeps an unknown zone", ({ Given, When, Then }) => {
      let date: string;
      let r: Read;

      Given('a message dated "Mon, 2 Mar 2026 10:00:00 Z"', () => {
        date = "Mon, 2 Mar 2026 10:00:00 Z";
      });

      When("mail reads its date", () => {
        r = dated(date);
      });

      Then("the zone is unknown", () => {
        expect(r.date).toEqual({
          instant: new Date("2026-03-02T10:00:00Z"),
          zone: null,
        });
      });
    });

    Scenario(
      "A two-digit year under 50 is in the 2000s, and a named US zone is applied",
      ({ Given, When, Then }) => {
        let text: string;
        let d: ReturnType<typeof readDate>;

        Given('the date "2 Mar 26 10:00 EST"', () => {
          // The zone as written, as form 01a19b46 and golden r3-years give it.
          text = "2 Mar 26 10:00 EST";
        });

        When("mail reads it", () => {
          d = readDate(text);
        });

        Then('its instant is 2026-03-02T15:00:00Z and its zone "EST"', () => {
          expect(d).toEqual({
            instant: new Date("2026-03-02T15:00:00Z"),
            zone: "EST",
          });
        });
      },
    );

    Scenario("A three-digit year adds 1900", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "2 Mar 126 10:00 +0000"', () => {
        text = "2 Mar 126 10:00 +0000";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then("its instant is 2026-03-02T10:00:00Z", () => {
        expect(d).toEqual({
          instant: new Date("2026-03-02T10:00:00Z"),
          zone: "+0000",
        });
      });
    });

    Scenario("An hour of 24 is not a time of day", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "2 Mar 2026 24:00 +0000"', () => {
        text = "2 Mar 2026 24:00 +0000";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then('it has no instant and the problem "not a time of day"', () => {
        expect(d).toEqual({
          instant: null,
          problem: "not a time of day",
        });
      });
    });

    Scenario(
      "Text that is not a date, or an empty Date, has no instant and is unreadable",
      ({ Given, When, Then }) => {
        let names: string[];
        let reads: Read[];

        Given(
          "the fixture r10-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            names = ["r10-unclosed", "r11-edges"];
          },
        );

        When("mail reads it", () => {
          reads = names.map(read);
        });

        Then("each Date has no instant and an unparsed-value problem", () => {
          for (const r of reads) {
            expect(r.date).toEqual({ instant: null, problem: "not a date" });
            expect(r.problems).toContainEqual({
              code: "unparsed-value",
              field: "date",
              detail: "not a date",
            });
          }
        });
      },
    );

    Scenario("A leap second is the first second of the next minute", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "Sat, 31 Dec 2016 23:59:60 +0000"', () => {
        text = "Sat, 31 Dec 2016 23:59:60 +0000";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then("its instant is 2017-01-01T00:00:00Z", () => {
        expect(d).toEqual({
          instant: new Date("2017-01-01T00:00:00Z"),
          zone: "+0000",
        });
      });
    });

    Scenario("A four-digit year under 100 is that year", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "1 Jan 0049 00:00 +0000"', () => {
        text = "1 Jan 0049 00:00 +0000";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then("its instant is in the year 49", () => {
        expect(d.instant?.getUTCFullYear()).toBe(49);
      });
    });

    Scenario("A signed zone that is not four digits is no date", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "2 Mar 2026 10:00 +05"', () => {
        text = "2 Mar 2026 10:00 +05";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then('it has no instant and the problem "not a date"', () => {
        expect(d).toEqual({ instant: null, problem: "not a date" });
      });
    });

    Scenario("A named zone is kept as written", ({ Given, When, Then }) => {
      let text: string;
      let d: ReturnType<typeof readDate>;

      Given('the date "2 Mar 2026 10:00 Gmt"', () => {
        text = "2 Mar 2026 10:00 Gmt";
      });

      When("mail reads it", () => {
        d = readDate(text);
      });

      Then('its instant is 2026-03-02T10:00:00Z and its zone "Gmt"', () => {
        expect(d).toEqual({
          instant: new Date("2026-03-02T10:00:00Z"),
          zone: "Gmt",
        });
      });
    });
  },
  owns(
    "FR-MAIL-006-c1",
    "FR-MAIL-006-c2",
    "FR-MAIL-006-c3",
    "FR-MAIL-006-c4",
    "FR-MAIL-006-c5",
    "FR-MAIL-006-c6",
    "FR-MAIL-006-c7",
    "FR-MAIL-006-c8",
    "FR-MAIL-006-c9",
    "FR-MAIL-006-c10",
    "FR-MAIL-006-c11",
    "FR-MAIL-006-c12",
    "FR-MAIL-006-c13",
    "FR-MAIL-006-c14",
    "FR-MAIL-006-c15",
    "FR-MAIL-006-c16",
  ),
);

describeFeature(
  FR007,
  ({ Scenario }) => {
    Scenario(
      "A message with no Date and no From records a missing-required problem for each and has no date and no author",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("a message with only To and Subject fields", () => {
          stored = bytes("m1-no-date-no-from");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then(
          "it has no date and no author, and missing-required problems name Date and From",
          () => {
            expect([r.date, r.from]).toEqual([null, null]);
            expect(r.problems).toEqual([
              { code: "missing-required", field: "date", detail: "absent" },
              { code: "missing-required", field: "from", detail: "absent" },
            ]);
          },
        );
      },
    );

    Scenario(
      "A message with bare line feeds records a bare line-break problem",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("a message whose lines end in a line feed alone", () => {
          stored = bytes("m3-bare-lf");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then("a bare line-break problem is recorded", () => {
          expect(r.problems).toContainEqual({
            code: "bare-line-break",
            field: null,
            detail: "a CR or LF outside a CRLF pair",
          });
        });
      },
    );

    Scenario(
      "A message with a header line over 998 characters records a line-too-long problem",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given("a message whose Subject line is 2,000 characters long", () => {
          stored = bytes("m4-long-line");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then("a line-too-long problem is recorded and the Subject is kept whole", () => {
          expect(r.problems).toContainEqual(expect.objectContaining({ code: "line-too-long" }));
          expect(r.subject).toHaveLength(2000);
        });
      },
    );

    Scenario(
      "A From field that fits no address grammar records an unparsed-value problem and yields no address",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given('a message whose From field is "<<<>>> ,,, @@@"', () => {
          stored = bytes("m6-garbage-address");
        });

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then("it has no author and an unparsed-value problem names From", () => {
          expect(r.from).toBeNull();
          expect(r.problems).toContainEqual({
            code: "unparsed-value",
            field: "from",
            detail: "<<<>>> ,,, @@@",
          });
        });
      },
    );

    Scenario(
      "A header line with no colon records a no-colon problem and the fields around it are still read",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          'a message with the line "this line has no colon" between its From and Date fields',
          () => {
            stored = bytes("m7-no-colon-line");
          },
        );

        When("mail reads it", () => {
          r = readMessage(stored);
        });

        Then("a no-colon problem is recorded and From and Date are both read", () => {
          expect(r.problems).toContainEqual({
            code: "no-colon",
            field: null,
            detail: "this line has no colon",
          });
          expect(r.from).not.toBeNull();
          expect(r.date).not.toBeNull();
        });
      },
    );
  },
  owns("FR-MAIL-007-c1", "FR-MAIL-007-c2", "FR-MAIL-007-c3", "FR-MAIL-007-c4", "FR-MAIL-007-c5"),
);

describeFeature(
  FR019,
  ({ Scenario }) => {
    Scenario(
      "Every leaf part of a written message is where Python email finds it, with the same bytes",
      ({ Given, When, Then }) => {
        Given("the writer goldens plain, attachment, forward, rich, intl and reply", () => {
          // The oracle holds the six writer goldens by name.
        });

        When("mail parses each", () => {
          // part parses each inside the Then, around its expect lines.
        });

        Then(
          "every leaf's section, type and raw body bytes equal goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.goldens.read, which match Python email (compat32)",
          () => {
            for (const [name, { leaves }] of Object.entries(oracle)) {
              for (const leaf of leaves) {
                const p = part(name, leaf.path);
                expect(p.type, `${name} ${leaf.path}`).toBe(leaf.type);
                if (leaf.raw !== null)
                  expect(slice(name, p.body), `${name} ${leaf.path}`).toBe(leaf.raw);
              }
            }
          },
        );
      },
    );

    Scenario("A message/rfc822 part is read as a message", ({ Given, When, Then }) => {
      let forwarded: Part;
      let inner: Part;

      Given("the forward golden", () => {
        // part reads the forward golden by name.
      });

      When("mail parses it", () => {
        forwarded = part("forward", "3");
        inner = part("forward", "3.1");
      });

      Then(
        'part 3 is message/rfc822 whose header begins "From: John Doe <jdoe@machine.example>", and section 3.1 is its text/plain body',
        () => {
          expect(forwarded.type).toBe("message/rfc822");
          expect(forwarded.message).not.toBeNull();
          expect(slice("forward", inner.header)).toMatch(/^From: John Doe <jdoe@machine\.example>/);
          expect(inner).toEqual(forwarded.message);
          expect(inner.type).toBe("text/plain");
        },
      );
    });

    Scenario('A line that only begins with "--" is no boundary', ({ Given, When, Then }) => {
      Given(
        'the forward golden, whose text part holds "---------- Forwarded message ---------"',
        () => {
          // part reads the forward golden by name.
        },
      );

      When("mail parses it", () => {
        // part parses it inside the Then, around its expect lines.
      });

      Then("part 1.1 holds that line and part 1 has two children", () => {
        expect(slice("forward", part("forward", "1.1").body)).toContain(
          "---------- Forwarded message ---------",
        );
        expect(part("forward", "1").children).toHaveLength(2);
      });
    });

    Scenario(
      "A multipart with no boundary has no parts and records a problem",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r8-broken-multipart (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r8-broken-multipart");
          },
        );

        When("mail parses it", () => {
          r = readMessage(stored);
        });

        Then("the root has no children and a multipart-no-boundary problem", () => {
          expect(r.root.children).toEqual([]);
          expect(r.problems).toContainEqual({
            code: "multipart-no-boundary",
            field: "content-type",
            detail: "multipart/mixed",
          });
        });
      },
    );

    Scenario(
      "A multipart with no closing line keeps its last part to the end and records a problem",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r10-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r10-unclosed");
          },
        );

        When("mail parses it", () => {
          r = readMessage(stored);
        });

        Then("the root has one child running to the end, and a multipart-unclosed problem", () => {
          expect(r.root.children).toHaveLength(1);
          expect(r.root.children[0]?.body.end).toBe(bytes("r10-unclosed").length);
          expect(r.problems).toContainEqual({
            code: "multipart-unclosed",
            field: "content-type",
            detail: "b",
          });
        });
      },
    );

    Scenario(
      "The parts of a digest are messages, and a part may have an empty header or no body",
      ({ Given, When, Then }) => {
        let stored: Uint8Array;
        let r: Read;

        Given(
          "the fixture r6-digest (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            stored = bytes("r6-digest");
          },
        );

        When("mail parses it", () => {
          r = readMessage(stored);
        });

        Then(
          'the boundary is d"q; child 1 is message/rfc822 with an empty header holding "From: inner@x.test"; child 2 is text/plain, all header, with an empty body',
          () => {
            const { root } = r;
            expect(root.params["boundary"]).toBe('d"q');
            const [message, text] = root.children;
            expect(message?.type).toBe("message/rfc822");
            expect(message?.header.start).toBe(message?.header.end);
            expect(slice("r6-digest", message?.message?.header ?? root.body)).toContain(
              "From: inner@x.test",
            );
            expect(text?.type).toBe("text/plain");
            expect(slice("r6-digest", text?.header ?? root.body)).toBe("Content-Type: text/plain");
            expect(text?.body.start).toBe(text?.body.end);
          },
        );
      },
    );

    Scenario("A message with no empty line is all header", ({ Given, When, Then }) => {
      let stored: Uint8Array;
      let r: Read;

      Given(
        "the fixture r9-all-header (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
        () => {
          stored = bytes("r9-all-header");
        },
      );

      When("mail parses it", () => {
        r = readMessage(stored);
      });

      Then('the body is empty and section "1" is the root', () => {
        const { root } = r;
        expect(root.body).toEqual({
          start: bytes("r9-all-header").length,
          end: bytes("r9-all-header").length,
        });
        expect(section(root, "1")).toBe(root);
      });
    });

    Scenario("A section that does not exist is null", ({ Given, When, Then }) => {
      let root: Part;

      Given("the attachment golden", () => {
        root = read("attachment").root;
      });

      When('sections "9" and "2.1.1" are asked for', () => {
        // section runs inside the Then, wrapped by its expect.
      });

      Then("both are null", () => {
        expect(section(root, "9")).toBeNull();
        expect(section(root, "2.1.1")).toBeNull();
      });
    });

    Scenario("Each text part decodes as Python email decodes it", ({ Given, When, Then }) => {
      Given("the six writer goldens", () => {
        // The oracle holds the six writer goldens by name.
      });

      When("partText decodes every text leaf", () => {
        // partText decodes each inside the Then, wrapped by its expect.
      });

      Then(
        "each equals the text Python email decodes (get_payload(decode=True), the part charset)",
        () => {
          for (const [name, { leaves }] of Object.entries(oracle)) {
            for (const leaf of leaves) {
              if (leaf.text !== null) {
                expect(
                  partText(binary(bytes(name)), part(name, leaf.path)),
                  `${name} ${leaf.path}`,
                ).toBe(leaf.text);
              }
            }
          }
        },
      );
    });

    Scenario("A base64 part decodes to its bytes", ({ Given, When, Then }) => {
      let pdf: Part;
      let decoded: Uint8Array;

      Given("the attachment golden", () => {
        pdf = part("attachment", "2");
      });

      When("part 2 is transfer-decoded", () => {
        decoded = transferDecode(slice("attachment", pdf.body), "base64");
      });

      Then("the bytes equal what Python email decodes for it", () => {
        // What Python email decodes for it: the attachment case's 3,000 bytes, byte i = i mod 256.
        const python = Uint8Array.from({ length: 3000 }, (_, i) => i % 256);
        expect(decoded).toEqual(python);
      });
    });

    Scenario(
      'Quoted-printable keeps an "=" that is no escape, and an unknown charset decodes as UTF-8',
      ({ Given, When, Then }) => {
        let root: Part;
        let text: string;

        Given(
          "the fixture r7-decode (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            root = read("r7-decode").root;
          },
        );

        When("partText decodes the root", () => {
          text = partText(binary(bytes("r7-decode")), root);
        });

        Then('the text is "a=b =zz café" and CRLF', () => {
          expect(text).toBe("a=b =zz café\r\n");
        });
      },
    );

    Scenario(
      "Encoded words decode, join, and leave what does not decode",
      ({ Given, When, Then }) => {
        let r: Read;
        let subject: string;

        Given(
          "the fixture r7-decode (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)",
          () => {
            r = read("r7-decode");
          },
        );

        When("decodeWords decodes its Subject", () => {
          subject = decodeWords(r.subject ?? "");
        });

        Then('it is "café ok ✔ =?nosuch?Q?x?="', () => {
          expect(subject).toBe("café ok ✔ =?nosuch?Q?x?=");
        });
      },
    );

    Scenario(
      "A written subject in another script decodes as Python decodes it",
      ({ Given, When, Then }) => {
        let r: Read;
        let subject: string;

        Given("the intl golden", () => {
          r = read("intl");
        });

        When("decodeWords decodes its Subject", () => {
          subject = decodeWords(r.subject ?? "");
        });

        Then("it equals make_header(decode_header(Subject)) in Python", () => {
          expect(subject).toBe(oracle["intl"]?.subject);
        });
      },
    );

    Scenario("Every fixture reads exactly as its golden", ({ Given, When, Then }) => {
      let names: string[];
      let all: Record<string, unknown>;

      Given("every fixture of the reading reference", () => {
        names = readdirSync(FIXTURES)
          .filter((f) => f.endsWith(".eml"))
          .map((f) => f.slice(0, -4));
      });

      When("readMessage reads each", () => {
        all = Object.fromEntries(
          names.map((name) => {
            const r = read(name);
            const date = r.date?.instant
              ? { instant: r.date.instant.toISOString(), zone: r.date.zone }
              : r.date;
            return [name, JSON.parse(JSON.stringify({ ...r, date }))];
          }),
        );
      });

      Then(
        "the result equals goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.goldens.read (dates as ISO strings)",
        () => {
          expect(names).toHaveLength(38);
          expect(all).toEqual(goldens);
        },
      );
    });

    Scenario(
      'Quoted-printable drops white space at the end of a line, so "=" and spaces is a soft break',
      ({ Given, When, Then }) => {
        let text: string;
        let decoded: Uint8Array;

        Given(
          'the text "a" two spaces CRLF "b=" two spaces CRLF "c" tab, encoded " Quoted-Printable "',
          () => {
            text = "a  \r\nb=  \r\nc\t";
          },
        );

        When("transferDecode decodes it", () => {
          decoded = transferDecode(text, " Quoted-Printable ");
        });

        Then('the bytes are "a" CRLF "bc"', () => {
          expect(decoded).toEqual(new TextEncoder().encode("a\r\nbc"));
        });
      },
    );

    Scenario(
      "Nesting deeper than 50 is read as a leaf, and reading never throws",
      ({ Given, When, Then }) => {
        let messages: Uint8Array[];
        let reads: Read[];

        Given(
          "the fixture r12-deep (60 nested message/rfc822 parts), and a message nested 5,000 deep",
          () => {
            const nested = (depth: number): string =>
              "From: a@x.test\r\nContent-Type: message/rfc822\r\n\r\n".repeat(depth) +
              "From: a@x.test\r\n\r\nbody\r\n";
            messages = [bytes("r12-deep"), new TextEncoder().encode(nested(5000))];
          },
        );

        When("mail reads each", () => {
          reads = messages.map((m) => readMessage(m));
        });

        Then(
          'each records one too-deep problem, field content-type, detail "nesting over 50", and nothing throws',
          () => {
            const tooDeep = { code: "too-deep", field: "content-type", detail: "nesting over 50" };
            for (const r of reads) {
              expect(r.problems.filter((p) => p.code === "too-deep")).toEqual([tooDeep]);
            }
          },
        );
      },
    );

    Scenario("A Content-Type value gives its type and parameters", ({ Given, When, Then }) => {
      let value: string;
      let type: ReturnType<typeof contentType>;

      Given('the value text/plain; charset="utf-8"; format=flowed', () => {
        value = 'text/plain; charset="utf-8"; format=flowed';
      });

      When("contentType reads it", () => {
        type = contentType(value);
      });

      Then("the type is text/plain and the parameters are charset utf-8 and format flowed", () => {
        expect(type).toEqual({
          type: "text/plain",
          params: { charset: "utf-8", format: "flowed" },
        });
      });
    });

    Scenario("A part's own header fields are read", ({ Given, When, Then }) => {
      let pdf: Part;
      let fields: ReturnType<typeof partFields>;

      Given("part 2 of the attachment golden", () => {
        pdf = part("attachment", "2");
      });

      When("partFields reads it", () => {
        fields = partFields(bytes("attachment"), pdf);
      });

      Then(
        "its fields are Content-Type, Content-Transfer-Encoding and Content-Disposition, in that order",
        () => {
          expect(fields.map((f) => f.name)).toEqual([
            "Content-Type",
            "Content-Transfer-Encoding",
            "Content-Disposition",
          ]);
        },
      );
    });

    Scenario("A part's body lines are counted as IMAP counts them", ({ Given, When, Then }) => {
      let attachment: Uint8Array;

      Given("parts 1.1 and 2 of the attachment golden, and the root of r9-all-header", () => {
        attachment = bytes("attachment");
      });

      When("bodyLines counts each", () => {
        // bodyLines counts each inside the Then, wrapped by its expect.
      });

      Then("they are 1, 53 and 0", () => {
        expect(bodyLines(attachment, part("attachment", "1.1"))).toBe(1);
        expect(bodyLines(attachment, part("attachment", "2"))).toBe(53);
        expect(bodyLines(bytes("r9-all-header"), read("r9-all-header").root)).toBe(0);
      });
    });
  },
  owns(
    "FR-MAIL-019-c1",
    "FR-MAIL-019-c2",
    "FR-MAIL-019-c3",
    "FR-MAIL-019-c4",
    "FR-MAIL-019-c5",
    "FR-MAIL-019-c6",
    "FR-MAIL-019-c7",
    "FR-MAIL-019-c8",
    "FR-MAIL-019-c9",
    "FR-MAIL-019-c10",
    "FR-MAIL-019-c11",
    "FR-MAIL-019-c12",
    "FR-MAIL-019-c13",
    "FR-MAIL-019-c14",
    "FR-MAIL-019-c15",
    "FR-MAIL-019-c16",
    "FR-MAIL-019-c17",
    "FR-MAIL-019-c18",
    "FR-MAIL-019-c19",
  ),
);

describeFeature(
  FR045,
  ({ Scenario }) => {
    Scenario(
      "A header section past the bound is read only to the bound",
      ({ Given, When, Then }) => {
        Given(
          "a message whose header section passes 1 MiB, with a Message-ID before the bound and one field after it",
          () => {
            // Each message is built inside the Then, beside the expect lines it serves.
          },
        );

        When("readMessage runs", () => {
          // readMessage runs inside the Then, beside its expect lines.
        });

        Then(
          "the Message-ID reads, the later field does not, and a header-too-large problem is recorded",
          () => {
            const over = readMessage(encode(`${header("X: y\r\n", MIB)}Late: z\r\n\r\nbody\r\n`));
            expect(over.messageId).toBe("early@x.test");
            expect(over.fields.map((f) => f.name)).not.toContain("Late");
            expect(codes(over, "header-too-large")).toHaveLength(1);
            // The bound falls inside a line break here, which reads as neither half of one.
            const inside = readMessage(
              encode(`X:y\r\n${"X: y\r\n".repeat(MIB / 6 + 1)}\r\nbody\r\n`),
            );
            expect(codes(inside, "header-too-large")).toHaveLength(1);
            expect(codes(inside, "bare-line-break")).toEqual([]);
            // One line past the bound has no line break to stop at, and reads to the bound.
            const line = readMessage(encode(`X: ${"y".repeat(MIB)}`));
            expect(line.fields[0]?.value).toHaveLength(MIB - 3);
            expect(codes(line, "header-too-large")).toHaveLength(1);
            // A part's header section is a header section.
            const nested = readMessage(
              encode(
                `From: a@x.test\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n${header("X: y\r\n", MIB)}Late: z\r\n\r\nbody\r\n--b--\r\n`,
              ),
            );
            expect(codes(nested, "header-too-large")).toHaveLength(1);
            // A section at the bound is read whole.
            const whole = `${"X: yyyy\r\n".repeat(MIB / 9)}`;
            const at = readMessage(
              encode(`${whole}${"x".repeat(MIB - whole.length - 3)}: y\r\n\r\nbody`),
            );
            expect(codes(at, "header-too-large")).toEqual([]);
            expect(at.fields.at(-1)?.value).toBe("y");
          },
        );
      },
    );

    Scenario("Parts past the bound are not walked", ({ Given, When, Then }) => {
      Given("a multipart message of more than 10,000 parts, nested and flat", () => {
        // Each shape is built inside the Then, beside the expect lines it serves.
      });

      When("readMessage runs", () => {
        // readMessage runs inside the Then, beside its expect lines.
      });

      Then(
        "at most 10,000 parts are read, the rest is left unread inside its parent, and a too-many-parts problem is recorded",
        () => {
          const count = (p: Part): number =>
            1 +
            (p.message === null ? 0 : count(p.message)) +
            p.children.reduce((n, c) => n + count(c), 0);
          const top = "From: a@x.test\r\nContent-Type: multipart/mixed; boundary=t\r\n\r\n";
          const leaf = "--t\r\n\r\nleaf\r\n";
          const inner =
            "--t\r\nContent-Type: multipart/mixed; boundary=i\r\n\r\n--i\r\n\r\nx\r\n--i--\r\n";
          const message = "--t\r\nContent-Type: message/rfc822\r\n\r\nFrom: a@x.test\r\n\r\nx\r\n";
          const shapes = [
            { each: leaf, end: "--t--\r\n" }, // flat and closed
            { each: leaf, end: "" }, // flat and never closed
            { each: inner, end: "--t--\r\n" }, // nested
            { each: inner, end: "" }, // nested and never closed
            { each: message, end: "--t--\r\n" }, // message parts
          ];
          for (const { each, end } of shapes) {
            const text = `${top}${each.repeat(10_100)}${end}`;
            const r = readMessage(encode(text));
            expect(count(r.root)).toBeLessThanOrEqual(10_000);
            expect(count(r.root)).toBeGreaterThan(9_990);
            expect(codes(r, "too-many-parts")).toEqual([
              { code: "too-many-parts", field: "content-type", detail: "parts over 10000" },
            ]);
            expect(codes(r, "multipart-unclosed")).toEqual([]);
            // The rest is left unread inside its parent, and the last part read ends where the next begins.
            expect(r.root.body.end).toBe(text.length);
            const last = r.root.children.at(-1);
            expect(text.slice(last?.body.end, (last?.body.end ?? 0) + 5)).toBe("\r\n--t");
          }
          // The root and 9,999 parts are 10,000, which is the bound and not past it.
          const fits = readMessage(encode(`${top}${leaf.repeat(9_999)}--t--\r\n`));
          expect(count(fits.root)).toBe(10_000);
          expect(fits.problems.filter((p) => p.code !== "missing-required")).toEqual([]);
          // So too when unclosed: the end was reached, and nothing else says so.
          expect(
            codes(readMessage(encode(`${top}${leaf.repeat(9_999)}`)), "multipart-unclosed"),
          ).toEqual([{ code: "multipart-unclosed", field: "content-type", detail: "t" }]);
        },
      );
    });

    Scenario("No shape runs a reader out of memory at 25 MiB", ({ Given, When, Then }) => {
      let script: string;
      let outputs: [string, string][];

      Given(
        "a child process with a 128 MB heap, and at 25 MiB: many fields, one field folded millions of times, millions of parts, and plain text",
        () => {
          script = new URL("heap-read.ts", import.meta.url).pathname;
        },
      );

      When("readMessage runs on each", async () => {
        outputs = [];
        for (const shape of SHAPES) {
          const { stdout } = await promisify(execFile)(process.execPath, [
            "--max-old-space-size=128",
            script,
            shape,
          ]);
          outputs.push([shape, stdout]);
        }
      });

      Then("each returns", () => {
        for (const [shape, stdout] of outputs) expect(stdout).toBe(`${shape}@x.test\n`);
      });
    });

    Scenario("Every read golden is unchanged", ({ Given, When, Then }) => {
      Given("the existing read fixtures", () => {
        // everyFixture lists the read fixtures and golden.json.
      });

      When("readMessage runs", () => {
        // everyFixture reads each inside the Then, around its expect lines.
      });

      Then("every result equals what it was before the bound", () => {
        everyFixture();
      });
    });
  },
  owns("FR-MAIL-045-c1", "FR-MAIL-045-c2", "FR-MAIL-045-c3", "FR-MAIL-045-c5"),
);
