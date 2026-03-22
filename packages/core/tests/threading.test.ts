import { describe, expect, it } from "vitest";
import { buildReferences, generateMessageId, generateSnippet } from "../src/threading.js";

describe("generateMessageId", () => {
  it("produces valid <uuidv7@domain> format", () => {
    const id = generateMessageId("example.com");
    expect(id).toMatch(
      /^<[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@example\.com>$/,
    );
  });

  it("generates unique IDs on successive calls", () => {
    const a = generateMessageId("example.com");
    const b = generateMessageId("example.com");
    expect(a).not.toBe(b);
  });
});

describe("buildReferences", () => {
  it("returns null when both inputs are null", () => {
    expect(buildReferences(null, null)).toBeNull();
  });

  it("returns inReplyTo alone when no existing references", () => {
    const result = buildReferences(null, "<abc@example.com>");
    expect(result).toBe("<abc@example.com>");
  });

  it("returns existing references when inReplyTo is null", () => {
    const result = buildReferences("<abc@example.com>", null);
    expect(result).toBe("<abc@example.com>");
  });

  it("appends inReplyTo to existing references", () => {
    const result = buildReferences("<abc@example.com> <def@example.com>", "<ghi@example.com>");
    expect(result).toBe("<abc@example.com> <def@example.com> <ghi@example.com>");
  });

  it("does not duplicate inReplyTo if already present", () => {
    const result = buildReferences("<abc@example.com> <def@example.com>", "<def@example.com>");
    expect(result).toBe("<abc@example.com> <def@example.com>");
  });

  it("caps references at 50 entries", () => {
    const refs = Array.from(
      { length: 55 },
      (_, i) => `<msg-${String(i).padStart(3, "0")}@example.com>`,
    );
    const existing = refs.join(" ");
    const result = buildReferences(existing, "<new@example.com>");
    const parts = result!.split(" ");
    expect(parts).toHaveLength(50);
    // Should keep the tail (most recent), including the newly appended one
    expect(parts[parts.length - 1]).toBe("<new@example.com>");
  });
});

describe("generateSnippet", () => {
  it("returns trimmed body when shorter than maxLength", () => {
    expect(generateSnippet("Hello world")).toBe("Hello world");
  });

  it("truncates at default maxLength of 200", () => {
    const long = "a".repeat(300);
    const snippet = generateSnippet(long);
    expect(snippet).toHaveLength(200);
  });

  it("truncates at custom maxLength", () => {
    const snippet = generateSnippet("Hello world, this is a test", 5);
    expect(snippet).toBe("Hello");
  });

  it("returns empty string for empty input", () => {
    expect(generateSnippet("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(generateSnippet("   \n\t  ")).toBe("");
  });

  it("trims leading and trailing whitespace before truncating", () => {
    expect(generateSnippet("  hello  ")).toBe("hello");
  });
});
