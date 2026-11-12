import { describeFeature } from "@amiceli/vitest-cucumber";
import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vite-plus/test";
import type { Mail, Written } from "../src/message/index.ts";
import { testMail, text, writeCase } from "./cases.ts";
import { feature, owns } from "./feature.ts";
import { parent } from "./fixtures/parents.ts";
import { john, mary } from "./fixtures/people.ts";

const doc = [{ p: ["Hello."] }];

/** A parent message, as replyTo takes it. */
type Parent = Parameters<Mail["replyTo"]>[0];

/** A mailbox with no name, from its address. */
function box(local: string, domain: string) {
  return { addr: { local, domain } };
}

/** The header field of a written message, unfolded, or undefined when it is not written. */
function header(written: Written, name: string): string | undefined {
  const [head = ""] = text(written).split("\r\n\r\n");
  const fields = head.replaceAll("\r\n ", " ").split("\r\n");
  return fields.find((f) => f.startsWith(`${name}: `))?.slice(name.length + 2);
}

const FR010 = await feature("FR-MAIL-010");
const FR011 = await feature("FR-MAIL-011");

describeFeature(
  FR010,
  ({ Scenario }) => {
    Scenario(
      "A reply to the first A.2 message has In-Reply-To and References 1234@local.machine.example",
      ({ Given, When, Then }) => {
        let p: Parent;
        let written: Written;

        Given("the parent a2-1", () => {
          p = parent("a2-1");
        });

        When("mary replies to it", () => {
          written = testMail().replyTo(p)({ from: mary, doc });
        });

        Then(
          "the reply's In-Reply-To and References are both 1234@local.machine.example, as in the second message of RFC 5322 A.2",
          () => {
            expect(header(written, "In-Reply-To")).toBe("<1234@local.machine.example>");
            expect(header(written, "References")).toBe("<1234@local.machine.example>");
          },
        );
      },
    );

    Scenario(
      "A reply to the second A.2 message threads as the third A.2 message does",
      ({ Given, When, Then }) => {
        let p: Parent;
        let written: Written;

        Given("the parent a2-2", () => {
          p = parent("a2-2");
        });

        When("john replies to it", () => {
          written = testMail().replyTo(p)({ from: john, doc });
        });

        Then(
          "the reply's In-Reply-To is 3456@example.net and its References are 1234@local.machine.example then 3456@example.net",
          () => {
            expect(header(written, "In-Reply-To")).toBe("<3456@example.net>");
            expect(header(written, "References")).toBe(
              "<1234@local.machine.example> <3456@example.net>",
            );
          },
        );
      },
    );

    Scenario(
      "A parent with one In-Reply-To and no References gives References of that id then its Message-ID",
      ({ Given, When, Then }) => {
        let p: Parent;
        let written: Written;

        Given("a parent with Message-ID c@x.test and In-Reply-To b@x.test", () => {
          p = { from: [john], messageId: "c@x.test", inReplyTo: ["b@x.test"], doc };
        });

        When("someone replies to it", () => {
          written = testMail().replyTo(p)({ from: mary, doc });
        });

        Then("the reply's References are b@x.test then c@x.test", () => {
          expect(header(written, "References")).toBe("<b@x.test> <c@x.test>");
        });
      },
    );

    Scenario("A parent with no ids gives a reply with neither field", ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given("a parent with no Message-ID, In-Reply-To or References", () => {
        p = { from: [john], doc };
      });

      When("someone replies to it", () => {
        written = testMail().replyTo(p)({ from: mary, doc });
      });

      Then("the reply has no In-Reply-To and no References", () => {
        expect(header(written, "In-Reply-To")).toBeUndefined();
        expect(header(written, "References")).toBeUndefined();
      });
    });

    Scenario("A reply's threading reads back unchanged", ({ Given, When, Then }) => {
      let reads: Awaited<ReturnType<typeof readBack>>;

      Given("the reply case", () => {
        // writeCase writes the reply case in the When.
      });

      When(
        "mail writes it and postal-mime, mailparser and Python email each read it back",
        async () => {
          reads = await readBack(writeCase("reply").bytes);
        },
      );

      Then("each reads In-Reply-To and References as mail wrote them", () => {
        for (const read of Object.values(reads)) {
          expect(read.inReplyTo).toEqual(["1234@local.machine.example"]);
          expect(read.references).toEqual(["1234@local.machine.example"]);
        }
      });
    });
  },
  owns("FR-MAIL-010-c1", "FR-MAIL-010-c2", "FR-MAIL-010-c3", "FR-MAIL-010-c4", "FR-MAIL-010-c5"),
);

