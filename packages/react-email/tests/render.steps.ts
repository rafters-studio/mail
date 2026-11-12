import { readFileSync } from "node:fs";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vite-plus/test";
import { MailWriteError, type Written } from "../../core/src/message/index.ts";
import { testMail, text } from "../../core/tests/cases.ts";
import { createRandom } from "../../core/tests/env.ts";
import { feature, owns } from "../../core/tests/feature.ts";
import { mary, sean } from "../../core/tests/fixtures/people.ts";
import { renderTemplate } from "../src/render.ts";
import { OtpEmail } from "../src/templates/otp-email.tsx";

// The template case (form 01a18fda, Tests): "compose from sean to mary, subject `Verify your
// email`, content `renderTemplate(OtpEmail, { code: "482913", brandName: "Rafters", year: 2026 })`".
const PROPS = { code: "482913", brandName: "Rafters", year: 2026 };
const GOLDEN = readFileSync(new URL("./fixtures/template.expected.eml", import.meta.url), "latin1");

/** Writes some content from sean to mary. */
function write(content: { html: string; text: string }, mail = testMail()): Written {
  return mail.compose({ from: sean, to: [mary], subject: "Verify your email" })(content);
}

/** Writes the template case and fails unless its bytes equal its golden. */
async function writeTemplate(props: Parameters<typeof OtpEmail>[0] = PROPS): Promise<{
  content: { html: string; text: string };
  message: string;
}> {
  const content = await renderTemplate(OtpEmail, props);
  if (!("html" in content)) throw new Error("renderTemplate returned a document");
  const message = text(write(content));
  expect(message).toBe(GOLDEN);
  return { content, message };
}

type Template = Awaited<ReturnType<typeof writeTemplate>>;

const FR014 = await feature("FR-MAIL-014");

describeFeature(
  FR014,
  ({ Scenario }) => {
    Scenario(
      "A React Email template's one-line HTML is written in lines of at most 78, CRLF and 7-bit",
      ({ Given, When, Then }) => {
        let written: Template;

        Given("the template case, whose HTML is one line longer than 998 characters", () => {
          // writeTemplate renders the template case with PROPS.
        });

        When("mail writes it", async () => {
          written = await writeTemplate();
        });

        Then(
          "every line is at most 78 characters, ends in CRLF, and has only 7-bit characters",
          () => {
            const { content, message } = written;
            expect(content.html).not.toMatch(/[\r\n]/);
            expect(content.html.length).toBeGreaterThan(998);
            expect(message.endsWith("\r\n")).toBe(true);
            for (const line of message.slice(0, -2).split("\r\n")) {
              expect(line).not.toMatch(/[\r\n]/);
              expect(line.length, line).toBeLessThanOrEqual(78);
              // oxlint-disable-next-line no-control-regex -- 7-bit means every code point below 0x80
              expect(line).toMatch(/^[\x00-\x7f]*$/);
            }
          },
        );
      },
    );

    Scenario(
      "A template's HTML and text read back as the plugin returned them",
      ({ Given, When, Then }) => {
        let written: Template;
        let readers: Awaited<ReturnType<typeof readBack>>;

        Given("the template case", () => {
          // writeTemplate renders the template case with PROPS.
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            written = await writeTemplate();
            readers = await readBack(Buffer.from(written.message, "latin1"));
          },
        );

        Then("each reads the HTML and the text as the plugin returned them", () => {
          for (const read of Object.values(readers)) {
            expect(read.html).toBe(written.content.html);
            expect(read.text).toBe(written.content.text);
          }
        });
      },
    );

    Scenario("Template content with no text is refused", ({ Given, When, Then }) => {
      let drawn: number;
      let mail: ReturnType<typeof testMail>;
      let refusal: unknown;

      Given("template content of some HTML and an empty text", () => {
        drawn = 0;
        const random = createRandom();
        mail = testMail((into) => {
          drawn += into.length;
          return random(into);
        });
      });

      When("mail is asked to write it", () => {
        try {
          write({ html: "<p>Your code is 482913</p>", text: "" }, mail);
        } catch (error) {
          refusal = error;
        }
      });

      Then("it is refused with error code no-text for field text, and nothing is written", () => {
        expect(refusal).toBeInstanceOf(MailWriteError);
        expect(refusal).toMatchObject({ code: "no-text", field: "text" });
        expect(drawn).toBe(0);
      });
    });

    Scenario(
      "Template text with CR or CRLF line breaks is written with CRLF only",
      ({ Given, When, Then }) => {
        let content: { html: string; text: string };
        let message: string;

        Given("template content whose text has the line breaks CR, LF and CRLF", () => {
          content = { html: "<p>x</p>", text: "one\rtwo\nthree\r\nfour" };
        });

        When("mail writes it", () => {
          message = text(write(content));
        });

        Then("every line ends in CRLF and there is no bare CR or LF", () => {
          expect(message).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
          expect(message).toContain("\r\none\r\ntwo\r\nthree\r\nfour\r\n");
        });
      },
    );

    Scenario("A template text line ending in a tab keeps it", ({ Given, When, Then }) => {
      let content: { html: string; text: string };
      let message: string;

      Given("template content whose text has a line ending in a tab", () => {
        content = { html: "<p>x</p>", text: "Your code:\t\n482913" };
      });

      When("mail writes it", () => {
        message = text(write(content));
      });

      Then('that line of the text part ends in "=09"', () => {
        expect(message).toContain("\r\nYour code:=09\r\n482913\r\n");
      });
    });

    Scenario("A template renders the same on any day", ({ Given, When, Then }) => {
      let written: Template;

      Given("the OtpEmail template rendered with year 2026", () => {
        // PROPS holds year 2026.
      });

      When("the plugin renders it on any date", async () => {
        // writeTemplate fails unless the rendered bytes equal the template golden.
        written = await writeTemplate({
          ...PROPS,
          now: () => new Date("2031-06-15T12:00:00Z"),
        });
      });

      Then('its HTML holds "© 2026" and the rendered bytes equal the template golden', () => {
        expect(written.content.html).toContain("© 2026");
      });
    });

    Scenario("The plugin removes React's server-rendering comments", ({ Given, When, Then }) => {
      let content: Awaited<ReturnType<typeof renderTemplate>>;

      Given("the OtpEmail template", () => {
        // OtpEmail is imported at file scope.
      });

      When("the plugin renders it", async () => {
        content = await renderTemplate(OtpEmail, PROPS);
      });

      Then(
        'its HTML holds no "<!--$-->", "<!--/$-->", "<!--$?-->", "<!--$!-->", "<!-- -->" or other comment of only lowercase letters',
        () => {
          if (!("html" in content)) throw new Error("renderTemplate returned a document");
          for (const marker of ["<!--$-->", "<!--/$-->", "<!--$?-->", "<!--$!-->", "<!-- -->"]) {
            expect(content.html).not.toContain(marker);
          }
          expect(content.html).not.toMatch(/<!--[a-z]+-->/);
        },
      );
    });
  },
  owns(
    "FR-MAIL-014-c1",
    "FR-MAIL-014-c2",
    "FR-MAIL-014-c3",
    "FR-MAIL-014-c4",
    "FR-MAIL-014-c5",
    "FR-MAIL-014-c6",
    "FR-MAIL-014-c7",
  ),
);
