import { describe, it, expect, vi } from "vitest";
import {
  truncateInput,
  validateCategory,
  determinePriority,
  extractTags,
  createWorkersAIClassifier,
} from "../src/classifier.js";
import type { AiBinding } from "../src/classifier.js";
import {
  DEFAULT_URGENT_KEYWORDS,
  DEFAULT_HIGH_PRIORITY_KEYWORDS,
  DEFAULT_TAG_PATTERNS,
} from "../src/config.js";

describe("truncateInput", () => {
  it("combines subject and body with double newline", () => {
    const result = truncateInput("Hello", "World", 4000);
    expect(result).toBe("Hello\n\nWorld");
  });

  it("truncates to the configured max length", () => {
    const long = "x".repeat(5000);
    const result = truncateInput("Subject", long, 100);
    expect(result.length).toBe(100);
  });

  it("does not truncate when under the limit", () => {
    const result = truncateInput("Short", "body", 4000);
    expect(result).toBe("Short\n\nbody");
    expect(result.length).toBeLessThan(4000);
  });
});

describe("validateCategory", () => {
  it("returns a recognized category as-is", () => {
    expect(validateCategory("support")).toBe("support");
    expect(validateCategory("abuse")).toBe("abuse");
    expect(validateCategory("spam")).toBe("spam");
  });

  it("normalizes whitespace and casing", () => {
    expect(validateCategory("  Support ")).toBe("support");
    expect(validateCategory("BILLING")).toBe("billing");
  });

  it("returns other for unrecognized labels", () => {
    expect(validateCategory("nonsense")).toBe("other");
    expect(validateCategory("")).toBe("other");
  });

  it("validates against custom labels when provided", () => {
    const labels = ["custom-a", "custom-b"];
    expect(validateCategory("custom-a", labels)).toBe("custom-a");
    expect(validateCategory("support", labels)).toBe("other");
  });
});

describe("determinePriority", () => {
  const urgent = DEFAULT_URGENT_KEYWORDS;
  const high = DEFAULT_HIGH_PRIORITY_KEYWORDS;

  it("returns high for abuse category regardless of content", () => {
    expect(determinePriority("abuse", "hello", "nice email", urgent, high)).toBe("high");
  });

  it("returns high for legal category regardless of content", () => {
    expect(determinePriority("legal", "hello", "nice email", urgent, high)).toBe("high");
  });

  it("returns urgent when content contains urgent keywords", () => {
    expect(determinePriority("other", "URGENT request", "please help", urgent, high)).toBe(
      "urgent",
    );
    expect(determinePriority("support", "Site is down", "outage detected", urgent, high)).toBe(
      "urgent",
    );
  });

  it("returns high when content contains high-priority keywords", () => {
    expect(determinePriority("other", "I have an issue", "need help", urgent, high)).toBe("high");
  });

  it("returns normal for support category without keyword escalation", () => {
    expect(determinePriority("support", "Question", "How do I use this?", urgent, high)).toBe(
      "normal",
    );
  });

  it("returns normal for billing category without keyword escalation", () => {
    expect(determinePriority("billing", "Invoice", "Please send invoice", urgent, high)).toBe(
      "normal",
    );
  });

  it("returns normal for feedback category", () => {
    expect(determinePriority("feedback", "Great product", "Love it", urgent, high)).toBe("normal");
  });

  it("returns normal for partnership category", () => {
    expect(determinePriority("partnership", "Collab", "Lets work together", urgent, high)).toBe(
      "normal",
    );
  });

  it("returns low for uncategorized content without keywords", () => {
    expect(determinePriority("other", "Hello", "Just saying hi", urgent, high)).toBe("low");
    expect(determinePriority("spam", "Buy now", "Click here", urgent, high)).toBe("low");
  });

  it("urgent keywords take precedence over high-priority keywords", () => {
    // Content has both urgent and high keywords
    expect(determinePriority("other", "critical error", "important issue", urgent, high)).toBe(
      "urgent",
    );
  });

  it("abuse/legal category takes precedence over urgent keywords", () => {
    expect(determinePriority("abuse", "urgent critical", "emergency", urgent, high)).toBe("high");
  });
});

