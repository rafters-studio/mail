import type { Mail, Written } from "../../../src/message/index.ts";
import { mary, sean } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({
    from: sean,
    to: [mary],
    subject: "CV",
    attachments: [
      {
        filename: "résumé de José.pdf",
        type: "application/pdf",
        content: new Uint8Array(3000).map((_, i) => i % 256),
      },
    ],
  })({ doc: [{ p: ["Attached."] }] });
}
