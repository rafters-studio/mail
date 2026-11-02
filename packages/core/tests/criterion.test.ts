// Every test file of the writer and of the Cloudflare adapter declares its tests through
// criterion(), never through a bare it, test or describe, and criterion() refuses an id the spec
// lacks (NFR-MAIL-002): "No test SHALL exist without a criterion behind it."
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { criterion } from "./criterion.ts";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
const CLOUDFLARE_TESTS = fileURLToPath(new URL("../../cloudflare/tests/", import.meta.url));

/** The test files under one folder, as full paths. */
function testFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join(folder, f));
}

criterion("NFR-MAIL-002-c1", () => {
  const files = [...testFiles(TESTS), ...testFiles(CLOUDFLARE_TESTS)];
  expect(files).toContain(join(TESTS, "criterion.test.ts"));
  expect(files).toContain(join(CLOUDFLARE_TESTS, "worker.test.ts"));
  for (const f of files) {
    const source = readFileSync(f, "utf8");
    expect(source, f).not.toMatch(/(?<![.\w])(it|test|describe)(\.\w+)*\(/);
    expect(source, f).toMatch(/\bcriterion\("/);
  }
  expect(() => criterion("FR-MAIL-999-c1", () => undefined)).toThrow(
    "FR-MAIL-999-c1 is not a criterion of the spec",
  );
});
