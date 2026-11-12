// The code teaches how email works (NFR-MAIL-003): packages/cloudflare's citations and its own check, which packages/core/tests/teaching.steps.ts runs.
import { readdirSync, readFileSync } from "node:fs";
import type { Teaching } from "../../core/tests/teaching.ts";

const ROOT = new URL("../", import.meta.url);

// The citation the form's file table gives each file (forms 01a19a5c, 01a19d25, 01a19daa and 01a19de8, Where the code lives).
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
  "src/octets.ts": "form 01a19daa",
  "src/imap-objects.ts": "Cloudflare Durable Objects hibernation docs",
  "src/imap-worker.ts": "Cloudflare WebSockets docs",
  "src/submit-object.ts": "Cloudflare Durable Objects hibernation docs",
  "migrations/0004_sent.sql": "RFC 6409 8",
};

/** The files of one folder with one extension, as paths from the package root. */
function files(folder: string, extension: string): string[] {
  return readdirSync(new URL(folder, ROOT), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(extension))
    .map((f) => `${folder}/${f}`);
}

/** Each file the check reads, with the pattern of its opening comment and the joint between its lines. */
function read(): [string, RegExp, RegExp][] {
  return [
    ...files("src", ".ts").map((f): [string, RegExp, RegExp] => [f, /^(\/\/.*\n)+/, /\n\/\/ ?/g]),
    ...files("migrations", ".sql").map((f): [string, RegExp, RegExp] => [
      f,
      /^(--.*\n)+/,
      /\n-- ?/g,
    ]),
  ];
}

/** packages/cloudflare's teaching check, as its teaching.test.ts ran it. */
export const teaching: Teaching = {
  name: "cloudflare",
  openings: () =>
    read().flatMap(([file, opening, joint]) => {
      const source = readFileSync(new URL(file, ROOT), "utf8");
      const text = (source.match(opening)?.[0] ?? "").replace(joint, " ");
      const cited = CITATIONS[file];
      if (cited === undefined) return [`${file}: not in the table`];
      const wrong: string[] = [];
      if (!text.includes(cited)) wrong.push(`${file}: the opening comment lacks ${cited}`);
      if (!/"[^"]{20,}"/.test(text)) wrong.push(`${file}: the opening comment quotes no rule`);
      return wrong;
    }),
  stale: () => {
    const present = read().map(([file]) => file);
    return Object.keys(CITATIONS)
      .filter((file) => !present.includes(file))
      .map((file) => `${file}: in the table, not in the package`);
  },
  undocumented: () =>
    files("src", ".ts").flatMap((file) => {
      const source = readFileSync(new URL(file, ROOT), "utf8");
      // A function is documented when a doc comment ends on the line above it.
      return [...source.matchAll(/([^\n]*)\n\s*((?:export )?(?:async )?function \w+)/g)]
        .filter(([, before]) => !(before?.trim() ?? "").endsWith("*/"))
        .map(([, , declaration]) => `${file}: ${declaration}`);
    }),
};
