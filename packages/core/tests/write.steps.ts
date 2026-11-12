import { describeFeature } from "@amiceli/vitest-cucumber";
import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vite-plus/test";
import type { Mail, Written } from "../src/message/index.ts";
import { CASE_NAMES, expectRefused, testMail, text, writeCase } from "./cases.ts";
import { feature, owns } from "./feature.ts";
import { parent } from "./fixtures/parents.ts";
import { jane, john, mary, sean } from "./fixtures/people.ts";

/** Each line of a message, without the CRLF that ends it. */
function lines(message: string): string[] {
  return message.slice(0, -2).split("\r\n");
}

/** Every line at most 78, ending in CRLF, with only 7-bit characters. */
function expectWithin78(message: string): void {
  expect(message.endsWith("\r\n")).toBe(true);
  for (const line of lines(message)) {
    expect(line).not.toMatch(/[\r\n]/);
    expect(line.length, line).toBeLessThanOrEqual(78);
    // oxlint-disable-next-line no-control-regex -- 7-bit means every code point below 0x80
    expect(line).toMatch(/^[\x00-\x7f]*$/);
  }
}

const doc = [{ p: ["Hello."] }];

/** What postal-mime, mailparser and Python's email package each read back. */
type Reads = Awaited<ReturnType<typeof readBack>>;
/** A write that expectRefused runs with its own test mail. */
type Write = (mail: Mail) => unknown;

const FR008 = await feature("FR-MAIL-008");
const FR012 = await feature("FR-MAIL-012");
const FR013 = await feature("FR-MAIL-013");
const FR020 = await feature("FR-MAIL-020");

