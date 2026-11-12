// The code teaches how email works (NFR-MAIL-003): "Every source file SHALL begin with a comment naming its concept, the RFC section (or research) it implements, and that section's governing rule in one quoted sentence".
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { teaching as cloudflare } from "../../cloudflare/tests/citations.ts";
import { teaching as resend } from "../../resend/tests/citations.ts";
import { teaching as core } from "./citations.ts";
import { feature, owns } from "./feature.ts";
import type { Teaching } from "./teaching.ts";

/** Every package the teaching step lists. A later package adds its citations.ts here. */
const PACKAGES: Teaching[] = [core, cloudflare, resend];

/** Each package's lines from one of its checks, prefixed with the package's name. */
const named = (packages: Teaching[], check: (t: Teaching) => string[]): string[] =>
  packages.flatMap((t) => check(t).map((line) => `${t.name}: ${line}`));

const NFR003 = await feature("NFR-MAIL-003");

describeFeature(
  NFR003,
  ({ Scenario }) => {
    Scenario(
      "Every source file begins with its concept, the citation the form gives it, and a quoted rule",
      ({ Given, When, Then, And }) => {
        let packages: Teaching[];
        let openings: string[];

        Given(
          "the source files of every package the teaching step lists, packages/core/src, packages/cloudflare/src, packages/cloudflare/migrations and packages/resend/src among them, and the citation its package's table gives each",
          () => {
            packages = PACKAGES;
            expect(packages.map((t) => t.name)).toEqual(
              expect.arrayContaining(["core", "cloudflare", "resend"]),
            );
          },
        );

        When("the teaching step reads each file's opening comment", () => {
          openings = named(packages, (t) => t.openings());
        });

        Then(
          "each file is in its package's table, and its opening comment holds that citation and a double-quoted sentence of at least 20 characters",
          () => {
            expect(openings).toEqual([]);
          },
        );

        And("every table but packages/core's names no file its package does not have", () => {
          expect(named(packages, (t) => t.stale())).toEqual([]);
        });
      },
    );

    Scenario(
      "Every function has a doc comment saying the rule it carries out",
      ({ Given, When, Then }) => {
        let packages: Teaching[];
        let undocumented: string[];

        Given("the source files of every package the teaching step lists", () => {
          packages = PACKAGES;
        });

        When(
          "the teaching step finds each function declaration, as its package's own pattern finds them",
          () => {
            undocumented = named(packages, (t) => t.undocumented());
          },
        );

        Then("a doc comment ends on the line above each", () => {
          expect(undocumented).toEqual([]);
        });
      },
    );
  },
  owns("NFR-MAIL-003-c1", "NFR-MAIL-003-c2"),
);
