import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import { MailWriteError } from "../src/message/index.ts";
import { testMail, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { createRandom } from "./env.ts";
import { john, mary, sean } from "./fixtures/people.ts";

/** The case as each reader reads it back. */
async function readCase(name: string) {
  return Object.values(await readBack(writeCase(name).bytes));
}

/** What the HTML holds inside its article wrapper. */
function insideWrapper(html: string): string {
  return html.replace(/^.*?<div role="article"[^>]*>/s, "").replace(/<\/div><\/body><\/html>$/, "");
}

criterion("FR-MAIL-013-c1", async () => {
  const allowed = new Set(["p", "ul", "li", "a", "em", "strong", "br", "blockquote", "div"]);
  for (const { html } of await readCase("link")) {
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toMatch(/(^|[;"\s])(color|background)(-[a-z]+)?\s*:/i);
    for (const [, tag] of insideWrapper(html ?? "").matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
      expect(allowed).toContain(tag?.toLowerCase());
    }
  }
});

criterion("FR-MAIL-013-c2", async () => {
  for (const read of await readCase("link")) {
    expect(read.text?.split("\n")).toContain(
      "Here is the getting started guide (https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&utm_medium=reply&ref=abcdefghijklmnopqrstuvwxyz) — it covers everything.",
    );
  }
});

criterion("FR-MAIL-013-c3", async () => {
  for (const { html } of await readCase("plain")) {
    expect(html).toMatch(/<html lang="en" dir="ltr">/);
    expect(html).toMatch(/<div role="article"[^>]* lang="en" dir="ltr"/);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  }
});

criterion("FR-MAIL-013-c4", async () => {
  for (const { html, text } of await readCase("rich")) {
    expect(html?.match(/<ul[^>]*>(<li>.*?<\/li>){3}<\/ul>/)).not.toBeNull();
    expect(html).toContain("<em>briefly</em>");
    expect(html).toContain("<strong>important</strong>");
    const lines = text?.split("\n");
    expect(lines).toContain("- the guide");
    expect(lines).toContain("- the https://rafters.studio/docs");
    expect(lines).toContain("- the reply");
  }
});

criterion("FR-MAIL-013-c5", async () => {
  for (const { text } of await readCase("rich")) {
    expect(text).toContain("the https://rafters.studio/docs");
    expect(text?.split("https://rafters.studio/docs").length).toBe(2);
  }
});

criterion("FR-MAIL-013-c6", async () => {
  for (const { html, subject } of await readCase("rtl")) {
    expect(html).toMatch(/<html lang="he" dir="rtl">/);
    expect(html).toMatch(/<div role="article"[^>]* lang="he" dir="rtl"/);
    expect(subject).toBe("שלום");
  }
});

criterion("FR-MAIL-013-c7", () => {
  let drawn = 0;
  const random = createRandom();
  const mail = testMail((into) => {
    drawn += into.length;
    return random(into);
  });
  const write = () =>
    mail.compose({ from: sean, to: [mary] })({
      doc: [{ p: [{ a: "click here", href: "javascript:alert(1)" }] }],
    });
  expect(write).toThrow(MailWriteError);
  expect(write).toThrow(
    expect.objectContaining({
      code: "unsafe-link",
      field: "doc[0].p[0].href",
      message: "doc[0].p[0].href: links must be http, https or mailto",
    }),
  );
  expect(drawn).toBe(0);
});

criterion("FR-MAIL-013-c8", async () => {
  for (const { html, text } of await readCase("reply")) {
    expect(html).toContain(
      '<div dir="ltr" class="gmail_attr">On Fri, 21 Nov 1997 09:55:06 -0600, John Doe &lt;jdoe@machine.example&gt; wrote:<br></div>',
    );
    expect(html).toMatch(
      /<blockquote class="gmail_quote" type="cite"[^>]*><p[^>]*>This is a message just to say hello\.<br>So, &quot;Hello&quot;\.<\/p><\/blockquote>/,
    );
    expect(text?.split("\n")).toContain("> This is a message just to say hello.");
  }
});

/** A reply from mary to a parent from john whose document is this, as each reader reads it back. */
async function readReplyTo(doc: { p: ({ a: string; href: string } | string)[] }[]) {
  const written = testMail().replyTo({ from: [john], doc })({ from: mary, doc: [{ p: ["Yes."] }] });
  return Object.values(await readBack(written.bytes));
}

criterion("FR-MAIL-013-c10", async () => {
  for (const { text } of await readReplyTo([{ p: ["One."] }, { p: ["Two."] }])) {
    expect(text).toContain("\n> One.\n>\n> Two.\n");
  }
});

criterion("FR-MAIL-013-c11", async () => {
  for (const { html, text } of await readReplyTo([
    { p: [{ a: "Call us", href: "tel:+15551234" }] },
  ])) {
    expect(html).toContain("<blockquote");
    expect(html).toContain("Call us (tel:+15551234)");
    expect(html).not.toMatch(/<a\s/);
    expect(text).toContain("> Call us (tel:+15551234)");
  }
});
