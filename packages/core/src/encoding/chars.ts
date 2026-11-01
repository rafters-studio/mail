// The characters a header may hold (RFC 5322 3.2.3): "Several productions in structured header
// field bodies are simply strings of certain basic characters. Such productions are called atoms."
// Mail checks text for controls once, here, so no line break can reach a header and end it early.
import { z } from "zod";

/** Text with no line breaks, tabs or controls: a CR or LF in a header value would start a new field. */
// oxlint-disable-next-line no-control-regex -- finding controls is what this pattern is for
export const noControls = z.string().regex(/^[^\x00-\x1f\x7f]*$/);

/** Header text, trimmed: text that trims to empty means the field is absent. */
export const words = noControls.trim();

const ATEXT = "A-Za-z0-9!#$%&'*+/=?^_`{|}~-";

/** RFC 5322 3.2.3: dot-atom-text is 1*atext *("." 1*atext), the form a local part, domain and id take. */
export const DOT_ATOM_TEXT = `[${ATEXT}]+(\\.[${ATEXT}]+)*`;

/** RFC 5322 3.2.3: text that is dot-atom-text and nothing else. */
export const DOT_ATOM = new RegExp(`^${DOT_ATOM_TEXT}$`);

/** The UTF-8 bytes of text: every encoding mail writes works on octets, not characters. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
