import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/renderer.ts",
    "src/templates/base-email.tsx",
    "src/templates/otp-email.tsx",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail", "@react-email/components", "react", "zod"],
});
