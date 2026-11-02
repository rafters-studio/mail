// Reading commands (RFC 3501 2.2): "The protocol receiver of an IMAP4rev1 client or server is
// either reading a line, or is reading a sequence of octets with a known count followed by a
// line." A command is framed that way first, line by line and literal by literal, and parsed
// only once it is whole, so a literal's octets may hold anything, CRLF included.

/** RFC 3501 9: one argument, an atom-like token, a string (quoted or literal), or a list. */
export type Value =
  | { kind: "atom"; text: string }
  | { kind: "string"; text: string }
  | { kind: "list"; items: Value[] };

/** RFC 3501 2.2.1: a tagged command, its name upper-cased. */
export type Command = { tag: string; name: string; args: Value[] };

/**
 * What the buffer holds at a command's start: a whole command, a command that cannot be read
 * (answered BAD with its tag, resumed after it), more needed (`literal` is the ordinal of the
 * synchronising literal whose octets are awaited, or 0), or a stream that cannot be resumed.
 */
export type Reading =
  | { kind: "command"; command: Command; end: number }
  | { kind: "bad"; tag: string; why: string; end: number }
  | { kind: "more"; literal: number }
  | { kind: "fatal"; why: string };

/** The largest literal accepted; a larger synchronising one is refused before its octets are sent. */
export const MAX_LITERAL = 1 << 20;

/** The longest unterminated line held while waiting for its end. */
export const MAX_LINE = 1 << 16;

