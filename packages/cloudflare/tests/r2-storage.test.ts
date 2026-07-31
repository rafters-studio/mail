import { describe, expect, it, vi } from "vitest";
import { createR2Storage } from "../src/r2-storage.js";

interface FakeObject {
  key: string;
  size: number;
  uploaded: Date;
  etag?: string;
  customMetadata?: Record<string, string>;
}

/**
 * Stands in for an R2 bucket's `list`, reproducing the three behaviors the adapter
 * depends on: keys come back lexicographically ordered, `cursor` resumes strictly
 * after the key it names, and `cursor` is present on the response only when the page
 * was truncated. Getting that last one wrong is what the discriminated-union handling
 * in the adapter exists to prevent, so the fake has to model it rather than always
 * returning a cursor.
 */
function fakeBucket(objects: FakeObject[]) {
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const list = vi.fn(async (options?: R2ListOptions) => {
    let candidates = sorted;
    if (options?.prefix) {
      candidates = candidates.filter((o) => o.key.startsWith(options.prefix as string));
    }
    if (options?.cursor) {
      const resumeAt = candidates.findIndex((o) => o.key === options.cursor);
      candidates = resumeAt === -1 ? [] : candidates.slice(resumeAt + 1);
    }
    const limit = options?.limit ?? 1000;
    const page = candidates.slice(0, limit);
    const truncated = candidates.length > page.length;
    return truncated
      ? { objects: page, delimitedPrefixes: [], truncated: true, cursor: page[page.length - 1].key }
      : { objects: page, delimitedPrefixes: [], truncated: false };
  });
  return { bucket: { list } as unknown as R2Bucket, list };
}

function obj(key: string, overrides: Partial<FakeObject> = {}): FakeObject {
  return { key, size: 10, uploaded: new Date("2026-01-01T00:00:00.000Z"), ...overrides };
}

describe("createR2Storage", () => {
  describe("generateKey", () => {
    it("produces date-based path with full hash", () => {
      const storage = createR2Storage({ bucket: {} as R2Bucket });
      const key = storage.generateKey("abc123def456", "eml");
      expect(key).toMatch(/^emails\/\d{4}\/\d{2}\/abc123def456\.eml$/);
    });

    it("includes correct extension", () => {
      const storage = createR2Storage({ bucket: {} as R2Bucket });
      expect(storage.generateKey("hash", "html")).toContain(".html");
      expect(storage.generateKey("hash", "txt")).toContain(".txt");
      expect(storage.generateKey("hash", "eml")).toContain(".eml");
    });

    it("uses current year and month", () => {
      const storage = createR2Storage({ bucket: {} as R2Bucket });
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const key = storage.generateKey("hash", "eml");
      expect(key).toContain(`emails/${year}/${month}/`);
    });
  });

  describe("list", () => {
    it("returns every object when no prefix is given", async () => {
      const { bucket } = fakeBucket([obj("a.eml"), obj("b.eml")]);
      const result = await createR2Storage({ bucket }).list();
      expect(result.entries.map((e) => e.key)).toEqual(["a.eml", "b.eml"]);
    });

    it("returns only the objects under the requested prefix", async () => {
      const { bucket } = fakeBucket([
        obj("templates/global/welcome.json"),
        obj("templates/mb-1/receipt.json"),
        obj("emails/2026/01/abc.eml"),
      ]);
      const result = await createR2Storage({ bucket }).list({ prefix: "templates/" });
      expect(result.entries.map((e) => e.key)).toEqual([
        "templates/global/welcome.json",
        "templates/mb-1/receipt.json",
      ]);
    });

    it("reports an empty page rather than an error when the prefix matches nothing", async () => {
      const { bucket } = fakeBucket([obj("emails/2026/01/abc.eml")]);
      const result = await createR2Storage({ bucket }).list({ prefix: "templates/" });
      expect(result).toEqual({ entries: [], cursor: null });
    });

    it("returns a cursor when the page is truncated", async () => {
      const { bucket } = fakeBucket([obj("a"), obj("b"), obj("c")]);
      const result = await createR2Storage({ bucket }).list({ limit: 2 });
      expect(result.entries.map((e) => e.key)).toEqual(["a", "b"]);
      expect(result.cursor).toBe("b");
    });

    it("returns a null cursor on the final page", async () => {
      const { bucket } = fakeBucket([obj("a"), obj("b")]);
      const result = await createR2Storage({ bucket }).list({ limit: 2 });
      expect(result.cursor).toBeNull();
    });

    it("resumes after the cursor so paging visits every key exactly once", async () => {
      const { bucket } = fakeBucket([obj("a"), obj("b"), obj("c"), obj("d"), obj("e")]);
      const storage = createR2Storage({ bucket });

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof storage.list>> = await storage.list(
          cursor === null ? { limit: 2 } : { limit: 2, cursor },
        );
        seen.push(...page.entries.map((e) => e.key));
        cursor = page.cursor;
      } while (cursor !== null);

      expect(seen).toEqual(["a", "b", "c", "d", "e"]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("clamps a limit above the 1000-key ceiling R2 enforces", async () => {
      const { bucket, list } = fakeBucket([obj("a")]);
      await createR2Storage({ bucket }).list({ limit: 5000 });
      expect(list).toHaveBeenCalledWith({ limit: 1000 });
    });

    it("passes a limit below the ceiling through untouched", async () => {
      const { bucket, list } = fakeBucket([obj("a")]);
      await createR2Storage({ bucket }).list({ limit: 25 });
      expect(list).toHaveBeenCalledWith({ limit: 25 });
    });

    it("omits unset options instead of sending undefined to the bucket", async () => {
      const { bucket, list } = fakeBucket([obj("a")]);
      await createR2Storage({ bucket }).list();
      expect(list).toHaveBeenCalledWith({});
    });

    it("normalizes R2 object metadata onto the BlobListEntry shape", async () => {
      const uploaded = new Date("2026-03-04T05:06:07.000Z");
      const { bucket } = fakeBucket([
        obj("k.eml", { size: 4096, uploaded, etag: "abc", customMetadata: { mailboxId: "mb-1" } }),
      ]);
      const result = await createR2Storage({ bucket }).list();
      expect(result.entries[0]).toEqual({
        key: "k.eml",
        size: 4096,
        uploaded,
        etag: "abc",
        customMetadata: { mailboxId: "mb-1" },
      });
    });

    it("leaves etag and customMetadata absent when R2 does not supply them", async () => {
      const { bucket } = fakeBucket([obj("k.eml")]);
      const result = await createR2Storage({ bucket }).list();
      expect(result.entries[0]).not.toHaveProperty("etag");
      expect(result.entries[0]).not.toHaveProperty("customMetadata");
    });
  });
});
