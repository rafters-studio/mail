// Writes mail's requirements' scenarios to features/<id>.feature with toolchain features (NFR-MAIL-002).
//   node scripts/features.mjs <id> ...   writes those requirements' features at their current revision
//   node scripts/features.mjs            rewrites every feature in features/ that features/pending.json does not hold
//   node scripts/features.mjs --check    exits 1, naming each feature that differs from what toolchain writes now, and
//                                        each one pending.json holds whose header names another revision
// It reads the legion store through toolchain, so it runs where legion runs, never in CI.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FEATURES = new URL("../features/", import.meta.url).pathname;
const TOOLCHAIN = new URL("../node_modules/.bin/toolchain", import.meta.url).pathname;
const PENDING = join(FEATURES, "pending.json");
mkdirSync(FEATURES, { recursive: true });
const pending = existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, "utf8")) : {};
const present = readdirSync(FEATURES)
  .filter((f) => f.endsWith(".feature"))
  .map((f) => f.slice(0, -".feature".length));
const write = (id, path) => execFileSync(TOOLCHAIN, ["features", id, path], { stdio: "inherit" });

const args = process.argv.slice(2);
if (args[0] === "--check") {
  const scratch = mkdtempSync(join(tmpdir(), "mail-features-"));
  const named = [];
  for (const id of present) {
    const text = readFileSync(join(FEATURES, `${id}.feature`), "utf8");
    const held = pending[id];
    if (held !== undefined) {
      const header = `# Generated from legion requirement ${id}, revision ${held.revision}.\n`;
      if (!text.startsWith(header))
        named.push(`${id}: pending.json holds revision ${held.revision}`);
      continue;
    }
    write(id, join(scratch, `${id}.feature`));
    if (readFileSync(join(scratch, `${id}.feature`), "utf8") !== text)
      named.push(`${id}: not its current revision`);
  }
  for (const id of Object.keys(pending))
    if (!present.includes(id)) named.push(`${id}: in pending.json, with no feature`);
  for (const line of named) console.error(line);
  console.log(
    `${present.length} features, ${Object.keys(pending).length} pending, ${named.length} named`,
  );
  process.exitCode = named.length === 0 ? 0 : 1;
} else {
  for (const id of args.length > 0 ? args : present.filter((id) => pending[id] === undefined)) {
    write(id, join(FEATURES, `${id}.feature`));
  }
}
