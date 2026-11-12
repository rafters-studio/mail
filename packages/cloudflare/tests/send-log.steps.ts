// The send log on node:sqlite: claim, settle, the release statement and the history (FR-MAIL-031).
import type { Outcome, SendEvent } from "@rafters/mail/send";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import { d1Events, d1History, d1Sends } from "../src/index.ts";
import { sendingDb } from "./sqlite.ts";

const ID = "m1@x.example";
const AT = new Date("2026-11-02T12:00:00Z");
const LATER = new Date("2026-11-02T13:00:00Z");
const claimOf = (recipient: string, provider = "resend") => ({
  messageId: ID,
  mailFrom: "me@x.example",
  provider,
  recipient,
  at: AT,
});
const accepted = (recipient: string, providerId: string | null = null): Outcome => ({
  recipient,
  kind: "accepted",
  providerId,
  text: "250 ok",
});
const refused = (recipient: string, final: boolean): Outcome => ({
  recipient,
  kind: "refused",
  final,
  stage: "rcpt",
  code: final ? 550 : 451,
  text: "no",
});
// Form 01a19d25, The way out of a held row: the statement an operator runs.
const RELEASE = `UPDATE sends SET state = 'refused', final = 0, stage = 'provider', code = NULL,
  text = 'released by hand', updated_at = ?
WHERE message_id = ? AND recipient = ?`;

const event = (over: Partial<SendEvent>): SendEvent => ({
  provider: "resend",
  eventId: "e",
  kind: "delivered",
  recipient: "a@x.example",
  at: AT,
  messageId: null,
  providerId: null,
  permanent: null,
  smtp: null,
  detail: null,
  ...over,
});

type Db = ReturnType<typeof sendingDb>;

const FR031 = await feature("FR-MAIL-031");

