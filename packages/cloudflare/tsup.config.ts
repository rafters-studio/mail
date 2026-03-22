import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/r2-storage.ts", "src/email-parsing.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail", "zod"],
});
