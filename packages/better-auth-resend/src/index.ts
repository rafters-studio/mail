import { z } from "zod";
import { OtpEmail } from "@rafters/mail-react-email";
import { createReactEmailRenderer } from "@rafters/mail-react-email";

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
  const renderer = createReactEmailRenderer({
    otp: OtpEmail as unknown as (props: Record<string, unknown>) => React.ReactElement,
  });

  return async (email: string, otp: string): Promise<void> => {
    const subject = `${validated.brandName} verification code: ${otp}`;

    const { html, text } = await renderer.render("otp", {
      code: otp,
      expiryMinutes: validated.expiryMinutes,
      brandName: validated.brandName,
      logoUrl: validated.logoUrl,
      websiteUrl: validated.websiteUrl,
    });

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
