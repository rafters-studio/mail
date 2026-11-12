// A Resend webhook, verified and mapped (FR-MAIL-028). Signatures are built here with Web Crypto,
// and the samples are Resend's documented ones, verbatim (resend.com/docs/webhooks/emails, 2026-11-02).
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { ZodError } from "zod";
import { feature, owns } from "../../core/tests/feature.ts";
import { fromResend, verifyWebhook } from "../src/index.ts";

const KEY = new TextEncoder().encode("the webhook's secret key");
const SECRET = `whsec_${btoa(String.fromCharCode(...KEY))}`;
const NOW = new Date("2026-11-02T12:00:00Z");
const TIMESTAMP = String(NOW.getTime() / 1000);
const BODY = '{"type":"email.delivered"}';

/** The svix-signature entry Svix would send for this id, timestamp and body. */
async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", KEY, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const input = (signature: string | null) => ({
  secret: SECRET,
  id: "msg_1",
  timestamp: TIMESTAMP,
  signature,
  body: BODY,
  now: NOW,
});

const data = {
  broadcast_id: "8b146471-e88e-4322-86af-016cd36fd216",
  created_at: "2026-11-22T23:41:11.894Z",
  email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
  message_id: "<111-222-333@email.example.com>",
  from: "Acme <onboarding@resend.dev>",
  to: ["delivered@resend.dev"],
  subject: "Sending this example",
  template_id: "43f68331-0622-4e15-8202-246a0388854b",
  tags: { category: "confirm_email" },
};
const CREATED = "2026-11-22T23:41:12.126Z";
const BOUNCE_MESSAGE =
  "The recipient's email address is on the suppression list because it has a recent history of producing hard bounces.";
const SUPPRESSED_MESSAGE =
  "Resend has suppressed sending to this address because it is on the account-level suppression list. This does not count toward your bounce rate metric";
const bounced = {
  type: "email.bounced",
  created_at: CREATED,
  data: {
    ...data,
    bounce: { message: BOUNCE_MESSAGE, subType: "Suppressed", type: "Permanent" },
  },
};
const failed = {
  type: "email.failed",
  created_at: CREATED,
  data: { ...data, failed: { reason: "reached_daily_quota" } },
};
const suppressed = {
  type: "email.suppressed",
  created_at: CREATED,
  data: {
    ...data,
    suppressed: { message: SUPPRESSED_MESSAGE, type: "OnAccountSuppressionList" },
  },
};

type Input = Parameters<typeof verifyWebhook>[0];
type Event = ReturnType<typeof fromResend>[number] | undefined;

const FR028 = await feature("FR-MAIL-028");

