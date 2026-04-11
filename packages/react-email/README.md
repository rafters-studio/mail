# @rafters/mail-react-email

React Email template renderer for [@rafters/mail](https://github.com/rafters-studio/mail). Ships two baseline templates (`BaseEmail` and `OtpEmail`) and a name-keyed `TemplateRenderer` implementation that produces HTML + text output from registered React Email components.

## Install

```bash
pnpm add @rafters/mail-react-email @rafters/mail
```

## Usage

### Renderer (registry pattern)

```typescript
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OtpEmail } from "@rafters/mail-react-email/otp";

// Register templates by name at construction time (or later via `.register()`)
const renderer = createReactEmailRenderer({
  otp: OtpEmail,
});

// Render by template name + props
const { html, text } = await renderer.render("otp", {
  code: "123456",
  brandName: "Example",
});
```

`createReactEmailRenderer` returns a `TemplateRenderer` (from `@rafters/mail`) extended with a `register(name, component)` method. The core `TemplateRenderer` interface is `render(template: string, props: Record<string, unknown>)` -- you pass a registered template name, not a component -- which is why the renderer holds a name-keyed registry internally.

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
  code: "123456",
  brandName: "Example",
  expiryMinutes: 10,
});
```

Props: `code` (required), `expiryMinutes` (optional, default 10), `brandName`, `logoUrl`, `websiteUrl` (all optional).

## Exports

| Subpath       | What                       |
| ------------- | -------------------------- |
| `.`           | Top-level re-exports       |
| `./renderer`  | `createReactEmailRenderer` |
| `./templates` | `BaseEmail`                |
| `./otp`       | `OtpEmail`                 |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`templates.md`](./docs/templates.md) -- `BaseEmail`, `OtpEmail`, writing your own templates, and rendering through the `TemplateRenderer` interface

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the @rafters/mail architecture.

## License

MIT
