// The Worker that hears, and Cloudflare's six documented events, verbatim
// (developers.cloudflare.com/email-service/platform/event-subscriptions, 2026-11-02) (FR-MAIL-030).
import { expect, vi } from "vitest";
import { ZodError } from "zod";
import { criterion } from "../../core/tests/criterion.ts";
import type { SendEvent } from "../../core/src/send/index.ts";
import { d1Events, type D1Like, fromCloudflare, sendingWorker } from "../src/index.ts";
import { MAILBOX, USER } from "./imap-world.ts";
import { sendingDb } from "./sqlite.ts";
import { input, submitWorld } from "./submit-world.ts";

const metadata = {
  accountId: "f9f79265f388666de8122cfb508d7776",
  eventSubscriptionId: "1830c4bb612e43c3af7f4cada31fbf3f",
  eventSchemaVersion: 1,
  eventTimestamp: "2026-06-01T02:48:57.132Z",
};
const AT = new Date(metadata.eventTimestamp);
const source = (domain: string) => ({
  type: "email.sending",
  zoneId: "023e105f4ecef8ad9ca31a8372d0c353",
  domain,
});
const DELIVERED = {
  type: "cf.email.sending.message.delivered",
  source: source("example.com"),
  payload: {
    eventId: "0190d0c4-7e9a-7b3c-9f12-1a2b3c4d5e6f",
    messageId: "0101018f7d0c4d9a-msg-deadbeef",
    sender: "noreply@example.com",
    recipient: "user@example.net",
    subject: "Welcome",
    terminal: true,
    delivery: {
      status: "delivered",
      provider: "gmail",
      deliveryTimeMs: 1234,
      smtpStatusCode: "250",
      smtpEnhancedStatusCode: "2.0.0",
      smtpResponse: "250 2.0.0 OK 1714820445 a1b2c3 - gsmtp",
    },
  },
  metadata,
};
const DEFERRED = {
  type: "cf.email.sending.message.deferred",
  source: source("send.example.com"),
  payload: {
    eventId: "0190d0c4-7e9b-7714-9004-11f0b6d9a341",
    messageId: "0101018f7d0c4d9a-msg-deferred",
    sender: "receipts@send.example.com",
    recipient: "user@example.net",
    subject: "Your receipt",
    terminal: false,
    delivery: {
      status: "deferred",
      provider: "external_smtp",
      deliveryTimeMs: 2143,
      smtpStatusCode: "451",
      smtpEnhancedStatusCode: "4.2.0",
      smtpResponse: "451 4.2.0 Temporary mailbox error",
    },
    bounce: {
      type: "soft",
      classification: "temporary_failure",
      reason: "451 4.2.0 Temporary mailbox error",
    },
  },
  metadata,
};
const BOUNCED = {
  type: "cf.email.sending.message.bounced",
  source: source("send.example.com"),
  payload: {
    eventId: "0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6",
    messageId: "0101018f7d0c4d9a-msg-bounced",
    sender: "receipts@send.example.com",
    recipient: "user@example.net",
    subject: "Your receipt",
    terminal: true,
    delivery: {
      status: "bounced",
      provider: "external_smtp",
      deliveryTimeMs: 2143,
      smtpStatusCode: "550",
      smtpEnhancedStatusCode: "5.1.1",
      smtpResponse: "550 5.1.1 User unknown",
    },
    bounce: {
      type: "hard",
      classification: "permanent_failure",
      reason: "550 5.1.1 User unknown",
    },
  },
  metadata,
};
const FAILED = {
  type: "cf.email.sending.message.failed",
  source: source("example.com"),
  payload: {
    eventId: "0190d0c4-81c1-7bc6-9344-829cd9001a12",
    messageId: "0101018f7d0c4d9a-msg-failed",
    sender: "noreply@example.com",
    recipient: "user@example.net",
    subject: "Welcome",
    terminal: true,
    delivery: { status: "failed" },
    failure: { reason: "delivery_failed" },
  },
  metadata,
};
const REJECTED = {
  type: "cf.email.sending.message.rejected",
  source: source("example.com"),
  payload: {
    eventId: "0190d0c4-830a-77e5-8fa0-8d10f4e8dc8b",
    messageId: "0101018f7d0c4d9a-msg-rejected",
    sender: "noreply@example.com",
    recipient: "user@example.net",
    subject: "Welcome",
    terminal: true,
    delivery: { status: "rejected" },
    rejection: { reason: "suppressed", party: "recipient", detail: "Recipient is suppressed" },
  },
  metadata,
};
const COMPLAINED = {
  type: "cf.email.sending.message.complained",
  source: source("send.example.com"),
  payload: {
    eventId: "0190d0c4-9f01-7c44-b2a1-aabbccddeeff",
    messageId: "0101018f7d0c4d9a-msg-complained",
    sender: "news@send.example.com",
    recipient: "user@example.net",
    terminal: true,
    delivery: { status: "complained" },
    complaint: { type: "abuse" },
  },
  metadata,
};

