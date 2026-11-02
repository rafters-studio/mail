import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import type { Written } from "../src/message/index.ts";
import { expectRefused, testMail, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
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

criterion("FR-MAIL-013-c9", async () => {
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
  for (const { html, text } of await readCase("forward")) {
    const lines = text?.split("\n") ?? [];
    const at = lines.indexOf(shown[0] ?? "");
    expect(lines.slice(at, at + shown.length + 1 + words.length)).toEqual([...shown, "", ...words]);
    expect(lines.filter((line) => line.startsWith(">"))).toEqual([]);
    expect(html).toContain(`${shown.map(escaped).join("<br>")}<br>`);
    expect(html).toContain(words.map(escaped).join("<br>"));
    expect(html).not.toMatch(/<blockquote/i);
  }
});

/** A forward from mary to jane of this parent. */
function forwardOf(parentInput: Parameters<ReturnType<typeof testMail>["forward"]>[0]): Written {
  return testMail().forward(parentInput)({ from: mary, to: [jane], doc: [{ p: ["See below."] }] });
}

criterion("FR-MAIL-013-c12", async () => {
  const line = 'Cc: boss@nil.test, Giant; "Big" Box <sysservices@example.net>';
  for (const { html, text } of Object.values(await readBack(forwardOf(parent("a1.2")).bytes))) {
    expect(text?.split("\n")).toContain(line);
    expect(html).toContain(
      "<br>Cc: boss@nil.test, Giant; &quot;Big&quot; Box &lt;sysservices@example.net&gt;<br>",
    );
  }
});

criterion("FR-MAIL-013-c13", async () => {
  const written = forwardOf({ from: [john], doc: [{ p: ["Hello."] }] });
  for (const { subject } of Object.values(await readBack(written.bytes))) {
    expect(subject).toBe("Fwd:");
  }
});

criterion("FR-MAIL-013-c14", async () => {
  for (const { subject } of await readCase("forward")) expect(subject).toBe("Fwd: Saying Hello");
});

criterion("FR-MAIL-013-c15", async () => {
  const written = forwardOf({
    from: [john],
    subject: "FW: Saying Hello",
    doc: [{ p: ["Hello."] }],
  });
  for (const { subject } of Object.values(await readBack(written.bytes))) {
    expect(subject).toBe("Fwd: Saying Hello");
  }
});

criterion("FR-MAIL-013-c20", async () => {
  const written = forwardOf({
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
  });
  for (const { text } of Object.values(await readBack(written.bytes))) {
    expect(text?.split("\n")).toContain("To: Team: ann@example.org, bob@example.org;");
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
