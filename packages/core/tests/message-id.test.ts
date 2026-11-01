import { readBack } from "@rafters/mail-test-readers";
import { expect } from "vitest";
import { createMail } from "../src/message/index.ts";
import { writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { run } from "./fixtures/write/plain.ts";

criterion("FR-MAIL-009-c1", () => {
  // The real entropy and clock, so these bytes are not the golden's; uniqueness is the point.
  const mail = createMail({ domain: "rafters.studio" });
  const ids = Array.from({ length: 10_000 }, () => run(mail).messageId);
  expect(new Set(ids).size).toBe(10_000);
  for (const id of ids) expect(id.endsWith("@rafters.studio")).toBe(true);
});

criterion("FR-MAIL-009-c2", async () => {
  const written = writeCase("plain");
  for (const read of Object.values(await readBack(written.bytes))) {
    expect(read.messageId).toBe(written.messageId);
  }
});
