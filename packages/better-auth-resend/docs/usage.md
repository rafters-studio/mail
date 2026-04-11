# better-auth + Resend OTP Integration

`@rafters/better-auth-resend` glues three things together so better-auth's `emailOTP` plugin sends real emails via Resend using the rafters `OtpEmail` template:

1. [`@rafters/mail-resend`](https://www.npmjs.com/package/@rafters/mail-resend) -- the Resend API client
2. [`@rafters/mail-react-email`](https://www.npmjs.com/package/@rafters/mail-react-email) -- the `OtpEmail` React template and renderer
3. [better-auth](https://better-auth.com) -- the auth system with the `emailOTP` plugin

This package exports a single function, `resendOTP`, that returns the `sendVerificationOTP` function that better-auth's `emailOTP` plugin expects.

## Install

```bash
pnpm add @rafters/better-auth-resend @rafters/mail-resend @rafters/mail-react-email better-auth
```

## Full example

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { resendOTP } from "@rafters/better-auth-resend";

export const auth = betterAuth({
  database: yourDatabase,
  session: yourSessionConfig,

  plugins: [
    emailOTP({
      sendVerificationOTP: resendOTP({
        apiKey: process.env.RESEND_API_KEY!,
        fromEmail: "noreply@example.com",
        brandName: "Example",
      }),
    }),
  ],
});
```

That is the whole integration. `resendOTP` registers the `OtpEmail` template with a React Email renderer, and on each call renders the email with the incoming OTP and sends it via the Resend transactional API (`POST https://api.resend.com/emails`). It returns a `sendVerificationOTP` function that better-auth calls when a user requests a one-time password.

## Configuration

| Option          | Required | Description                                                            |
| --------------- | -------- | ---------------------------------------------------------------------- |
| `apiKey`        | yes      | Resend API key. Needs `transactional emails` permission.               |
| `fromEmail`     | yes      | Sender address. Must be on a domain verified in Resend.                |
| `brandName`     | yes      | Shown in the email subject (`"<brandName> verification code: <otp>"`). |
| `logoUrl`       | no       | Header logo image URL for the OTP email template.                      |
| `websiteUrl`    | no       | Link target for the logo and brand name.                               |
| `expiryMinutes` | no       | Shown in the email body text. Defaults to `10`.                        |
| `baseUrl`       | no       | Resend API base URL. Defaults to `https://api.resend.com`.             |

## What the user sees

When a user requests a one-time password via better-auth's emailOTP plugin, this package sends an email rendered from the `OtpEmail` template:

- **Subject:** `<brandName> verification code: <otp>`
- **Body:** The OTP code in a large, copyable format, with the `expiryMinutes` shown in the expiry note
- **Sender:** The `fromEmail` address you configured

The template is part of `@rafters/mail-react-email`. Its layout is documented in that package's `docs/templates.md`.

## Replacing the template

If you need a custom OTP email design, do not use this package. Wire `emailOTP` to your own function that calls `createReactEmailRenderer` with your own template registered:

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createResendProvider } from "@rafters/mail-resend";
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { YourCustomOtpEmail } from "./templates/your-otp.tsx";

const provider = createResendProvider({
  apiKey: process.env.RESEND_API_KEY!,
  fromEmail: "noreply@example.com",
});
const renderer = createReactEmailRenderer({
  "custom-otp": YourCustomOtpEmail,
});

export const auth = betterAuth({
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp }) {
        const { html, text } = await renderer.render("custom-otp", { otp });
        await provider.sendEmail({
          to: email,
          subject: `Your code: ${otp}`,
          html,
          text,
        });
      },
    }),
  ],
});
```

This package exists only to remove that boilerplate for the common case of "use the default template".

## Troubleshooting

**Email never arrives.** Check the Resend dashboard for delivery events. Most first-run failures are domain verification, not code.

**Resend returns 403.** Your API key is missing the `transactional emails` permission, or the `fromEmail` domain is not verified in the Resend account for that key.

**Rate limited.** Resend free tier is 3,000 emails / month, 100 / day. Upgrade the plan or throttle emailOTP requests upstream.
