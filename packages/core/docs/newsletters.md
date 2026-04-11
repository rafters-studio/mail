# Newsletters and Broadcasts

Sending email to many recipients via mailing lists, subscribers, and campaigns.

---

## Vocabulary

`@rafters/mail` uses generic platform terms in its interface surface:

| Interface name | Vendor synonyms                     | Meaning                           |
| -------------- | ----------------------------------- | --------------------------------- |
| `MailingList`  | Audience (Resend), List (Mailchimp) | A named collection of subscribers |
| `Subscriber`   | Contact, Audience Member            | Someone on a mailing list         |
| `Campaign`     | Broadcast                           | A message sent to a mailing list  |

Vendor terms (`audience`, `broadcast`) appear inside adapter implementations and in the platform-side mirror tables, but they do not leak into the interface surface consumers call.

---

## The EmailProvider surface

All mailing list, subscriber, and campaign operations go through the `EmailProvider` interface. The provider is the authoritative source of truth for list membership and delivery. `@rafters/mail` does not duplicate that data locally unless the consumer opts into platform-side tracking.

```typescript
interface EmailProvider {
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

  // Audiences (read-only list of available mailing lists)
  listAudiences(): Promise<Audience[]>;
}
```

### MailingList, Subscriber, Campaign shapes

```typescript
interface MailingList {
  id: string;
  name: string;
  createdAt: Date;
}

interface Subscriber {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed: boolean;
}

interface CampaignParams {
  listId: string;
  subject: string; // 1..200 chars
  html: string; // min 1 char
  text?: string;
  from: string; // sender email
  replyTo?: string;
  name?: string;
}

interface CampaignStatus {
  id: string;
  status: "draft" | "queued" | "sending" | "sent" | "cancelled";
  subject: string;
  sentAt: Date | null;
}
```

`sendCampaign` publishes a campaign immediately. `createCampaignDraft` + `sendCampaignDraft` is the two-step flow for drafts that might be edited before send. Polling `getCampaignStatus` is how you observe the send through `queued -> sending -> sent`.

---

## Platform-side mirror tables (optional)

The `@rafters/mail` schema ships three newsletter-related tables in `packages/core/src/schema/newsletter.ts`:

| Table                 | Purpose                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_audience`   | Local mirror of a mailing list, keyed by `providerListId`. Stores `name`, `description`, and a URL-safe `slug`. Use when you want to show audiences in your own UI without re-fetching from the provider.                                             |
| `platform_subscriber` | Association between one of your app users (`userId`) and one audience (`audienceId`), plus the `providerSubscriberId` for provider correlation. Use when you need to answer "which of my users is on which list" without round-tripping the provider. |
| `broadcast_audit`     | Audit log of campaign sends: `providerCampaignId`, `subject`, `contentHash`, `sentBy` (user id), `audienceName`, `recipientCount`, `sentAt`. Use for compliance, "who sent what to whom" queries, and content-hash deduplication across sends.        |

**These tables are not in the exported `migrationSQL` string.** They exist as Drizzle schema definitions you can include in your own migrations if you want platform-side tracking. If you only use the `EmailProvider` interface and trust the provider's own audience/subscriber storage, you do not need these tables at all.

---

## Templates

Campaign HTML is usually rendered from a React Email template via the `TemplateRenderer` interface. See the `@rafters/mail-react-email` package for the shipped renderer and baseline templates, and its `docs/templates.md` for writing your own.

Every campaign email should include an unsubscribe link as required by CAN-SPAM and similar regulations. The provider handles the actual unsubscribe flow when a recipient clicks the link; the template is responsible for emitting a valid URL that the provider routes back to the subscriber record.

---

## Delivery and analytics

Delivery events (delivered, bounced, complained, opened, clicked) come from the provider's webhook. `@rafters/mail-resend` ships a webhook handler at `@rafters/mail-resend/webhooks` that validates the signature and invokes user-provided callbacks for each event type. Correlate events back to campaigns via the `providerCampaignId` stored in `broadcast_audit`, or query the provider directly with `getCampaignStatus`.
