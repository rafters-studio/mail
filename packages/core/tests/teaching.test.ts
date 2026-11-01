import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { criterion } from "./criterion.ts";

const SRC = new URL("../src/", import.meta.url);

// The citation the form's file table gives each source file (form 01a18fda, Where the code lives).
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
