import { describeFeature } from "@amiceli/vitest-cucumber";
import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vite-plus/test";
import type { Written } from "../src/message/index.ts";
import { expectRefused, testMail, writeCase } from "./cases.ts";
import { feature, owns } from "./feature.ts";
import { parent } from "./fixtures/parents.ts";
import { jane, john, mary, sean } from "./fixtures/people.ts";

/** The case as each reader reads it back. */
async function readCase(name: string) {
  return Object.values(await readBack(writeCase(name).bytes));
}

/** What the HTML holds inside its article wrapper. */
function insideWrapper(html: string): string {
  return html.replace(/^.*?<div role="article"[^>]*>/s, "").replace(/<\/div><\/body><\/html>$/, "");
}

/** A forward from mary to jane of this parent. */
function forwardOf(parentInput: Parameters<ReturnType<typeof testMail>["forward"]>[0]): Written {
  return testMail().forward(parentInput)({ from: mary, to: [jane], doc: [{ p: ["See below."] }] });
}

/** A reply from mary to a parent from john whose document is this, as each reader reads it back. */
async function readReplyTo(doc: { p: ({ a: string; href: string } | string)[] }[]) {
  const written = testMail().replyTo({ from: [john], doc })({ from: mary, doc: [{ p: ["Yes."] }] });
  return Object.values(await readBack(written.bytes));
}

type Reads = Awaited<ReturnType<typeof readCase>>;

const FR013 = await feature("FR-MAIL-013");

