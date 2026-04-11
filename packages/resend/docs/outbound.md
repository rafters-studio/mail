# Outbound Email

How the system sends email.

---

## The email provider

Outbound email is sent through an `EmailProvider` adapter. The provider handles the HTTP API call to your email sending service. The interface lives in `@rafters/mail/interfaces` and covers transactional sends plus mailing list, subscriber, and campaign management.

```typescript
interface EmailProvider {
  // Transactional
  sendEmail(params: EmailParams): Promise<{ id: string }>;

  // Mailing lists
  createMailingList(name: string): Promise<MailingList>;
  getMailingList(id: string): Promise<MailingList>;
  deleteMailingList(id: string): Promise<void>;

  // Subscribers
  addSubscriber(listId: string, email: string, data?: SubscriberData): Promise<Subscriber>;
  removeSubscriber(listId: string, subscriberId: string): Promise<void>;
  updateSubscriber(subscriberId: string, updates: SubscriberUpdates): Promise<Subscriber>;
  listSubscribers(listId: string): Promise<Subscriber[]>;

  // Campaigns
  sendCampaign(params: CampaignParams): Promise<{ id: string }>;
  getCampaign(id: string): Promise<{ id: string; subject: string; sentAt: Date }>;
  createCampaignDraft(params: CampaignParams): Promise<{ id: string }>;
  sendCampaignDraft(campaignId: string): Promise<{ id: string }>;
  getCampaignStatus(campaignId: string): Promise<CampaignStatus>;

  // Audiences
  listAudiences(): Promise<Audience[]>;
}
```

### EmailParams (transactional sends)

| Field     | Type           | Required | Purpose                                                                 |
| --------- | -------------- | -------- | ----------------------------------------------------------------------- |
| `to`      | string (email) | yes      | Recipient email address (single recipient per send)                     |
| `subject` | string         | yes      | Email subject, minimum 1 character                                      |
| `html`    | string         | no       | HTML body                                                               |
| `text`    | string         | no       | Plain text body                                                         |
| `from`    | string (email) | no       | Sender address. Falls back to the provider's default `from` if omitted. |
| `replyTo` | string (email) | no       | Reply-To address                                                        |

At least one of `html` or `text` should be provided. `sendEmail` returns `{ id }` where `id` is the sending provider's message identifier, used later for webhook correlation.

Multi-recipient sends (CC, BCC, or multiple `to`) are handled outside `sendEmail`. Use the mailing list + campaign APIs for batched sends, or issue multiple `sendEmail` calls for individual delivery to several recipients.

---

## Composing and replying

Compose and reply go through the higher-level `InboxEmailService` (from `@rafters/mail/services`), which wraps the `EmailProvider` with thread management, blob storage, and RFC 5322 header generation.

```typescript
interface InboxEmailService {
  composeEmail(params: ComposeEmailParams): Promise<{ threadId: string; messageId: string }>;
  replyToThread(params: ReplyToThreadParams): Promise<{ messageId: string }>;
}
```

### New message

```typescript
await inboxEmailService.composeEmail({
  mailboxId: "mbx_01J...",
  senderId: "user_01J...",
  to: ["recipient@example.com"], // array, at least one
  subject: "Hello", // max 500 chars
  body: "Plain text content", // required, min 1 char
  bodyHtml: "<p>HTML content</p>", // optional
  cc: ["cc@example.com"], // optional
  bcc: ["bcc@example.com"], // optional
});
```

The compose flow:

1. Generates a `Message-ID` using UUIDv7
2. Creates a new thread for the subject
3. Sends via the `EmailProvider`
4. Stores the sent message row in the database with `isOutbound: true`
5. Stores the raw email and parsed body content in blob storage

### Reply

```typescript
await inboxEmailService.replyToThread({
  threadId: "thread_01J...",
  mailboxId: "mbx_01J...",
  senderId: "user_01J...",
  body: "Reply text",
  bodyHtml: "<p>Reply HTML</p>",
  cc: ["cc@example.com"],
  bcc: ["bcc@example.com"],
});
```

The reply flow:

1. Loads the thread and its most recent message
2. Builds the `References` header from the thread's message chain
3. Sets `In-Reply-To` to the most recent message's `Message-ID`
4. Generates a new `Message-ID`
5. Sends via the `EmailProvider`
6. Stores the reply in the same thread with `isOutbound: true`
7. Updates thread metadata (`unreadCount`, `lastMessageAt`, snippet)

---

## Templates

Email content can be rendered from templates using a template adapter. The default implementation uses React Email components:

```typescript
interface TemplateRenderer {
  render(
    component: unknown,
    props: Record<string, unknown>,
  ): Promise<{ html: string; text: string }>;
}
```

Templates are React components that produce both HTML and plain text output. The renderer is framework-agnostic -- any system that produces HTML and text from a component can implement the interface.

---

## Webhooks

Sending services provide webhook notifications for delivery events:

| Event      | Meaning                                     |
| ---------- | ------------------------------------------- |
| delivered  | Email accepted by recipient's server        |
| bounced    | Permanent delivery failure                  |
| complained | Recipient marked as spam                    |
| opened     | Recipient opened the email (tracking pixel) |
| clicked    | Recipient clicked a link (link tracking)    |

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