const EVENT = {
  provider: "resend",
  eventId: "x",
  kind: "delivered" as const,
  recipient: "a@x.example",
  at: AT,
  messageId: "m@x.example",
  providerId: "p1",
  permanent: null,
  smtp: null,
  detail: null,
};
const post = (path = "/webhooks/resend", method = "POST") =>
  new Request(`https://mail.example${path}`, { method });

criterion("FR-MAIL-030-c1", () => {
  expect(Object.keys(sendingWorker({})).sort()).toEqual(["fetch", "queue"]);
});

criterion("FR-MAIL-030-c2", async () => {
  const { d1, rows } = sendingDb();
  const two = [EVENT, { ...EVENT, recipient: "b@x.example" }];
  const worker = sendingWorker({ resend: async () => two });
  const answer = await worker.fetch(post(), { MAIL_DB: d1 });
  expect(answer.status).toBe(200);
  expect(rows("send_events")).toHaveLength(2);
});

criterion("FR-MAIL-030-c3", async () => {
  const { d1, rows } = sendingDb();
  const worker = sendingWorker({ resend: async () => null });
  expect((await worker.fetch(post(), { MAIL_DB: d1 })).status).toBe(401);
  expect(rows("send_events")).toEqual([]);
});

criterion("FR-MAIL-030-c4", async () => {
  const { d1 } = sendingDb();
  const worker = sendingWorker({ resend: async () => [] });
  const env = { MAIL_DB: d1 };
  for (const request of [
    post("/webhooks/other"),
    post("/webhooks/constructor"),
    post("/webhooks/resend", "GET"),
    post("/resend"),
  ]) {
    expect((await worker.fetch(request, env)).status).toBe(404);
  }
});

criterion("FR-MAIL-030-c5", async () => {
  const { d1 } = sendingDb();
  const throwing = sendingWorker({
    resend: async () => {
      throw new Error("handler");
    },
  });
  await expect(throwing.fetch(post(), { MAIL_DB: d1 })).rejects.toThrow("handler");
  const broken: D1Like = {
    prepare: () => {
      throw new Error("port");
    },
  };
  const worker = sendingWorker({ resend: async () => [EVENT] });
  await expect(worker.fetch(post(), { MAIL_DB: broken })).rejects.toThrow("port");
});

criterion("FR-MAIL-030-c6", async () => {
  const { d1, rows } = sendingDb();
  const log: string[] = [];
  const message = (name: string, body: unknown) => ({
    body,
    ack: () => log.push(`${name} ack`),
    retry: () => log.push(`${name} retry`),
  });
  await sendingWorker({}).queue(
    {
      messages: [
        message("good", DELIVERED),
        message("untracked", { type: "cf.email.sending.message.opened" }),
        message("malformed", { type: BOUNCED.type }),
      ],
    },
    { MAIL_DB: d1 },
  );
  expect(log).toEqual(["good ack", "untracked ack", "malformed retry"]);
  expect(rows("send_events")).toHaveLength(1);
});

