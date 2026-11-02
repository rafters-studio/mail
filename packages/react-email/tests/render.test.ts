import { readFileSync } from "node:fs";
import { readBack } from "@rafters/mail-test-readers";
import { afterEach, expect, vi } from "vitest";
import { MailWriteError, type Written } from "../../core/src/message/index.ts";
import { testMail, text } from "../../core/tests/cases.ts";
import { criterion } from "../../core/tests/criterion.ts";
import { createRandom } from "../../core/tests/env.ts";
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
async function writeTemplate(): Promise<{
  content: { html: string; text: string };
  message: string;
}> {
  const content = await renderTemplate(OtpEmail, PROPS);
  if (!("html" in content)) throw new Error("renderTemplate returned a document");
  const message = text(write(content));
  expect(message).toBe(GOLDEN);
  return { content, message };
}

afterEach(() => {
  vi.useRealTimers();
});

criterion("FR-MAIL-014-c1", async () => {
  const { content, message } = await writeTemplate();
  expect(content.html).not.toMatch(/[\r\n]/);
  expect(content.html.length).toBeGreaterThan(998);
  expect(message.endsWith("\r\n")).toBe(true);
  for (const line of message.slice(0, -2).split("\r\n")) {
    expect(line).not.toMatch(/[\r\n]/);
    expect(line.length, line).toBeLessThanOrEqual(78);
    // oxlint-disable-next-line no-control-regex -- 7-bit means every code point below 0x80
    expect(line).toMatch(/^[\x00-\x7f]*$/);
  }
});

criterion("FR-MAIL-014-c2", async () => {
  const { content, message } = await writeTemplate();
  const readers = await readBack(Buffer.from(message, "latin1"));
  for (const read of Object.values(readers)) {
    expect(read.html).toBe(content.html);
    expect(read.text).toBe(content.text);
  }
});

criterion("FR-MAIL-014-c3", () => {
  let drawn = 0;
  const random = createRandom();
  const mail = testMail((into) => {
    drawn += into.length;
    return random(into);
  });
  let refusal: unknown;
  try {
    write({ html: "<p>Your code is 482913</p>", text: "" }, mail);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(MailWriteError);
  expect(refusal).toMatchObject({ code: "no-text", field: "text" });
  expect(drawn).toBe(0);
});

criterion("FR-MAIL-014-c4", () => {
  const message = text(write({ html: "<p>x</p>", text: "one\rtwo\nthree\r\nfour" }));
  expect(message).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
  expect(message).toContain("\r\none\r\ntwo\r\nthree\r\nfour\r\n");
});

criterion("FR-MAIL-014-c5", () => {
  const message = text(write({ html: "<p>x</p>", text: "Your code:\t\n482913" }));
  expect(message).toContain("\r\nYour code:=09\r\n482913\r\n");
});

criterion("FR-MAIL-014-c6", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
  const { content } = await writeTemplate();
  expect(content.html).toContain("© 2026");
});

criterion("FR-MAIL-014-c7", async () => {
  const content = await renderTemplate(OtpEmail, PROPS);
  if (!("html" in content)) throw new Error("renderTemplate returned a document");
  for (const marker of ["<!--$-->", "<!--/$-->", "<!--$?-->", "<!--$!-->", "<!-- -->"]) {
    expect(content.html).not.toContain(marker);
  }
  expect(content.html).not.toMatch(/<!--[a-z]+-->/);
});
