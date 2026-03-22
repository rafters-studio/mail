import type { BlobGetOptions, BlobObject, BlobPutOptions, BlobStorage } from '@rafters/mail';

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
            (entry): entry is [string, string] => typeof entry[1] === 'string',
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

    generateKey(contentHash: string, extension: string): string {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      return `emails/${year}/${month}/${contentHash}.${extension}`;
    },
  };
}
