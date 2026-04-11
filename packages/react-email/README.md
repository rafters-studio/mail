# @rafters/mail-react-email

React Email template renderer for [@rafters/mail](https://github.com/rafters-studio/mail). Ships two baseline templates (`BaseEmail` and `OtpEmail`) and a `TemplateRenderer` implementation that produces HTML + text output from any React Email component.

## Install

```bash
pnpm add @rafters/mail-react-email @rafters/mail
```

## Usage

### Renderer

```typescript
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OtpEmail } from "@rafters/mail-react-email/otp";

const renderer = createReactEmailRenderer();

const { html, text } = await renderer.render(
  OtpEmail({ otp: "123456", appName: "Example" }),
);
```

`createReactEmailRenderer` returns a `TemplateRenderer` matching the interface in `@rafters/mail`, so it drops into any service that expects a renderer.

### BaseEmail template

`BaseEmail` is the shared layout for all rafters templates. Use it directly or extend it for your own templates:

```typescript
import { BaseEmail } from "@rafters/mail-react-email/templates";

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <BaseEmail preview="Welcome to Example">
      <h1>Welcome, {name}</h1>
      <p>Thanks for signing up.</p>
    </BaseEmail>
  );
}
```

### OtpEmail template

Prebuilt one-time password email, used by `@rafters/better-auth-resend` for the emailOTP flow:

```typescript
import { OtpEmail } from "@rafters/mail-react-email/otp";

const component = OtpEmail({
  otp: "123456",
  appName: "Example",
  expiresInMinutes: 10,
});
```

## Exports

| Subpath       | What                                          |
| ------------- | --------------------------------------------- |
| `.`           | Top-level re-exports                          |
| `./renderer`  | `createReactEmailRenderer`                    |
| `./templates` | `BaseEmail`                                   |
| `./otp`       | `OtpEmail`                                    |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`templates.md`](./docs/templates.md) -- `BaseEmail`, `OtpEmail`, writing your own templates, and rendering through the `TemplateRenderer` interface

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the @rafters/mail architecture.

## License

MIT
