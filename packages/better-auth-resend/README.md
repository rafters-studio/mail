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
        apiKey: env.RESEND_API_KEY,
        from: "noreply@example.com",
        appName: "Example",
      }),
    }),
  ],
});
```

That is the whole integration. `resendOTP` builds the Resend provider, renders `OtpEmail` via the React Email renderer, and returns the `sendVerificationOTP` function that better-auth's emailOTP plugin expects.

## Configuration

| Option    | Required | Description                                                    |
| --------- | -------- | -------------------------------------------------------------- |
| `apiKey`  | yes      | Resend API key                                                 |
| `from`    | yes      | Sender address -- must be a verified domain in Resend          |
| `appName` | yes      | Shown in the email subject and body (e.g., "Example")          |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`usage.md`](./docs/usage.md) -- Full better-auth + emailOTP integration example, configuration options, troubleshooting, and how to replace the default template

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the wider @rafters/mail architecture.

## License

MIT
