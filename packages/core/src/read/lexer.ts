// The words of a structured field, RFC 5322 3.2: "Characters will be interpreted as a series of
// tokens." Atoms, quoted strings, domain literals and specials; the comments and folding white
// space between them carry no meaning, so the lexer drops them.

/** One word of a structured field: an atom, a quoted string, a domain literal or a special. */
export type Token = {
  kind: "atom" | "quoted" | "literal" | "special";
  value: string;
  spaced: boolean;
};

// atext (RFC 5322 3.2.3), and any character from U+0080 (RFC 6532 3.2).
const ATEXT = /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~\u0080-￿]/;
const SPACE = /[ \t\r\n]/;

/** The index just past the comment opening at `start`, or -1 when it never closes (RFC 5322 3.2.2). */
function commentEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The content of a quoted string or domain literal opening at `start` and closing at `close`, with
 * each quoting `\` removed and CR and LF dropped (RFC 5322 3.2.4, 3.4.1), or null when unclosed.
 */
function delimited(
  text: string,
  start: number,
  close: string,
): { value: string; end: number } | null {
  let value = "";
  for (let i = start + 1; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === close) return { value: value.replace(/[\r\n]/g, ""), end: i + 1 };
    value += c === "\\" ? text.charAt(++i) : c;
  }
  return null;
}

/**
 * Splits a structured field body into its words (RFC 5322 3.2). White space and comments set
 * `spaced` on the next word; an unclosed comment, quoted string or literal ends lexing with the
 * words so far and its problem.
 */
export function lex(text: string): { tokens: Token[]; problem: string | null } {
  const tokens: Token[] = [];
  let spaced = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (SPACE.test(c)) {
      spaced = true;
      i++;
    } else if (c === "(") {
      const end = commentEnd(text, i);
      if (end < 0) return { tokens, problem: "unclosed comment" };
      spaced = true;
      i = end;
    } else if (c === '"' || c === "[") {
      const quoted = c === '"';
      const found = delimited(text, i, quoted ? '"' : "]");
      if (found === null) {
        return { tokens, problem: quoted ? "unclosed quoted string" : "unclosed domain literal" };
      }
      tokens.push({ kind: quoted ? "quoted" : "literal", value: found.value, spaced });
      spaced = false;
      i = found.end;
    } else {
      let end = i + 1;
      while (ATEXT.test(c) && end < text.length && ATEXT.test(text.charAt(end))) end++;
      tokens.push({ kind: ATEXT.test(c) ? "atom" : "special", value: text.slice(i, end), spaced });
      spaced = false;
      i = end;
    }
  }
  return { tokens, problem: null };
}
