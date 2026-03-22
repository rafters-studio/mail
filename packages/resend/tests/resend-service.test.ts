import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ResendService, ResendError } from '../src/resend-service.js';

describe('ResendService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
    const mockFn = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
    vi.stubGlobal('fetch', mockFn);
    return mockFn;
  }

  const config = { apiKey: 're_test_key', fromEmail: 'test@example.com' };

  describe('sendTransactional', () => {
    it('sends email with correct headers', async () => {
      const fetchMock = mockFetch(200, { id: 'email_123' });
      const service = new ResendService(config);

      const result = await service.sendTransactional({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'World',
      });

      expect(result.id).toBe('email_123');
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer re_test_key');
    });

    it('uses fromEmail as default from', async () => {
      const fetchMock = mockFetch(200, { id: 'email_123' });
      const service = new ResendService(config);

      await service.sendTransactional({ to: 'user@example.com', subject: 'Hi' });

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body.from).toBe('test@example.com');
    });
  });

  describe('error handling', () => {
    it('throws ResendError on 429 with Retry-After', async () => {
      mockFetch(429, 'Rate limited', { 'Retry-After': '30' });
      const service = new ResendService(config);

      await expect(
        service.sendTransactional({ to: 'a@b.com', subject: 'Hi' }),
      ).rejects.toThrow(ResendError);

      try {
        await service.sendTransactional({ to: 'a@b.com', subject: 'Hi' });
      } catch (e) {
        expect(e).toBeInstanceOf(ResendError);
        expect((e as ResendError).statusCode).toBe(429);
      }
    });

    it('throws ResendError on API error with message', async () => {
      mockFetch(400, { message: 'Invalid email' });
      const service = new ResendService(config);

      await expect(
        service.sendTransactional({ to: 'a@b.com', subject: 'Hi' }),
      ).rejects.toThrow('Invalid email');
    });
  });

  describe('DELETE endpoints', () => {
    it('handles 204 No Content without crashing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
        json: () => { throw new Error('Should not call json on 204'); },
        text: () => Promise.resolve(''),
      }));

      const service = new ResendService(config);
      await expect(service.deleteAudience('aud_123')).resolves.not.toThrow();
    });
  });

  describe('createAudience', () => {
    it('validates input and sends POST', async () => {
      const fetchMock = mockFetch(200, { id: 'aud_123', name: 'Newsletter', created_at: '2026-03-21T00:00:00.000Z' });
      const service = new ResendService(config);

      const result = await service.createAudience({ name: 'Newsletter' });
      expect(result.id).toBe('aud_123');
      expect(result.name).toBe('Newsletter');
    });

    it('rejects empty name with Zod validation', () => {
      const service = new ResendService(config);
      expect(() => service.createAudience({ name: '' })).toThrow();
    });
  });
});
