// The parents a reply or forward is bound to (form 01a18fda, Tests): "Parents
// (`fixtures/parents/*.json`), each from the RFC 5322 Appendix A text, its body's paragraphs
// (split at empty lines) as `{ p }` blocks with their lines joined by `{ br }`."
import { readFileSync } from "node:fs";
import { parentSchema } from "../../src/message/index.ts";

/** A parent fixture by name, read through parentSchema so its type is the schema's. */
export function parent(name: string) {
  return parentSchema.parse(
    JSON.parse(readFileSync(new URL(`./parents/${name}.json`, import.meta.url), "utf8")),
  );
}
