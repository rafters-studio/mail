import { describe, it, expect } from "vitest";
import {
  classifierConfigSchema,
  resolveConfig,
  DEFAULT_TAG_PATTERNS,
  DEFAULT_URGENT_KEYWORDS,
  DEFAULT_HIGH_PRIORITY_KEYWORDS,
  DEFAULT_CLASSIFICATION_LABELS,
  DEFAULT_MAX_INPUT_LENGTH,
} from "../src/config.js";

describe("classifierConfigSchema", () => {
  it("accepts a fully specified config", () => {
    const config = {
      tagPatterns: [{ pattern: "test", tag: "test-tag" }],
      urgentKeywords: ["now"],
      highPriorityKeywords: ["soon"],
      classificationLabels: ["a", "b"],
      maxInputLength: 2000,
    };

    const result = classifierConfigSchema.parse(config);
    expect(result).toEqual(config);
  });

  it("accepts an empty object since all fields are optional", () => {
    const result = classifierConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts partial config", () => {
    const result = classifierConfigSchema.parse({ maxInputLength: 500 });
    expect(result.maxInputLength).toBe(500);
  });

  it("rejects negative maxInputLength", () => {
    expect(() => classifierConfigSchema.parse({ maxInputLength: -1 })).toThrow();
  });

  it("rejects zero maxInputLength", () => {
    expect(() => classifierConfigSchema.parse({ maxInputLength: 0 })).toThrow();
  });

  it("rejects non-integer maxInputLength", () => {
    expect(() => classifierConfigSchema.parse({ maxInputLength: 1.5 })).toThrow();
  });

  it("rejects tagPatterns with missing tag field", () => {
    expect(() => classifierConfigSchema.parse({ tagPatterns: [{ pattern: "test" }] })).toThrow();
  });

  it("rejects tagPatterns with missing pattern field", () => {
    expect(() => classifierConfigSchema.parse({ tagPatterns: [{ tag: "test" }] })).toThrow();
  });
});

describe("resolveConfig", () => {
  it("returns all defaults when no config is provided", () => {
    const resolved = resolveConfig();
    expect(resolved.tagPatterns).toEqual(DEFAULT_TAG_PATTERNS);
    expect(resolved.urgentKeywords).toEqual(DEFAULT_URGENT_KEYWORDS);
    expect(resolved.highPriorityKeywords).toEqual(DEFAULT_HIGH_PRIORITY_KEYWORDS);
    expect(resolved.classificationLabels).toEqual(DEFAULT_CLASSIFICATION_LABELS);
    expect(resolved.maxInputLength).toBe(DEFAULT_MAX_INPUT_LENGTH);
  });

  it("returns all defaults when empty config is provided", () => {
    const resolved = resolveConfig({});
    expect(resolved.tagPatterns).toEqual(DEFAULT_TAG_PATTERNS);
    expect(resolved.maxInputLength).toBe(DEFAULT_MAX_INPUT_LENGTH);
  });

  it("overrides only the specified fields", () => {
    const custom = { maxInputLength: 100 };
    const resolved = resolveConfig(custom);
    expect(resolved.maxInputLength).toBe(100);
    expect(resolved.tagPatterns).toEqual(DEFAULT_TAG_PATTERNS);
    expect(resolved.urgentKeywords).toEqual(DEFAULT_URGENT_KEYWORDS);
  });

  it("completely replaces array fields when overridden", () => {
    const custom = { urgentKeywords: ["only-this"] };
    const resolved = resolveConfig(custom);
    expect(resolved.urgentKeywords).toEqual(["only-this"]);
    // Default keywords should not be present
    expect(resolved.urgentKeywords).not.toContain("urgent");
  });
});
