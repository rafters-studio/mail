// No test passes or fails on how long something took (NFR-MAIL-004, research 01a1ae1d): "tests control time and never measure it".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vite-plus/test";
import { criterion } from "./criterion.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Left out by path: it holds every pattern it looks for. */
const SELF = "packages/core/tests/no-timing.test.ts";

/** Reads of a measuring clock, arithmetic on the wall clock, and waits of a set time. */
const TIMING: RegExp[] = [
  /performance\.now\(/,
  /process\.hrtime/,
  /perf_counter(_ns)?\(/,
  /time\.monotonic(_ns)?\(/,
  /\btime_ns\(/,
  /datetime\.now\(/,
  /(Date\.now\(\)|time\.time\(\)|new Date\(\))\s*-|-\s*(Date\.now\(\)|time\.time\(\)|new Date\(\))/,
  /\bsetTimeout\(/,
  /\bsetInterval\(/,
  /AbortSignal\.timeout\(/,
  /scheduler\.wait\(/,
  /timers\/promises/,
  /time\.sleep\(/,
  /asyncio\.sleep\(/,
  /threading\.Timer\(/,
  /vi\.waitFor\(/,
  /vi\.waitUntil\(/,
];
/** NFR-MAIL-004-c5: fake timers, and anything else that patches the runtime's clock. */
const FAKE =
  /\bvi\.(useFakeTimers|useRealTimers|setSystemTime|advanceTimers\w*|runAllTimers\w*|runOnlyPendingTimers\w*|getTimerCount|getMockedSystemTime|isFakeTimers)\b|\bmock\.timers\b|\bfreezegun\b|\btime_machine\b/;
/** The three reasons a line may read a clock or wait, and no other (NFR-MAIL-004). */
const REASONS = ["hang guard", "event wait", "recorded, never asserted"];
const ASSERTS = /\bcriterion\(|\bexpect\(|\bassert\b/;
const TESTS = /^packages\/[^/]+\/tests\/.+\.(ts|tsx|mts|js|mjs|cjs|jsx|py)$/;
const IN_TESTS = /^packages\/[^/]+\/tests\//;
const SOURCE = /^packages\/[^/]+\/src\//;
const CONFIG = /(^|\/)wrangler\.(jsonc|json|toml)$/;

type Finding = { line: number; why: string };

/** Each line's code with its comments blanked, so a line number stays a line number. */
function code(text: string, hash: boolean): string[] {
  const out: string[] = [];
  let block = false;
  for (const line of text.split("\n")) {
    let kept = "";
    for (let i = 0; i < line.length; i += 1) {
      if (block) {
        if (line.startsWith("*/", i)) {
          block = false;
          i += 1;
        }
        continue;
      }
      if (!hash && line.startsWith("/*", i)) {
        block = true;
        i += 1;
        continue;
      }
      if ((!hash && line.startsWith("//", i)) || (hash && line[i] === "#")) break;
      kept += line[i];
    }
    out.push(kept);
  }
  return out;
}

/** NFR-MAIL-004-c1 for a test file, and -c2 for a benchmark: the lines it names. */
function scanTest(file: string, text: string): Finding[] {
  const raw = text.split("\n");
  const kept = code(text, file.endsWith(".py"));
  const found: Finding[] = [];
  raw.forEach((whole, i) => {
    const line = kept[i] ?? "";
    if (file.endsWith(".bench.ts")) {
      if (ASSERTS.test(line)) found.push({ line: i + 1, why: "a benchmark asserts" });
      return;
    }
    const reason = /no-timing:\s*(.*)$/.exec(whole)?.[1]?.trim();
    if (reason !== undefined && !REASONS.some((r) => reason.startsWith(r))) {
      found.push({ line: i + 1, why: `"${reason}" is not a listed reason` });
    } else if (reason === undefined && TIMING.some((pattern) => pattern.test(line))) {
      found.push({ line: i + 1, why: "reads a clock or waits a set time" });
    }
  });
  return found;
}

/** NFR-MAIL-004-c5 for any test file: each line whose code fakes the clock, whatever its marker. */
function scanFake(file: string, text: string): Finding[] {
  return code(text, file.endsWith(".py")).flatMap((line, i) =>
    FAKE.test(line) ? [{ line: i + 1, why: "fakes the clock" }] : [],
  );
}

/** NFR-MAIL-004-c3 for a source file or a wrangler configuration outside tests: the lines it names. */
function scanUnsafe(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  code(text, file.endsWith(".toml")).forEach((line, i) => {
    const source = SOURCE.test(file) && line.includes("workerd") && line.includes("unsafe");
    if (line.includes("unsafe_module") || source)
      found.push({ line: i + 1, why: "reaches workerd's unsafe module" });
  });
  return found;
}

const tracked = (): string[] =>
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "");
const read = (file: string): string => readFileSync(`${ROOT}${file}`, "utf8");
const named = (files: string[], scan: (file: string, text: string) => Finding[]): string[] =>
  files.flatMap((file) => scan(file, read(file)).map(({ line, why }) => `${file}:${line}: ${why}`));

criterion("NFR-MAIL-004-c1", () => {
  const example = [
    "const a = performance.now();",
    "const b = Date.now() - a;",
    "setTimeout(go, 10);",
    "setTimeout(go, 10); // no-timing: fake timers",
    "setTimeout(go, 10); // no-timing: event wait",
    "const c = performance.now(); // no-timing: recorded, never asserted",
    'expire("x");',
    'criterion("X", fn, 60_000);',
  ].join("\n");
  // NFR-MAIL-004-c1: a step file and a workerd test file are test files too.
  for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
    expect(
      scanTest(`packages/x/tests/${name}`, example).map((f) => f.line),
      name,
    ).toEqual([1, 2, 3, 4]);
  }
  expect(
    named(
      tracked().filter((f) => TESTS.test(f) && f !== SELF),
      scanTest,
    ),
  ).toEqual([]);
});

criterion("NFR-MAIL-004-c2", () => {
  const records =
    "// It asserts nothing.\nconst at = performance.now();\nconsole.log(performance.now() - at);";
  expect(scanTest("packages/x/tests/a.bench.ts", records)).toEqual([]);
  expect(
    scanTest("packages/x/tests/a.bench.ts", `${records}\nexpect(at).toBe(0);`).map((f) => f.line),
  ).toEqual([4]);
  expect(
    named(
      tracked().filter((f) => TESTS.test(f) && f.endsWith(".bench.ts")),
      scanTest,
    ),
  ).toEqual([]);
});

criterion("NFR-MAIL-004-c5", () => {
  const example = [
    "vi.useFakeTimers(); // no-timing: hang guard",
    "vi.setSystemTime(0); // no-timing: hang guard",
    "await vi.advanceTimersByTimeAsync(10); // no-timing: hang guard",
    "mock.timers.enable(); // no-timing: hang guard",
    "clock.advance(10);",
  ].join("\n");
  for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
    expect(
      scanFake(`packages/x/tests/${name}`, example).map((f) => f.line),
      name,
    ).toEqual([1, 2, 3, 4]);
  }
  expect(
    named(
      tracked().filter((f) => TESTS.test(f) && f !== SELF),
      scanFake,
    ),
  ).toEqual([]);
});

criterion("NFR-MAIL-004-c3", () => {
  expect(scanUnsafe("packages/x/src/a.ts", 'await import("workerd:unsafe");')).toHaveLength(1);
  expect(
    scanUnsafe("packages/x/src/a.ts", 'const s = ["workerd", "unsafe"].join(":");'),
  ).toHaveLength(1);
  expect(scanUnsafe("packages/x/src/a.ts", "// workerd:unsafe is not imported here")).toEqual([]);
  expect(
    scanUnsafe("examples/x/wrangler.jsonc", '{ "compatibility_flags": ["unsafe_module"] }'),
  ).toHaveLength(1);
  const files = tracked().filter((f) => SOURCE.test(f) || (CONFIG.test(f) && !IN_TESTS.test(f)));
  expect(named(files, scanUnsafe)).toEqual([]);
});
