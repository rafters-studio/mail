// Header fields in order, unfolded, RFC 5322 2.2.3: "Unfolding is accomplished by simply removing
// any CRLF that is immediately followed by WSP." Every field is kept as written, repeats included;
// what breaks a rule is recorded as a problem, never mended.

import type { Problem } from "./index.ts";

/** One header field: its name as written and its value unfolded and trimmed. */
export type Field = { name: string; value: string };

// RFC 5322 3.6: the fields a message may hold at most once, in the order their repeats are recorded.
const ONCE = [
  "date",
  "from",
  "sender",
  "reply-to",
  "to",
  "cc",
  "bcc",
  "message-id",
  "in-reply-to",
  "references",
  "subject",
];

/**
 * Reads the header's fields in order (RFC 5322 2.2), unfolding continuation lines (2.2.3), and
 * records each line that breaks RFC 5322 2.1.1 or 2.2 and each field 3.6 allows once found again.
 */
export function headerFields(text: string): { fields: Field[]; problems: Problem[] } {
  const raw: Field[] = [];
  const problems: Problem[] = [];
  if (/\r(?!\n)|(?<!\r)\n/.test(text)) {
    problems.push({
      code: "bare-line-break",
      field: null,
      detail: "a CR or LF outside a CRLF pair",
    });
  }
  let long = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length > 998 && !long) {
      long = true;
      problems.push({
        code: "line-too-long",
        field: null,
        detail: `a line of ${line.length} characters`,
      });
    }
    const last = raw.at(-1);
    const colon = line.indexOf(":");
    if (/^[ \t]/.test(line) && last !== undefined) last.value += line;
    else if (colon >= 0)
      raw.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1) });
    else if (line !== "")
      problems.push({ code: "no-colon", field: null, detail: line.slice(0, 40) });
  }
  const fields = raw.map((f) => ({ name: f.name, value: f.value.trim() }));
  const count = (name: string): number =>
    fields.filter((f) => f.name.toLowerCase() === name).length;
  for (const name of ONCE) {
    const n = count(name);
    if (n > 1) problems.push({ code: "repeated-field", field: name, detail: `${n} times` });
  }
  for (const name of ["date", "from"]) {
    if (count(name) === 0)
      problems.push({ code: "missing-required", field: name, detail: "absent" });
  }
  return { fields, problems };
}
