import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/workerd/**/*.workerd.ts"],
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
