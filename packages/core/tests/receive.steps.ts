import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { ZodError } from "zod";
import { createReceiver } from "../src/receive/index.ts";
import { createRandom, now } from "./env.ts";
import { feature, owns } from "./feature.ts";
import {
  delivery,
  golden,
  goldens,
  memoryStore,
  plain,
  runCase,
  seedDirectory,
} from "./fixtures/receive.ts";

const FR001 = await feature("FR-MAIL-001");
const FR015 = await feature("FR-MAIL-015");

describeFeature(
  FR001,
  ({ Scenario }) => {
    Scenario("The stored bytes equal the delivered bytes", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;

      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support), and the plain golden as raw",
        () => {
          // runCase builds the seed directory and receives the plain golden.
        },
      );

      When(
        "createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives it for sean@rafters.studio",
        async () => {
          ({ store } = await runCase("plain"));
        },
      );

      Then("the blob stored under its key is byte for byte the plain golden", () => {
        const [stored] = store.blobs.values();
        expect(stored).toEqual(plain);
      });
    });

    Scenario(
      'The bytes are stored under "sha256/" and their lowercase hex SHA-256',
      ({ Given, When, Then }) => {
        let store: ReturnType<typeof memoryStore>;

        Given("the plain golden as raw", () => {
          // runCase receives the plain golden.
        });

        When("it is received for sean@rafters.studio", async () => {
          ({ store } = await runCase("plain"));
        });

        Then(
          'the one blob key is "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b"',
          () => {
            expect([...store.blobs.keys()]).toEqual([
              "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b",
            ]);
          },
        );
      },
    );

    Scenario(
      "The envelope is recorded beside the bytes, never written into them",
      ({ Given, When, Then }) => {
        let store: ReturnType<typeof memoryStore>;

        Given("the plain golden, from mary@example.com", () => {
          // golden and runCase receive the plain golden from mary@example.com.
        });

        When("it is received for sean@rafters.studio", async () => {
          ({ store } = await runCase("plain"));
        });

        Then(
          "the record holds mailFrom, rcptTo, receivedAt and via as the reference golden plain (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61) has them, and the stored bytes are unchanged",
          async () => {
            expect(await golden("plain")).toEqual(goldens.plain);
            expect([...store.blobs.values()]).toEqual([plain]);
          },
        );
      },
    );

    Scenario("The same bytes delivered twice add nothing", ({ Given, When, Then }) => {
      Given("the plain golden", () => {
        // The case same-bytes-twice receives the plain golden.
      });

      When("it is received twice for sean@rafters.studio", () => {
        // golden receives it inside the Then, around its expect line.
      });

      Then(
        "there is one blob and one record, as in the reference golden same-bytes-twice (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
          expect(await golden("same-bytes-twice")).toEqual(goldens["same-bytes-twice"]);
        },
      );
    });

    Scenario("A retry with different bytes is kept as a second copy", ({ Given, When, Then }) => {
      Given(
        'the plain golden, then the plain golden with "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=example.com" and CRLF prepended',
        () => {
          // The case retry-new-bytes receives both.
        },
      );

      When("both are received for sean@rafters.studio", () => {
        // golden receives them inside the Then, around its expect line.
      });

      Then(
        "there are two blobs and two records, as in the reference golden retry-new-bytes (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
          expect(await golden("retry-new-bytes")).toEqual(goldens["retry-new-bytes"]);
        },
      );
    });

    Scenario("A failure leaves no record without its bytes", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let failure: Error;
      let receive: ReturnType<typeof createReceiver>;

      Given("a deliveries port that throws", () => {
        store = memoryStore();
        failure = new Error("the log is down");
        receive = createReceiver({
          directory: seedDirectory(),
          blobs: store.ports.blobs,
          deliveries: { record: () => Promise.reject(failure) },
        });
      });

      When("a message is received for sean@rafters.studio", () => {
        // receive runs inside the Then, wrapped by its expect.
      });

      Then("receive throws, the blob is stored, and no record exists", async () => {
        await expect(receive(delivery(["sean@rafters.studio"]))).rejects.toBe(failure);
        expect(store.blobs.size).toBe(1);
        expect(store.rows.size).toBe(0);
      });
    });
  },
  owns(
    "FR-MAIL-001-c1",
    "FR-MAIL-001-c2",
    "FR-MAIL-001-c3",
    "FR-MAIL-001-c4",
    "FR-MAIL-001-c5",
    "FR-MAIL-001-c6",
  ),
);

