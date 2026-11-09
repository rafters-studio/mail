// Keeping what was sent, answering a retry from its row, and one object per connection, on the real
// send log and directory (FR-MAIL-042, FR-MAIL-043).
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { binary } from "../../core/src/read/index.ts";
import { criterion } from "../../core/tests/criterion.ts";
import { bindingTransport, imapWorker } from "../src/index.ts";
import { fakeState, gate, MAILBOX, migration, UpgradeResponse, USER } from "./imap-world.ts";
import { BYTES, input, submitWorld, SubmitSession } from "./submit-world.ts";
import { clock } from "./clock.ts";

// A 26 MB message takes seconds to decode, and each login derives a key.
vi.setConfig({ testTimeout: 60_000 });

const T = Date.parse("2026-11-02T12:00:00.000Z");
const SENT = `${MAILBOX}/Sent`;
const WINDOW = 900_000;

/** A row in `sends` as an earlier attempt left it. */
function seed(
  w: ReturnType<typeof submitWorld>,
  recipient: string,
  state: string,
  updatedAt: number,
  columns: { final?: number; stage?: string; text?: string; providerId?: string } = {},
) {
  w.db
    .prepare(
      "INSERT INTO sends (message_id, recipient, mail_from, provider, state, final, stage, text, provider_id, updated_at) VALUES (?, ?, ?, 'cloudflare', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "h1@hold.invalid",
      recipient,
      USER,
      state,
      columns.final ?? null,
      columns.stage ?? null,
      columns.text ?? null,
      columns.providerId ?? null,
      new Date(updatedAt).toISOString(),
    );
}

