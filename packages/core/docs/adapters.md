# @rafters/mail Adapters Guide

Adapters connect the @rafters/mail core to external services. The core has zero vendor dependencies. Every external concern lives in an adapter package that implements an interface defined in core.

Five adapter packages ship today:

| Package                       | Direction         | Interface                             |
| ----------------------------- | ----------------- | ------------------------------------- |
| `@rafters/mail-resend`        | Outbound          | `EmailProvider`                       |
| `@rafters/mail-cloudflare`    | Inbound + Storage | `InboundAdapter`, `BlobStorage`       |
| `@rafters/mail-react-email`   | Templates         | `TemplateRenderer`                    |
| `@rafters/mail-workers-ai`    | Classification    | `EmailClassifier`                     |
| `@rafters/better-auth-resend` | Auth glue         | N/A (wires adapters into better-auth) |

---

## @rafters/mail-resend

Outbound email adapter. Wraps the Resend API via raw `fetch`. No Resend SDK dependency.

### Install

```bash
pnpm add @rafters/mail-resend
```

### What it contains

**ResendService** is the low-level API wrapper. Every request and response is validated with Zod. It handles authentication, error parsing, and rate limit detection.

**ResendProvider** implements the `EmailProvider` interface from `@rafters/mail`. It translates platform vocabulary to Resend vocabulary at the boundary. Internal code never uses Resend terms.

**MockEmailProvider** is an in-memory mock for testing. Stores all sent emails, created lists, and subscribers in arrays you can inspect.

### Vocabulary mapping

The platform uses its own terms. The adapter translates at the boundary.

| @rafters/mail | Resend API |
| ------------- | ---------- |
| MailingList   | Audience   |
| Subscriber    | Contact    |
| Campaign      | Broadcast  |

Your application code uses MailingList, Subscriber, and Campaign. Resend terms only appear inside the adapter.

### Config

```typescript
interface ResendConfig {
  apiKey: string;
  fromEmail: string;
  baseUrl?: string; // Defaults to https://api.resend.com
}
```

### EmailProvider interface

The full contract that `ResendProvider` implements:

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

### Usage

#### Sending a transactional email

```typescript
import { ResendService, ResendProvider } from "@rafters/mail-resend";

const resend = new ResendService({
  apiKey: env.RESEND_API_KEY,
  fromEmail: "hello@yourdomain.com",
});

const provider = new ResendProvider(resend);

const { id } = await provider.sendEmail({
  to: "user@example.com",
  subject: "Your order shipped",
  html: "<p>Tracking number: ABC123</p>",
});
```

#### Managing mailing lists and subscribers

```typescript
const list = await provider.createMailingList("Product Updates");

await provider.addSubscriber(list.id, "reader@example.com", {
  firstName: "Jo",
  lastName: "Smith",
});

const subscribers = await provider.listSubscribers(list.id);
```

#### Campaigns: one-shot and draft flow

```typescript
// One-shot: send immediately
await provider.sendCampaign({
  audienceId: list.id,
  from: "news@yourdomain.com",
  subject: "March update",
  html: "<p>Here is what happened this month.</p>",
});

// Two-step: create draft, review, then send
const draft = await provider.createCampaignDraft({
  audienceId: list.id,
  from: "news@yourdomain.com",
  subject: "April update",
  html: "<p>Draft content here.</p>",
});

// Later, after review:
await provider.sendCampaignDraft(draft.id);

// Check delivery status
const status = await provider.getCampaignStatus(draft.id);
```

### Error handling

`ResendService` throws `ResendError` on API failures:

```typescript
import { ResendError } from "@rafters/mail-resend";

try {
  await provider.sendEmail({ to: "bad", subject: "Test", html: "<p>hi</p>" });
} catch (err) {
  if (err instanceof ResendError) {
    console.log(err.statusCode); // 422
    console.log(err.resendMessage); // "Invalid email address"
  }
}
```

Rate limits return HTTP 429 with a `Retry-After` header. `ResendService` parses this and includes it on the error:

```typescript
try {
  await provider.sendEmail(params);
} catch (err) {
  if (err instanceof ResendError && err.statusCode === 429) {
    const retryAfter = err.retryAfter; // seconds to wait
    // back off and retry
  }
}
```

