# @rafters/mail-workers-ai

Cloudflare Workers AI email classifier for [@rafters/mail](https://github.com/rafters-studio/mail). Uses DeBERTa-v3 zero-shot classification to assign a category, priority, and auto-tags to every inbound message.

Implements the `EmailClassifier` interface from core, so classification results flow through the standard message pipeline.

## Install

```bash
pnpm add @rafters/mail-workers-ai @rafters/mail
```

## Usage

```typescript
import { createWorkersAIClassifier } from "@rafters/mail-workers-ai";
import { DEFAULT_TAG_PATTERNS } from "@rafters/mail-workers-ai/config";

const classifier = createWorkersAIClassifier({
  ai: env.AI, // Cloudflare Workers AI binding
  tagPatterns: DEFAULT_TAG_PATTERNS,
});

const result = await classifier.classify({
  subject: "Your order has shipped",
  body: "Tracking: 1Z999...",
});

// result = {
//   category: "transactional",
//   confidence: 0.94,
//   priority: "normal",
//   tags: ["shipping", "order"],
// }
```

## Categories

The classifier emits one of a small fixed set of categories per message:

- `transactional` -- order confirmations, receipts, password resets
- `notification` -- system or app alerts
- `marketing` -- promotional and newsletter content
- `personal` -- human correspondence
- `spam` -- unwanted mail (moved to the spam folder by the pipeline)

Priority (`urgent`, `high`, `normal`, `low`) is derived from the category plus subject-line signals. Tags are pattern-matched against configurable regex patterns -- override `tagPatterns` to add your own.

## Runtime

This package is designed for Cloudflare Workers AI and expects an `AI` binding. If you run it in another runtime, provide a stub that matches the `Ai` interface and returns compatible responses.

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`classification.md`](./docs/classification.md) -- Categories, confidence scoring, priority derivation, tag patterns, and pipeline integration

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the inbound classification flow end-to-end.

## License

MIT
