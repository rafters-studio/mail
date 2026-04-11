# React Email Templates

`@rafters/mail-react-email` ships a small library of React Email templates and a name-keyed renderer that produces HTML + plain text output. Templates are regular React components wrapped into a registry so the `TemplateRenderer` interface in core can select them by string name.

## BaseEmail

The shared layout for every rafters template. Use it directly or wrap it in a named template.

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

`BaseEmail` supplies:

- HTML `<html>` / `<body>` / `<head>` boilerplate with inlined styles
- Email-safe container layout that works in Gmail, Outlook, Apple Mail
- A `preview` prop that sets the email preview text shown in the inbox list before the user opens the message
- Standard font stack and line-height for readable long-form content

Children render inside the content block. Style children with React Email's `<Section>`, `<Row>`, `<Text>`, `<Button>`, and `<Hr>` for portable cross-client output.

## OtpEmail

Prebuilt one-time password email. Used by `@rafters/better-auth-resend` for the emailOTP verification flow.

```typescript
import { OtpEmail } from "@rafters/mail-react-email/otp";

const component = OtpEmail({
  code: "123456",
  brandName: "Example",
  expiryMinutes: 10,
});
```

Props:

| Prop            | Required | Description                                 |
| --------------- | -------- | ------------------------------------------- |
| `code`          | yes      | The one-time password to display            |
| `expiryMinutes` | no       | Shown in the expiry note. Defaults to `10`. |
| `brandName`     | no       | Shown in the header and footer              |
| `logoUrl`       | no       | Header logo image URL                       |
| `websiteUrl`    | no       | Link target for the logo and brand name     |

## Renderer (registry pattern)

`createReactEmailRenderer(templates?)` returns a `TemplateRenderer` matching the interface in `@rafters/mail`, extended with a `register(name, component)` method. Templates are registered by **string name** and looked up at `render()` time. You do NOT pass React components directly to `render()` -- you pass a registered name and props.

```typescript
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OtpEmail } from "@rafters/mail-react-email/otp";
import { WelcomeEmail } from "./templates/welcome.tsx";

// Register templates at construction time
const renderer = createReactEmailRenderer({
  otp: OtpEmail,
  welcome: WelcomeEmail,
});

// Or register at runtime
renderer.register("order-shipped", OrderShippedEmail);

// Render by name + props
const { html, text } = await renderer.render("welcome", { name: "Sean" });
```

The renderer throws if the template name is not registered; the error lists the registered names so debugging is straightforward. Plain text output is derived from the React tree automatically -- if you need custom text output, return a `<Text>` component with the exact text you want.

### Why a registry instead of passing components

The core `TemplateRenderer` interface is:

```typescript
interface TemplateRenderer {
  render(
    template: string,
    props: Record<string, unknown>,
  ): Promise<{ html: string; text?: string }>;
}
```

String-keyed templates let service code refer to templates by stable names (`"otp"`, `"welcome"`) without importing the React components, which keeps the core services package free of React. The rafters renderer is the bridge: it holds the component registry on one side and exposes the string-keyed interface on the other.

## Writing your own template

Wrap `BaseEmail` and add React Email components inside, then register the component with a name so the renderer can find it:

```tsx
// templates/order-shipped.tsx
import { BaseEmail } from "@rafters/mail-react-email/templates";
import { Section, Text, Button, Hr } from "@react-email/components";

interface OrderShippedProps {
  customerName: string;
  trackingNumber: string;
  trackingUrl: string;
}

export function OrderShippedEmail(props: OrderShippedProps) {
  return (
    <BaseEmail preview={`Your order is on the way -- ${props.trackingNumber}`}>
      <Section>
        <Text>Hi {props.customerName},</Text>
        <Text>Your order has shipped. Track it any time:</Text>
        <Button href={props.trackingUrl}>Track package</Button>
        <Hr />
        <Text>Tracking number: {props.trackingNumber}</Text>
      </Section>
    </BaseEmail>
  );
}
```

```typescript
// Register and use
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OrderShippedEmail } from "./templates/order-shipped.tsx";

const renderer = createReactEmailRenderer({
  "order-shipped": OrderShippedEmail,
});

const { html, text } = await renderer.render("order-shipped", {
  customerName: "Sean",
  trackingNumber: "1Z999",
  trackingUrl: "https://example.com/track/1Z999",
});
```

Pass the result to your email provider.

## Exports

| Subpath       | Exports                    |
| ------------- | -------------------------- |
| `.`           | Top-level re-exports       |
| `./renderer`  | `createReactEmailRenderer` |
| `./templates` | `BaseEmail`                |
| `./otp`       | `OtpEmail`                 |
