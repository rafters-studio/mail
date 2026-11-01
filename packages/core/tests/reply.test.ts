import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import type { Written } from "../src/message/index.ts";
import { testMail, text, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { parent } from "./fixtures/parents.ts";
import { john, mary } from "./fixtures/people.ts";

const doc = [{ p: ["Hello."] }];

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

criterion("FR-MAIL-010-c1", () => {
  const written = testMail().replyTo(parent("a2-1"))({ from: mary, doc });
  expect(header(written, "In-Reply-To")).toBe("<1234@local.machine.example>");
  expect(header(written, "References")).toBe("<1234@local.machine.example>");
});

criterion("FR-MAIL-010-c2", () => {
  const written = testMail().replyTo(parent("a2-2"))({ from: john, doc });
  expect(header(written, "In-Reply-To")).toBe("<3456@example.net>");
  expect(header(written, "References")).toBe("<1234@local.machine.example> <3456@example.net>");
});

criterion("FR-MAIL-010-c3", () => {
  const written = testMail().replyTo({
    from: [john],
    messageId: "c@x.test",
    inReplyTo: ["b@x.test"],
    doc,
  })({ from: mary, doc });
  expect(header(written, "References")).toBe("<b@x.test> <c@x.test>");
});

criterion("FR-MAIL-010-c4", () => {
  const written = testMail().replyTo({ from: [john], doc })({ from: mary, doc });
  expect(header(written, "In-Reply-To")).toBeUndefined();
  expect(header(written, "References")).toBeUndefined();
});

criterion("FR-MAIL-010-c5", async () => {
  for (const read of Object.values(await readBack(writeCase("reply").bytes))) {
    expect(read.inReplyTo).toEqual(["1234@local.machine.example"]);
    expect(read.references).toEqual(["1234@local.machine.example"]);
  }
});

criterion("FR-MAIL-011-c1", () => {
  const written = testMail().replyTo(parent("a2-2"))({ from: john, doc });
  expect(header(written, "To")).toBe('"Mary Smith: Personal Account" <smith@home.example>');
});

criterion("FR-MAIL-011-c2", () => {
  const written = testMail().replyTo(parent("a2-1"))({ from: mary, doc });
  expect(header(written, "To")).toBe("John Doe <jdoe@machine.example>");
});

criterion("FR-MAIL-011-c3", () => {
  const written = testMail().replyTo(parent("a1.2"))({
    from: { name: "Mary Smith", addr: { local: "mary", domain: "x.test" } },
    all: true,
    doc,
  });
  expect(header(written, "To")).toBe('"Joe Q. Public" <john.q.public@example.com>');
  expect(header(written, "Cc")).toBe(
    'jdoe@example.org, Who? <one@y.test>, boss@nil.test, "Giant; \\"Big\\" Box" <sysservices@example.net>',
  );
});

criterion("FR-MAIL-011-c4", () => {
  const written = testMail().replyTo(parent("a2-1"))({ from: mary, doc });
  expect(header(written, "Subject")).toBe("Re: Saying Hello");
});

criterion("FR-MAIL-011-c5", () => {
  const written = testMail().replyTo(parent("a2-2"))({ from: john, doc });
  expect(header(written, "Subject")).toBe("Re: Saying Hello");
});

criterion("FR-MAIL-011-c6", () => {
  const written = testMail().replyTo({ from: [john], subject: "RE: Saying Hello", doc })({
    from: mary,
    doc,
  });
  expect(header(written, "Subject")).toBe("Re: Saying Hello");
});

criterion("FR-MAIL-011-c7", () => {
  const written = testMail().replyTo({ from: [john], doc })({ from: mary, doc });
  expect(header(written, "Subject")).toBe("Re:");
});

criterion("FR-MAIL-011-c8", () => {
  const written = testMail().replyTo({
    from: [john],
    to: [mary, { name: "Ann", addr: { local: "ann", domain: "example.org" } }],
    cc: [box("ann", "EXAMPLE.org"), john],
    doc,
  })({ from: mary, all: true, doc });
  expect(header(written, "To")).toBe("John Doe <jdoe@machine.example>");
  expect(header(written, "Cc")).toBe("Ann <ann@example.org>");
});

criterion("FR-MAIL-011-c9", () => {
  const written = testMail().replyTo({
    from: [john],
    to: [{ group: "Team", members: [box("ann", "example.org"), box("bob", "example.org")] }],
    doc,
  })({ from: mary, all: true, doc });
  expect(header(written, "Cc")).toBe("ann@example.org, bob@example.org");
});
