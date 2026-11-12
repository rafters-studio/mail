import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import {
  canonicalLocal,
  createReceiver,
  domainName,
  domainSchema,
  findMailbox,
  recipient,
} from "../src/receive/index.ts";
import { feature, owns } from "./feature.ts";
import {
  delivery,
  golden,
  goldens,
  memoryDirectory,
  memoryStore,
  seedDirectory,
} from "./fixtures/receive.ts";

/** The plain golden received on the seed directory for one envelope recipient. */
function receiveFor(to: string) {
  const store = memoryStore();
  const receive = createReceiver({ directory: seedDirectory(), ...store.ports });
  return { store, verdict: receive(delivery([to])) };
}

const FR016 = await feature("FR-MAIL-016");

describeFeature(
  FR016,
  ({ Scenario }) => {
    Scenario("Case and dots do not change the mailbox", ({ Given, When, Then }) => {
      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // golden builds the seed directory.
        },
      );

      When("the plain golden is received for S.e.a.n@Rafters.Studio", () => {
        // golden receives it inside the Then, around its expect line.
      });

      Then(
        "it is recorded for mbx-sean, as in the reference golden case-and-dots (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
          expect(await golden("case-and-dots")).toEqual(goldens["case-and-dots"]);
        },
      );
    });

    Scenario(
      "An address with its own tag row reaches that row's mailbox",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When("the plain golden is received for sean+lists@rafters.studio", () => {
          // golden receives it inside the Then, around its expect line.
        });

        Then(
          "it is recorded for mbx-lists, as in the reference golden tag-own-address (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
          async () => {
            expect(await golden("tag-own-address")).toEqual(goldens["tag-own-address"]);
          },
        );
      },
    );

    Scenario(
      "A tag with no row of its own reaches the address without it",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When("the plain golden is received for se.an+receipts.2026@rafters.studio", () => {
          // golden receives it inside the Then, around its expect line.
        });

        Then(
          'it is recorded for mbx-sean, as in the reference golden tag-falls-back (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), and recipient() gives the tag "receipts.2026"',
          async () => {
            expect(await golden("tag-falls-back")).toEqual(goldens["tag-falls-back"]);
            expect(recipient("se.an+receipts.2026@rafters.studio").tag).toBe("receipts.2026");
          },
        );
      },
    );

    Scenario(
      "Postmaster in any case reaches the domain's postmaster mailbox",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When("the plain golden is received for PostMaster@rafters.studio", () => {
          // golden receives it inside the Then, around its expect line.
        });

        Then(
          "it is recorded for mbx-ops, as in the reference golden postmaster (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
          async () => {
            expect(await golden("postmaster")).toEqual(goldens.postmaster);
          },
        );
      },
    );

    Scenario(
      "A domain's catch-all receives unknown local parts, however the domain is written",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When(
          "the plain golden is received for anyone@EXEMPLÉ.FR, and domainName is given exemplé.fr, EXEMPLÉ.FR and xn--exempl-gva.fr",
          () => {
            // golden and domainName run inside the Then, wrapped by their expect lines.
          },
        );

        Then(
          'it is recorded for mbx-sean, as in the reference golden catch-all-idn (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), and the three names are all "xn--exempl-gva.fr"',
          async () => {
            expect(await golden("catch-all-idn")).toEqual(goldens["catch-all-idn"]);
            expect(["exemplé.fr", "EXEMPLÉ.FR", "xn--exempl-gva.fr"].map(domainName)).toEqual([
              "xn--exempl-gva.fr",
              "xn--exempl-gva.fr",
              "xn--exempl-gva.fr",
            ]);
          },
        );
      },
    );

    Scenario(
      "A switched-off address on a domain with a catch-all is dropped, not caught",
      ({ Given, When, Then }) => {
        let receive: ReturnType<typeof createReceiver>;

        Given("a directory whose domain has a catch-all and a switched-off address there", () => {
          const directory = memoryDirectory(
            [{ name: "example.org", postmaster: "mbx-ops", catchAll: "mbx-sean", masking: false }],
            [
              {
                local: "old",
                domain: "example.org",
                mailbox: "mbx-sean",
                enabled: false,
                mask: null,
              },
            ],
          );
          receive = createReceiver({ directory, ...memoryStore().ports });
        });

        When("mail is received for that address", () => {
          // receive runs inside the Then, wrapped by its expect.
        });

        Then("the verdict is drop", async () => {
          expect(await receive(delivery(["old@example.org"]))).toEqual({
            kind: "drop",
          });
        });
      },
    );

    Scenario("A name that is not a domain finds nothing", ({ Given, When, Then }) => {
      let names: string[];

      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // golden builds the seed directory.
        },
      );

      When(
        'domainName is given "rafters.studio:25", "[192.0.2.1]", "0x7f.1", ".", "" and "a b.org", and the plain golden is received for sean@rafters.studio:25',
        () => {
          names = ["rafters.studio:25", "[192.0.2.1]", "0x7f.1", ".", "", "a b.org"];
          // domainName and golden run inside the Then, wrapped by their expect lines.
        },
      );

      Then(
        "each name gives null, and the delivery is rejected, as in the reference golden not-a-domain (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
          expect(names.map(domainName)).toEqual(names.map(() => null));
          expect(await golden("not-a-domain")).toEqual(goldens["not-a-domain"]);
        },
      );
    });

    Scenario(
      "A domain the directory does not hold, or an empty local part, finds nothing",
      ({ Given, When, Then }) => {
        let find: ReturnType<typeof findMailbox>;
        let found: unknown[];

        Given("a directory with a catch-all at rafters.studio", () => {
          find = findMailbox(
            memoryDirectory(
              [
                {
                  name: "rafters.studio",
                  postmaster: "mbx-ops",
                  catchAll: "mbx-sean",
                  masking: false,
                },
              ],
              [],
            ),
          );
        });

        When(
          "findMailbox is asked for sean@elsewhere.org, @rafters.studio and +tag@rafters.studio",
          async () => {
            const addresses = ["sean@elsewhere.org", "@rafters.studio", "+tag@rafters.studio"];
            found = await Promise.all(addresses.map((a) => find(recipient(a))));
          },
        );

        Then("each finds null", () => {
          expect(found).toEqual([null, null, null]);
        });
      },
    );

    Scenario("A domain cannot exist without a postmaster mailbox", ({ Given, When, Then }) => {
      let row: unknown;

      Given("a domain row with no postmaster", () => {
        row = { name: "rafters.studio", catchAll: null, masking: false };
      });

      When("domainSchema parses it", () => {
        // safeParse runs inside the Then, wrapped by its expect.
      });

      Then("it fails", () => {
        expect(domainSchema.safeParse(row).success).toBe(false);
      });
    });

    Scenario(
      "A quoted local part is lowercased and otherwise kept whole",
      ({ Given, When, Then }) => {
        let address: string;

        Given('the address "\\"A.B+c\\"@rafters.studio"', () => {
          address = '"A.B+c"@rafters.studio';
        });

        When("recipient() and canonicalLocal() read it", () => {
          // recipient and canonicalLocal run inside the Then, wrapped by their expect lines.
        });

        Then('the local part is "\\"a.b+c\\"" with no tag', () => {
          expect(recipient(address)).toEqual({
            local: '"a.b+c"',
            tag: null,
            domain: "rafters.studio",
          });
          expect(canonicalLocal('"A.B+c"')).toBe('"a.b+c"');
        });
      },
    );

    Scenario("An envelope recipient with no @ finds nothing", ({ Given, When, Then }) => {
      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // receiveFor builds the seed directory.
        },
      );

      When(
        'the plain golden is received for "postmaster" with no domain (RFC 5321 4.1.1.3 allows RCPT TO:<Postmaster>; mail routes by domain, so it has none to route by)',
        () => {
          // receiveFor receives it inside the Then, wrapped by its expect.
        },
      );

      Then(
        "recipient() gives domain null, and the verdict is reject with reason no-such-user",
        async () => {
          expect(recipient("postmaster").domain).toBeNull();
          expect(await receiveFor("postmaster").verdict).toEqual({
            kind: "reject",
            reason: "no-such-user",
          });
        },
      );
    });

    Scenario("An empty tag is no tag", ({ Given, When, Then }) => {
      let received: ReturnType<typeof receiveFor>;

      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // receiveFor builds the seed directory.
        },
      );

      When("the plain golden is received for sean+@rafters.studio", () => {
        received = receiveFor("sean+@rafters.studio");
      });

      Then("recipient() gives tag null, and it is recorded for mbx-sean", async () => {
        expect(recipient("sean+@rafters.studio").tag).toBeNull();
        const { store, verdict } = received;
        expect(await verdict).toEqual({ kind: "accept", mailboxes: ["mbx-sean"] });
        expect([...store.rows.values()].map((r) => r.mailbox)).toEqual(["mbx-sean"]);
      });
    });
  },
  owns(
    "FR-MAIL-016-c1",
    "FR-MAIL-016-c2",
    "FR-MAIL-016-c3",
    "FR-MAIL-016-c4",
    "FR-MAIL-016-c5",
    "FR-MAIL-016-c6",
    "FR-MAIL-016-c7",
    "FR-MAIL-016-c8",
    "FR-MAIL-016-c9",
    "FR-MAIL-016-c10",
    "FR-MAIL-016-c11",
    "FR-MAIL-016-c12",
  ),
);