describeFeature(
  FR031,
  ({ Scenario }) => {
    Scenario(
      "claim takes a new row and a refused row not final, and holds the others",
      ({ Given, When, Then }) => {
        let sends: ReturnType<typeof d1Sends>;
        let claimed: boolean[];

        Given(
          "no row, then rows unknown, accepted, finally refused and refused not final, on node:sqlite",
          async () => {
            const { d1 } = sendingDb();
            sends = d1Sends(d1);
            const { claim, settle } = sends;
            await claim(claimOf("taken@x.example"));
            await settle(ID, accepted("taken@x.example"), LATER);
            await claim(claimOf("final@x.example"));
            await settle(ID, refused("final@x.example", true), LATER);
            await claim(claimOf("again@x.example"));
            await settle(ID, refused("again@x.example", false), LATER);
          },
        );

        When("claim runs on each", async () => {
          const { claim } = sends;
          claimed = [];
          claimed.push(await claim(claimOf("new@x.example")));
          // That row is now unknown.
          claimed.push(await claim(claimOf("new@x.example")));
          claimed.push(await claim(claimOf("taken@x.example")));
          claimed.push(await claim(claimOf("final@x.example")));
          claimed.push(await claim(claimOf("again@x.example")));
        });

        Then("it returns true, false, false, false, true", () => {
          expect(claimed[0]).toBe(true);
          expect(claimed[1]).toBe(false);
          expect(claimed[2]).toBe(false);
          expect(claimed[3]).toBe(false);
          expect(claimed[4]).toBe(true);
        });
      },
    );

    Scenario(
      "A re-claim clears the earlier refusal and takes the new provider",
      ({ Given, When, Then }) => {
        let db: Db;

        Given("a row refused not final through one provider", async () => {
          db = sendingDb();
          const { claim, settle } = d1Sends(db.d1);
          await claim(claimOf("a@x.example", "resend"));
          await settle(ID, refused("a@x.example", false), LATER);
        });

        When("claim runs through another", async () => {
          await d1Sends(db.d1).claim(claimOf("a@x.example", "cloudflare"));
        });

        Then(
          "the row is unknown with that provider, and its final, stage, code and text are null",
          () => {
            expect(db.rows("sends")).toMatchObject([
              {
                provider: "cloudflare",
                state: "unknown",
                final: null,
                stage: null,
                code: null,
                text: null,
              },
            ]);
          },
        );
      },
    );

    Scenario("The migration refuses rows the form forbids", ({ Given, When, Then }) => {
      let insert: (recipient: string, final: number | null, stage: string | null) => unknown;

      Given(
        "a refused row with no final, a refused row with no stage, and a stage outside the list",
        () => {
          const { db } = sendingDb();
          insert = (recipient, final, stage) =>
            db
              .prepare(
                "INSERT INTO sends (message_id, recipient, mail_from, provider, state, final, stage, updated_at) VALUES ('m', ?, 'f', 'p', 'refused', ?, ?, 'now')",
              )
              .run(recipient, final, stage);
        },
      );

      When("each is written", () => {
        // insert runs inside the Then, wrapped by its expect.
      });

      Then("each fails a CHECK", () => {
        expect(() => insert("no-final", null, "rcpt")).toThrow(/CHECK/);
        expect(() => insert("no-stage", 0, null)).toThrow(/CHECK/);
        expect(() => insert("bad-stage", 0, "elsewhere")).toThrow(/CHECK/);
      });
    });

    Scenario("settle writes each kind", ({ Given, When, Then }) => {
      let db: Db;

      Given("an unknown row", async () => {
        db = sendingDb();
        const { claim } = d1Sends(db.d1);
        await claim(claimOf("a@x.example"));
        await claim(claimOf("b@x.example"));
        await claim(claimOf("c@x.example"));
      });

      When("settle runs with accepted, refused and unknown outcomes", async () => {
        const { settle } = d1Sends(db.d1);
        await settle(ID, accepted("a@x.example", "p1"), LATER);
        await settle(ID, refused("b@x.example", true), LATER);
        await settle(ID, { recipient: "c@x.example", kind: "unknown", detail: "lost" }, LATER);
      });

      Then(
        "the columns match each, and unknown leaves the state and writes detail to text",
        async () => {
          const updated_at = LATER.toISOString();
          expect(db.rows("sends")).toMatchObject([
            {
              state: "accepted",
              final: null,
              stage: null,
              text: "250 ok",
              provider_id: "p1",
              updated_at,
            },
            { state: "refused", final: 1, stage: "rcpt", code: 550, text: "no", updated_at },
            { state: "unknown", final: null, stage: null, text: "lost", updated_at },
          ]);
          expect((await d1History(db.d1)(ID)).outcomes[2]).toEqual({
            recipient: "c@x.example",
            kind: "unknown",
            detail: "lost",
          });
        },
      );
    });

    Scenario("A settle after a release changes nothing", ({ Given, When, Then }) => {
      let db: Db;

      Given("a row released, then claimed and settled accepted", async () => {
        db = sendingDb();
        const { claim, settle } = d1Sends(db.d1);
        await claim(claimOf("a@x.example"));
        db.db.prepare(RELEASE).run(LATER.toISOString(), ID, "a@x.example");
        await claim(claimOf("a@x.example"));
        await settle(ID, accepted("a@x.example"), LATER);
      });

      When("the old attempt settles refused", async () => {
        await d1Sends(db.d1).settle(ID, refused("a@x.example", true), LATER);
      });

      Then("the row stays accepted", () => {
        expect(db.rows("sends")).toMatchObject([{ state: "accepted" }]);
      });
    });

    Scenario("The release frees a row from any state", ({ Given, When, Then }) => {
      let db: Db;
      let claimed: boolean[];
      let released: unknown[];
      const recipients = ["unknown@x.example", "accepted@x.example", "final@x.example"];

      Given("rows unknown, accepted and finally refused", async () => {
        db = sendingDb();
        const { claim, settle } = d1Sends(db.d1);
        await claim(claimOf("unknown@x.example"));
        await claim(claimOf("accepted@x.example"));
        await settle(ID, accepted("accepted@x.example"), LATER);
        await claim(claimOf("final@x.example"));
        await settle(ID, refused("final@x.example", true), LATER);
      });

      When("the form's release statement runs, then claim", async () => {
        for (const recipient of recipients) {
          db.db.prepare(RELEASE).run(LATER.toISOString(), ID, recipient);
        }
        // The rows are read before claim runs, so the Then sees them released.
        released = db.rows("sends");
        claimed = [];
        for (const recipient of recipients)
          claimed.push(await d1Sends(db.d1).claim(claimOf(recipient)));
      });

      Then(
        "each is refused not final with the text released by hand, and each claim returns true",
        () => {
          const row = { state: "refused", final: 0, text: "released by hand" };
          expect(released).toMatchObject([row, row, row]);
          for (const one of claimed) expect(one).toBe(true);
        },
      );
    });

    Scenario("A crash row reads as no answer recorded", ({ Given, When, Then }) => {
      let db: Db;
      let history: Awaited<ReturnType<ReturnType<typeof d1History>>>;

      Given("a row claimed and never settled", async () => {
        db = sendingDb();
        await d1Sends(db.d1).claim(claimOf("a@x.example"));
      });

      When("d1History runs", async () => {
        history = await d1History(db.d1)(ID);
      });

      Then("the outcome is unknown, with detail no answer recorded", () => {
        expect(history.outcomes).toEqual([
          { recipient: "a@x.example", kind: "unknown", detail: "no answer recorded" },
        ]);
      });
    });

    Scenario("History matches events by Message-ID and by provider id", ({ Given, When, Then }) => {
      let db: Db;
      let byProvider: SendEvent;
      let byId: SendEvent;
      let history: Awaited<ReturnType<ReturnType<typeof d1History>>>;

      Given(
        "one event with the message_id, one with the row's provider and provider_id, one for another message, on node:sqlite",
        async () => {
          db = sendingDb();
          const { claim, settle } = d1Sends(db.d1);
          await claim(claimOf("b@x.example"));
          await settle(ID, refused("b@x.example", true), LATER);
          await claim(claimOf("a@x.example"));
          await settle(ID, accepted("a@x.example", "p1"), LATER);

          byProvider = event({
            eventId: "by-provider",
            providerId: "p1",
            kind: "bounced",
            at: AT,
            permanent: true,
            smtp: { code: "550", enhanced: "5.1.1", text: "550 5.1.1 User unknown" },
            detail: "hard",
          });
          byId = event({ eventId: "by-id", messageId: ID, at: LATER });
          const { record } = d1Events(db.d1);
          await record(byId);
          await record(byProvider);
          await record(event({ eventId: "other", messageId: "other@x.example", providerId: "p2" }));
        },
      );

      When("d1History runs", async () => {
        history = await d1History(db.d1)(ID);
      });

      Then("it returns the first two, ordered by at, and outcomes ordered by recipient", () => {
        const { outcomes, events } = history;
        expect(events).toEqual([byProvider, byId]);
        expect(outcomes).toEqual([
          { recipient: "a@x.example", kind: "accepted", providerId: "p1", text: "250 ok" },
          {
            recipient: "b@x.example",
            kind: "refused",
            final: true,
            stage: "rcpt",
            code: 550,
            text: "no",
          },
        ]);
      });
    });

    Scenario("A row failing its schema throws", ({ Given, When, Then }) => {
      let db: Db;

      Given("an event row whose kind passes the table but whose at is not a date", () => {
        db = sendingDb();
        db.db
          .prepare(
            "INSERT INTO send_events (provider, event_id, recipient, kind, at, message_id) VALUES ('resend', 'e', 'a@x.example', 'delivered', 'not a date', ?)",
          )
          .run(ID);
      });

      When("d1History runs", () => {
        // d1History runs inside the Then, wrapped by its expect.
      });

      Then("it throws", async () => {
        await expect(d1History(db.d1)(ID)).rejects.toThrow();
      });
    });
  },
  owns(
    "FR-MAIL-031-c1",
    "FR-MAIL-031-c2",
    "FR-MAIL-031-c3",
    "FR-MAIL-031-c4",
    "FR-MAIL-031-c5",
    "FR-MAIL-031-c6",
    "FR-MAIL-031-c7",
    "FR-MAIL-031-c8",
    "FR-MAIL-031-c9",
  ),
);
