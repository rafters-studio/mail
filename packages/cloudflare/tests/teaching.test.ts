// The code teaches how email works (NFR-MAIL-003): "Every source file SHALL begin with a comment
// naming its concept, the RFC section (or research) it implements, and that section's governing
// rule in one quoted sentence".
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { criterion } from "../../core/tests/criterion.ts";

const ROOT = new URL("../", import.meta.url);

// The citation the form's file table gives each file (forms 01a19a5c and 01a19d25, Where the code lives).
const CITATIONS: Record<string, string> = {
  "src/r2.ts": "Cloudflare R2 Workers API",
  "src/d1.ts": "Cloudflare D1 Workers API",
  "src/worker.ts": "Cloudflare Email Workers runtime API",
  "src/index.ts": "form 01a19a5c",
  "migrations/0001_receiving.sql": "RFC 5321 4.5.1",
  "src/binding.ts": "Cloudflare send-email docs",
  "src/socket.ts": "Cloudflare TCP sockets docs",
  "src/events.ts": "Cloudflare event-subscriptions docs",
  "src/send-log.ts": "RFC 1047",
  "src/sending-worker.ts": "Cloudflare Queues docs",
  "migrations/0002_sending.sql": "RFC 1047",
};

/** The files of one folder with one extension, as paths from the package root. */
function files(folder: string, extension: string): string[] {
  return readdirSync(new URL(folder, ROOT), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(extension))
    .map((f) => `${folder}/${f}`);
}

criterion("NFR-MAIL-003-c1", () => {
  const read: [string, RegExp, RegExp][] = [
    ...files("src", ".ts").map((f): [string, RegExp, RegExp] => [f, /^(\/\/.*\n)+/, /\n\/\/ ?/g]),
    ...files("migrations", ".sql").map((f): [string, RegExp, RegExp] => [
      f,
      /^(--.*\n)+/,
      /\n-- ?/g,
    ]),
  ];
  expect(read.map(([f]) => f).sort()).toEqual(Object.keys(CITATIONS).sort());
  for (const [file, opening, joint] of read) {
    const source = readFileSync(new URL(file, ROOT), "utf8");
    const text = (source.match(opening)?.[0] ?? "").replace(joint, " ");
    expect(text, file).toContain(CITATIONS[file]);
    expect(text, file).toMatch(/"[^"]{20,}"/);
  }
});

criterion("NFR-MAIL-003-c2", () => {
  for (const file of files("src", ".ts")) {
    const source = readFileSync(new URL(file, ROOT), "utf8");
    // A function is documented when a doc comment ends on the line above it.
    for (const [, before, declaration] of source.matchAll(
      /([^\n]*)\n\s*((?:export )?(?:async )?function \w+)/g,
    )) {
      expect(before?.trim(), `${file}: ${declaration}`).toMatch(/\*\/$/);
    }
  }
});
