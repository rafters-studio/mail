import { describe, it, expect } from "vitest";
import {
  parseCommand,
  parseSequenceSet,
  parseFetchItems,
  parseSearchCriteria,
  parseQuotedString,
  parseLiteral,
  parseParenthesizedList,
  ImapParseError,
} from "../../src/protocol/parser.ts";

describe("parseCommand", () => {
  it("parses a simple command with no arguments", () => {
    const result = parseCommand("a001 NOOP");
    expect(result).toEqual({ tag: "a001", command: "NOOP", args: "" });
  });

  it("parses a command with arguments", () => {
    const result = parseCommand("a002 LOGIN user pass");
    expect(result).toEqual({ tag: "a002", command: "LOGIN", args: "user pass" });
  });

  it("uppercases the command name", () => {
    const result = parseCommand("a003 select INBOX");
    expect(result).toEqual({ tag: "a003", command: "SELECT", args: "INBOX" });
  });

  it("preserves argument casing", () => {
    const result = parseCommand("a004 SELECT MyFolder");
    expect(result.args).toBe("MyFolder");
  });

  it("handles tags with dots and numbers", () => {
    const result = parseCommand("tag.123 CAPABILITY");
    expect(result.tag).toBe("tag.123");
  });

  it("strips trailing CRLF", () => {
    const result = parseCommand("a001 NOOP\r\n");
    expect(result).toEqual({ tag: "a001", command: "NOOP", args: "" });
  });

  it("strips trailing LF", () => {
    const result = parseCommand("a001 NOOP\n");
    expect(result).toEqual({ tag: "a001", command: "NOOP", args: "" });
  });

  it("throws on empty input", () => {
    expect(() => parseCommand("")).toThrow(ImapParseError);
    expect(() => parseCommand("")).toThrow("Empty command");
  });

  it("throws on tag only without command", () => {
    expect(() => parseCommand("a001")).toThrow(ImapParseError);
    expect(() => parseCommand("a001")).toThrow("Missing command after tag");
  });

  it("throws on tag with asterisk", () => {
    expect(() => parseCommand("* NOOP")).toThrow(ImapParseError);
    expect(() => parseCommand("* NOOP")).toThrow("Invalid tag");
  });

  it("throws on tag with plus", () => {
    expect(() => parseCommand("+ NOOP")).toThrow(ImapParseError);
  });

  it("throws on tag with curly braces", () => {
    expect(() => parseCommand("{tag} NOOP")).toThrow(ImapParseError);
  });
});

describe("parseSequenceSet", () => {
  it("parses a single number", () => {
    expect(parseSequenceSet("1")).toEqual([{ start: 1 }]);
  });

  it("parses a range", () => {
    expect(parseSequenceSet("1:10")).toEqual([{ start: 1, end: 10 }]);
  });

  it("parses wildcard", () => {
    expect(parseSequenceSet("1:*")).toEqual([{ start: 1, end: "*" }]);
  });

  it("parses lone wildcard", () => {
    expect(parseSequenceSet("*")).toEqual([{ start: "*" }]);
  });

  it("parses comma-separated ranges", () => {
    expect(parseSequenceSet("1,3,5:7")).toEqual([{ start: 1 }, { start: 3 }, { start: 5, end: 7 }]);
  });

  it("parses complex sequence set", () => {
    expect(parseSequenceSet("1:3,5,7:*")).toEqual([
      { start: 1, end: 3 },
      { start: 5 },
      { start: 7, end: "*" },
    ]);
  });

  it("throws on empty input", () => {
    expect(() => parseSequenceSet("")).toThrow(ImapParseError);
  });

  it("throws on zero", () => {
    expect(() => parseSequenceSet("0")).toThrow(ImapParseError);
  });

  it("throws on negative number", () => {
    expect(() => parseSequenceSet("-1")).toThrow(ImapParseError);
  });

  it("throws on non-numeric input", () => {
    expect(() => parseSequenceSet("abc")).toThrow(ImapParseError);
  });

  it("throws on trailing garbage after number", () => {
    expect(() => parseSequenceSet("5foo")).toThrow(ImapParseError);
  });

  it("throws on leading zeros", () => {
    expect(() => parseSequenceSet("01")).toThrow(ImapParseError);
  });
});

