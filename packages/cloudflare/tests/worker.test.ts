// The Worker and its D1 and R2 ports on node:sqlite and a Map, against the worker goldens of
// reference 01a19a9e (FR-MAIL-017).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { criterion } from "../../core/tests/criterion.ts";
import {
  type CloudflareMessage,
  type D1Like,
  d1Deliveries,
  d1Directory,
  emailWorker,
} from "../src/index.ts";

const MIGRATION = readFileSync(
  new URL("../migrations/0001_receiving.sql", import.meta.url),
  "utf8",
);
const PLAIN = new Uint8Array(
  readFileSync(new URL("../../core/tests/fixtures/write/plain.expected.eml", import.meta.url)),
);
// The seed directory of reference 01a19a9e.
const SEED = `
INSERT INTO mailboxes (id) VALUES ('mbx-sean'), ('mbx-ops'), ('mbx-lists'), ('mbx-support');
INSERT INTO domains (name, postmaster, catch_all, masking) VALUES
  ('rafters.studio', 'mbx-ops', NULL, 1),
  ('xn--exempl-gva.fr', 'mbx-ops', 'mbx-sean', 0);
INSERT INTO addresses (local, domain, mailbox, enabled, mask_shown, mask_label, mask_created_at) VALUES
  ('sean', 'rafters.studio', 'mbx-sean', 1, NULL, NULL, NULL),
  ('silvius', 'rafters.studio', 'mbx-sean', 1, NULL, NULL, NULL),
  ('sean+lists', 'rafters.studio', 'mbx-lists', 1, NULL, NULL, NULL),
  ('support', 'rafters.studio', 'mbx-support', 1, NULL, NULL, NULL),
  ('quietotter4821', 'rafters.studio', 'mbx-sean', 0, 'quiet.otter.4821', 'bike shop', '2026-03-01T09:00:00.000Z');
`;
const BLOB = "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b";

/** The migration on node:sqlite with foreign keys on, as a D1Like, seeded unless told not to. */
function world(seed = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATION);
  if (seed) db.exec(SEED);
  const d1: D1Like = {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async () => {
          const row = db.prepare(sql).get(...values);
          return row === undefined ? null : { ...row };
        },
        run: async () => db.prepare(sql).run(...values),
      }),
    }),
  };
  const blobs = new Map<string, Uint8Array>();
  const env = {
    MAIL_DB: d1,
    MAIL_BLOBS: { put: async (k: string, b: Uint8Array) => blobs.set(k, b) },
  };
  const rows = () =>
    db
      .prepare("SELECT blob, mailbox, mail_from, rcpt_to, via FROM deliveries")
      .all()
      .map((row) => ({ ...row }));
  return { db, d1, blobs, env, rows };
}

/** A message as Email Routing hands it to the Worker, its raw a real ReadableStream. */
function message(from: string, to: string, rawSize = PLAIN.byteLength) {
  const rejects: string[] = [];
  const m: CloudflareMessage = {
    from,
    to,
    raw: new Blob([PLAIN]).stream(),
    rawSize,
    setReject: (reason) => void rejects.push(reason),
  };
  return { m, rejects };
}

criterion("FR-MAIL-017-c1", () => {
  expect(Object.keys(emailWorker())).toEqual(["email"]);
});

criterion("FR-MAIL-017-c2", async () => {
  const w = world();
  const { m, rejects } = message("mary@example.com", "sean@rafters.studio");
  await emailWorker().email(m, w.env);
  expect(rejects).toEqual([]);
  expect([...w.blobs.keys()]).toEqual([BLOB]);
  expect(w.blobs.get(BLOB)).toEqual(PLAIN);
  expect(w.rows()).toEqual([
    {
      blob: BLOB,
      mailbox: "mbx-sean",
      mail_from: "mary@example.com",
      rcpt_to: "sean@rafters.studio",
      via: "cloudflare",
    },
  ]);
});

criterion("FR-MAIL-017-c3", async () => {
  const w = world();
  const { m, rejects } = message("mary@example.com", "nobody@rafters.studio");
  await emailWorker().email(m, w.env);
  expect(rejects).toEqual(["No such user here"]);
  expect([...w.blobs.keys()]).toEqual([]);
  expect(w.rows()).toEqual([]);
});

criterion("FR-MAIL-017-c4", async () => {
  const w = world();
  const { m, rejects } = message("", "sean@rafters.studio");
  await emailWorker().email(m, w.env);
  expect(rejects).toEqual([]);
  expect([...w.blobs.keys()]).toEqual([BLOB]);
  expect(w.rows()).toEqual([
    {
      blob: BLOB,
      mailbox: "mbx-sean",
      mail_from: null,
      rcpt_to: "sean@rafters.studio",
      via: "cloudflare",
    },
  ]);
});

criterion("FR-MAIL-017-c5", async () => {
  const w = world();
  const { m } = message("mary@example.com", "sean@rafters.studio", PLAIN.byteLength + 1);
  await expect(emailWorker().email(m, w.env)).rejects.toThrow(
    "raw is 1522 bytes, rawSize says 1523",
  );
  expect([...w.blobs.keys()]).toEqual([]);
  expect(w.rows()).toEqual([]);
});

criterion("FR-MAIL-017-c6", () => {
  const { db } = world(false);
  db.exec("INSERT INTO mailboxes (id) VALUES ('mbx-sean');");
  expect(() => db.exec("INSERT INTO domains (name) VALUES ('rafters.studio');")).toThrow();
  db.exec("INSERT INTO domains (name, postmaster) VALUES ('rafters.studio', 'mbx-sean');");
  expect(() =>
    db.exec(
      "INSERT INTO addresses (local, domain, mailbox, mask_shown, mask_created_at) VALUES ('quietotter4821', 'rafters.studio', 'mbx-sean', 'quiet.otter.4821', '2026-03-01T09:00:00.000Z');",
    ),
  ).toThrow();
});

criterion("FR-MAIL-017-c7", async () => {
  const w = world();
  const directory = d1Directory(w.d1);
  expect(await directory.domain("rafters.studio")).toMatchObject({ masking: true });
  expect(await directory.address("quietotter4821", "rafters.studio")).toEqual({
    local: "quietotter4821",
    domain: "rafters.studio",
    mailbox: "mbx-sean",
    enabled: false,
    mask: {
      shown: "quiet.otter.4821",
      label: "bike shop",
      createdAt: new Date("2026-03-01T09:00:00Z"),
    },
  });
  w.db.exec(
    "INSERT INTO addresses (local, domain, mailbox, mask_shown, mask_label, mask_created_at) VALUES ('bad', 'rafters.studio', 'mbx-sean', 'b.a.d', 'x', 'not a date');",
  );
  await expect(directory.address("bad", "rafters.studio")).rejects.toMatchObject({
    name: "ZodError",
  });
});

criterion("FR-MAIL-017-c8", async () => {
  const w = world();
  const deliveries = d1Deliveries(w.d1);
  const row = {
    blob: BLOB,
    mailbox: "mbx-sean",
    mailFrom: "mary@example.com",
    rcptTo: "sean@rafters.studio",
    receivedAt: new Date("2026-03-02T17:00:00Z"),
    via: "cloudflare",
  };
  await deliveries.record({ ...row, id: "019cafbf-c600-7001-8203-040506070809" });
  await deliveries.record({ ...row, id: "019cafbf-c600-7a0b-8c0d-0e0f10111213" });
  expect(w.rows()).toHaveLength(1);
});
