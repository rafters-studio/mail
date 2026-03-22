import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@react-email/components';
import { BaseEmail } from '../src/templates/base-email.js';
import { OtpEmail } from '../src/templates/otp-email.js';

describe('BaseEmail', () => {
  it('renders valid HTML with doctype', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Test preview',
      children: 'Hello',
    });
    const html = await render(element);

    expect(html).toContain('<!DOCTYPE html');
    expect(html).toContain('</html>');
  });

  it('renders the preview text', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Check this out',
      children: 'Body text',
    });
    const html = await render(element);

    expect(html).toContain('Check this out');
  });

  it('renders brand name in the footer', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Test',
      brandName: 'Acme Corp',
      children: 'Content',
    });
    const html = await render(element);

    expect(html).toContain('Acme Corp');
  });

  it('uses copyrightHolder when provided', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Test',
      brandName: 'Brand',
      copyrightHolder: 'Holder LLC',
      children: 'Content',
    });
    const html = await render(element);

    expect(html).toContain('Holder LLC');
  });

  it('renders unsubscribe link when includeUnsubscribe is true', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Newsletter',
      includeUnsubscribe: true,
      children: 'Content',
    });
    const html = await render(element);

    expect(html).toContain('Unsubscribe');
    expect(html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}');
  });

  it('does not render unsubscribe link by default', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Transactional',
      children: 'Content',
    });
    const html = await render(element);

    expect(html).not.toContain('Unsubscribe');
  });

  it('does not contain hardcoded ezmode references', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Test',
      children: 'Content',
    });
    const html = await render(element);

    expect(html.toLowerCase()).not.toContain('ezmode');
  });

  it('renders website URL as a link when provided', async () => {
    const element = createElement(BaseEmail, {
      preview: 'Test',
      websiteUrl: 'https://example.com',
      brandName: 'Example',
      children: 'Content',
    });
    const html = await render(element);

    expect(html).toContain('https://example.com');
  });
});

describe('OtpEmail', () => {
  it('renders the OTP code', async () => {
    const element = createElement(OtpEmail, { code: '123456' });
    const html = await render(element);

    expect(html).toContain('123456');
  });

  it('renders custom expiry minutes', async () => {
    const element = createElement(OtpEmail, {
      code: '999999',
      expiryMinutes: 5,
    });
    const text = await render(element, { plainText: true });

    expect(text).toContain('5 minutes');
  });

  it('defaults to 10 minutes expiry', async () => {
    const element = createElement(OtpEmail, { code: '000000' });
    const text = await render(element, { plainText: true });

    expect(text).toContain('10 minutes');
  });

  it('renders verify your email heading', async () => {
    const element = createElement(OtpEmail, { code: '111111' });
    const html = await render(element);

    expect(html).toContain('Verify your email');
  });

  it('does not contain hardcoded ezmode references', async () => {
    const element = createElement(OtpEmail, { code: '000000' });
    const html = await render(element);

    expect(html.toLowerCase()).not.toContain('ezmode');
  });

  it('passes brand props through to BaseEmail', async () => {
    const element = createElement(OtpEmail, {
      code: '123456',
      brandName: 'TestBrand',
      websiteUrl: 'https://test.com',
    });
    const html = await render(element);

    expect(html).toContain('TestBrand');
    expect(html).toContain('https://test.com');
  });

  it('does not include unsubscribe link', async () => {
    const element = createElement(OtpEmail, { code: '123456' });
    const html = await render(element);

    expect(html).not.toContain('Unsubscribe');
  });
});
