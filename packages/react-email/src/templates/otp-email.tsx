import { Heading, Section, Text } from '@react-email/components';
import { BaseEmail } from './base-email.js';

export interface OtpEmailProps {
  code: string;
  expiryMinutes?: number;
  brandName?: string;
  logoUrl?: string;
  websiteUrl?: string;
}

export function OtpEmail({
  code,
  expiryMinutes = 10,
  brandName,
  logoUrl,
  websiteUrl,
}: OtpEmailProps) {
  return (
    <BaseEmail
      preview={`Your verification code is ${code}`}
      {...(brandName !== undefined ? { brandName } : {})}
      {...(logoUrl !== undefined ? { logoUrl } : {})}
      {...(websiteUrl !== undefined ? { websiteUrl } : {})}
      includeUnsubscribe={false}
    >
      <Heading style={heading}>Verify your email</Heading>

      <Text style={paragraph}>
        Enter this code to verify your email address:
      </Text>

      <Section style={codeContainer}>
        <Text style={codeText}>{code}</Text>
      </Section>

      <Text style={expiryText}>
        This code expires in {expiryMinutes} minutes.
      </Text>

      <Text style={securityNote}>
        If you didn&apos;t request this code, you can safely ignore this email.
        Someone may have entered your email address by mistake.
      </Text>
    </BaseEmail>
  );
}

// -- Styles --

const heading = {
  color: '#1f2937',
  fontSize: '24px',
  fontWeight: '600' as const,
  lineHeight: '32px',
  margin: '0 0 16px',
  textAlign: 'center' as const,
};

const paragraph = {
  color: '#374151',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 24px',
  textAlign: 'center' as const,
};

const codeContainer = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  margin: '0 auto 24px',
  padding: '24px',
  textAlign: 'center' as const,
};

const codeText = {
  color: '#1f2937',
  fontSize: '36px',
  fontWeight: '700' as const,
  fontFamily: 'monospace',
  letterSpacing: '8px',
  margin: '0',
};

const expiryText = {
  color: '#6b7280',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 24px',
  textAlign: 'center' as const,
};

const securityNote = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '0',
  textAlign: 'center' as const,
};
