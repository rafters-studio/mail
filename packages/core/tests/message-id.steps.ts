import { describeFeature } from "@amiceli/vitest-cucumber";
import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vite-plus/test";
import { createMail } from "../src/message/index.ts";
import { writeCase } from "./cases.ts";
import { feature, owns } from "./feature.ts";
import { run } from "./fixtures/write/plain.ts";

const FR009 = await feature("FR-MAIL-009");

describeFeature(
  FR009,
  ({ Scenario }) => {
    Scenario(
      "Ten thousand messages from one mail have ten thousand different Message-IDs at its domain",
      ({ Given, When, Then }) => {
        let mail: ReturnType<typeof createMail>;
        let ids: string[];

        Given("a mail for rafters.studio with the real entropy and clock", () => {
          // The real entropy and clock, so these bytes are not the golden's; uniqueness is the point.
          mail = createMail({ domain: "rafters.studio" });
        });

        When("it writes the plain case ten thousand times", () => {
          ids = Array.from({ length: 10_000 }, () => run(mail).messageId);
        });

        Then(
          'all ten thousand Message-IDs are different and each ends in "@rafters.studio"',
          () => {
            expect(new Set(ids).size).toBe(10_000);
            for (const id of ids) expect(id.endsWith("@rafters.studio")).toBe(true);
          },
        );
      },
    );

    Scenario(
      "A message's Message-ID reads back as the one mail reported",
      ({ Given, When, Then }) => {
        let written: ReturnType<typeof writeCase>;
        let reads: Awaited<ReturnType<typeof readBack>>;

        Given("the plain case", () => {
          // writeCase writes the plain case in the When.
        });

        When(
          "mail writes it and postal-mime, mailparser and Python email each read it back",
          async () => {
            written = writeCase("plain");
            reads = await readBack(written.bytes);
          },
        );

        Then("each reads the Message-ID that mail returned with the bytes", () => {
          for (const read of Object.values(reads)) {
            expect(read.messageId).toBe(written.messageId);
          }
        });
      },
    );
  },
  owns("FR-MAIL-009-c1", "FR-MAIL-009-c2"),
);
