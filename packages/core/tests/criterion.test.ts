import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { criterion } from "./criterion.ts";

const TESTS = fileURLToPath(new URL(".", import.meta.url));

// The 0.1.0 tests, from before the writer; the issues that replace packages/core remove them.
const BEFORE_THE_WRITER = new Set([
  "auth.test.ts",
  "interfaces/blob-storage.test.ts",
  "interfaces/classifier.test.ts",
  "interfaces/email-provider.test.ts",
  "interfaces/inbound-adapter.test.ts",
  "interfaces/services.test.ts",
  "migrations.test.ts",
  "schema/enums.test.ts",
  "schema/templates.test.ts",
  "schema/validators.test.ts",
  "threading.test.ts",
]);

criterion("NFR-MAIL-002-c1", () => {
  const files = readdirSync(TESTS, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => relative(TESTS, join(TESTS, f)))
    .filter((f) => !BEFORE_THE_WRITER.has(f));
  expect(files).toContain("criterion.test.ts");
  for (const f of files) {
    const source = readFileSync(join(TESTS, f), "utf8");
    expect(source, f).not.toMatch(/\b(it|test|describe)(\.\w+)*\(/);
    expect(source, f).toMatch(/\bcriterion\("/);
  }
  expect(() => criterion("FR-MAIL-999-c1", () => undefined)).toThrow(
    "FR-MAIL-999-c1 is not a criterion of the spec",
  );
});
