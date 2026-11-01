import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import { COMPOSE_CASES, expectRefused, testMail, text, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { mary, sean } from "./fixtures/people.ts";

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

criterion("FR-MAIL-008-c1", () => {
  for (const name of COMPOSE_CASES) expectWithin78(text(writeCase(name)));
});

criterion("FR-MAIL-008-c2", async () => {
  for (const read of Object.values(await readBack(writeCase("intl").bytes))) {
    expect(read.from).toEqual([{ name: "José Núñez", address: "jose@example.es" }]);
    expect(read.subject).toBe(
      "Café \u2615 meeting — 日本語の件名が長いので折り返しが必要です and a little more English to force folding",
    );
  }
});

criterion("FR-MAIL-008-c3", async () => {
  const href =
    "https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&amp;utm_medium=reply&amp;ref=abcdefghijklmnopqrstuvwxyz";
  const html =
    '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Getting started</title></head>' +
    '<body style="margin:0"><div role="article" aria-label="Getting started" lang="en" dir="ltr" style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">' +
    `<p style="margin:1em 0">Hi Mary,</p><p style="margin:1em 0">Here is the <a href="${href}">getting started guide</a> — it covers everything.</p><p style="margin:1em 0">Sean</p></div></body></html>`;
  const plain = `Hi Mary,\n\nHere is the getting started guide (${href.replaceAll("&amp;", "&")}) — it covers everything.\n\nSean\n`;
  for (const read of Object.values(await readBack(writeCase("link").bytes))) {
    expect(read.textBeforeHtml).toBe(true);
    expect(read.text).toBe(plain);
    expect(read.html).toBe(html);
  }
});

criterion("FR-MAIL-008-c4", async () => {
  for (const read of Object.values(await readBack(writeCase("attachment").bytes))) {
    expect(read.attachments).toEqual([{ filename: "résumé de José.pdf", size: 3000 }]);
  }
});

criterion("FR-MAIL-008-c5", async () => {
  const written = writeCase("long-filename");
  expectWithin78(text(written));
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.attachments).toEqual([
      {
        filename:
          "Informe trimestral de ventas y márgenes por región — versión definitiva revisada por José Núñez.pdf",
        size: 3,
      },
    ]);
  }
});

criterion("FR-MAIL-008-c6", async () => {
  const written = writeCase("ascii-filename");
  expectWithin78(text(written));
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.attachments).toEqual([{ filename: `${"a".repeat(116)}.pdf`, size: 3 }]);
  }
});

criterion("FR-MAIL-008-c7", async () => {
  const written = writeCase("docx");
  const message = text(written);
  expect(message).toContain(
    "\r\nContent-Type:\r\n application/vnd.openxmlformats-officedocument.wordprocessingml.document;\r\n",
  );
  expectWithin78(message);
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.attachments).toEqual([{ filename: "report.docx", size: 3 }]);
  }
});

criterion("FR-MAIL-008-c8", async () => {
  const written = testMail().compose({
    from: { addr: { local: "noreply", domain: "rafters.studio" } },
    replyTo: [{ addr: { local: "support", domain: "rafters.studio" } }],
  })({ doc });
  expect(lines(text(written))).toContain("Reply-To: support@rafters.studio");
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.from).toEqual([{ name: "", address: "noreply@rafters.studio" }]);
  }
});

criterion("FR-MAIL-008-c9", async () => {
  const written = writeCase("rich");
  expect(lines(text(written))).toContain("Three things, briefly, and one important:=20");
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.text?.split("\n")[0]).toBe("Three things, briefly, and one important: ");
  }
});

criterion("FR-MAIL-008-c10", () => {
  expect(lines(text(writeCase("plain")))).toContain("Date: Mon, 2 Mar 2026 10:00:00 -0700");
});

criterion("FR-MAIL-008-c11", () => {
  const header = text(testMail().compose({ from: sean, to: [], cc: [mary] })({ doc })).split(
    "\r\n\r\n",
  )[0];
  expect(header).not.toMatch(/^To:/m);
  expect(header).toMatch(/^Cc: Mary Smith <mary@example\.net>$/m);
});

criterion("FR-MAIL-008-c12", () => {
  expectRefused(
    (mail) => mail.compose({ from: sean, to: [mary] })({ doc: [{ p: ["x".repeat(90_000)] }] }),
    "too-large",
    "content",
    "the HTML part is over 90,000 bytes once encoded",
  );
});

criterion("FR-MAIL-008-c13", () => {
  expectRefused(
    (mail) => mail.compose({ from: sean, to: [mary] })({ doc: [{ p: ["    "] }] }),
    "no-text",
    "doc",
    "every message needs a text part",
  );
});

criterion("FR-MAIL-008-c14", () => {
  expectRefused(
    (mail) => mail.compose({ from: sean, to: [mary], subject: "a".repeat(1000) })({ doc }),
    "word-too-long",
    "subject",
    "has a word too long for 998 characters",
  );
});

criterion("FR-MAIL-008-c15", () => {
  expectRefused(
    (mail) =>
      mail.compose({ from: sean, to: [{ addr: { local: "josé", domain: "ejemplo.es" } }] })({
        doc,
      }),
    "address",
    "to[0].addr.local",
    "addresses must be US-ASCII dot-atom text",
  );
});

criterion("FR-MAIL-008-c16", () => {
  const head = { from: sean, to: [mary], priority: "high" };
  expectRefused(
    (mail) => mail.compose(head)({ doc }),
    "invalid",
    "priority",
    "does not match its schema",
  );
});

criterion("FR-MAIL-008-c17", () => {
  expectRefused(
    // @ts-expect-error -- the scenario's To is text, not a list of mailboxes
    (mail) => mail.compose({ from: sean, to: "mary@example.net" })({ doc }),
    "invalid",
    "to",
    "does not match its schema",
  );
});

criterion("FR-MAIL-008-c18", async () => {
  const written = testMail().compose({ from: { ...sean, name: "Silvius, Sean" }, to: [mary] })({
    doc,
  });
  expect(lines(text(written))).toContain('From: "Silvius, Sean" <sean@rafters.studio>');
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.from).toEqual([{ name: "Silvius, Sean", address: "sean@rafters.studio" }]);
  }
});

criterion("FR-MAIL-008-c19", () => {
  const written = testMail().compose({ from: { ...sean, name: "   " }, to: [mary] })({ doc });
  expect(lines(text(written))).toContain("From: sean@rafters.studio");
});

criterion("FR-MAIL-012-c1", () => {
  const message = text(
    testMail().compose({
      from: sean,
      to: [mary],
      bcc: [{ addr: { local: "hidden", domain: "example.net" } }],
    })({ doc }),
  );
  expect(message).not.toMatch(/^Bcc:/im);
  expect(message).not.toContain("hidden@example.net");
});