describeFeature(
  FR028,
  ({ Scenario }) => {
    Scenario("A good signature passes, in any list position", ({ Given, When, Then }) => {
      let good: string;

      Given(
        "a signature built with Web Crypto, alone and second in a space-delimited list",
        async () => {
          good = await sign("msg_1", TIMESTAMP, BODY);
        },
      );

      When("verifyWebhook runs", () => {
        // verifyWebhook runs inside the Then, wrapped by its expect lines.
      });

      Then("it returns true", async () => {
        expect(await verifyWebhook(input(good))).toBe(true);
        expect(await verifyWebhook(input(`v1,AAAA ${good}`))).toBe(true);
      });
    });

    Scenario("Anything else fails without throwing", ({ Given, When, Then }) => {
      let cases: Input[];

      Given(
        "a changed byte, a timestamp over 300 seconds away, a non-digit timestamp, each header missing, only a v2 entry, and undecodable base64",
        async () => {
          const good = await sign("msg_1", TIMESTAMP, BODY);
          const stale = String(NOW.getTime() / 1000 - 301);
          cases = [
            { ...input(good), body: `${BODY} ` },
            { ...input(await sign("msg_1", stale, BODY)), timestamp: stale },
            { ...input(good), timestamp: "12a" },
            { ...input(good), id: null },
            { ...input(good), timestamp: null },
            input(null),
            input(good.replace("v1,", "v2,")),
            input("v1,not base64!"),
          ];
        },
      );

      When("verifyWebhook runs", () => {
        // verifyWebhook runs inside the Then, wrapped by its expect.
      });

      Then("each returns false", async () => {
        for (const each of cases) expect(await verifyWebhook(each)).toBe(false);
      });
    });

    Scenario("A malformed secret throws", ({ Given, When, Then }) => {
      let good: string;

      Given("a secret of whsec_ with nothing after it, and one with invalid base64", async () => {
        good = await sign("msg_1", TIMESTAMP, BODY);
      });

      When("verifyWebhook runs", () => {
        // verifyWebhook runs inside the Then, wrapped by its expect lines.
      });

      Then("it throws", async () => {
        await expect(verifyWebhook({ ...input(good), secret: "whsec_" })).rejects.toThrow();
        await expect(
          verifyWebhook({ ...input(good), secret: "whsec_not base64!" }),
        ).rejects.toThrow();
        await expect(verifyWebhook({ ...input(good), secret: "no prefix" })).rejects.toThrow();
      });
    });

    Scenario("Resend's documented bounce maps exactly", ({ Given, When, Then }) => {
      let events: ReturnType<typeof fromResend>;

      Given("the documented email.bounced sample, verbatim", () => {
        // bounced, at file scope, is the documented sample.
      });

      When("fromResend runs", () => {
        events = fromResend("msg_1", bounced);
      });

      Then(
        "there is one event with the top-level created_at, the unbracketed Message-ID, email_id as providerId, permanent true, smtp null and detail Suppressed and its message",
        () => {
          expect(events).toEqual([
            {
              provider: "resend",
              eventId: "msg_1",
              kind: "bounced",
              recipient: "delivered@resend.dev",
              at: new Date(CREATED),
              messageId: "111-222-333@email.example.com",
              providerId: "56761188-7520-42d8-8898-ff6fc54ce618",
              permanent: true,
              smtp: null,
              detail: `Suppressed: ${BOUNCE_MESSAGE}`,
            },
          ]);
        },
      );
    });

    Scenario("Failed, suppressed and diagnostics reach detail", ({ Given, When, Then }) => {
      let diagnosedInput: typeof bounced;
      let fail: Event;
      let suppress: Event;
      let diagnosed: Event;

      Given(
        "the documented email.failed and email.suppressed samples, and a bounce with diagnosticCode",
        () => {
          const bounce = {
            type: "Transient",
            subType: "General",
            message: "soft",
            diagnosticCode: ["smtp; 550 no", "x-unix; 2"],
          };
          diagnosedInput = { ...bounced, data: { ...data, bounce } };
        },
      );

      When("fromResend runs", () => {
        [fail] = fromResend("msg_1", failed);
        [suppress] = fromResend("msg_1", suppressed);
        [diagnosed] = fromResend("msg_1", diagnosedInput);
      });

      Then(
        "detail holds failed.reason, the suppressed type and message, and the diagnostics joined",
        () => {
          expect(fail).toMatchObject({
            kind: "failed",
            permanent: null,
            detail: "reached_daily_quota",
          });
          expect(suppress).toMatchObject({
            kind: "failed",
            detail: `OnAccountSuppressionList: ${SUPPRESSED_MESSAGE}`,
          });
          expect(diagnosed).toMatchObject({
            permanent: false,
            detail: "General: soft (smtp; 550 no; x-unix; 2)",
          });
        },
      );
    });

    Scenario("Each tracked type maps to its kind", ({ Given, When, Then }) => {
      let kinds: string[][];
      let events: [string, Event][];

      Given("email.delivered, email.delivery_delayed and email.complained", () => {
        kinds = [
          ["email.delivered", "delivered"],
          ["email.delivery_delayed", "delayed"],
          ["email.complained", "complained"],
        ];
      });

      When("fromResend runs", () => {
        const { message_id: _none, ...noMessageId } = data;
        events = kinds.map(([type, kind]) => {
          const [event] = fromResend("msg_1", { type, created_at: CREATED, data: noMessageId });
          return [kind ?? "", event];
        });
      });

      Then("the kinds are delivered, delayed and complained, with detail null", () => {
        for (const [kind, event] of events) {
          expect(event).toMatchObject({ kind, detail: null, messageId: null, permanent: null });
        }
      });
    });

    Scenario("A type not tracked returns nothing, whatever its data", ({ Given, When, Then }) => {
      let shape: { created_at: string; data: typeof data };

      Given("email.opened, email.sent, contact.created with its own shape, and constructor", () => {
        shape = { created_at: CREATED, data };
      });

      When("fromResend runs", () => {
        // fromResend runs inside the Then, wrapped by its expect lines.
      });

      Then("each returns an empty list", () => {
        expect(fromResend("msg_1", { ...shape, type: "email.opened" })).toEqual([]);
        expect(fromResend("msg_1", { ...shape, type: "email.sent" })).toEqual([]);
        expect(fromResend("msg_1", { type: "contact.created", data: { id: "c1" } })).toEqual([]);
        expect(fromResend("msg_1", { ...shape, type: "constructor" })).toEqual([]);
      });
    });

    Scenario("A malformed tracked event throws", ({ Given, When, Then }) => {
      let noTo: Omit<typeof bounced.data, "to">;

      Given("email.bounced with no data.to", () => {
        const { to: _none, ...rest } = bounced.data;
        noTo = rest;
      });

      When("fromResend runs", () => {
        // fromResend runs inside the Then, wrapped by its expect.
      });

      Then("it throws a ZodError", () => {
        expect(() => fromResend("msg_1", { ...bounced, data: noTo })).toThrow(ZodError);
      });
    });

    Scenario("One event per listed recipient, under the delivery's id", ({ Given, When, Then }) => {
      let two: typeof failed;
      let events: ReturnType<typeof fromResend>;

      Given("an event listing two recipients, with the svix-id x", () => {
        two = { ...failed, data: { ...failed.data, to: ["a@example.net", "b@example.net"] } };
      });

      When("fromResend runs", () => {
        events = fromResend("x", two);
      });

      Then("there are two events, each with eventId x", () => {
        expect(events.map(({ recipient, eventId }) => [recipient, eventId])).toEqual([
          ["a@example.net", "x"],
          ["b@example.net", "x"],
        ]);
      });
    });
  },
  owns(
    "FR-MAIL-028-c2",
    "FR-MAIL-028-c3",
    "FR-MAIL-028-c4",
    "FR-MAIL-028-c5",
    "FR-MAIL-028-c6",
    "FR-MAIL-028-c7",
    "FR-MAIL-028-c8",
    "FR-MAIL-028-c9",
    "FR-MAIL-028-c10",
  ),
);
