// The code teaches how email works (NFR-MAIL-003): "Every source file SHALL begin with a comment
// naming its concept, the RFC section (or research) it implements, and that section's governing
// rule in one quoted sentence".
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { criterion } from "../../core/tests/criterion.ts";

const SRC = new URL("../src/", import.meta.url);

// The citation the form's file table gives each file (form 01a19d25, Where the code lives).
const CITATIONS: Record<string, string> = {
  "smtp.ts": "Resend SMTP docs",
  "webhook.ts": "Svix manual verification",
  "index.ts": "form 01a19d25",
};

/** Every source file, as a path relative to src/. */
function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
}

criterion("NFR-MAIL-003-c1", () => {
  expect(sources().sort()).toEqual(Object.keys(CITATIONS).sort());
  for (const file of sources()) {
    const source = readFileSync(new URL(file, SRC), "utf8");
    const opening = (source.match(/^(\/\/.*\n)+/)?.[0] ?? "").replace(/\n\/\/ ?/g, " ");
    expect(opening, file).toContain(CITATIONS[file]);
    expect(opening, file).toMatch(/"[^"]{20,}"/);
  }
});

criterion("NFR-MAIL-003-c2", () => {
  for (const file of sources()) {
    const source = readFileSync(new URL(file, SRC), "utf8");
    // A function is documented when a doc comment ends on the line above it.
    for (const [, before, declaration] of source.matchAll(
      /([^\n]*)\n\s*((?:export )?(?:async )?function \w+)/g,
    )) {
      expect(before?.trim(), `${file}: ${declaration}`).toMatch(/\*\/$/);
    }
  }
});
