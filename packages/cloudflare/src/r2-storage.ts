import type {
  BlobGetOptions,
  BlobListEntry,
  BlobListOptions,
  BlobListResult,
  BlobObject,
  BlobPutOptions,
  BlobStorage,
} from "@rafters/mail";

/** R2 and S3 both refuse more than this per page; clamp rather than let the bucket reject. */
const MAX_LIST_LIMIT = 1000;

export interface R2StorageConfig {
  bucket: R2Bucket;
}

export function createR2Storage(config: R2StorageConfig): BlobStorage {
  const { bucket } = config;

  return {
    async put(key: string, content: string | ArrayBuffer, options?: BlobPutOptions): Promise<void> {
      const r2Options: R2PutOptions = {};
      if (options?.httpMetadata) {
        r2Options.httpMetadata = options.httpMetadata as R2HTTPMetadata;
      }
      if (options?.customMetadata) {
        r2Options.customMetadata = options.customMetadata;
      }
      await bucket.put(key, content, r2Options);
    },

    async get(key: string, options?: BlobGetOptions): Promise<BlobObject | null> {
      const r2Options: R2GetOptions = {};
      if (options?.range) {
        r2Options.range = options.range;
      }
      const object = await bucket.get(key, r2Options);

      if (!object) return null;

      const result: BlobObject = {
        text: () => object.text(),
        arrayBuffer: () => object.arrayBuffer(),
      };
      if (object.httpMetadata) {
        result.httpMetadata = Object.fromEntries(
          Object.entries(object.httpMetadata).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
      if (object.customMetadata) {
        result.customMetadata = object.customMetadata;
      }
      return result;
    },

    async delete(key: string): Promise<void> {
      await bucket.delete(key);
    },

    async list(options?: BlobListOptions): Promise<BlobListResult> {
      const r2Options: R2ListOptions = {};
      if (options?.prefix !== undefined) {
        r2Options.prefix = options.prefix;
      }
      if (options?.cursor !== undefined) {
        r2Options.cursor = options.cursor;
      }
      if (options?.limit !== undefined) {
        r2Options.limit = Math.min(options.limit, MAX_LIST_LIMIT);
      }

      const listed = await bucket.list(r2Options);

      const entries = listed.objects.map((object): BlobListEntry => {
        const entry: BlobListEntry = {
          key: object.key,
          size: object.size,
          uploaded: object.uploaded,
        };
        if (object.etag) {
          entry.etag = object.etag;
        }
        if (object.customMetadata) {
          entry.customMetadata = object.customMetadata;
        }
        return entry;
      });

      // R2Objects is a discriminated union: `cursor` only exists on the truncated
      // branch, so a non-truncated page has no continuation token to hand back.
      return { entries, cursor: listed.truncated ? listed.cursor : null };
    },

    // Date-based prefix partitioning, which `list({ prefix })` above consumes for
    // cleanup, export, and debugging sweeps.
    generateKey(contentHash: string, extension: string): string {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      return `emails/${year}/${month}/${contentHash}.${extension}`;
    },
  };
}
