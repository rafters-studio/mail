import { describe, expect, it } from 'vitest';
import {
  addContactRequestSchema,
  createAudienceRequestSchema,
  createBroadcastRequestSchema,
  emailAttachmentSchema,
  resendAudienceSchema,
  resendBroadcastDetailSchema,
  resendContactSchema,
  sendTransactionalRequestSchema,
} from '../src/resend-types.js';

describe('resendAudienceSchema', () => {
  it('accepts valid audience response', () => {
    const result = resendAudienceSchema.parse({
      id: 'aud_123',
      name: 'Newsletter',
      created_at: '2026-03-21T00:00:00.000Z',
    });
    expect(result.id).toBe('aud_123');
  });
});

describe('resendContactSchema', () => {
  it('accepts valid contact response', () => {
    const result = resendContactSchema.parse({
      id: 'con_123',
      email: 'user@example.com',
      first_name: 'Sean',
      last_name: null,
      created_at: '2026-03-21T00:00:00.000Z',
      unsubscribed: false,
    });
    expect(result.email).toBe('user@example.com');
  });
});

describe('createAudienceRequestSchema', () => {
  it('rejects empty name', () => {
    expect(() => createAudienceRequestSchema.parse({ name: '' })).toThrow();
  });
});

describe('addContactRequestSchema', () => {
  it('accepts valid contact request', () => {
    const result = addContactRequestSchema.parse({
      email: 'user@example.com',
      firstName: 'Sean',
    });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => addContactRequestSchema.parse({ email: 'bad' })).toThrow();
  });
});

describe('createBroadcastRequestSchema', () => {
  it('accepts valid broadcast request', () => {
    const result = createBroadcastRequestSchema.parse({
      audienceId: 'aud_123',
      from: 'news@example.com',
      subject: 'Weekly',
      html: '<p>Content</p>',
    });
    expect(result.audienceId).toBe('aud_123');
  });

  it('rejects empty subject', () => {
    expect(() =>
      createBroadcastRequestSchema.parse({
        audienceId: 'aud_123',
        from: 'news@example.com',
        subject: '',
      }),
    ).toThrow();
  });
});

describe('sendTransactionalRequestSchema', () => {
  it('accepts single recipient', () => {
    const result = sendTransactionalRequestSchema.parse({
      to: 'user@example.com',
      subject: 'Hello',
    });
    expect(result.to).toBe('user@example.com');
  });

  it('accepts array of recipients', () => {
    const result = sendTransactionalRequestSchema.parse({
      to: ['a@b.com', 'c@d.com'],
      subject: 'Hello',
    });
    expect(result.to).toHaveLength(2);
  });

  it('accepts attachments', () => {
    const result = sendTransactionalRequestSchema.parse({
      to: 'user@example.com',
      subject: 'With file',
      attachments: [{ filename: 'doc.pdf', content: 'base64data' }],
    });
    expect(result.attachments).toHaveLength(1);
  });
});

describe('emailAttachmentSchema', () => {
  it('accepts valid attachment', () => {
    const result = emailAttachmentSchema.parse({
      filename: 'report.pdf',
      content: 'base64content',
      contentType: 'application/pdf',
    });
    expect(result.filename).toBe('report.pdf');
  });
});

describe('resendBroadcastDetailSchema', () => {
  it('accepts broadcast with status', () => {
    const result = resendBroadcastDetailSchema.parse({
      id: 'bc_123',
      audience_id: 'aud_123',
      from: 'news@example.com',
      subject: 'Weekly',
      created_at: '2026-03-21T00:00:00.000Z',
      status: 'sent',
      sent_at: '2026-03-21T01:00:00.000Z',
    });
    expect(result.status).toBe('sent');
  });

  it('rejects invalid status', () => {
    expect(() =>
      resendBroadcastDetailSchema.parse({
        id: 'bc_123',
        audience_id: 'aud_123',
        from: 'a@b.com',
        subject: 'X',
        created_at: '2026-03-21T00:00:00.000Z',
        status: 'failed',
      }),
    ).toThrow();
  });
});
