import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // NFR-MAIL-002: the steps of the spec's scenarios reach every line and branch of src.
    include: ["tests/**/*.steps.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 100, branches: 100 },
    },
  },
});
