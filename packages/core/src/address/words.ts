// Writing and comparing addresses (RFC 5322 3.4, 3.4.1): "Normally, a mailbox is composed of two
// parts: (1) an optional display name that indicates the name of the recipient ... and (2) an
// addr-spec address enclosed in angle brackets."
import { textWords } from "../encoding/encoded-word.ts";
import type { AddrSpec, Mailbox } from "./index.ts";

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
function mailboxText(mailbox: Mailbox, name = nameWords): string[] {
  const addrSpec = `${mailbox.addr.local}@${mailbox.addr.domain}`;
  return mailbox.name ? [...name(mailbox.name), `<${addrSpec}>`] : [addrSpec];
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

/**
 * RFC 5322 3.4: a mailbox as people read it in a body, its name as given, never quoted or
 * encoded. A name that trims to empty is absent, as in a header.
 */
export function mailboxBodyText(mailbox: Mailbox): string {
  return mailboxText(mailbox, (name) => [name]).join(" ");
}

/** RFC 5322 3.4.1: the same mailbox, its domain ignoring ASCII case and its local part exactly. */
export function sameAddress(a: AddrSpec, b: AddrSpec): boolean {
  // Not toLowerCase alone: it also folds non-ASCII letters (the Kelvin sign to "k"), and a
  // domain is compared ignoring ASCII case only (form 01a18fda, Replies and forwards).
  const fold = (domain: string) => domain.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return a.local === b.local && fold(a.domain) === fold(b.domain);
}