All request payloads are validated with Zod before the fetch call. All responses are validated with Zod after parsing. If Resend changes their API shape, you get a clear Zod error instead of a silent data corruption.

### Testing with MockEmailProvider

```typescript
import { MockEmailProvider } from "@rafters/mail-resend";

const mock = new MockEmailProvider();

await mock.sendEmail({
  to: "test@example.com",
  subject: "Hello",
  html: "<p>Test</p>",
});

// Inspect what was sent
console.log(mock.sentEmails);
// [{ to: 'test@example.com', subject: 'Hello', html: '<p>Test</p>' }]

const list = await mock.createMailingList("Beta Testers");
await mock.addSubscriber(list.id, "tester@example.com");

console.log(mock.subscribers);
// [{ listId: '...', email: 'tester@example.com' }]
```

`MockEmailProvider` implements the same `EmailProvider` interface. Swap it in during tests with no code changes to your service layer.

### Gotchas

- The adapter uses raw `fetch`, not the Resend SDK. If you also install `resend` as a dependency, they will not share state or configuration. Pick one.
- `fromEmail` must be a verified domain in your Resend account. Sending from an unverified domain returns a 403.
- Resend rate limits are per-API-key, not per-request. If you run multiple workers sharing a key, coordinate your retry logic.
- Zod validation on responses means a Resend API change can break your build before it breaks your data. This is intentional.

---

## @rafters/mail-cloudflare

Inbound email and blob storage for Cloudflare. Receives email via Email Routing, parses RFC 5322 headers, stores raw content in R2, stores metadata in D1, and dispatches to a classification queue.

### Install

```bash
pnpm add @rafters/mail-cloudflare
```

### What it contains

**Email Routing worker handler.** Receives `EmailMessage` from Cloudflare Email Routing. Parses headers. Stores the raw `.eml` in R2. Stores parsed HTML and plain text in R2. Inserts a metadata row into `inbox_message` in D1. Matches or creates a thread. Dispatches to a classification queue.

**R2 storage adapter.** Implements the `BlobStorage` interface from `@rafters/mail`. Handles put, get, and key generation for email content.

### Inbound flow

1. Cloudflare Email Routing delivers `EmailMessage` to the worker
2. Worker parses RFC 5322 headers: From, To, CC, Subject, Message-ID, In-Reply-To, References, Date
3. Raw `.eml` stored in R2
4. Parsed HTML and plain text stored separately in R2
5. Metadata row inserted into `inbox_message` in D1 with R2 keys
6. Thread matching: look up existing thread by In-Reply-To header, then References. Create new thread if no match.
7. Message dispatched to classification queue

### R2 key format

```
emails/{year}/{month}/{sha256-first-16-chars}.{eml|html|txt}    (month is zero-padded)
```

Example: `emails/2026/04/a1b2c3d4e5f67890.eml`

The SHA-256 hash is computed from the raw email content. First 16 hex characters provide collision resistance with readable keys. Three files per email: `.eml` (raw), `.html` (parsed HTML body), `.txt` (parsed plain text body).

### BlobStorage interface

```typescript
interface BlobStorage {
  putRaw(
    key: string,
    content: string | ArrayBuffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  putText(key: string, content: string): Promise<void>;
  putHtml(key: string, content: string): Promise<void>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<BlobObject | null>;
  generateKey(contentHash: string, extension: "eml" | "html" | "txt"): string;
}
```

### Usage

#### Wrangler configuration

```jsonc
// wrangler.jsonc
{
  "name": "mail-worker",
  "main": "src/worker.ts",
  "compatibility_date": "2026-03-01",
  "email_routing": {
    "enabled": true,
  },
  "r2_buckets": [{ "binding": "EMAIL_BUCKET", "bucket_name": "mail-storage" }],
  "d1_databases": [{ "binding": "DB", "database_name": "mail-db", "database_id": "..." }],
  "queues": {
    "producers": [{ "queue": "email-classify", "binding": "CLASSIFY_QUEUE" }],
  },
}
```

#### Worker entry point

