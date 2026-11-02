# React Email Templates

`@rafters/mail-react-email` ships a small library of React Email templates and `renderTemplate(component, props)`, which renders a component as `{ html, text }` for mail's writer to write as given.

## BaseEmail

The shared layout for every rafters template. Use it directly or wrap it in a named template.

```typescript
import { BaseEmail } from "@rafters/mail-react-email";

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

Prebuilt one-time password email.

```typescript
import { OtpEmail } from "@rafters/mail-react-email";

const component = OtpEmail({
  code: "123456",
  brandName: "Example",
  expiryMinutes: 10,
});
```

Props:

| Prop            | Required | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `code`          | yes      | The one-time password to display             |
| `expiryMinutes` | no       | Shown in the expiry note. Defaults to `10`.  |
| `brandName`     | no       | Shown in the header and footer               |
| `logoUrl`       | no       | Header logo image URL                        |
| `websiteUrl`    | no       | Link target for the logo and brand name      |
| `year`          | no       | Copyright year. Defaults to the current one. |

## renderTemplate

`renderTemplate(component, props)` renders the component twice, as HTML and as plain text, and returns `{ html, text }`. React's server-rendering comments (`<!--$-->`, `<!-- -->` and the like) are removed from the HTML. Mail writes the two as given; content with an empty text is refused with `no-text`, field `text`.

```typescript
import { OtpEmail, renderTemplate } from "@rafters/mail-react-email";

const content = await renderTemplate(OtpEmail, { code: "843291", year: 2026 });
```

Pass `year` for a template that renders the same bytes on any day.

## Writing your own template

Wrap `BaseEmail` and add React Email components inside, then render it with `renderTemplate`:

```tsx
// templates/order-shipped.tsx
import { BaseEmail } from "@rafters/mail-react-email";
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
import { renderTemplate } from "@rafters/mail-react-email";
import { OrderShippedEmail } from "./templates/order-shipped.tsx";

const content = await renderTemplate(OrderShippedEmail, {
  customerName: "Sean",
  trackingNumber: "1Z999",
  trackingUrl: "https://example.com/track/1Z999",
});
```

Hand `content` to mail as the message's content.

## Exports

| Subpath | Exports                                                                      |
| ------- | ---------------------------------------------------------------------------- |
| `.`     | `renderTemplate`, `BaseEmail`, `BaseEmailProps`, `OtpEmail`, `OtpEmailProps` |
