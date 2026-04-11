import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/protocol/parser.ts",
    "src/protocol/formatter.ts",
    "src/session.ts",
    "src/uid-map.ts",
    "src/flags.ts",
    "src/commands/auth.ts",
    "src/commands/mailbox.ts",
    "src/commands/message.ts",
    "src/commands/session.ts",
    "src/commands/extensions.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  external: ["@rafters/mail", "zod"],
});
