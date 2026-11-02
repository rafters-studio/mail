import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { expect } from "vitest";
import { z } from "zod";
import { criterion } from "./criterion.ts";

const CORE = new URL("..", import.meta.url);

/** The source files under src/ that one entry pulls in when esbuild bundles it alone. */
async function inputs(entry: string): Promise<string[]> {
  const result = await build({
    absWorkingDir: CORE.pathname,
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    metafile: true,
    write: false,
    external: ["zod"],
  });
  return Object.keys(result.metafile.inputs);
}

/** Fails when the folder's entry, bundled alone, includes a file outside its folder and encoding. */
async function expectAlone(folder: string, entry: string): Promise<void> {
  const files = await inputs(entry);
  expect(files).toContain(entry);
  for (const file of files) {
    expect(file.startsWith(`src/${folder}/`) || file.startsWith("src/encoding/"), file).toBe(true);
  }
}

criterion("NFR-MAIL-001-c1", () => expectAlone("address", "src/address/index.ts"));
criterion("NFR-MAIL-001-c2", () => expectAlone("message-id", "src/message-id/index.ts"));
criterion("NFR-MAIL-001-c3", () => expectAlone("document", "src/document/index.ts"));
criterion("NFR-MAIL-001-c4", () => expectAlone("date", "src/date/format.ts"));

criterion("NFR-MAIL-001-c6", async () => {
  const files = await inputs("src/receive/index.ts");
  expect(files).toContain("src/receive/index.ts");
  for (const file of files) {
    expect(file.startsWith("src/receive/") || file === "src/message-id/uuidv7.ts", file).toBe(true);
  }
});

criterion("NFR-MAIL-001-c5", () => {
  const manifest = z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(new URL("package.json", CORE), "utf8")));
  expect(Object.keys(manifest.dependencies)).toEqual(["zod"]);
});

criterion("NFR-MAIL-001-c8", () => {
  const manifest = z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(new URL("../cloudflare/package.json", CORE), "utf8")));
  expect(Object.keys(manifest.dependencies)).toEqual(["@rafters/mail"]);
});
