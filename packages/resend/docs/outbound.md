# Outbound Email

How the system sends email.

---

## The email provider

Outbound email is sent through an `EmailProvider` adapter. The provider handles the HTTP API call to your email sending service.

```typescript
interface EmailProvider {
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
}
```

Parameters:

| Field | Required | Purpose |
|---|---|---|
| from | yes | Sender email address |
| to | yes | Recipient email address(es) |
| subject | yes | Email subject |
| html | no | HTML body |
| text | no | Plain text body |
| cc | no | CC recipients |
| bcc | no | BCC recipients |
| replyTo | no | Reply-To address |
| headers | no | Custom headers |

At least one of `html` or `text` must be provided.

---

## Composing and replying

### New message

```typescript
await mailService.compose({
  mailboxId: "mbx_01J...",
  senderId: "user_01J...",
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "Plain text content",
  bodyHtml: "<p>HTML content</p>",
});
```

The compose flow:
1. Generates a Message-ID using UUIDv7
2. Creates a new thread (or finds existing by subject)
3. Sends via the EmailProvider
4. Stores the sent message in the database with `isOutbound: true`
5. Stores content in blob storage

### Reply

```typescript
await mailService.replyToThread({
  threadId: "thread_01J...",
  mailboxId: "mbx_01J...",
  senderId: "user_01J...",
  body: "Reply text",
  bodyHtml: "<p>Reply HTML</p>",
});
```

The reply flow:
1. Loads the thread and its most recent message
2. Builds the References header from the thread's message chain
3. Sets In-Reply-To to the most recent message's Message-ID
4. Generates a new Message-ID
5. Sends via the EmailProvider
6. Stores the reply in the same thread with `isOutbound: true`
7. Updates thread metadata (messageCount, lastMessageAt, snippet)

---

## Templates

Email content can be rendered from templates using a template adapter. The default implementation uses React Email components:

```typescript
interface TemplateRenderer {
  render(component: unknown, props: Record<string, unknown>): Promise<{ html: string; text: string }>;
}
```

Templates are React components that produce both HTML and plain text output. The renderer is framework-agnostic -- any system that produces HTML and text from a component can implement the interface.

---

## Webhooks

Sending services provide webhook notifications for delivery events:

| Event | Meaning |
|---|---|
| delivered | Email accepted by recipient's server |
| bounced | Permanent delivery failure |
| complained | Recipient marked as spam |
| opened | Recipient opened the email (tracking pixel) |
| clicked | Recipient clicked a link (link tracking) |

The webhook handler validates the signature, matches the event to a message by provider ID, and updates delivery status in the database.

---

## Delivery status

Each outbound message tracks its delivery lifecycle:

```
sent -> delivered
sent -> bounced
sent -> delivered -> complained
```

Delivery status is stored on the message record. The IMAP server exposes this as message metadata -- clients can see whether a sent message was delivered or bounced.

---

## Multiple sending domains

The EmailProvider is configured per mailbox or per domain. A single deployment can send from multiple domains:

- `support@silvius.me` sends via one provider configuration
- `hello@runlegion.dev` sends via another (or the same with different sender verification)

Each domain needs its own DKIM/SPF records. The sending provider handles domain verification.
