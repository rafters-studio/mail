// Message identifiers, RFC 5322 3.6.4: "The message identifier (msg-id) itself MUST be a globally
// unique identifier for a message." Each is read between its angle brackets; obsolete References
// may hold phrases between them (RFC 5322 4.5.4), and those are skipped.

import { lex } from "./lexer.ts";

/**
 * Reads the identifiers of a Message-ID, In-Reply-To or References field (RFC 5322 3.6.4), in
 * order, without their brackets. Null when the field does not lex, or an identifier has no `>` or
 * is not one `@` with text on both sides.
 */
export function readMessageIds(text: string): string[] | null {
  const { tokens, problem } = lex(text);
  if (problem !== null) return null;
  const ids: string[] = [];
  let id: string | null = null;
  for (const t of tokens) {
    const value =
      t.kind === "quoted" ? `"${t.value}"` : t.kind === "literal" ? `[${t.value}]` : t.value;
    const closes = t.kind === "special" && t.value === ">";
    if (id === null) id = t.kind === "special" && t.value === "<" ? "" : null;
    else if (!closes) id += value;
    else {
      const sides = id.split("@");
      if (sides.length !== 2 || sides.some((s) => s === "")) return null;
      ids.push(id);
      id = null;
    }
  }
  return id === null ? ids : null;
}
