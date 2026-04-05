import { describe, it, expect } from "vitest";
import {
  formatGreeting,
  formatBye,
  formatTagged,
  formatUntagged,
  formatContinuation,
  formatCapability,
  formatListResponse,
  formatStatusResponse,
  formatFetchResponse,
  formatSearchResponse,
  formatSelectResponse,
  formatExpungeResponse,
  formatExistsResponse,
} from "../../src/protocol/formatter.ts";
import type { FetchResponseData, EnvelopeData } from "../../src/protocol/formatter.ts";

const CRLF = "\r\n";

describe("formatGreeting", () => {
  it("formats a greeting with capabilities", () => {
    const result = formatGreeting(["IMAP4rev1", "IDLE", "LITERAL+"]);
    expect(result).toBe(`* OK [CAPABILITY IMAP4rev1 IDLE LITERAL+] @rafters/mail ready${CRLF}`);
  });
});

describe("formatBye", () => {
  it("formats a BYE response", () => {
    expect(formatBye("Server shutting down")).toBe(`* BYE Server shutting down${CRLF}`);
  });
});

describe("formatTagged", () => {
  it("formats an OK response", () => {
    expect(formatTagged("a001", "OK", "SELECT completed")).toBe(`a001 OK SELECT completed${CRLF}`);
  });

  it("formats a NO response", () => {
    expect(formatTagged("a002", "NO", "Mailbox not found")).toBe(`a002 NO Mailbox not found${CRLF}`);
  });

  it("formats a BAD response", () => {
    expect(formatTagged("a003", "BAD", "Syntax error")).toBe(`a003 BAD Syntax error${CRLF}`);
  });
});

describe("formatUntagged", () => {
  it("formats an untagged response", () => {
    expect(formatUntagged("47 EXISTS")).toBe(`* 47 EXISTS${CRLF}`);
  });
});

describe("formatContinuation", () => {
  it("formats a continuation response", () => {
    expect(formatContinuation("Ready for literal data")).toBe(`+ Ready for literal data${CRLF}`);
  });
});

describe("formatCapability", () => {
  it("formats capabilities", () => {
    const result = formatCapability(["IMAP4rev1", "IDLE", "UIDPLUS"]);
    expect(result).toBe(`* CAPABILITY IMAP4rev1 IDLE UIDPLUS${CRLF}`);
  });
});

describe("formatListResponse", () => {
  it("formats a LIST response for INBOX", () => {
    const result = formatListResponse([], "/", "INBOX");
    expect(result).toBe(`* LIST () "/" INBOX${CRLF}`);
  });

  it("formats a LIST response with flags", () => {
    const result = formatListResponse(["\\HasNoChildren"], "/", "Sent");
    expect(result).toBe(`* LIST (\\HasNoChildren) "/" Sent${CRLF}`);
  });

  it("formats a LIST response with multiple flags", () => {
    const result = formatListResponse(["\\Noselect", "\\HasChildren"], "/", "Archive");
    expect(result).toBe(`* LIST (\\Noselect \\HasChildren) "/" Archive${CRLF}`);
  });

  it("quotes folder names with spaces", () => {
    const result = formatListResponse([], "/", "My Folder");
    expect(result).toBe(`* LIST () "/" "My Folder"${CRLF}`);
  });

  it("handles NIL delimiter", () => {
    const result = formatListResponse([], "", "INBOX");
    expect(result).toBe(`* LIST () NIL INBOX${CRLF}`);
  });
});

describe("formatStatusResponse", () => {
  it("formats a STATUS response", () => {
    const result = formatStatusResponse("INBOX", {
      MESSAGES: 47,
      RECENT: 3,
      UNSEEN: 12,
    });
    expect(result).toBe(`* STATUS INBOX (MESSAGES 47 RECENT 3 UNSEEN 12)${CRLF}`);
  });

  it("formats STATUS with UIDNEXT and UIDVALIDITY", () => {
    const result = formatStatusResponse("Sent", {
      MESSAGES: 100,
      UIDNEXT: 201,
      UIDVALIDITY: 1,
    });
    expect(result).toBe(`* STATUS Sent (MESSAGES 100 UIDNEXT 201 UIDVALIDITY 1)${CRLF}`);
  });
});

