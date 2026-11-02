// A Resend webhook, verified and mapped (FR-MAIL-028). Signatures are built here with Web Crypto,
// and the samples are Resend's documented ones, verbatim (resend.com/docs/webhooks/emails, 2026-11-02).
import { expect } from "vitest";
import { ZodError } from "zod";
import { criterion } from "../../core/tests/criterion.ts";
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

criterion("FR-MAIL-028-c2", async () => {
  const good = await sign("msg_1", TIMESTAMP, BODY);
  expect(await verifyWebhook(input(good))).toBe(true);
  expect(await verifyWebhook(input(`v1,AAAA ${good}`))).toBe(true);
});

criterion("FR-MAIL-028-c3", async () => {
  const good = await sign("msg_1", TIMESTAMP, BODY);
  const stale = String(NOW.getTime() / 1000 - 301);
  const cases = [
    { ...input(good), body: `${BODY} ` },
    { ...input(await sign("msg_1", stale, BODY)), timestamp: stale },
    { ...input(good), timestamp: "12a" },
    { ...input(good), id: null },
    { ...input(good), timestamp: null },
    input(null),
    input(good.replace("v1,", "v2,")),
    input("v1,not base64!"),
  ];
  for (const each of cases) expect(await verifyWebhook(each)).toBe(false);
});

criterion("FR-MAIL-028-c4", async () => {
  const good = await sign("msg_1", TIMESTAMP, BODY);
  await expect(verifyWebhook({ ...input(good), secret: "whsec_" })).rejects.toThrow();
  await expect(verifyWebhook({ ...input(good), secret: "whsec_not base64!" })).rejects.toThrow();
  await expect(verifyWebhook({ ...input(good), secret: "no prefix" })).rejects.toThrow();
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

criterion("FR-MAIL-028-c5", () => {
  expect(fromResend("msg_1", bounced)).toEqual([
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
});

criterion("FR-MAIL-028-c6", () => {
  const [fail] = fromResend("msg_1", failed);
  expect(fail).toMatchObject({ kind: "failed", permanent: null, detail: "reached_daily_quota" });
  const [suppress] = fromResend("msg_1", suppressed);
  expect(suppress).toMatchObject({
    kind: "failed",
    detail: `OnAccountSuppressionList: ${SUPPRESSED_MESSAGE}`,
  });
  const bounce = {
    type: "Transient",
    subType: "General",
    message: "soft",
    diagnosticCode: ["smtp; 550 no", "x-unix; 2"],
  };
  const [diagnosed] = fromResend("msg_1", { ...bounced, data: { ...data, bounce } });
  expect(diagnosed).toMatchObject({
    permanent: false,
    detail: "General: soft (smtp; 550 no; x-unix; 2)",
  });
});

criterion("FR-MAIL-028-c7", () => {
  const { message_id: _none, ...noMessageId } = data;
  const kinds = [
    ["email.delivered", "delivered"],
    ["email.delivery_delayed", "delayed"],
    ["email.complained", "complained"],
  ];
  for (const [type, kind] of kinds) {
    const [event] = fromResend("msg_1", { type, created_at: CREATED, data: noMessageId });
    expect(event).toMatchObject({ kind, detail: null, messageId: null, permanent: null });
  }
});

criterion("FR-MAIL-028-c8", () => {
  const shape = { created_at: CREATED, data };
  expect(fromResend("msg_1", { ...shape, type: "email.opened" })).toEqual([]);
  expect(fromResend("msg_1", { ...shape, type: "email.sent" })).toEqual([]);
  expect(fromResend("msg_1", { type: "contact.created", data: { id: "c1" } })).toEqual([]);
  expect(fromResend("msg_1", { ...shape, type: "constructor" })).toEqual([]);
});

criterion("FR-MAIL-028-c9", () => {
  const { to: _none, ...noTo } = bounced.data;
  expect(() => fromResend("msg_1", { ...bounced, data: noTo })).toThrow(ZodError);
});

criterion("FR-MAIL-028-c10", () => {
  const two = { ...failed, data: { ...failed.data, to: ["a@example.net", "b@example.net"] } };
  const events = fromResend("x", two);
  expect(events.map(({ recipient, eventId }) => [recipient, eventId])).toEqual([
    ["a@example.net", "x"],
    ["b@example.net", "x"],
  ]);
});