```typescript
import { handleInboundEmail } from "@rafters/mail-cloudflare";
import { R2BlobStorage } from "@rafters/mail-cloudflare/storage";

interface Env {
  DB: D1Database;
  EMAIL_BUCKET: R2Bucket;
  CLASSIFY_QUEUE: Queue;
}

export default {
  async email(message: EmailMessage, env: Env) {
    const storage = new R2BlobStorage(env.EMAIL_BUCKET);

    const { messageId, threadId } = await handleInboundEmail({
      message,
      db: env.DB,
      storage,
      classifyQueue: env.CLASSIFY_QUEUE,
    });

    console.log(`Stored message ${messageId} in thread ${threadId}`);
  },
};
```

#### Using BlobStorage directly

```typescript
import { R2BlobStorage } from "@rafters/mail-cloudflare/storage";

const storage = new R2BlobStorage(env.EMAIL_BUCKET);

// Generate a key from content hash
const key = storage.generateKey("a1b2c3d4e5f67890", "eml");
// -> "emails/2026/04/a1b2c3d4e5f67890.eml"

// Store raw email
await storage.putRaw(key, rawEmailBuffer, {
  "content-type": "message/rfc822",
});

// Retrieve later
const blob = await storage.get(key);
if (blob) {
  const text = await blob.text();
}
```

### Thread matching

Inbound emails are threaded using RFC 5322 headers:

1. Check `In-Reply-To` header against existing `inbox_message.messageId` in D1
2. If no match, check each Message-ID in the `References` header
3. If still no match, create a new thread

The thread's `subject` comes from the first message. The thread's `snippet` updates to the latest message (first 200 characters of plain text body). The `participants` JSON array accumulates all email addresses across the thread.

### Testing

