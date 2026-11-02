import type { Mail, Written } from "../../../src/message/index.ts";
import { parent } from "../parents.ts";
import { jane, mary } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.forward(parent("a2-1-att"))({
    from: mary,
    to: [jane],
    doc: [{ p: ["Forwarding this along."] }],
    attach: true,
  });
}
