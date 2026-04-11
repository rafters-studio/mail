# Getting Started with @rafters/mail

An edge-native email inbox framework. Inbound, outbound, threading, classification, folders, labels, team collaboration. Runs on Cloudflare Workers, D1, and R2.

---

## Prerequisites

You need:

- A Cloudflare account with Workers, D1, and R2 enabled
- A Resend account with an API key and a verified sending domain
- Node.js 20+ and pnpm
- Wrangler CLI (`pnpm add -g wrangler`)

Your domain's MX records must point to Cloudflare Email Routing for inbound email. Outbound goes through Resend.

---

## 1. Install packages

```bash
pnpm add @rafters/mail @rafters/mail-resend @rafters/mail-cloudflare
```

`@rafters/mail` is the core: schema, types, service interfaces, threading logic. Zero vendor dependencies. The other two are adapters for Resend (outbound) and Cloudflare (inbound + blob storage).

---

## 2. Create your D1 database and R2 bucket

```bash
wrangler d1 create mail-db
wrangler r2 bucket create mail-blobs
```

Add them to your `wrangler.jsonc`:

```jsonc
{
  "name": "mail-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mail-db",
      "database_id": "<your-database-id>",
    },
  ],
  "r2_buckets": [
    {
      "binding": "EMAIL_STORAGE",
      "bucket_name": "mail-blobs",
    },
  ],
  "vars": {
    "RESEND_FROM_EMAIL": "support@yourdomain.com",
    "EMAIL_DOMAIN": "yourdomain.com",
  },
  // Secrets set via `wrangler secret put`:
  // RESEND_API_KEY
}
```

---

## 3. Run the schema migration

Generate a migration file and copy the SQL from `@rafters/mail`:

```bash
wrangler d1 migrations create mail-db init-mail-tables
```

This creates a file at `migrations/0001_init-mail-tables.sql`. Populate it:

```typescript
// scripts/print-migration.ts
import { migrationSQL } from "@rafters/mail/migrations";
console.log(migrationSQL);
```

```bash
pnpm tsx scripts/print-migration.ts > migrations/0001_init-mail-tables.sql
```

Apply the migration:

```bash
wrangler d1 migrations apply mail-db --local   # local dev
wrangler d1 migrations apply mail-db --remote  # production
```

This creates all 10 inbox tables (mailbox, inbox_folder, inbox_label, inbox_thread, inbox_message, inbox_message_label, inbox_thread_label, inbox_attachment, thread_assignment, thread_note) plus the 3 newsletter tables.

---

## 4. Implement the auth adapter

`@rafters/mail` does not ship an auth implementation. You provide one. The adapter resolves user identity and mailbox access at runtime.

```typescript
// src/auth-adapter.ts
import type { AuthAdapter, InboxUser, InboxRole } from "@rafters/mail";

export function createAuthAdapter(db: D1Database): AuthAdapter {
  return {
    async getCurrentUser(): Promise<InboxUser> {
      // Replace with your auth system.
      // Pull from session, JWT, better-auth, whatever you use.
      throw new Error("Implement getCurrentUser from your auth system");
    },

    async getUserById(id: string): Promise<InboxUser | null> {
      const row = await db
        .prepare("SELECT id, email, name FROM user WHERE id = ?")
        .bind(id)
        .first();
      if (!row) return null;
      return { id: row.id as string, email: row.email as string, name: row.name as string };
    },

    async hasMailboxAccess(userId: string, mailboxId: string): Promise<boolean> {
      const row = await db
        .prepare("SELECT 1 FROM mailbox WHERE id = ? AND (owner_id = ? OR type = ?)")
        .bind(mailboxId, userId, "shared")
        .first();
      return row !== null;
    },

    async getUserRole(userId: string, mailboxId: string): Promise<InboxRole | null> {
      // Return 'owner', 'admin', 'agent', or 'viewer'
      // based on your permission model.
      const row = await db
        .prepare("SELECT 1 FROM mailbox WHERE id = ? AND owner_id = ?")
        .bind(mailboxId, userId)
        .first();
      return row ? "owner" : null;
    },
  };
}
```

All user ID columns in the mail schema (`ownerId`, `assigneeId`, `assignedBy`, `authorId`, `appliedBy`) are plain text. No foreign keys to your auth tables. Wire them up however you want.

---

## 5. Receive your first email

### Set up the inbound handler

```typescript
// src/index.ts
import { createInboundHandler } from "@rafters/mail-cloudflare";
import { createR2BlobStorage } from "@rafters/mail-cloudflare/storage";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@rafters/mail/schema";

interface Env {
  DB: D1Database;
  EMAIL_STORAGE: R2Bucket;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  EMAIL_DOMAIN: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB, { schema });
    const blobStorage = createR2BlobStorage(env.EMAIL_STORAGE);

    const handler = createInboundHandler({ db, blobStorage });
    await handler.handleIncoming({
      raw: await new Response(message.raw).arrayBuffer(),
      from: message.from,
      to: message.to,
      headers: Object.fromEntries(message.headers.entries()),
    });
  },
} satisfies ExportedHandler<Env>;
```

The inbound handler:

1. Parses RFC 5322 headers (From, To, CC, Subject, Message-ID, In-Reply-To, References)
2. Stores the raw `.eml` in R2 at `emails/{year}/{month-zero-padded}/{hash}.eml`
3. Stores parsed HTML and plain text as separate blobs
4. Inserts a row into `inbox_message` with blob storage keys
5. Matches or creates a thread using In-Reply-To and References headers
6. Creates system folders on the mailbox if they do not exist

