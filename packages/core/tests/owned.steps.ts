// The guard (NFR-MAIL-002, research 01a1b3ec): "a new tagged scenario and a new untagged one passed silently; a guard over tags and owning files catches both".
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "./feature.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Left out of the scan for bare tests by path: its own cases spell one. */
const SELF = "packages/core/tests/owned.steps.ts";
const FEATURE = /^features\/([^/]+)\.feature$/;
const STEPS = /^packages\/[^/]+\/tests\/.+\.(steps|workerd)\.ts$/;
const TEST = /^packages\/[^/]+\/tests\/.+\.test\.ts$/;
const RUST = /^bridge\/src\/.+\.rs$/;
const BARE = /(?<![.\w])(it|test|describe)(\.\w+)*\(/;

const OWNS = "owns";
const IT = "it";

/** Each requirement held at an older revision: that revision, the issue that regenerates it, and the requirement that issue builds. */
type Pending = Record<string, { revision: string; issue: number; with: string }>;

/** True when every ( and [ in the text closes in order: vitest-cucumber compiles a step's text into a RegExp. */
function balanced(text: string): boolean {
  const open: string[] = [];
  for (const c of text) {
    if (c === "(" || c === "[") open.push(c);
    else if (c === ")" || c === "]") {
      if (open.pop() !== (c === ")" ? "(" : "[")) return false;
    }
  }
  return open.length === 0;
}

/** What the guard names in these files, each as one line saying what is wrong and where. */
function guard(files: Record<string, string>, pending: Pending): string[] {
  const found: string[] = [];
  const tagged = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) {
    const id = FEATURE.exec(path)?.[1];
    if (id === undefined) continue;
    const revision = /^# Generated from legion requirement \S+, revision (\S+)\.$/m.exec(text)?.[1];
    const held = pending[id];
    if (held !== undefined && revision !== held.revision) {
      found.push(`${path}: pending.json holds revision ${held.revision}, the header ${revision}`);
    }
    if (held !== undefined && files[`features/${held.with}.feature`] !== undefined) {
      found.push(
        `${path}: still pending, though #${held.issue} has landed features/${held.with}.feature`,
      );
    }
    for (const block of text.split(/\n\s*\n/)) {
      const title = /^\s*Scenario(?: Outline)?: (.*)$/m.exec(block)?.[1];
      if (title === undefined) continue;
      const steps = [...block.matchAll(/^\s*(?:Given|When|Then|And|But) (.*)$/gm)].map(
        (m) => m[1] ?? "",
      );
      for (const step of steps)
        if (!balanced(step))
          found.push(`${path}: "${title}" has a step with an unbalanced bracket: ${step}`);
      for (const step of steps.filter((s, i) => steps.indexOf(s) !== i))
        found.push(`${path}: "${title}" says a step twice: ${step}`);
      const tags = [...block.matchAll(/@criterion-(\S+)/g)].map((m) => m[1] ?? "");
      if (tags.length === 1) tagged.set(tags[0] ?? "", path);
      else found.push(`${path}: "${title}" has ${tags.length} criterion tags`);
    }
  }
  const owners = new Map<string, string[]>();
  const own = (id: string, path: string): void => {
    owners.set(id, [...(owners.get(id) ?? []), path]);
  };
  for (const [path, text] of Object.entries(files)) {
    if (TEST.test(path)) found.push(`${path}: a .test.ts file`);
    if (STEPS.test(path)) {
      for (const call of text.matchAll(/\bowns\(([^)]*)\)/g)) {
        for (const id of (call[1] ?? "").matchAll(/"([^"]+)"/g)) own(id[1] ?? "", path);
      }
      text.split("\n").forEach((line, i) => {
        if (path !== SELF && BARE.test(line))
          found.push(`${path}:${i + 1}: a test declared with it, test or describe`);
      });
    }
    if (RUST.test(path)) {
      for (const m of text.matchAll(/\bfn (fr|nfr)_mail_(\d{3})_c(\d+)\b/g)) {
        own(`${(m[1] ?? "").toUpperCase()}-MAIL-${m[2]}-c${m[3]}`, path);
      }
    }
  }
  for (const [id, path] of tagged) {
    const by = owners.get(id) ?? [];
    if (by.length !== 1)
      found.push(
        `${path}: @criterion-${id} is owned by ${by.length === 0 ? "no test" : by.join(" and ")}`,
      );
  }
  for (const [id, by] of owners) {
    if (!tagged.has(id)) found.push(`${by.join(" and ")}: owns ${id}, which no feature tags`);
  }
  return found;
}

/** The repository's features, step files and Rust sources: those git tracks, and new ones not yet added. */
function repository(): Record<string, string> {
  const args = ["ls-files", "--cached", "--others", "--exclude-standard"];
  const listed = execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n");
  const kept = listed.filter(
    (f) => FEATURE.test(f) || STEPS.test(f) || TEST.test(f) || RUST.test(f),
  );
  return Object.fromEntries(kept.map((f) => [f, readFileSync(`${ROOT}${f}`, "utf8")]));
}

