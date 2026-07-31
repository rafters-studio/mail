import { describe, expect, it } from "vitest";
import {
  blobGetOptionsSchema,
  blobListOptionsSchema,
  blobPutOptionsSchema,
} from "../../src/interfaces/blob-storage.js";

describe("blobPutOptionsSchema", () => {
  it("accepts valid put options", () => {
    const result = blobPutOptionsSchema.parse({
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: { source: "inbound" },
    });
    expect(result.httpMetadata?.contentType).toBe("message/rfc822");
  });

  it("accepts empty object", () => {
    const result = blobPutOptionsSchema.parse({});
    expect(result).toEqual({});
  });
});

describe("blobGetOptionsSchema", () => {
  it("accepts range options", () => {
    const result = blobGetOptionsSchema.parse({
      range: { offset: 0, length: 4096 },
    });
    expect(result.range?.length).toBe(4096);
  });

  it("accepts empty object", () => {
    const result = blobGetOptionsSchema.parse({});
    expect(result).toEqual({});
  });
});

describe("blobListOptionsSchema", () => {
  it("accepts a prefix, cursor, and limit together", () => {
    const result = blobListOptionsSchema.parse({
      prefix: "templates/",
      cursor: "templates/global/welcome.json",
      limit: 100,
    });
    expect(result).toEqual({
      prefix: "templates/",
      cursor: "templates/global/welcome.json",
      limit: 100,
    });
  });

  it("accepts empty object, since listing the whole bucket is valid", () => {
    expect(blobListOptionsSchema.parse({})).toEqual({});
  });

  it("accepts a limit at the 1000-key ceiling R2 and S3 share", () => {
    expect(blobListOptionsSchema.parse({ limit: 1000 }).limit).toBe(1000);
  });

  it("rejects a limit above the ceiling rather than silently truncating it", () => {
    expect(() => blobListOptionsSchema.parse({ limit: 1001 })).toThrow();
  });

  it("rejects a zero limit, which would page forever without advancing", () => {
    expect(() => blobListOptionsSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects a fractional limit", () => {
    expect(() => blobListOptionsSchema.parse({ limit: 10.5 })).toThrow();
  });
});