describe("parseFetchItems", () => {
  it("parses a single simple item", () => {
    expect(parseFetchItems("FLAGS")).toEqual(["FLAGS"]);
  });

  it("parses parenthesized list of items", () => {
    expect(parseFetchItems("(FLAGS UID)")).toEqual(["FLAGS", "UID"]);
  });

  it("expands ALL macro", () => {
    expect(parseFetchItems("ALL")).toEqual(["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"]);
  });

  it("expands FAST macro", () => {
    expect(parseFetchItems("FAST")).toEqual(["FLAGS", "INTERNALDATE", "RFC822.SIZE"]);
  });

  it("expands FULL macro", () => {
    expect(parseFetchItems("FULL")).toEqual([
      "FLAGS",
      "INTERNALDATE",
      "RFC822.SIZE",
      "ENVELOPE",
      "BODYSTRUCTURE",
    ]);
  });

  it("parses BODY[] section specifier", () => {
    const result = parseFetchItems("BODY[]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "", peek: false });
    expect((result[0] as { partial?: unknown }).partial).toBeUndefined();
  });

  it("parses BODY[HEADER] section", () => {
    const result = parseFetchItems("BODY[HEADER]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "HEADER", peek: false });
  });

  it("parses BODY[TEXT] section", () => {
    const result = parseFetchItems("BODY[TEXT]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "TEXT", peek: false });
  });

  it("parses BODY.PEEK[] with peek flag", () => {
    const result = parseFetchItems("BODY.PEEK[HEADER]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "HEADER", peek: true });
  });

  it("parses BODY[] with partial specifier", () => {
    const result = parseFetchItems("BODY[]<0.1024>");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "BODY",
      section: "",
      peek: false,
      partial: { offset: 0, count: 1024 },
    });
  });

  it("parses BODY[1] MIME part number", () => {
    const result = parseFetchItems("BODY[1]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "1", peek: false });
  });

  it("parses multiple items with BODY sections", () => {
    const result = parseFetchItems("(FLAGS UID BODY.PEEK[HEADER])");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("FLAGS");
    expect(result[1]).toBe("UID");
    expect(result[2]).toMatchObject({ type: "BODY", section: "HEADER", peek: true });
  });

  it("parses RFC822.SIZE", () => {
    expect(parseFetchItems("RFC822.SIZE")).toEqual(["RFC822.SIZE"]);
  });

  it("throws on unterminated BODY section", () => {
    expect(() => parseFetchItems("BODY[HEADER")).toThrow(ImapParseError);
  });

  it("throws on unknown item", () => {
    expect(() => parseFetchItems("FOOBAR")).toThrow(ImapParseError);
  });

  it("throws on empty parenthesized list", () => {
    expect(() => parseFetchItems("()")).toThrow(ImapParseError);
    expect(() => parseFetchItems("()")).toThrow("Empty FETCH item list");
  });

  it("parses nested MIME part section", () => {
    const result = parseFetchItems("BODY[1.2.HEADER]");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "BODY", section: "1.2.HEADER", peek: false });
  });
});

describe("parseSearchCriteria", () => {
  it("parses ALL", () => {
    const result = parseSearchCriteria("ALL");
    expect(result).toEqual([{ type: "all" }]);
  });

  it("parses flag criteria", () => {
    expect(parseSearchCriteria("SEEN")).toEqual([{ type: "flag", flag: "\\Seen", negated: false }]);
  });

  it("parses negated flag criteria", () => {
    expect(parseSearchCriteria("UNSEEN")).toEqual([
      { type: "flag", flag: "\\Seen", negated: true },
    ]);
  });

  it("parses header search", () => {
    expect(parseSearchCriteria('FROM "alice@example.com"')).toEqual([
      { type: "header", field: "from", value: "alice@example.com" },
    ]);
  });

  it("parses subject search", () => {
    expect(parseSearchCriteria('SUBJECT "invoice"')).toEqual([
      { type: "header", field: "subject", value: "invoice" },
    ]);
  });

  it("parses date criteria", () => {
    expect(parseSearchCriteria("SINCE 1-Mar-2026")).toEqual([
      { type: "date", comparison: "since", date: "1-Mar-2026" },
    ]);
  });

  it("parses BEFORE date", () => {
    expect(parseSearchCriteria("BEFORE 15-Jan-2026")).toEqual([
      { type: "date", comparison: "before", date: "15-Jan-2026" },
    ]);
  });

  it("parses size criteria", () => {
    expect(parseSearchCriteria("LARGER 10000")).toEqual([
      { type: "size", comparison: "larger", size: 10000 },
    ]);
  });

  it("parses text search", () => {
    expect(parseSearchCriteria('TEXT "refund"')).toEqual([
      { type: "text", scope: "text", value: "refund" },
    ]);
  });

  it("parses body search", () => {
    expect(parseSearchCriteria('BODY "urgent"')).toEqual([
      { type: "text", scope: "body", value: "urgent" },
    ]);
  });

  it("parses UID search", () => {
    expect(parseSearchCriteria("UID 1:*")).toEqual([
      { type: "uid", set: [{ start: 1, end: "*" }] },
    ]);
  });

  it("parses NOT criteria", () => {
    expect(parseSearchCriteria("NOT SEEN")).toEqual([
      { type: "not", criterion: { type: "flag", flag: "\\Seen", negated: false } },
    ]);
  });

  it("parses OR criteria", () => {
    const result = parseSearchCriteria('OR FROM "alice" FROM "bob"');
    expect(result).toEqual([
      {
        type: "or",
        left: { type: "header", field: "from", value: "alice" },
        right: { type: "header", field: "from", value: "bob" },
      },
    ]);
  });

  it("parses multiple criteria as implicit AND", () => {
    const result = parseSearchCriteria("UNSEEN SINCE 1-Mar-2026");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "flag", flag: "\\Seen", negated: true });
    expect(result[1]).toEqual({ type: "date", comparison: "since", date: "1-Mar-2026" });
  });

  it("parses NEW as compound criterion (Recent AND NOT Seen)", () => {
    const result = parseSearchCriteria("NEW");
    expect(result).toEqual([{ type: "new" }]);
  });

  it("parses sequence set as criterion", () => {
    const result = parseSearchCriteria("1:10");
    expect(result).toEqual([{ type: "sequence", set: [{ start: 1, end: 10 }] }]);
  });

  it("parses ANSWERED", () => {
    expect(parseSearchCriteria("ANSWERED")).toEqual([
      { type: "flag", flag: "\\Answered", negated: false },
    ]);
  });

  it("parses DELETED and UNDELETED", () => {
    expect(parseSearchCriteria("DELETED")).toEqual([
      { type: "flag", flag: "\\Deleted", negated: false },
    ]);
    expect(parseSearchCriteria("UNDELETED")).toEqual([
      { type: "flag", flag: "\\Deleted", negated: true },
    ]);
  });

  // RFC 3501 Section 6.4.4 -- remaining flag-keyword criteria
  it("parses DRAFT and UNDRAFT (RFC 3501 \u00a76.4.4)", () => {
    expect(parseSearchCriteria("DRAFT")).toEqual([
      { type: "flag", flag: "\\Draft", negated: false },
    ]);
    expect(parseSearchCriteria("UNDRAFT")).toEqual([
      { type: "flag", flag: "\\Draft", negated: true },
    ]);
  });

  it("parses FLAGGED and UNFLAGGED (RFC 3501 \u00a76.4.4)", () => {
    expect(parseSearchCriteria("FLAGGED")).toEqual([
      { type: "flag", flag: "\\Flagged", negated: false },
    ]);
    expect(parseSearchCriteria("UNFLAGGED")).toEqual([
      { type: "flag", flag: "\\Flagged", negated: true },
    ]);
  });

  it("parses RECENT and OLD (RFC 3501 \u00a76.4.4)", () => {
    expect(parseSearchCriteria("RECENT")).toEqual([
      { type: "flag", flag: "\\Recent", negated: false },
    ]);
    // OLD = messages that do not have the \Recent flag
    expect(parseSearchCriteria("OLD")).toEqual([
      { type: "flag", flag: "\\Recent", negated: true },
    ]);
  });

  it("parses UNANSWERED (RFC 3501 \u00a76.4.4)", () => {
    expect(parseSearchCriteria("UNANSWERED")).toEqual([
      { type: "flag", flag: "\\Answered", negated: true },
    ]);
  });

  it("throws on unknown criterion", () => {
    expect(() => parseSearchCriteria("FOOBAR")).toThrow(ImapParseError);
  });
});

