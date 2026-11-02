import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
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
  type Part,
  type Read,
} from "../src/read/index.ts";
import { criterion } from "./criterion.ts";

const FIXTURES = new URL("./fixtures/read/", import.meta.url);

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

criterion("FR-MAIL-002-c1", () => {
  expect(read("a4-trace").fields.map((f) => f.name)).toEqual([
    "Received",
    "Received",
    "From",
    "To",
    "Subject",
    "Date",
    "Message-ID",
  ]);
});

criterion("FR-MAIL-002-c2", () => {
  expect(read("a3-resent").fields.map((f) => f.name)).toEqual([
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
});

criterion("FR-MAIL-002-c3", () => {
  const r = read("m2-two-subjects");
  expect(r.fields.filter((f) => f.name === "Subject").map((f) => f.value)).toEqual([
    "first",
    "second",
  ]);
  expect(r.problems).toContainEqual({
    code: "repeated-field",
    field: "subject",
    detail: "2 times",
  });
});

criterion("FR-MAIL-003-c1", () => {
  expect(read("a4-trace").fields[0]?.value).toBe(
    "from x.y.test   by example.net   via TCP   with ESMTP   id ABC12345   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600",
  );
});

criterion("FR-MAIL-004-c1", () => {
  expect(read("a1.2-mailboxes").to).toEqual([
    { name: "Mary Smith", local: "mary", domain: "x.test" },
    { name: null, local: "jdoe", domain: "example.org" },
    { name: "Who?", local: "one", domain: "y.test" },
  ]);
});

criterion("FR-MAIL-004-c2", () => {
  expect(read("a1.2-mailboxes").cc?.[1]).toEqual({
    name: 'Giant; "Big" Box',
    local: "sysservices",
    domain: "example.net",
  });
});

criterion("FR-MAIL-004-c3", () => {
  expect(read("a1.3-groups").to).toEqual([
    {
      group: "A Group",
      members: [
        { name: "Ed Jones", local: "c", domain: "a.test" },
        { name: null, local: "joe", domain: "where.test" },
        { name: "John", local: "jdoe", domain: "one.test" },
      ],
    },
  ]);
});

criterion("FR-MAIL-004-c4", () => {
  expect(read("a1.3-groups").cc).toEqual([{ group: "Undisclosed recipients", members: [] }]);
});

criterion("FR-MAIL-004-c5", () => {
  expect(read("a5-oddities").from).toEqual([{ name: "Pete", local: "pete", domain: "silly.test" }]);
});

criterion("FR-MAIL-004-c6", () => {
  expect(read("a5-oddities").to).toEqual([
    {
      group: "A Group",
      members: [
        { name: "Chris Jones", local: "c", domain: "public.example" },
        { name: null, local: "joe", domain: "example.org" },
        { name: "John", local: "jdoe", domain: "one.test" },
      ],
    },
  ]);
});

criterion("FR-MAIL-004-c7", () => {
  expect(read("a5-oddities").cc).toEqual([{ group: "Hidden recipients", members: [] }]);
});

criterion("FR-MAIL-004-c8", () => {
  expect(read("a6.1-obs-address").to).toEqual([
    { name: "Mary Smith", local: "mary", domain: "example.net" },
    { name: null, local: "jdoe", domain: "test.example" },
  ]);
});

criterion("FR-MAIL-004-c9", () => {
  expect(read("a6.3-obs-ws").from).toEqual([
    { name: "John Doe", local: "jdoe", domain: "machine.example" },
  ]);
});

criterion("FR-MAIL-004-c10", () => {
  const a = { name: null, local: "mary", domain: "example.net" };
  expect(sameMailbox(a, { ...a, domain: "EXAMPLE.NET" })).toBe(true);
});

criterion("FR-MAIL-004-c11", () => {
  const a = { name: null, local: "mary", domain: "example.net" };
  expect(sameMailbox(a, { ...a, local: "Mary" })).toBe(false);
});

criterion("FR-MAIL-004-c12", () => {
  const r = read("r1-literal-quoted");
  expect(r.from).toEqual([{ name: null, local: '"john doe"', domain: "example.com" }]);
  expect(r.to).toEqual([{ name: null, local: "jdoe", domain: "[192.0.2.1]" }]);
});

criterion("FR-MAIL-004-c13", () => {
  expect(read("r11-edges").from).toEqual([{ name: null, local: 'a."b c"', domain: "x.test" }]);
});

criterion("FR-MAIL-004-c14", () => {
  const r = read("r2-unclosed");
  expect([r.from, r.to, r.cc]).toEqual([null, null, null]);
  expect(r.problems).toEqual(
    expect.arrayContaining([unparsed("from"), unparsed("to"), unparsed("cc")]),
  );
});

criterion("FR-MAIL-004-c15", () => {
  const r = read("r11-edges");
  expect([r.cc, r.to]).toEqual([null, null]);
  expect(r.problems).toEqual(
    expect.arrayContaining([
      { code: "unparsed-value", field: "cc", detail: "lone@" },
      { code: "unparsed-value", field: "to", detail: "G: <bad;" },
    ]),
  );
});

criterion("FR-MAIL-004-c16", () => {
  const group = read("r5-group-from");
  expect(group.from).toBeNull();
  expect(group.problems).toContainEqual(unparsed("from"));
  for (const r of [read("r4-one-each"), read("r11-edges")]) {
    expect(r.sender).toBeNull();
    expect(r.problems).toContainEqual(unparsed("sender"));
  }
});

criterion("FR-MAIL-004-c17", () => {
  expect(
    sameMailbox(
      { name: null, local: "a", domain: "Kelvin.test" },
      { name: null, local: "a", domain: "kelvin.test" },
    ),
  ).toBe(false);
});

criterion("FR-MAIL-004-c18", () => {
  expect(readAddresses("G: a@x.test b@x.test;")).toBeNull();
  expect(readAddresses("G: a@x.test, b@x.test;")).toEqual([
    {
      group: "G",
      members: [
        { name: null, local: "a", domain: "x.test" },
        { name: null, local: "b", domain: "x.test" },
      ],
    },
  ]);
});

criterion("FR-MAIL-005-c1", () => {
  const r = read("a2-3-reply");
  expect(r.inReplyTo).toEqual(["3456@example.net"]);
  expect(r.references).toEqual(["1234@local.machine.example", "3456@example.net"]);
});

criterion("FR-MAIL-005-c2", () => {
  expect(read("a6.3-obs-ws").messageId).toBe("1234@local.machine.example");
});

criterion("FR-MAIL-005-c3", () => {
  expect(read("a5-oddities").messageId).toBe("testabcd.1234@silly.test");
});

criterion("FR-MAIL-005-c4", () => {
  const r = read("r4-one-each");
  expect(r.messageId).toBeNull();
  expect(r.problems).toContainEqual(unparsed("message-id"));
});

criterion("FR-MAIL-005-c5", () => {
  const cases: [Read, "inReplyTo" | "messageId", string][] = [
    [read("r4-one-each"), "inReplyTo", "in-reply-to"],
    [read("r2-unclosed"), "messageId", "message-id"],
    [read("r11-edges"), "inReplyTo", "in-reply-to"],
  ];
  for (const [r, key, field] of cases) {
    expect(r[key]).toBeNull();
    expect(r.problems).toContainEqual(unparsed(field));
  }
});

criterion("FR-MAIL-005-c6", () => {
  expect(read("r4-one-each").references).toEqual(["1@x.test", "2@x.test"]);
});

criterion("FR-MAIL-005-c7", () => {
  expect(read("r1-literal-quoted").messageId).toBe('"quoted"@[192.0.2.1]');
});

criterion("FR-MAIL-006-c1", () => {
  expect(read("a6.2-obs-date").date).toEqual({
    instant: new Date("1997-11-21T09:55:06Z"),
    zone: "GMT",
  });
});

criterion("FR-MAIL-006-c2", () => {
  expect(read("a6.3-obs-ws").date).toEqual({
    instant: new Date("1997-11-21T15:55:06Z"),
    zone: "-0600",
  });
});

criterion("FR-MAIL-006-c3", () => {
  expect(read("a5-oddities").date).toEqual({
    instant: new Date("1969-02-14T03:02:00Z"),
    zone: "-0330",
  });
});

/** Expects a read whose date has no instant, whose Date text is kept and with an invalid-date problem. */
function expectInvalid(r: Read, date: string, problem: string): void {
  expect(r.date).toEqual({ instant: null, problem });
  expect(r.fields).toContainEqual({ name: "Date", value: date });
  expect(r.problems).toContainEqual({ code: "invalid-date", field: "date", detail: problem });
}

criterion("FR-MAIL-006-c4", () => {
  expectInvalid(read("m5-feb30"), "Mon, 30 Feb 2026 10:00:00 +0000", "not a day of that month");
});

criterion("FR-MAIL-006-c5", () => {
  const date = "Fri, 2 Mar 2026 10:00:00 +0000";
  expectInvalid(dated(date), date, "day of the week does not match");
});

criterion("FR-MAIL-006-c6", () => {
  const date = "Mon, 2 Mar 2026 10:00:00 +0060";
  expectInvalid(dated(date), date, "zone minutes over 59");
});

criterion("FR-MAIL-006-c7", () => {
  expect(dated("Mon, 2 Mar 2026 10:00:00 -0000").date).toEqual({
    instant: new Date("2026-03-02T10:00:00Z"),
    zone: null,
  });
});

criterion("FR-MAIL-006-c8", () => {
  expect(dated("Mon, 2 Mar 2026 10:00:00 Z").date).toEqual({
    instant: new Date("2026-03-02T10:00:00Z"),
    zone: null,
  });
});

criterion("FR-MAIL-006-c9", () => {
  // The zone as written, as form 01a19b46 and golden r3-years give it.
  expect(readDate("2 Mar 26 10:00 EST")).toEqual({
    instant: new Date("2026-03-02T15:00:00Z"),
    zone: "EST",
  });
});

criterion("FR-MAIL-006-c10", () => {
  expect(readDate("2 Mar 126 10:00 +0000")).toEqual({
    instant: new Date("2026-03-02T10:00:00Z"),
    zone: "+0000",
  });
});

criterion("FR-MAIL-006-c11", () => {
  expect(readDate("2 Mar 2026 24:00 +0000")).toEqual({
    instant: null,
    problem: "not a time of day",
  });
});

criterion("FR-MAIL-006-c12", () => {
  for (const r of [read("r10-unclosed"), read("r11-edges")]) {
    expect(r.date).toEqual({ instant: null, problem: "not a date" });
    expect(r.problems).toContainEqual({
      code: "unparsed-value",
      field: "date",
      detail: "not a date",
    });
  }
});

criterion("FR-MAIL-006-c13", () => {
  expect(readDate("Sat, 31 Dec 2016 23:59:60 +0000")).toEqual({
    instant: new Date("2017-01-01T00:00:00Z"),
    zone: "+0000",
  });
});

criterion("FR-MAIL-006-c14", () => {
  const d = readDate("1 Jan 0049 00:00 +0000");
  expect(d.instant?.getUTCFullYear()).toBe(49);
});

criterion("FR-MAIL-006-c15", () => {
  expect(readDate("2 Mar 2026 10:00 +05")).toEqual({ instant: null, problem: "not a date" });
});

criterion("FR-MAIL-006-c16", () => {
  expect(readDate("2 Mar 2026 10:00 Gmt")).toEqual({
    instant: new Date("2026-03-02T10:00:00Z"),
    zone: "Gmt",
  });
});

criterion("FR-MAIL-007-c1", () => {
  const r = read("m1-no-date-no-from");
  expect([r.date, r.from]).toEqual([null, null]);
  expect(r.problems).toEqual([
    { code: "missing-required", field: "date", detail: "absent" },
    { code: "missing-required", field: "from", detail: "absent" },
  ]);
});

criterion("FR-MAIL-007-c2", () => {
  expect(read("m3-bare-lf").problems).toContainEqual({
    code: "bare-line-break",
    field: null,
    detail: "a CR or LF outside a CRLF pair",
  });
});

criterion("FR-MAIL-007-c3", () => {
  const r = read("m4-long-line");
  expect(r.problems).toContainEqual(expect.objectContaining({ code: "line-too-long" }));
  expect(r.subject).toHaveLength(2000);
});

criterion("FR-MAIL-007-c4", () => {
  const r = read("m6-garbage-address");
  expect(r.from).toBeNull();
  expect(r.problems).toContainEqual({
    code: "unparsed-value",
    field: "from",
    detail: "<<<>>> ,,, @@@",
  });
});

criterion("FR-MAIL-007-c5", () => {
  const r = read("m7-no-colon-line");
  expect(r.problems).toContainEqual({
    code: "no-colon",
    field: null,
    detail: "this line has no colon",
  });
  expect(r.from).not.toBeNull();
  expect(r.date).not.toBeNull();
});

criterion("FR-MAIL-019-c1", () => {
  for (const [name, { leaves }] of Object.entries(oracle)) {
    for (const leaf of leaves) {
      const p = part(name, leaf.path);
      expect(p.type, `${name} ${leaf.path}`).toBe(leaf.type);
      if (leaf.raw !== null) expect(slice(name, p.body), `${name} ${leaf.path}`).toBe(leaf.raw);
    }
  }
});

criterion("FR-MAIL-019-c2", () => {
  const forwarded = part("forward", "3");
  expect(forwarded.type).toBe("message/rfc822");
  expect(forwarded.message).not.toBeNull();
  const inner = part("forward", "3.1");
  expect(slice("forward", inner.header)).toMatch(/^From: John Doe <jdoe@machine\.example>/);
  expect(inner).toEqual(forwarded.message);
  expect(inner.type).toBe("text/plain");
});

criterion("FR-MAIL-019-c3", () => {
  expect(slice("forward", part("forward", "1.1").body)).toContain(
    "---------- Forwarded message ---------",
  );
  expect(part("forward", "1").children).toHaveLength(2);
});

criterion("FR-MAIL-019-c4", () => {
  const r = read("r8-broken-multipart");
  expect(r.root.children).toEqual([]);
  expect(r.problems).toContainEqual({
    code: "multipart-no-boundary",
    field: "content-type",
    detail: "multipart/mixed",
  });
});

criterion("FR-MAIL-019-c5", () => {
  const r = read("r10-unclosed");
  expect(r.root.children).toHaveLength(1);
  expect(r.root.children[0]?.body.end).toBe(bytes("r10-unclosed").length);
  expect(r.problems).toContainEqual({
    code: "multipart-unclosed",
    field: "content-type",
    detail: "b",
  });
});

criterion("FR-MAIL-019-c6", () => {
  const { root } = read("r6-digest");
  expect(root.params["boundary"]).toBe('d"q');
  const [message, text] = root.children;
  expect(message?.type).toBe("message/rfc822");
  expect(message?.header.start).toBe(message?.header.end);
  expect(slice("r6-digest", message?.message?.header ?? root.body)).toContain("From: inner@x.test");
  expect(text?.type).toBe("text/plain");
  expect(slice("r6-digest", text?.header ?? root.body)).toBe("Content-Type: text/plain");
  expect(text?.body.start).toBe(text?.body.end);
});

criterion("FR-MAIL-019-c7", () => {
  const { root } = read("r9-all-header");
  expect(root.body).toEqual({
    start: bytes("r9-all-header").length,
    end: bytes("r9-all-header").length,
  });
  expect(section(root, "1")).toBe(root);
});

criterion("FR-MAIL-019-c8", () => {
  const { root } = read("attachment");
  expect(section(root, "9")).toBeNull();
  expect(section(root, "2.1.1")).toBeNull();
});

criterion("FR-MAIL-019-c9", () => {
  for (const [name, { leaves }] of Object.entries(oracle)) {
    for (const leaf of leaves) {
      if (leaf.text !== null) {
        expect(partText(binary(bytes(name)), part(name, leaf.path)), `${name} ${leaf.path}`).toBe(
          leaf.text,
        );
      }
    }
  }
});

criterion("FR-MAIL-019-c10", () => {
  const pdf = part("attachment", "2");
  // What Python email decodes for it: the attachment case's 3,000 bytes, byte i = i mod 256.
  const python = Uint8Array.from({ length: 3000 }, (_, i) => i % 256);
  expect(transferDecode(slice("attachment", pdf.body), "base64")).toEqual(python);
});

criterion("FR-MAIL-019-c11", () => {
  const { root } = read("r7-decode");
  expect(partText(binary(bytes("r7-decode")), root)).toBe("a=b =zz café\r\n");
});

criterion("FR-MAIL-019-c12", () => {
  expect(decodeWords(read("r7-decode").subject ?? "")).toBe("café ok ✔ =?nosuch?Q?x?=");
});

criterion("FR-MAIL-019-c13", () => {
  expect(decodeWords(read("intl").subject ?? "")).toBe(oracle["intl"]?.subject);
});

criterion("FR-MAIL-019-c14", () => {
  const names = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".eml"))
    .map((f) => f.slice(0, -4));
  expect(names).toHaveLength(38);
  const all = Object.fromEntries(
    names.map((name) => {
      const r = read(name);
      const date = r.date?.instant
        ? { instant: r.date.instant.toISOString(), zone: r.date.zone }
        : r.date;
      return [name, JSON.parse(JSON.stringify({ ...r, date }))];
    }),
  );
  expect(all).toEqual(goldens);
});

