// Resend's submission settings, exactly (FR-MAIL-028).
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import { RESEND_SMTP, resendLogin } from "../src/index.ts";

const FR028 = await feature("FR-MAIL-028");

describeFeature(
  FR028,
  ({ Scenario }) => {
    Scenario("The settings are exactly Resend's", ({ Given, When, Then }) => {
      Given("the published names", () => {
        // RESEND_SMTP and resendLogin are the published names.
      });

      When("RESEND_SMTP and resendLogin are read", () => {
        // They are read inside the Then, wrapped by its expect lines.
      });

      Then("they give smtp.resend.com, 465, the user resend and the key as password", () => {
        expect(RESEND_SMTP).toEqual({ hostname: "smtp.resend.com", port: 465 });
        expect(resendLogin("re_key")).toEqual({ user: "resend", password: "re_key" });
      });
    });
  },
  owns("FR-MAIL-028-c1"),
);
