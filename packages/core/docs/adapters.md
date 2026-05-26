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
import { createResendProvider } from "@rafters/mail-resend";

const provider = createResendProvider({
  apiKey: env.RESEND_API_KEY,
  fromEmail: "hello@yourdomain.com",
});

const { id } = await provider.sendEmail({
  to: "user@example.com",
  subject: "Your order shipped",
  html: "<p>Tracking number: ABC123</p>",
});
```

`createResendProvider` is the factory that returns an `EmailProvider` implementation. It internally constructs a `ResendService` (the low-level API wrapper), so consumers only interact with the high-level interface.

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
  listId: list.id,
  from: "news@yourdomain.com",
  subject: "March update",
  html: "<p>Here is what happened this month.</p>",
});

// Two-step: create draft, review, then send
const draft = await provider.createCampaignDraft({
  listId: list.id,
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

### Testing with the mock provider

```typescript
import { createMockEmailProvider } from "@rafters/mail-resend/mock";

const mock = createMockEmailProvider();

await mock.sendEmail({
  to: "test@example.com",
  subject: "Hello",
  html: "<p>Test</p>",
});

// Inspect what was sent (top-level property)
console.log(mock.sentEmails);
// [{ to: 'test@example.com', subject: 'Hello', html: '<p>Test</p>' }]

const list = await mock.createMailingList("Beta Testers");
await mock.addSubscriber(list.id, "tester@example.com");

// Introspect full internal state via getState()
const { lists, subscribers, campaigns, sentEmails } = mock.getState();
console.log(subscribers);
// [{ id: '...', email: 'tester@example.com', unsubscribed: false }]

// Reset between tests
mock.clear();
```

`createMockEmailProvider` returns the full `EmailProvider` interface plus:

- `sentEmails` -- array of every `sendEmail` call, for direct assertions
- `getState()` -- returns `{ lists, subscribers, campaigns, sentEmails }` snapshot
- `clear()` -- resets all state between tests

Swap it for `createResendProvider` during tests with no code changes to your service layer.

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

`@rafters/mail-cloudflare` ships **building blocks**, not a one-shot inbound handler. You write the Email Routing Worker handler yourself using the building blocks:

- `createR2Storage(config)` -- R2 implementation of the `BlobStorage` interface from `@rafters/mail`
- `parseEmailHeaders(headers)` -- extracts From, To, Subject, Message-ID, In-Reply-To, References, Date from RFC 5322 headers
- `hashContent(content)` -- SHA-256 of raw email for dedupe and content-addressed keys

The reason the adapter does NOT provide a full `handleInboundEmail` function is that thread matching, database inserts, and queue dispatch all depend on consumer choices (schema extensions, auth model, queue topology). The building blocks stay small and let you compose the pipeline.

### Inbound flow (consumer-implemented)

Typical inbound handler using the building blocks:

1. Cloudflare Email Routing delivers `ForwardableEmailMessage` to the Worker
2. Read the raw message bytes from `message.raw` (a `ReadableStream`)
3. Call `parseEmailHeaders(Object.fromEntries(message.headers.entries()))` to get structured header data
4. Call `hashContent(raw)` for a content hash
5. Use `createR2Storage({ bucket: env.BLOB_STORAGE })` and call `storage.put(key, raw)` to save the raw `.eml`
6. Insert a row into `inbox_message` via your Drizzle queries
7. Match or create a thread (see the `threading.md` doc on core for the expected strategy -- implementation is your responsibility)
8. Dispatch to a classification queue if you run one

### R2 key format

`storage.generateKey(contentHash, extension)` produces keys of the form:

```
emails/{year}/{month}/{contentHash}.{extension}    (month is zero-padded)
```

Example: `emails/2026/04/a1b2c3d4e5f67890.eml`

The content hash comes from `hashContent` above. Three files per email (raw, HTML, text) is a common pattern but nothing in the BlobStorage interface enforces it -- you decide how many blobs to store per message.

### BlobStorage interface

```typescript
interface BlobStorage {
  put(key: string, content: string | ArrayBuffer, options?: BlobPutOptions): Promise<void>;
  get(key: string, options?: BlobGetOptions): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  generateKey(contentHash: string, extension: string): string;
}