### Configure Cloudflare Email Routing

In the Cloudflare dashboard:

1. Go to your domain > Email > Email Routing
2. Under Routing rules, add a catch-all or specific address rule
3. Set the destination to your Worker

Or via `wrangler.jsonc`:

```jsonc
{
  "email_routing": {
    "enabled": true,
  },
}
```

Deploy:

```bash
wrangler deploy
```

Send a test email to your domain. Check D1:

```bash
wrangler d1 execute mail-db --command "SELECT id, subject, from_email FROM inbox_message LIMIT 5"
```

---

## 6. Send your first reply

Wire up Resend for outbound email, then use `InboxEmailService` to reply to a thread.

### Create the email service

```typescript
// src/mail-service.ts
import { createInboxEmailService } from "@rafters/mail";
import { createResendProvider } from "@rafters/mail-resend";
import { createR2BlobStorage } from "@rafters/mail-cloudflare/storage";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@rafters/mail/schema";

export function createMailService(env: {
  DB: D1Database;
  EMAIL_STORAGE: R2Bucket;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  EMAIL_DOMAIN: string;
}) {
  const db = drizzle(env.DB, { schema });
  const blobStorage = createR2BlobStorage(env.EMAIL_STORAGE);

  const emailProvider = createResendProvider({
    apiKey: env.RESEND_API_KEY,
    fromEmail: env.RESEND_FROM_EMAIL,
  });

  return createInboxEmailService({ db, blobStorage, emailProvider });
}
```

### Add a reply endpoint

```typescript
// src/index.ts (add to the existing worker)
import { createMailService } from "./mail-service";
import { createAuthAdapter } from "./auth-adapter";

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // ... inbound handler from step 5
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/threads/reply" && request.method === "POST") {
      const body = (await request.json()) as {
        threadId: string;
        mailboxId: string;
        senderId: string;
        bodyHtml: string;
        body: string;
      };

      const mailService = createMailService(env);

      const result = await mailService.replyToThread({
        threadId: body.threadId,
        mailboxId: body.mailboxId,
        senderId: body.senderId,
        bodyHtml: body.bodyHtml,
        body: body.body,
      });

      return Response.json({ messageId: result.messageId });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

`replyToThread` does the following:

1. Looks up the thread and its latest message
2. Generates a new Message-ID (`<uuidv7@yourdomain.com>`)
3. Sets In-Reply-To to the latest message's Message-ID
4. Appends to the References chain (RFC 5322 compliant)
5. Sends via Resend
6. Stores the outbound message in D1 and the raw RFC 822 content in R2
7. Moves the thread to the "sent" folder snapshot and updates the thread snippet

Test it:

```bash
curl -X POST https://mail-worker.<your-subdomain>.workers.dev/api/threads/reply \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "<thread-id-from-d1>",
    "mailboxId": "<mailbox-id-from-d1>",
    "senderId": "<your-user-id>",
    "bodyHtml": "<p>Thanks for reaching out. We are looking into this.</p>",
    "body": "Thanks for reaching out. We are looking into this."
  }'
```

---

## 7. What's next

You now have a working inbound + outbound email system on the edge. Here is what each additional package unlocks.

### AI classification

```bash
pnpm add @rafters/mail-workers-ai
```

Zero-shot classification using DeBERTa-v3 on Workers AI. Categorizes messages into 8 categories (support, feedback, abuse, partnership, spam, billing, legal, other), assigns priority, and auto-applies labels. Runs as a Cloudflare Workflow or Queue consumer.

Add the AI binding to `wrangler.jsonc`:

```jsonc
{
  "ai": {
    "binding": "AI",
  },
}
```

### Email templates

```bash
pnpm add @rafters/mail-react-email
```

React Email templates with a renderer interface. Ship a `BaseEmail` wrapper with configurable branding (logo, links, copyright) and compose templates like OTP verification, welcome emails, and notifications. No hardcoded branding.

### Team collaboration

Already in core. Shared mailboxes support:

- **Thread assignment**: assign threads to team members via `AssignmentService`
- **Internal notes**: add markdown notes to threads via `NoteService` (not visible to external parties)
- **Labels**: system labels, AI-generated labels, and custom labels via `LabelService`
- **Folder management**: system folders (inbox, sent, drafts, spam, trash, archive) plus custom folders via `FolderService`
- **Thread status**: open, pending, resolved, closed via `ThreadService`

### OTP with better-auth

```bash
pnpm add @rafters/better-auth-resend
```

Glue package that wires Resend + React Email templates into better-auth's `emailOTP` plugin:

```typescript
import { resendOTP } from "@rafters/better-auth-resend";

emailOTP({
  sendVerificationOTP: resendOTP(env),
});
```

---

## Package map

| Package                       | What it does                             | Depends on                                          |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `@rafters/mail`               | Schema, types, interfaces, threading     | nothing                                             |
| `@rafters/mail-resend`        | Outbound via Resend (raw fetch)          | `@rafters/mail`                                     |
| `@rafters/mail-cloudflare`    | Inbound via CF Email Routing, R2 storage | `@rafters/mail`                                     |
| `@rafters/mail-react-email`   | Template rendering                       | `@rafters/mail`                                     |
| `@rafters/mail-workers-ai`    | AI classification (DeBERTa-v3)           | `@rafters/mail`                                     |
| `@rafters/better-auth-resend` | OTP glue for better-auth                 | `@rafters/mail-resend`, `@rafters/mail-react-email` |

Core has zero vendor dependencies. Every adapter is swappable.
