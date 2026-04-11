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
        from: "noreply@example.com",
        appName: "Example",
      }),
    }),
  ],
});
```

That is the whole integration. `resendOTP` builds a Resend provider from your API key, renders `OtpEmail` via the React Email renderer, and returns a `sendVerificationOTP` function that better-auth calls when a user requests a one-time password.

## Configuration

| Option    | Required | Description                                                    |
| --------- | -------- | -------------------------------------------------------------- |
| `apiKey`  | yes      | Resend API key. Needs `transactional emails` permission.       |
| `from`    | yes      | Sender address. Must be on a domain verified in Resend.        |
| `appName` | yes      | Shown in the email subject (`"Your Example code"`) and body.   |

## What the user sees

When a user requests a one-time password via better-auth's emailOTP plugin, this package sends an email using the `OtpEmail` template:

- **Subject:** `Your <appName> code: <otp>`
- **Body:** The OTP code in a large, copyable format, with an expiry note (defaults to 10 minutes, managed by better-auth's emailOTP plugin configuration)
- **Sender:** The `from` address you configured

The template is part of `@rafters/mail-react-email`, so its appearance and layout are documented there. If you want a different template, render your own and pass a custom `sendVerificationOTP` to better-auth directly instead of using this package.

## Replacing the template

If you need a custom OTP email design, you do not use this package. Instead, wire `emailOTP` to your own function:

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createResendProvider } from "@rafters/mail-resend";
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { YourCustomOtpEmail } from "./templates/your-otp.tsx";

const provider = createResendProvider({ apiKey: process.env.RESEND_API_KEY! });
const renderer = createReactEmailRenderer();

export const auth = betterAuth({
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        const { html, text } = await renderer.render(
          YourCustomOtpEmail({ otp, type }),
        );
        await provider.send({
          to: email,
          from: "noreply@example.com",
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

**Resend returns 403.** Your API key is missing the `transactional emails` permission, or the `from` domain is not verified in the Resend account for that key.

**Rate limited.** Resend free tier is 3,000 emails / month, 100 / day. Upgrade the plan or throttle emailOTP requests upstream.
