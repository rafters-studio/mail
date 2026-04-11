# Inbound Email

How incoming email enters the system.

---

## The inbound adapter

The `InboundAdapter` interface handles incoming email. It receives a raw email, parses it, threads it, stores the content, and optionally classifies it.

```typescript
interface InboundAdapter {
  handleIncoming(email: InboundEmail): Promise<void>;
}
```

The adapter is responsible for:
1. Parsing the raw RFC 5322 email into structured fields
2. Finding or creating a thread (via In-Reply-To/References headers)
3. Storing the raw email and parsed content in blob storage
4. Creating the message record in the database
5. Updating thread metadata (messageCount, lastMessageAt, snippet)

---

## Inbound email structure

When an email arrives, the adapter receives:

| Field | Source |
|---|---|
| from | From header (email + display name) |
| to | To header |
| cc, bcc | CC/BCC headers |
| subject | Subject header |
| messageId | Message-ID header |
| inReplyTo | In-Reply-To header |
| references | References header |
| date | Date header |
| textBody | Plain text content |
| htmlBody | HTML content |
| rawEmail | The complete RFC 5322 message |
| attachments | MIME attachments with metadata |
| headers | All headers as key-value pairs |

---

## Storage

Each message stores content in three locations:

1. **Database record**: structured metadata (from, to, subject, dates, flags, thread assignment). Used for listing, searching, and flag management.
2. **Blob storage (raw)**: the complete RFC 5322 email as received. Immutable. Used by IMAP FETCH BODY[].
3. **Blob storage (parsed)**: extracted HTML and plain text bodies. Used by IMAP FETCH BODY[TEXT] and for snippet generation.

Blob keys follow a date-partitioned pattern: `emails/{year}/{month}/{content-hash}.{extension}`. Content-addressed storage means duplicate emails produce the same key.

---

## DNS configuration

For email to reach your inbound adapter, configure these DNS records on your domain:

### MX record

Points incoming email to your email infrastructure:

```
yourdomain.com  MX  10  your-mail-handler
```

### SPF record

Declares which servers can send email for your domain:

```
yourdomain.com  TXT  "v=spf1 include:your-provider ~all"
```

### DKIM record

Cryptographic signature for outbound email authenticity. Your sending provider generates the key pair and publishes the public key:

```
selector._domainkey.yourdomain.com  TXT  "v=DKIM1; k=rsa; p=..."
```

### DMARC record

Policy for handling emails that fail SPF/DKIM verification:

```
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com"
```

---

## Classification

After storage, the inbound adapter can optionally classify the message using an AI classifier. The classifier assigns:

- **category**: support, feedback, abuse, partnership, spam, billing, legal, other
- **confidence**: 0-100 score
- **summary**: one-line description of the message content

Classification results are stored on the message record. They drive folder assignment, priority, and dashboard filtering.

The classifier is a separate adapter (`ClassificationAdapter`). The default implementation uses zero-shot classification with a language model, but any classification strategy can be plugged in.

---

## IMAP integration

When inbound processing completes and the message is stored, the inbound adapter can signal the IMAP server to notify connected clients:

1. Message stored in database + blob storage
2. Adapter signals the IMAP server (platform-specific: DO fetch, TCP callback, etc.)
3. IMAP server pushes `* N EXISTS` to all IDLE clients on that mailbox
4. Clients fetch the new message

This is how real-time push works: the inbound adapter is the trigger, the IMAP IDLE mechanism is the delivery channel.
