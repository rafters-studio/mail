// The session object with real mailbox and core sessions behind fake state and sockets (FR-MAIL-035).
import { afterEach, beforeEach, expect, vi } from "vitest";
import { criterion } from "../../core/tests/criterion.ts";
import {
  fakeState,
  gate,
  idAt,
  ImapSession,
  login,
  mail,
  MAILBOX,
  UpgradeResponse,
  world,
} from "./imap-world.ts";

// A 25 MiB message takes seconds to read, write and frame.
vi.setConfig({ testTimeout: 60_000 });

const T = 0x019cafbf0000 + 600_000;
const LOGIN = 'a LOGIN sean@rafters.studio "correct horse"\r\n';
const MIB = 1024 * 1024;

/** A world, and one connection past LOGIN and SELECT of one message. */
async function selected() {
  const w = world();
  w.deliver(idAt(T, 1), mail("one@x", "the body"));
  const client = await w.connect();
  await client.frame(LOGIN);
  await client.frame("b SELECT INBOX\r\n");
  await w.mailboxState.settled();
  return { w, client };
}

/** How many mailboxes' sessions are registered. */
const registered = (w: ReturnType<typeof world>) =>
  [...w.mailboxState.mem.sql.exec("SELECT name FROM sessions")].map((r) => r["name"]);

