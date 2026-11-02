// FETCH items (RFC 3501 6.4.5): "The FETCH command retrieves data associated with a message in
// the mailbox." Everything a message item returns comes from @rafters/mail/read: the Read of
// the message and its tree of byte ranges, served as those same octets.
import { binary, bodyLines, contentType, partFields, readMessage, section } from "../read/index.ts";
import type { Field, Part, Read, ReadAddress, ReadMailbox } from "../read/index.ts";
import {
  bytes,
  dateTime,
  list,
  nlist,
  nstring,
  octetString,
  string,
  type Piece,
} from "./format.ts";
import type { Held } from "./index.ts";
import { text, type Value } from "./reader.ts";

/** A message's octets as a binary string, and as read. */
export type Loaded = { bytes: Uint8Array; text: string; read: Read };

/** What one FETCH response is built from: the held message and, when an item needs it, its octets. */
export type Fetched = { held: Held; message: Loaded };

/** One FETCH item: its name, whether it needs the octets, whether it sets \Seen, and its response. */
export type Item = { name: string; body: boolean; seen: boolean; render: (f: Fetched) => Piece[] };

/** A message's octets, with its binary text and its reading made only when first asked for. */
export function load(octets: Uint8Array): Loaded {
  let text: string | undefined;
  let read: Read | undefined;
  return {
    bytes: octets,
    get text() {
      return (text ??= binary(octets));
    },
    get read() {
      return (read ??= readMessage(octets));
    },
  };
}

/** RFC 5322 2.2: the first field of a name (compared without case), unfolded; null when absent. */
const fieldValue = (fields: Field[], name: string): string | null =>
  fields.find((f) => f.name.toLowerCase() === name)?.value ?? null;

/** RFC 3501 7.4.2: an address list; a group is a start marker (host NIL), its members, an end marker. */
function addresses(all: ReadAddress[] | null): string {
  if (all === null || all.length === 0) return "NIL";
  /** RFC 3501 7.4.2: an address, (name adl mailbox host), the source route always NIL. */
  const one = (m: ReadMailbox): string =>
    list([nstring(m.name), "NIL", nstring(m.local), nstring(m.domain)]);
  const each = all.map((a) =>
    "group" in a
      ? `(NIL NIL ${nstring(a.group)} NIL)${a.members.map(one).join("")}(NIL NIL NIL NIL)`
      : one(a),
  );
  return `(${each.join("")})`;
}

/** RFC 3501 7.4.2 ENVELOPE: date, subject, from, sender, reply-to, to, cc, bcc, in-reply-to, message-id. */
export function envelope(read: Read): string {
  /** RFC 3501 7.4.2: a field's value as an nstring, NIL when absent. */
  const raw = (name: string): string => nstring(fieldValue(read.fields, name));
  // RFC 3501 7.4.2: "If the Sender or Reply-To lines are absent in the [RFC-2822] header, or are
  // present but empty, the server sets the corresponding member of the envelope to be the same
  // value as the from member."
  const sender = read.sender === null ? read.from : [read.sender];
  const replyTo = read.replyTo === null || read.replyTo.length === 0 ? read.from : read.replyTo;
  const people = [read.from, sender, replyTo, read.to, read.cc, read.bcc].map(addresses);
  return list([raw("date"), raw("subject"), ...people, raw("in-reply-to"), raw("message-id")]);
}

/** RFC 3501 9 body-fld-param: parameters as name/value pairs, or NIL. */
const paramList = (p: Record<string, string>): string =>
  nlist(Object.entries(p).flatMap(([k, v]) => [string(k), string(v)]));