beforeEach(() => {
  vi.stubGlobal("Response", UpgradeResponse);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  clock.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

criterion("FR-MAIL-042-c1", async () => {
  const w = submitWorld();
  const to = ["a@x.example", "b@x.example"];
  const outcomes = await w.ports().submit(input({ to }));
  expect(outcomes.map((o) => [o.recipient, o.kind])).toEqual([
    ["a@x.example", "accepted"],
    ["b@x.example", "accepted"],
  ]);
  expect(w.handed.map((m) => m.to)).toEqual(to);
  expect(w.blobs.get("sha256/k1")).toEqual(BYTES);
  expect(w.rows("SELECT blob, mailbox, mail_from, rcpt_to, via FROM deliveries")).toEqual([
    {
      blob: "sha256/k1",
      mailbox: SENT,
      mail_from: USER,
      rcpt_to: "a@x.example, b@x.example",
      via: "submission",
    },
  ]);
  expect(w.rows("SELECT hold_key, mailbox, message_id, subject, blob FROM submissions")).toEqual([
    {
      hold_key: "h1@hold.invalid",
      mailbox: MAILBOX,
      message_id: "v1@rafters.studio",
      subject: "Hi",
      blob: "sha256/k1",
    },
  ]);
  expect(w.pings).toEqual([`name:${SENT}`]);
});

criterion("FR-MAIL-042-c2", async () => {
  const w = submitWorld();
  w.email.answer = () => ({ code: "E_RECIPIENT_SUPPRESSED", message: "no" });
  const [outcome] = await w.ports().submit(input());
  expect(outcome?.kind).toBe("refused");
  expect(w.blobs.size).toBe(0);
  expect(w.rows("SELECT * FROM deliveries")).toEqual([]);
  expect(w.rows("SELECT hold_key FROM submissions")).toEqual([{ hold_key: "h1@hold.invalid" }]);
  expect(w.pings).toEqual([]);
});

criterion("FR-MAIL-042-c3", async () => {
  const failing: ((w: ReturnType<typeof submitWorld>) => void)[] = [
    (w) => {
      w.r2.put = async () => {
        throw new Error("put");
      };
    },
    (w) => {
      w.fails.sql = /INSERT INTO deliveries/;
    },
    (w) => {
      w.swap.reach = () => ({
        ping: async () => {
          throw new Error("ping");
        },
      });
    },
  ];
  for (const fail of failing) {
    const w = submitWorld();
    fail(w);
    const logged = vi.mocked(console.error);
    logged.mockClear();
    const outcomes = await w.ports().submit(input());
    expect(outcomes.map((o) => o.kind)).toEqual(["accepted"]);
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain("h1@hold.invalid");
  }
});

criterion("FR-MAIL-042-c4", async () => {
  clock.set(T);
  // Each step of Keeping failing leaves what a crash there leaves; the first two also throw out of the port.
  const steps: ((w: ReturnType<typeof submitWorld>) => () => void)[] = [
    (w) => {
      w.fails.sql = /INTO submissions/;
      return () => {
        w.fails.sql = null;
      };
    },
    (w) => {
      w.fails.sql = /UPDATE sends/;
      return () => {
        w.fails.sql = null;
      };
    },
    (w) => {
      const { put } = w.r2;
      w.r2.put = async () => {
        throw new Error("put");
      };
      return () => {
        w.r2.put = put;
      };
    },
    (w) => {
      w.fails.sql = /INTO mailboxes/;
      return () => {
        w.fails.sql = null;
      };
    },
    (w) => {
      w.fails.sql = /INTO deliveries/;
      return () => {
        w.fails.sql = null;
      };
    },
    (w) => {
      w.swap.reach = () => ({
        ping: async () => {
          throw new Error("ping");
        },
      });
      return () => {
        w.swap.reach = () => ({ ping: async () => undefined });
      };
    },
  ];
  for (const crash of steps) {
    const w = submitWorld();
    const recover = crash(w);
    await w
      .ports()
      .submit(input())
      .catch(() => undefined);
    recover();
    clock.advance(WINDOW + 1);
    const retried = await w.ports().submit(input());
    const again = await w.ports().submit(input());
    expect(w.handed).toHaveLength(1);
    expect(retried.map((o) => o.kind)).toEqual(again.map((o) => o.kind));
    expect(await w.uids(SENT)).toBe(1);
  }
});

criterion("FR-MAIL-042-c5", async () => {
  clock.set(T);
  const w = submitWorld();
  const old = T - WINDOW - 1;
  seed(w, "z@x.example", "accepted", old);
  seed(w, "c@x.example", "unknown", old, { text: "code: lost" });
  seed(w, "b@x.example", "refused", old, { final: 1, stage: "provider", text: "suppressed" });
  seed(w, "a@x.example", "accepted", old, { providerId: "cf-a" });
  const outcomes = await w
    .ports()
    .submit(input({ to: ["a@x.example", "new@x.example", "b@x.example", "c@x.example"] }));
  expect(outcomes).toEqual([
    { recipient: "a@x.example", kind: "accepted", providerId: "cf-a", text: null },
    { recipient: "new@x.example", kind: "accepted", providerId: "cf-new@x.example", text: null },
    {
      recipient: "b@x.example",
      kind: "refused",
      final: true,
      stage: "provider",
      code: null,
      text: "suppressed",
    },
    { recipient: "c@x.example", kind: "unknown", detail: "code: lost" },
  ]);
  expect(w.handed.map((m) => m.to)).toEqual(["new@x.example"]);

  // An unknown row is told of as mail, to the sender's own INBOX with no send.
  const notice = new TextEncoder().encode(
    "Message-ID: <n@rafters.studio>\r\n\r\nmay not have gone\r\n",
  );
  await w.ports().notify(MAILBOX, notice, USER);
  expect(w.rows("SELECT mailbox, mail_from, rcpt_to FROM deliveries WHERE via = 'notice'")).toEqual(
    [{ mailbox: MAILBOX, mail_from: null, rcpt_to: USER }],
  );
  expect(w.pings.at(-1)).toBe(`name:${MAILBOX}`);
});

criterion("FR-MAIL-042-c6", async () => {
  clock.set(T);
  const w = submitWorld();
  seed(w, "young@x.example", "unknown", T - WINDOW + 1);
  seed(w, "old@x.example", "unknown", T - WINDOW);
  const [young, old] = await w.ports().submit(input({ to: ["young@x.example", "old@x.example"] }));
  expect(young).toEqual({
    recipient: "young@x.example",
    kind: "refused",
    final: false,
    stage: "provider",
    code: null,
    text: "still sending",
  });
  expect(old).toEqual({
    recipient: "old@x.example",
    kind: "unknown",
    detail: "no answer recorded",
  });
  expect(w.handed).toEqual([]);

  // The session tells nobody of a row still sending: the app is asked to try again.
  const alone = submitWorld();
  seed(alone, "young@x.example", "unknown", T);
  const [only] = await alone.ports().submit(input({ to: ["young@x.example"] }));
  expect(only?.kind).toBe("refused");
  expect(alone.rows("SELECT * FROM deliveries")).toEqual([]);
});

criterion("FR-MAIL-042-c12", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_receiving.sql"));
  db.exec("INSERT INTO mailboxes (id) VALUES ('a'), ('b');");
  const sql = migration("0004_sent.sql");
  const statement = /^INSERT[^;]+;/m.exec(sql)?.[0] ?? "";
  db.exec(statement);
  db.exec(statement);
  const ids = db.prepare("SELECT id FROM mailboxes ORDER BY id").all();
  expect(ids.map((row) => row["id"])).toEqual(["a", "a/Sent", "b", "b/Sent"]);

  // The world's mailbox is made after the migration, and foreign keys are on.
  const w = submitWorld();
  expect(w.rows(`SELECT id FROM mailboxes WHERE id = '${SENT}'`)).toEqual([]);
  await w.ports().submit(input());
  expect(w.rows(`SELECT id FROM mailboxes WHERE id = '${SENT}'`)).toEqual([{ id: SENT }]);
  expect(w.rows("SELECT mailbox FROM deliveries")).toEqual([{ mailbox: SENT }]);
});

criterion("FR-MAIL-042-c13", async () => {
  const bytes = new Uint8Array(26 * 1000 * 1000).fill(0x61);
  bytes.set([0x0d, 0x0a], bytes.length - 2);
  let raw = "";
  const transport = bindingTransport({ send: async () => undefined }, (from, to, given) => {
    raw = given;
    return { from, to };
  });
  const from = vi.spyOn(Array, "from");
  await transport.send({ bytes, envelope: { from: "me@x.example", to: ["a@x.example"] } });
  const perByte = from.mock.calls.filter(([items]) => items === bytes);
  from.mockRestore();
  expect(perByte).toEqual([]);
  expect(raw === Buffer.from(bytes).toString("latin1")).toBe(true);
});

criterion("FR-MAIL-042-c14", async () => {
  const w = submitWorld();
  w.db
    .exec(`INSERT INTO addresses (local, domain, mailbox) VALUES ('sean+tag', 'rafters.studio', '${MAILBOX}');
INSERT INTO addresses (local, domain, mailbox) VALUES ('sean+theirs', 'rafters.studio', 'mbx-other');
INSERT INTO addresses (local, domain, mailbox, enabled) VALUES ('off', 'rafters.studio', '${MAILBOX}', 0);`);
  const { mayUse } = w.ports();
  expect(await mayUse(MAILBOX, "Se.an@rafters.studio")).toBe(true);
  expect(await mayUse(MAILBOX, "sean+tag@rafters.studio")).toBe(true);
  expect(await mayUse(MAILBOX, "sean+theirs@rafters.studio")).toBe(false);
  expect(await mayUse(MAILBOX, "off@rafters.studio")).toBe(false);
  expect(await mayUse(MAILBOX, "ceo@rafters.studio")).toBe(false);
  expect(await mayUse(MAILBOX, "no-domain")).toBe(false);
});

criterion("FR-MAIL-043-c1", async () => {
  const w = submitWorld();
  const client = await w.loggedIn();
  await client.frame(`MAIL FROM:<${USER}>\r\nRCPT TO:<a@x.example>\r\n`);
  client.own.length = 0;
  await client.frame("DATA\r\n");
  expect(client.own.at(0)).toBe("write");
  expect(client.own.at(-1)).toBe("send");
  expect(client.own.filter((step) => step === "send")).toHaveLength(1);
  const [saved] = client.state.mem.sql.exec("SELECT v FROM state WHERE k = 'snapshot'");
  expect(String(saved?.["v"])).toContain('"name":"data"');
  expect(client.text()).toContain("354 ");
});

criterion("FR-MAIL-043-c2", async () => {
  const w = submitWorld();
  const started = vi.spyOn(globalThis, "setInterval");
  const ended = vi.spyOn(globalThis, "clearInterval");
  const client = await w.inData();
  expect(started).toHaveBeenCalledOnce();
  expect(started.mock.calls[0]?.[1]).toBe(5_000);
  await client.frame(`From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nfirst\r\n`);
  // A pause: the timer runs, and the message is still in memory.
  started.mock.calls[0]?.[0]();
  expect(started).toHaveBeenCalledOnce();
  expect(ended).not.toHaveBeenCalled();
  const before = client.text().length;
  await client.frame("second\r\n.\r\n");
  expect(client.text(before)).toBe("250 Ok\r\n");
  expect(w.handed).toHaveLength(1);
  expect(ended).toHaveBeenCalledOnce();

  // Evicted in spite of it, a restart reads nothing as a command.
  const lost = await submitWorld().inData();
  lost.evict();
  const at = lost.text().length;
  await lost.frame(`MAIL FROM:<${USER}>\r\n`);
  expect(lost.text(at)).toBe("421 Connection lost\r\n");
  expect(lost.server.closes).toEqual([1000]);
  expect(ended).toHaveBeenCalledOnce();
});

criterion("FR-MAIL-043-c3", async () => {
  const w = submitWorld();
  const client = await w.loggedIn();
  const writes: string[] = [];
  client.state.mem.hook.refuse = (sql, values) => {
    writes.push(
      `${sql} ${values.map((value) => binary(new TextEncoder().encode(String(value)))).join(" ")}`,
    );
    return false;
  };
  await client.frame(`MAIL FROM:<${USER}>\r\nRCPT TO:<a@x.example>\r\nDATA\r\n`);
  await client.frame(
    `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nthe-marker\r\n.\r\n`,
  );
  await client.frame("NOOP\r\n");
  expect(w.handed).toHaveLength(1);
  expect(writes.length).toBeGreaterThan(0);
  for (const write of writes) expect(write).not.toContain("the-marker");
});

criterion("FR-MAIL-043-c4", async () => {
  clock.set(T);
  const moving = await submitWorld().inData();
  const silent = await submitWorld().inData();
  expect(moving.state.alarm.at).toBe(T + 300_000);

  clock.set(T + 299_000);
  await moving.frame(`From: ${USER}\r\n`);
  expect(moving.state.alarm.at).toBe(T + 599_000);

  clock.set(T + 300_000);
  await moving.fire();
  await silent.fire();
  expect(moving.server.closes).toEqual([]);
  expect(silent.text().endsWith("421 Idle\r\n")).toBe(true);
  expect(silent.server.closes).toEqual([1000]);
  expect(silent.state.alarm.at).toBeNull();
});

criterion("FR-MAIL-043-c5", async () => {
  const ended = (client: { own: string[] }) => expect(client.own).toContain("deleteAll");

  const quit = await submitWorld().connect();
  await quit.frame("NOOP\r\n");
  quit.own.length = 0;
  await quit.frame("NOOP\r\n");
  expect(quit.own).toEqual(["send"]);
  await quit.frame("QUIT\r\n");
  expect(quit.text().endsWith("221 Bye\r\n")).toBe(true);
  expect(quit.server.closes).toEqual([1000]);
  ended(quit);

  for (const leave of ["webSocketClose", "webSocketError"] as const) {
    const gone = await submitWorld().connect();
    await gone.conn.object[leave](gone.server.socket);
    expect(gone.server.closes).toEqual([undefined]);
    ended(gone);
    // With nothing stored the alarm does nothing.
    await gone.conn.object.alarm();
    expect(gone.server.closes).toEqual([undefined]);
  }

  const failing = await submitWorld().loggedIn();
  failing.state.mem.hook.refuse = () => true;
  await failing.frame(`MAIL FROM:<${USER}>\r\n`);
  expect(failing.server.closes).toEqual([1011]);
  ended(failing);

  clock.set(T);
  const never = await submitWorld().connect();
  expect(never.state.alarm.at).toBe(T + 60_000);
  await never.frame("NOOP\r\n");
  expect(never.state.alarm.at).toBe(T + 60_000);
  clock.set(T + 60_000);
  await never.fire();
  expect(never.text()).not.toContain("421");
  expect(never.server.closes).toEqual([1000]);
  ended(never);
  clock.reset();

  const talking = await submitWorld().connect();
  for (let i = 0; i < 100; i++) await talking.frame("NOOP\r\n");
  expect(talking.server.closes).toEqual([]);
  await talking.frame("NOOP\r\n");
  expect(talking.server.closes).toEqual([1000]);
  ended(talking);

  // A call finishing afterward saves and sends nothing.
  const w = submitWorld();
  const late = await w.inData();
  const held = gate();
  const { send } = w.env.EMAIL;
  const reached = gate();
  w.env.EMAIL.send = async (message) => {
    reached.open();
    await held.promise;
    return send(message);
  };
  const finishing = late.frame(
    `From: ${USER}\r\nDate: Mon, 2 Mar 2026 17:00:00 +0000\r\n\r\nbody\r\n.\r\n`,
  );
  // The event: the session has called the binding, and it writes the sends row before that call.
  await reached.promise;
  expect(w.rows("SELECT * FROM sends")).toHaveLength(1);
  const before = late.text().length;
  await late.conn.object.webSocketClose(late.server.socket);
  late.own.length = 0;
  held.open();
  await finishing;
  expect(late.text(before)).toBe("");
  expect(late.own).toEqual([]);
});

criterion("FR-MAIL-043-c6", async () => {
  const w = submitWorld();
  const reached: unknown[] = [];
  const made = {
    idFromName: () => "by-name",
    idFromString: () => "by-string",
    newUniqueId: () => `unique-${reached.length + 1}`,
    get: (id: unknown) => {
      reached.push(id);
      return {
        fetch: async () => new UpgradeResponse(null, { status: 101 }) as unknown as Response,
      };
    },
  };
  const env = { IMAP_SESSION: w.env.IMAP_SESSION, SUBMIT_SESSION: made, BRIDGE_SECRET: "secret" };
  const { fetch } = imapWorker();
  const request = (headers: Record<string, string>) =>
    new Request("https://mail.example/submit", { headers });
  const upgrade = { upgrade: "websocket" };
  const good = { authorization: "Bearer secret", ...upgrade };
  expect((await fetch(request(good), env)).status).toBe(101);
  expect((await fetch(request(good), env)).status).toBe(101);
  expect(reached).toEqual(["unique-1", "unique-2"]);
  expect((await fetch(request(upgrade), env)).status).toBe(401);
  expect(reached).toHaveLength(2);
  const { SUBMIT_SESSION: _, ...imapOnly } = env;
  expect((await fetch(request(good), imapOnly)).status).toBe(404);

  // The object it reaches greets with the name in env, then and after a resume.
  const client = await w.connect();
  expect(client.response.status).toBe(101);
  expect(client.text()).toBe("220 smtp.example ESMTP\r\n");
  client.evict();
  await client.frame("HELO me\r\n");
  expect(client.text()).toBe("220 smtp.example ESMTP\r\n250 smtp.example\r\n");

  // Without a client address it answers 400, and without a name it throws rather than greet wrongly.
  const object = (over: { SUBMIT_HOSTNAME: string }) =>
    new SubmitSession(fakeState({ hex: "alone" }).ctx, { ...w.env, ...over });
  const named = object({ SUBMIT_HOSTNAME: "smtp.example" });
  expect((await named.fetch(new Request("https://mail.example/submit"))).status).toBe(400);
  const nameless = object({ SUBMIT_HOSTNAME: "" });
  await expect(
    nameless.fetch(
      new Request("https://mail.example/submit", { headers: { "X-Client-Address": "192.0.2.1" } }),
    ),
  ).rejects.toThrow();
});
