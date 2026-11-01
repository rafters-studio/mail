import type { Mail, Written } from "../../../src/message/index.ts";
import { parent } from "../parents.ts";
import { mary } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.replyTo(parent("a2-1"))({
    from: mary,
    doc: [{ p: ["This is a reply to your hello."] }],
  });
}
