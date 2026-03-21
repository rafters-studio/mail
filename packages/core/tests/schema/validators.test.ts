import { describe, expect, it } from 'vitest';
import {
  addThreadNoteSchema,
  applyLabelSchema,
  assignThreadSchema,
  bulkActionSchema,
  composeEmailSchema,
  createFolderSchema,
  createLabelSchema,
  createMailboxSchema,
  listMessagesSchema,
  listThreadsSchema,
  saveDraftSchema,
  updateFolderSchema,
  updateLabelSchema,
  updateMailboxSchema,
  updateThreadNoteSchema,
  updateThreadSchema,
} from '../../src/schema/validators.js';

describe('createMailboxSchema', () => {
  it('accepts a valid personal mailbox', () => {
    const result = createMailboxSchema.parse({
      type: 'personal',
      localPart: 'sean',
      ownerId: 'user-123',
    });
    expect(result.type).toBe('personal');
    expect(result.localPart).toBe('sean');
  });

  it('accepts a valid shared mailbox without ownerId', () => {
    const result = createMailboxSchema.parse({
      type: 'shared',
      localPart: 'support',
    });
    expect(result.type).toBe('shared');
  });

  it('rejects a personal mailbox without ownerId', () => {
    expect(() =>
      createMailboxSchema.parse({
        type: 'personal',
        localPart: 'sean',
      }),
    ).toThrow();
  });

  it('rejects invalid local part characters', () => {
    expect(() =>
      createMailboxSchema.parse({
        type: 'shared',
        localPart: 'UPPER CASE',
      }),
    ).toThrow();
  });

  it('rejects local part shorter than 2 characters', () => {
    expect(() =>
      createMailboxSchema.parse({
        type: 'shared',
        localPart: 'a',
      }),
    ).toThrow();
  });
});

describe('updateMailboxSchema', () => {
  it('accepts partial updates', () => {
    const result = updateMailboxSchema.parse({ displayName: 'Sean' });
    expect(result.displayName).toBe('Sean');
  });

  it('accepts empty object', () => {
    const result = updateMailboxSchema.parse({});
    expect(result).toEqual({});
  });

  it('validates hex color format', () => {
    expect(() => updateMailboxSchema.parse({ color: 'red' })).toThrow();
    const result = updateMailboxSchema.parse({ color: '#ff0000' });
    expect(result.color).toBe('#ff0000');
  });

  it('accepts null forwardToEmail to clear forwarding', () => {
    const result = updateMailboxSchema.parse({ forwardToEmail: null });
    expect(result.forwardToEmail).toBeNull();
  });

  it('rejects invalid forwardToEmail', () => {
    expect(() => updateMailboxSchema.parse({ forwardToEmail: 'not-email' })).toThrow();
  });

  it('rejects enabling forwarding without a target email', () => {
    expect(() => updateMailboxSchema.parse({ forwardEnabled: true })).toThrow();
  });

  it('accepts enabling forwarding with a target email', () => {
    const result = updateMailboxSchema.parse({
      forwardEnabled: true,
      forwardToEmail: 'forward@example.com',
    });
    expect(result.forwardEnabled).toBe(true);
  });
});

describe('createFolderSchema', () => {
  it('accepts a valid folder name', () => {
    const result = createFolderSchema.parse({ name: 'Support Tickets' });
    expect(result.name).toBe('Support Tickets');
  });

  it('rejects empty name', () => {
    expect(() => createFolderSchema.parse({ name: '' })).toThrow();
  });
});

describe('updateFolderSchema', () => {
  it('accepts sortOrder as integer', () => {
    const result = updateFolderSchema.parse({ sortOrder: 5 });
    expect(result.sortOrder).toBe(5);
  });

  it('rejects negative sortOrder', () => {
    expect(() => updateFolderSchema.parse({ sortOrder: -1 })).toThrow();
  });
});

describe('createLabelSchema', () => {
  it('accepts a valid label', () => {
    const result = createLabelSchema.parse({ name: 'Important', color: '#ff0000' });
    expect(result.name).toBe('Important');
  });
});

describe('updateLabelSchema', () => {
  it('accepts partial updates', () => {
    const result = updateLabelSchema.parse({ name: 'Urgent' });
    expect(result.name).toBe('Urgent');
  });
});

describe('updateThreadSchema', () => {
  it('accepts valid status and priority', () => {
    const result = updateThreadSchema.parse({ status: 'resolved', priority: 'high' });
    expect(result.status).toBe('resolved');
    expect(result.priority).toBe('high');
  });

  it('rejects invalid status', () => {
    expect(() => updateThreadSchema.parse({ status: 'invalid' })).toThrow();
  });
});

describe('listThreadsSchema', () => {
  it('applies default limit', () => {
    const result = listThreadsSchema.parse({});
    expect(result.limit).toBe(50);
  });

  it('coerces limit from string', () => {
    const result = listThreadsSchema.parse({ limit: '25' });
    expect(result.limit).toBe(25);
  });

  it('rejects limit over 100', () => {
    expect(() => listThreadsSchema.parse({ limit: 200 })).toThrow();
  });

  it('rejects limit of 0', () => {
    expect(() => listThreadsSchema.parse({ limit: 0 })).toThrow();
  });
});

