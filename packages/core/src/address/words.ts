// Writing and comparing addresses (RFC 5322 3.4, 3.4.1): "Normally, a mailbox is composed of two
// parts: (1) an optional display name that indicates the name of the recipient ... and (2) an
// addr-spec address enclosed in angle brackets."
import { textWords } from "../encoding/encoded-word.ts";
import type { AddrSpec, Mailbox } from "./index.ts";

/** RFC 5322 3.2.5: a printable ASCII name holding a special is one quoted string, `"` and `\` escaped. */
function nameWords(name: string): string[] {
  return /^[\x20-\x7e]*$/.test(name) && /[()<>[\]:;@\\,."]/.test(name)
    ? [`"${name.replace(/["\\]/g, "\\$&")}"`]
    : textWords(name);
}

/** RFC 5322 3.4: "local@domain" alone, or the name's words then "<local@domain>". */
function mailboxParts(
  mailbox: Mailbox,
  name: (text: string) => string[],
): { name: string[]; addr: string } {
  const addrSpec = `${mailbox.addr.local}@${mailbox.addr.domain}`;
  return mailbox.name === undefined
    ? { name: [], addr: addrSpec }
    : { name: name(mailbox.name), addr: `<${addrSpec}>` };
}

/**
 * RFC 5322 3.4: a mailbox-list as words to fold, each mailbox after the first preceded by a
 * comma joined to the end of the one before.
 */
export function mailboxWords(list: readonly Mailbox[]): string[] {
  return list.flatMap((mailbox, i) => {
    const parts = mailboxParts(mailbox, nameWords);
    return [...parts.name, i < list.length - 1 ? `${parts.addr},` : parts.addr];
  });
}

/** RFC 5322 3.4: a mailbox as people read it in a body, its name as given, never quoted or encoded. */
export function mailboxText(mailbox: Mailbox): string {
  const parts = mailboxParts(mailbox, (name) => [name]);
  return [...parts.name, parts.addr].join(" ");
}

/** RFC 5322 3.4.1: the same mailbox, its domain ignoring ASCII case and its local part exactly. */
export function sameAddress(a: AddrSpec, b: AddrSpec): boolean {
  return a.local === b.local && a.domain.toLowerCase() === b.domain.toLowerCase();
}
