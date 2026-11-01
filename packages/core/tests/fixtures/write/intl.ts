import type { Mail, Written } from "../../../src/message/index.ts";
import { mary } from "../people.ts";

export function run(mail: Mail): Written {
  return mail.compose({
    from: { name: "José Núñez", addr: { local: "jose", domain: "example.es" } },
    to: [mary],
    // U+2615 is written as an escape: the repo keeps emoji out of its source.
    subject:
      "Café ☕ meeting — 日本語の件名が長いので折り返しが必要です and a little more English to force folding",
  })({
    doc: [
      { p: ["Hola María,"] },
      { p: ["¿Nos vemos en el café? 日本語も大丈夫です。"] },
      { p: ["José"] },
    ],
  });
}
