import { z } from 'zod';

export const blobPutOptionsSchema = z.object({
  httpMetadata: z.record(z.string(), z.string()).optional(),
  customMetadata: z.record(z.string(), z.string()).optional(),
});
export type BlobPutOptions = z.infer<typeof blobPutOptionsSchema>;

export const blobGetOptionsSchema = z.object({
  range: z
    .object({
      offset: z.number(),
      length: z.number(),
    })
    .optional(),
});
export type BlobGetOptions = z.infer<typeof blobGetOptionsSchema>;

export interface BlobObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface BlobStorage {
  put(key: string, content: string | ArrayBuffer, options?: BlobPutOptions): Promise<void>;
  get(key: string, options?: BlobGetOptions): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  generateKey(contentHash: string, extension: string): string;
}
