// The blob store (Cloudflare R2 Workers API): put "Stores the given value and metadata under the
// associated key." Each message's bytes go under their own SHA-256, unchanged, with no metadata.
import type { Blobs } from "@rafters/mail/receive";

/** The part of R2Bucket the blob store uses. */
export type R2Like = { put(key: string, value: Uint8Array): Promise<unknown> };

/** Cloudflare R2 Workers API: the bytes are put under their key as given, with no metadata. */
export function r2Blobs(bucket: R2Like): Blobs {
  return {
    put: async (key, bytes) => {
      await bucket.put(key, bytes);
    },
  };
}
