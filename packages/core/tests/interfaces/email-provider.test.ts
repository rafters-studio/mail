import { describe, expect, it } from 'vitest';
import {
  audienceSchema,
  campaignParamsSchema,
  campaignStatusSchema,
  emailParamsSchema,
  mailingListSchema,
  subscriberDataSchema,
  subscriberSchema,
  subscriberUpdatesSchema,
} from '../../src/interfaces/email-provider.js';

describe('emailParamsSchema', () => {
  it('accepts valid transactional email params', () => {
    const result = emailParamsSchema.parse({
      to: 'user@example.com',
      subject: 'Hello',
    });
    expect(result.to).toBe('user@example.com');
  });

  it('rejects invalid email address', () => {
    expect(() => emailParamsSchema.parse({ to: 'bad', subject: 'Hi' })).toThrow();
  });

  it('rejects empty subject', () => {
    expect(() => emailParamsSchema.parse({ to: 'a@b.com', subject: '' })).toThrow();
  });
});

describe('mailingListSchema', () => {
  it('accepts valid mailing list', () => {
    const result = mailingListSchema.parse({
      id: 'list-1',
      name: 'Newsletter',
      createdAt: new Date(),
    });
    expect(result.name).toBe('Newsletter');
  });
});

describe('subscriberSchema', () => {
  it('accepts valid subscriber', () => {
    const result = subscriberSchema.parse({
      id: 'sub-1',
      email: 'user@example.com',
      unsubscribed: false,
    });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() =>
      subscriberSchema.parse({ id: '1', email: 'bad', unsubscribed: false }),
    ).toThrow();
  });
});

describe('subscriberDataSchema', () => {
  it('accepts partial subscriber data', () => {
    const result = subscriberDataSchema.parse({ firstName: 'Sean' });
    expect(result.firstName).toBe('Sean');
  });

  it('accepts empty object', () => {
    const result = subscriberDataSchema.parse({});
    expect(result).toEqual({});
  });
});

describe('subscriberUpdatesSchema', () => {
  it('accepts unsubscribe update', () => {
    const result = subscriberUpdatesSchema.parse({ unsubscribed: true });
    expect(result.unsubscribed).toBe(true);
  });
});

describe('campaignParamsSchema', () => {
  it('accepts valid campaign params', () => {
    const result = campaignParamsSchema.parse({
      listId: 'list-1',
      subject: 'Weekly Update',
      html: '<p>Content</p>',
      from: 'news@example.com',
    });
    expect(result.listId).toBe('list-1');
  });

  it('rejects empty html', () => {
    expect(() =>
      campaignParamsSchema.parse({
        listId: 'list-1',
        subject: 'Hi',
        html: '',
        from: 'a@b.com',
      }),
    ).toThrow();
  });
});

describe('campaignStatusSchema', () => {
  it('accepts valid campaign status', () => {
    const result = campaignStatusSchema.parse({
      id: 'camp-1',
      status: 'sent',
      subject: 'Weekly',
      sentAt: new Date(),
    });
    expect(result.status).toBe('sent');
  });

  it('accepts null sentAt for draft', () => {
    const result = campaignStatusSchema.parse({
      id: 'camp-1',
      status: 'draft',
      subject: 'Draft',
      sentAt: null,
    });
    expect(result.sentAt).toBeNull();
  });

  it('rejects invalid status', () => {
    expect(() =>
      campaignStatusSchema.parse({
        id: '1',
        status: 'failed',
        subject: 'X',
        sentAt: null,
      }),
    ).toThrow();
  });
});

describe('audienceSchema', () => {
  it('accepts valid audience', () => {
    const result = audienceSchema.parse({
      id: 'aud-1',
      name: 'All Users',
      createdAt: new Date(),
    });
    expect(result.name).toBe('All Users');
  });
});
