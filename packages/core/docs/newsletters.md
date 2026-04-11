# Newsletters and Broadcasts

Sending email to audiences. Mailing lists, subscribers, campaigns.

---

## Vocabulary

@rafters/mail uses specific terms:

| Term         | Not this  | Meaning                          |
| ------------ | --------- | -------------------------------- |
| Mailing list | Audience  | A named list of subscribers      |
| Subscriber   | Contact   | Someone on a mailing list        |
| Campaign     | Broadcast | A message sent to a mailing list |

Vendor terms (audience, contact, broadcast) appear only inside adapter implementations.

---

## Mailing lists

A mailing list is a collection of subscribers who opted in to receive email.

| Field       | Purpose                            |
| ----------- | ---------------------------------- |
| name        | Display name ("Weekly Newsletter") |
| description | What subscribers signed up for     |
| mailboxId   | Which mailbox sends campaigns      |

Lists are per-mailbox. The support mailbox and the marketing mailbox have separate lists.

---

## Subscribers

| Field          | Purpose                                       |
| -------------- | --------------------------------------------- |
| email          | Subscriber email address                      |
| name           | Display name (optional)                       |
| status         | subscribed, unsubscribed, bounced, complained |
| subscribedAt   | When they opted in                            |
| unsubscribedAt | When they opted out                           |
| metadata       | Custom fields (JSON)                          |

### Status lifecycle

```
subscribed -> unsubscribed (user opts out)
subscribed -> bounced (delivery failure)
subscribed -> complained (marked as spam)
```

Once a subscriber is `unsubscribed`, `bounced`, or `complained`, they do not receive future campaigns. Re-subscription requires explicit opt-in.

---

## Campaigns

A campaign is a message sent to all active subscribers on a mailing list.

| Field         | Purpose                                          |
| ------------- | ------------------------------------------------ |
| mailingListId | Target list                                      |
| subject       | Email subject                                    |
| htmlBody      | HTML content (rendered from template)            |
| textBody      | Plain text fallback                              |
| status        | draft, scheduled, sending, sent, failed          |
| scheduledAt   | When to send (optional, for scheduled campaigns) |
| sentAt        | When sending completed                           |

### Campaign lifecycle

```
draft -> scheduled -> sending -> sent
draft -> sending -> sent
draft -> sending -> failed
```

### Sending

Campaigns are sent individually to each subscriber (not BCC). Each send is a separate API call to the email provider. This allows per-recipient tracking (delivery, opens, clicks) and personalization.

Rate limiting is handled by the email provider adapter. The campaign runner respects the provider's concurrency limits.

---

## Templates

Campaign content is typically rendered from a template:

```typescript
const html = await renderer.render(NewsletterEmail, {
  title: "Weekly Update",
  content: markdownContent,
  unsubscribeUrl: `https://yourdomain.com/unsubscribe?id=${subscriber.id}`,
});
```

Every campaign email must include an unsubscribe link. The template adapter handles this requirement.

---

## Analytics

Campaign analytics are derived from webhook events:

| Metric       | Source                                      |
| ------------ | ------------------------------------------- |
| Sent         | Total send attempts                         |
| Delivered    | Delivery confirmations from provider        |
| Bounced      | Permanent delivery failures                 |
| Opened       | Open tracking events (if tracking enabled)  |
| Clicked      | Click tracking events (if tracking enabled) |
| Unsubscribed | Unsubscribe actions from this campaign      |
| Complained   | Spam complaints from this campaign          |

Analytics are per-campaign. Aggregate metrics (subscriber growth, engagement rates) are computed from campaign history.
