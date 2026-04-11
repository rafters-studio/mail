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
import { createR2Storage } from "@rafters/mail-cloudflare/storage";
import { parseEmailHeaders, hashContent } from "@rafters/mail-cloudflare/parsing";

export default {
  // Handle inbound email from Cloudflare Email Routing
  async email(message: ForwardableEmailMessage, env: Env) {
    // Read the raw message bytes from the ReadableStream
    const raw = await new Response(message.raw).arrayBuffer();

    // Parse RFC 5322 headers and hash the content for dedupe
    const headers = parseEmailHeaders(Object.fromEntries(message.headers.entries()));
    const contentHash = await hashContent(raw);

    // Store the raw email in R2 via the BlobStorage adapter
    const storage = createR2Storage({ bucket: env.BLOB_STORAGE });
    const blobKey = storage.generateKey(contentHash, "eml");
    await storage.put(blobKey, raw);

    // Insert message row in D1, update thread, dispatch to classifier queue
    // (wire up your service layer here)
  },

  // Handle HTTP requests (webhooks, API)
  async fetch(request: Request, env: Env) {
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
  to: "recipient@example.com", // single recipient per sendEmail call
  subject: "Hello from the edge",
  text: "Sent via @rafters/mail on Cloudflare Workers.",
});
```

---

## 10. Add IMAP (optional)

To access your mailbox from Apple Mail, Thunderbird, or Outlook, add the IMAP server. See the docs shipped with the IMAP runtime packages:

- [`@rafters/mail-imap-server`](https://www.npmjs.com/package/@rafters/mail-imap-server) -- Node TCP for Fly.io / Railway / Fargate / VPS
- [`@rafters/mail-imap-cloudflare`](https://www.npmjs.com/package/@rafters/mail-imap-cloudflare) -- Durable Object + WebSocket for serverless

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

Per-package docs ship with each npm package:

- **Classification** -- see [`@rafters/mail-workers-ai`](https://www.npmjs.com/package/@rafters/mail-workers-ai) docs for auto-categorization
- **IMAP connect** -- see [`@rafters/mail-imap-server`](https://www.npmjs.com/package/@rafters/mail-imap-server) quickstart + deployment
- **IMAP auth** -- see [`@rafters/mail-imap`](https://www.npmjs.com/package/@rafters/mail-imap) `authentication.md` for the `AuthAdapter` contract
- **Newsletters** -- see [`@rafters/mail`](https://www.npmjs.com/package/@rafters/mail) `newsletters.md` for mailing lists, subscribers, campaigns
- **Inbound detail** -- see [`inbound.md`](./inbound.md) in this package
