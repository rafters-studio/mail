import { z } from 'zod';

const tagPatternSchema = z.object({
  pattern: z.string(),
  tag: z.string(),
});
export type TagPattern = z.infer<typeof tagPatternSchema>;

export const classifierConfigSchema = z.object({
  /** Regex patterns for auto-tagging email content */
  tagPatterns: z.array(tagPatternSchema).optional(),
  /** Keywords that trigger urgent priority */
  urgentKeywords: z.array(z.string()).optional(),
  /** Keywords that trigger high priority */
  highPriorityKeywords: z.array(z.string()).optional(),
  /** Zero-shot classification labels (must match aiCategorySchema values) */
  classificationLabels: z.array(z.string()).optional(),
  /** Maximum input length in characters before truncation */
  maxInputLength: z.number().int().positive().optional(),
});
export type ClassifierConfig = z.infer<typeof classifierConfigSchema>;

export const DEFAULT_TAG_PATTERNS: TagPattern[] = [
  { pattern: 'install|setup|download', tag: 'installation' },
  { pattern: 'crash|error|bug|broken', tag: 'bug-report' },
  { pattern: 'feature|request|suggest', tag: 'feature-request' },
  { pattern: 'account|login|password|auth', tag: 'account' },
  { pattern: 'payment|billing|subscribe|refund', tag: 'billing' },
  { pattern: 'dmca|copyright|takedown', tag: 'legal' },
];

export const DEFAULT_URGENT_KEYWORDS = [
  'urgent',
  'emergency',
  'asap',
  'immediately',
  'critical',
  'broken',
  'down',
  'outage',
];

export const DEFAULT_HIGH_PRIORITY_KEYWORDS = [
  'important',
  'priority',
  'help',
  'issue',
  'problem',
  'error',
  'bug',
  'crash',
];

export const DEFAULT_CLASSIFICATION_LABELS = [
  'support',
  'feedback',
  'abuse',
  'partnership',
  'spam',
  'billing',
  'legal',
  'other',
];

export const DEFAULT_MAX_INPUT_LENGTH = 4000;

export function resolveConfig(config?: ClassifierConfig) {
  return {
    tagPatterns: config?.tagPatterns ?? DEFAULT_TAG_PATTERNS,
    urgentKeywords: config?.urgentKeywords ?? DEFAULT_URGENT_KEYWORDS,
    highPriorityKeywords: config?.highPriorityKeywords ?? DEFAULT_HIGH_PRIORITY_KEYWORDS,
    classificationLabels: config?.classificationLabels ?? DEFAULT_CLASSIFICATION_LABELS,
    maxInputLength: config?.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH,
  };
}