describeFeature(
  FR008,
  ({ Scenario }) => {
    Scenario(
      "Every line is at most 78 characters, ends in CRLF and is 7-bit",
      ({ Given, When, Then }) => {
        let names: string[];
        let written: Written[];

        Given(
          "the cases plain, link, attachment, intl, long-filename, ascii-filename, docx, rich, rtl, reply and forward",
          () => {
            names = CASE_NAMES;
          },
        );

        When("mail writes each one", () => {
          written = names.map((name) => writeCase(name));
        });

        Then(
          "every line is at most 78 characters, ends in CRLF, and has only 7-bit characters",
          () => {
            for (const one of written) expectWithin78(text(one));
          },
        );
      },
    );

    Scenario(
      "A sender named José Núñez and a Japanese subject read back unchanged",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the intl case", () => {
          name = "intl";
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            reads = await readBack(writeCase(name).bytes);
          },
        );

        Then("each reads the sender's name and the subject exactly as given", () => {
          for (const read of Object.values(reads)) {
            expect(read.from).toEqual([{ name: "José Núñez", address: "jose@example.es" }]);
            expect(read.subject).toBe(
              "Café ☕ meeting — 日本語の件名が長いので折り返しが必要です and a little more English to force folding",
            );
          }
        });
      },
    );

    Scenario(
      "The text part comes before the HTML part, and both read back unchanged",
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the link case", () => {
          name = "link";
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            reads = await readBack(writeCase(name).bytes);
          },
        );

        Then(
          "each finds the text part before the HTML part and reads both as mail rendered them",
          () => {
            const href =
              "https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&amp;utm_medium=reply&amp;ref=abcdefghijklmnopqrstuvwxyz";
            const html =
              '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Getting started</title></head>' +
              '<body style="margin:0"><div role="article" aria-label="Getting started" lang="en" dir="ltr" style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">' +
              `<p style="margin:1em 0">Hi Mary,</p><p style="margin:1em 0">Here is the <a href="${href}">getting started guide</a> — it covers everything.</p><p style="margin:1em 0">Sean</p></div></body></html>`;
            const plain = `Hi Mary,\n\nHere is the getting started guide (${href.replaceAll("&amp;", "&")}) — it covers everything.\n\nSean\n`;
            for (const read of Object.values(reads)) {
              expect(read.textBeforeHtml).toBe(true);
              expect(read.text).toBe(plain);
              expect(read.html).toBe(html);
            }
          },
        );
      },
    );

    Scenario(
      'An attachment named "résumé de José.pdf" reads back with its name and 3,000 bytes',
      ({ Given, When, Then }) => {
        let name: string;
        let reads: Reads;

        Given("the attachment case", () => {
          name = "attachment";
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            reads = await readBack(writeCase(name).bytes);
          },
        );

        Then('each reads one attachment named "résumé de José.pdf" of 3,000 bytes', () => {
          for (const read of Object.values(reads)) {
            expect(read.attachments).toEqual([{ filename: "résumé de José.pdf", size: 3000 }]);
          }
        });
      },
    );

    Scenario(
      "A long non-ASCII filename reads back unchanged, with no line over 78",
      ({ Given, When, Then }) => {
        let name: string;
        let written: Written;
        let reads: Reads;

        Given("the long-filename case", () => {
          name = "long-filename";
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            written = writeCase(name);
            reads = await readBack(written.bytes);
          },
        );

        Then(
          "each reads the filename exactly, and no line of the message passes 78 characters",
          () => {
            expectWithin78(text(written));
            for (const read of Object.values(reads)) {
              expect(read.attachments).toEqual([
                {
                  filename:
                    "Informe trimestral de ventas y márgenes por región — versión definitiva revisada por José Núñez.pdf",
                  size: 3,
                },
              ]);
            }
          },
        );
      },
    );

    Scenario(
      "A long ASCII filename reads back unchanged, with no line over 78",
      ({ Given, When, Then }) => {
        let name: string;
        let written: Written;
        let reads: Reads;

        Given("the ascii-filename case", () => {
          name = "ascii-filename";
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            written = writeCase(name);
            reads = await readBack(written.bytes);
          },
        );

        Then(
          "each reads the filename exactly, and no line of the message passes 78 characters",
          () => {
            expectWithin78(text(written));
            for (const read of Object.values(reads)) {
              expect(read.attachments).toEqual([{ filename: `${"a".repeat(116)}.pdf`, size: 3 }]);
            }
          },
        );
      },
    );

    Scenario("A long attachment type is written within 78 characters", ({ Given, When, Then }) => {
      let name: string;
      let written: Written;

      Given(
        "the docx case, whose type is application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        () => {
          name = "docx";
        },
      );

      When("mail writes it", () => {
        written = writeCase(name);
      });

      Then(
        'the type is on a line of its own after "Content-Type:", every line is at most 78 characters, and each reader reads the attachment report.docx',
        async () => {
          const message = text(written);
          expect(message).toContain(
            "\r\nContent-Type:\r\n application/vnd.openxmlformats-officedocument.wordprocessingml.document;\r\n",
          );
          expectWithin78(message);
          for (const read of Object.values(await readBack(written.bytes))) {
            expect(read.attachments).toEqual([{ filename: "report.docx", size: 3 }]);
          }
        },
      );
    });

    Scenario("A Reply-To is written", ({ Given, When, Then }) => {
      let compose: () => Written;
      let written: Written;
      let reads: Reads;

      Given("a message from noreply@rafters.studio with Reply-To support@rafters.studio", () => {
        compose = () =>
          testMail().compose({
            from: { addr: { local: "noreply", domain: "rafters.studio" } },
            replyTo: [{ addr: { local: "support", domain: "rafters.studio" } }],
          })({ doc });
      });

      When(
        "mail writes it and postal-mime, mailparser and Python email each read it back",
        async () => {
          written = compose();
          reads = await readBack(written.bytes);
        },
      );

      Then('the message has the field "Reply-To: support@rafters.studio"', () => {
        expect(lines(text(written))).toContain("Reply-To: support@rafters.studio");
        for (const read of Object.values(reads)) {
          expect(read.from).toEqual([{ name: "", address: "noreply@rafters.studio" }]);
        }
      });
    });

    Scenario("A line ending in a space keeps it", ({ Given, When, Then }) => {
      let name: string;
      let written: Written;

      Given("the rich case, whose first paragraph ends in a space", () => {
        name = "rich";
      });

      When("mail writes it", () => {
        written = writeCase(name);
      });

      Then(
        'that line of the text part ends in "=20" and reads back ending in a space',
        async () => {
          expect(lines(text(written))).toContain("Three things, briefly, and one important:=20");
          for (const read of Object.values(await readBack(written.bytes))) {
            expect(read.text?.split("\n")[0]).toBe("Three things, briefly, and one important: ");
          }
        },
      );
    });

    Scenario("The Date carries the author's local time and offset", ({ Given, When, Then }) => {
      let name: string;
      let written: Written;

      Given(
        "the plain case, written at 2026-03-02 17:00:00 UTC by an author 420 minutes behind UTC",
        () => {
          name = "plain";
        },
      );

      When("mail writes it", () => {
        written = writeCase(name);
      });

      Then('its Date field is "Mon, 2 Mar 2026 10:00:00 -0700"', () => {
        expect(lines(text(written))).toContain("Date: Mon, 2 Mar 2026 10:00:00 -0700");
      });
    });

    Scenario("An empty To list writes no To field", ({ Given, When, Then }) => {
      let compose: () => Written;
      let header: string | undefined;

      Given("a message from sean with an empty To list and Cc mary", () => {
        compose = () => testMail().compose({ from: sean, to: [], cc: [mary] })({ doc });
      });

      When("mail writes it", () => {
        header = text(compose()).split("\r\n\r\n")[0];
      });

      Then("it has no To field and a Cc field", () => {
        expect(header).not.toMatch(/^To:/m);
        expect(header).toMatch(/^Cc: Mary Smith <mary@example\.net>$/m);
      });
    });

    Scenario("HTML over 90,000 bytes once encoded is refused", ({ Given, When, Then }) => {
      let write: Write;

      Given("a message whose document encodes to more than 90,000 bytes of HTML", () => {
        write = (mail) =>
          mail.compose({ from: sean, to: [mary] })({ doc: [{ p: ["x".repeat(90_000)] }] });
      });

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then(
        "it is refused with error code too-large for field content, and nothing is written",
        () => {
          expectRefused(
            write,
            "too-large",
            "content",
            "the HTML part is over 90,000 bytes once encoded",
          );
        },
      );
    });

    Scenario("A document with no text is refused", ({ Given, When, Then }) => {
      let write: Write;

      Given("a message whose document is one paragraph of spaces", () => {
        write = (mail) => mail.compose({ from: sean, to: [mary] })({ doc: [{ p: ["    "] }] });
      });

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then("it is refused with error code no-text for field doc, and nothing is written", () => {
        expectRefused(write, "no-text", "doc", "every message needs a text part");
      });
    });

    Scenario("A header word too long to fold under 998 is refused", ({ Given, When, Then }) => {
      let write: Write;

      Given("a message whose subject is one word of 1,000 characters", () => {
        write = (mail) =>
          mail.compose({ from: sean, to: [mary], subject: "a".repeat(1000) })({ doc });
      });

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then(
        "it is refused with error code word-too-long for field subject, and nothing is written",
        () => {
          expectRefused(
            write,
            "word-too-long",
            "subject",
            "has a word too long for 998 characters",
          );
        },
      );
    });

    Scenario("An address that is not US-ASCII is refused", ({ Given, When, Then }) => {
      let write: Write;

      Given("a message to josé@ejemplo.es", () => {
        write = (mail) =>
          mail.compose({ from: sean, to: [{ addr: { local: "josé", domain: "ejemplo.es" } }] })({
            doc,
          });
      });

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then(
        "it is refused with error code address for field to[0].addr.local, and nothing is written",
        () => {
          expectRefused(
            write,
            "address",
            "to[0].addr.local",
            "addresses must be US-ASCII dot-atom text",
          );
        },
      );
    });

    Scenario("A key mail does not define is refused", ({ Given, When, Then }) => {
      let write: Write;

      Given('a message head with the extra key "priority"', () => {
        const head = { from: sean, to: [mary], priority: "high" };
        write = (mail) => mail.compose(head)({ doc });
      });

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then(
        "it is refused with error code invalid for field priority, and nothing is written",
        () => {
          expectRefused(write, "invalid", "priority", "does not match its schema");
        },
      );
    });

    Scenario("A field of the wrong kind is refused, naming the field", ({ Given, When, Then }) => {
      let write: Write;

      Given(
        'a message head whose To is the text "mary@example.net" instead of a list of mailboxes',
        () => {
          // @ts-expect-error -- the scenario's To is text, not a list of mailboxes
          write = (mail) => mail.compose({ from: sean, to: "mary@example.net" })({ doc });
        },
      );

      When("mail is asked to write it", () => {
        // expectRefused writes it inside the Then, around its expect lines.
      });

      Then("it is refused with error code invalid for field to, and nothing is written", () => {
        expectRefused(write, "invalid", "to", "does not match its schema");
      });
    });

    Scenario(
      "A display name with a comma or other special is written as a quoted string",
      ({ Given, When, Then }) => {
        let compose: () => Written;
        let written: Written;
        let reads: Reads;

        Given('a message from "Silvius, Sean" <sean@rafters.studio>', () => {
          compose = () =>
            testMail().compose({ from: { ...sean, name: "Silvius, Sean" }, to: [mary] })({
              doc,
            });
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            written = compose();
            reads = await readBack(written.bytes);
          },
        );

        Then(
          'its From field is From: "Silvius, Sean" <sean@rafters.studio>, and each reader reads one mailbox named Silvius, Sean',
          () => {
            expect(lines(text(written))).toContain('From: "Silvius, Sean" <sean@rafters.studio>');
            for (const read of Object.values(reads)) {
              expect(read.from).toEqual([
                { name: "Silvius, Sean", address: "sean@rafters.studio" },
              ]);
            }
          },
        );
      },
    );

    Scenario("A display name of only spaces is written as no name", ({ Given, When, Then }) => {
      let compose: () => Written;
      let written: Written;

      Given('a message from a mailbox named "   " at sean@rafters.studio', () => {
        compose = () => testMail().compose({ from: { ...sean, name: "   " }, to: [mary] })({ doc });
      });

      When("mail writes it", () => {
        written = compose();
      });

      Then("its From field is From: sean@rafters.studio", () => {
        expect(lines(text(written))).toContain("From: sean@rafters.studio");
      });
    });
  },
  owns(
    "FR-MAIL-008-c1",
    "FR-MAIL-008-c2",
    "FR-MAIL-008-c3",
    "FR-MAIL-008-c4",
    "FR-MAIL-008-c5",
    "FR-MAIL-008-c6",
    "FR-MAIL-008-c7",
    "FR-MAIL-008-c8",
    "FR-MAIL-008-c9",
    "FR-MAIL-008-c10",
    "FR-MAIL-008-c11",
    "FR-MAIL-008-c12",
    "FR-MAIL-008-c13",
    "FR-MAIL-008-c14",
    "FR-MAIL-008-c15",
    "FR-MAIL-008-c16",
    "FR-MAIL-008-c17",
    "FR-MAIL-008-c18",
    "FR-MAIL-008-c19",
  ),
);

