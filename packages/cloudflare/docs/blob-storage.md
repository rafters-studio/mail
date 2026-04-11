# Blob Storage

How email content is stored and retrieved.

---

## Why blob storage

Email bodies and attachments are large (kilobytes to megabytes). Storing them inline in the database would bloat query performance and row sizes. Instead, the database stores metadata and blob keys. The actual content lives in blob storage.

---

## The blob storage adapter

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

`get` returns a lazy `BlobObject` (not a string) so consumers choose whether to decode as text or binary via `.text()` / `.arrayBuffer()`. Partial reads are supported through `BlobGetOptions.range`, which IMAP `FETCH BODY[]<offset.length>` maps directly onto.

`generateKey(contentHash, extension)` centralizes the key schema so applications do not hand-roll paths. The Cloudflare implementation builds keys of the form `emails/{year}/{month}/{contentHash}.{extension}`.

Any storage backend that supports key-value blob operations works: object storage (S3-compatible), file system, KV stores. Ship-ready adapters in the repo: `createR2Storage` from `@rafters/mail-cloudflare/storage`.

---

## What gets stored

Each inbound message produces up to three blobs:

| Blob | Key suffix | Content                   | Purpose                              |
| ---- | ---------- | ------------------------- | ------------------------------------ |
| Raw  | `.eml`     | Complete RFC 5322 message | IMAP FETCH BODY[], archival          |
| HTML | `.html`    | Extracted HTML body       | IMAP FETCH BODY[TEXT], web display   |
| Text | `.txt`     | Extracted plain text body | Snippets, search, plain text clients |

The raw blob is required. HTML and text blobs are optional (a plain-text-only email has no HTML blob).

---

## Key format

Keys follow a date-partitioned, content-addressed pattern:

```
emails/{year}/{month}/{content-hash}.{extension}
```

Example: `emails/2026/04/a1b2c3d4e5f6.eml`

- **Date partitioning**: groups blobs by month for lifecycle management
- **Content addressing**: the hash is derived from the email content, so duplicate emails produce the same key
- **Month is zero-padded**: `04` not `4`

---

## Immutability

Blobs are write-once. Once stored, they are never modified. This is essential for:

- **IMAP correctness**: IMAP UIDs point to immutable messages. If content could change, the UID mapping would be unreliable.
- **Threading integrity**: In-Reply-To/References point to specific messages by Message-ID. The content those references describe must be stable.
- **Archival**: the raw `.eml` blob is the legal record of the email as received.

Deletion happens only on EXPUNGE (permanent removal of a \Deleted message). The blob is deleted alongside the database record.

---

## Size tracking

The message record stores `sizeBytes` -- the byte size of the raw blob. This is used by:

- IMAP FETCH RFC822.SIZE
- IMAP SEARCH LARGER/SMALLER
- Dashboard storage usage reporting

---

## Attachments

Attachments are parsed from the MIME structure of the raw email and tracked in the database:

| Field       | Purpose                             |
| ----------- | ----------------------------------- |
| filename    | Original filename                   |
| contentType | MIME type (e.g., `application/pdf`) |
| sizeBytes   | Attachment size                     |
| blobKey     | Key in blob storage                 |
| contentId   | For inline images (CID references)  |

Each attachment is a separate blob. The attachment record links it to the parent message.