beforeEach(() => {
  vi.stubGlobal("Response", UpgradeResponse);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

criterion("FR-MAIL-035-c1", async () => {
  const w = world();
  const client = await w.connect();
  client.own.length = 0;
  await client.frame("a CAPABILITY\r\nb BAD\r\n");
  await client.frame("c\r\n");
  client.own.length = 0;
  await client.frame(LOGIN);
  expect(client.own.slice(0, 2)).toEqual(["write", "write"]);
  expect(client.own.at(-1)).toBe("send");
  expect(client.own.indexOf("send")).toBeGreaterThan(client.own.lastIndexOf("write"));
});

criterion("FR-MAIL-035-c2", async () => {
  const { client } = await selected();
  await client.frame("c FETCH 1 (U");
  const before = client.server.text().length;
  const woken = client.evict();
  await client.frame("ID)\r\n", woken);
  expect(client.server.text().slice(before)).toBe("* 1 FETCH (UID 1)\r\nc OK FETCH completed\r\n");
});

criterion("FR-MAIL-035-c3", async () => {
  const w = world();
  const client = await w.connect();
  client.own.length = 0;
  for (let i = 0; i < 10; i++) {
    const instance = client.evict();
    for (let j = 0; j < 100; j++) await client.frame(`n NOOP\r\n`, instance);
  }
  expect(client.own.filter((entry) => entry === "write")).toEqual([]);
  expect(client.own.filter((entry) => entry === "send")).toHaveLength(1000);
  expect(client.server.closes).toEqual([]);
  const instance = client.evict();
  for (let j = 0; j < 100; j++) await client.frame(`n NOOP\r\n`, instance);
  expect(client.server.closes).toEqual([]);
  await client.frame(`n NOOP\r\n`, instance);
  expect(client.server.closes).toEqual([1000]);
  expect(client.own.at(-1)).toBe("deleteAll");
  expect(client.own.filter((entry) => entry === "send")).toHaveLength(1100);
});

criterion("FR-MAIL-035-c4", async () => {
  const { w, client } = await selected();
  const body = Uint8Array.from({ length: 25 * MIB }, (_, i) => 65 + (i % 26));
  w.deliver(idAt(T + 1, 2), mail("big@x", new TextDecoder().decode(body)));
  await client.frame("c NOOP\r\n");
  await w.mailbox().ping();
  await w.mailboxState.settled();
  client.server.frames.length = 0;
  await client.frame("d UID FETCH 2 (BODY[])\r\n");
  const { frames } = client.server;
  expect(frames.length).toBeGreaterThan(25);
  expect(Math.max(...frames.map((f) => f.length))).toBeLessThanOrEqual(MIB);
  const joined = client.server.text();
  const start = joined.indexOf("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  expect(joined.slice(start, start + 25 * MIB)).toBe(new TextDecoder().decode(body));
});

criterion("FR-MAIL-035-c5", async () => {
  const { w, client } = await selected();
  await client.frame("c IDLE\r\n");
  w.deliver(idAt(T + 1, 2), mail("two@x"));
  await w.mailbox().ping();
  await w.mailboxState.settled();
  expect(client.server.text()).toContain("* 2 EXISTS");
  expect(registered(w)).toEqual([client.hex]);
});

criterion("FR-MAIL-035-c6", async () => {
  const w = world();
  const silent = await w.connect();
  expect(silent.state.alarm.at).not.toBeNull();
  const logged = await w.connect();
  await logged.frame(LOGIN);
  expect(logged.state.alarm.at).toBeNull();
  const blank = fakeState({ hex: "blank" });
  await new ImapSession(blank.ctx, w.env()).alarm();
  await logged.object.alarm();
  await silent.object.alarm();
  expect(silent.server.closes).toEqual([1000]);
  expect(silent.own.at(-1)).toBe("deleteAll");
  expect(logged.server.closes).toEqual([]);
  expect(logged.own).not.toContain("deleteAll");
});

criterion("FR-MAIL-035-c7", async () => {
  const endings: [string, (c: Awaited<ReturnType<typeof selected>>["client"]) => Promise<void>][] =
    [
      ["logout", (c) => c.frame("c LOGOUT\r\n")],
      ["close", (c) => c.object.webSocketClose(c.server.socket)],
      ["error", (c) => c.object.webSocketError(c.server.socket)],
      ["fatal line", (c) => c.frame("x".repeat(70_000))],
      [
        "store failure",
        (c) => {
          c.state.mem.hook.refuse = (sql) => sql.startsWith("INSERT INTO state");
          return c.frame("c NOOP\r\nd SELECT INBOX\r\n");
        },
      ],
    ];
  for (const [name, ending] of endings) {
    const { w, client } = await selected();
    const forgets: [string, string][] = [];
    const real = w.mailbox();
    w.swap.reach = (id) => ({
      forget: async (session) => {
        forgets.push([id, session]);
        client.own.push("forget");
        await real.forget(session);
      },
    });
    await ending(client);
    expect(forgets, name).toEqual([[`name:${MAILBOX}`, client.hex]]);
    expect(client.own.slice(-2), name).toEqual(["forget", "deleteAll"]);
    expect(registered(w), name).toEqual([]);
  }
});

criterion("FR-MAIL-035-c8", async () => {
  const { w, client } = await selected();
  w.swap.mailbox = { forget: () => Promise.reject(new Error("no answer")) };
  await client.object.webSocketClose(client.server.socket);
  expect(console.error).toHaveBeenCalledWith("imap session: forget failed", expect.any(Error));
  expect(client.own.at(-1)).toBe("deleteAll");
});

criterion("FR-MAIL-035-c9", async () => {
  for (const finish of ["answers", "fails"]) {
    const { w, client } = await selected();
    const held = gate<Uint8Array>();
    w.swap.mailbox = { bytes: () => held.promise };
    const sent = client.server.frames.length;
    const receiving = client.frame("c FETCH 1 (BODY[])\r\n");
    await client.object.webSocketClose(client.server.socket);
    client.own.length = 0;
    client.server.closes.length = 0;
    if (finish === "answers") held.open(new TextEncoder().encode("late"));
    else held.fail(new Error("late"));
    await receiving;
    expect(client.own, finish).toEqual([]);
    expect(client.server.frames.length, finish).toBe(sent);
    expect(client.server.closes, finish).toEqual([]);
  }
});

criterion("FR-MAIL-035-c10", async () => {
  const failing = await selected();
  failing.w.swap.mailbox = { bytes: () => Promise.reject(new Error("no answer")) };
  await failing.client.frame("c FETCH 1 (BODY[])\r\n");
  expect(failing.client.server.closes).toEqual([1011]);
  expect(failing.client.own.at(-1)).toBe("deleteAll");

  const w = world();
  const client = await w.connect();
  await client.frame(LOGIN);
  // 100,000 scattered flags: past 2 MB of saved view, as only a real mailbox shows.
  const messages = Array.from({ length: 100_000 }, (_, i) => ({
    uid: i * 2 + 1,
    flags: ["\\Seen"],
    internalDate: new Date("2026-03-02T17:00:00Z"),
    size: 1,
  }));
  w.swap.mailbox = { open: async () => ({ uidValidity: 1, uidNext: 200_001, messages }) };
  await client.frame("b SELECT INBOX\r\n");
  expect(client.server.closes).toEqual([1011]);
  expect(client.own.at(-1)).toBe("deleteAll");
});

criterion("FR-MAIL-035-c11", async () => {
  const w = world();
  const empty = fakeState({ hex: "empty" });
  expect(await new ImapSession(empty.ctx, w.env()).changed()).toBe(false);
  const closes: (number | undefined)[] = [];
  const unsaved = fakeState({ hex: "unsaved" });
  unsaved.ctx.acceptWebSocket({ send: () => {}, close: (code) => void closes.push(code) });
  expect(await new ImapSession(unsaved.ctx, w.env()).changed()).toBe(false);
  expect(closes).toHaveLength(1);
  const { w: live, client } = await selected();
  live.deliver(idAt(T + 1, 2), mail("two@x"));
  await live.mailbox().ping();
  await client.frame("c IDLE\r\n");
  live.deliver(idAt(T + 2, 3), mail("three@x"));
  await live.mailbox().open("INBOX", "someone");
  const before = client.server.text().length;
  expect(await client.object.changed()).toBe(true);
  expect(client.server.text().slice(before)).toContain("EXISTS");
});

criterion("FR-MAIL-035-c12", async () => {
  const w = world();
  const object = new ImapSession(fakeState({ hex: "no-address" }).ctx, w.env());
  expect((await object.fetch(new Request("https://mail.example/imap"))).status).toBe(400);
  const blank = new Request("https://mail.example/imap", { headers: { "X-Client-Address": "" } });
  expect((await object.fetch(blank)).status).toBe(400);
  const client = await w.connect("198.51.100.44");
  expect(client.response.status).toBe(101);
  await client.frame('a LOGIN sean@rafters.studio "wrong"\r\n', client.evict());
  expect(login).toHaveBeenLastCalledWith("sean@rafters.studio", "wrong", "198.51.100.44");
});

criterion("FR-MAIL-035-c13", async () => {
  const w = world();
  const user = "josé@example.es";
  const client = await w.connect();
  await client.object.webSocketMessage(
    client.server.socket,
    `a LOGIN {${new TextEncoder().encode(user).length}+}\r\n${user} "correct horse"\r\n`,
  );
  expect(client.server.text()).toContain("a OK");
  // The user's octets, as binary text.
  const octets = String.fromCharCode(...new TextEncoder().encode(user));
  expect(login).toHaveBeenLastCalledWith(octets, "correct horse", "203.0.113.9");
});