describeFeature(
  FR012,
  ({ Scenario }) => {
    Scenario(
      "A message with a blind copy has no Bcc field and does not name the blind recipient",
      ({ Given, When, Then }) => {
        let compose: () => Written;
        let message: string;

        Given("a message from sean to mary with blind copy hidden@example.net", () => {
          compose = () =>
            testMail().compose({
              from: sean,
              to: [mary],
              bcc: [{ addr: { local: "hidden", domain: "example.net" } }],
            })({ doc });
        });

        When("mail writes it", () => {
          message = text(compose());
        });

        Then("the bytes have no Bcc field and do not contain hidden@example.net", () => {
          expect(message).not.toMatch(/^Bcc:/im);
          expect(message).not.toContain("hidden@example.net");
        });
      },
    );
  },
  owns("FR-MAIL-012-c1"),
);

describeFeature(
  FR013,
  ({ Scenario }) => {
    Scenario("A forward carries the original's attachments", ({ Given, When, Then }) => {
      let name: string;
      let reads: Reads;

      Given("the forward case", () => {
        name = "forward";
      });

      When(
        "mail writes it and postal-mime, mailparser and Python email each read it back",
        async () => {
          reads = await readBack(writeCase(name).bytes);
        },
      );

      Then('each reads the attachment "résumé de José.pdf" of 3,000 bytes', () => {
        for (const read of Object.values(reads)) {
          expect(read.attachments).toEqual([{ filename: "résumé de José.pdf", size: 3000 }]);
        }
      });
    });

    Scenario("A 7bit original is attached beside the inline forward", ({ Given, When, Then }) => {
      let name: string;
      let message: string;

      Given("the forward case, attaching its original", () => {
        name = "forward";
      });

      When("mail writes it", () => {
        message = text(writeCase(name));
      });

      Then(
        "the message has a message/rfc822 part whose body is exactly the parent's raw bytes",
        () => {
          const head =
            'Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="forwarded.eml"\r\n\r\n';
          const start = message.indexOf(head) + head.length;
          const body = message.slice(start, message.indexOf("\r\n--=_mail_", start));
          expect(head.length).toBeLessThan(start);
          expect(Buffer.from(body, "latin1")).toEqual(Buffer.from(parent("a2-1-att").raw ?? []));
        },
      );
    });

    Scenario(
      "An original that is not 7bit is refused as an attachment",
      ({ Given, When, Then }) => {
        let write: Write;

        Given("a forward attaching a raw original that holds the byte 0xE9", () => {
          const raw = new Uint8Array([
            ...Buffer.from("From: jdoe@machine.example\r\n\r\nCaf"),
            0xe9,
            0x0d,
            0x0a,
          ]);
          write = (mail) =>
            mail.forward({ from: [john], doc, raw })({ from: mary, to: [jane], doc, attach: true });
        });

        When("mail is asked to write it", () => {
          // expectRefused writes it inside the Then, around its expect lines.
        });

        Then(
          "it is refused with error code not-7bit for field raw, and nothing is written, and its message says to forward it inline",
          () => {
            expectRefused(write, "not-7bit", "raw", "the original is not 7bit; forward it inline");
          },
        );
      },
    );
  },
  owns("FR-MAIL-013-c16", "FR-MAIL-013-c17", "FR-MAIL-013-c18"),
);

