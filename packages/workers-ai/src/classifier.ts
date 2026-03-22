import type { AiCategory, ThreadPriority } from "@rafters/mail";
import type { EmailClassifier, EmailClassification } from "@rafters/mail";
import type { ClassifierConfig, TagPattern } from "./config.js";
import { DEFAULT_CLASSIFICATION_LABELS, resolveConfig } from "./config.js";

/**
 * Zero-shot classification result from Workers AI
 */
interface ZeroShotResult {
  labels: string[];
  scores: number[];
}

/**
 * Workers AI binding -- minimal interface to avoid coupling to the full
 * Cloudflare types at runtime. Any object with a compatible `run` method
 * satisfies this contract.
 */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Truncate input text to the configured maximum length.
 */
export function truncateInput(subject: string, body: string, maxLength: number): string {
  return `${subject}\n\n${body}`.slice(0, maxLength);
}

/**
 * Validate and normalize a classification label to an AiCategory.
 * Returns 'other' if the label is not recognized.
 */
export function validateCategory(
  label: string,
  labels: string[] = DEFAULT_CLASSIFICATION_LABELS,
): AiCategory {
  const normalized = label.toLowerCase().trim();
  if (labels.includes(normalized)) {
    return normalized as AiCategory;
  }
  return "other";
}

/**
 * Determine email priority based on category and content keywords.
 *
 * Priority rules:
 *   abuse / legal -> high
 *   urgent keywords -> urgent
 *   high priority keywords -> high
 *   support / billing -> normal
 *   feedback / partnership -> normal
 *   everything else -> low
 */
export function determinePriority(
  category: AiCategory,
  subject: string,
  body: string,
  urgentKeywords: string[],
  highPriorityKeywords: string[],
): ThreadPriority {
  const content = `${subject} ${body}`.toLowerCase();

  if (category === "abuse" || category === "legal") {
    return "high";
  }

  if (urgentKeywords.some((kw) => content.includes(kw))) {
    return "urgent";
  }

  if (highPriorityKeywords.some((kw) => content.includes(kw))) {
    return "high";
  }

  if (category === "support" || category === "billing") {
    return "normal";
  }

  if (category === "feedback" || category === "partnership") {
    return "normal";
  }

  return "low";
}

/**
 * Extract tags from email content using regex patterns.
 */
export function extractTags(subject: string, body: string, patterns: TagPattern[]): string[] {
  const content = `${subject} ${body}`;
  const tags: string[] = [];

  for (const { pattern, tag } of patterns) {
    const re = new RegExp(pattern, "i");
    if (re.test(content) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Create a Workers AI email classifier implementing the EmailClassifier interface.
 *
 * Uses the DeBERTa-v3 zero-shot classification model to categorize emails,
 * then applies rule-based priority determination and tag extraction.
 *
 * @param ai - Workers AI binding (env.AI)
 * @param config - Optional classifier configuration overrides
 */
export function createWorkersAIClassifier(
  ai: AiBinding,
  config?: ClassifierConfig,
): EmailClassifier {
  const resolved = resolveConfig(config);

  return {
    async classify(from: string, subject: string, body: string): Promise<EmailClassification> {
      // `from` is reserved for future sender reputation scoring
      void from;

      const text = truncateInput(subject, body, resolved.maxInputLength);

      const result = (await ai.run("@cf/microsoft/deberta-v3-base-zeroshot-v1.1-all-33", {
        text,
        labels: resolved.classificationLabels,
      })) as ZeroShotResult;

      const topLabel = result.labels?.[0] ?? "other";
      const topScore = result.scores?.[0] ?? 0;

      const category = validateCategory(topLabel, resolved.classificationLabels);
      const confidence = Math.round(topScore * 100);
      const priority = determinePriority(
        category,
        subject,
        body,
        resolved.urgentKeywords,
        resolved.highPriorityKeywords,
      );
      const tags = extractTags(subject, body, resolved.tagPatterns);

      return { category, confidence, priority, tags };
    },
  };
}
