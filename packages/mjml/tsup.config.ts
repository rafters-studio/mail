import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/compile.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  // mjml stays external so the compile entry requires it at runtime rather than
  // inlining it, and so nothing can accidentally bundle it into the root entry.
  external: ["@rafters/mail", "mjml"],
});
