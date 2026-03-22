import { describe, expect, it } from 'vitest';
import {
  emailClassificationSchema,
  isLegitimateCategory,
} from '../../src/interfaces/classifier.js';

describe('emailClassificationSchema', () => {
  it('accepts valid classification', () => {
    const result = emailClassificationSchema.parse({
      category: 'support',
      confidence: 87,
      tags: ['bug-report', 'account'],
      priority: 'high',
    });
    expect(result.category).toBe('support');
    expect(result.confidence).toBe(87);
  });

  it('rejects confidence below 0', () => {
    expect(() =>
      emailClassificationSchema.parse({
        category: 'support',
        confidence: -1,
        tags: [],
        priority: 'normal',
      }),
    ).toThrow();
  });

  it('rejects confidence above 100', () => {
    expect(() =>
      emailClassificationSchema.parse({
        category: 'support',
        confidence: 101,
        tags: [],
        priority: 'normal',
      }),
    ).toThrow();
  });

  it('rejects invalid category', () => {
    expect(() =>
      emailClassificationSchema.parse({
        category: 'marketing',
        confidence: 50,
        tags: [],
        priority: 'normal',
      }),
    ).toThrow();
  });
});

describe('isLegitimateCategory', () => {
  it('returns true for non-spam categories', () => {
    expect(isLegitimateCategory('support')).toBe(true);
    expect(isLegitimateCategory('feedback')).toBe(true);
    expect(isLegitimateCategory('legal')).toBe(true);
  });

  it('returns false for spam', () => {
    expect(isLegitimateCategory('spam')).toBe(false);
  });
});
