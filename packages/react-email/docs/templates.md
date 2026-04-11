# React Email Templates

`@rafters/mail-react-email` ships a small library of React Email templates and a renderer that produces HTML + plain text output. Templates are regular React components rendered through `@react-email/components`.

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
  otp: "123456",
  appName: "Example",
  expiresInMinutes: 10,
});
```

Props:

| Prop               | Required | Description                                    |
| ------------------ | -------- | ---------------------------------------------- |
| `otp`              | yes      | The one-time password to display               |
| `appName`          | yes      | Shown in subject and body                      |
| `expiresInMinutes` | optional | Displayed in the email body. Defaults to `10`. |

## Renderer

`createReactEmailRenderer()` returns a `TemplateRenderer` matching the interface in `@rafters/mail`. It renders any React Email component into a `{ html, text }` pair.

```typescript
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { WelcomeEmail } from "./templates/welcome.tsx";

const renderer = createReactEmailRenderer();

const { html, text } = await renderer.render(WelcomeEmail({ name: "Sean" }));
```

The renderer uses React Email's `render` function under the hood. Plain text output is derived from the React tree automatically -- if you need custom text output, return a `<Text>` component with the exact text you want.

## Writing your own template

Wrap `BaseEmail` and add React Email components inside:

```typescript
import { BaseEmail } from "@rafters/mail-react-email/templates";
import { Section, Text, Button, Hr } from "@react-email/components";

export function OrderShippedEmail(props: {
  customerName: string;
  trackingNumber: string;
  trackingUrl: string;
}) {
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

Then render through the `TemplateRenderer` and pass the result to your email provider.

## Exports

| Subpath       | Exports                    |
| ------------- | -------------------------- |
| `.`           | Top-level re-exports       |
| `./renderer`  | `createReactEmailRenderer` |
| `./templates` | `BaseEmail`                |
| `./otp`       | `OtpEmail`                 |
