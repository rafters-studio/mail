# Getting started with @rafters/mail

`@rafters/mail` 0.2.0 writes email messages as bytes. It does not send them: you hand `written.bytes` to whatever transport you use. Sending, receiving, parsing, storage and IMAP are not built; see [Not built](#not-built).

## Install

```bash
pnpm add @rafters/mail
```

`@rafters/mail` depends only on `zod`. Import from its subpaths: `@rafters/mail/message`, `@rafters/mail/document`, `@rafters/mail/address` and `@rafters/mail/message-id`. There is no root export.

## 1. Bind a writer

```typescript
import { createMail } from "@rafters/mail/message";

const mail = createMail({ domain: "example.com" });
```

`domain` is where every Message-ID is. `createMail` also takes `random` (entropy, default `crypto.getRandomValues`) and `now` (the clock, default the system's). Fix both in tests and every message is the same bytes on every run:

```typescript
let count = 0;
const testMail = createMail({
  domain: "example.com",
  random: (into) => {
    for (let i = 0; i < into.length; i++) into[i] = count++ % 256;
    return into;
  },
  now: () => new Date("2026-03-02T17:00:00Z"),
});
```

## 2. Compose a message

```typescript
const sean = { name: "Sean", addr: { local: "sean", domain: "example.com" } };
const mary = { name: "Mary Smith", addr: { local: "mary", domain: "example.net" } };

const written = mail.compose({ from: sean, to: [mary], subject: "Hello" })({
  doc: [
    { p: ["Hello, Mary."] },
    { p: ["The notes are ", { a: "here", href: "https://example.com/notes" }, "."] },
  ],
});

written.bytes; // Uint8Array: the message, 7-bit with CRLF line endings
written.messageId; // the Message-ID it was written with, without angle brackets
```

The head also takes `replyTo`, `cc`, `bcc` (never written into the bytes), `offset` (the author's UTC offset in minutes), `lang`, `dir` and `attachments` (`{ filename, type, content: Uint8Array }`).

The document is a closed vocabulary: blocks `p`, `ul`, `quote` and `forward`; inlines are text, `{ a, href }`, `{ em }`, `{ strong }` and `{ br: true }`. The writer renders it as both a text part and an HTML part.

## 3. Use a template instead

Content can also be HTML and text you made yourself. `@rafters/mail-react-email` renders a React Email component that way:

```bash
pnpm add @rafters/mail-react-email
```

```typescript
import { OtpEmail, renderTemplate } from "@rafters/mail-react-email";

const content = await renderTemplate(OtpEmail, { code: "123456", brandName: "Example" });
const otp = mail.compose({ from: sean, to: [mary], subject: "Your code" })(content);
```

## 4. Reply and forward

`replyTo` and `forward` are bound to the message being answered, given as a `parentSchema` value: its `from`, its other address fields, its `messageId`, `inReplyTo` and `references`, its `subject` and `dateText`, its words as a `doc`, and optionally its attachments and `raw` bytes.

```typescript
const parent = {
  messageId: "1234@local.machine.example",
  from: [{ name: "Mary Smith", addr: { local: "mary", domain: "example.net" } }],
  subject: "Saying Hello",
  doc: [{ p: ["This is a message just to say hello."] }],
};

const reply = mail.replyTo(parent)({ from: sean, doc: [{ p: ["Hello back."] }] });
const fwd = mail.forward(parent)({ from: sean, to: [mary], doc: [{ p: ["See below."] }] });
```

A reply writes `In-Reply-To` and `References` from the parent and quotes it; `all: true` replies to everyone. A forward shows the original under a separator; `attach: true` also attaches the parent's `raw` bytes as `message/rfc822`, refused with `not-7bit` unless they are 7bit.

Nothing in this repo turns a received message into a `parentSchema` value; reading mail is not built.

## 5. Handle refusals

```typescript
import { MailWriteError } from "@rafters/mail/message";

try {
  mail.compose({ from: sean, to: [mary] })({ doc: [{ p: ["    "] }] });
} catch (error) {
  if (error instanceof MailWriteError) {
    error.code; // "no-text"
    error.field; // "doc"
  }
}
```

The codes are `invalid`, `address`, `unsafe-link`, `no-text`, `not-7bit`, `word-too-long` and `too-large`; [architecture.md](architecture.md#errors) says what each means. The writer checks everything before writing, so a refused message is never half written.

## Not built

These are not in this repo: sending (no provider adapter), receiving (no inbound adapter), parsing received mail, storage (no database schema, migrations or blob storage), inbox threading, classification, and an IMAP server. Version 0.1.0 had packages claiming each; they were removed and remain in git history at the `v0.1.0` tag.
