import { describe, expect, it } from "vitest";
import {
  extractDisplayName,
  extractEmailAddress,
  hashContent,
  parseEmailHeaders,
} from "../src/email-parsing.js";

describe("extractEmailAddress", () => {
  it("extracts from angle bracket format", () => {
    expect(extractEmailAddress("Sean <sean@example.com>")).toBe("sean@example.com");
  });

  it("returns bare email as-is", () => {
    expect(extractEmailAddress("sean@example.com")).toBe("sean@example.com");
  });

  it("handles quoted display name", () => {
    expect(extractEmailAddress('"Sean Silvius" <sean@example.com>')).toBe("sean@example.com");
  });
});

describe("extractDisplayName", () => {
  it("extracts display name from angle bracket format", () => {
    expect(extractDisplayName("Sean Silvius <sean@example.com>")).toBe("Sean Silvius");
  });

  it("strips quotes from display name", () => {
    expect(extractDisplayName('"Sean Silvius" <sean@example.com>')).toBe("Sean Silvius");
  });

  it("returns null for bare email", () => {
    expect(extractDisplayName("sean@example.com")).toBeNull();
  });
});

describe("parseEmailHeaders", () => {
  it("parses all RFC 5322 headers", () => {
    const headers = new Headers({
      "message-id": "<abc@example.com>",
      from: "Sean <sean@example.com>",
      to: "support@example.com",
      subject: "Help needed",
      "in-reply-to": "<prev@example.com>",
      references: "<first@example.com> <prev@example.com>",
      date: "Sat, 21 Mar 2026 12:00:00 GMT",
    });

    const parsed = parseEmailHeaders(headers);
    expect(parsed.messageId).toBe("<abc@example.com>");
    expect(parsed.from).toBe("sean@example.com");
    expect(parsed.to).toBe("support@example.com");
    expect(parsed.subject).toBe("Help needed");
    expect(parsed.inReplyTo).toBe("<prev@example.com>");
    expect(parsed.references).toBe("<first@example.com> <prev@example.com>");
    expect(parsed.fromName).toBe("Sean");
    expect(parsed.date).toBeInstanceOf(Date);
  });

  it("handles missing optional headers", () => {
    const headers = new Headers({
      from: "user@example.com",
      to: "inbox@example.com",
    });

    const parsed = parseEmailHeaders(headers);
    expect(parsed.messageId).toBeNull();
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.references).toBeNull();
    expect(parsed.subject).toBe("(no subject)");
    expect(parsed.fromName).toBeNull();
  });

  it("parses CC addresses", () => {
    const headers = new Headers({
      from: "a@b.com",
      to: "c@d.com",
      cc: "e@f.com, g@h.com",
    });

    const parsed = parseEmailHeaders(headers);
    expect(parsed.cc).toEqual(["e@f.com", "g@h.com"]);
  });
});

describe("hashContent", () => {
  it("produces deterministic SHA-256 hash", async () => {
    const hash1 = await hashContent("hello world");
    const hash2 = await hashContent("hello world");
    expect(hash1).toBe(hash2);
  });

  it("produces 64-character hex string (full SHA-256)", async () => {
    const hash = await hashContent("test content");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces different hashes for different content", async () => {
    const hash1 = await hashContent("content a");
    const hash2 = await hashContent("content b");
    expect(hash1).not.toBe(hash2);
  });
});