interface BlobObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

interface BlobPutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

interface BlobGetOptions {
  range?: { offset: number; length: number };
}
```

One `put` method for all content types -- pass `httpMetadata: { "content-type": "message/rfc822" }` via options if you want the stored blob to carry that metadata. The `get` method returns a lazy `BlobObject` so consumers choose text or binary decoding. `BlobGetOptions.range` maps directly onto IMAP `FETCH BODY[]<offset.length>`.

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

> The Cloudflare Email Routing destination picker only lists Workers whose default export is exclusively `email()`. Do not add a `fetch()` handler to this Worker -- deploy HTTP endpoints separately against the same D1 + R2 bindings.

```typescript
import { createR2Storage } from "@rafters/mail-cloudflare/storage";
import { parseEmailHeaders, hashContent } from "@rafters/mail-cloudflare/parsing";

interface Env {
  DB: D1Database;
  EMAIL_BUCKET: R2Bucket;
  CLASSIFY_QUEUE: Queue;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    // 1. Read raw bytes
    const raw = await new Response(message.raw).arrayBuffer();

    // 2. Parse headers and compute content hash
    const headers = parseEmailHeaders(Object.fromEntries(message.headers.entries()));
    const contentHash = await hashContent(raw);

    // 3. Store raw in R2
    const storage = createR2Storage({ bucket: env.EMAIL_BUCKET });
    const blobKey = storage.generateKey(contentHash, "eml");
    await storage.put(blobKey, raw, {
      httpMetadata: { "content-type": "message/rfc822" },
    });

    // 4. Insert message row + thread logic + queue dispatch (your code)
    // ...
  },
};
```

#### Using BlobStorage directly

```typescript
import { createR2Storage } from "@rafters/mail-cloudflare/storage";

const storage = createR2Storage({ bucket: env.EMAIL_BUCKET });

// Generate a key from content hash
const key = storage.generateKey("a1b2c3d4e5f67890", "eml");
// -> "emails/2026/04/a1b2c3d4e5f67890.eml"

// Store raw email
await storage.put(key, rawEmailBuffer, {
  httpMetadata: { "content-type": "message/rfc822" },
});

// Retrieve later
const blob = await storage.get(key);
if (blob) {
  const text = await blob.text();
}
```

### Thread matching

Thread matching is the **consumer's responsibility**, not the adapter's. The adapter provides the building blocks (`parseEmailHeaders` gives you `inReplyTo` and `references`); your code runs the database queries and inserts the thread row. See the `threading.md` doc on `@rafters/mail` for the expected matching strategy.

### Testing

For integration tests, use Miniflare (Cloudflare's local simulator) which provides local D1, R2, and Queue bindings. The `createR2Storage` factory works against Miniflare's R2 binding with no code changes.

For unit tests of code that depends on the `BlobStorage` interface, implement an in-memory version:

```typescript
import type { BlobStorage, BlobObject } from "@rafters/mail";