describeFeature(
  FR015,
  ({ Scenario }) => {
    Scenario("A message whose headers are garbage is still accepted", ({ Given, When, Then }) => {
      let garbage: Uint8Array;
      let receive: ReturnType<typeof createReceiver>;

      Given("the plain golden with a line of control characters prepended", () => {
        garbage = new Uint8Array([0x00, 0x01, 0x1b, 0x07, 0x7f, 0x0d, 0x0a, ...plain]);
        const store = memoryStore();
        receive = createReceiver({ directory: seedDirectory(), ...store.ports });
      });

      When("it is received for sean@rafters.studio", () => {
        // receive runs inside the Then, wrapped by its expect.
      });

      Then("the verdict is accept for mbx-sean", async () => {
        expect(await receive(delivery(["sean@rafters.studio"], garbage))).toEqual({
          kind: "accept",
          mailboxes: ["mbx-sean"],
        });
      });
    });

    Scenario("No recipient found is a reject, and nothing is stored", ({ Given, When, Then }) => {
      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // golden builds the seed directory.
        },
      );

      When(
        "createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives the plain golden for nobody@rafters.studio",
        () => {
          // golden receives it inside the Then, around its expect line.
        },
      );

      Then(
        "the verdict is reject with reason no-such-user and there are no blobs and no records, as in the reference golden unknown (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        async () => {
          expect(await golden("unknown")).toEqual(goldens.unknown);
        },
      );
    });

    Scenario(
      "Every recipient found switched off is a drop, and nothing is stored",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When("the plain golden is received for quiet.otter.4821@rafters.studio", () => {
          // golden receives it inside the Then, around its expect line.
        });

        Then(
          "the verdict is drop and there are no blobs and no records, as in the reference golden masked-off-drops (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
          async () => {
            expect(await golden("masked-off-drops")).toEqual(goldens["masked-off-drops"]);
          },
        );
      },
    );

    Scenario(
      "Only recipients found switched on are recorded, in envelope order",
      ({ Given, When, Then }) => {
        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When(
          "the intl golden is received for sean@ and support@rafters.studio, and the plain golden for quietOtter4821@ and support@rafters.studio",
          () => {
            // golden receives them inside the Then, around its expect lines.
          },
        );

        Then(
          "the verdicts and records are those of the reference golden two-mailboxes (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61) and the reference golden masked-off-and-on (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
          async () => {
            expect(await golden("two-mailboxes")).toEqual(goldens["two-mailboxes"]);
            expect(await golden("masked-off-and-on")).toEqual(goldens["masked-off-and-on"]);
          },
        );
      },
    );

    Scenario(
      "Two recipients finding one mailbox give one record, for the first",
      ({ Given, When, Then }) => {
        let result: Awaited<ReturnType<typeof golden>>;

        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // golden builds the seed directory.
          },
        );

        When("the plain golden is received for sean@ and silvius@rafters.studio", async () => {
          result = await golden("alias-once");
        });

        Then(
          "there is one record, with rcptTo sean@rafters.studio, as in the reference golden alias-once (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
          () => {
            expect(result).toEqual(goldens["alias-once"]);
            expect(result.rows.map((r) => r.rcpt_to)).toEqual(["sean@rafters.studio"]);
          },
        );
      },
    );

    Scenario("A bounce is recorded with a null sender", ({ Given, When, Then }) => {
      let result: Awaited<ReturnType<typeof golden>>;

      Given(
        "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
        () => {
          // golden builds the seed directory.
        },
      );

      When("the plain golden is received with mailFrom null for sean@rafters.studio", async () => {
        result = await golden("bounce");
      });

      Then(
        "the record's mailFrom is null, as in the reference golden bounce (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)",
        () => {
          expect(result).toEqual(goldens.bounce);
          expect(result.rows[0]?.mail_from).toBeNull();
        },
      );
    });

    Scenario(
      "Each record id is a UUIDv7 from the receipt time and the random",
      ({ Given, When, Then }) => {
        let rows: Awaited<ReturnType<typeof runCase>>["rows"];

        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // runCase builds the seed directory.
          },
        );

        When(
          "createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives the plain golden for sean@rafters.studio",
          async () => {
            ({ rows } = await runCase("plain", createRandom()));
          },
        );

        Then('the record id is "019caf7e-0e80-7001-8203-040506070809"', () => {
          expect(rows.map((r) => r.id)).toEqual(["019caf7e-0e80-7001-8203-040506070809"]);
        });
      },
    );

    Scenario(
      "Without a random, record ids are still UUIDv7 from the receipt time",
      ({ Given, When, Then }) => {
        let rows: Awaited<ReturnType<typeof runCase>>["rows"];

        Given(
          "the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)",
          () => {
            // runCase builds the seed directory.
          },
        );

        When(
          "createReceiver with no random receives the plain golden for sean@rafters.studio",
          async () => {
            ({ rows } = await runCase("plain", null));
          },
        );

        Then("the record id is a version 7 UUID whose time is 2026-03-02T17:00:00Z", () => {
          const id = rows[0]?.id ?? "";
          expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(now().getTime());
        });
      },
    );

    Scenario("A delivery the adapter built wrongly throws", ({ Given, When, Then }) => {
      let store: ReturnType<typeof memoryStore>;
      let receive: ReturnType<typeof createReceiver>;

      Given("a delivery with an empty rcptTo list", () => {
        store = memoryStore();
        receive = createReceiver({ directory: seedDirectory(), ...store.ports });
      });

      When("it is received", () => {
        // receive runs inside the Then, wrapped by its expect.
      });

      Then("receive throws a ZodError and nothing is stored", async () => {
        await expect(receive(delivery([]))).rejects.toBeInstanceOf(ZodError);
        expect(store.blobs.size).toBe(0);
        expect(store.rows.size).toBe(0);
      });
    });
  },
  owns(
    "FR-MAIL-015-c1",
    "FR-MAIL-015-c2",
    "FR-MAIL-015-c3",
    "FR-MAIL-015-c4",
    "FR-MAIL-015-c5",
    "FR-MAIL-015-c6",
    "FR-MAIL-015-c7",
    "FR-MAIL-015-c8",
    "FR-MAIL-015-c9",
  ),
);
