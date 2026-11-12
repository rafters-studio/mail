import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // NFR-MAIL-002: the steps of the spec's scenarios and the criterion tests reach every line and
    // branch of src.
    include: ["tests/**/*.test.ts", "tests/**/*.steps.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 100, branches: 100 },
    },
  },
});
