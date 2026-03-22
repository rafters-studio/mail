import { describe, expect, it } from 'vitest';
import { inboundEmailSchema } from '../../src/interfaces/inbound-adapter.js';

describe('inboundEmailSchema', () => {
  it('accepts valid inbound email', () => {
    const result = inboundEmailSchema.parse({
      raw: new ArrayBuffer(100),
      from: 'sender@example.com',
      to: 'inbox@example.com',
      headers: { 'message-id': '<abc@example.com>' },
    });
    expect(result.from).toBe('sender@example.com');
  });

  it('rejects invalid from email', () => {
    expect(() =>
      inboundEmailSchema.parse({
        raw: new ArrayBuffer(0),
        from: 'not-email',
        to: 'inbox@example.com',
        headers: {},
      }),
    ).toThrow();
  });
});