No built-in mock for the inbound handler. For integration tests, use Miniflare (Cloudflare's local simulator) which provides local D1, R2, and Queue bindings.

For unit testing the `BlobStorage` interface, create an in-memory implementation:

```typescript
class InMemoryBlobStorage implements BlobStorage {
  private store = new Map<
    string,
    { content: string | ArrayBuffer; metadata?: Record<string, string> }
  >();

  async putRaw(key: string, content: string | ArrayBuffer, metadata?: Record<string, string>) {
    this.store.set(key, { content, metadata });
  }

  async putText(key: string, content: string) {
    this.store.set(key, { content, metadata: { "content-type": "text/plain" } });
  }

  async putHtml(key: string, content: string) {
    this.store.set(key, { content, metadata: { "content-type": "text/html" } });
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      text: async () =>
        typeof entry.content === "string" ? entry.content : new TextDecoder().decode(entry.content),
      arrayBuffer: async () =>
        typeof entry.content === "string"
          ? new TextEncoder().encode(entry.content).buffer
          : entry.content,
      customMetadata: entry.metadata,
    };
  }

  generateKey(contentHash: string, extension: "eml" | "html" | "txt") {
    const now = new Date();
    return `emails/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${contentHash}.${extension}`;
  }
}
```

### Gotchas

- Cloudflare Email Routing must be enabled on your domain. This is a DNS configuration, not just a wrangler setting.
- The worker receives the raw email as a stream. The handler reads it fully into memory for hashing and storage. Very large emails (25MB+ attachments) will consume worker memory. Cloudflare Workers have a 128MB limit.
- R2 keys include year/month for lifecycle management. You can set R2 lifecycle rules to auto-delete old emails.
- The classification queue dispatch is fire-and-forget from the inbound handler's perspective. If the queue is full or down, the email is still stored. Classification happens asynchronously.
- Thread matching is by Message-ID headers only. Subject-line matching (re-attaching "Re: same subject" emails without proper headers) is not implemented. This is intentional: subject matching produces false positives.

---

## @rafters/mail-react-email

Email templates built with React Email. All branding is configurable via props. No hardcoded values.

### Install

```bash
pnpm add @rafters/mail-react-email
```

### What it contains

**BaseEmail** component: provides the standard email layout with configurable header (logo), content area, and footer (links, copyright, optional unsubscribe).

**OtpEmail** component: verification code display with configurable expiry text.

**TemplateRenderer** interface implementation: renders React Email components to HTML and plain text.

### BaseEmailProps

```typescript
interface BaseEmailProps {
  preview: string; // Preview text shown in inbox list
  children: ReactNode; // Email body content
  includeUnsubscribe?: boolean; // Show unsubscribe link in footer
  logoUrl?: string; // Header logo image URL
  websiteUrl?: string; // Link target for logo and brand name
  brandName?: string; // Shown in footer copyright
  copyrightHolder?: string; // Legal entity for copyright line
}
```

Every prop that touches branding is configurable. No defaults reference any specific product or domain.

### TemplateRenderer interface

```typescript
interface TemplateRenderer {
  render(
    template: string,
    props: Record<string, unknown>,
  ): Promise<{ html: string; text?: string }>;
}
```

### Usage

#### BaseEmail component

```tsx
import { BaseEmail } from "@rafters/mail-react-email";
import { Text, Link } from "@react-email/components";

function WelcomeEmail({ name }: { name: string }) {
  return (
    <BaseEmail
      preview={`Welcome to the team, ${name}`}
      logoUrl="https://yourdomain.com/logo.png"
      websiteUrl="https://yourdomain.com"
      brandName="YourApp"
      copyrightHolder="Your Company Inc."
    >
      <Text>Hi {name},</Text>
      <Text>Your account is ready.</Text>
      <Link href="https://yourdomain.com/dashboard">Open dashboard</Link>
    </BaseEmail>
  );
}
```

#### OtpEmail component

```tsx
import { OtpEmail } from "@rafters/mail-react-email";

function VerificationEmail({ code }: { code: string }) {
  return (
    <OtpEmail
      code={code}
      expiryMinutes={10}
      preview="Your verification code"
      logoUrl="https://yourdomain.com/logo.png"
      websiteUrl="https://yourdomain.com"
      brandName="YourApp"
      copyrightHolder="Your Company Inc."
    />
  );
}
```

#### Rendering to HTML

```typescript
import { render } from "@react-email/render";
import { OtpEmail } from "@rafters/mail-react-email";

const html = await render(OtpEmail({ code: "843291", expiryMinutes: 10 }));
```

#### Unsubscribe link

When `includeUnsubscribe` is true, the footer includes a `{{{RESEND_UNSUBSCRIBE_URL}}}` placeholder. Resend replaces this with a real unsubscribe URL at send time. This only works when sending through Resend. For other providers, supply your own unsubscribe mechanism.

### Testing

React Email components are React components. Test them the same way:

```tsx
import { render } from "@react-email/render";
import { OtpEmail } from "@rafters/mail-react-email";

test("OTP email contains the code", async () => {
  const html = await render(OtpEmail({ code: "123456", expiryMinutes: 5 }));
  expect(html).toContain("123456");
  expect(html).toContain("5 minutes");
});

test("BaseEmail renders brand name in footer", async () => {
  const html = await render(
    BaseEmail({
      preview: "test",
      brandName: "TestCo",
      copyrightHolder: "TestCo LLC",
      children: null,
    }),
  );
  expect(html).toContain("TestCo");
  expect(html).toContain("TestCo LLC");
});
```

### Gotchas

- The `{{{RESEND_UNSUBSCRIBE_URL}}}` placeholder is Resend-specific. If you use a different provider for broadcasts, you need to handle unsubscribe URLs yourself.
- React Email `render()` is async. Do not call it in a synchronous context.
- `logoUrl` must be an absolute URL. Relative paths do not work in email clients.
- Email clients strip most CSS. React Email handles this with inline styles, but if you add custom children with complex CSS, test across clients (Litmus, Email on Acid).

---

## @rafters/mail-workers-ai

AI-powered email classification using Cloudflare Workers AI. Zero-shot classification with configurable categories, priority rules, and auto-tagging.

### Install

```bash
pnpm add @rafters/mail-workers-ai
```

### What it contains

**classifyEmail function.** Sends email content to Workers AI for zero-shot classification. Returns a category, confidence score, tags, and priority.

**ClassifyEmailWorkflow.** A Cloudflare Workflow (durable, step-based) that fetches email content from blob storage, classifies it, updates D1 and R2 metadata, moves spam, and applies labels.

**handleEmailClassifyQueue.** Queue consumer function with ack/retry semantics. Same classification logic as the workflow, driven by Queue messages.

### Model

Uses `@cf/microsoft/deberta-v3-base-zeroshot-v1.1-all-33` for zero-shot text classification. No fine-tuning required. The model receives the email text and a list of candidate labels, then returns confidence scores for each.

### Categories

Eight built-in categories:

| Category      | Description                          |
| ------------- | ------------------------------------ |
| `support`     | Help requests, how-to questions      |
| `feedback`    | Product feedback, suggestions        |
| `abuse`       | Harassment, threats, ToS violations  |
| `partnership` | Business inquiries, collaboration    |
| `spam`        | Unsolicited commercial email         |
| `billing`     | Payment, subscription, refund issues |
| `legal`       | DMCA, copyright, legal notices       |
| `other`       | Does not fit other categories        |

### Priority determination

Priority is computed from category and keyword matching:

```
abuse, legal            -> always high
urgent keywords found   -> urgent
high keywords found     -> high
support, billing        -> normal (default)
feedback, partnership   -> normal (default)
everything else         -> low
```

Default urgent keywords: `urgent`, `emergency`, `asap`, `immediately`, `critical`, `broken`, `down`, `outage`

Default high-priority keywords: `important`, `priority`, `help`, `issue`, `problem`, `error`, `bug`, `crash`

Both lists are configurable.

### Auto-tagging

Regex patterns match against the combined subject + body text. Default patterns:

| Pattern                               | Tag               |
| ------------------------------------- | ----------------- |
| `install\|setup\|download`            | `installation`    |
| `crash\|error\|bug\|broken`           | `bug-report`      |
| `feature\|request\|suggest`           | `feature-request` |
| `account\|login\|password\|auth`      | `account`         |
| `payment\|billing\|subscribe\|refund` | `billing`         |

Add your own patterns via `ClassifierConfig.tagPatterns`. Custom patterns merge with defaults.

### EmailClassifier interface

```typescript
interface EmailClassification {
  category:
    | "support"
    | "feedback"
    | "abuse"
    | "partnership"
    | "spam"
    | "billing"
    | "legal"
    | "other";
  confidence: number; // 0-100
  tags: string[];
  priority: "low" | "normal" | "high" | "urgent";
}

interface EmailClassifier {
  classify(from: string, subject: string, body: string): Promise<EmailClassification>;
}
```

### ClassifierConfig

```typescript
interface ClassifierConfig {
  tagPatterns?: Array<{ pattern: RegExp; tag: string }>;
  urgentKeywords?: string[];
  highPriorityKeywords?: string[];
  classificationLabels?: string[];
  maxInputLength?: number; // Default: 4000 characters
}
```

### Usage

#### Direct classification

```typescript
import { createEmailClassifier } from "@rafters/mail-workers-ai";

interface Env {
  AI: Ai;
}

export default {
  async fetch(request: Request, env: Env) {
    const classifier = createEmailClassifier(env.AI, {
      tagPatterns: [
        { pattern: /refund|chargeback/, tag: "refund-request" },
        { pattern: /api|webhook|integration/, tag: "developer" },
      ],
      urgentKeywords: ["outage", "breach", "critical"],
    });

    const result = await classifier.classify(
      "user@example.com",
      "Urgent: Payment failed",
      "I tried to pay but got an error. This is critical for our launch.",
    );

    // result:
    // {
    //   category: 'billing',
    //   confidence: 87,
    //   tags: ['billing', 'refund-request'],
    //   priority: 'urgent'
    // }

    return Response.json(result);
  },
};
```

#### ClassifyEmailWorkflow (Cloudflare Workflow)

The workflow runs as a durable, multi-step process:

1. Fetch email content from blob storage (first 4KB)
2. Classify with Workers AI
3. Update `inbox_message` in D1 with category, confidence, spam score
4. Update R2 object metadata with classification
5. Move spam to spam folder
6. Apply AI-generated labels (find-or-create in D1)

```typescript
import { ClassifyEmailWorkflow } from "@rafters/mail-workers-ai/workflow";

// In wrangler.jsonc:
// "workflows": [{ "name": "classify-email", "binding": "CLASSIFY_WORKFLOW", "class_name": "ClassifyEmailWorkflow" }]

export { ClassifyEmailWorkflow };

interface Env {
  AI: Ai;
  DB: D1Database;
  EMAIL_BUCKET: R2Bucket;
  CLASSIFY_WORKFLOW: Workflow;
}

// Trigger from inbound handler or API:
export default {
  async fetch(request: Request, env: Env) {
    const instance = await env.CLASSIFY_WORKFLOW.create({
      params: {
        messageId: "msg_abc123",
        blobKey: "emails/2026/04/a1b2c3d4e5f67890.eml",
        mailboxId: "mbx_def456",
      },
    });

    return Response.json({ workflowId: instance.id });
  },
};
```

#### Queue consumer

```typescript
import { handleEmailClassifyQueue } from "@rafters/mail-workers-ai/queue";

interface Env {
  AI: Ai;
  DB: D1Database;
  EMAIL_BUCKET: R2Bucket;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    await handleEmailClassifyQueue(batch, {
      ai: env.AI,
      db: env.DB,
      storage: env.EMAIL_BUCKET,
    });
  },
};
```

### Testing

The classifier function is pure logic around an AI call. For unit tests, mock the AI binding:

```typescript
import { createEmailClassifier } from "@rafters/mail-workers-ai";

const mockAi = {
  async run(model: string, input: unknown) {
    return [
      { label: "support", score: 0.85 },
      { label: "billing", score: 0.1 },
      { label: "spam", score: 0.02 },
    ];
  },
} as unknown as Ai;

const classifier = createEmailClassifier(mockAi);

const result = await classifier.classify(
  "user@example.com",
  "Help with login",
  "I cannot access my account after resetting my password.",
);

expect(result.category).toBe("support");
expect(result.confidence).toBe(85);
expect(result.tags).toContain("account");
expect(result.priority).toBe("high"); // "help" is a high-priority keyword
```

### Gotchas

- The classifier truncates input to `maxInputLength` (default 4000 characters). Long emails lose context from the end. If your emails routinely exceed this, increase the limit, but watch Workers AI latency.
- Zero-shot classification confidence varies. A score of 60 does not mean the same thing as a score of 90. Treat confidence as relative ranking, not absolute probability.
- The `abuse` and `legal` categories always override to high priority regardless of keyword matching. This is a safety default. Do not lower it.
- Spam classification moves the message to the spam folder automatically in the workflow. If the classifier is wrong, the user must manually move it back. Consider a confidence threshold before auto-moving (e.g., only move if confidence > 80).
- Workers AI has per-request latency (50-200ms for this model). Classification is async by design. Do not block the inbound handler on it.
- Custom `classificationLabels` replaces the default 8 categories entirely. If you override, you must provide the full set. There is no merge.

---

## @rafters/mail-react-email (Templates)

Covered above. See the [@rafters/mail-react-email](#raftersmail-react-email) section.

---

## @rafters/better-auth-resend

Glue package that wires `@rafters/mail-resend` and `@rafters/mail-react-email` into better-auth's `emailOTP` plugin. This is the only package with an auth opinion.

### Install

```bash
pnpm add @rafters/better-auth-resend
```

This package depends on `@rafters/mail-resend` and `@rafters/mail-react-email`. Both are peer dependencies and must be installed.

### What it does

Provides a single function, `resendOTP`, that creates a `sendVerificationOTP` handler compatible with better-auth's `emailOTP` plugin. Under the hood it:

1. Creates a `ResendService` instance from your environment
2. Renders the `OtpEmail` template with `@rafters/mail-react-email`
3. Sends the rendered email via the Resend transactional API

### Usage

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { resendOTP } from "@rafters/better-auth-resend";

interface Env {
  RESEND_API_KEY: string;
  FROM_EMAIL: string; // Verified sender address
}

export function createAuth(env: Env) {
  return betterAuth({
    plugins: [
      emailOTP({
        sendVerificationOTP: resendOTP(env),
      }),
    ],
  });
}
```

That is the entire integration. The `resendOTP` function accepts an env object with `RESEND_API_KEY` and `FROM_EMAIL`. It returns an async function with the signature better-auth expects: `(email: string, otp: string) => Promise<void>`.

### Customizing the OTP email

To customize branding on the OTP email, pass options:

```typescript
resendOTP(env, {
  logoUrl: "https://yourdomain.com/logo.png",
  websiteUrl: "https://yourdomain.com",
  brandName: "YourApp",
  copyrightHolder: "Your Company Inc.",
  expiryMinutes: 10,
});
```

These options are forwarded directly to the `OtpEmail` component props.

### Testing

The `resendOTP` function creates a `ResendService` internally. For testing, use `MockEmailProvider` from `@rafters/mail-resend` at the service layer, or mock the `RESEND_API_KEY` env var and intercept fetch calls:

```typescript
import { resendOTP } from "@rafters/better-auth-resend";

const send = resendOTP({
  RESEND_API_KEY: "test_key",
  FROM_EMAIL: "test@example.com",
});

// In a test with fetch mocking (MSW, vi.fn, etc.):
globalThis.fetch = vi
  .fn()
  .mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));

