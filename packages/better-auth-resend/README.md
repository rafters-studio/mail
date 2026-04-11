# @rafters/better-auth-resend

One-line emailOTP integration for [better-auth](https://better-auth.com) using [`@rafters/mail-resend`](https://www.npmjs.com/package/@rafters/mail-resend) + [`@rafters/mail-react-email`](https://www.npmjs.com/package/@rafters/mail-react-email). Glues the three together so better-auth's `emailOTP` plugin sends real emails through Resend with the rafters `OtpEmail` template.

Part of [@rafters/mail](https://github.com/rafters-studio/mail).

## Install

```bash
pnpm add @rafters/better-auth-resend @rafters/mail-resend @rafters/mail-react-email better-auth
```

## Usage

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { resendOTP } from "@rafters/better-auth-resend";

export const auth = betterAuth({
  // ... your database, session, etc.
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

That is the whole integration. `resendOTP` registers the `OtpEmail` template with a React Email renderer and returns the `sendVerificationOTP` function that better-auth's emailOTP plugin expects.

## Configuration

| Option          | Required | Description                                                            |
| --------------- | -------- | ---------------------------------------------------------------------- |
| `apiKey`        | yes      | Resend API key                                                         |
| `fromEmail`     | yes      | Sender address. Must be a verified domain in Resend.                   |
| `brandName`     | yes      | Shown in the email subject (`"<brandName> verification code: <otp>"`). |
| `logoUrl`       | no       | Header logo image URL                                                  |
| `websiteUrl`    | no       | Link target for logo and brand name                                    |
| `expiryMinutes` | no       | Shown in body text. Defaults to `10`.                                  |
| `baseUrl`       | no       | Resend API base URL. Defaults to `https://api.resend.com`.             |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`usage.md`](./docs/usage.md) -- Full better-auth + emailOTP integration example, configuration options, troubleshooting, and how to replace the default template

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the wider @rafters/mail architecture.

## License

MIT
