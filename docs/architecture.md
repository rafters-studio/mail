# Architecture

What `@rafters/mail` 0.2.0 is, how it is put together, and what it does not do.

## Packages

```
packages/core           @rafters/mail               0.2.0  published   The writer
packages/react-email    @rafters/mail-react-email   0.2.0  published   React Email templates as { html, text }
packages/test-readers   @rafters/mail-test-readers  0.0.0  private     Reads written messages back, for the tests
```

```
@rafters/mail  <--  @rafters/mail-react-email
```

`@rafters/mail` depends only on `zod`. `@rafters/mail-react-email` depends on `@rafters/mail` (for the `Content` type), `@react-email/components`, `react` and `react-dom`. Both use `@rafters/mail-test-readers` as a dev dependency only.

## The writer

`@rafters/mail` does one job: it turns a message into the bytes of an RFC 5322 / MIME message.

### createMail

`createMail({ domain, random?, now? })` binds the three things a message needs from outside: the domain every Message-ID is at, a source of entropy, and a clock. `random` defaults to `crypto.getRandomValues` and `now` to the system clock. A domain that is not dot-atom text throws when `createMail` is called.

Everything beneath `createMail` is a pure function of its arguments. A caller that fixes `random` and `now` gets the same bytes every time; the tests do exactly that.

It returns three writers:

| Writer                     | Takes                                                | Writes                                                                     |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `compose(head)(content)`   | a `headSchema` value, then a `Content`               | a new message                                                              |
| `replyTo(parent)(reply)`   | a `parentSchema` value, then a `replySchema` value   | a reply with `In-Reply-To` and `References` from the parent, quoting it    |
| `forward(parent)(forward)` | a `parentSchema` value, then a `forwardSchema` value | the original shown in full under a separator, attached when asked and 7bit |

Each returns `Written`: `{ bytes: Uint8Array, messageId: MessageId }`.

### Content

A message's content is either a document or a template's output:

- `{ doc }`: a `Doc`, a closed vocabulary of blocks (`p`, `ul`, `quote`, `forward`) and inlines (text, `a`, `em`, `strong`, `br`). The writer renders it once as plain text and once as HTML.
- `{ html, text }`: HTML and text a template engine made, such as `@rafters/mail-react-email`'s `renderTemplate`. The writer writes them as given.

### The bytes

The message is 7-bit with CRLF line endings. Header fields are folded within 78 characters. The body is `multipart/alternative` with the text part first and the HTML part last, both UTF-8 quoted-printable. When there are attachments, or an attached original, it is wrapped in `multipart/mixed`; attachments are base64. `Bcc` is never written.

The Message-ID is a UUIDv7 drawn from the bound clock and entropy, at the bound domain. One reading of the clock serves both `Date` and `Message-ID`.

### Errors

Every check runs before the clock or entropy is read, so a message the writer refuses is never half written. A refusal throws `MailWriteError` with a `code` and the `field` at fault:

| Code            | Why                                                   |
| --------------- | ----------------------------------------------------- |
| `invalid`       | the input does not match its schema                   |
| `address`       | an address is not US-ASCII dot-atom text              |
| `unsafe-link`   | a link is not http, https or mailto                   |
| `no-text`       | the message has no text part                          |
| `not-7bit`      | a forwarded original to attach is not 7bit            |
| `word-too-long` | a header field has a word too long for 998 characters |
| `too-large`     | the HTML part is over 90,000 bytes once encoded       |

`MAIL_WRITE_CODES` lists the codes. A parent passed to `replyTo` or `forward` that does not match `parentSchema` throws its `ZodError` when the writer is bound, as a domain does in `createMail`.

### Subpaths

There is no root export. Each subpath is its own entry point:

| Subpath                    | Holds                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `@rafters/mail/message`    | `createMail`, the head, reply, forward and parent schemas, `MailWriteError` |
| `@rafters/mail/document`   | the document and content schemas and types                                  |
| `@rafters/mail/address`    | the mailbox, group, address and addr-spec schemas                           |
| `@rafters/mail/message-id` | `messageIdSchema`                                                           |

## Templates

`@rafters/mail-react-email` renders one React Email component as `{ html, text }` with `renderTemplate(component, props)`, ready to hand to `compose` as content. It ships `BaseEmail`, a shared layout, and `OtpEmail`, a one-time password email.

## Tests

The core tests make `createMail` with a fixed domain, a counter for entropy and a fixed clock, so every written message is the same bytes on every run. `@rafters/mail-test-readers` reads each written message back three independent ways (postal-mime, mailparser and Python's `email` package), so a test judges the bytes by what readers see in them. Core coverage is held at 100%.

## Not built

The writer does not send, receive, parse, store, thread an inbox, classify, or serve mail. There is no database schema, migration SQL, delivery provider adapter, inbound adapter, blob storage adapter, classifier or IMAP server in this repo.

Version 0.1.0 had packages that claimed each of those. They could not be relied on and are removed; they remain in git history at the `v0.1.0` tag.
