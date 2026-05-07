import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/tables.ts",
    "src/newsletter.ts",
    "src/services/index.ts",
    "src/services/inbox-email.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail", "drizzle-orm", "zod", "uuidv7"],
});
