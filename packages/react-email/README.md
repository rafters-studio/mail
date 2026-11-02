# @rafters/mail-react-email

React Email templates for [@rafters/mail](https://github.com/rafters-studio/mail). `renderTemplate(component, props)` renders one React Email component as `{ html, text }`, the content mail's writer writes as given. Ships two baseline templates, `BaseEmail` and `OtpEmail`.

## Install

```bash
pnpm add @rafters/mail-react-email @rafters/mail
```

## Usage

### renderTemplate

```typescript
import { OtpEmail, renderTemplate } from "@rafters/mail-react-email";

const content = await renderTemplate(OtpEmail, {
  code: "123456",
  brandName: "Example",
  year: 2026,
});
// content is { html, text }: hand it to mail as the message's content.
```

The HTML has React's server-rendering comments removed, and the text is React Email's plain-text rendering of the same component. Content with an empty text is refused by the writer with `no-text`, field `text`.

### BaseEmail template

`BaseEmail` is the shared layout for all rafters templates. Use it directly or wrap it in your own template:

```tsx
import { BaseEmail } from "@rafters/mail-react-email";

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <BaseEmail preview="Welcome to Example" year={2026}>
      <h1>Welcome, {name}</h1>
      <p>Thanks for signing up.</p>
    </BaseEmail>
  );
}

const content = await renderTemplate(WelcomeEmail, { name: "Sean" });
```

### OtpEmail template

Prebuilt one-time password email, used by `@rafters/better-auth-resend` for the emailOTP flow.

Props: `code` (required), `expiryMinutes` (optional, default 10), `brandName`, `logoUrl`, `websiteUrl`, `year` (all optional).

### The year

`BaseEmail` and `OtpEmail` take `year?: number` for the copyright line. Given, the template renders the same bytes on any day; left out, it uses the current year.

## Exports

| Subpath | What                                                                         |
| ------- | ---------------------------------------------------------------------------- |
| `.`     | `renderTemplate`, `BaseEmail`, `BaseEmailProps`, `OtpEmail`, `OtpEmailProps` |

## Documentation

- [`templates.md`](./docs/templates.md) -- `BaseEmail`, `OtpEmail`, writing your own templates, and rendering them with `renderTemplate`

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the @rafters/mail architecture.

## License

MIT
