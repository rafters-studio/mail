import { describe, expect, it } from "vitest";
import { createR2Storage } from "../src/r2-storage.js";

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
});