await send("user@example.com", "843291");

expect(fetch).toHaveBeenCalledWith(
  "https://api.resend.com/emails",
  expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({
      Authorization: "Bearer test_key",
    }),
  }),
);
```

### Gotchas

- This package is specifically for better-auth. If you use a different auth library, use `@rafters/mail-resend` and `@rafters/mail-react-email` directly.
- The env object must have `RESEND_API_KEY` and `FROM_EMAIL`. These are read at call time, not at import time. Safe to use with Cloudflare Workers env bindings.
- OTP expiry displayed in the email is cosmetic. The actual expiry is controlled by better-auth's `emailOTP` plugin configuration. Make sure both match.

---

## Adapter architecture

All adapter interfaces are defined as Zod schemas in `@rafters/mail`. Types are inferred from schemas via `z.infer<>`. Adapter packages implement the interfaces.

```
@rafters/mail (core)
  Defines: EmailProvider, BlobStorage, TemplateRenderer, EmailClassifier, InboundAdapter, AuthAdapter
  Depends on: nothing

@rafters/mail-resend
  Implements: EmailProvider
  Depends on: @rafters/mail

@rafters/mail-cloudflare
  Implements: InboundAdapter, BlobStorage
  Depends on: @rafters/mail

@rafters/mail-react-email
  Implements: TemplateRenderer
  Depends on: @rafters/mail

