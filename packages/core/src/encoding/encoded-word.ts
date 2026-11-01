// Non-ASCII text in a header (RFC 2047 2): "An 'encoded-word' may not be more than 75 characters
// long, including 'charset', 'encoding', 'encoded-text', and delimiters." A header can only hold
// ASCII, so any other text travels as encoded words a reader decodes back.
import { base64 } from "./base64.ts";
import { utf8 } from "./chars.ts";

// 36 octets of UTF-8 are 48 base64 characters: a 60-character word, well inside 75.
const OCTETS_PER_WORD = 36;

/** RFC 2047 2 and 5: text as "=?UTF-8?B?...?=" words, each split between characters, never inside one. */
export function encodedWords(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (utf8(chunk + char).length > OCTETS_PER_WORD) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  chunks.push(chunk);
  return chunks.map((c) => `=?UTF-8?B?${base64(utf8(c))}?=`);
}

/**
 * RFC 2047 5 (1): header text as words. Printable ASCII is its own words, split at single
 * spaces; anything else, or text holding "=?" that a reader would mistake for an encoded word,
 * is all encoded words.
 */
export function textWords(text: string): string[] {
  return /^[\x20-\x7e]*$/.test(text) && !text.includes("=?") ? text.split(" ") : encodedWords(text);
}
