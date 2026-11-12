// The Worker in front of the session objects, with a namespace that records what reached it.
import { describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vite-plus/test";
import { feature, owns } from "../../core/tests/feature.ts";
import { imapWorker, type NamespaceOf, type SessionStub } from "../src/index.ts";

const SECRET = "bridge-secret";

/** A namespace answering 200 from a new object, recording each id it made. */
function sessions() {
  const made: unknown[] = [];
  const ns: NamespaceOf<SessionStub> = {
    idFromName: () => "by-name",
    idFromString: () => "by-string",
    newUniqueId: () => `unique-${made.length + 1}`,
    get: (id) => {
      made.push(id);
      return {
        fetch: async () => new Response(null, { status: 200 }),
        changed: async () => true,
      };
    },
  };
  return { ns, made };
}

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://mail.example${path}`, { headers });
const good = { authorization: `Bearer ${SECRET}` };

const FR038 = await feature("FR-MAIL-038");

describeFeature(
  FR038,
  ({ Scenario }) => {
    Scenario("The Worker answers in order", ({ Given, When, Then }) => {
      let ns: NamespaceOf<SessionStub>;
      let made: unknown[];
      let env: { IMAP_SESSION: NamespaceOf<SessionStub>; BRIDGE_SECRET: string };

      Given("another path, a bad secret, no upgrade, and a good request", () => {
        ({ ns, made } = sessions());
        env = { IMAP_SESSION: ns, BRIDGE_SECRET: SECRET };
      });

      When("fetch runs", () => {
        // fetch runs inside the Then, wrapped by each expect.
      });

      Then("they answer 404, 401, 426, and reach a new session object", async () => {
        const { fetch } = imapWorker();
        const upgrade = { upgrade: "WebSocket" };
        expect((await fetch(request("/other", { ...good, ...upgrade }), env)).status).toBe(404);
        expect(
          (await fetch(request("/imap", { authorization: "Bearer wrong", ...upgrade }), env))
            .status,
        ).toBe(401);
        expect((await fetch(request("/imap", upgrade), env)).status).toBe(401);
        expect((await fetch(request("/imap", good), env)).status).toBe(426);
        expect((await fetch(request("/imap", { ...good, upgrade: "h2c" }), env)).status).toBe(426);
        expect(made).toEqual([]);
        expect((await fetch(request("/imap", { ...good, ...upgrade }), env)).status).toBe(200);
        expect((await fetch(request("/imap", { ...good, ...upgrade }), env)).status).toBe(200);
        expect(made).toEqual(["unique-1", "unique-2"]);
      });
    });

    Scenario("Nothing authorizes with no secret", ({ Given, When, Then }) => {
      let ns: NamespaceOf<SessionStub>;
      let made: unknown[];
      let given: Record<string, string>;

      Given("BRIDGE_SECRET unset and empty, and the header Bearer undefined", () => {
        ({ ns, made } = sessions());
        given = { authorization: "Bearer undefined", upgrade: "websocket" };
      });

      When("fetch runs", () => {
        // fetch runs inside the Then, wrapped by each expect.
      });

      Then("each answers 401", async () => {
        const { fetch } = imapWorker();
        expect((await fetch(request("/imap", given), { IMAP_SESSION: ns })).status).toBe(401);
        expect(
          (await fetch(request("/imap", given), { IMAP_SESSION: ns, BRIDGE_SECRET: "" })).status,
        ).toBe(401);
        expect(
          (
            await fetch(request("/imap", { authorization: "Bearer ", upgrade: "websocket" }), {
              IMAP_SESSION: ns,
              BRIDGE_SECRET: "",
            })
          ).status,
        ).toBe(401);
        expect(made).toEqual([]);
      });
    });
  },
  owns("FR-MAIL-038-c1", "FR-MAIL-038-c2"),
);
