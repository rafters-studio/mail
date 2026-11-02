// The Worker in front of the session objects, with a namespace that records what reached it.
import { expect } from "vitest";
import { criterion } from "../../core/tests/criterion.ts";
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

criterion("FR-MAIL-038-c1", async () => {
  const { ns, made } = sessions();
  const env = { IMAP_SESSION: ns, BRIDGE_SECRET: SECRET };
  const { fetch } = imapWorker();
  const upgrade = { upgrade: "WebSocket" };
  expect((await fetch(request("/other", { ...good, ...upgrade }), env)).status).toBe(404);
  expect(
    (await fetch(request("/imap", { authorization: "Bearer wrong", ...upgrade }), env)).status,
  ).toBe(401);
  expect((await fetch(request("/imap", upgrade), env)).status).toBe(401);
  expect((await fetch(request("/imap", good), env)).status).toBe(426);
  expect((await fetch(request("/imap", { ...good, upgrade: "h2c" }), env)).status).toBe(426);
  expect(made).toEqual([]);
  expect((await fetch(request("/imap", { ...good, ...upgrade }), env)).status).toBe(200);
  expect((await fetch(request("/imap", { ...good, ...upgrade }), env)).status).toBe(200);
  expect(made).toEqual(["unique-1", "unique-2"]);
});

criterion("FR-MAIL-038-c2", async () => {
  const { ns, made } = sessions();
  const { fetch } = imapWorker();
  const given = { authorization: "Bearer undefined", upgrade: "websocket" };
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