function createInMemoryBlobStorage(): BlobStorage {
  const store = new Map<
    string,
    { content: string | ArrayBuffer; metadata?: Record<string, string> }
  >();

  return {
    async put(key, content, options) {
      store.set(key, { content, metadata: options?.customMetadata });
    },

    async get(key): Promise<BlobObject | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        text: async () =>
          typeof entry.content === "string"
            ? entry.content
            : new TextDecoder().decode(entry.content),
        arrayBuffer: async () =>
          typeof entry.content === "string"
            ? (new TextEncoder().encode(entry.content).buffer as ArrayBuffer)
            : entry.content,
        ...(entry.metadata && { customMetadata: entry.metadata }),
      };
    },

    async delete(key) {
      store.delete(key);
    },

    generateKey(contentHash: string, extension: string) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      return `emails/${now.getFullYear()}/${month}/${contentHash}.${extension}`;
    },
  };
}
```

### Gotchas

- Cloudflare Email Routing must be enabled on your domain. This is a DNS configuration, not just a wrangler setting.
- The worker receives the raw email as a stream. Read it once into an `ArrayBuffer` with `new Response(message.raw).arrayBuffer()` before you hash it or store it -- streams are single-consumption.
- Very large emails (25MB+ attachments) consume worker memory. Cloudflare Workers have a 128MB memory limit.
- R2 keys include year/month for lifecycle management. Set R2 lifecycle rules to auto-delete old emails.
- Thread matching by Message-ID headers only. Subject-line matching is intentionally NOT supported because subject collisions produce false positives.

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
import { BaseEmail } from "@rafters/mail-react-email/templates";
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
import { OtpEmail } from "@rafters/mail-react-email/otp";

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

#### Rendering through the rafters renderer

The rafters `TemplateRenderer` uses a name-keyed registry. Register templates by name at construction time (or later via `.register()`), then render by passing the template name and props:

```typescript
import { createReactEmailRenderer } from "@rafters/mail-react-email/renderer";
import { OtpEmail } from "@rafters/mail-react-email/otp";
import { WelcomeEmail } from "./templates/welcome.tsx";

const renderer = createReactEmailRenderer({
  otp: OtpEmail,
  welcome: WelcomeEmail,
});

// Or register at runtime
renderer.register("order-shipped", OrderShippedEmail);

const { html, text } = await renderer.render("otp", {
  code: "843291",
  expiryMinutes: 10,
});
```

The renderer throws if the template name is not registered. The error message lists the registered template names so debugging is straightforward.

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

**`createWorkersAIClassifier(ai, config?)`.** Factory that returns an `EmailClassifier` implementation. Sends email content to Workers AI for zero-shot classification and returns a category, confidence score, tags, and priority.

**Helper functions** exposed for custom classifier implementations: `truncateInput`, `validateCategory`, `determinePriority`, `extractTags`.

**Config defaults and merger:** `DEFAULT_TAG_PATTERNS`, `DEFAULT_URGENT_KEYWORDS`, `DEFAULT_HIGH_PRIORITY_KEYWORDS`, `DEFAULT_CLASSIFICATION_LABELS`, `DEFAULT_MAX_INPUT_LENGTH`, `resolveConfig`.

The package ships classification logic as a pure function. Queue consumers and Workflow orchestration are the consumer's responsibility -- wire them as needed against your pipeline. If you run classification inline with the inbound handler, you can skip queues entirely.

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
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";
import type { AiBinding } from "@rafters/mail-workers-ai";

interface Env {
  AI: AiBinding;
}

export default {
  async fetch(request: Request, env: Env) {
    const classifier = createWorkersAIClassifier(env.AI, {
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

#### Inline classification from the inbound handler

```typescript
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";

const classifier = createWorkersAIClassifier(env.AI);

// Inside your Email Routing worker, after storing the raw email:
const classification = await classifier.classify(headers.from, headers.subject, parsedTextBody);

// Update the message row with classification
await db
  .update(inboxMessage)
  .set({
    aiCategory: classification.category,
    aiConfidence: classification.confidence,
    isSpam: classification.category === "spam",
  })
  .where(eq(inboxMessage.id, messageId));
```

#### Queue consumer (consumer-implemented)

If you want to classify asynchronously via a queue, the consumer wires the queue handler and calls `classifier.classify` inside. The adapter does not ship a pre-baked queue consumer:

```typescript
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";

interface ClassifyJob {
  messageId: string;
  from: string;
  subject: string;
  body: string;
}

export default {
  async queue(batch: MessageBatch<ClassifyJob>, env: Env) {
    const classifier = createWorkersAIClassifier(env.AI);

    for (const message of batch.messages) {
      try {
        const { from, subject, body, messageId } = message.body;
        const result = await classifier.classify(from, subject, body);
        // persist result to DB...
        message.ack();
      } catch (err) {
        message.retry();
      }
    }
  },
};
```

### Testing

The classifier is a pure function around an AI call. For unit tests, mock the `AiBinding`:

```typescript
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";
import type { AiBinding } from "@rafters/mail-workers-ai";

