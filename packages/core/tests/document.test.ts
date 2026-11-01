import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import { expectRefused, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { mary, sean } from "./fixtures/people.ts";

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
  expectRefused(
    (mail) =>
      mail.compose({ from: sean, to: [mary] })({
        doc: [{ p: [{ a: "click here", href: "javascript:alert(1)" }] }],
      }),
    "unsafe-link",
    "doc[0].p[0].href",
    "links must be http, https or mailto",
  );
});
