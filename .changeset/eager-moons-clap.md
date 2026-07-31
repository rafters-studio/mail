---
"@rafters/mail-cloudflare": minor
---

Implement `BlobStorage.list(options?)` against R2's native list API.

Maps `prefix`, `cursor`, and `limit` onto `R2ListOptions` and normalizes each `R2Object` onto `BlobListEntry`. `R2Objects` is a discriminated union where `cursor` exists only on the truncated branch, so the adapter narrows on `truncated` and returns `null` for a final page rather than reading a field that is not there.

`limit` is clamped to 1000 in the adapter as well as bounded in the core Zod schema -- the schema protects callers who validate their options, the clamp protects callers who pass a raw object, since R2 rejects an oversized page rather than truncating it.

Also corrects the quickstart's inbound Worker path label, which read `src/index.ts` while the HTTP Worker beside it read `apps/api/src/index.ts`.
