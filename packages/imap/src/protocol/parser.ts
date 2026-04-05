/**
 * IMAP4rev1 (RFC 3501) command parser.
 *
 * Parses client commands into structured objects. Handles atoms,
 * quoted strings, literals, parenthesized lists, sequence sets,
 * FETCH data items, and SEARCH criteria.
 */

export interface ParsedCommand {
  tag: string;
  command: string;
  args: string;
}

export interface SequenceRange {
  start: number | "*";
  end?: number | "*";
}

export type SequenceSet = SequenceRange[];

export type FetchItem =
  | "FLAGS"
  | "ENVELOPE"
  | "BODYSTRUCTURE"
  | "BODY"
  | "INTERNALDATE"
  | "RFC822.SIZE"
  | "UID"
  | { type: "BODY"; section: string; peek: boolean; partial?: { offset: number; count: number } };

export type SearchCriterion =
  | { type: "flag"; flag: string; negated: boolean }
  | { type: "header"; field: string; value: string }
  | { type: "date"; comparison: "before" | "on" | "since"; date: string }
  | { type: "size"; comparison: "larger" | "smaller"; size: number }
  | { type: "text"; scope: "text" | "body"; value: string }
  | { type: "uid"; set: SequenceSet }
  | { type: "all" }
  | { type: "not"; criterion: SearchCriterion }
  | { type: "or"; left: SearchCriterion; right: SearchCriterion }
  | { type: "sequence"; set: SequenceSet }
  | { type: "new" };

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.replace(/\r?\n$/, "");
  if (trimmed.length === 0) {
    throw new ImapParseError("Empty command");
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    throw new ImapParseError("Missing command after tag");
  }

  const tag = trimmed.slice(0, spaceIndex);
  if (!isValidTag(tag)) {
    throw new ImapParseError(`Invalid tag: ${tag}`);
  }

  const rest = trimmed.slice(spaceIndex + 1);
  const cmdSpaceIndex = rest.indexOf(" ");

  let command: string;
  let args: string;

  if (cmdSpaceIndex === -1) {
    command = rest;
    args = "";
  } else {
    command = rest.slice(0, cmdSpaceIndex);
    args = rest.slice(cmdSpaceIndex + 1);
  }

  return {
    tag,
    command: command.toUpperCase(),
    args,
  };
}

export function parseSequenceSet(input: string): SequenceSet {
  if (input.length === 0) {
    throw new ImapParseError("Empty sequence set");
  }

  const ranges: SequenceSet = [];

  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new ImapParseError("Empty range in sequence set");
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      ranges.push({ start: parseSeqNumber(trimmed) });
    } else {
      const start = parseSeqNumber(trimmed.slice(0, colonIndex));
      const end = parseSeqNumber(trimmed.slice(colonIndex + 1));
      ranges.push({ start, end });
    }
  }

  return ranges;
}

const FETCH_MACROS: Record<string, FetchItem[]> = {
  ALL: ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"],
  FAST: ["FLAGS", "INTERNALDATE", "RFC822.SIZE"],
  FULL: ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODYSTRUCTURE"],
};

const SIMPLE_FETCH_ITEMS: [string, FetchItem][] = [
  ["BODYSTRUCTURE", "BODYSTRUCTURE"],
  ["BODY", "BODY"],
  ["ENVELOPE", "ENVELOPE"],
  ["FLAGS", "FLAGS"],
  ["INTERNALDATE", "INTERNALDATE"],
  ["RFC822.SIZE", "RFC822.SIZE"],
  ["UID", "UID"],
];

