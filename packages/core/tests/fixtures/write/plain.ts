import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({ from: sean, to: [mary], subject: "Saying Hello", offset: -420 })({
    doc: [
      { p: ["Hi Mary,"] },
      {
        p: [
          "This is a plain message. This line is deliberately longer than seventy-eight characters so that a writer has to decide what to do with it.",
        ],
      },
      { p: ["Sean"] },
    ],
  });
}
