import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/message/index.ts",
    "src/document/index.ts",
    "src/address/index.ts",
    "src/message-id/index.ts",
    "src/receive/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["zod"],
});