/** features/pending.json: each requirement held at an older revision, and the issue that regenerates it. */
function pendingList(): Pending {
  const path = `${ROOT}features/pending.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

const NFR002 = await feature("NFR-MAIL-002");

describeFeature(
  NFR002,
  ({ Scenario }) => {
    Scenario(
      "Every scenario is owned by exactly one test, and no test is declared another way",
      ({ Given, When, Then }) => {
        let cases: Record<string, string>;
        let found: string[];

        Given(
          "text held in the guard's own test: a feature with a scenario that has no criterion tag, one with two criterion tags, one whose tag no test owns, one whose tag two step files own, one whose tag a Rust test named for it owns, one with a step holding an unbalanced parenthesis, and one that says a step twice; a step file owning an id no feature tags; a feature that features/pending.json lists whose header names another revision, and one whose regenerating issue's own requirement has a feature; a file under packages/x/tests/ named a.test.ts; and a step file that declares a bare it test",
          () => {
            cases = {
              "features/FR-MAIL-999.feature": [
                "# Generated from legion requirement FR-MAIL-999, revision r2.",
                "",
                "Feature: cases",
                "",
                "  Scenario: Untagged",
                "    Given a",
                "",
                "  @criterion-FR-MAIL-999-c1",
                "  @criterion-FR-MAIL-999-c9",
                "  Scenario: Twice tagged",
                "    Given a",
                "",
                "  @criterion-FR-MAIL-999-c2",
                "  Scenario: Unowned",
                "    Given a",
                "",
                "  @criterion-FR-MAIL-999-c3",
                "  Scenario: Twice owned",
                "    Given a",
                "",
                "  @criterion-FR-MAIL-999-c4",
                "  Scenario: Owned in Rust",
                "    Given a",
                "",
                "  @criterion-FR-MAIL-999-c6",
                "  Scenario: Unbalanced",
                "    Given a call of f(",
                "",
                "  @criterion-FR-MAIL-999-c7",
                "  Scenario: Twice",
                "    Given a",
                "    When b",
                "    Given c",
                "    When b",
                "",
              ].join("\n"),
              "features/FR-MAIL-998.feature":
                "# Generated from legion requirement FR-MAIL-998, revision r1.\n\nFeature: old\n",
              "features/FR-MAIL-997.feature":
                "# Generated from legion requirement FR-MAIL-997, revision r9.\n\nFeature: built\n",
              // Spelled in parts, so the guard reading this file does not take them for its own calls.
              "packages/x/tests/a.steps.ts": `describeFeature(f, () => {}, ${OWNS}("FR-MAIL-999-c3", "FR-MAIL-999-c5", "FR-MAIL-999-c6", "FR-MAIL-999-c7"));\n${IT}("bare", () => {});\n`,
              "packages/x/tests/workerd/b.workerd.ts": `describeFeature(f, () => {}, ${OWNS}("FR-MAIL-999-c3"));\n`,
              "packages/x/tests/a.test.ts": "",
              "bridge/src/main.rs": "    #[test]\n    fn fr_mail_999_c4() {}\n",
            };
          },
        );

        When("the guard reads them", () => {
          found = guard(cases, {
            "FR-MAIL-999": { revision: "r1", issue: 1, with: "FR-MAIL-996" },
            "FR-MAIL-998": { revision: "r1", issue: 2, with: "FR-MAIL-997" },
          });
        });

        Then(
          "it names the untagged scenario, the twice-tagged one, the unowned tag, the twice-owned tag, the unbalanced step, the repeated step, the stray id, both pending features, the .test.ts file and the bare it test, and not the tag the Rust test owns",
          () => {
            expect(found).toEqual([
              "features/FR-MAIL-999.feature: pending.json holds revision r1, the header r2",
              'features/FR-MAIL-999.feature: "Untagged" has 0 criterion tags',
              'features/FR-MAIL-999.feature: "Twice tagged" has 2 criterion tags',
              'features/FR-MAIL-999.feature: "Unbalanced" has a step with an unbalanced bracket: a call of f(',
              'features/FR-MAIL-999.feature: "Twice" says a step twice: b',
              "features/FR-MAIL-998.feature: still pending, though #2 has landed features/FR-MAIL-997.feature",
              "packages/x/tests/a.steps.ts:2: a test declared with it, test or describe",
              "packages/x/tests/a.test.ts: a .test.ts file",
              "features/FR-MAIL-999.feature: @criterion-FR-MAIL-999-c2 is owned by no test",
              "features/FR-MAIL-999.feature: @criterion-FR-MAIL-999-c3 is owned by packages/x/tests/a.steps.ts and packages/x/tests/workerd/b.workerd.ts",
              "packages/x/tests/a.steps.ts: owns FR-MAIL-999-c5, which no feature tags",
            ]);
          },
        );

        When(
          "the guard reads features/, features/pending.json, every .steps.ts and .workerd.ts file under packages/*/tests/, and bridge/src",
          () => {
            found = guard(repository(), pendingList());
          },
        );

        Then(
          "it names nothing, and neither packages/core/tests/criteria.json nor packages/core/tests/criterion.ts exists",
          () => {
            expect(found).toEqual([]);
            expect(existsSync(`${ROOT}packages/core/tests/criteria.json`)).toBe(false);
            expect(existsSync(`${ROOT}packages/core/tests/criterion.ts`)).toBe(false);
          },
        );
      },
    );
  },
  owns("NFR-MAIL-002-c1"),
);
