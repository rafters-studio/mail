// Writing and comparing addresses (RFC 5322 3.4, 3.4.1): "Normally, a mailbox is composed of two
// parts: (1) an optional display name that indicates the name of the recipient ... and (2) an
// addr-spec address enclosed in angle brackets."
import { textWords } from "../encoding/encoded-word.ts";
import type { Mailbox } from "./index.ts";

/**
 * RFC 5322 3.2.4 and 3.4: a display name as words. An ASCII name holding a special is one
 * quoted-string word, its quotes and backslashes escaped; any other name is header text.
 */
function nameWords(name: string): string[] {
  return /^[\x20-\x7e]*$/.test(name) && /[()<>[\]:;@\\,."]/.test(name)
    ? [`"${name.replaceAll(/["\\]/g, "\\$&")}"`]
    : textWords(name);
}

/**
 * RFC 5322 3.4: "local@domain" alone, or the display name's words then "<local@domain>". A name
 * that trims to empty is absent (form 01a18fda).
 */
function mailboxText(mailbox: Mailbox): string[] {
  const addrSpec = `${mailbox.addr.local}@${mailbox.addr.domain}`;
  return mailbox.name ? [...nameWords(mailbox.name), `<${addrSpec}>`] : [addrSpec];
}

/**
 * RFC 5322 3.4: a mailbox-list as words to fold, each mailbox after the first preceded by a
 * comma joined to the end of the one before. No word holds a line break, so the list joined
 * by line breaks splits back into exactly its words.
 */
export function mailboxWords(list: readonly Mailbox[]): string[] {
  return list
    .map((mailbox) => mailboxText(mailbox).join("\n"))
    .join(",\n")
    .split("\n");
}