// RFC 3501 9: tag = 1*<any ASTRING-CHAR except "+">.
// oxlint-disable-next-line no-control-regex -- a tag excludes the controls RFC 3501 9 names
const TAG = /^[^\x00-\x20(){%*"\\+\x7f-\xff]+/;
// RFC 3501 9, RFC 7888 3: a line that ends in "{n}" or "{n+}" is followed by n octets.
const LITERAL_AT_END = /\{(\d{1,10})(\+?)\}\r?$/;
const SPECIAL = /[ ()\r\n]/;

type Frame =
  | { kind: "framed"; end: number }
  | { kind: "toobig"; end: number }
  | { kind: "more"; literal: number }
  | { kind: "fatal"; why: string };

/** RFC 3501 2.2: a line, then for each "{n}" at its end n octets and another line, to the last line's LF. */
function frame(buf: string, start: number): Frame {
  let at = start;
  let literals = 0;
  // The last synchronising literal so far, and where its octets end: while nothing past that has
  // arrived the client may be waiting for its continuation ("{0}" included).
  let waiting = { literal: 0, end: -1 };
  for (;;) {
    const lf = buf.indexOf("\n", at);
    if (lf === -1) {
      if (buf.length - at > MAX_LINE) return { kind: "fatal", why: "line too long" };
      return { kind: "more", literal: waiting.end >= buf.length ? waiting.literal : 0 };
    }
    const m = LITERAL_AT_END.exec(buf.slice(at, lf));
    if (m === null) return { kind: "framed", end: lf + 1 };
    const n = Number(m[1]);
    // RFC 7888 4: a synchronising literal can be refused, for the client waits; a non-synchronising
    // one is already on its way and the stream cannot be resynchronised.
    if (m[2] === "+") {
      if (n > MAX_LITERAL) return { kind: "fatal", why: "literal too large" };
    } else {
      if (n > MAX_LITERAL) return { kind: "toobig", end: lf + 1 };
      literals++;
      waiting = { literal: literals, end: lf + 1 + n };
    }
    if (buf.length < lf + 1 + n)
      return { kind: "more", literal: waiting.end >= buf.length ? waiting.literal : 0 };
    at = lf + 1 + n;
  }
}

/**
 * RFC 3501 9: the arguments of one whole command (`text` ends at its final LF), or why it cannot
 * be read. Any failure inside, a nesting deeper than the stack included, is that command's BAD.
 */
function parse(text: string, tag: string): Command | string {
  let at = tag.length;
  let why = "unreadable command";
  /** RFC 3501 7.1.5: the command is BAD, for this reason. */
  const fail = (reason: string): never => {
    why = reason;
    throw new SyntaxError(reason);
  };
  /** RFC 3501 2.2: the next octet, not taken. */
  const peek = (): string => text.charAt(at);
  /** A lenient token to SP, "(", ")" or the line's end, "[...]" read whole (each command checks its own). */
  const token = (): string => {
    const from = at;
    let depth = 0;
    for (let c = peek(); depth > 0 || !SPECIAL.test(c); c = peek()) {
      if (c === "\r" || c === "\n") fail("line ended inside [ ]");
      depth = c === "[" ? depth + 1 : c === "]" ? Math.max(0, depth - 1) : depth;
      at++;
    }
    return text.slice(from, at);
  };
  /** RFC 3501 4.3: a quoted string; "\" escapes only DQUOTE and "\"; CR and LF are not allowed. */
  const quoted = (): Value => {
    let s = "";
    for (let c = text.charAt(++at); c !== '"'; c = text.charAt(++at)) {
      if (c === "\r" || c === "\n") fail("unterminated quoted string");
      if (c === "\\") {
        const e = text.charAt(++at);
        if (e !== '"' && e !== "\\") fail("bad escape in quoted string");
        s += e;
      } else s += c;
    }
    at++;
    return { kind: "string", text: s };
  };
  /** RFC 3501 4.3, RFC 7888: "{n}" or "{n+}", CRLF, then n octets, already framed. */
  const literal = (): Value => {
    // Sticky, so made here: a module-level one would share its lastIndex between calls.
    const marker = /\{(\d{1,10})\+?\}\r?\n/y;
    marker.lastIndex = at;
    const m = marker.exec(text) ?? fail("bad literal");
    at = marker.lastIndex + Number(m[1]);
    return { kind: "string", text: text.slice(marker.lastIndex, at) };
  };
  /** RFC 3501 4.4: a parenthesised list of values separated by SP; "()" is empty. */
  const list = (): Value => {
    const items: Value[] = [];
    at++;
    if (peek() === ")") return (at++, { kind: "list", items });
    for (;;) {
      items.push(value());
      const c = text.charAt(at++);
      if (c === ")") return { kind: "list", items };
      if (c !== " ") fail("expected SP or ) in a list");
    }
  };
  /** RFC 3501 9: one argument, a quoted string, a literal, a list or an atom-like token. */
  const value = (): Value => {
    const c = peek();
    if (c === '"') return quoted();
    if (c === "{") return literal();
    if (c === "(") return list();
    const t = token();
    return t === "" ? fail("empty argument") : { kind: "atom", text: t };
  };
  try {
    if (text.charAt(at++) !== " ") fail("expected SP after the tag");
    const name = token().toUpperCase();
    if (name === "") fail("no command");
    const args: Value[] = [];
    for (;;) {
      const c = text.charAt(at++);
      if (c === "\n" || (c === "\r" && peek() === "\n")) return { tag, name, args };
      if (c !== " ") fail("expected SP or CRLF");
      args.push(value());
    }
  } catch {
    return why;
  }
}

/** RFC 3501 2.2, 7.5: the command at the start of `buf`, as far as the buffer allows. */
export function readCommand(buf: string): Reading {
  const f = frame(buf, 0);
  if (f.kind === "more" || f.kind === "fatal") return f;
  const text = buf.slice(0, f.end);
  const tag = TAG.exec(text)?.[0];
  if (tag === undefined) return { kind: "bad", tag: "*", why: "no tag", end: f.end };
  if (f.kind === "toobig") return { kind: "bad", tag, why: "literal too large", end: f.end };
  // Narrowed to "framed", the last kind: a new Frame kind fails to type-check here.
  const read = parse(text, tag);
  return typeof read === "string"
    ? { kind: "bad", tag, why: read, end: f.end }
    : { kind: "command", command: read, end: f.end };
}

/** The text of an atom or string argument; null for a list or a missing one. */
export function text(v: Value | undefined): string | null {
  return v === undefined || v.kind === "list" ? null : v.text;
}

/** RFC 3501 9 seq-number: a number, or "*" for the largest in use. */
export type Bound = number | "*";
/** RFC 3501 9 seq-range: both ends included, in either order. */
export type SeqRange = { from: Bound; to: Bound };

const RANGE = /^(\*|[1-9]\d{0,9})(?::(\*|[1-9]\d{0,9}))?$/;
/** RFC 3501 9 seq-number: "*", or the number written. */
const bound = (s: string | undefined): Bound => (s === "*" ? "*" : Number(s));

/** RFC 3501 9 sequence-set: numbers, "*" and ranges, comma separated; null when it is not one. */
export function sequenceSet(set: string): SeqRange[] | null {
  const out: SeqRange[] = [];
  for (const item of set.split(",")) {
    const m = RANGE.exec(item);
    if (m === null) return null;
    const from = bound(m[1]);
    out.push({ from, to: m[2] === undefined ? from : bound(m[2]) });
  }
  return out;
}
