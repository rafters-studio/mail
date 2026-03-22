import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/mock-provider.ts", "src/webhook-handler.ts", "src/resend-types.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail", "zod", "uuidv7"],
});