describe("extractTags", () => {
  const patterns = DEFAULT_TAG_PATTERNS;

  it("extracts matching tags from subject and body", () => {
    const tags = extractTags("App crashes on startup", "error when loading", patterns);
    expect(tags).toContain("bug-report");
  });

  it("extracts installation tag", () => {
    const tags = extractTags("Setup instructions", "How to install", patterns);
    expect(tags).toContain("installation");
  });

  it("extracts account tag", () => {
    const tags = extractTags("Login issue", "Cannot reset password", patterns);
    expect(tags).toContain("account");
  });

  it("extracts billing tag", () => {
    const tags = extractTags("Refund request", "Need a refund for my payment", patterns);
    expect(tags).toContain("billing");
  });

  it("extracts legal tag", () => {
    const tags = extractTags("DMCA notice", "Copyright takedown request", patterns);
    expect(tags).toContain("legal");
  });

  it("returns empty array when no patterns match", () => {
    const tags = extractTags("Hello", "Just saying hi", patterns);
    expect(tags).toEqual([]);
  });

  it("does not produce duplicate tags", () => {
    const tags = extractTags("crash error bug", "broken and crashed again", patterns);
    const bugReportCount = tags.filter((t) => t === "bug-report").length;
    expect(bugReportCount).toBe(1);
  });

  it("extracts multiple different tags from one email", () => {
    const tags = extractTags("Login crash", "Cannot login, app crashes with error", patterns);
    expect(tags).toContain("bug-report");
    expect(tags).toContain("account");
  });

  it("uses custom patterns when provided", () => {
    const custom = [{ pattern: "rocket|launch", tag: "space" }];
    const tags = extractTags("Rocket launch", "We are going to space", custom);
    expect(tags).toEqual(["space"]);
  });
});

describe("createWorkersAIClassifier", () => {
  function createMockAi(result: { labels: string[]; scores: number[] }): AiBinding {
    return {
      run: vi.fn().mockResolvedValue(result),
    };
  }

  it("calls the AI model and returns a valid classification", async () => {
    const mockAi = createMockAi({
      labels: ["support", "other", "feedback"],
      scores: [0.85, 0.1, 0.05],
    });

    const classifier = createWorkersAIClassifier(mockAi);
    const result = await classifier.classify("user@test.com", "Need help", "My app is broken");

    expect(result.category).toBe("support");
    expect(result.confidence).toBe(85);
    expect(result.priority).toBe("urgent"); // "broken" is an urgent keyword, checked before category
    expect(result.tags).toContain("bug-report"); // "broken" matches bug-report pattern
  });

  it("passes the correct model name to ai.run", async () => {
    const mockAi = createMockAi({ labels: ["other"], scores: [0.5] });
    const classifier = createWorkersAIClassifier(mockAi);

    await classifier.classify("user@test.com", "Hello", "World");

    expect(mockAi.run).toHaveBeenCalledWith(
      "@cf/microsoft/deberta-v3-base-zeroshot-v1.1-all-33",
      expect.objectContaining({
        text: "Hello\n\nWorld",
        labels: expect.any(Array),
      }),
    );
  });

  it("applies custom config overrides", async () => {
    const mockAi = createMockAi({ labels: ["other"], scores: [0.7] });
    const classifier = createWorkersAIClassifier(mockAi, {
      maxInputLength: 50,
      urgentKeywords: ["custom-urgent"],
    });

    const result = await classifier.classify("u@t.com", "custom-urgent matter", "body");

    expect(result.priority).toBe("urgent");
  });

  it("truncates input to configured max length", async () => {
    const mockAi = createMockAi({ labels: ["other"], scores: [0.5] });
    const classifier = createWorkersAIClassifier(mockAi, { maxInputLength: 20 });

    await classifier.classify("u@t.com", "Subject", "x".repeat(1000));

    const calls = (mockAi.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const input = calls[0]![1] as { text: string };
    expect(input.text.length).toBe(20);
  });

  it("falls back to other when AI returns unknown label", async () => {
    const mockAi = createMockAi({ labels: ["unknown-category"], scores: [0.9] });
    const classifier = createWorkersAIClassifier(mockAi);

    const result = await classifier.classify("u@t.com", "Hello", "World");
    expect(result.category).toBe("other");
  });

  it("handles empty AI response gracefully", async () => {
    const mockAi = createMockAi({ labels: [], scores: [] });
    const classifier = createWorkersAIClassifier(mockAi);

    const result = await classifier.classify("u@t.com", "Hello", "World");
    expect(result.category).toBe("other");
    expect(result.confidence).toBe(0);
  });
});
