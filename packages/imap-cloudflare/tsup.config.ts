import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/do.ts", "src/worker.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail-imap"],
});
