import { expect } from "vitest";
import {
  canonicalLocal,
  createReceiver,
  domainName,
  domainSchema,
  findMailbox,
  recipient,
} from "../src/receive/index.ts";
import { criterion } from "./criterion.ts";
import { now } from "./env.ts";
import {
  golden,
  goldens,
  memoryDirectory,
  memoryStore,
  plain,
  seedDirectory,
} from "./fixtures/receive.ts";

/** The plain golden received on the seed directory for one envelope recipient. */
function receiveFor(to: string) {
  const store = memoryStore();
  const receive = createReceiver({ directory: seedDirectory(), ...store.ports });
  const envelope = { mailFrom: "mary@example.com", rcptTo: [to] };
  return { store, verdict: receive({ envelope, raw: plain, receivedAt: now(), via: "toy" }) };
}

criterion("FR-MAIL-016-c1", async () => {
  expect(await golden("case-and-dots")).toEqual(goldens["case-and-dots"]);
});

criterion("FR-MAIL-016-c2", async () => {
  expect(await golden("tag-own-address")).toEqual(goldens["tag-own-address"]);
});

criterion("FR-MAIL-016-c3", async () => {
  expect(await golden("tag-falls-back")).toEqual(goldens["tag-falls-back"]);
  expect(recipient("se.an+receipts.2026@rafters.studio").tag).toBe("receipts.2026");
});

criterion("FR-MAIL-016-c4", async () => {
  expect(await golden("postmaster")).toEqual(goldens.postmaster);
});

criterion("FR-MAIL-016-c5", async () => {
  expect(await golden("catch-all-idn")).toEqual(goldens["catch-all-idn"]);
  expect(["exemplé.fr", "EXEMPLÉ.FR", "xn--exempl-gva.fr"].map(domainName)).toEqual([
    "xn--exempl-gva.fr",
    "xn--exempl-gva.fr",
    "xn--exempl-gva.fr",
  ]);
});

criterion("FR-MAIL-016-c6", async () => {
  const directory = memoryDirectory(
    [{ name: "example.org", postmaster: "mbx-ops", catchAll: "mbx-sean", masking: false }],
    [{ local: "old", domain: "example.org", mailbox: "mbx-sean", enabled: false, mask: null }],
  );
  const receive = createReceiver({ directory, ...memoryStore().ports });
  const envelope = { mailFrom: "mary@example.com", rcptTo: ["old@example.org"] };
  expect(await receive({ envelope, raw: plain, receivedAt: now(), via: "toy" })).toEqual({
    kind: "drop",
  });
});

criterion("FR-MAIL-016-c7", async () => {
  const names = ["rafters.studio:25", "[192.0.2.1]", "0x7f.1", ".", "", "a b.org"];
  expect(names.map(domainName)).toEqual(names.map(() => null));
  expect(await golden("not-a-domain")).toEqual(goldens["not-a-domain"]);
});

criterion("FR-MAIL-016-c8", async () => {
  const find = findMailbox(
    memoryDirectory(
      [{ name: "rafters.studio", postmaster: "mbx-ops", catchAll: "mbx-sean", masking: false }],
      [],
    ),
  );
  const addresses = ["sean@elsewhere.org", "@rafters.studio", "+tag@rafters.studio"];
  expect(await Promise.all(addresses.map((a) => find(recipient(a))))).toEqual([null, null, null]);
});

criterion("FR-MAIL-016-c9", () => {
  const row = { name: "rafters.studio", catchAll: null, masking: false };
  expect(domainSchema.safeParse(row).success).toBe(false);
});

criterion("FR-MAIL-016-c10", () => {
  expect(recipient('"A.B+c"@rafters.studio')).toEqual({
    local: '"a.b+c"',
    tag: null,
    domain: "rafters.studio",
  });
  expect(canonicalLocal('"A.B+c"')).toBe('"a.b+c"');
});

criterion("FR-MAIL-016-c11", async () => {
  expect(recipient("postmaster").domain).toBeNull();
  expect(await receiveFor("postmaster").verdict).toEqual({
    kind: "reject",
    reason: "no-such-user",
  });
});

criterion("FR-MAIL-016-c12", async () => {
  expect(recipient("sean+@rafters.studio").tag).toBeNull();
  const { store, verdict } = receiveFor("sean+@rafters.studio");
  expect(await verdict).toEqual({ kind: "accept", mailboxes: ["mbx-sean"] });
  expect([...store.rows.values()].map((r) => r.mailbox)).toEqual(["mbx-sean"]);
});
