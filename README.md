# @rafters/mail

Writes email messages as exact bytes every client reads: addresses, Message-IDs, documents and MIME.

## What exists

Two published packages:

```
@rafters/mail               0.2.0  The writer: compose, reply and forward, written as RFC 5322 / MIME bytes
@rafters/mail-react-email   0.2.0  React Email templates rendered as { html, text } for the writer
```

`@rafters/mail` depends only on `zod`. It has no root export; import from its subpaths:

| Subpath                    | What                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@rafters/mail/message`    | `createMail`, `headSchema`, `replySchema`, `forwardSchema`, `parentSchema`, `MailWriteError`, `MAIL_WRITE_CODES`, `Written` |
| `@rafters/mail/document`   | `docSchema`, `blockSchema`, `inlineSchema`, `contentSchema`, and the `Doc`, `Block`, `Inline`, `Content` types              |
| `@rafters/mail/address`    | `mailboxSchema`, `groupSchema`, `addressSchema`, `addrSpecSchema`, and their types                                          |
| `@rafters/mail/message-id` | `messageIdSchema`, `MessageId`                                                                                              |

`@rafters/mail-react-email` exports `renderTemplate`, `BaseEmail` and `OtpEmail`.

## What is not built

The writer turns a message into bytes. Nothing in this repo sends those bytes, receives mail, parses mail, stores it, threads an inbox, classifies it, or serves it over IMAP. There is no database schema, no migration SQL and no adapter for any provider.

Version 0.1.0 shipped packages that claimed those jobs (`@rafters/mail-drizzle`, `@rafters/mail-resend`, `@rafters/mail-cloudflare`, `@rafters/mail-workers-ai`, `@rafters/better-auth-resend`, `@rafters/mail-imap`, `@rafters/mail-imap-cloudflare`, `@rafters/mail-imap-server`). None of them could be relied on, and they are removed. They remain in git history at the `v0.1.0` tag. An unpublished `@rafters/mail-mjml`, added after that tag, is removed with them.

## Install

```bash
pnpm add @rafters/mail
pnpm add @rafters/mail-react-email   # optional: React Email templates
```

## Write a message

```typescript
import { createMail } from "@rafters/mail/message";

const mail = createMail({ domain: "example.com" });

const written = mail.compose({
  from: { name: "Sean", addr: { local: "sean", domain: "example.com" } },
  to: [{ addr: { local: "mary", domain: "example.net" } }],
  subject: "Hello",
})({ doc: [{ p: ["Hello, Mary."] }] });

written.bytes; // Uint8Array: the whole message, ready for any transport
written.messageId; // the Message-ID it was written with
```

`mail.replyTo(parent)` and `mail.forward(parent)` take the message being answered or passed on, given as a `parentSchema` value. A reply writes `In-Reply-To` and `References` from the parent and quotes it; a forward shows the original in full under a separator, and attaches it when asked and it is 7bit. A message the writer cannot write throws `MailWriteError` with a `code` and the `field` at fault, before anything is written.

More in [docs/getting-started.md](docs/getting-started.md) and [docs/architecture.md](docs/architecture.md).

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

`packages/test-readers` is a private workspace package the tests use to read written messages back with independent parsers. It is not published.

## License

MIT
