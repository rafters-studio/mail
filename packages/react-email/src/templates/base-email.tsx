import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

export interface BaseEmailProps {
  preview: string;
  children: ReactNode;
  logoUrl?: string;
  websiteUrl?: string;
  brandName?: string;
  copyrightHolder?: string;
  includeUnsubscribe?: boolean;
}

export function BaseEmail({
  preview,
  children,
  logoUrl,
  websiteUrl,
  brandName = 'Our Service',
  copyrightHolder,
  includeUnsubscribe = false,
}: BaseEmailProps) {
  const holder = copyrightHolder ?? brandName;

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            {logoUrl ? (
              websiteUrl ? (
                <Link href={websiteUrl}>
                  <Img
                    src={logoUrl}
                    width="120"
                    height="40"
                    alt={brandName}
                    style={logo}
                  />
                </Link>
              ) : (
                <Img
                  src={logoUrl}
                  width="120"
                  height="40"
                  alt={brandName}
                  style={logo}
                />
              )
            ) : websiteUrl ? (
              <Text style={brandText}>
                <Link href={websiteUrl} style={brandLink}>
                  {brandName}
                </Link>
              </Text>
            ) : (
              <Text style={brandText}>{brandName}</Text>
            )}
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            {websiteUrl ? (
              <Text style={footerText}>
                <Link href={websiteUrl} style={footerLink}>
                  {brandName}
                </Link>
              </Text>
            ) : (
              <Text style={footerText}>{brandName}</Text>
            )}

            {includeUnsubscribe && (
              <Text style={unsubscribeText}>
                <Link
                  href={'{{{RESEND_UNSUBSCRIBE_URL}}}'}
                  style={unsubscribeLink}
                >
                  Unsubscribe
                </Link>
              </Text>
            )}

            <Text style={copyrightText}>
              &copy; {new Date().getFullYear()} {holder}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// -- Styles --

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
};

const header = {
  padding: '24px 32px',
  borderBottom: '1px solid #e6ebf1',
};

const logo = {
  margin: '0 auto',
  display: 'block',
};

const brandText = {
  fontSize: '20px',
  fontWeight: '600' as const,
  textAlign: 'center' as const,
  margin: '0',
  color: '#1f2937',
};

const brandLink = {
  color: '#1f2937',
  textDecoration: 'none',
};

const content = {
  padding: '32px',
};

const footer = {
  padding: '24px 32px',
  borderTop: '1px solid #e6ebf1',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 8px',
};

const footerLink = {
  color: '#556cd6',
  textDecoration: 'none',
};

const unsubscribeText = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '16px 0 0',
};

const unsubscribeLink = {
  color: '#8898aa',
  textDecoration: 'underline',
};

const copyrightText = {
  color: '#b0b8c4',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '8px 0 0',
};