describeFeature(
  FR020,
  ({ Scenario }) => {
    Scenario("A blind copy is in the envelope and not in the bytes", ({ Given, When, Then }) => {
      let compose: () => Written;
      let written: Written;

      Given(
        "a message from sean@rafters.studio to mary@example.com with blind copy hidden@example.net",
        () => {
          const hidden = { addr: { local: "hidden", domain: "example.net" } };
          const to = [{ addr: { local: "mary", domain: "example.com" } }];
          compose = () => testMail().compose({ from: sean, to, bcc: [hidden] })({ doc });
        },
      );

      When("mail writes it", () => {
        written = compose();
      });

      Then(
        'envelope.to is ["mary@example.com", "hidden@example.net"] and the bytes do not contain hidden@example.net',
        () => {
          expect(written.envelope.to).toEqual(["mary@example.com", "hidden@example.net"]);
          expect(text(written)).not.toContain("hidden@example.net");
        },
      );
    });

    Scenario("The envelope sender is the From address", ({ Given, When, Then }) => {
      let compose: () => Written;
      let written: Written;

      Given('a message from "Sean Silvius" <sean@rafters.studio>', () => {
        compose = () => testMail().compose({ from: sean, to: [mary] })({ doc });
      });

      When("mail writes it", () => {
        written = compose();
      });

      Then('envelope.from is "sean@rafters.studio"', () => {
        expect(written.envelope.from).toBe("sean@rafters.studio");
      });
    });

    Scenario(
      "Envelope recipients are To, then Cc, then Bcc, each once, compared as sameAddress compares",
      ({ Given, When, Then }) => {
        let compose: () => Written;
        let written: Written;

        Given(
          "a message to mary@example.com, cc john@example.org, mary@EXAMPLE.COM and Mary@example.com, bcc john@example.org",
          () => {
            const box = (local: string, domain: string) => ({ addr: { local, domain } });
            compose = () =>
              testMail().compose({
                from: sean,
                to: [box("mary", "example.com")],
                cc: [
                  box("john", "example.org"),
                  box("mary", "EXAMPLE.COM"),
                  box("Mary", "example.com"),
                ],
                bcc: [box("john", "example.org")],
              })({ doc });
          },
        );

        When("mail writes it", () => {
          written = compose();
        });

        Then('envelope.to is ["mary@example.com", "john@example.org", "Mary@example.com"]', () => {
          expect(written.envelope.to).toEqual([
            "mary@example.com",
            "john@example.org",
            "Mary@example.com",
          ]);
        });
      },
    );

    Scenario("A reply and a forward carry their envelopes", ({ Given, When, Then }) => {
      let names: string[];
      let written: Written[];

      Given("the reply and forward cases", () => {
        names = ["reply", "forward"];
      });

      When("mail writes each", () => {
        written = names.map((name) => writeCase(name));
      });

      Then(
        "each envelope.to holds every recipient its head names, and envelope.from its from",
        () => {
          expect(written[0]?.envelope).toEqual({
            from: "mary@example.net",
            to: ["jdoe@machine.example"],
          });
          expect(written[1]?.envelope).toEqual({
            from: "mary@example.net",
            to: ["j-brown@other.example"],
          });
        },
      );
    });
  },
  owns("FR-MAIL-020-c1", "FR-MAIL-020-c2", "FR-MAIL-020-c3", "FR-MAIL-020-c4"),
);