describe("parseQuotedString", () => {
  it("parses a simple quoted string", () => {
    const result = parseQuotedString('"hello"', 0);
    expect(result).toEqual({ value: "hello", endPos: 7 });
  });

  it("handles escaped backslash", () => {
    const result = parseQuotedString('"path\\\\to"', 0);
    expect(result).toEqual({ value: "path\\to", endPos: 10 });
  });

  it("handles escaped quote", () => {
    const result = parseQuotedString('"say \\"hi\\""', 0);
    expect(result).toEqual({ value: 'say "hi"', endPos: 12 });
  });

  it("parses from offset", () => {
    const result = parseQuotedString('prefix "value"', 7);
    expect(result).toEqual({ value: "value", endPos: 14 });
  });

  it("handles empty quoted string", () => {
    const result = parseQuotedString('""', 0);
    expect(result).toEqual({ value: "", endPos: 2 });
  });

  it("throws on unterminated string", () => {
    expect(() => parseQuotedString('"no end', 0)).toThrow(ImapParseError);
    expect(() => parseQuotedString('"no end', 0)).toThrow("Unterminated quoted string");
  });

  it("throws if not starting with quote", () => {
    expect(() => parseQuotedString("nope", 0)).toThrow(ImapParseError);
  });

  it("throws on unterminated escape", () => {
    expect(() => parseQuotedString('"trail\\', 0)).toThrow(ImapParseError);
    expect(() => parseQuotedString('"trail\\', 0)).toThrow("Unterminated escape");
  });
});