const common = (payload: { eventId: string; messageId: string; recipient: string }) => ({
  provider: "cloudflare",
  eventId: payload.eventId,
  providerId: payload.messageId,
  recipient: payload.recipient,
  at: AT,
  messageId: null,
});

criterion("FR-MAIL-030-c7", () => {
  const expected = [
    [DELIVERED, "delivered", null, null],
    [DEFERRED, "delayed", false, "temporary_failure: 451 4.2.0 Temporary mailbox error"],
    [BOUNCED, "bounced", true, "permanent_failure: 550 5.1.1 User unknown"],
    [FAILED, "failed", null, "delivery_failed"],
    [REJECTED, "failed", null, "recipient: suppressed"],
    [COMPLAINED, "complained", null, "abuse"],
  ] as const;
  for (const [sample, kind, permanent, detail] of expected) {
    expect(fromCloudflare(sample)).toMatchObject({
      ...common(sample.payload),
      kind,
      permanent,
      detail,
    });
  }
});

criterion("FR-MAIL-030-c8", () => {
  for (const sample of [FAILED, REJECTED, COMPLAINED]) {
    expect(fromCloudflare(sample)?.smtp).toBeNull();
  }
  expect(fromCloudflare(DELIVERED)?.smtp).toEqual({
    code: "250",
    enhanced: "2.0.0",
    text: "250 2.0.0 OK 1714820445 a1b2c3 - gsmtp",
  });
  expect(fromCloudflare(DEFERRED)?.smtp).toEqual({
    code: "451",
    enhanced: "4.2.0",
    text: "451 4.2.0 Temporary mailbox error",
  });
  expect(fromCloudflare(BOUNCED)?.smtp).toEqual({
    code: "550",
    enhanced: "5.1.1",
    text: "550 5.1.1 User unknown",
  });
});

criterion("FR-MAIL-030-c9", () => {
  expect(fromCloudflare({ ...DELIVERED, type: "cf.email.sending.message.opened" })).toBeNull();
  expect(fromCloudflare({ ...DELIVERED, type: "cf.email.sending.message.constructor" })).toBeNull();
  expect(() => fromCloudflare({ type: BOUNCED.type, metadata })).toThrow(ZodError);
});

criterion("FR-MAIL-030-c10", async () => {
  const { d1, rows } = sendingDb();
  const { record } = d1Events(d1);
  await record(EVENT);
  await record(EVENT);
  expect(rows("send_events")).toHaveLength(1);
});

// A later bounce: an event about a real submission, through the real ports (FR-MAIL-042).
const BOUNCE: SendEvent = {
  provider: "cloudflare",
  eventId: "e1",
  kind: "bounced",
  recipient: "a@x.example",
  at: new Date(),
  messageId: null,
  providerId: "cf-a@x.example",
  permanent: true,
  smtp: null,
  detail: "550 no such user",
};
const notices = (w: ReturnType<typeof submitWorld>) =>
  w.rows("SELECT mailbox, mail_from, rcpt_to FROM deliveries WHERE via = 'notice'");
const hearing = (...events: SendEvent[]) => sendingWorker({ resend: async () => events });
/** The Worker's bindings, as the sending example binds them to the mailbox and blobs. */
const bound = (w: ReturnType<typeof submitWorld>) => ({
  MAIL_DB: w.env.MAIL_DB,
  MAIL_BLOBS: w.r2,
  IMAP_MAILBOX: w.env.IMAP_MAILBOX,
});

