import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // NFR-MAIL-002: the steps of the spec's scenarios reach every line and branch of src, and the
    // template plugin's are among them (FR-MAIL-014 writes its content).
    include: ["tests/**/*.steps.ts", "../react-email/tests/render.steps.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/encoding/never.ts"],
      thresholds: { lines: 100, branches: 100 },
    },
  },
});
