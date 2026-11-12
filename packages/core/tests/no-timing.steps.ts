// No test passes or fails on how long something took (NFR-MAIL-004, research 01a1ae1d): "tests control time and never measure it".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "./feature.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Left out by path: it holds every pattern it looks for. */
const SELF = "packages/core/tests/no-timing.steps.ts";

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

const NFR004 = await feature("NFR-MAIL-004");

describeFeature(
  NFR004,
  ({ Scenario }) => {
    Scenario(
      "No test file reads a measuring clock, subtracts from the wall clock or waits a set time without a marker",
      ({ Given, When, Then }) => {
        let example: string;
        let lines: Record<string, number[]>;
        let found: string[];

        Given(
          "test text held in the check's own test: a line that reads performance.now(), one that subtracts Date.now(), one that calls setTimeout with no marker, one that calls setTimeout marked no-timing: fake timers, one that calls setTimeout marked no-timing: event wait, one that reads performance.now() marked no-timing: recorded, never asserted, one that fires a deadline the test holds, and one that passes a timeout to criterion",
          () => {
            example = [
              "const a = performance.now();",
              "const b = Date.now() - a;",
              "setTimeout(go, 10);",
              "setTimeout(go, 10); // no-timing: fake timers",
              "setTimeout(go, 10); // no-timing: event wait",
              "const c = performance.now(); // no-timing: recorded, never asserted",
              'expire("x");',
              'criterion("X", fn, 60_000);',
            ].join("\n");
          },
        );

        When(
          "the check reads it as a .test.ts file, as a .steps.ts file and as a .workerd.ts file",
          () => {
            // NFR-MAIL-004-c1: a step file and a workerd test file are test files too.
            lines = {};
            for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
              lines[name] = scanTest(`packages/x/tests/${name}`, example).map((f) => f.line);
            }
          },
        );

        Then(
          "each time it names the first four lines by line number, and none of the others",
          () => {
            for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
              expect(lines[name], name).toEqual([1, 2, 3, 4]);
            }
          },
        );

        When(
          "the check reads every git-tracked test file under packages/*/tests/ but its own",
          () => {
            found = named(
              tracked().filter((f) => TESTS.test(f) && f !== SELF),
              scanTest,
            );
          },
        );

        Then("it names no line", () => {
          expect(found).toEqual([]);
        });
      },
    );

    Scenario("A benchmark file records numbers and asserts nothing", ({ Given, When, Then }) => {
      let records: string;
      let first: Finding[];
      let second: number[];
      let found: string[];

      Given(
        "text held in the check's own test as a .bench.ts file: one that reads performance.now() and logs it with a comment saying it asserts nothing, and one that also calls expect",
        () => {
          records =
            "// It asserts nothing.\nconst at = performance.now();\nconsole.log(performance.now() - at);";
        },
      );

      When("the check reads them", () => {
        first = scanTest("packages/x/tests/a.bench.ts", records);
        second = scanTest("packages/x/tests/a.bench.ts", `${records}\nexpect(at).toBe(0);`).map(
          (f) => f.line,
        );
      });

      Then("the first passes, and the second fails naming its expect line", () => {
        expect(first).toEqual([]);
        expect(second).toEqual([4]);
      });

      When("the check reads every git-tracked .bench.ts file under packages/*/tests/", () => {
        found = named(
          tracked().filter((f) => TESTS.test(f) && f.endsWith(".bench.ts")),
          scanTest,
        );
      });

      Then("it names no line", () => {
        expect(found).toEqual([]);
      });
    });

    Scenario("workerd's unsafe module stays in tests", ({ Given, When, Then }) => {
      let cases: [string, string][];
      let each: Finding[][];
      let found: string[];

      Given(
        "text held in the check's own test: a source file that imports workerd:unsafe, one that builds the specifier from workerd and unsafe on one line, one that names workerd:unsafe only in a comment, and a wrangler.jsonc outside packages/*/tests/ that names unsafe_module",
        () => {
          cases = [
            ["packages/x/src/a.ts", 'await import("workerd:unsafe");'],
            ["packages/x/src/a.ts", 'const s = ["workerd", "unsafe"].join(":");'],
            ["packages/x/src/a.ts", "// workerd:unsafe is not imported here"],
            ["examples/x/wrangler.jsonc", '{ "compatibility_flags": ["unsafe_module"] }'],
          ];
        },
      );

      When("the check reads them", () => {
        each = cases.map(([file, text]) => scanUnsafe(file, text));
      });

      Then("it names the first, the second and the fourth, and not the third", () => {
        expect(each[0]).toHaveLength(1);
        expect(each[1]).toHaveLength(1);
        expect(each[2]).toEqual([]);
        expect(each[3]).toHaveLength(1);
      });

      When("the check reads the repository's git-tracked files", () => {
        const files = tracked().filter(
          (f) => SOURCE.test(f) || (CONFIG.test(f) && !IN_TESTS.test(f)),
        );
        found = named(files, scanUnsafe);
      });

      Then("it names none", () => {
        expect(found).toEqual([]);
      });
    });

    Scenario("No test file uses fake timers", ({ Given, When, Then }) => {
      let example: string;
      let lines: Record<string, number[]>;
      let found: string[];

      Given(
        "test text held in the check's own test: a line that calls vi.useFakeTimers, one that calls vi.setSystemTime, one that calls vi.advanceTimersByTimeAsync and one that enables mock.timers from node:test, each marked no-timing: hang guard, and one that advances a manual clock the test owns",
        () => {
          example = [
            "vi.useFakeTimers(); // no-timing: hang guard",
            "vi.setSystemTime(0); // no-timing: hang guard",
            "await vi.advanceTimersByTimeAsync(10); // no-timing: hang guard",
            "mock.timers.enable(); // no-timing: hang guard",
            "clock.advance(10);",
          ].join("\n");
        },
      );

      When(
        "the check reads it as a .test.ts file, as a .steps.ts file and as a .workerd.ts file",
        () => {
          lines = {};
          for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
            lines[name] = scanFake(`packages/x/tests/${name}`, example).map((f) => f.line);
          }
        },
      );

      Then(
        "each time it names the first four lines by line number, marker or not, and not the fifth",
        () => {
          for (const name of ["a.test.ts", "a.steps.ts", "a.workerd.ts"]) {
            expect(lines[name], name).toEqual([1, 2, 3, 4]);
          }
        },
      );

      When(
        "the check reads every git-tracked test file under packages/*/tests/ but its own",
        () => {
          found = named(
            tracked().filter((f) => TESTS.test(f) && f !== SELF),
            scanFake,
          );
        },
      );

      Then("it names no line", () => {
        expect(found).toEqual([]);
      });
    });
  },
  owns("NFR-MAIL-004-c1", "NFR-MAIL-004-c2", "NFR-MAIL-004-c3", "NFR-MAIL-004-c5"),
);
