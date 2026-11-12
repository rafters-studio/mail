// The code teaches how email works (NFR-MAIL-003): packages/resend's citations and its own check, which packages/core/tests/teaching.steps.ts runs.
import { readdirSync, readFileSync } from "node:fs";
import type { Teaching } from "../../core/tests/teaching.ts";

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

/** packages/resend's teaching check, as its teaching.test.ts ran it. */
export const teaching: Teaching = {
  name: "resend",
  openings: () =>
    sources().flatMap((file) => {
      const source = readFileSync(new URL(file, SRC), "utf8");
      const opening = (source.match(/^(\/\/.*\n)+/)?.[0] ?? "").replace(/\n\/\/ ?/g, " ");
      const cited = CITATIONS[file];
      if (cited === undefined) return [`${file}: not in the table`];
      const wrong: string[] = [];
      if (!opening.includes(cited)) wrong.push(`${file}: the opening comment lacks ${cited}`);
      if (!/"[^"]{20,}"/.test(opening)) wrong.push(`${file}: the opening comment quotes no rule`);
      return wrong;
    }),
  stale: () =>
    Object.keys(CITATIONS)
      .filter((file) => !sources().includes(file))
      .map((file) => `${file}: in the table, not in src`),
  undocumented: () =>
    sources().flatMap((file) => {
      const source = readFileSync(new URL(file, SRC), "utf8");
      // A function is documented when a doc comment ends on the line above it.
      return [...source.matchAll(/([^\n]*)\n\s*((?:export )?(?:async )?function \w+)/g)]
        .filter(([, before]) => !/\*\/$/.test(before?.trim() ?? ""))
        .map(([, , declaration]) => `${file}: ${declaration}`);
    }),
};