describeFeature(
  FR011,
  ({ Scenario }) => {
    Scenario("A reply to a parent with a Reply-To goes there", ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given(
        'the parent a2-2, which has Reply-To "Mary Smith: Personal Account" <smith@home.example>',
        () => {
          p = parent("a2-2");
        },
      );

      When("john replies to it", () => {
        written = testMail().replyTo(p)({ from: john, doc });
      });

      Then(
        'the reply is to "Mary Smith: Personal Account" <smith@home.example>, as in the third message of RFC 5322 A.2',
        () => {
          expect(header(written, "To")).toBe('"Mary Smith: Personal Account" <smith@home.example>');
        },
      );
    });

    Scenario("A reply to a parent without a Reply-To goes to its From", ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given("the parent a2-1", () => {
        p = parent("a2-1");
      });

      When("mary replies to it", () => {
        written = testMail().replyTo(p)({ from: mary, doc });
      });

      Then("the reply is to John Doe <jdoe@machine.example>", () => {
        expect(header(written, "To")).toBe("John Doe <jdoe@machine.example>");
      });
    });

    Scenario(
      "A reply to all copies the other recipients, without the replier",
      ({ Given, When, Then }) => {
        let p: Parent;
        let written: Written;

        Given("the parent a1.2", () => {
          p = parent("a1.2");
        });

        When("Mary Smith <mary@x.test> replies to all", () => {
          written = testMail().replyTo(p)({
            from: { name: "Mary Smith", addr: { local: "mary", domain: "x.test" } },
            all: true,
            doc,
          });
        });

        Then(
          'the reply is to Joe Q. Public and copies jdoe@example.org, Who? <one@y.test>, boss@nil.test and "Giant; \\"Big\\" Box", and not mary@x.test',
          () => {
            expect(header(written, "To")).toBe('"Joe Q. Public" <john.q.public@example.com>');
            expect(header(written, "Cc")).toBe(
              'jdoe@example.org, Who? <one@y.test>, boss@nil.test, "Giant; \\"Big\\" Box" <sysservices@example.net>',
            );
          },
        );
      },
    );

    Scenario('The subject gains one "Re: "', ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given('the parent a2-1, subject "Saying Hello"', () => {
        p = parent("a2-1");
      });

      When("mary replies to it", () => {
        written = testMail().replyTo(p)({ from: mary, doc });
      });

      Then('the reply\'s subject is "Re: Saying Hello"', () => {
        expect(header(written, "Subject")).toBe("Re: Saying Hello");
      });
    });

    Scenario('A subject that already starts "Re: " keeps one', ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given('the parent a2-2, subject "Re: Saying Hello"', () => {
        p = parent("a2-2");
      });

      When("john replies to it", () => {
        written = testMail().replyTo(p)({ from: john, doc });
      });

      Then('the reply\'s subject is "Re: Saying Hello"', () => {
        expect(header(written, "Subject")).toBe("Re: Saying Hello");
      });
    });

    Scenario('"RE:" in any case becomes one "Re: "', ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given('a parent with subject "RE: Saying Hello"', () => {
        p = { from: [john], subject: "RE: Saying Hello", doc };
      });

      When("someone replies to it", () => {
        written = testMail().replyTo(p)({ from: mary, doc });
      });

      Then('the reply\'s subject is "Re: Saying Hello"', () => {
        expect(header(written, "Subject")).toBe("Re: Saying Hello");
      });
    });

    Scenario('A parent with no subject gives "Re:"', ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given("a parent with no subject", () => {
        p = { from: [john], doc };
      });

      When("someone replies to it", () => {
        written = testMail().replyTo(p)({ from: mary, doc });
      });

      Then('the reply\'s subject is "Re:"', () => {
        expect(header(written, "Subject")).toBe("Re:");
      });
    });

    Scenario("Reply-all copies each person once", ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given(
        "a parent from john to mary and Ann <ann@example.org>, Cc ann@EXAMPLE.org and john",
        () => {
          p = {
            from: [john],
            to: [mary, { name: "Ann", addr: { local: "ann", domain: "example.org" } }],
            cc: [box("ann", "EXAMPLE.org"), john],
            doc,
          };
        },
      );

      When("mary replies to all", () => {
        written = testMail().replyTo(p)({ from: mary, all: true, doc });
      });

      Then(
        "the reply is to john and copies Ann <ann@example.org> once, and copies neither mary nor john",
        () => {
          expect(header(written, "To")).toBe("John Doe <jdoe@machine.example>");
          expect(header(written, "Cc")).toBe("Ann <ann@example.org>");
        },
      );
    });

    Scenario("Reply-all expands a group into its members", ({ Given, When, Then }) => {
      let p: Parent;
      let written: Written;

      Given('a parent from john to the group "Team" of ann@example.org and bob@example.org', () => {
        p = {
          from: [john],
          to: [{ group: "Team", members: [box("ann", "example.org"), box("bob", "example.org")] }],
          doc,
        };
      });

      When("mary replies to all", () => {
        written = testMail().replyTo(p)({ from: mary, all: true, doc });
      });

      Then("the reply copies ann@example.org and bob@example.org", () => {
        expect(header(written, "Cc")).toBe("ann@example.org, bob@example.org");
      });
    });
  },
  owns(
    "FR-MAIL-011-c1",
    "FR-MAIL-011-c2",
    "FR-MAIL-011-c3",
    "FR-MAIL-011-c4",
    "FR-MAIL-011-c5",
    "FR-MAIL-011-c6",
    "FR-MAIL-011-c7",
    "FR-MAIL-011-c8",
    "FR-MAIL-011-c9",
  ),
);