/** RFC 3501 7.4.2 BODYSTRUCTURE (ext true) or BODY (ext false) of one part. */
export function structure(m: Loaded, part: Part, ext: boolean): string {
  const fields = partFields(m.text, part);
  /** RFC 2045 5: a field of this part's own header. */
  const field = (name: string): string | null => fieldValue(fields, name);
  /** RFC 3501 9 body-fld-dsp: the disposition type and its parameters, or NIL. */
  const disposition = (): string => {
    const d = field("content-disposition");
    if (d === null) return "NIL";
    const { type, params } = contentType(d);
    return list([string(type), paramList(params)]);
  };
  /** RFC 3501 9 body-fld-lang: the Content-Language tags, or NIL. */
  const language = (): string => {
    const l = field("content-language");
    return l === null ? "NIL" : list(l.split(",").map((s) => string(s.trim())));
  };
  const slash = part.type.indexOf("/");
  // RFC 2045 5.2: a Content-Type without a subtype is treated as text/plain.
  const [type, subtype] =
    slash === -1 ? ["text", "plain"] : [part.type.slice(0, slash), part.type.slice(slash + 1)];
  if (type === "multipart" && part.children.length > 0) {
    const children = part.children.map((c) => structure(m, c, ext)).join("");
    const extension = ext
      ? ` ${paramList(part.params)} ${disposition()} ${language()} ${nstring(field("content-location"))}`
      : "";
    return `(${children} ${string(subtype)}${extension})`;
  }
  const encoding = field("content-transfer-encoding")?.toLowerCase() ?? "7bit";
  const size = String(part.body.end - part.body.start);
  const items = [
    string(type),
    string(subtype),
    paramList(part.params),
    nstring(field("content-id")),
    nstring(field("content-description")),
    string(encoding),
    size,
  ];
  if (part.message !== null) {
    const inner = readMessage(m.bytes.subarray(part.body.start, part.body.end));
    items.push(envelope(inner), structure(m, part.message, ext), String(bodyLines(m.text, part)));
  } else if (type === "text") items.push(String(bodyLines(m.text, part)));
  if (ext)
    items.push(
      nstring(field("content-md5")),
      disposition(),
      language(),
      nstring(field("content-location")),
    );
  return list(items);
}

const NOTHING = new Uint8Array(0);

// RFC 3501 6.4.5 section-spec: a part number, then optionally a keyword (and field names).
const SECTION =
  /^(\d+(?:\.\d+)*)?(?:(?:^|\.)(HEADER\.FIELDS\.NOT|HEADER\.FIELDS|HEADER|TEXT|MIME)(?: \(([^)]*)\))?)?$/i;

/**
 * RFC 3501 6.4.5 section-spec: "" (the whole message), HEADER, TEXT, HEADER.FIELDS[.NOT] (..),
 * a part number, or a part number then MIME or (on a message/rfc822 part) any of the others.
 * Null when the spec is not one; the extractor gives no octets when it names no part of the message,
 * and otherwise a view on the stored octets, except the HEADER.FIELDS it has to build.
 */
export function sectionOf(spec: string): ((m: Loaded) => Uint8Array) | null {
  const parsed = SECTION.exec(spec);
  if (parsed === null) return null;
  const [, num, keyword, names] = parsed;
  const kw = keyword?.toUpperCase();
  const fieldsKw = kw === "HEADER.FIELDS" || kw === "HEADER.FIELDS.NOT";
  if ((kw === "MIME" && num === undefined) || fieldsKw !== (names !== undefined)) return null;
  const wanted = (names ?? "")
    .trim()
    .split(/\s+/)
    .map((n) => n.toLowerCase());
  return (m) => {
    /** The stored octets of a range. */
    const cut = ({ start, end }: { start: number; end: number }): Uint8Array =>
      m.bytes.subarray(start, end);
    if (num === undefined && kw === undefined) return m.bytes;
    const { root } = m.read;
    const target = num === undefined ? root : section(root, num);
    if (target === null) return NOTHING;
    if (kw === undefined) return cut(target.body);
    if (kw === "MIME") return cut({ start: target.header.start, end: target.body.start });
    // HEADER and TEXT name a message: the whole one, or the one a message/rfc822 part holds.
    const message = num === undefined ? root : target.message;
    if (message === null) return NOTHING;
    if (kw === "TEXT") return cut(message.body);
    const header = cut({ start: message.header.start, end: message.body.start });
    if (kw === "HEADER") return header;
    // RFC 3501 6.4.5: the chosen fields as written (folding kept), then the blank line.
    /** RFC 3501 6.4.5: a field is kept when its name is listed (HEADER.FIELDS) or not (HEADER.FIELDS.NOT). */
    const keep = (f: string): boolean =>
      wanted.includes(f.slice(0, f.indexOf(":")).trim().toLowerCase()) === (kw === "HEADER.FIELDS");
    const chosen = binary(header)
      .split(/\r\n(?![ \t])/)
      .filter((f) => f.includes(":") && keep(f));
    return bytes(`${chosen.map((f) => `${f}\r\n`).join("")}\r\n`);
  };
}

