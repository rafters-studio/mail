import { readFileSync } from "node:fs";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { build } from "esbuild";
import { expect } from "vite-plus/test";
import { z } from "zod";
import { feature, owns } from "./feature.ts";

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

/** The names of a package's run-time dependencies, from its package.json. */
function dependencies(manifest: string): string[] {
  const { dependencies } = z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(new URL(manifest, CORE), "utf8")));
  return Object.keys(dependencies);
}

const NFR001 = await feature("NFR-MAIL-001");

describeFeature(
  NFR001,
  ({ Scenario }) => {
    Scenario(
      "The address part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;

        Given("src/address/index.ts", () => {
          entry = "src/address/index.ts";
        });

        When("esbuild bundles it alone as ESM for a neutral platform, with zod external", () => {
          // expectAlone bundles the entry inside the Then, around its expect lines.
        });

        Then("its inputs include it, and every input is under src/address/ or src/encoding/", () =>
          expectAlone("address", entry),
        );
      },
    );

    Scenario(
      "The message-id part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;

        Given("src/message-id/index.ts", () => {
          entry = "src/message-id/index.ts";
        });

        When("esbuild bundles it alone as ESM for a neutral platform, with zod external", () => {
          // expectAlone bundles the entry inside the Then, around its expect lines.
        });

        Then(
          "its inputs include it, and every input is under src/message-id/ or src/encoding/",
          () => expectAlone("message-id", entry),
        );
      },
    );

    Scenario(
      "The document part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;

        Given("src/document/index.ts", () => {
          entry = "src/document/index.ts";
        });

        When("esbuild bundles it alone as ESM for a neutral platform, with zod external", () => {
          // expectAlone bundles the entry inside the Then, around its expect lines.
        });

        Then("its inputs include it, and every input is under src/document/ or src/encoding/", () =>
          expectAlone("document", entry),
        );
      },
    );

    Scenario(
      "The date part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;

        Given("src/date/format.ts", () => {
          entry = "src/date/format.ts";
        });

        When("esbuild bundles it alone as ESM for a neutral platform, with zod external", () => {
          // expectAlone bundles the entry inside the Then, around its expect lines.
        });

        Then("its inputs include it, and every input is under src/date/ or src/encoding/", () =>
          expectAlone("date", entry),
        );
      },
    );

    Scenario(
      "Core depends on zod alone, so no subpath can load a template plugin",
      ({ Given, When, Then }) => {
        let manifest: string;
        let names: string[];

        Given("packages/core/package.json", () => {
          manifest = "package.json";
        });

        When("its dependencies are read", () => {
          names = dependencies(manifest);
        });

        Then("they are exactly zod", () => {
          expect(names).toEqual(["zod"]);
        });
      },
    );

    Scenario(
      "The receive part bundled alone includes nothing of another part but the UUIDv7 file",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/receive/index.ts", () => {
          entry = "src/receive/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then(
          "its inputs include it, and every input is under src/receive/ or is src/message-id/uuidv7.ts",
          () => {
            expect(files).toContain("src/receive/index.ts");
            for (const file of files) {
              expect(
                file.startsWith("src/receive/") || file === "src/message-id/uuidv7.ts",
                file,
              ).toBe(true);
            }
          },
        );
      },
    );

    Scenario(
      "The masked part bundled alone includes nothing of another part but receive",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/masked/index.ts", () => {
          entry = "src/masked/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then(
          "its inputs include it, and every input is under src/masked/ or is src/receive/recipient.ts",
          () => {
            expect(files).toContain("src/masked/index.ts");
            for (const file of files) {
              expect(
                file.startsWith("src/masked/") || file === "src/receive/recipient.ts",
                file,
              ).toBe(true);
            }
          },
        );
      },
    );

    Scenario(
      "@rafters/mail-cloudflare depends on @rafters/mail and zod alone",
      ({ Given, When, Then }) => {
        let manifest: string;
        let names: string[];

        Given("packages/cloudflare/package.json", () => {
          manifest = "../cloudflare/package.json";
        });

        When("its dependencies are read", () => {
          names = dependencies(manifest);
        });

        Then("they are exactly @rafters/mail and zod", () => {
          expect(names).toEqual(["@rafters/mail", "zod"]);
        });
      },
    );

    Scenario(
      "The read part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/read/index.ts", () => {
          entry = "src/read/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then("its inputs include it, and every input is under src/read/", () => {
          expect(files).toContain("src/read/index.ts");
          for (const file of files) expect(file.startsWith("src/read/"), file).toBe(true);
        });
      },
    );

    Scenario(
      "The imap part bundled alone includes nothing of another part but read",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/imap/index.ts", () => {
          entry = "src/imap/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then("its inputs include it, and every input is under src/imap/ or src/read/", () => {
          expect(files).toContain("src/imap/index.ts");
          for (const file of files) {
            expect(file.startsWith("src/imap/") || file.startsWith("src/read/"), file).toBe(true);
          }
        });
      },
    );

    Scenario(
      "The send part bundled alone includes nothing of another part",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/send/index.ts", () => {
          entry = "src/send/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then("its inputs include it, and every input is under src/send/", () => {
          expect(files).toContain("src/send/index.ts");
          for (const file of files) expect(file.startsWith("src/send/"), file).toBe(true);
        });
      },
    );

    Scenario(
      "@rafters/mail-resend depends on @rafters/mail and zod alone",
      ({ Given, When, Then }) => {
        let manifest: string;
        let names: string[];

        Given("packages/resend/package.json", () => {
          manifest = "../resend/package.json";
        });

        When("its dependencies are read", () => {
          names = dependencies(manifest);
        });

        Then("they are exactly @rafters/mail and zod", () => {
          expect(names).toEqual(["@rafters/mail", "zod"]);
        });
      },
    );

    Scenario(
      "The submit part bundled alone holds only the parts the form names and zod",
      ({ Given, When, Then }) => {
        let entry: string;
        let files: string[];

        Given("src/submit/index.ts", () => {
          entry = "src/submit/index.ts";
        });

        When(
          "esbuild bundles it alone as ESM for a neutral platform, with zod external",
          async () => {
            files = await inputs(entry);
          },
        );

        Then(
          "its inputs include it, and every input is under src/submit/, src/read/, src/message/, src/address/, src/document/, src/encoding/, src/date/ or src/message-id/, or is src/receive/digest.ts, src/receive/recipient.ts or src/send/unsafe.ts",
          () => {
            expect(files).toContain("src/submit/index.ts");
            const parts = /^src\/(submit|read|message|address|document|encoding|date|message-id)\//;
            const single = [
              "src/receive/digest.ts",
              "src/receive/recipient.ts",
              "src/send/unsafe.ts",
            ];
            for (const file of files)
              expect(parts.test(file) || single.includes(file), file).toBe(true);
          },
        );
      },
    );
  },
  owns(
    "NFR-MAIL-001-c1",
    "NFR-MAIL-001-c2",
    "NFR-MAIL-001-c3",
    "NFR-MAIL-001-c4",
    "NFR-MAIL-001-c5",
    "NFR-MAIL-001-c6",
    "NFR-MAIL-001-c7",
    "NFR-MAIL-001-c8",
    "NFR-MAIL-001-c9",
    "NFR-MAIL-001-c10",
    "NFR-MAIL-001-c11",
    "NFR-MAIL-001-c12",
    "NFR-MAIL-001-c13",
  ),
);
