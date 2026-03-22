// @rafters/mail-workers-ai -- Workers AI email classifier
// DeBERTa-v3 zero-shot classification, priority determination, auto-tagging

export {
  createWorkersAIClassifier,
  truncateInput,
  validateCategory,
  determinePriority,
  extractTags,
} from './classifier.js';

export type { AiBinding } from './classifier.js';

export {
  classifierConfigSchema,
  DEFAULT_TAG_PATTERNS,
  DEFAULT_URGENT_KEYWORDS,
  DEFAULT_HIGH_PRIORITY_KEYWORDS,
  DEFAULT_CLASSIFICATION_LABELS,
  DEFAULT_MAX_INPUT_LENGTH,
  resolveConfig,
} from './config.js';

export type { ClassifierConfig, TagPattern } from './config.js';
