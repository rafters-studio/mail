import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // NFR-MAIL-002: the criterion tests reach every line and branch of src, and the template
    // plugin's are among them (FR-MAIL-014 writes its content).
    include: ["tests/**/*.test.ts", "../react-email/tests/render.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/encoding/never.ts"],
      thresholds: { lines: 100, branches: 100 },
    },
  },
});
