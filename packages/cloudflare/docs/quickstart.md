# Quickstart: Cloudflare

Set up @rafters/mail on Cloudflare Workers with D1 (database), R2 (blob storage), Email Routing (inbound), and Resend (outbound). From zero to receiving email in your inbox.

---

## Prerequisites

- Cloudflare account with a domain
- Resend account with a verified sending domain
- Node.js 20+ and pnpm

---

## 1. Create the project

```bash
mkdir my-mail && cd my-mail
pnpm init
pnpm add @rafters/mail @rafters/mail-resend @rafters/mail-cloudflare @rafters/mail-workers-ai
pnpm add -D wrangler typescript
```

---

## 2. Configure wrangler

```jsonc
// wrangler.jsonc
{
  "name": "mail",
  "compatibility_date": "2025-04-01",
  "d1_databases": [{ "binding": "DB", "database_name": "mail", "database_id": "your-database-id" }],
  "r2_buckets": [{ "binding": "BLOB_STORAGE", "bucket_name": "mail-blobs" }],
}
```

Create the resources:

```bash
wrangler d1 create mail
wrangler r2 bucket create mail-blobs
```

Copy the database_id from the output into your wrangler.jsonc.

---

## 3. Create the database

Apply the schema migrations:

```bash
wrangler d1 execute mail --file node_modules/@rafters/mail/migrations/0001_initial.sql
```

---

## 4. Set secrets

```bash
wrangler secret put RESEND_API_KEY
# Paste your Resend API key when prompted
```

---

## 5. Write the Worker

```typescript
// src/index.ts
import { createResendProvider } from "@rafters/mail-resend";
import { createR2BlobStorage, parseInboundEmail } from "@rafters/mail-cloudflare";

export default {
  // Handle inbound email from Cloudflare Email Routing
  async email(message, env) {
    const parsed = await parseInboundEmail(message);
    const blobStorage = createR2BlobStorage(env.BLOB_STORAGE);

    // Store raw email in blob storage
    const blobKey = await blobStorage.put(parsed.rawEmail);

    // Store message record in D1
    // (wire up your service layer here)
  },

  // Handle HTTP requests (webhooks, API)
  async fetch(request, env) {
    return new Response("Mail worker running");
  },
};
```

---

## 6. Configure Email Routing

In the Cloudflare dashboard:

1. Go to your domain > Email > Email Routing
2. Enable Email Routing
3. Add a catch-all rule or specific addresses
4. Set the destination to your Worker

This creates the MX records automatically.

---

## 7. Configure DNS for sending

In your domain's DNS settings, add the records from Resend:

```
# SPF
yourdomain.com  TXT  "v=spf1 include:amazonses.com ~all"

# DKIM (Resend provides this)
resend._domainkey.yourdomain.com  TXT  "v=DKIM1; k=rsa; p=..."

# DMARC
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com"
```

Verify the domain in your Resend dashboard.

---

## 8. Deploy

```bash
wrangler types
wrangler deploy
```

---

## 9. Test

Send an email to your domain. Check the Worker logs:

```bash
wrangler tail
```

You should see the inbound email parsed and stored.

Send an outbound email:

```typescript
const provider = createResendProvider({ apiKey: env.RESEND_API_KEY });
await provider.sendEmail({
  from: "you@yourdomain.com",
  to: ["recipient@example.com"],
  subject: "Hello from the edge",
  text: "Sent via @rafters/mail on Cloudflare Workers.",
});
```

---

## 10. Add IMAP (optional)

To access your mailbox from Apple Mail, Thunderbird, or Outlook, add the IMAP server. See the [IMAP Quickstart](./imap-quickstart.md) for Cloudflare DO (WebSocket) or Node TCP (Fly.io) deployment options.

---

## What you have now

- Inbound email via Cloudflare Email Routing
- Outbound email via Resend
- Message storage in D1 (metadata) + R2 (blobs)
- Threading via RFC 5322 headers
- Ready for classification (add @rafters/mail-workers-ai)
- Ready for IMAP client access (add @rafters/mail-imap-cloudflare or @rafters/mail-imap-server)

---

## Next steps

- [Classification](./classification.md) -- auto-categorize incoming email
- [IMAP](./imap-quickstart.md) -- connect email clients
- [Newsletters](./newsletters.md) -- send to subscriber lists
- [App Passwords](./app-passwords.md) -- set up IMAP authentication
- [Deployment Guide](./imap-deployment.md) -- deploy IMAP on Fly, Railway, or Docker
