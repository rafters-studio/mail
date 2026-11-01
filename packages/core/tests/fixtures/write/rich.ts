import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({ from: sean, to: [mary], subject: "Notes" })({
    doc: [
      { p: ["Three things, ", { em: ["briefly"] }, ", and one ", { strong: ["important"] }, ": "] },
      {
        ul: [
          ["the guide"],
          ["the ", { a: "https://rafters.studio/docs", href: "https://rafters.studio/docs" }],
          ["the reply"],
        ],
      },
      { p: ["Sean"] },
    ],
  });
}
