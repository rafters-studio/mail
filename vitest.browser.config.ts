import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.spec.ts", "packages/*/tests/**/*.spec.tsx"],
    exclude: ["**/node_modules/**", "dist", ".wrangler"],
    globals: true,
    browser: {
      enabled: true,
      provider: "playwright",
      instances: [{ browser: "chromium" }],
    },
  },
});
