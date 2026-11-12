// Sending raw through the binding, and the socket as a Connection (FR-MAIL-029).
import { readdirSync, readFileSync } from "node:fs";
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import { bindingTransport, type Connect, socketConnection } from "../src/index.ts";

const BYTES = new TextEncoder().encode("Subject: hi\r\n\r\nbody\r\n");
const MESSAGE = { bytes: BYTES, envelope: { from: "me@example.com", to: ["a@x.example"] } };
const make = (from: string, to: string, raw: string) => ({ from, to, raw });

/** The one outcome of a binding that throws this value. */
async function thrown(value: unknown) {
  const transport = bindingTransport(
    {
      send: () => {
        throw value;
      },
    },
    make,
  );
  const [outcome] = await transport.send(MESSAGE);
  return outcome;
}

const fail = (code: unknown, message = "said no") => ({ code, message });

const FR029 = await feature("FR-MAIL-029");

describeFeature(
  FR029,
  ({ Scenario }) => {
    Scenario("One send per recipient, and one throw stops no other", ({ Given, When, Then }) => {
      let seen: unknown[];
      let transport: ReturnType<typeof bindingTransport>;
      let outcomes: Awaited<ReturnType<ReturnType<typeof bindingTransport>["send"]>>;

      Given("a binding that throws for the first of two recipients", () => {
        seen = [];
        transport = bindingTransport(
          {
            send: async (message) => {
              seen.push(message);
              if (seen.length === 1) throw fail("E_RECIPIENT_SUPPRESSED");
            },
          },
          make,
        );
      });

      When("bindingTransport sends", async () => {
        outcomes = await transport.send({
          bytes: BYTES,
          envelope: { from: "me@example.com", to: ["a@x.example", "b@x.example"] },
        });
      });

      Then(
        "both were attempted, in order, with the bytes unchanged, and there is one outcome each",
        () => {
          const raw = "Subject: hi\r\n\r\nbody\r\n";
          expect(transport.name).toBe("cloudflare");
          expect(seen).toEqual([
            { from: "me@example.com", to: "a@x.example", raw },
            { from: "me@example.com", to: "b@x.example", raw },
          ]);
          expect(outcomes.map(({ recipient, kind }) => [recipient, kind])).toEqual([
            ["a@x.example", "refused"],
            ["b@x.example", "accepted"],
          ]);
        },
      );
    });

    Scenario("A code about this recipient or message is final", ({ Given, When, Then }) => {
      let codes: string[];

      Given(
        "each of E_RECIPIENT_SUPPRESSED, E_VALIDATION_ERROR, E_FIELD_MISSING, E_TOO_MANY_RECIPIENTS, E_TOO_MANY_ATTACHMENTS, E_CONTENT_TOO_LARGE and E_HEADER_NOT_ALLOWED",
        () => {
          codes = [
            "E_RECIPIENT_SUPPRESSED",
            "E_VALIDATION_ERROR",
            "E_FIELD_MISSING",
            "E_TOO_MANY_RECIPIENTS",
            "E_TOO_MANY_ATTACHMENTS",
            "E_CONTENT_TOO_LARGE",
            "E_HEADER_NOT_ALLOWED",
          ];
        },
      );

      When("the binding throws it", () => {
        // thrown runs inside the Then, wrapped by its expect.
      });

      Then(
        "the outcome is refused, final, stage provider, code null, text the code and message",
        async () => {
          for (const code of codes) {
            expect(await thrown(fail(code))).toEqual({
              recipient: "a@x.example",
              kind: "refused",
              final: true,
              stage: "provider",
              code: null,
              text: `${code}: said no`,
            });
          }
        },
      );
    });

    Scenario("A code about the account or the binding is not final", ({ Given, When, Then }) => {
      let codes: string[];

      Given(
        "each of E_RECIPIENT_NOT_ALLOWED, E_RATE_LIMIT_EXCEEDED, E_DAILY_LIMIT_EXCEEDED, E_SENDER_NOT_VERIFIED, E_SENDER_DOMAIN_NOT_AVAILABLE and E_ACCOUNT_SUSPENDED",
        () => {
          codes = [
            "E_RECIPIENT_NOT_ALLOWED",
            "E_RATE_LIMIT_EXCEEDED",
            "E_DAILY_LIMIT_EXCEEDED",
            "E_SENDER_NOT_VERIFIED",
            "E_SENDER_DOMAIN_NOT_AVAILABLE",
            "E_ACCOUNT_SUSPENDED",
          ];
        },
      );

      When("the binding throws it", () => {
        // thrown runs inside the Then, wrapped by its expect.
      });

      Then("the outcome is refused, not final", async () => {
        for (const code of codes) {
          expect(await thrown(fail(code))).toMatchObject({ kind: "refused", final: false });
        }
      });
    });

    Scenario("Anything else thrown is unknown", ({ Given, When, Then }) => {
      let codes: string[];

      Given(
        "E_DELIVERY_FAILED, E_INTERNAL_SERVER_ERROR, E_NEW, constructor, a numeric code, no code, and a thrown string",
        () => {
          codes = ["E_DELIVERY_FAILED", "E_INTERNAL_SERVER_ERROR", "E_NEW", "constructor"];
        },
      );

      When("the binding throws it", () => {
        // thrown runs inside the Then, wrapped by its expect.
      });

      Then(
        "the outcome is unknown, with detail the code or no code and the message or String of the value",
        async () => {
          const unknown = (detail: string) => ({
            recipient: "a@x.example",
            kind: "unknown",
            detail,
          });
          for (const code of codes) {
            expect(await thrown(fail(code))).toEqual(unknown(`${code}: said no`));
          }
          expect(await thrown(fail(500))).toEqual(unknown("no code: said no"));
          expect(await thrown(new Error("said no"))).toEqual(unknown("no code: said no"));
          expect(await thrown("just text")).toEqual(unknown("no code: just text"));
        },
      );
    });

    Scenario("providerId is a non-empty string or null", ({ Given, When, Then }) => {
      let results: unknown[];
      let ids: unknown[];

      Given("results with a messageId, with an empty one, with a number, and no object", () => {
        results = [{ messageId: "m1" }, { messageId: "" }, { messageId: 7 }, undefined];
      });

      When("bindingTransport sends", async () => {
        ids = [];
        for (const result of results) {
          const [outcome] = await bindingTransport({ send: async () => result }, make).send(
            MESSAGE,
          );
          ids.push(outcome);
        }
      });

      Then("the first gives that id and the others null, with text null", () => {
        const accepted = (providerId: string | null) => ({
          recipient: "a@x.example",
          kind: "accepted",
          providerId,
          text: null,
        });
        expect(ids).toEqual([accepted("m1"), accepted(null), accepted(null), accepted(null)]);
      });
    });

    Scenario(
      "make throwing is a refusal, since nothing was handed over",
      ({ Given, When, Then }) => {
        let sent: number;
        let transport: ReturnType<typeof bindingTransport>;

        Given("a make that throws", () => {
          sent = 0;
          transport = bindingTransport(
            {
              send: async () => {
                sent += 1;
              },
            },
            () => {
              throw new Error("bad address");
            },
          );
        });

        When("bindingTransport sends", () => {
          // transport.send runs inside the Then, wrapped by its expect.
        });

        Then(
          "the outcome is refused, stage provider, not final, and the binding was not called",
          async () => {
            expect(await transport.send(MESSAGE)).toEqual([
              {
                recipient: "a@x.example",
                kind: "refused",
                final: false,
                stage: "provider",
                code: null,
                text: "bad address",
              },
            ]);
            expect(sent).toBe(0);
          },
        );
      },
    );

    Scenario(
      "A socket is opened with TLS on, and its opening is bounded",
      ({ Given, When, Then }) => {
        let options: unknown[];
        let closed: number;
        let fake: (opened: Promise<unknown>) => Connect;
        const address = { hostname: "smtp.resend.com", port: 465 };

        Given(
          "a fake Connect that opens, one whose opened rejects, and one whose opened never settles",
          () => {
            options = [];
            closed = 0;
            fake =
              (opened: Promise<unknown>): Connect =>
              (_address, given) => {
                options.push(given);
                const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
                return {
                  readable,
                  writable,
                  opened,
                  close: async () => {
                    closed += 1;
                  },
                };
              };
          },
        );

        When("socketConnection runs", () => {
          // socketConnection runs inside the Then, around and within its expect lines.
        });

        Then(
          "the options are secureTransport on and allowHalfOpen false, the first gives a Connection, and the others reject",
          async () => {
            const conn = await socketConnection(fake(Promise.resolve()), address);
            const line = conn.line();
            await conn.write(new TextEncoder().encode("220 ready\r\n"));
            expect(await line).toBe("220 ready");
            await conn.close();
            expect(closed).toBe(1);
            expect(options[0]).toEqual({ secureTransport: "on", allowHalfOpen: false });

            await expect(
              socketConnection(fake(Promise.reject(new Error("no"))), address),
            ).rejects.toThrow("no");
            const never = new Promise(() => {});
            await expect(socketConnection(fake(never), address, { timeoutMs: 5 })).rejects.toThrow(
              "within 5 ms",
            );
          },
        );
      },
    );

    Scenario("No package imports a Cloudflare runtime module", ({ Given, When, Then }) => {
      let folders: URL[];
      let sources: [string, string][];

      Given("the source of packages/cloudflare and packages/resend", () => {
        folders = ["../src/", "../../resend/src/"].map((pkg) => new URL(pkg, import.meta.url));
      });

      When("it is read", () => {
        sources = folders.flatMap((folder) =>
          readdirSync(folder).map((file): [string, string] => [
            file,
            readFileSync(new URL(file, folder), "utf8"),
          ]),
        );
      });

      Then("neither cloudflare:email nor cloudflare:sockets appears in an import", () => {
        for (const [file, source] of sources) {
          expect(source, file).not.toMatch(/from\s+"cloudflare:(email|sockets)"/);
          expect(source, file).not.toMatch(/import\(\s*"cloudflare:(email|sockets)"/);
        }
      });
    });
  },
  owns(
    "FR-MAIL-029-c1",
    "FR-MAIL-029-c2",
    "FR-MAIL-029-c3",
    "FR-MAIL-029-c4",
    "FR-MAIL-029-c5",
    "FR-MAIL-029-c6",
    "FR-MAIL-029-c7",
    "FR-MAIL-029-c8",
  ),
);
