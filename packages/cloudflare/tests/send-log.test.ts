// The send log on node:sqlite: claim, settle, the release statement and the history (FR-MAIL-031).
import type { Outcome, SendEvent } from "@rafters/mail/send";
import { expect } from "vite-plus/test";
import { criterion } from "../../core/tests/criterion.ts";
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

criterion("FR-MAIL-031-c1", async () => {
  const { d1 } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  expect(await claim(claimOf("new@x.example"))).toBe(true);
  // That row is now unknown.
  expect(await claim(claimOf("new@x.example"))).toBe(false);
  await claim(claimOf("taken@x.example"));
  await settle(ID, accepted("taken@x.example"), LATER);
  expect(await claim(claimOf("taken@x.example"))).toBe(false);
  await claim(claimOf("final@x.example"));
  await settle(ID, refused("final@x.example", true), LATER);
  expect(await claim(claimOf("final@x.example"))).toBe(false);
  await claim(claimOf("again@x.example"));
  await settle(ID, refused("again@x.example", false), LATER);
  expect(await claim(claimOf("again@x.example"))).toBe(true);
});

criterion("FR-MAIL-031-c2", async () => {
  const { d1, rows } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  await claim(claimOf("a@x.example", "resend"));
  await settle(ID, refused("a@x.example", false), LATER);
  await claim(claimOf("a@x.example", "cloudflare"));
  expect(rows("sends")).toMatchObject([
    {
      provider: "cloudflare",
      state: "unknown",
      final: null,
      stage: null,
      code: null,
      text: null,
    },
  ]);
});

criterion("FR-MAIL-031-c3", () => {
  const { db } = sendingDb();
  const insert = (recipient: string, final: number | null, stage: string | null) =>
    db
      .prepare(
        "INSERT INTO sends (message_id, recipient, mail_from, provider, state, final, stage, updated_at) VALUES ('m', ?, 'f', 'p', 'refused', ?, ?, 'now')",
      )
      .run(recipient, final, stage);
  expect(() => insert("no-final", null, "rcpt")).toThrow(/CHECK/);
  expect(() => insert("no-stage", 0, null)).toThrow(/CHECK/);
  expect(() => insert("bad-stage", 0, "elsewhere")).toThrow(/CHECK/);
});

criterion("FR-MAIL-031-c4", async () => {
  const { d1, rows } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  await claim(claimOf("a@x.example"));
  await settle(ID, accepted("a@x.example", "p1"), LATER);
  await claim(claimOf("b@x.example"));
  await settle(ID, refused("b@x.example", true), LATER);
  await claim(claimOf("c@x.example"));
  await settle(ID, { recipient: "c@x.example", kind: "unknown", detail: "lost" }, LATER);
  const updated_at = LATER.toISOString();
  expect(rows("sends")).toMatchObject([
    { state: "accepted", final: null, stage: null, text: "250 ok", provider_id: "p1", updated_at },
    { state: "refused", final: 1, stage: "rcpt", code: 550, text: "no", updated_at },
    { state: "unknown", final: null, stage: null, text: "lost", updated_at },
  ]);
  expect((await d1History(d1)(ID)).outcomes[2]).toEqual({
    recipient: "c@x.example",
    kind: "unknown",
    detail: "lost",
  });
});

criterion("FR-MAIL-031-c5", async () => {
  const { db, d1, rows } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  await claim(claimOf("a@x.example"));
  db.prepare(RELEASE).run(LATER.toISOString(), ID, "a@x.example");
  await claim(claimOf("a@x.example"));
  await settle(ID, accepted("a@x.example"), LATER);
  await settle(ID, refused("a@x.example", true), LATER);
  expect(rows("sends")).toMatchObject([{ state: "accepted" }]);
});

criterion("FR-MAIL-031-c6", async () => {
  const { db, d1, rows } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  await claim(claimOf("unknown@x.example"));
  await claim(claimOf("accepted@x.example"));
  await settle(ID, accepted("accepted@x.example"), LATER);
  await claim(claimOf("final@x.example"));
  await settle(ID, refused("final@x.example", true), LATER);
  const recipients = ["unknown@x.example", "accepted@x.example", "final@x.example"];
  for (const recipient of recipients) {
    db.prepare(RELEASE).run(LATER.toISOString(), ID, recipient);
  }
  const released = { state: "refused", final: 0, text: "released by hand" };
  expect(rows("sends")).toMatchObject([released, released, released]);
  for (const recipient of recipients) expect(await claim(claimOf(recipient))).toBe(true);
});

criterion("FR-MAIL-031-c7", async () => {
  const { d1 } = sendingDb();
  await d1Sends(d1).claim(claimOf("a@x.example"));
  expect((await d1History(d1)(ID)).outcomes).toEqual([
    { recipient: "a@x.example", kind: "unknown", detail: "no answer recorded" },
  ]);
});

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

criterion("FR-MAIL-031-c8", async () => {
  const { d1 } = sendingDb();
  const { claim, settle } = d1Sends(d1);
  await claim(claimOf("b@x.example"));
  await settle(ID, refused("b@x.example", true), LATER);
  await claim(claimOf("a@x.example"));
  await settle(ID, accepted("a@x.example", "p1"), LATER);

  const byProvider = event({
    eventId: "by-provider",
    providerId: "p1",
    kind: "bounced",
    at: AT,
    permanent: true,
    smtp: { code: "550", enhanced: "5.1.1", text: "550 5.1.1 User unknown" },
    detail: "hard",
  });
  const byId = event({ eventId: "by-id", messageId: ID, at: LATER });
  const { record } = d1Events(d1);
  await record(byId);
  await record(byProvider);
  await record(event({ eventId: "other", messageId: "other@x.example", providerId: "p2" }));

  const { outcomes, events } = await d1History(d1)(ID);
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

criterion("FR-MAIL-031-c9", async () => {
  const { db, d1 } = sendingDb();
  db.prepare(
    "INSERT INTO send_events (provider, event_id, recipient, kind, at, message_id) VALUES ('resend', 'e', 'a@x.example', 'delivered', 'not a date', ?)",
  ).run(ID);
  await expect(d1History(d1)(ID)).rejects.toThrow();
});
