import { z } from "zod";
import { OtpEmail, renderTemplate } from "@rafters/mail-react-email";

export const resendOTPConfigSchema = z.object({
  apiKey: z.string().min(1),
  fromEmail: z.string().email(),
  brandName: z.string().min(1),
  logoUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  expiryMinutes: z.number().int().min(1).default(10),
  baseUrl: z.string().url().default("https://api.resend.com"),
});

export type ResendOTPConfig = z.infer<typeof resendOTPConfigSchema>;

export function resendOTP(config: ResendOTPConfig): (email: string, otp: string) => Promise<void> {
  const validated = resendOTPConfigSchema.parse(config);

  return async (email: string, otp: string): Promise<void> => {
    const subject = `${validated.brandName} verification code: ${otp}`;

    const content = await renderTemplate(OtpEmail, {
      code: otp,
      expiryMinutes: validated.expiryMinutes,
      brandName: validated.brandName,
      ...(validated.logoUrl !== undefined ? { logoUrl: validated.logoUrl } : {}),
      ...(validated.websiteUrl !== undefined ? { websiteUrl: validated.websiteUrl } : {}),
    });
    if (!("html" in content)) {
      throw new Error("OtpEmail rendered without HTML");
    }
    const { html, text } = content;

    const response = await fetch(`${validated.baseUrl}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validated.apiKey}`,
      },
      body: JSON.stringify({
        from: validated.fromEmail,
        to: email,
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send OTP email: ${response.status} ${errorText}`);
    }
  };
}
