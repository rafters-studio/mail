// Text as 7-bit lines (RFC 2045 6.7): "The Quoted-Printable encoding is intended to represent data
// that largely consists of octets that correspond to printable characters in the US-ASCII
// character set." Readable where it is ASCII, exact where it is not.
import { utf8 } from "./chars.ts";

// Rules (1) and (2): an octet stands for itself when it is a tab or printable ASCII other than
// "=" itself; every other octet is written "=XX".
const LITERAL = /^[\t\x20-\x3c\x3e-\x7e]$/;

/** RFC 2045 6.7 (1): an octet as "=" and two uppercase hexadecimal digits. */
function escaped(octet: number): string {
  return `=${octet.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** RFC 2045 6.7 (1) and (2): an octet as itself when it may be, else escaped. */
function unit(octet: number): string {
  const char = String.fromCharCode(octet);
  return LITERAL.test(char) ? char : escaped(octet);
}

/** RFC 2045 6.7 (3) and (5): one line, its final space or tab escaped, in lines of at most 76. */
function encodeLine(line: string): string {
  const last = utf8(line).length - 1;
  // Rule (3): a space or tab ending a line may be stripped in transit, so it is written =20 or =09.
  const units = Array.from(utf8(line), (octet, i) =>
    i === last && /^[ \t]$/.test(String.fromCharCode(octet)) ? escaped(octet) : unit(octet),
  );
  const lines: string[] = [];
  let current = "";
  for (const u of units) {
    // Rule (5): a soft line break "=" ends a line before it passes 76 characters, "=" included.
    if (current.length + u.length > 75) {
      lines.push(`${current}=`);
      current = "";
    }
    current += u;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** RFC 2045 6.7 (4): text as quoted-printable over its UTF-8 octets, every line break as CRLF. */
export function quotedPrintable(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map(encodeLine)
    .join("\r\n");
}