describe("formatFetchResponse", () => {
  it("formats FLAGS only", () => {
    const data: FetchResponseData = { flags: ["\\Seen", "\\Flagged"] };
    const result = formatFetchResponse(1, data);
    expect(result).toBe(`* 1 FETCH (FLAGS (\\Seen \\Flagged))${CRLF}`);
  });

  it("formats UID only", () => {
    const data: FetchResponseData = { uid: 101 };
    const result = formatFetchResponse(1, data);
    expect(result).toBe(`* 1 FETCH (UID 101)${CRLF}`);
  });

  it("formats RFC822.SIZE", () => {
    const data: FetchResponseData = { rfc822Size: 12345 };
    const result = formatFetchResponse(42, data);
    expect(result).toBe(`* 42 FETCH (RFC822.SIZE 12345)${CRLF}`);
  });

  it("formats INTERNALDATE", () => {
    const data: FetchResponseData = {
      internalDate: new Date("2026-03-15T10:30:00Z"),
    };
    const result = formatFetchResponse(1, data);
    expect(result).toContain('INTERNALDATE "15-Mar-2026 10:30:00 +0000"');
  });

  it("formats INTERNALDATE with single-digit day padded with space", () => {
    const data: FetchResponseData = {
      internalDate: new Date("2026-01-05T08:00:00Z"),
    };
    const result = formatFetchResponse(1, data);
    expect(result).toContain('INTERNALDATE " 5-Jan-2026 08:00:00 +0000"');
  });

  it("formats ENVELOPE", () => {
    const envelope: EnvelopeData = {
      date: "Mon, 15 Mar 2026 10:30:00 +0000",
      subject: "Test subject",
      from: [{ name: "Alice", adl: null, mailbox: "alice", host: "example.com" }],
      sender: [{ name: "Alice", adl: null, mailbox: "alice", host: "example.com" }],
      replyTo: [{ name: "Alice", adl: null, mailbox: "alice", host: "example.com" }],
      to: [{ name: "Bob", adl: null, mailbox: "bob", host: "example.com" }],
      cc: [],
      bcc: [],
      inReplyTo: "",
      messageId: "<msg-001@example.com>",
    };
    const data: FetchResponseData = { envelope };
    const result = formatFetchResponse(1, data);
    expect(result).toContain("ENVELOPE (");
    expect(result).toContain('"Test subject"');
    expect(result).toContain('"alice"');
    expect(result).toContain('"example.com"');
  });

  it("formats ENVELOPE with NIL for null address lists and quoted empty strings", () => {
    const envelope: EnvelopeData = {
      date: "",
      subject: "",
      from: [],
      sender: [],
      replyTo: [],
      to: [],
      cc: [],
      bcc: [],
      inReplyTo: "",
      messageId: "",
    };
    const data: FetchResponseData = { envelope };
    const result = formatFetchResponse(1, data);
    expect(result).toContain('"" ""');
    expect(result).toContain("NIL NIL NIL NIL NIL NIL");
  });

  it("formats BODY[] with literal content", () => {
    const content = "From: alice@example.com\r\nSubject: Test\r\n\r\nBody text";
    const data: FetchResponseData = {
      body: { section: "", content },
    };
    const result = formatFetchResponse(1, data);
    expect(result).toContain(`BODY[] {${content.length}}`);
    expect(result).toContain(content);
  });

  it("formats BODY[HEADER] with section", () => {
    const content = "From: alice@example.com\r\nSubject: Test\r\n";
    const data: FetchResponseData = {
      body: { section: "HEADER", content },
    };
    const result = formatFetchResponse(1, data);
    expect(result).toContain(`BODY[HEADER] {${content.length}}`);
  });

  it("formats multiple data items together", () => {
    const data: FetchResponseData = {
      flags: ["\\Seen"],
      uid: 42,
      rfc822Size: 1234,
    };
    const result = formatFetchResponse(1, data);
    expect(result).toContain("FLAGS (\\Seen)");
    expect(result).toContain("UID 42");
    expect(result).toContain("RFC822.SIZE 1234");
  });
});

describe("formatSearchResponse", () => {
  it("formats search results", () => {
    expect(formatSearchResponse([1, 3, 7, 42])).toBe(`* SEARCH 1 3 7 42${CRLF}`);
  });

  it("formats empty search results", () => {
    expect(formatSearchResponse([])).toBe(`* SEARCH${CRLF}`);
  });

  it("formats single result", () => {
    expect(formatSearchResponse([5])).toBe(`* SEARCH 5${CRLF}`);
  });
});

describe("formatSelectResponse", () => {
  it("formats a complete SELECT response with READ-WRITE", () => {
    const lines = formatSelectResponse({
      exists: 47,
      recent: 3,
      unseen: 12,
      uidValidity: 1,
      uidNext: 48,
      flags: ["\\Answered", "\\Flagged", "\\Deleted", "\\Seen", "\\Draft"],
      permanentFlags: ["\\Answered", "\\Flagged", "\\Deleted", "\\Seen", "\\Draft", "\\*"],
      readWrite: true,
    });
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe(`* 47 EXISTS${CRLF}`);
    expect(lines[1]).toBe(`* 3 RECENT${CRLF}`);
    expect(lines[2]).toContain("FLAGS");
    expect(lines[3]).toContain("PERMANENTFLAGS");
    expect(lines[4]).toContain("UIDVALIDITY 1");
    expect(lines[5]).toContain("UIDNEXT 48");
    expect(lines[6]).toContain("UNSEEN 12");
    expect(lines[7]).toContain("READ-WRITE");
  });

  it("formats SELECT response with READ-ONLY", () => {
    const lines = formatSelectResponse({
      exists: 10,
      recent: 0,
      unseen: null,
      uidValidity: 1,
      uidNext: 11,
      flags: [],
      permanentFlags: [],
      readWrite: false,
    });
    expect(lines[lines.length - 1]).toContain("READ-ONLY");
    expect(lines.some((l) => l.includes("READ-WRITE"))).toBe(false);
  });

  it("omits UNSEEN when null", () => {
    const lines = formatSelectResponse({
      exists: 0,
      recent: 0,
      unseen: null,
      uidValidity: 1,
      uidNext: 1,
      flags: [],
      permanentFlags: [],
      readWrite: true,
    });
    expect(lines).toHaveLength(7);
    expect(lines.some((l) => l.includes("UNSEEN"))).toBe(false);
  });
});

describe("formatExpungeResponse", () => {
  it("formats an EXPUNGE response", () => {
    expect(formatExpungeResponse(3)).toBe(`* 3 EXPUNGE${CRLF}`);
  });
});

describe("formatExistsResponse", () => {
  it("formats an EXISTS response", () => {
    expect(formatExistsResponse(48)).toBe(`* 48 EXISTS${CRLF}`);
  });
});
