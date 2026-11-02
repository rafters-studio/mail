// The parents a reply or forward is bound to (form 01a18fda, Tests): "Parents
// (`fixtures/parents/*.json`), each from the RFC 5322 Appendix A text, its body's paragraphs
// (split at empty lines) as `{ p }` blocks with their lines joined by `{ br }`." In JSON,
// `{ "$bytes": base64 }` is revived to a Uint8Array.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parentSchema } from "../../src/message/index.ts";

const bytesSchema = z.strictObject({ $bytes: z.base64() });

/** Form 01a18fda, Tests: a `{ "$bytes": base64 }` node as its bytes, any other node as it is. */
function revive(_key: string, node: unknown): unknown {
  const bytes = bytesSchema.safeParse(node);
  return bytes.success ? new Uint8Array(Buffer.from(bytes.data.$bytes, "base64")) : node;
}

/** A parent fixture by name, read through parentSchema so its type is the schema's. */
export function parent(name: string) {
  return parentSchema.parse(
    JSON.parse(readFileSync(new URL(`./parents/${name}.json`, import.meta.url), "utf8"), revive),
  );
}
