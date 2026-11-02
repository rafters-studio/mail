import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/core/tests/**/*.test.ts",
      "packages/test-readers/tests/**/*.test.ts",
      "packages/react-email/tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "dist", ".wrangler"],
    globals: true,
  },
});