criterion("FR-MAIL-042-c7", async () => {
  // Found by the provider's id, through the queue.
  const w = submitWorld();
  await w.ports().submit(input());
  w.pings.length = 0;
  const log: string[] = [];
  await sendingWorker({}).queue(
    {
      messages: [
        {
          body: {
            ...BOUNCED,
            payload: { ...BOUNCED.payload, messageId: "cf-a@x.example", recipient: "a@x.example" },
            metadata: { ...metadata, eventTimestamp: new Date().toISOString() },
          },
          ack: () => log.push("ack"),
          retry: () => log.push("retry"),
        },
      ],
    },
    bound(w),
  );
  expect(log).toEqual(["ack"]);
  expect(notices(w)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
  expect(w.pings).toEqual([`name:${MAILBOX}`]);

  // Found by the visible id, with no detail to quote.
  const byId = submitWorld();
  await byId.ports().submit(input());
  const visible = { ...BOUNCE, messageId: "v1@rafters.studio", providerId: null, detail: null };
  await hearing(visible).fetch(post(), bound(byId));
  expect(notices(byId)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);

  // The address since moved: the mailbox in the submissions row is told.
  const moved = submitWorld();
  await moved.ports().submit(input());
  moved.db.exec("UPDATE addresses SET mailbox = 'mbx-other'");
  await hearing(BOUNCE).fetch(post(), bound(moved));
  expect(notices(moved)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
});

criterion("FR-MAIL-042-c8", async () => {
  const w = submitWorld();
  w.db
    .prepare(
      "INSERT INTO sends (message_id, recipient, mail_from, provider, state, provider_id, updated_at) VALUES ('app@x.example', 'a@x.example', ?, 'cloudflare', 'accepted', 'cf-other', ?)",
    )
    .run(USER, new Date().toISOString());
  const byProvider = { ...BOUNCE, providerId: "cf-other" };
  const byOwnId = { ...BOUNCE, eventId: "e2", providerId: null, messageId: "app@x.example" };
  await hearing(byProvider, byOwnId).fetch(post(), bound(w));
  await w.ports().submit(input());
  await hearing({ ...BOUNCE, eventId: "e3", kind: "delayed" }).fetch(post(), bound(w));
  expect(notices(w)).toEqual([]);
});

criterion("FR-MAIL-042-c9", async () => {
  const w = submitWorld();
  w.swap.reach = () => ({});
  await w.ports().submit(input({ to: ["a@x.example", "b@x.example"] }));
  await hearing(BOUNCE).fetch(post(), bound(w));
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });
  await hearing(BOUNCE).fetch(post(), bound(w));
  vi.useRealTimers();
  expect(await w.uids(MAILBOX)).toBe(1);

  const two = submitWorld();
  two.swap.reach = () => ({});
  await two.ports().submit(input({ to: ["a@x.example", "b@x.example"] }));
  const second = { ...BOUNCE, recipient: "b@x.example", providerId: "cf-b@x.example" };
  await hearing(BOUNCE, second).fetch(post(), bound(two));
  expect(await two.uids(MAILBOX)).toBe(2);
});

criterion("FR-MAIL-042-c10", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const w = submitWorld();
  const untraced = { ...BOUNCE, providerId: "cf-none" };
  await expect(hearing(untraced).fetch(post(), bound(w))).rejects.toThrow("no send");
  expect(logged).not.toHaveBeenCalled();

  const older = { ...untraced, eventId: "e2", at: new Date(Date.now() - 3_600_000) };
  expect((await hearing(older).fetch(post(), bound(w))).status).toBe(200);
  expect(logged).toHaveBeenCalledOnce();
  logged.mockRestore();

  const failing = submitWorld();
  await failing.ports().submit(input());
  const env = {
    ...bound(failing),
    MAIL_BLOBS: {
      put: async () => {
        throw new Error("put");
      },
    },
  };
  await expect(hearing(BOUNCE).fetch(post(), env)).rejects.toThrow("put");
});

criterion("FR-MAIL-042-c11", async () => {
  const w = submitWorld();
  await w.ports().submit(input());
  const { MAIL_DB, MAIL_BLOBS, IMAP_MAILBOX } = bound(w);
  for (const env of [{ MAIL_DB }, { MAIL_DB, MAIL_BLOBS }, { MAIL_DB, IMAP_MAILBOX }]) {
    expect((await hearing(BOUNCE).fetch(post(), env)).status).toBe(200);
  }
  expect(w.rows("SELECT event_id FROM send_events")).toEqual([{ event_id: "e1" }]);
  expect(notices(w)).toEqual([]);
});
