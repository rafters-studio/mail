// The receiving cases and the directory they run on (goldens 01a19a9e, generator_source): "Fifteen
// receiving cases, three Worker cases and the masker in all six styles produce the goldens below."
// The directory is the reference's seed, held in memory; each case runs on a fresh one.
import { readFileSync } from "node:fs";
import {
  createReceiver,
  type DeliveryRow,
  type Directory,
  type Domain,
  domainSchema,
  type MailboxAddress,
  mailboxAddressSchema,
  type Verdict,
} from "../../src/receive/index.ts";
import type { Random } from "../../src/message/index.ts";
import { createRandom, now } from "../env.ts";
import goldens from "./receive.json" with { type: "json" };

export const plain = new Uint8Array(
  readFileSync(new URL("write/plain.expected.eml", import.meta.url)),
);
const intl = new Uint8Array(readFileSync(new URL("write/intl.expected.eml", import.meta.url)));
const resent = new Uint8Array([
  ...new TextEncoder().encode(
    "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=example.com\r\n",
  ),
  ...plain,
]);

/** A delivery from mary, received at the tests' clock, as the reference's "toy" adapter. */
export function delivery(rcptTo: string[], raw = plain) {
  return { envelope: { mailFrom: "mary@example.com", rcptTo }, raw, receivedAt: now(), via: "toy" };
}

export const SEED_DOMAINS = [
  { name: "rafters.studio", postmaster: "mbx-ops", catchAll: null, masking: true },
  { name: "xn--exempl-gva.fr", postmaster: "mbx-ops", catchAll: "mbx-sean", masking: false },
];
const SEED_ADDRESSES = [
  ["sean", "mbx-sean", true],
  ["silvius", "mbx-sean", true],
  ["sean+lists", "mbx-lists", true],
  ["support", "mbx-support", true],
] as const;
const QUIET = {
  local: "quietotter4821",
  domain: "rafters.studio",
  mailbox: "mbx-sean",
  enabled: false,
  mask: {
    shown: "quiet.otter.4821",
    label: "bike shop",
    createdAt: new Date("2026-03-01T09:00:00.000Z"),
  },
};

/** A directory held in memory, found as a table is: by exact name, and exact local and domain. */
export function memoryDirectory(domains: unknown[], addresses: unknown[]): Directory {
  const ds: Domain[] = domains.map((d) => domainSchema.parse(d));
  const rows: MailboxAddress[] = addresses.map((a) => mailboxAddressSchema.parse(a));
  return {
    domain: async (name) => ds.find((d) => d.name === name) ?? null,
    address: async (local, domain) =>
      rows.find((a) => a.local === local && a.domain === domain) ?? null,
  };
}

/** The reference goldens' seed directory. */
export function seedDirectory(): Directory {
  const rows = SEED_ADDRESSES.map(([local, mailbox, enabled]) => ({
    local,
    domain: "rafters.studio",
    mailbox,
    enabled,
    mask: null,
  }));
  return memoryDirectory(SEED_DOMAINS, [...rows, QUIET]);
}

/** A blob store and a delivery log in memory; the log ignores a second (blob, mailbox). */
export function memoryStore() {
  const blobs = new Map<string, Uint8Array>();
  const rows = new Map<string, DeliveryRow>();
  return {
    blobs,
    rows,
    ports: {
      blobs: { put: async (key: string, bytes: Uint8Array) => void blobs.set(key, bytes) },
      deliveries: {
        record: async (row: DeliveryRow) => {
          const key = `${row.blob} ${row.mailbox}`;
          if (!rows.has(key)) rows.set(key, row);
        },
      },
    },
  };
}

type Case = { mailFrom: string | null; rcptTo: string[]; raw: Uint8Array }[];
const from = "mary@example.com";
const once = (rcptTo: string[], raw = plain): Case => [{ mailFrom: from, rcptTo, raw }];
const CASES = {
  plain: once(["sean@rafters.studio"]),
  "alias-once": once(["sean@rafters.studio", "silvius@rafters.studio"]),
  "two-mailboxes": once(["sean@rafters.studio", "support@rafters.studio"], intl),
  "case-and-dots": once(["S.e.a.n@Rafters.Studio"]),
  "tag-own-address": once(["sean+lists@rafters.studio"]),
  "tag-falls-back": once(["se.an+receipts.2026@rafters.studio"]),
  postmaster: once(["PostMaster@rafters.studio"]),
  "catch-all-idn": once(["anyone@EXEMPLÉ.FR"]),
  unknown: once(["nobody@rafters.studio"]),
  "not-a-domain": once(["sean@rafters.studio:25"]),
  "masked-off-drops": once(["quiet.otter.4821@rafters.studio"]),
  "masked-off-and-on": once(["quietOtter4821@rafters.studio", "support@rafters.studio"]),
  bounce: [{ mailFrom: null, rcptTo: ["sean@rafters.studio"], raw: plain }],
  "same-bytes-twice": [...once(["sean@rafters.studio"]), ...once(["sean@rafters.studio"])],
  "retry-new-bytes": [...once(["sean@rafters.studio"]), ...once(["sean@rafters.studio"], resent)],
} satisfies Record<keyof typeof goldens, Case>;

/** One case run as the reference runs it: the seed, the counter random, receivedAt fixed, via "toy". */
export async function runCase(name: keyof typeof goldens, random: Random | null = createRandom()) {
  const store = memoryStore();
  const receive = createReceiver({
    directory: seedDirectory(),
    ...store.ports,
    ...(random === null ? {} : { random }),
  });
  const verdicts: Verdict[] = [];
  for (const d of CASES[name]) {
    const envelope = { mailFrom: d.mailFrom, rcptTo: d.rcptTo };
    verdicts.push(await receive({ envelope, raw: d.raw, receivedAt: now(), via: "toy" }));
  }
  const rows = [...store.rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { verdicts, store, rows };
}

/** A case's verdicts, blob keys and rows, in the goldens' column names and order. */
export async function golden(name: keyof typeof goldens) {
  const { verdicts, store, rows } = await runCase(name);
  return {
    verdicts,
    blobs: [...store.blobs.keys()],
    rows: rows.map((r) => ({
      id: r.id,
      blob: r.blob,
      mailbox: r.mailbox,
      mail_from: r.mailFrom,
      rcpt_to: r.rcptTo,
      received_at: r.receivedAt.toISOString(),
      via: r.via,
    })),
  };
}

export { goldens };
