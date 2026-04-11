# @rafters/mail-resend

Resend outbound email adapter for [@rafters/mail](https://github.com/rafters-studio/mail). Implements the `EmailProvider` interface (transactional send + mailing list management), plus a Resend webhook handler that maps delivery events to mail service updates, plus a mock provider for local tests.

Uses Resend's HTTP API directly via `fetch`. No Resend SDK dependency, so the bundle stays edge-safe.

## Install

```bash
pnpm add @rafters/mail-resend @rafters/mail
```

## Usage

### Transactional provider

```typescript
import { createResendProvider } from "@rafters/mail-resend";

const provider = createResendProvider({
  apiKey: env.RESEND_API_KEY,
  defaultFrom: "hello@example.com",
});

await provider.send({
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>Hi there.</p>",
  text: "Hi there.",
});
```

### Mock provider for tests

```typescript
import { createMockEmailProvider } from "@rafters/mail-resend/mock";

const provider = createMockEmailProvider();
await provider.send({ to: "u@test", subject: "hi", html: "<p>hi</p>", text: "hi" });

expect(provider.sentEmails).toHaveLength(1);
```

### Webhook handler

```typescript
import { createResendWebhookHandler } from "@rafters/mail-resend/webhooks";

const handler = createResendWebhookHandler({
  signingSecret: env.RESEND_WEBHOOK_SECRET,
  onDelivered(event) { /* ... */ },
  onBounced(event) { /* ... */ },
  onComplained(event) { /* ... */ },
});

// In your Hono / Worker route:
app.post("/webhooks/resend", async (c) => {
  const result = await handler(c.req.raw);
  return result.ok ? c.text("ok") : c.text(result.error, 400);
});
```

## Exports

| Subpath      | What                                                  |
| ------------ | ----------------------------------------------------- |
| `.`          | `createResendProvider`, `ResendService`               |
| `./mock`     | `createMockEmailProvider`                             |
| `./webhooks` | `createResendWebhookHandler`                          |
| `./types`    | Resend API request and response types                 |

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`outbound.md`](./docs/outbound.md) -- End-to-end outbound flow: compose, Resend send, webhook handling, and audit

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the full @rafters/mail architecture.

## License

MIT
