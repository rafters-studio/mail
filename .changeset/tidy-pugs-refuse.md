---
"@rafters/mail": minor
---

Add `templateSchema` and extend `BlobStorage` with `list(options?)`.

`templateSchema` describes the JSON blob an editor writes to `templates/<mailboxId|"global">/<name>.json`. It is the whole contract between the editor and any consumer -- there is no service or factory, because templates are files. `templateSourceTypeSchema` ("mjml" | "html"), the `Template` and `TemplateSourceType` types, and the `jsonValueSchema` / `JsonValue` primitives backing `variablesSchema` are exported alongside it.

`BlobStorage.list(options?)` returns paginated entries under a key prefix, with `BlobListOptions`, `BlobListEntry`, and `BlobListResult`. `cursor` is opaque and passed back verbatim; `null` means no more pages.

**Breaking for `BlobStorage` implementers.** Adding a method to the interface means any existing implementation must grow a `list()`. Consumers that only call `put`/`get`/`delete` are unaffected. The R2 adapter in `@rafters/mail-cloudflare` is updated in the same release; no other implementation exists in this workspace.
