// Every test file of the writer declares its tests through criterion(), never through a bare
// it, test or describe, and criterion() refuses an id the spec lacks (NFR-MAIL-002): "No test
// SHALL exist without a criterion behind it."
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { criterion } from "./criterion.ts";

const TESTS = fileURLToPath(new URL(".", import.meta.url));

criterion("NFR-MAIL-002-c1", () => {
  const files = readdirSync(TESTS, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".test.ts"),
  );
  expect(files).toContain("criterion.test.ts");
  for (const f of files) {
    const source = readFileSync(join(TESTS, f), "utf8");
    expect(source, f).not.toMatch(/(?<![.\w])(it|test|describe)(\.\w+)*\(/);
    expect(source, f).toMatch(/\bcriterion\("/);
  }
  expect(() => criterion("FR-MAIL-999-c1", () => undefined)).toThrow(
    "FR-MAIL-999-c1 is not a criterion of the spec",
  );
});