describe("parseLiteral", () => {
  it("parses a standard literal", () => {
    expect(parseLiteral("{42}")).toEqual({ byteCount: 42, continuation: false });
  });

  it("parses a non-synchronizing literal (LITERAL+)", () => {
    expect(parseLiteral("{42+}")).toEqual({ byteCount: 42, continuation: true });
  });

  it("parses zero-length literal", () => {
    expect(parseLiteral("{0}")).toEqual({ byteCount: 0, continuation: false });
  });

  it("throws on invalid syntax", () => {
    expect(() => parseLiteral("42")).toThrow(ImapParseError);
    expect(() => parseLiteral("{abc}")).toThrow(ImapParseError);
    expect(() => parseLiteral("{}")).toThrow(ImapParseError);
  });

  it("throws on excessively large literal", () => {
    expect(() => parseLiteral("{999999999999}")).toThrow(ImapParseError);
    expect(() => parseLiteral("{999999999999}")).toThrow("exceeds maximum");
  });
});

describe("parseParenthesizedList", () => {
  it("parses a simple list", () => {
    const result = parseParenthesizedList("(a b c)", 0);
    expect(result).toEqual({ items: ["a", "b", "c"], endPos: 7 });
  });

  it("parses an empty list", () => {
    const result = parseParenthesizedList("()", 0);
    expect(result).toEqual({ items: [], endPos: 2 });
  });

  it("parses nested lists", () => {
    const result = parseParenthesizedList("(a (b c) d)", 0);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toBe("a");
    expect(result.items[1]).toBe("(b c)");
    expect(result.items[2]).toBe("d");
  });

  it("parses lists with quoted strings", () => {
    const result = parseParenthesizedList('(a "hello world" b)', 0);
    expect(result.items).toEqual(["a", "hello world", "b"]);
  });

  it("parses from offset", () => {
    const result = parseParenthesizedList("prefix (a b)", 7);
    expect(result).toEqual({ items: ["a", "b"], endPos: 12 });
  });

  it("throws on unterminated list", () => {
    expect(() => parseParenthesizedList("(a b", 0)).toThrow(ImapParseError);
    expect(() => parseParenthesizedList("(a b", 0)).toThrow("Unterminated parenthesized list");
  });

  it("throws if not starting with open paren", () => {
    expect(() => parseParenthesizedList("nope", 0)).toThrow(ImapParseError);
  });
});
