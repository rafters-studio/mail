import { describe, expect, it } from "vitest";
import { blobGetOptionsSchema, blobPutOptionsSchema } from "../../src/interfaces/blob-storage.js";

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