/** RFC 3501 6.4.5: a FETCH item. */
const item = (
  name: string,
  body: boolean,
  seen: boolean,
  render: (f: Fetched) => Piece[],
): Item => ({ name, body, seen, render });

/** The UID item, which UID FETCH adds when it is not asked for (RFC 3501 6.4.8). */
export const UID_ITEM = item("UID", false, false, ({ held }) => [`UID ${held.uid}`]);

// RFC 3501 6.4.5: the message data items, and the rev1 forms RFC822, RFC822.HEADER, RFC822.TEXT.
const ITEMS = new Map<string, Item>(
  [
    UID_ITEM,
    item("FLAGS", false, false, ({ held }) => [`FLAGS (${held.flags.join(" ")})`]),
    item("RFC822.SIZE", false, false, ({ held }) => [`RFC822.SIZE ${held.size}`]),
    item("INTERNALDATE", false, false, ({ held }) => [
      `INTERNALDATE ${dateTime(held.internalDate)}`,
    ]),
    item("ENVELOPE", true, false, ({ message }) => [`ENVELOPE ${envelope(message.read)}`]),
    item("BODYSTRUCTURE", true, false, ({ message }) => [
      `BODYSTRUCTURE ${structure(message, message.read.root, true)}`,
    ]),
    item("BODY", true, false, ({ message }) => [
      `BODY ${structure(message, message.read.root, false)}`,
    ]),
    item("RFC822", true, true, ({ message }) => ["RFC822 ", ...octetString(message.bytes)]),
    item("RFC822.HEADER", true, false, ({ message }) => [
      "RFC822.HEADER ",
      ...octetString(message.bytes.subarray(0, message.read.root.body.start)),
    ]),
    item("RFC822.TEXT", true, true, ({ message }) => [
      "RFC822.TEXT ",
      ...octetString(message.bytes.subarray(message.read.root.body.start)),
    ]),
  ].map((i) => [i.name, i]),
);

// RFC 3501 6.4.5: the macros.
const MACROS = new Map([
  ["ALL", ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"]],
  ["FAST", ["FLAGS", "INTERNALDATE", "RFC822.SIZE"]],
  ["FULL", ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODY"]],
]);

// RFC 3501 6.4.5: BODY[section]<origin.count> and BODY.PEEK[...]; the count is a nz-number.
const BODY_SECTION = /^BODY(\.PEEK)?\[([^\]]*)\](?:<(\d+)\.([1-9]\d*)>)?$/i;

/** RFC 3501 6.4.5: one BODY[...] item; the partial is cut from the section, empty past its end. */
function sectionItem(name: string): Item | null {
  const m = BODY_SECTION.exec(name);
  if (m === null) return null;
  // The section group always takes part in a match, so String() only widens its type.
  const [, peek, , origin, count] = m;
  const spec = String(m[2]);
  const extract = sectionOf(spec);
  if (extract === null) return null;
  const from = Number(origin);
  const label = `BODY[${spec.toUpperCase()}]${origin === undefined ? "" : `<${from}>`}`;
  return item(name, true, peek === undefined, ({ message }) => {
    const whole = extract(message);
    return [
      `${label} `,
      ...octetString(origin === undefined ? whole : whole.subarray(from, from + Number(count))),
    ];
  });
}

/** RFC 3501 6.4.5: the items of a FETCH, one or a parenthesised list, macros expanded; null when one is not an item. */
export function fetchItems(arg: Value | undefined): Item[] | null {
  const given = arg?.kind === "list" ? arg.items : [arg];
  const names = given
    .map(text)
    .flatMap((t) => (t === null ? [""] : (MACROS.get(t.toUpperCase()) ?? [t])));
  const items = names.map((n) => ITEMS.get(n.toUpperCase()) ?? sectionItem(n));
  return items.every((i) => i !== null) ? items : null;
}
