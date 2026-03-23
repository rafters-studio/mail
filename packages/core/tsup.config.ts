import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/schema/index.ts",
    "src/interfaces/index.ts",
    "src/threading.ts",
    "src/auth.ts",
    "src/services/index.ts",
    "src/services/inbox-email.ts",
    "src/migrations/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["drizzle-orm", "zod", "uuidv7"],
});
