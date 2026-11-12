import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: [
      "packages/core/tests/**/*.test.ts",
      "packages/core/tests/**/*.steps.ts",
      "packages/test-readers/tests/**/*.test.ts",
      "packages/test-readers/tests/**/*.steps.ts",
      "packages/react-email/tests/**/*.test.ts",
      "packages/react-email/tests/**/*.steps.ts",
      "packages/cloudflare/tests/**/*.test.ts",
      "packages/cloudflare/tests/**/*.steps.ts",
      "packages/resend/tests/**/*.test.ts",
      "packages/resend/tests/**/*.steps.ts",
    ],
    exclude: ["**/node_modules/**", "dist", ".wrangler"],
    globals: true,
  },
});
