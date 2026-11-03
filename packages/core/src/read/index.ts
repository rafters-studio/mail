// A received message read, RFC 5322 3.6: "The only required header fields are the origination
// date field and the originator address field(s)." Reading reports what a message holds and
// records a problem for each part it cannot read; it never mends, and it never throws.

import { readAddresses, type ReadAddress, type ReadMailbox } from "./address.ts";
import { readDate, type ReadDate } from "./date.ts";
import { headerFieldsAt, type Field } from "./fields.ts";
import { readMessageIds } from "./message-id.ts";
import { parseParts, type Part } from "./mime.ts";

export { lex, type Token } from "./lexer.ts";
export { binary, headerFields, type Field } from "./fields.ts";
export {
  readAddresses,
  sameMailbox,
  type ReadAddress,
  type ReadGroup,
  type ReadMailbox,
} from "./address.ts";
export { readMessageIds } from "./message-id.ts";
export { readDate, type ReadDate } from "./date.ts";
export {
  bodyLines,
  contentType,
  MAX_DEPTH,
  parseParts,
  partFields,
  section,
  type Part,
  type Range,
} from "./mime.ts";
export { decodeWords, partText, transferDecode } from "./decode.ts";

export const READ_PROBLEMS = [
  "bare-line-break", // a CR or LF not in a CRLF pair (RFC 5322 2.2)
  "line-too-long", // a header line over 998 characters (RFC 5322 2.1.1)
  "no-colon", // a header line that is neither a field nor a continuation
  "repeated-field", // a field RFC 5322 3.6 allows once, found more than once
  "missing-required", // no Date or no From (RFC 5322 3.6)
  "unparsed-value", // an address, message-id or date field that fits no grammar
  "invalid-date", // a date that parses but is not a real moment
  "multipart-no-boundary", // a multipart Content-Type with no boundary parameter
  "multipart-unclosed", // a multipart with no closing boundary line
  "too-deep", // multiparts and messages nested deeper than MAX_DEPTH
  "header-too-large", // a header section past 1 MiB, read only to the bound
  "too-many-parts", // a message of more than 10,000 parts, the rest left unread inside its parent
] as const;

/** One thing a message does that its rules do not allow, and where. */
export type Problem = {
  code: (typeof READ_PROBLEMS)[number];
  field: string | null;
  detail: string;
};

/** A received message: every header field in order, the fields mail reads, its parts and its problems. */
export type Read = {
  fields: Field[];
  from: ReadMailbox[] | null;
  sender: ReadMailbox | null;
  replyTo: ReadAddress[] | null;
  to: ReadAddress[] | null;
  cc: ReadAddress[] | null;
  bcc: ReadAddress[] | null;
  subject: string | null;
  date: ReadDate | null;
  messageId: string | null;
  inReplyTo: string[] | null;
  references: string[] | null;
  root: Part;
  problems: Problem[];
};

/** How many bytes the line break at `at` takes (CRLF, or a CR or LF alone), 0 when there is none. */
function lineBreak(bytes: Uint8Array, at: number): number {
  if (bytes[at] === 13) return bytes[at + 1] === 10 ? 2 : 1;
  return bytes[at] === 10 ? 1 : 0;
}

/** Where the message's header section ends: the break before its first empty line, or its end. */
function headerEnd(bytes: Uint8Array): number {
  if (lineBreak(bytes, 0) > 0) return 0;
  for (let at = 0; at < bytes.length; at += 1) {
    const size = lineBreak(bytes, at);
    if (size > 0 && lineBreak(bytes, at + size) > 0) return at;
  }
  return bytes.length;
}

/** The mailboxes of an address list with no group in it, or null (RFC 5322 3.6.2: From and Sender hold mailboxes). */
function mailboxes(list: ReadAddress[] | null): ReadMailbox[] | null {
  const found = list === null ? [] : list.flatMap((a) => ("group" in a ? [] : [a]));
  return list !== null && found.length === list.length && found.length > 0 ? found : null;
}

/** The one element of a list that must hold exactly one (RFC 5322 3.6: Sender, Message-ID), or null. */
function only<T>(list: T[] | null): T | null {
  const [one, ...more] = list ?? [];
  return one === undefined || more.length > 0 ? null : one;
}

/**
 * Reads a received message (RFC 5322 3.6): its header fields, its originator, destination and
 * identification fields and its date, each null with a problem when it fits no grammar, and its
 * tree of parts (RFC 2046 5.1.1).
 */
export function readMessage(bytes: Uint8Array): Read {
  const header = headerFieldsAt(bytes, 0, headerEnd(bytes));
  const problems: Problem[] = [];
  /** The first value of the field `name` read by `reader`, recorded as unparsed (RFC 5322 3.6) when it reads as null. */
  function field<T>(name: string, reader: (value: string) => T | null): T | null {
    const found = header.fields.find((f) => f.name.toLowerCase() === name);
    if (found === undefined) return null;
    const value = reader(found.value);
    if (value === null)
      problems.push({ code: "unparsed-value", field: name, detail: found.value.slice(0, 80) });
    return value;
  }
  const from = field("from", (v) => mailboxes(readAddresses(v)));
  const sender = field("sender", (v) => only(mailboxes(readAddresses(v))));
  const messageId = field("message-id", (v) => only(readMessageIds(v)));
  const date = field("date", readDate);
  if (date !== null && date.instant === null) {
    const invalid = date.problem !== "not a date";
    problems.push({
      code: invalid ? "invalid-date" : "unparsed-value",
      field: "date",
      detail: date.problem,
    });
  }
  const replyTo = field("reply-to", readAddresses);
  const to = field("to", readAddresses);
  const cc = field("cc", readAddresses);
  const bcc = field("bcc", readAddresses);
  const inReplyTo = field("in-reply-to", readMessageIds);
  const references = field("references", readMessageIds);
  const subject = field("subject", (v) => v);
  const structure = parseParts(bytes);
  return {
    fields: header.fields,
    from,
    sender,
    replyTo,
    to,
    cc,
    bcc,
    subject,
    date,
    messageId,
    inReplyTo,
    references,
    root: structure.root,
    problems: [...header.problems, ...problems, ...structure.problems],
  };
}
