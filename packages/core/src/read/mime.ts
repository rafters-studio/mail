// The tree of parts as byte ranges, RFC 2046 5.1.1: "The boundary delimiter MUST occur at the
// beginning of a line, i.e., following a CRLF, and the initial CRLF is considered to be attached
// to the boundary delimiter line rather than part of the preceding part." Nothing is decoded to
// build the tree; IMAP serves its ranges as they are.

import { bytesOf } from "./decode.ts";
import { headerFieldsAt, type Field } from "./fields.ts";
import type { Problem } from "./index.ts";

/** A range of the stored bytes, `[start, end)`. */
export type Range = { start: number; end: number };
/** One part: its header and body as ranges, its Content-Type, and the parts inside it. */
export type Part = {
  header: Range;
  body: Range;
  type: string;
  params: Record<string, string>;
  children: Part[];
  message: Part | null;
};

/** The nesting depth at which a multipart or message part is read as a leaf; the root is depth 0. */
export const MAX_DEPTH = 50;

// The parts of a message read, the root among them, so no message of parts runs a reader out of
// memory (FR-MAIL-045).
const MAX_PARTS = 10_000;

/** What reading one message's tree has found so far: its problems and how many parts it has read. */
type Walk = { problems: Problem[]; parts: number };

/** Says whether `walk` has read all the parts it may, recording that once. */
function spent(walk: Walk): boolean {
  if (walk.parts < MAX_PARTS) return false;
  if (!walk.problems.some((p) => p.code === "too-many-parts"))
    walk.problems.push({
      code: "too-many-parts",
      field: "content-type",
      detail: `parts over ${MAX_PARTS}`,
    });
  return true;
}

/** A Content-Type value's type and parameters (RFC 2045 5.1), names lowercased, quotes removed. */
export function contentType(value: string): { type: string; params: Record<string, string> } {
  const semicolon = value.indexOf(";");
  const type = (semicolon < 0 ? value : value.slice(0, semicolon)).trim().toLowerCase();
  const params: Record<string, string> = {};
  const rest = semicolon < 0 ? "" : value.slice(semicolon);
  for (const [, name = "", quoted, plain = ""] of rest.matchAll(
    /;\s*([^\s=;]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;\s]*))/g,
  )) {
    params[name.toLowerCase()] = quoted === undefined ? plain : quoted.replace(/\\(.)/g, "$1");
  }
  return { type, params };
}

/** Where the next CRLF from `at` starts, or -1; like a text search, it may lie past a part's end. */
function crlf(bytes: Uint8Array, at: number): number {
  let cr = bytes.indexOf(13, at);
  while (cr >= 0 && bytes[cr + 1] !== 10) cr = bytes.indexOf(13, cr + 1);
  return cr;
}

/** Where the earliest empty line in `[start, end)` starts, or -1: only a CRLF ends a line of a part. */
function emptyLine(bytes: Uint8Array, start: number, end: number): number {
  for (let at = start; ; ) {
    const eol = crlf(bytes, at);
    if (eol < 0 || eol + 2 > end) return -1;
    if (eol === at) return at;
    at = eol + 2;
  }
}

/** What follows a boundary on its line up to `stop`: `--` or not, then white space and nothing else. */
function afterBoundary(
  bytes: Uint8Array,
  at: number,
  stop: number,
): { blank: boolean; close: boolean } {
  const close = at + 2 <= stop && bytes[at] === 45 && bytes[at + 1] === 45;
  let rest = close ? at + 2 : at;
  while (rest < stop && (bytes[rest] === 32 || bytes[rest] === 9)) rest += 1;
  return { blank: rest === stop, close };
}

/**
 * The delimiter lines of `boundary` in `[start, end)` (RFC 2046 5.1.1): lines that are exactly
 * `--`, the boundary, an optional `--` and white space. Each runs from the CRLF before it, which
 * the line at the body's start does without, to the CRLF after it, which the end may stand for.
 * Finding stops at `limit` lines.
 */
function delimiters(
  bytes: Uint8Array,
  start: number,
  end: number,
  boundary: string,
  limit: number,
): { from: number; to: number; close: boolean }[] {
  const found: { from: number; to: number; close: boolean }[] = [];
  const dashes = bytesOf(`--${boundary}`);
  for (let at = start; at <= end && found.length < limit; ) {
    const eol = crlf(bytes, at);
    const stop = eol < 0 || eol > end ? end : eol;
    if (stop - at >= dashes.length && dashes.every((b, i) => bytes[at + i] === b)) {
      const tail = afterBoundary(bytes, at + dashes.length, stop);
      if (tail.blank)
        found.push({
          from: at === start ? at : at - 2,
          to: Math.min(stop + 2, end),
          close: tail.close,
        });
    }
    at = stop + 2;
  }
  return found;
}

