import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({
    from: sean,
    to: [mary],
    subject: "CV",
    attachments: [
      {
        filename: `${"a".repeat(116)}.pdf`,
        type: "application/pdf",
        content: new Uint8Array([1, 2, 3]),
      },
    ],
  })({ doc: [{ p: ["Attached."] }] });
}
