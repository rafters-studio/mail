import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({ from: sean, to: [mary], subject: "שלום", lang: "he", dir: "rtl" })({
    doc: [{ p: ["שלום עולם"] }],
  });
}