@rafters/mail-workers-ai
  Implements: EmailClassifier
  Depends on: @rafters/mail

@rafters/better-auth-resend
  Implements: nothing (glue)
  Depends on: @rafters/mail-resend, @rafters/mail-react-email
```

### Writing a custom adapter

Implement the interface from core. Example for a hypothetical Postmark outbound adapter:

```typescript
import type { EmailProvider, EmailParams } from "@rafters/mail";

export class PostmarkProvider implements EmailProvider {
  constructor(
    private serverToken: string,
    private fromEmail: string,
  ) {}

  async sendEmail(params: EmailParams): Promise<{ id: string }> {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": this.serverToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: this.fromEmail,
        To: params.to,
        Subject: params.subject,
        HtmlBody: params.html,
        TextBody: params.text,
      }),
    });

    const data = await res.json();
    return { id: data.MessageID };
  }

  // Implement remaining EmailProvider methods...
}
```

The core does not care which provider you use. Swap adapters by changing the import.

### No barrel exports

All adapter packages use subpath exports. Import from the specific entrypoint you need:

```typescript
// Good
import { ResendProvider } from "@rafters/mail-resend";
import { R2BlobStorage } from "@rafters/mail-cloudflare/storage";
import { handleEmailClassifyQueue } from "@rafters/mail-workers-ai/queue";
import { ClassifyEmailWorkflow } from "@rafters/mail-workers-ai/workflow";

// Avoid: pulling the entire package
import * as mailResend from "@rafters/mail-resend";
```

Edge runtimes have bundle size constraints (Cloudflare Workers: 1MB compressed). Subpath exports ensure you only bundle what you use.