describe('listMessagesSchema', () => {
  it('applies default limit', () => {
    const result = listMessagesSchema.parse({});
    expect(result.limit).toBe(50);
  });

  it('coerces boolean from string', () => {
    const result = listMessagesSchema.parse({ isRead: 'true' });
    expect(result.isRead).toBe(true);
  });
});

describe('composeEmailSchema', () => {
  it('accepts a valid compose request', () => {
    const result = composeEmailSchema.parse({
      mailboxId: 'mbox-123',
      to: ['user@example.com'],
      subject: 'Hello',
      body: 'World',
    });
    expect(result.to).toEqual(['user@example.com']);
  });

  it('rejects empty recipients', () => {
    expect(() =>
      composeEmailSchema.parse({
        mailboxId: 'mbox-123',
        to: [],
        subject: 'Hello',
        body: 'World',
      }),
    ).toThrow();
  });

  it('rejects invalid email addresses', () => {
    expect(() =>
      composeEmailSchema.parse({
        mailboxId: 'mbox-123',
        to: ['not-an-email'],
        subject: 'Hello',
        body: 'World',
      }),
    ).toThrow();
  });

  it('rejects empty subject', () => {
    expect(() =>
      composeEmailSchema.parse({
        mailboxId: 'mbox-123',
        to: ['user@example.com'],
        subject: '',
        body: 'World',
      }),
    ).toThrow();
  });

  it('rejects empty body', () => {
    expect(() =>
      composeEmailSchema.parse({
        mailboxId: 'mbox-123',
        to: ['user@example.com'],
        subject: 'Hello',
        body: '',
      }),
    ).toThrow();
  });
});

describe('saveDraftSchema', () => {
  it('accepts a minimal draft', () => {
    const result = saveDraftSchema.parse({ mailboxId: 'mbox-123' });
    expect(result.mailboxId).toBe('mbox-123');
  });
});

describe('applyLabelSchema', () => {
  it('accepts a valid label ID', () => {
    const result = applyLabelSchema.parse({ labelId: 'label-123' });
    expect(result.labelId).toBe('label-123');
  });

  it('rejects empty label ID', () => {
    expect(() => applyLabelSchema.parse({ labelId: '' })).toThrow();
  });
});

describe('bulkActionSchema', () => {
  it('accepts a valid bulk action', () => {
    const result = bulkActionSchema.parse({
      ids: ['msg-1', 'msg-2'],
      action: 'markRead',
    });
    expect(result.ids).toHaveLength(2);
  });

  it('rejects empty ids array', () => {
    expect(() => bulkActionSchema.parse({ ids: [], action: 'markRead' })).toThrow();
  });

  it('rejects invalid action', () => {
    expect(() => bulkActionSchema.parse({ ids: ['1'], action: 'nuke' })).toThrow();
  });

  it('rejects moveToFolder without folderId', () => {
    expect(() =>
      bulkActionSchema.parse({ ids: ['1'], action: 'moveToFolder' }),
    ).toThrow();
  });

  it('accepts moveToFolder with folderId', () => {
    const result = bulkActionSchema.parse({
      ids: ['1'],
      action: 'moveToFolder',
      folderId: 'folder-1',
    });
    expect(result.folderId).toBe('folder-1');
  });

  it('rejects setStatus without status', () => {
    expect(() =>
      bulkActionSchema.parse({ ids: ['1'], action: 'setStatus' }),
    ).toThrow();
  });

  it('rejects setPriority without priority', () => {
    expect(() =>
      bulkActionSchema.parse({ ids: ['1'], action: 'setPriority' }),
    ).toThrow();
  });

  it('rejects more than 100 ids', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `msg-${i}`);
    expect(() => bulkActionSchema.parse({ ids, action: 'markRead' })).toThrow();
  });
});

describe('assignThreadSchema', () => {
  it('accepts a valid assignment', () => {
    const result = assignThreadSchema.parse({ assigneeId: 'user-123' });
    expect(result.assigneeId).toBe('user-123');
  });

  it('accepts assignment with note', () => {
    const result = assignThreadSchema.parse({ assigneeId: 'user-123', note: 'Handle ASAP' });
    expect(result.note).toBe('Handle ASAP');
  });
});

describe('addThreadNoteSchema', () => {
  it('accepts valid note content', () => {
    const result = addThreadNoteSchema.parse({ content: 'Customer called about this' });
    expect(result.content).toBe('Customer called about this');
  });

  it('rejects empty content', () => {
    expect(() => addThreadNoteSchema.parse({ content: '' })).toThrow();
  });
});

describe('updateThreadNoteSchema', () => {
  it('accepts valid content', () => {
    const result = updateThreadNoteSchema.parse({ content: 'Updated note' });
    expect(result.content).toBe('Updated note');
  });
});
