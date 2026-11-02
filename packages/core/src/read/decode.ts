// A part's text, and encoded words, RFC 2045 6.1: "the Content-Transfer-Encoding field is used to
// indicate the type of transformation that has been used in order to represent the body in an
// acceptable manner for transport." Text is decoded only when someone asks; the tree never is.

import { headerFields } from "./fields.ts";
import type { Part } from "./mime.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The bytes of a binary string, one per character. */
function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Base64 (RFC 2045 6.8): characters outside the alphabet are ignored, and the first `=` ends the data. */
function base64(text: string): Uint8Array {
  const sextets = [...text.split("=", 1).join("")]
    .map((c) => BASE64.indexOf(c))
    .filter((n) => n >= 0);
  const bytes = new Uint8Array(Math.floor((sextets.length * 6) / 8));
  let bits = 0;
  let width = 0;
  let at = 0;
  for (const s of sextets) {
    bits = ((bits << 6) | s) & 0xffff;
    width += 6;
    if (width >= 8) {
      width -= 8;
      bytes[at++] = bits >> width;
    }
  }
  return bytes;
}

/**
 * Quoted-printable (RFC 2045 6.7): white space at the end of a line is dropped first (rule 3), so
 * `=` and spaces is a soft break; then soft breaks go, and each `=XX` becomes its byte, any other
 * `=` staying as it is.
 */
function quotedPrintable(text: string): Uint8Array {
  return bytesOf(
    text
      .replace(/[ \t]+(?=\r\n|$)/g, "")
      .replace(/=\r\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  );
}

/**
 * Decodes a body's text by its Content-Transfer-Encoding (RFC 2045 6.1), named without case:
 * base64 and quoted-printable are undone, and every other encoding is the bytes as they are.
 */
export function transferDecode(text: string, encoding: string): Uint8Array {
  const name = encoding.trim().toLowerCase();
  return name === "base64"
    ? base64(text)
    : name === "quoted-printable"
      ? quotedPrintable(text)
      : bytesOf(text);
}

/** The value of a header's first field of that name, unfolded (RFC 5322 2.2.3), or null. */
function first(header: string, name: string): string | null {
  const field = headerFields(header).fields.find((f) => f.name.toLowerCase() === name);
  return field === undefined ? null : field.value;
}

/** Bytes decoded from a charset (RFC 2046 4.1.2), or from UTF-8 when `TextDecoder` does not know it. */
function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * A part's text (RFC 2045 6, RFC 2046 4.1.2): its body transfer-decoded by its first
 * Content-Transfer-Encoding (default 7bit), then decoded from its charset (default us-ascii).
 */
export function partText(text: string, part: Part): string {
  const encoding =
    first(text.slice(part.header.start, part.header.end), "content-transfer-encoding") ?? "7bit";
  const bytes = transferDecode(text.slice(part.body.start, part.body.end), encoding);
  return decodeText(bytes, part.params["charset"] ?? "us-ascii");
}

/**
 * One encoded word's text (RFC 2047 4, 5), or null when its charset is unknown or its bytes are
 * not valid in it; a language suffix (RFC 2231 5, `*en`) is no part of the charset.
 */
function decodeWord(charset: string, encoding: string, encoded: string): string | null {
  const bytes =
    encoding.toLowerCase() === "b"
      ? base64(encoded)
      : quotedPrintable(encoded.replace(/_/g, "=20"));
  try {
    return new TextDecoder(charset.replace(/\*.*$/, ""), { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decodes the encoded words of a header value (RFC 2047 2). A word that does not decode stays as
 * written; white space between two words that both decoded is dropped (RFC 2047 6.2).
 */
export function decodeWords(value: string): string {
  let out = "";
  let last = 0;
  let joined = false;
  for (const m of value.matchAll(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g)) {
    const [whole, charset = "", encoding = "", encoded = ""] = m;
    const text = decodeWord(charset, encoding, encoded);
    const gap = value.slice(last, m.index);
    out += joined && text !== null && /^[ \t]*$/.test(gap) ? "" : gap;
    out += text ?? whole;
    joined = text !== null;
    last = m.index + whole.length;
  }
  return out + value.slice(last);
}