describeFeature(
  FR013,
  ({ Scenario }) => {
    Scenario(
      "The HTML has no style block, table or colour, and only the closed vocabulary inside its wrapper",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the link case", () => {
          name = "link";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          "its HTML has no style element, no table and no color or background property, and inside the article wrapper only paragraphs, lists, list items, links, emphasis, strong emphasis, line breaks, block quotes and divisions",
          () => {
            const allowed = new Set([
              "p",
              "ul",
              "li",
              "a",
              "em",
              "strong",
              "br",
              "blockquote",
              "div",
            ]);
            for (const { html } of reads) {
              expect(html).not.toMatch(/<style/i);
              expect(html).not.toMatch(/<table/i);
              expect(html).not.toMatch(/(^|[;"\s])(color|background)(-[a-z]+)?\s*:/i);
              for (const [, tag] of insideWrapper(html ?? "").matchAll(
                /<\/?([a-zA-Z][a-zA-Z0-9]*)/g,
              )) {
                expect(allowed).toContain(tag?.toLowerCase());
              }
            }
          },
        );
      },
    );

    Scenario(
      "The text part says the same words, with a link's address after its text",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the link case", () => {
          name = "link";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          'the text part has the line "Here is the getting started guide (https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&utm_medium=reply&ref=abcdefghijklmnopqrstuvwxyz) — it covers everything."',
          () => {
            for (const read of reads) {
              expect(read.text?.split("\n")).toContain(
                "Here is the getting started guide (https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&utm_medium=reply&ref=abcdefghijklmnopqrstuvwxyz) — it covers everything.",
              );
            }
          },
        );
      },
    );

    Scenario(
      "The HTML declares its language, direction and colour schemes",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the plain case", () => {
          name = "plain";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          'its HTML has lang "en" and dir "ltr" on the document and on the article wrapper, and colour-scheme "light dark"',
          () => {
            for (const { html } of reads) {
              expect(html).toMatch(/<html lang="en" dir="ltr">/);
              expect(html).toMatch(/<div role="article"[^>]* lang="en" dir="ltr"/);
              expect(html).toContain('<meta name="color-scheme" content="light dark">');
            }
          },
        );
      },
    );

    Scenario("Lists and emphasis render in both parts", ({ Given, When, Then }) => {
      let name: string;
      let reads: Reads;

      Given("the rich case", () => {
        name = "rich";
      });

      When("mail writes it", async () => {
        reads = await readCase(name);
      });

      Then(
        'the HTML has a list of three items and emphasis and strong emphasis, and the text part has the lines "- the guide", "- the https://rafters.studio/docs" and "- the reply"',
        () => {
          for (const { html, text } of reads) {
            expect(html?.match(/<ul[^>]*>(<li>.*?<\/li>){3}<\/ul>/)).not.toBeNull();
            expect(html).toContain("<em>briefly</em>");
            expect(html).toContain("<strong>important</strong>");
            const lines = text?.split("\n");
            expect(lines).toContain("- the guide");
            expect(lines).toContain("- the https://rafters.studio/docs");
            expect(lines).toContain("- the reply");
          }
        },
      );
    });

    Scenario(
      "A link whose text is its address appears once in the text part",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the rich case, whose list links https://rafters.studio/docs to itself", () => {
          name = "rich";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          'the text part has "the https://rafters.studio/docs" and not the address twice',
          () => {
            for (const { text } of reads) {
              expect(text).toContain("the https://rafters.studio/docs");
              expect(text?.split("https://rafters.studio/docs").length).toBe(2);
            }
          },
        );
      },
    );

    Scenario("Right-to-left mail declares its language and direction", ({ Given, When, Then }) => {
      let name: string;
      let reads: Reads;

      Given("the rtl case", () => {
        name = "rtl";
      });

      When("mail writes it", async () => {
        reads = await readCase(name);
      });

      Then(
        'its HTML has lang "he" and dir "rtl" on the document and on the article wrapper, and each reader reads the subject "שלום"',
        () => {
          for (const { html, subject } of reads) {
            expect(html).toMatch(/<html lang="he" dir="rtl">/);
            expect(html).toMatch(/<div role="article"[^>]* lang="he" dir="rtl"/);
            expect(subject).toBe("שלום");
          }
        },
      );
    });

    Scenario("A link to anything but http, https or mailto is refused", ({ Given, When, Then }) => {
      Given('a message whose only paragraph is a link to "javascript:alert(1)"', () => {
        // The message is built inside the Then, wrapped by expectRefused.
      });

      When("mail is asked to write it", () => {
        // compose runs inside the Then, wrapped by expectRefused.
      });

      Then(
        "it is refused with error code unsafe-link for field doc[0].p[0].href, and nothing is written",
        () => {
          expectRefused(
            (mail) =>
              mail.compose({ from: sean, to: [mary] })({
                doc: [{ p: [{ a: "click here", href: "javascript:alert(1)" }] }],
              }),
            "unsafe-link",
            "doc[0].p[0].href",
            "links must be http, https or mailto",
          );
        },
      );
    });

    Scenario(
      'A reply quotes its parent under "On {date}, {author} wrote:"',
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the reply case", () => {
          name = "reply";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          'its HTML has "On Fri, 21 Nov 1997 09:55:06 -0600, John Doe <jdoe@machine.example> wrote:" in a gmail_attr division and the parent\'s words in a gmail_quote blockquote of type cite, and its text part has the line "> This is a message just to say hello."',
          () => {
            for (const { html, text } of reads) {
              expect(html).toContain(
                '<div dir="ltr" class="gmail_attr">On Fri, 21 Nov 1997 09:55:06 -0600, John Doe &lt;jdoe@machine.example&gt; wrote:<br></div>',
              );
              expect(html).toMatch(
                /<blockquote class="gmail_quote" type="cite"[^>]*><p[^>]*>This is a message just to say hello\.<br>So, &quot;Hello&quot;\.<\/p><\/blockquote>/,
              );
              expect(text?.split("\n")).toContain("> This is a message just to say hello.");
            }
          },
        );
      },
    );

    Scenario(
      "A forward shows the original under a separator, never quoted",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the forward case", () => {
          name = "forward";
        });

        When("mail writes it", async () => {
          reads = await readCase(name);
        });

        Then(
          'both parts show "---------- Forwarded message ---------", "From: John Doe <jdoe@machine.example>", "Date: Fri, 21 Nov 1997 09:55:06 -0600", "Subject: Saying Hello" and "To: Mary Smith <mary@example.net>", then the original\'s words, in no blockquote and on no line starting ">"',
          () => {
            const shown = [
              "---------- Forwarded message ---------",
              "From: John Doe <jdoe@machine.example>",
              "Date: Fri, 21 Nov 1997 09:55:06 -0600",
              "Subject: Saying Hello",
              "To: Mary Smith <mary@example.net>",
            ];
            const words = ["This is a message just to say hello.", 'So, "Hello".'];
            const escaped = (line: string) =>
              line
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;");
            for (const { html, text } of reads) {
              const lines = text?.split("\n") ?? [];
              const at = lines.indexOf(shown[0] ?? "");
              expect(lines.slice(at, at + shown.length + 1 + words.length)).toEqual([
                ...shown,
                "",
                ...words,
              ]);
              expect(lines.filter((line) => line.startsWith(">"))).toEqual([]);
              expect(html).toContain(`${shown.map(escaped).join("<br>")}<br>`);
              expect(html).toContain(words.map(escaped).join("<br>"));
              expect(html).not.toMatch(/<blockquote/i);
            }
          },
        );
      },
    );

    Scenario('A quote of several paragraphs keeps them apart with ">"', ({ Given, When, Then }) => {
      let doc: { p: string[] }[];
      let reads: Reads;

      Given('a parent whose document is two paragraphs, "One." and "Two."', () => {
        doc = [{ p: ["One."] }, { p: ["Two."] }];
      });

      When("someone replies to it", async () => {
        reads = await readReplyTo(doc);
      });

      Then('the text part has the lines "> One.", ">" and "> Two."', () => {
        for (const { text } of reads) {
          expect(text).toContain("\n> One.\n>\n> Two.\n");
        }
      });
    });

    Scenario("A parent's link mail would not write is quoted as text", ({ Given, When, Then }) => {
      let doc: { p: { a: string; href: string }[] }[];
      let reads: Reads;

      Given('a parent whose paragraph links "Call us" to "tel:+15551234"', () => {
        doc = [{ p: [{ a: "Call us", href: "tel:+15551234" }] }];
      });

      When("someone replies to it", async () => {
        reads = await readReplyTo(doc);
      });

      Then(
        'the reply is written, and its quote holds the text "Call us (tel:+15551234)" and no link',
        () => {
          for (const { html, text } of reads) {
            expect(html).toContain("<blockquote");
            expect(html).toContain("Call us (tel:+15551234)");
            expect(html).not.toMatch(/<a\s/);
            expect(text).toContain("> Call us (tel:+15551234)");
          }
        },
      );
    });

    Scenario("A forward of mail with a Cc shows the Cc line", ({ Given, When, Then }) => {
      let parentInput: Parameters<typeof forwardOf>[0];
      let reads: Reads;

      Given("the parent a1.2", () => {
        parentInput = parent("a1.2");
      });

      When("it is forwarded", async () => {
        reads = Object.values(await readBack(forwardOf(parentInput).bytes));
      });

      Then(
        'the forward block has a line that reads, exactly: Cc: boss@nil.test, Giant; "Big" Box <sysservices@example.net>',
        () => {
          const line = 'Cc: boss@nil.test, Giant; "Big" Box <sysservices@example.net>';
          for (const { html, text } of reads) {
            expect(text?.split("\n")).toContain(line);
            expect(html).toContain(
              "<br>Cc: boss@nil.test, Giant; &quot;Big&quot; Box &lt;sysservices@example.net&gt;<br>",
            );
          }
        },
      );
    });

    Scenario('A parent with no subject is forwarded as "Fwd:"', ({ Given, When, Then }) => {
      let parentInput: Parameters<typeof forwardOf>[0];
      let reads: Reads;

      Given("a parent with no subject", () => {
        parentInput = { from: [john], doc: [{ p: ["Hello."] }] };
      });

      When("it is forwarded", async () => {
        const written = forwardOf(parentInput);
        reads = Object.values(await readBack(written.bytes));
      });

      Then('the subject is "Fwd:"', () => {
        for (const { subject } of reads) {
          expect(subject).toBe("Fwd:");
        }
      });
    });

    Scenario("A forward's subject is \"Fwd: \" and the original's", ({ Given, When, Then }) => {
      let name: string;
      let reads: Reads;

      Given("the forward case", () => {
        name = "forward";
      });

      When("mail writes it", async () => {
        reads = await readCase(name);
      });

      Then('its subject is "Fwd: Saying Hello"', () => {
        for (const { subject } of reads) expect(subject).toBe("Fwd: Saying Hello");
      });
    });

    Scenario('"FW:" becomes one "Fwd: "', ({ Given, When, Then }) => {
      let parentInput: Parameters<typeof forwardOf>[0];
      let reads: Reads;

      Given('a parent with subject "FW: Saying Hello"', () => {
        parentInput = {
          from: [john],
          subject: "FW: Saying Hello",
          doc: [{ p: ["Hello."] }],
        };
      });

      When("it is forwarded", async () => {
        const written = forwardOf(parentInput);
        reads = Object.values(await readBack(written.bytes));
      });

      Then('the subject is "Fwd: Saying Hello"', () => {
        for (const { subject } of reads) {
          expect(subject).toBe("Fwd: Saying Hello");
        }
      });
    });

    Scenario("A forward of mail addressed to a group shows the group", ({ Given, When, Then }) => {
      let parentInput: Parameters<typeof forwardOf>[0];
      let reads: Reads;

      Given('a parent from john to the group "Team" of ann@example.org and bob@example.org', () => {
        parentInput = {
          from: [john],
          to: [
            {
              group: "Team",
              members: [
                { addr: { local: "ann", domain: "example.org" } },
                { addr: { local: "bob", domain: "example.org" } },
              ],
            },
          ],
          doc: [{ p: ["Hello."] }],
        };
      });

      When("it is forwarded", async () => {
        const written = forwardOf(parentInput);
        reads = Object.values(await readBack(written.bytes));
      });

      Then('the forward block has the line "To: Team: ann@example.org, bob@example.org;"', () => {
        for (const { text } of reads) {
          expect(text?.split("\n")).toContain("To: Team: ann@example.org, bob@example.org;");
        }
      });
    });
  },
  owns(
    "FR-MAIL-013-c1",
    "FR-MAIL-013-c2",
    "FR-MAIL-013-c3",
    "FR-MAIL-013-c4",
    "FR-MAIL-013-c5",
    "FR-MAIL-013-c6",
    "FR-MAIL-013-c7",
    "FR-MAIL-013-c8",
    "FR-MAIL-013-c9",
    "FR-MAIL-013-c10",
    "FR-MAIL-013-c11",
    "FR-MAIL-013-c12",
    "FR-MAIL-013-c13",
    "FR-MAIL-013-c14",
    "FR-MAIL-013-c15",
    "FR-MAIL-013-c20",
  ),
);