export function parseFetchItems(input: string): FetchItem[] {
  const trimmed = input.trim();

  const upper = trimmed.toUpperCase();
  const macro = FETCH_MACROS[upper];
  if (macro !== undefined) {
    return macro;
  }

  let source = trimmed;
  if (source.startsWith("(") && source.endsWith(")")) {
    source = source.slice(1, -1).trim();
  }

  const items: FetchItem[] = [];
  let pos = 0;

  while (pos < source.length) {
    while (pos < source.length && source[pos] === " ") {
      pos++;
    }
    if (pos >= source.length) break;

    const remaining = source.slice(pos).toUpperCase();

    if (remaining.startsWith("BODY.PEEK[") || remaining.startsWith("BODY[")) {
      const peek = remaining.startsWith("BODY.PEEK[");
      const bracketStart = source.indexOf("[", pos);
      const bracketEnd = source.indexOf("]", bracketStart);
      if (bracketEnd === -1) {
        throw new ImapParseError("Unterminated BODY[] section specifier");
      }

      const section = source.slice(bracketStart + 1, bracketEnd);
      let endPos = bracketEnd + 1;
      let partial: { offset: number; count: number } | undefined;

      if (endPos < source.length && source[endPos] === "<") {
        const angleEnd = source.indexOf(">", endPos);
        if (angleEnd === -1) {
          throw new ImapParseError("Unterminated partial specifier");
        }
        const partialStr = source.slice(endPos + 1, angleEnd);
        const dotIndex = partialStr.indexOf(".");
        if (dotIndex === -1) {
          throw new ImapParseError("Invalid partial specifier format");
        }
        const offset = parseStrictInt(partialStr.slice(0, dotIndex), "partial offset");
        const count = parseStrictInt(partialStr.slice(dotIndex + 1), "partial count");
        if (offset < 0) {
          throw new ImapParseError(`Partial offset must be non-negative: ${offset}`);
        }
        if (count < 1) {
          throw new ImapParseError(`Partial count must be positive: ${count}`);
        }
        partial = { offset, count };
        endPos = angleEnd + 1;
      }

      const item: FetchItem = partial !== undefined
        ? { type: "BODY", section, peek, partial }
        : { type: "BODY", section, peek };
      items.push(item);
      pos = endPos;
    } else {
      let matched = false;
      for (const [keyword, item] of SIMPLE_FETCH_ITEMS) {
        if (remaining.startsWith(keyword) && (remaining.length === keyword.length || remaining[keyword.length] === " " || remaining[keyword.length] === ")")) {
          items.push(item);
          pos += keyword.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        throw new ImapParseError(`Unknown FETCH item at position ${pos}: ${source.slice(pos, pos + 20)}`);
      }
    }
  }

  if (items.length === 0) {
    throw new ImapParseError("Empty FETCH item list");
  }

  return items;
}

const FLAG_CRITERIA: Record<string, { flag: string; negated: boolean }> = {
  ANSWERED: { flag: "\\Answered", negated: false },
  DELETED: { flag: "\\Deleted", negated: false },
  DRAFT: { flag: "\\Draft", negated: false },
  FLAGGED: { flag: "\\Flagged", negated: false },
  OLD: { flag: "\\Recent", negated: true },
  RECENT: { flag: "\\Recent", negated: false },
  SEEN: { flag: "\\Seen", negated: false },
  UNANSWERED: { flag: "\\Answered", negated: true },
  UNDELETED: { flag: "\\Deleted", negated: true },
  UNDRAFT: { flag: "\\Draft", negated: true },
  UNFLAGGED: { flag: "\\Flagged", negated: true },
  UNSEEN: { flag: "\\Seen", negated: true },
};

export function parseSearchCriteria(input: string): SearchCriterion[] {
  const criteria: SearchCriterion[] = [];
  const tokens = tokenize(input);
  let pos = 0;

  function next(): string {
    if (pos >= tokens.length) {
      throw new ImapParseError("Unexpected end of search criteria");
    }
    return tokens[pos++] as string;
  }

  function parseCriterion(): SearchCriterion {
    const token = next().toUpperCase();

    const flagCriterion = FLAG_CRITERIA[token];
    if (flagCriterion) {
      return { type: "flag", ...flagCriterion };
    }

    switch (token) {
      case "ALL":
        return { type: "all" };

      case "NEW":
        return { type: "new" };

      case "FROM":
      case "TO":
      case "CC":
      case "BCC":
      case "SUBJECT":
        return { type: "header", field: token.toLowerCase(), value: next() };

      case "BEFORE":
        return { type: "date", comparison: "before", date: next() };
      case "ON":
        return { type: "date", comparison: "on", date: next() };
      case "SINCE":
        return { type: "date", comparison: "since", date: next() };

      case "LARGER":
        return { type: "size", comparison: "larger", size: parseStrictInt(next(), "LARGER size") };
      case "SMALLER":
        return { type: "size", comparison: "smaller", size: parseStrictInt(next(), "SMALLER size") };

      case "TEXT":
        return { type: "text", scope: "text", value: next() };
      case "BODY":
        return { type: "text", scope: "body", value: next() };

      case "UID":
        return { type: "uid", set: parseSequenceSet(next()) };

      case "NOT":
        return { type: "not", criterion: parseCriterion() };

      case "OR":
        return { type: "or", left: parseCriterion(), right: parseCriterion() };

      default: {
        try {
          return { type: "sequence", set: parseSequenceSet(token) };
        } catch (error: unknown) {
          if (error instanceof ImapParseError) {
            throw new ImapParseError(`Unknown search criterion: ${token}`);
          }
          throw error;
        }
      }
    }
  }

  while (pos < tokens.length) {
    criteria.push(parseCriterion());
  }

  return criteria;
}

export function parseQuotedString(input: string, startPos: number): { value: string; endPos: number } {
  if (input[startPos] !== '"') {
    throw new ImapParseError(`Expected quoted string at position ${startPos}`);
  }

  const chars: string[] = [];
  let pos = startPos + 1;

  while (pos < input.length) {
    const char = input[pos] as string;

    if (char === "\\") {
      pos++;
      if (pos >= input.length) {
        throw new ImapParseError("Unterminated escape in quoted string");
      }
      chars.push(input[pos] as string);
      pos++;
    } else if (char === '"') {
      return { value: chars.join(""), endPos: pos + 1 };
    } else {
      chars.push(char);
      pos++;
    }
  }

  throw new ImapParseError("Unterminated quoted string");
}

const LITERAL_RE = /^\{(\d+)(\+)?\}$/;
const MAX_LITERAL_BYTES = 50 * 1024 * 1024;

export function parseLiteral(input: string): { byteCount: number; continuation: boolean } {
  const match = LITERAL_RE.exec(input);
  if (!match) {
    throw new ImapParseError(`Invalid literal syntax: ${input}`);
  }

  const byteCount = Number.parseInt(match[1] as string, 10);
  if (byteCount > MAX_LITERAL_BYTES) {
    throw new ImapParseError(`Literal size ${byteCount} exceeds maximum allowed (${MAX_LITERAL_BYTES})`);
  }

  return {
    byteCount,
    continuation: match[2] === "+",
  };
}

export function parseParenthesizedList(input: string, startPos: number): { items: string[]; endPos: number } {
  if (input[startPos] !== "(") {
    throw new ImapParseError(`Expected parenthesized list at position ${startPos}`);
  }

  const items: string[] = [];
  let pos = startPos + 1;

  while (pos < input.length) {
    while (pos < input.length && input[pos] === " ") {
      pos++;
    }

    if (pos >= input.length) {
      throw new ImapParseError("Unterminated parenthesized list");
    }

    if (input[pos] === ")") {
      return { items, endPos: pos + 1 };
    }

    if (input[pos] === '"') {
      const result = parseQuotedString(input, pos);
      items.push(result.value);
      pos = result.endPos;
    } else if (input[pos] === "(") {
      const openPos = pos;
      let depth = 1;
      pos++;
      while (pos < input.length && depth > 0) {
        if (input[pos] === "(") depth++;
        else if (input[pos] === ")") depth--;
        pos++;
      }
      items.push(input.slice(openPos, pos));
    } else {
      const start = pos;
      while (pos < input.length && input[pos] !== " " && input[pos] !== ")") {
        pos++;
      }
      items.push(input.slice(start, pos));
    }
  }

  throw new ImapParseError("Unterminated parenthesized list");
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let pos = 0;

  while (pos < input.length) {
    while (pos < input.length && input[pos] === " ") {
      pos++;
    }
    if (pos >= input.length) break;

    if (input[pos] === '"') {
      const result = parseQuotedString(input, pos);
      tokens.push(result.value);
      pos = result.endPos;
    } else if (input[pos] === "(") {
      const result = parseParenthesizedList(input, pos);
      tokens.push(`(${result.items.join(" ")})`);
      pos = result.endPos;
    } else {
      const start = pos;
      while (pos < input.length && input[pos] !== " " && input[pos] !== "(" && input[pos] !== ")") {
        pos++;
      }
      tokens.push(input.slice(start, pos));
    }
  }

  return tokens;
}

function parseStrictInt(input: string, label: string): number {
  if (!/^\d+$/.test(input)) {
    throw new ImapParseError(`Invalid ${label}: ${input}`);
  }
  const num = Number.parseInt(input, 10);
  if (!Number.isFinite(num)) {
    throw new ImapParseError(`Invalid ${label}: ${input}`);
  }
  return num;
}

function parseSeqNumber(input: string): number | "*" {
  const trimmed = input.trim();
  if (trimmed === "*") return "*";

  if (trimmed.length > 1 && trimmed[0] === "0") {
    throw new ImapParseError(`Invalid sequence number (leading zero): ${input}`);
  }

  const num = parseStrictInt(trimmed, "sequence number");
  if (num < 1) {
    throw new ImapParseError(`Invalid sequence number: ${input}`);
  }
  return num;
}

function isValidTag(tag: string): boolean {
  if (tag === "" || tag === "+") return false;
  for (let i = 0; i < tag.length; i++) {
    const code = tag.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f || tag[i] === "+" || tag[i] === "*" || tag[i] === "{" || tag[i] === "}") {
      return false;
    }
  }
  return true;
}

export class ImapParseError extends Error {
  override readonly name = "ImapParseError";

  constructor(message: string) {
    super(message);
  }
}
