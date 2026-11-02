import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { criterion } from "./criterion.ts";

const SRC = new URL("../src/", import.meta.url);

// The citation the form's file table gives each source file (form 01a18fda, form 01a19a5c,
// form 01a19b46, form 01a19ba8 and form 01a19d25, Where the code lives).
const CITATIONS: Record<string, string> = {
  "encoding/chars.ts": "RFC 5322 3.2.3",
  "encoding/never.ts": "form 01a18fda",
  "encoding/quoted-printable.ts": "RFC 2045 6.7",
  "encoding/base64.ts": "RFC 2045 6.8",
  "encoding/encoded-word.ts": "RFC 2047 2",
  "encoding/parameter.ts": "RFC 2231 3, 4",
  "encoding/fold.ts": "RFC 5322 2.2.3",
  "encoding/multipart.ts": "RFC 2046 5.1.1",
  "address/index.ts": "RFC 5322 3.4",
  "address/words.ts": "RFC 5322 3.4, 3.4.1",
  "message-id/index.ts": "RFC 5322 3.6.4",
  "message-id/uuidv7.ts": "RFC 9562 5.7",
  "date/format.ts": "RFC 5322 3.3",
  "document/index.ts": "research 01a194af",
  "document/render.ts": "research 01a194af",
  "message/write.ts": "RFC 5322 3.6, RFC 2046 5.1.4",
  "message/parent.ts": "research 01a194af",
  "message/reply.ts": "RFC 5322 3.6.4",
  "message/forward.ts": "RFC 2046 5.2.1",
  "message/index.ts": "form 01a18fda",
  "receive/recipient.ts": "RFC 5321 2.4",
  "receive/directory.ts": "RFC 5321 4.5.1",
  "receive/digest.ts": "FIPS 180-4",
  "receive/index.ts": "RFC 5321 4.5.5",
  "masked/words.ts": "EFF short wordlist 1",
  "masked/index.ts": "RFC 5322 3.4.1",
  "read/lexer.ts": "RFC 5322 3.2",
  "read/fields.ts": "RFC 5322 2.2.3",
  "read/address.ts": "RFC 5322 4.4",
  "read/message-id.ts": "RFC 5322 3.6.4",
  "read/date.ts": "RFC 5322 3.3",
  "read/mime.ts": "RFC 2046 5.1.1",
  "read/decode.ts": "RFC 2045 6.1",
  "read/index.ts": "RFC 5322 3.6",
  "imap/reader.ts": "RFC 3501 2.2",
  "imap/format.ts": "RFC 3501 4.5",
  "imap/sequence.ts": "RFC 3501 2.3.1.2",
  "imap/snapshot.ts": "RFC 3501 2.3.1.2",
  "imap/fetch.ts": "RFC 3501 6.4.5",
  "imap/search.ts": "RFC 3501 6.4.4",
  "imap/session.ts": "RFC 3501 3",
  "imap/index.ts": "RFC 3501 2.1",
  "send/connection.ts": "RFC 5321 4.5.3.2",
  "send/smtp.ts": "RFC 5321 4.5.2, RFC 6409",
  "send/events.ts": "form 01a19d25",
  "send/index.ts": "RFC 1047",
};

/** Every source file, as a path relative to src/. */
function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
}

criterion("NFR-MAIL-003-c1", () => {
  for (const file of sources()) {
    const source = readFileSync(new URL(file, SRC), "utf8");
    const opening = (source.match(/^(\/\/.*\n)+/)?.[0] ?? "").replace(/\n\/\/ ?/g, " ");
    expect(CITATIONS, file).toHaveProperty([file]);
    expect(opening, file).toContain(CITATIONS[file]);
    expect(opening, file).toMatch(/"[^"]{20,}"/);
  }
});

criterion("NFR-MAIL-003-c2", () => {
  for (const file of sources()) {
    const source = readFileSync(new URL(file, SRC), "utf8");
    // A function or constructor is documented when a doc comment ends on the line above it.
    for (const [, before, declaration] of source.matchAll(
      /([^\n]*)\n\s*((?:export )?function \w+|constructor)\(/g,
    )) {
      expect(before?.trim(), `${file}: ${declaration}`).toMatch(/\*\/$/);
    }
  }
});
