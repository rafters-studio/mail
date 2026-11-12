// Resend's submission settings, exactly (FR-MAIL-028).
import { expect } from "vite-plus/test";
import { criterion } from "../../core/tests/criterion.ts";
import { RESEND_SMTP, resendLogin } from "../src/index.ts";

criterion("FR-MAIL-028-c1", () => {
  expect(RESEND_SMTP).toEqual({ hostname: "smtp.resend.com", port: 465 });
  expect(resendLogin("re_key")).toEqual({ user: "resend", password: "re_key" });
});
