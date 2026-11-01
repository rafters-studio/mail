// Non-ASCII filenames (RFC 2231 3, 4): "Long MIME media type or disposition parameter values do
// not interact well with header line wrapping conventions." So a long or non-ASCII filename is
// written percent-encoded with its charset, in numbered sections when it is long.
import { encodedWords } from "./encoded-word.ts";
import { fold } from "./fold.ts";

// Each section's value is at most 50 characters, so its line stays inside 78 (form 01a18fda).
const SECTION = 50;

/** RFC 2231 4: one character percent-encoded as UTF-8, with the marks RFC 3986 reserves as well. */
function percentEncoded(char: string): string {
  return encodeURIComponent(char)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A")
    .replaceAll("!", "%21");
}

/**
 * RFC 2231 3: the value in sections "filename*0*", "filename*1*", ..., each split between
 * characters, never inside one's octets, so a client that decodes each section alone reads it.
 */
function sections(filename: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (const char of filename) {
    const encoded = percentEncoded(char);
    if (part.length + encoded.length > SECTION) {
      parts.push(part);
      part = "";
    }
    part += encoded;
  }
  parts.push(part);
  const last = parts.length - 1;
  return parts.map(
    (p, i) => ` filename*${i}*=${i === 0 ? "utf-8''" : ""}${p}${i < last ? ";" : ""}`,
  );
}

/**
 * RFC 2231 3 and 4: the lines of an attachment's "name" and "filename" parameters. A printable
 * ASCII name that fits is quoted in both; any other is "filename*" with its charset, and "name"
 * as encoded words inside the quotes, against RFC 2047 5 on purpose: older clients read only it.
 */
export function filenameParameters(filename: string): { name: string[]; filename: string[] } {
  const quoted = ` filename="${filename}"`;
  if (/^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/.test(filename) && quoted.length <= 78) {
    return { name: [` name="${filename}"`], filename: [quoted] };
  }
  const name = fold("", `name="${encodedWords(filename).join(" ")}"`.split(" "));
  const single = ` filename*=utf-8''${Array.from(filename, percentEncoded).join("")}`;
  return { name, filename: single.length <= 78 ? [single] : sections(filename) };
}
