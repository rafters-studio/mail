import { z } from "zod";

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

export const blobListOptionsSchema = z.object({
  prefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
export type BlobListOptions = z.infer<typeof blobListOptionsSchema>;

export interface BlobObject {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface BlobListEntry {
  key: string;
  size: number;
  /** R2 calls this `uploaded`, S3 calls it `LastModified`; adapters normalize to this. */
  uploaded: Date;
  etag?: string;
  customMetadata?: Record<string, string>;
}

export interface BlobListResult {
  entries: BlobListEntry[];
  /** Opaque continuation token. Pass back verbatim for the next page; null when exhausted. */
  cursor: string | null;
}

export interface BlobStorage {
  put(key: string, content: string | ArrayBuffer, options?: BlobPutOptions): Promise<void>;
  get(key: string, options?: BlobGetOptions): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  list(options?: BlobListOptions): Promise<BlobListResult>;
  generateKey(contentHash: string, extension: string): string;
}
