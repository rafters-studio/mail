import { describe, expect, it } from 'vitest';
import {
  aiCategorySchema,
  assignmentStatusSchema,
  mailboxTypeSchema,
  systemFolderSchema,
  threadPrioritySchema,
  threadStatusSchema,
} from '../../src/schema/enums.js';

describe('mailboxTypeSchema', () => {
  it('accepts all valid values', () => {
    for (const value of mailboxTypeSchema.options) {
      expect(mailboxTypeSchema.parse(value)).toBe(value);
    }
  });

  it('rejects invalid values', () => {
    expect(() => mailboxTypeSchema.parse('team')).toThrow();
  });
});

describe('threadStatusSchema', () => {
  it('accepts all valid statuses', () => {
    for (const status of threadStatusSchema.options) {
      expect(threadStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects invalid values', () => {
    expect(() => threadStatusSchema.parse('cancelled')).toThrow();
  });
});

describe('threadPrioritySchema', () => {
  it('accepts all valid priorities', () => {
    for (const priority of threadPrioritySchema.options) {
      expect(threadPrioritySchema.parse(priority)).toBe(priority);
    }
  });

  it('rejects invalid values', () => {
    expect(() => threadPrioritySchema.parse('critical')).toThrow();
  });
});

describe('assignmentStatusSchema', () => {
  it('accepts all valid statuses', () => {
    for (const status of assignmentStatusSchema.options) {
      expect(assignmentStatusSchema.parse(status)).toBe(status);
    }
  });
});

describe('aiCategorySchema', () => {
  it('accepts all valid categories', () => {
    for (const category of aiCategorySchema.options) {
      expect(aiCategorySchema.parse(category)).toBe(category);
    }
  });

  it('rejects invalid values', () => {
    expect(() => aiCategorySchema.parse('marketing')).toThrow();
  });
});

describe('systemFolderSchema', () => {
  it('accepts all system folders', () => {
    for (const folder of systemFolderSchema.options) {
      expect(systemFolderSchema.parse(folder)).toBe(folder);
    }
  });

  it('rejects custom folder names', () => {
    expect(() => systemFolderSchema.parse('custom')).toThrow();
  });
});
