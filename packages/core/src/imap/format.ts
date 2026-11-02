// Writing responses (RFC 3501 4.5): "The special form "NIL" represents the non-existence of a
// particular data item that is represented as a string or parenthesized list, as distinct from
// the empty string "" or the empty parenthesized list ()." Values are binary strings, one char
// per octet, and a response is written as those octets.

/** RFC 3501 4.3: a quoted string cannot hold CR, LF or NUL; a quote, a backslash or 8-bit goes as a literal too. */
// oxlint-disable-next-line no-control-regex -- finding CR, LF and NUL is what this pattern is for
const NEEDS_LITERAL = /[\r\n\0"\\\x80-\xff]/;

/** RFC 3501 4.3: a string, quoted when it can be, else a literal "{n}" CRLF and its octets. */
export function string(value: string): string {
  return NEEDS_LITERAL.test(value) ? `{${value.length}}\r\n${value}` : `"${value}"`;
}

/** RFC 3501 9 nstring: NIL, or a string. */
export function nstring(value: string | null | undefined): string {
  return value === null || value === undefined ? "NIL" : string(value);
}

/** RFC 3501 4.4: a parenthesised list of formatted items; an empty one is "()". */
export function list(items: string[]): string {
  return `(${items.join(" ")})`;
}

/** RFC 3501 9 body-fld-param and kin: a parenthesised list, or NIL when there are no items. */
export function nlist(items: string[]): string {
  return items.length === 0 ? "NIL" : list(items);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** RFC 3501 9 date-time: a two-digit field. */
const two = (n: number): string => String(n).padStart(2, "0");

/** RFC 3501 9 date-time: DQUOTE "dd-Mon-yyyy hh:mm:ss +zzzz" DQUOTE, here always in UTC. */
export function dateTime(d: Date): string {
  const day = `${two(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  return `"${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000"`;
}

/** RFC 3501 2.2: the octets of a response built as a binary string. */
export function bytes(response: string): Uint8Array {
  return Uint8Array.from(response, (c) => c.charCodeAt(0));
}