criterion("FR-MAIL-019-c15", () => {
  expect(transferDecode("a  \r\nb=  \r\nc\t", " Quoted-Printable ")).toEqual(
    new TextEncoder().encode("a\r\nbc"),
  );
});

criterion("FR-MAIL-019-c16", () => {
  const nested = (depth: number): string =>
    "From: a@x.test\r\nContent-Type: message/rfc822\r\n\r\n".repeat(depth) +
    "From: a@x.test\r\n\r\nbody\r\n";
  const tooDeep = { code: "too-deep", field: "content-type", detail: "nesting over 50" };
  for (const r of [read("r12-deep"), readMessage(new TextEncoder().encode(nested(5000)))]) {
    expect(r.problems.filter((p) => p.code === "too-deep")).toEqual([tooDeep]);
  }
});

criterion("FR-MAIL-019-c17", () => {
  expect(contentType('text/plain; charset="utf-8"; format=flowed')).toEqual({
    type: "text/plain",
    params: { charset: "utf-8", format: "flowed" },
  });
});

criterion("FR-MAIL-019-c18", () => {
  const fields = partFields(binary(bytes("attachment")), part("attachment", "2"));
  expect(fields.map((f) => f.name)).toEqual([
    "Content-Type",
    "Content-Transfer-Encoding",
    "Content-Disposition",
  ]);
});

criterion("FR-MAIL-019-c19", () => {
  const attachment = binary(bytes("attachment"));
  expect(bodyLines(attachment, part("attachment", "1.1"))).toBe(1);
  expect(bodyLines(attachment, part("attachment", "2"))).toBe(53);
  expect(bodyLines(binary(bytes("r9-all-header")), read("r9-all-header").root)).toBe(0);
});
