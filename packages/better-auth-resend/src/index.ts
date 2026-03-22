import { z } from "zod";

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
    const text = [
      `Your ${validated.brandName} verification code is: ${otp}`,
      "",
      `This code expires in ${validated.expiryMinutes} minutes.`,
      "",
      "If you did not request this code, you can safely ignore this email.",
    ].join("\n");

    const html = [
      '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">',
      validated.logoUrl
        ? `<img src="${validated.logoUrl}" alt="${validated.brandName}" style="max-height: 40px; margin-bottom: 24px;" />`
        : "",
      '<h2 style="margin: 0 0 16px;">Verification Code</h2>',
      `<p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 24px 0; font-family: monospace;">${otp}</p>`,
      `<p>This code expires in ${validated.expiryMinutes} minutes.</p>`,
      '<p style="color: #666; font-size: 14px;">If you did not request this code, you can safely ignore this email.</p>',
      validated.websiteUrl
        ? `<hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" /><p style="color: #999; font-size: 12px;"><a href="${validated.websiteUrl}" style="color: #999;">${validated.brandName}</a></p>`
        : "",
      "</div>",
    ].join("\n");

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
        text,
        html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send OTP email: ${response.status} ${errorText}`);
    }
  };
}
