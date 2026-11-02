# @rafters/mail

Writes email messages as exact bytes every client reads: addresses, Message-IDs, documents and MIME. Depends only on `zod`.

Part of [rafters-studio/mail](https://github.com/rafters-studio/mail).

## Install

```bash
pnpm add @rafters/mail
```

## Usage

```typescript
import { createMail } from "@rafters/mail/message";

const mail = createMail({ domain: "example.com" });

const written = mail.compose({
  from: { name: "Sean", addr: { local: "sean", domain: "example.com" } },
  to: [{ addr: { local: "mary", domain: "example.net" } }],
  subject: "Hello",
})({ doc: [{ p: ["Hello, Mary."] }] });

written.bytes; // Uint8Array: the whole message
written.messageId; // the Message-ID it was written with
```

`mail.replyTo(parent)` and `mail.forward(parent)` write replies and forwards bound to a `parentSchema` value. A message the writer cannot write throws `MailWriteError` with a `code` and the `field` at fault.

This package writes messages; it does not send, receive, parse or store them.

## Exports

There is no root export.

| Subpath                    | What                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@rafters/mail/message`    | `createMail`, `headSchema`, `replySchema`, `forwardSchema`, `parentSchema`, `MailWriteError`, `MAIL_WRITE_CODES`, `Written` |
| `@rafters/mail/document`   | `docSchema`, `blockSchema`, `inlineSchema`, `contentSchema`, and the `Doc`, `Block`, `Inline`, `Content` types              |
| `@rafters/mail/address`    | `mailboxSchema`, `groupSchema`, `addressSchema`, `addrSpecSchema`, and their types                                          |
| `@rafters/mail/message-id` | `messageIdSchema`, `MessageId`                                                                                              |

## Documentation

- [Getting started](https://github.com/rafters-studio/mail/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/rafters-studio/mail/blob/main/docs/architecture.md)

## License

MIT
