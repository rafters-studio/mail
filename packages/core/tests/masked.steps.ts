import { createHash } from "node:crypto";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { createMasker, type MaskStyle } from "../src/masked/index.ts";
import { WORDS } from "../src/masked/words.ts";
import {
  canonicalLocal,
  type Directory,
  domainSchema,
  mailboxAddressSchema,
} from "../src/receive/index.ts";
import { createRandom, now } from "./env.ts";
import { feature, owns } from "./feature.ts";
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

type Made = Awaited<ReturnType<ReturnType<typeof createMasker>>>;

const FR018 = await feature("FR-MAIL-018");

describeFeature(
  FR018,
  ({ Scenario }) => {
    Scenario("Each style makes the golden addresses", ({ Given, When, Then }) => {
      Given("a domain with masking on and an empty directory", () => {
        // domain and empty are held at file scope.
      });

      When(
        "createMasker with a fresh counter random makes three addresses in each of the six styles",
        () => {
          // The addresses are made inside the Then, style by style, around its expect line.
        },
      );

      Then(
        "each local and shown form is that of the reference golden masked (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
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
        },
      );
    });

    Scenario("A draw at or above the fair limit is drawn again", ({ Given, When, Then }) => {
      let random: (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
      let made: Made;

      Given("a random that gives 0xFFFF and then 0x0000 for every draw", () => {
        let calls = 0;
        random = (into: Uint8Array<ArrayBuffer>) => into.fill(calls++ % 2 === 0 ? 0xff : 0x00);
      });

      When("one address is made in the words/period style", async () => {
        const mask = createMasker({ directory: empty, random, now });
        made = await mask({
          mailbox: "m",
          domain,
          style: { form: "words", separator: "period" },
          label: "x",
        });
      });

      Then('its first word is "acid"', () => {
        expect(made.mask?.shown.split(".")[0]).toBe("acid");
      });
    });

    Scenario("A candidate already taken is skipped", ({ Given, When, Then }) => {
      let directory: Directory;
      let made: Made;

      Given("a directory holding the first words-digits/period candidate", async () => {
        const first = await createMasker({ directory: empty, random: createRandom(), now })({
          mailbox: "m",
          domain,
          style: period,
          label: "x",
        });
        directory = taking((local) => local === first.local);
      });

      When("an address is made with a fresh counter random", async () => {
        made = await createMasker({ directory, random: createRandom(), now })({
          mailbox: "m",
          domain,
          style: period,
          label: "x",
        });
      });

      Then('it is "golf.slimy.3715"', () => {
        expect(made.mask).toEqual({ ...goldens["collision-retries"], createdAt: now() });
        expect(made.mask?.shown).toBe("golf.slimy.3715");
      });
    });

    Scenario("Five taken candidates throw", ({ Given, When, Then }) => {
      let mask: ReturnType<typeof createMasker>;
      let made: Promise<Made>;

      Given("a directory that holds every candidate", () => {
        mask = createMasker({ directory: taking(() => true), random: createRandom() });
      });

      When("an address is made", () => {
        made = mask({
          mailbox: "m",
          domain,
          style: { form: "words", separator: "period" },
          label: "x",
        });
      });

      Then('it throws "no free masked address at rafters.studio after 5 tries"', async () => {
        await expect(made).rejects.toThrow(
          "no free masked address at rafters.studio after 5 tries",
        );
        expect(String(await made.catch((e: unknown) => e))).toBe(goldens["five-collisions"]);
      });
    });

    Scenario("A domain with masking off is refused", ({ Given, When, Then }) => {
      let asked: number;
      let directory: Directory;
      let made: Promise<Made>;

      Given("a domain with masking off", () => {
        asked = 0;
        directory = {
          domain: async () => {
            asked++;
            return null;
          },
          address: async () => {
            asked++;
            return null;
          },
        };
      });

      When("an address is made", () => {
        made = createMasker({ directory })({
          mailbox: "m",
          domain: { ...domain, masking: false },
          style: { form: "words", separator: "period" },
          label: "x",
        });
      });

      Then(
        'it throws "masking is off at rafters.studio" and the directory is never asked',
        async () => {
          await expect(made).rejects.toThrow("masking is off at rafters.studio");
          expect(String(await made.catch((e: unknown) => e))).toBe(goldens["masking-off"]);
          expect(asked).toBe(0);
        },
      );
    });

    Scenario(
      "The address made is canonical, switched on and labelled, and is not written",
      ({ Given, When, Then }) => {
        let touched: string[];
        let directory: Directory;
        let made: Made;

        Given("a directory that records any write", () => {
          // Records every property the masker touches and every one it sets: a write would show as
          // anything but reading `address`.
          touched = [];
          directory = new Proxy(empty, {
            get: (target, key, receiver) => {
              touched.push(`get ${String(key)}`);
              return Reflect.get(target, key, receiver);
            },
            set: (target, key, value, receiver) => {
              touched.push(`set ${String(key)}`);
              return Reflect.set(target, key, value, receiver);
            },
          });
        });

        When('an address is made with label "bike shop" at now 2026-03-02T17:00:00Z', async () => {
          made = await createMasker({ directory, random: createRandom(), now })({
            mailbox: "mbx-sean",
            domain,
            style: { form: "words-digits", separator: "camel" },
            label: "bike shop",
          });
        });

        Then(
          'its local is the canonical form of its shown form, enabled is true, mask is { shown, "bike shop", now }, and nothing was written',
          () => {
            expect(made).toEqual({
              local: canonicalLocal(made.mask?.shown ?? ""),
              domain: "rafters.studio",
              mailbox: "mbx-sean",
              enabled: true,
              mask: { shown: "acornGrill9371", label: "bike shop", createdAt: now() },
            });
            expect(touched).toEqual(["get address"]);
          },
        );
      },
    );

    Scenario("The word list is the EFF short wordlist 1", ({ Given, When, Then }) => {
      Given("WORDS", () => {
        // WORDS is imported at file scope.
      });

      When("it is read", () => {
        // WORDS is read inside the Then, wrapped by its expect lines.
      });

      Then(
        'it has 1,296 words, each matching ^[a-z]+(-[a-z]+)?$, and the SHA-256 of WORDS.join("\\n") is 3680fb8483e03eab3067f20ef8b8848a086006b25981b0df6c8bdc603c4ed55e',
        () => {
          expect(WORDS).toHaveLength(1296);
          for (const word of WORDS) expect(word).toMatch(/^[a-z]+(-[a-z]+)?$/);
          expect(createHash("sha256").update(WORDS.join("\n")).digest("hex")).toBe(
            "3680fb8483e03eab3067f20ef8b8848a086006b25981b0df6c8bdc603c4ed55e",
          );
        },
      );
    });

    Scenario("Without a random or a clock, an address is still made", ({ Given, When, Then }) => {
      let before: number;
      let after: number;
      let made: Made;

      Given("a domain with masking on and an empty directory", () => {
        // domain and empty are held at file scope.
      });

      When("createMasker with only the directory makes an address", async () => {
        before = Date.now();
        made = await createMasker({ directory: empty })({
          mailbox: "mbx-sean",
          domain,
          style: period,
          label: "x",
        });
        after = Date.now();
      });

      Then(
        "it parses with mailboxAddressSchema, and its createdAt is no earlier than the clock read just before the call and no later than the clock read just after",
        () => {
          expect(mailboxAddressSchema.parse(made)).toEqual(made);
          expect(made.mask?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
          expect(made.mask?.createdAt.getTime()).toBeLessThanOrEqual(after);
        },
      );
    });
  },
  owns(
    "FR-MAIL-018-c1",
    "FR-MAIL-018-c2",
    "FR-MAIL-018-c3",
    "FR-MAIL-018-c4",
    "FR-MAIL-018-c5",
    "FR-MAIL-018-c6",
    "FR-MAIL-018-c7",
    "FR-MAIL-018-c8",
  ),
);
