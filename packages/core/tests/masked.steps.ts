import { createHash } from "node:crypto";
import { expect } from "vite-plus/test";
import { createMasker, type MaskStyle } from "../src/masked/index.ts";
import { WORDS } from "../src/masked/words.ts";
import {
  canonicalLocal,
  type Directory,
  domainSchema,
  mailboxAddressSchema,
} from "../src/receive/index.ts";
import { criterion } from "./criterion.ts";
import { createRandom, now } from "./env.ts";
import goldens from "./fixtures/masked.json" with { type: "json" };

const domain = domainSchema.parse({
  name: "rafters.studio",
  postmaster: "mbx-ops",
  catchAll: null,
  masking: true,
});
const empty: Directory = { domain: async () => domain, address: async () => null };
const period: MaskStyle = { form: "words-digits", separator: "period" };

/** A directory where the given locals are taken, and nothing else is. */
function taking(taken: (local: string) => boolean): Directory {
  return {
    domain: async () => domain,
    address: async (local) =>
      taken(local) ? { local, domain: domain.name, mailbox: "m", enabled: true, mask: null } : null,
  };
}

criterion("FR-MAIL-018-c1", async () => {
  for (const form of ["words", "words-digits"] as const) {
    for (const separator of ["camel", "underscore", "period"] as const) {
      const mask = createMasker({ directory: empty, random: createRandom(), now });
      const made = [];
      for (let i = 0; i < 3; i++) {
        const a = await mask({
          mailbox: "mbx-sean",
          domain,
          style: { form, separator },
          label: `site ${i}`,
        });
        made.push({ local: a.local, shown: a.mask?.shown });
      }
      expect(made, `${form}/${separator}`).toEqual(goldens[`${form}/${separator}`]);
    }
  }
});

criterion("FR-MAIL-018-c2", async () => {
  let calls = 0;
  const random = (into: Uint8Array<ArrayBuffer>) => into.fill(calls++ % 2 === 0 ? 0xff : 0x00);
  const mask = createMasker({ directory: empty, random, now });
  const made = await mask({
    mailbox: "m",
    domain,
    style: { form: "words", separator: "period" },
    label: "x",
  });
  expect(made.mask?.shown.split(".")[0]).toBe("acid");
});

criterion("FR-MAIL-018-c3", async () => {
  const first = await createMasker({ directory: empty, random: createRandom(), now })({
    mailbox: "m",
    domain,
    style: period,
    label: "x",
  });
  const directory = taking((local) => local === first.local);
  const made = await createMasker({ directory, random: createRandom(), now })({
    mailbox: "m",
    domain,
    style: period,
    label: "x",
  });
  expect(made.mask).toEqual({ ...goldens["collision-retries"], createdAt: now() });
  expect(made.mask?.shown).toBe("golf.slimy.3715");
});

criterion("FR-MAIL-018-c4", async () => {
  const mask = createMasker({ directory: taking(() => true), random: createRandom() });
  const made = mask({
    mailbox: "m",
    domain,
    style: { form: "words", separator: "period" },
    label: "x",
  });
  await expect(made).rejects.toThrow("no free masked address at rafters.studio after 5 tries");
  expect(String(await made.catch((e: unknown) => e))).toBe(goldens["five-collisions"]);
});

criterion("FR-MAIL-018-c5", async () => {
  let asked = 0;
  const directory: Directory = {
    domain: async () => {
      asked++;
      return null;
    },
    address: async () => {
      asked++;
      return null;
    },
  };
  const made = createMasker({ directory })({
    mailbox: "m",
    domain: { ...domain, masking: false },
    style: { form: "words", separator: "period" },
    label: "x",
  });
  await expect(made).rejects.toThrow("masking is off at rafters.studio");
  expect(String(await made.catch((e: unknown) => e))).toBe(goldens["masking-off"]);
  expect(asked).toBe(0);
});

criterion("FR-MAIL-018-c6", async () => {
  // Records every property the masker touches and every one it sets: a write would show as
  // anything but reading `address`.
  const touched: string[] = [];
  const directory = new Proxy(empty, {
    get: (target, key, receiver) => {
      touched.push(`get ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
    set: (target, key, value, receiver) => {
      touched.push(`set ${String(key)}`);
      return Reflect.set(target, key, value, receiver);
    },
  });
  const made = await createMasker({ directory, random: createRandom(), now })({
    mailbox: "mbx-sean",
    domain,
    style: { form: "words-digits", separator: "camel" },
    label: "bike shop",
  });
  expect(made).toEqual({
    local: canonicalLocal(made.mask?.shown ?? ""),
    domain: "rafters.studio",
    mailbox: "mbx-sean",
    enabled: true,
    mask: { shown: "acornGrill9371", label: "bike shop", createdAt: now() },
  });
  expect(touched).toEqual(["get address"]);
});

criterion("FR-MAIL-018-c7", () => {
  expect(WORDS).toHaveLength(1296);
  for (const word of WORDS) expect(word).toMatch(/^[a-z]+(-[a-z]+)?$/);
  expect(createHash("sha256").update(WORDS.join("\n")).digest("hex")).toBe(
    "3680fb8483e03eab3067f20ef8b8848a086006b25981b0df6c8bdc603c4ed55e",
  );
});

criterion("FR-MAIL-018-c8", async () => {
  const before = Date.now();
  const made = await createMasker({ directory: empty })({
    mailbox: "mbx-sean",
    domain,
    style: period,
    label: "x",
  });
  const after = Date.now();
  expect(mailboxAddressSchema.parse(made)).toEqual(made);
  expect(made.mask?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(made.mask?.createdAt.getTime()).toBeLessThanOrEqual(after);
});
