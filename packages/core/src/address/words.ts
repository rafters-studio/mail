// Writing and comparing addresses (RFC 5322 3.4, 3.4.1): "Normally, a mailbox is composed of two
// parts: (1) an optional display name that indicates the name of the recipient ... and (2) an
// addr-spec address enclosed in angle brackets."
import { textWords } from "../encoding/encoded-word.ts";
import type { Mailbox } from "./index.ts";

/** RFC 5322 3.4: "local@domain" alone, or the display name's words then "<local@domain>". */
function mailboxText(mailbox: Mailbox): string {
  const addrSpec = `${mailbox.addr.local}@${mailbox.addr.domain}`;
  return mailbox.name === undefined
    ? addrSpec
    : [...textWords(mailbox.name), `<${addrSpec}>`].join(" ");
}

/**
 * RFC 5322 3.4: a mailbox-list as words to fold, each mailbox after the first preceded by a
 * comma joined to the end of the one before. No word holds a space, so the list splits back
 * into exactly its words.
 */
export function mailboxWords(list: readonly Mailbox[]): string[] {
  return list.map(mailboxText).join(", ").split(" ");
}