/**
 * Parses the part in `[start, end)` (RFC 2045 5, RFC 2046 5.1.1): its header up to the first CRLF
 * CRLF, its Content-Type (`text/plain` by default, `message/rfc822` in a digest), and its message
 * or children, recording a multipart with no boundary or no closing delimiter. A multipart or
 * message at depth `MAX_DEPTH` is read as a leaf, so no message nests deep enough to throw. Once
 * `MAX_PARTS` are read no more are, and what is left stays unread inside its parent.
 */
function part(
  bytes: Uint8Array,
  start: number,
  end: number,
  digest: boolean,
  depth: number,
  walk: Walk,
): Part {
  walk.parts += 1;
  // The earliest empty line; a part that begins with CRLF has an empty header.
  const blank = emptyLine(bytes, start, end);
  const header = { start, end: blank < 0 ? end : blank };
  const body = { start: blank < 0 ? end : blank + 2, end };
  const own = headerFieldsAt(bytes, header.start, header.end);
  // readMessage records the root's own, which is the message's header section.
  if (depth > 0) walk.problems.push(...own.problems.filter((p) => p.code === "header-too-large"));
  const field = own.fields.find((f) => f.name.toLowerCase() === "content-type");
  const { type, params } = contentType(
    field === undefined ? (digest ? "message/rfc822" : "text/plain") : field.value,
  );
  const read: Part = { header, body, type, params, children: [], message: null };
  const nests = type === "message/rfc822" || type.startsWith("multipart/");
  if (nests && depth >= MAX_DEPTH) {
    walk.problems.push({
      code: "too-deep",
      field: "content-type",
      detail: `nesting over ${MAX_DEPTH}`,
    });
    return read;
  }
  if (type === "message/rfc822" && !spent(walk))
    read.message = part(bytes, body.start, body.end, false, depth + 1, walk);
  if (!type.startsWith("multipart/")) return read;
  const boundary = params["boundary"] ?? "";
  if (boundary === "") {
    walk.problems.push({ code: "multipart-no-boundary", field: "content-type", detail: type });
    return read;
  }
  // Each delimiter but the closing one starts a part, which the next delimiter or the end ends;
  // one past the parts left says where the last of them ends.
  const lines = delimiters(bytes, body.start, body.end, boundary, MAX_PARTS - walk.parts + 1);
  const closing = lines.findIndex((d) => d.close);
  const opening = closing < 0 ? lines : lines.slice(0, closing);
  for (const [i, d] of opening.entries()) {
    if (spent(walk)) break;
    const next = lines[i + 1];
    read.children.push(
      part(
        bytes,
        d.to,
        next === undefined ? end : next.from,
        type === "multipart/digest",
        depth + 1,
        walk,
      ),
    );
  }
  // A multipart the bound stopped was not read to its end, so it is not known to be unclosed.
  if (closing < 0 && read.children.length === opening.length)
    walk.problems.push({ code: "multipart-unclosed", field: "content-type", detail: boundary });
  return read;
}

/** Parses a whole message into its tree of parts (RFC 2046 5.1.1), with the problems found on the way. */
export function parseParts(bytes: Uint8Array): { root: Part; problems: Problem[] } {
  const walk: Walk = { problems: [], parts: 0 };
  return { root: part(bytes, 0, bytes.length, false, 0, walk), problems: walk.problems };
}

/** A part's own header fields in order (RFC 9051 7.5.2), read as `headerFields` reads a message's. */
export function partFields(bytes: Uint8Array, part: Part): Field[] {
  return headerFieldsAt(bytes, part.header.start, part.header.end).fields;
}

/** A part's body lines as IMAP counts them (RFC 9051 7.5.2): each LF, and a last line with none. */
export function bodyLines(bytes: Uint8Array, part: Part): number {
  const body = bytes.subarray(part.body.start, part.body.end);
  let lines = body.length === 0 || body.at(-1) === 10 ? 0 : 1;
  for (let lf = body.indexOf(10); lf >= 0; lf = body.indexOf(10, lf + 1)) lines += 1;
  return lines;
}

/**
 * The part at an IMAP section path such as `1.2` (RFC 9051 6.4.5), or null when there is none: a
 * message/rfc822 part stands for its message, and a part with no children answers only `1`, and
 * only when it is the root or a message's body.
 */
export function section(root: Part, path: string): Part | null {
  let at: Part | null = root;
  for (const [i, step] of path.split(".").entries()) {
    if (at === null) return null;
    const here: Part = at.message ?? at;
    const n = Number(step);
    at =
      here.children.length > 0
        ? (here.children[n - 1] ?? null)
        : n === 1 && (i === 0 || here !== at)
          ? here
          : null;
  }
  return at;
}