const mockAi: AiBinding = {
  async run(model: string, input: unknown) {
    return [
      { label: "support", score: 0.85 },
      { label: "billing", score: 0.1 },
      { label: "spam", score: 0.02 },
    ];
  },
};

const classifier = createWorkersAIClassifier(mockAi);

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

Provides a single function, `resendOTP(config)`, that returns a `sendVerificationOTP` handler compatible with better-auth's `emailOTP` plugin. Under the hood it:

1. Creates a React Email renderer and registers the `OtpEmail` template
2. On each call, renders the OTP email with the incoming code and your branding
3. Sends the rendered email via the Resend transactional API (`POST https://api.resend.com/emails`)

### Usage

```typescript
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { resendOTP } from "@rafters/better-auth-resend";

export const auth = betterAuth({
  plugins: [
    emailOTP({
      sendVerificationOTP: resendOTP({
        apiKey: process.env.RESEND_API_KEY!,
        fromEmail: "noreply@yourdomain.com",
        brandName: "YourApp",
      }),
    }),
  ],
});
```

That is the entire integration. `resendOTP` returns an async function with the signature better-auth expects: `(email: string, otp: string) => Promise<void>`.

### Config shape

```typescript
interface ResendOTPConfig {
  apiKey: string; // Resend API key (required)
  fromEmail: string; // Verified sender email (required)
  brandName: string; // Shown in subject + body (required)
  logoUrl?: string; // Header logo URL
  websiteUrl?: string; // Link target for logo
  expiryMinutes?: number; // Shown in body text, default 10
  baseUrl?: string; // Resend API base, default https://api.resend.com
}
```

The email subject is templated as `${brandName} verification code: ${otp}`. Customize branding via `logoUrl`, `websiteUrl`, and `brandName`. These are forwarded to the `OtpEmail` template props.

### Testing

`resendOTP` talks to the Resend HTTP API directly via `fetch`. For tests, stub `globalThis.fetch` or use MSW to intercept the request:

```typescript
import { resendOTP } from "@rafters/better-auth-resend";

const send = resendOTP({
  apiKey: "test_key",
  fromEmail: "test@example.com",
  brandName: "TestApp",
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

Use the factory pattern: implement the interface from core and return it from a `create*` function, not a class. This matches the monorepo convention in CLAUDE.md and keeps the adapter symmetrically replaceable with the shipped ones.

Example for a hypothetical Postmark outbound adapter:

```typescript
import type { EmailProvider, EmailParams } from "@rafters/mail";

interface PostmarkConfig {
  serverToken: string;
  fromEmail: string;
}

export function createPostmarkProvider(config: PostmarkConfig): EmailProvider {
  const { serverToken, fromEmail } = config;

  return {
    async sendEmail(params: EmailParams): Promise<{ id: string }> {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": serverToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: params.from ?? fromEmail,
          To: params.to,
          Subject: params.subject,
          HtmlBody: params.html,
          TextBody: params.text,
        }),
      });

      const data = (await res.json()) as { MessageID: string };
      return { id: data.MessageID };
    },

    // Implement remaining EmailProvider methods (mailing lists, subscribers,
    // campaigns, audiences) following the same factory-closure pattern...
  } satisfies EmailProvider;
}
```

The core does not care which provider you use. Swap adapters by changing the import.

### No barrel exports

All adapter packages use subpath exports. Import from the specific entrypoint you need:

```typescript
// Good
import { createResendProvider } from "@rafters/mail-resend";
import { createMockEmailProvider } from "@rafters/mail-resend/mock";
import { createResendWebhookHandler } from "@rafters/mail-resend/webhooks";

import { createR2Storage } from "@rafters/mail-cloudflare/storage";
import { parseEmailHeaders, hashContent } from "@rafters/mail-cloudflare/parsing";

import { createWorkersAIClassifier, DEFAULT_TAG_PATTERNS } from "@rafters/mail-workers-ai";

// Avoid: pulling the entire package
import * as mailResend from "@rafters/mail-resend";
```

Edge runtimes have bundle size constraints (Cloudflare Workers: 1MB compressed). Subpath exports ensure you only bundle what you use.
