// Mailboxes and groups, obsolete forms included, RFC 5322 4.4: "When interpreting addresses, the
// route portion SHOULD be ignored." Routes, empty list elements and the white space and comments
// between the parts of an addr-spec are written by no writer and read by every reader.

import { lex, type Token } from "./lexer.ts";

/** A mailbox as written: its display name, or null, and its local part and domain. */
export type ReadMailbox = { name: string | null; local: string; domain: string };
/** A named group of mailboxes, which may be empty (RFC 5322 3.4). */
export type ReadGroup = { group: string; members: ReadMailbox[] };
/** One element of an address list. */
export type ReadAddress = ReadMailbox | ReadGroup;

type Parsed<T> = { value: T; next: number } | null;

/** Whether the token at `i` is the special character `c`. */
function special(tokens: Token[], i: number, c: string): boolean {
  const t = tokens[i];
  return t !== undefined && t.kind === "special" && t.value === c;
}

/**
 * A phrase (RFC 5322 3.2.5, 4.1): words and dots, joined with one space where white space or a
 * comment stood between them, so `Joe Q. Public` reads as written.
 */
function phrase(tokens: Token[], start: number): Parsed<string> {
  let text = "";
  let i = start;
  for (let t = tokens[i]; t !== undefined; t = tokens[++i]) {
    if (t.kind === "literal" || (t.kind === "special" && t.value !== ".")) break;
    text += i > start && t.spaced ? ` ${t.value}` : t.value;
  }
  return i > start ? { value: text, next: i } : null;
}

/** A word of a local part, a quoted string keeping its quotes (RFC 5322 3.4.1). */
function word(t: Token | undefined): string | null {
  return t === undefined
    ? null
    : t.kind === "atom"
      ? t.value
      : t.kind === "quoted"
        ? `"${t.value}"`
        : null;
}

/** A dot-separated name of words (RFC 5322 3.4.1, 4.4), dots with white space around them included. */
function dotted(
  tokens: Token[],
  start: number,
  words: (t: Token | undefined) => string | null,
): Parsed<string> {
  const first = words(tokens[start]);
  if (first === null) return null;
  let value = first;
  let i = start + 1;
  for (
    let more = words(tokens[i + 1]);
    special(tokens, i, ".") && more !== null;
    more = words(tokens[i + 1])
  ) {
    value += `.${more}`;
    i += 2;
  }
  return { value, next: i };
}

/** A domain: atoms and dots, or one domain literal kept with its brackets (RFC 5322 3.4.1). */
function domain(tokens: Token[], start: number): Parsed<string> {
  const t = tokens[start];
  return t !== undefined && t.kind === "literal"
    ? { value: `[${t.value}]`, next: start + 1 }
    : dotted(tokens, start, (a) => (a !== undefined && a.kind === "atom" ? a.value : null));
}

/** An addr-spec, `local@domain` (RFC 5322 3.4.1). */
function addrSpec(tokens: Token[], start: number, name: string | null): Parsed<ReadMailbox> {
  const local = dotted(tokens, start, word);
  if (local === null || !special(tokens, local.next, "@")) return null;
  const host = domain(tokens, local.next + 1);
  return host === null
    ? null
    : { value: { name, local: local.value, domain: host.value }, next: host.next };
}

/** A mailbox: a phrase and an angle address with an optional route to drop (RFC 5322 4.4), or an addr-spec alone. */
function mailbox(tokens: Token[], start: number): Parsed<ReadMailbox> {
  const name = phrase(tokens, start);
  let i = name === null ? start : name.next;
  if (!special(tokens, i, "<")) return addrSpec(tokens, start, null);
  i++;
  if (special(tokens, i, "@")) {
    while (i < tokens.length && !special(tokens, i, ":")) i++;
    i++;
  }
  const spec = addrSpec(tokens, i, name === null ? null : name.value);
  return spec === null || !special(tokens, spec.next, ">")
    ? null
    : { value: spec.value, next: spec.next + 1 };
}

/** A group: a phrase, `:`, mailboxes each ended by `,` or `;`, empty elements skipped, and `;` (RFC 5322 3.4, 4.4). */
function group(tokens: Token[], start: number): Parsed<ReadGroup> {
  const name = phrase(tokens, start);
  if (name === null || !special(tokens, name.next, ":")) return null;
  const members: ReadMailbox[] = [];
  let i = name.next + 1;
  while (!special(tokens, i, ";")) {
    if (special(tokens, i, ",")) {
      i++;
      continue;
    }
    const m = mailbox(tokens, i);
    if (m === null || !(special(tokens, m.next, ",") || special(tokens, m.next, ";"))) return null;
    members.push(m.value);
    i = m.next;
  }
  return { value: { group: name.value, members }, next: i + 1 };
}

/**
 * Reads an address list (RFC 5322 3.4, 4.4): addresses separated by commas, empty elements
 * skipped. Null when the field does not lex or any element fits no grammar; the caller records it.
 */
export function readAddresses(text: string): ReadAddress[] | null {
  const { tokens, problem } = lex(text);
  if (problem !== null) return null;
  const list: ReadAddress[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (special(tokens, i, ",")) {
      i++;
      continue;
    }
    const a = group(tokens, i) ?? mailbox(tokens, i);
    if (a === null || !(a.next === tokens.length || special(tokens, a.next, ","))) return null;
    list.push(a.value);
    i = a.next;
  }
  return list;
}

/** ASCII-only lowercase: `A`-`Z` alone, so the Kelvin sign stays itself (RFC 5322 3.4.1). */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * Whether two mailboxes are one address (RFC 5322 3.4.1): "the domain portion ... is
 * case-insensitive", ASCII case only, and the local part compares exactly.
 */
export function sameMailbox(a: ReadMailbox, b: ReadMailbox): boolean {
  return a.local === b.local && asciiLower(a.domain) === asciiLower(b.domain);
}
