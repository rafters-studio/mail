// The Worker that hears, and Cloudflare's six documented events, verbatim
// (developers.cloudflare.com/email-service/platform/event-subscriptions, 2026-11-02) (FR-MAIL-030).
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vite-plus/test";
import { ZodError } from "zod";
import { feature, owns } from "../../core/tests/feature.ts";
import type { SendEvent } from "../../core/src/send/index.ts";
import { d1Events, type D1Like, fromCloudflare, sendingWorker } from "../src/index.ts";
import { MAILBOX, USER } from "./imap-world.ts";
import { clock } from "./clock.ts";
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

const common = (payload: { eventId: string; messageId: string; recipient: string }) => ({
  provider: "cloudflare",
  eventId: payload.eventId,
  providerId: payload.messageId,
  recipient: payload.recipient,
  at: AT,
  messageId: null,
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
const hearing = (...events: SendEvent[]) =>
  sendingWorker({ resend: async () => events }, { now: () => clock.now() });
/** The Worker's bindings, as the sending example binds them to the mailbox and blobs. */
const bound = (w: ReturnType<typeof submitWorld>) => ({
  MAIL_DB: w.env.MAIL_DB,
  MAIL_BLOBS: w.r2,
  IMAP_MAILBOX: w.env.IMAP_MAILBOX,
});

type World = ReturnType<typeof submitWorld>;
type Db = ReturnType<typeof sendingDb>;
type Worker = ReturnType<typeof sendingWorker>;

const FR030 = await feature("FR-MAIL-030");
const FR042 = await feature("FR-MAIL-042");

describeFeature(
  FR030,
  ({ Scenario }) => {
    Scenario("The Worker has fetch and queue alone", ({ Given, When, Then }) => {
      let worker: Worker;
      let keys: string[];

      Given("sendingWorker's result", () => {
        worker = sendingWorker({});
      });

      When("its keys are read", () => {
        keys = Object.keys(worker).sort();
      });

      Then("they are exactly fetch and queue", () => {
        expect(keys).toEqual(["fetch", "queue"]);
      });
    });

    Scenario("An authentic webhook is recorded and answered 200", ({ Given, When, Then }) => {
      let db: Db;
      let worker: Worker;
      let answer: Response;

      Given("a handler returning two events", () => {
        db = sendingDb();
        const two = [EVENT, { ...EVENT, recipient: "b@x.example" }];
        worker = sendingWorker({ resend: async () => two });
      });

      When("POST /webhooks/resend arrives", async () => {
        answer = await worker.fetch(post(), { MAIL_DB: db.d1 });
      });

      Then("both are recorded, and the answer is 200", () => {
        expect(answer.status).toBe(200);
        expect(db.rows("send_events")).toHaveLength(2);
      });
    });

    Scenario("A request not authentic is 401, recording nothing", ({ Given, When, Then }) => {
      let db: Db;
      let worker: Worker;

      Given("a handler returning null", () => {
        db = sendingDb();
        worker = sendingWorker({ resend: async () => null });
      });

      When("POST /webhooks/resend arrives", () => {
        // fetch runs inside the Then, wrapped by its expect.
      });

      Then("the answer is 401, and no row was written", async () => {
        expect((await worker.fetch(post(), { MAIL_DB: db.d1 })).status).toBe(401);
        expect(db.rows("send_events")).toEqual([]);
      });
    });

    Scenario("Any other request is 404", ({ Given, When, Then }) => {
      let worker: Worker;
      let env: { MAIL_DB: Db["d1"] };
      let requests: Request[];

      Given("a key not registered, the key constructor, a GET and another path", () => {
        const { d1 } = sendingDb();
        worker = sendingWorker({ resend: async () => [] });
        env = { MAIL_DB: d1 };
        requests = [
          post("/webhooks/other"),
          post("/webhooks/constructor"),
          post("/webhooks/resend", "GET"),
          post("/resend"),
        ];
      });

      When("fetch runs", () => {
        // fetch runs inside the Then, wrapped by its expect.
      });

      Then("each answers 404", async () => {
        for (const request of requests) {
          expect((await worker.fetch(request, env)).status).toBe(404);
        }
      });
    });

    Scenario("A failure reaches the provider", ({ Given, When, Then }) => {
      let d1: Db["d1"];
      let throwing: Worker;
      let broken: D1Like;
      let worker: Worker;

      Given("a handler or port that throws", () => {
        ({ d1 } = sendingDb());
        throwing = sendingWorker({
          resend: async () => {
            throw new Error("handler");
          },
        });
        broken = {
          prepare: () => {
            throw new Error("port");
          },
        };
        worker = sendingWorker({ resend: async () => [EVENT] });
      });

      When("fetch runs", () => {
        // fetch runs inside the Then, wrapped by its expect.
      });

      Then("it throws", async () => {
        await expect(throwing.fetch(post(), { MAIL_DB: d1 })).rejects.toThrow("handler");
        await expect(worker.fetch(post(), { MAIL_DB: broken })).rejects.toThrow("port");
      });
    });

    Scenario("A queue retries only what failed", ({ Given, When, Then }) => {
      let db: Db;
      const log: string[] = [];
      const message = (name: string, body: unknown) => ({
        body,
        ack: () => log.push(`${name} ack`),
        retry: () => log.push(`${name} retry`),
      });
      let messages: ReturnType<typeof message>[];

      Given("a batch of a good event, an untracked type and a malformed event", () => {
        db = sendingDb();
        messages = [
          message("good", DELIVERED),
          message("untracked", { type: "cf.email.sending.message.opened" }),
          message("malformed", { type: BOUNCED.type }),
        ];
      });

      When("queue runs", async () => {
        await sendingWorker({}).queue({ messages }, { MAIL_DB: db.d1 });
      });

      Then(
        "the first is recorded and acked, the second acked with nothing recorded, and only the third retried",
        () => {
          expect(log).toEqual(["good ack", "untracked ack", "malformed retry"]);
          expect(db.rows("send_events")).toHaveLength(1);
        },
      );
    });

    Scenario("Cloudflare's six documented events map exactly", ({ Given, When, Then }) => {
      const examples = () =>
        [
          [DELIVERED, "delivered", null, null],
          [DEFERRED, "delayed", false, "temporary_failure: 451 4.2.0 Temporary mailbox error"],
          [BOUNCED, "bounced", true, "permanent_failure: 550 5.1.1 User unknown"],
          [FAILED, "failed", null, "delivery_failed"],
          [REJECTED, "failed", null, "recipient: suppressed"],
          [COMPLAINED, "complained", null, "abuse"],
        ] as const;
      let expected: ReturnType<typeof examples>;

      Given(
        "the documented delivered, deferred, bounced, failed, rejected and complained examples, verbatim",
        () => {
          expected = examples();
        },
      );

      When("fromCloudflare runs", () => {
        // fromCloudflare runs inside the Then, wrapped by its expect.
      });

      Then(
        "each has the form's kind, eventId, providerId, recipient, at, permanent and detail, and messageId null",
        () => {
          for (const [sample, kind, permanent, detail] of expected) {
            expect(fromCloudflare(sample)).toMatchObject({
              ...common(sample.payload),
              kind,
              permanent,
              detail,
            });
          }
        },
      );
    });

    Scenario("smtp is null where Cloudflare gives none", ({ Given, When, Then }) => {
      Given("the failed, rejected and complained examples", () => {
        // FAILED, REJECTED and COMPLAINED are the documented examples, at file scope.
      });

      When("fromCloudflare runs", () => {
        // fromCloudflare runs inside the Then, wrapped by its expect.
      });

      Then("smtp is null, and it is the three fields on the others", () => {
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
    });

    Scenario(
      "A type not tracked returns null, and a malformed event throws",
      ({ Given, When, Then }) => {
        Given(
          "another type, the type cf.email.sending.message.constructor, and a bounced event with no payload",
          () => {
            // Each is built inside the Then, as fromCloudflare's argument.
          },
        );

        When("fromCloudflare runs", () => {
          // fromCloudflare runs inside the Then, wrapped by its expect.
        });

        Then("the first two return null, and the third throws a ZodError", () => {
          expect(
            fromCloudflare({ ...DELIVERED, type: "cf.email.sending.message.opened" }),
          ).toBeNull();
          expect(
            fromCloudflare({ ...DELIVERED, type: "cf.email.sending.message.constructor" }),
          ).toBeNull();
          expect(() => fromCloudflare({ type: BOUNCED.type, metadata })).toThrow(ZodError);
        });
      },
    );

    Scenario("A redelivered event adds no row", ({ Given, When, Then }) => {
      let db: Db;
      let record: ReturnType<typeof d1Events>["record"];

      Given("an event recorded once", async () => {
        db = sendingDb();
        ({ record } = d1Events(db.d1));
        await record(EVENT);
      });

      When("it is recorded again", async () => {
        await record(EVENT);
      });

      Then("there is one row", () => {
        expect(db.rows("send_events")).toHaveLength(1);
      });
    });
  },
  owns(
    "FR-MAIL-030-c1",
    "FR-MAIL-030-c2",
    "FR-MAIL-030-c3",
    "FR-MAIL-030-c4",
    "FR-MAIL-030-c5",
    "FR-MAIL-030-c6",
    "FR-MAIL-030-c7",
    "FR-MAIL-030-c8",
    "FR-MAIL-030-c9",
    "FR-MAIL-030-c10",
  ),
);

describeFeature(
  FR042,
  ({ Scenario, AfterEachScenario }) => {
    AfterEachScenario(() => {
      clock.reset();
    });

    Scenario("A later bounce tells the mailbox that sent it", ({ Given, When, Then }) => {
      let w: World;
      let byId: World;
      let moved: World;
      let visible: SendEvent;
      const log: string[] = [];

      Given(
        "a bounced event found by provider_id, one found by visible id, and an address since moved to another mailbox",
        async () => {
          // Found by the provider's id, through the queue.
          w = submitWorld();
          await w.ports().submit(input());
          w.pings.length = 0;

          // Found by the visible id, with no detail to quote.
          byId = submitWorld();
          await byId.ports().submit(input());
          visible = { ...BOUNCE, messageId: "v1@rafters.studio", providerId: null, detail: null };
          // The same mailbox using its id again is still one person.
          await byId.ports().submit(input({ holdKey: "h2@hold.invalid", to: ["b@x.example"] }));

          // The address since moved: the mailbox in the submissions row is told.
          moved = submitWorld();
          await moved.ports().submit(input());
          moved.db.exec("UPDATE addresses SET mailbox = 'mbx-other'");
        },
      );

      When("the worker handles it", async () => {
        await sendingWorker({}).queue(
          {
            messages: [
              {
                body: {
                  ...BOUNCED,
                  payload: {
                    ...BOUNCED.payload,
                    messageId: "cf-a@x.example",
                    recipient: "a@x.example",
                  },
                  metadata: { ...metadata, eventTimestamp: new Date().toISOString() },
                },
                ack: () => log.push("ack"),
                retry: () => log.push("retry"),
              },
            ],
          },
          bound(w),
        );
        await hearing(visible).fetch(post(), bound(byId));
        await hearing(BOUNCE).fetch(post(), bound(moved));
      });

      Then("a notice reaches the mailbox in the submissions row each time", () => {
        expect(log).toEqual(["ack"]);
        expect(notices(w)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
        expect(w.pings).toEqual([`name:${MAILBOX}`]);
        expect(notices(byId)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
        expect(notices(moved)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
      });
    });

    Scenario("Mail not from an app tells nobody", ({ Given, When, Then }) => {
      let w: World;

      Given("a sends row with no submissions row, and a delayed event", () => {
        w = submitWorld();
        w.db
          .prepare(
            "INSERT INTO sends (message_id, recipient, mail_from, provider, state, provider_id, updated_at) VALUES ('app@x.example', 'a@x.example', ?, 'cloudflare', 'accepted', 'cf-other', ?)",
          )
          .run(USER, new Date().toISOString());
      });

      When("the worker handles it", async () => {
        const byProvider = { ...BOUNCE, providerId: "cf-other" };
        const byOwnId = { ...BOUNCE, eventId: "e2", providerId: null, messageId: "app@x.example" };
        await hearing(byProvider, byOwnId).fetch(post(), bound(w));
        await w.ports().submit(input());
        await hearing({ ...BOUNCE, eventId: "e3", kind: "delayed" }).fetch(post(), bound(w));
      });

      Then("no notice is delivered", async () => {
        expect(notices(w)).toEqual([]);

        // A visible id two mailboxes used tells neither, and says so.
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        const shared = submitWorld();
        await shared.ports().submit(input());
        await shared
          .ports()
          .submit(input({ mailbox: "mbx-other", holdKey: "h2@hold.invalid", to: ["b@x.example"] }));
        const visible = {
          ...BOUNCE,
          eventId: "e4",
          messageId: "v1@rafters.studio",
          providerId: null,
        };
        await hearing(visible).fetch(post(), bound(shared));
        expect(notices(shared)).toEqual([]);
        expect(logged).toHaveBeenCalledOnce();
        logged.mockRestore();

        // The provider's own id still names one send, so it is told.
        await hearing({ ...BOUNCE, eventId: "e5" }).fetch(post(), bound(shared));
        expect(notices(shared)).toEqual([{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }]);
      });
    });

    Scenario(
      "A repeated event adds no message, and each recipient is told",
      ({ Given, When, Then }) => {
        let w: World;
        let two: World;

        Given("an event delivered twice, and one event listing two recipients", async () => {
          w = submitWorld();
          w.swap.reach = () => ({});
          await w.ports().submit(input({ to: ["a@x.example", "b@x.example"] }));
          two = submitWorld();
          two.swap.reach = () => ({});
          await two.ports().submit(input({ to: ["a@x.example", "b@x.example"] }));
        });

        When("the worker handles it and the mailbox pulls", async () => {
          await hearing(BOUNCE).fetch(post(), bound(w));
          clock.advance(1000);
          await hearing(BOUNCE).fetch(post(), bound(w));
          clock.reset();
          const second = { ...BOUNCE, recipient: "b@x.example", providerId: "cf-b@x.example" };
          await hearing(BOUNCE, second).fetch(post(), bound(two));
        });

        Then("the first adds one UID and the second two", async () => {
          expect(await w.uids(MAILBOX)).toBe(1);
          expect(await two.uids(MAILBOX)).toBe(2);
        });
      },
    );

    Scenario("An untraced event is retried, then logged", ({ Given, When, Then }) => {
      let w: World;
      let untraced: SendEvent;
      let older: SendEvent;
      const failingEnv = (failing: World) => ({
        ...bound(failing),
        MAIL_BLOBS: {
          put: async () => {
            throw new Error("put");
          },
        },
      });
      let env: ReturnType<typeof failingEnv>;

      Given(
        "an event with no row, younger and older than an hour, and a notice that fails",
        async () => {
          clock.set(BOUNCE.at.getTime());
          w = submitWorld();
          untraced = { ...BOUNCE, providerId: "cf-none" };
          older = { ...untraced, eventId: "e2", at: new Date(BOUNCE.at.getTime() - 3_600_001) };
          const failing = submitWorld();
          await failing.ports().submit(input());
          env = failingEnv(failing);
        },
      );

      When("the worker handles it", () => {
        // Each fetch runs inside the Then, wrapped by its expect, beside the console spy it is read by.
      });

      Then("the younger throws, the older is logged, and the failed notice throws", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(hearing(untraced).fetch(post(), bound(w))).rejects.toThrow("no send");
        expect(logged).not.toHaveBeenCalled();

        expect((await hearing(older).fetch(post(), bound(w))).status).toBe(200);
        expect(logged).toHaveBeenCalledOnce();
        logged.mockRestore();

        await expect(hearing(BOUNCE).fetch(post(), env)).rejects.toThrow("put");
      });
    });

    Scenario("A later bounce needs its bindings", ({ Given, When, Then }) => {
      const without = ({ MAIL_DB, MAIL_BLOBS, IMAP_MAILBOX }: ReturnType<typeof bound>) => [
        { MAIL_DB },
        { MAIL_DB, MAIL_BLOBS },
        { MAIL_DB, IMAP_MAILBOX },
      ];
      let w: World;
      let envs: ReturnType<typeof without>;

      Given("a worker without MAIL_BLOBS or IMAP_MAILBOX", async () => {
        w = submitWorld();
        await w.ports().submit(input());
        envs = without(bound(w));
      });

      When("it handles an event", () => {
        // Each fetch runs inside the Then, wrapped by its expect.
      });

      Then("it records as today and tells nobody", async () => {
        for (const env of envs) {
          expect((await hearing(BOUNCE).fetch(post(), env)).status).toBe(200);
        }
        expect(w.rows("SELECT event_id FROM send_events")).toEqual([{ event_id: "e1" }]);
        expect(notices(w)).toEqual([]);
      });
    });
  },
  owns("FR-MAIL-042-c7", "FR-MAIL-042-c8", "FR-MAIL-042-c9", "FR-MAIL-042-c10", "FR-MAIL-042-c11"),
);
