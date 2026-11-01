import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({ from: sean, to: [mary], subject: "Getting started", offset: -420 })({
    doc: [
      { p: ["Hi Mary,"] },
      {
        p: [
          "Here is the ",
          {
            a: "getting started guide",
            href: "https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&utm_medium=reply&ref=abcdefghijklmnopqrstuvwxyz",
          },
          " — it covers everything.",
        ],
      },
      { p: ["Sean"] },
    ],
  });
}
