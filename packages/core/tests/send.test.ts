import { once } from "node:events";
import { SMTPServer } from "smtp-server";
import { expect } from "vitest";
import {
  createSender,
  outcomeSchema,
  smtpTransport,
  streamConnection,
  stuff,
  submit,
  type Connection,
  type Outgoing,
  type Transport,
} from "../src/send/index.ts";
import { CASE_NAMES, testMail, writeCase } from "./cases.ts";
import { criterion } from "./criterion.ts";
import { jane, mary, sean } from "./fixtures/people.ts";
import {
  clientOf,
  dial,
  FROM,
  golden,
  GOLDENS,
  losingServer,
  memorySends,
  MESSAGE,
  octets,
  outgoing,
  scripted,
  scriptedConnection,
  SETTINGS,
  writtenOf,
  type Golden,
  type Row,
  type Step,
} from "./send/script.ts";

const A = "a@example.net";
const B = "b@example.org";
const C = "c@example.com";

/** Plays a golden through streamConnection and submit. */
async function play(g: Golden, bytewise = false) {
  const { conn, client } = scriptedConnection(g.steps, bytewise);
  const outcomes = await submit(conn, SETTINGS, outgoing(g.to));
  return { outcomes, client: client() };
}

/** Fails unless a golden gives its exact client bytes and outcomes. */
async function expectGolden(name: string) {
  const g = golden(name);
  const { outcomes, client } = await play(g);
  expect(client, name).toBe(clientOf(g.steps));
  expect(outcomes, name).toEqual(g.outcomes);
  return { outcomes, client };
}

/** A server's turns from the greeting up to an EHLO reply of these lines, then QUIT. */
function ehloSteps(reply: string): Step[] {
  return [
    { server: "220 mx\r\n", client: "EHLO client.example\r\n" },
    { server: reply, client: "QUIT\r\n" },
    { server: "221 bye\r\n" },
  ];
}

/** A transport answering accepted, recording what it was given. */
function acceptingTransport(name = "fake") {
  const seen: Outgoing[] = [];
  const transport: Transport = {
    name,
    send: async (message) => {
      seen.push(message);
      return message.envelope.to.map((recipient) => ({
        recipient,
        kind: "accepted",
        providerId: null,
        text: null,
      }));
    },
  };
  return { transport, seen };
}

/** A local smtp-server storing what it takes, with hooks to refuse. */
async function realServer(
  hooks: { rcpt?: (address: string) => number | null; data?: () => number | null } = {},
) {
  const stored: Buffer[] = [];
  const refuse = (code: number) =>
    Object.assign(new Error(`refused ${code}`), { responseCode: code });
  const server = new SMTPServer({
    authMethods: ["PLAIN"],
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onAuth: (auth, _session, done) => done(null, { user: auth.username }),
    onRcptTo: (address, _session, done) => {
      const code = hooks.rcpt?.(address.address) ?? null;
      done(code === null ? undefined : refuse(code));
    },
    onData: (stream, _session, done) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        stored.push(Buffer.concat(chunks));
        const code = hooks.data?.() ?? null;
        done(code === null ? undefined : refuse(code));
      });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server.server, "listening");
  const { port } = server.server.address();
  return { port, stored, close: () => new Promise((resolve) => server.close(resolve)) };
}

criterion("FR-MAIL-025-c1", async () => {
  const { outcomes, client } = await expectGolden("accepted");
  expect(client).toBe(
    "EHLO client.example\r\n" +
      "AUTH PLAIN AHVzZXIAcGFzc3dvcmQ=\r\n" +
      `MAIL FROM:<${FROM}>\r\n` +
      `RCPT TO:<${A}>\r\nRCPT TO:<${B}>\r\n` +
      "DATA\r\n" +
      "Subject: x\r\n\r\n..lead\r\nbody\r\n.\r\n" +
      "QUIT\r\n",
  );
  for (const outcome of outcomes) expect(outcomeSchema.parse(outcome)).toEqual(outcome);
});

criterion("FR-MAIL-025-c2", async () => {
  const { port, stored, close } = await realServer();
  const variant = octets(
    "From: sean@rafters.studio\r\n\r\n.one\r\n..two\r\nmid.dle\r\n.\r\nend\r\n",
  );
  const inputs = [...CASE_NAMES.map((name) => writeCase(name).bytes), variant];
  for (const bytes of inputs) {
    const outcomes = await submit(await dial(port), SETTINGS, {
      bytes,
      envelope: { from: FROM, to: [A] },
    });
    expect(outcomes[0]?.kind).toBe("accepted");
  }
  await close();
  expect(stored.map((b) => b.toString("latin1"))).toEqual(
    inputs.map((b) => Buffer.from(b).toString("latin1")),
  );
});

criterion("FR-MAIL-025-c3", async () => {
  const stages = {
    "greeting-refused": "greeting",
    "ehlo-refused": "ehlo",
    "auth-refused": "auth",
    "mail-refused": "mail",
    "data-refused": "data",
  };
  for (const [name, stage] of Object.entries(stages)) {
    const { outcomes, client } = await expectGolden(name);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes)
      expect(outcome).toMatchObject({ kind: "refused", stage, final: false });
    expect(client).not.toContain("Subject");
  }
});

criterion("FR-MAIL-025-c4", async () => {
  const replies = [
    "250 mx\r\n",
    "250-mx\r\n250 AUTH LOGIN PLAIN-CLIENTTOKEN\r\n",
    "250-mx\r\n250 AUTH=PLAIN\r\n",
    "250-AUTH.example.com PLAIN greeting\r\n250 SIZE 1\r\n",
  ];
  for (const reply of replies) {
    const { conn, client } = scriptedConnection(ehloSteps(reply));
    const outcomes = await submit(conn, SETTINGS, outgoing([A, B]));
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        kind: "refused",
        stage: "auth",
        code: null,
        text: "server does not offer AUTH PLAIN",
        final: false,
      });
    }
    expect(client()).not.toContain("AUTH");
  }
});

criterion("FR-MAIL-025-c5", async () => {
  const steps: Step[] = [
    { server: "220 mx\r\n", client: "EHLO client.example\r\n" },
    { server: "250-mx\r\n250 auth login plain\r\n", client: "AUTH PLAIN AHVzZXIAcGFzc3dvcmQ=\r\n" },
    { server: "535 no\r\n", client: "QUIT\r\n" },
    { server: "221 bye\r\n" },
  ];
  const { conn, client } = scriptedConnection(steps);
  await submit(conn, SETTINGS, outgoing([A]));
  expect(client()).toBe(clientOf(steps));
});

criterion("FR-MAIL-025-c6", async () => {
  const login = { user: "user", password: "p€ss" };
  const steps = golden("auth-refused").steps;
  const { conn, client } = scriptedConnection(steps);
  await submit(conn, { ...SETTINGS, login }, outgoing([A]));
  const argument = /AUTH PLAIN (\S+)\r\n/.exec(client())?.[1] ?? "";
  expect(Buffer.from(argument, "base64").toString("utf8")).toBe("\0user\0p€ss");
});

criterion("FR-MAIL-025-c7", async () => {
  // 372 octets of credential are 496 of base64, a line of 509; the next size up is 513.
  const sized = (octets: number) => ({ user: "u", password: "p".repeat(octets - 3) });
  const fits = scriptedConnection(golden("auth-refused").steps);
  await submit(fits.conn, { ...SETTINGS, login: sized(372) }, outgoing([A]));
  expect(fits.client()).toContain("AUTH PLAIN");

  const { conn, client } = scriptedConnection(ehloSteps("250-mx\r\n250 AUTH PLAIN\r\n"));
  const outcomes = await submit(conn, { ...SETTINGS, login: sized(373) }, outgoing([A, B]));
  for (const outcome of outcomes) {
    expect(outcome).toMatchObject({
      kind: "refused",
      stage: "auth",
      code: null,
      text: "credential too long for AUTH PLAIN",
      final: false,
    });
  }
  expect(client()).not.toContain("AUTH");
});

criterion("FR-MAIL-025-c8", async () => {
  await expectGolden("rcpt-refused");
  await expectGolden("rcpt-then-data-refused");

  // The form: the real server "also serves a partial RCPT rejection".
  const { port, close } = await realServer({
    rcpt: (address) => (address === A ? 550 : address === B ? 451 : null),
  });
  const outcomes = await submit(await dial(port), SETTINGS, outgoing([A, B, C]));
  await close();
  expect(outcomes[0]).toMatchObject({ kind: "refused", stage: "rcpt", code: 550, final: true });
  expect(outcomes[1]).toMatchObject({ kind: "refused", stage: "rcpt", code: 451, final: false });
  expect(outcomes[2]).toMatchObject({ kind: "accepted", recipient: C });
});

criterion("FR-MAIL-025-c9", async () => {
  const { outcomes, client } = await expectGolden("rcpt-closed");
  expect(outcomes[1]).toEqual({
    recipient: B,
    kind: "refused",
    final: false,
    stage: "rcpt",
    code: null,
    text: "connection closed",
  });
  expect(client).not.toContain("QUIT");
});

criterion("FR-MAIL-025-c10", async () => {
  const { client } = await expectGolden("none-accepted");
  expect(client).toContain("QUIT\r\n");
  expect(client).not.toContain("DATA");
});

criterion("FR-MAIL-025-c11", async () => {
  for (const name of ["accepted", "terminator-251", "terminator-200"]) {
    const { outcomes } = await expectGolden(name);
    for (const outcome of outcomes)
      expect(outcome).toMatchObject({ kind: "accepted", providerId: null });
  }
  expect((await expectGolden("terminator-251")).outcomes[0]).toMatchObject({ text: "forwarded" });
});

criterion("FR-MAIL-025-c12", async () => {
  const later = await expectGolden("terminator-451");
  expect(later.outcomes[0]).toMatchObject({ kind: "refused", stage: "data", final: false });
  const never = await expectGolden("terminator-554");
  expect(never.outcomes[0]).toMatchObject({ kind: "refused", stage: "data", final: true });

  // The form: the real server also serves "451 and 554 at DATA".
  for (const [code, final] of [
    [451, false],
    [554, true],
  ] as const) {
    const { port, close } = await realServer({ data: () => code });
    const outcomes = await submit(await dial(port), SETTINGS, outgoing([A]));
    await close();
    expect(outcomes[0]).toMatchObject({ kind: "refused", stage: "data", code, final });
  }
});

criterion("FR-MAIL-025-c13", async () => {
  const { outcomes } = await expectGolden("terminator-354");
  expect(outcomes[0]).toEqual({
    recipient: A,
    kind: "unknown",
    detail: "unexpected reply: 354 odd",
  });
});

criterion("FR-MAIL-025-c14", async () => {
  const { port, server } = await losingServer("after");
  const outcomes = await submit(await dial(port), SETTINGS, outgoing([A, B]));
  server.close();
  expect(outcomes).toEqual(
    [A, B].map((recipient) => ({
      recipient,
      kind: "unknown",
      detail: "connection lost after the message began",
    })),
  );
});

criterion("FR-MAIL-025-c15", async () => {
  const { port, server } = await losingServer("during");
  const bytes = octets(`Subject: x\r\n\r\n${"x".repeat(76)}\r\n`.repeat(100_000));
  const outcomes = await submit(await dial(port, 2_000), SETTINGS, {
    bytes,
    envelope: { from: FROM, to: [A] },
  });
  server.close();
  expect(outcomes).toEqual([
    { recipient: A, kind: "unknown", detail: "connection lost after the message began" },
  ]);
});

criterion("FR-MAIL-025-c16", async () => {
  const steps = golden("accepted").steps.slice(0, -1);
  const { conn } = scriptedConnection(steps);
  const started = Date.now();
  const outcomes = await submit(conn, { ...SETTINGS, quitWaitMs: 50 }, outgoing([A, B]));
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(outcomes[0]).toMatchObject({ kind: "accepted" });
});

criterion("FR-MAIL-025-c17", async () => {
  const closes = [
    async () => {
      throw new Error("close failed");
    },
    () => new Promise<void>(() => undefined),
  ];
  for (const close of closes) {
    const { conn } = scriptedConnection(golden("accepted").steps);
    const outcomes = await submit(
      { ...conn, close },
      { ...SETTINGS, quitWaitMs: 20 },
      outgoing([A, B]),
    );
    expect(outcomes[0]).toMatchObject({ kind: "accepted" });
  }
});

criterion("FR-MAIL-025-c18", async () => {
  const bad = scriptedConnection([{ server: "2500 x\r\n" }]);
  const closed = await submit(bad.conn, SETTINGS, outgoing([A]));
  expect(closed[0]).toMatchObject({ stage: "greeting", code: null, text: "connection closed" });
  expect(bad.client()).toBe("");

  const mixed = scriptedConnection(ehloSteps("250-one\r\n550 two\r\n"));
  const refused = await submit(mixed.conn, SETTINGS, outgoing([A]));
  expect(refused[0]).toMatchObject({ stage: "ehlo", code: 550, text: "one\ntwo" });
});

criterion("FR-MAIL-025-c19", async () => {
  const atMail = (conn: Connection, bad: "write" | "line"): Connection => {
    let mail = false;
    return {
      ...conn,
      write: (bytes) => {
        mail = Buffer.from(bytes).toString("latin1").startsWith("MAIL FROM");
        if (mail && bad === "write") throw new Error("write failed");
        return conn.write(bytes);
      },
      line: () => {
        if (mail && bad === "line") throw new Error("line failed");
        return conn.line();
      },
    };
  };
  for (const bad of ["write", "line"] as const) {
    const { conn, client } = scriptedConnection(golden("accepted").steps);
    const outcomes = await submit(atMail(conn, bad), SETTINGS, outgoing([A, B]));
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        kind: "refused",
        stage: "mail",
        code: null,
        text: "connection closed",
        final: false,
      });
    }
    expect(client()).not.toContain("QUIT");
  }
});

criterion("FR-MAIL-025-c20", () => {
  const text = (s: string) => Buffer.from(stuff(octets(s))).toString("latin1");
  expect(text(".a\r\n")).toBe("..a\r\n.\r\n");
  expect(text("a\r\n.b\r\n")).toBe("a\r\n..b\r\n.\r\n");
  expect(text("a.b\r\n")).toBe("a.b\r\n.\r\n");
  expect(text("a\n.b\r\n")).toBe("a\n.b\r\n.\r\n");
  expect(text("")).toBe(".\r\n");
});

criterion("FR-MAIL-025-c21", async () => {
  const thrown: [unknown, string][] = [
    [new Error("no route"), "no route"],
    ["refused by string", "refused by string"],
  ];
  for (const [value, text] of thrown) {
    const transport = smtpTransport({
      name: "fake",
      open: async () => {
        throw value;
      },
      ...SETTINGS,
    });
    const outcomes = await transport.send(outgoing([A, B]));
    for (const [i, recipient] of [A, B].entries()) {
      expect(outcomes[i]).toEqual({
        recipient,
        kind: "refused",
        final: false,
        stage: "connect",
        code: null,
        text,
      });
    }
    expect(outcomes.map((o) => outcomeSchema.parse(o))).toEqual(outcomes);
  }
});

criterion("FR-MAIL-026-c1", async () => {
  const sends = memorySends();
  const claims: Date[] = [];
  const claim = sends.claim;
  sends.claim = (c) => {
    claims.push(c.at);
    return claim(c);
  };
  const seen: (Row | undefined)[] = [];
  const transport: Transport = {
    name: "fake",
    send: async ({ envelope }) => {
      seen.push(...envelope.to.map((r) => sends.rows.get(r)));
      return [];
    },
  };
  const at = new Date("2026-03-02T17:00:00Z");
  await createSender({ transport, sends, now: () => at })(writtenOf(octets(MESSAGE), FROM, [A, B]));
  expect(seen).toEqual([{ state: "unknown" }, { state: "unknown" }]);
  expect(claims).toEqual([at, at]);
});

criterion("FR-MAIL-026-c2", async () => {
  const sends = memorySends();
  const transport: Transport = {
    name: "fake",
    send: async () => {
      throw new Error("transport failed");
    },
  };
  const send = createSender({ transport, sends });
  await expect(send(writtenOf(octets(MESSAGE), FROM, [A, B]))).rejects.toThrow("transport failed");
  expect([...sends.rows.values()]).toEqual([{ state: "unknown" }, { state: "unknown" }]);
});

criterion("FR-MAIL-026-c3", async () => {
  const sends = memorySends(
    new Map<string, Row>([
      [C, { state: "refused", final: true }],
      [A, { state: "accepted" }],
      [B, { state: "unknown" }],
    ]),
  );
  const { transport, seen } = acceptingTransport();
  const sent = await createSender({ transport, sends })(
    writtenOf(octets(MESSAGE), FROM, [A, B, C]),
  );
  expect(seen).toEqual([]);
  expect(sent).toMatchObject({ provider: "fake", outcomes: [], held: [A, B, C] });
});

criterion("FR-MAIL-026-c4", async () => {
  const sends = memorySends(
    new Map<string, Row>([
      [A, { state: "refused", final: false }],
      [B, { state: "accepted" }],
    ]),
  );
  const { transport, seen } = acceptingTransport();
  const sent = await createSender({ transport, sends })(
    writtenOf(octets(MESSAGE), FROM, [A, B, C]),
  );
  expect(seen[0]?.envelope).toEqual({ from: FROM, to: [A, C] });
  expect(sent.held).toEqual([B]);
  expect(sent.outcomes.map((o) => o.recipient)).toEqual([A, C]);
  expect(sends.rows.get(A)).toEqual({ state: "accepted" });
});

criterion("FR-MAIL-026-c5", async () => {
  const sends = memorySends();
  const written = writtenOf(octets(MESSAGE), FROM, [A]);
  const refusing = smtpTransport({
    name: "first",
    open: async () => scriptedConnection(golden("auth-refused").steps).conn,
    ...SETTINGS,
  });
  const first = await createSender({ transport: refusing, sends })(written);
  expect(first.outcomes[0]).toMatchObject({
    kind: "refused",
    stage: "auth",
    code: 535,
    final: false,
  });

  const { transport, seen } = acceptingTransport("second");
  const second = await createSender({ transport, sends })(written);
  expect(seen[0]?.envelope.to).toEqual([A]);
  expect(second.outcomes[0]).toMatchObject({ kind: "accepted", recipient: A });
});

criterion("FR-MAIL-026-c6", async () => {
  const sends = memorySends();
  const written = writtenOf(octets(MESSAGE), FROM, [A, B]);
  const transport = smtpTransport({
    name: "fake",
    open: async () => scriptedConnection(golden("terminator-251").steps).conn,
    ...SETTINGS,
  });
  const send = createSender({ transport, sends });
  expect((await send(written)).outcomes[0]).toMatchObject({ kind: "accepted" });
  const again = await send(written);
  expect(again.outcomes).toEqual([]);
  expect(again.held).toEqual([A, B]);
});

criterion("FR-MAIL-026-c7", async () => {
  const good = octets(MESSAGE);
  const inputs = [
    writtenOf(Uint8Array.of(0x41, 0x80, 0x0d, 0x0a), FROM, [A]),
    writtenOf(octets("a\rb\r\n"), FROM, [A]),
    writtenOf(octets("a\nb\r\n"), FROM, [A]),
    writtenOf(octets("a\r\nb"), FROM, [A]),
    writtenOf(good, "a\u0001@example.net", [A]),
    writtenOf(good, FROM, ["a b@example.net"]),
    writtenOf(good, FROM, ["<a@example.net"]),
    writtenOf(good, FROM, ["a@example.net>"]),
  ];
  for (const written of inputs) {
    const sends = memorySends();
    const { transport, seen } = acceptingTransport();
    await expect(createSender({ transport, sends })(written)).rejects.toThrow(TypeError);
    expect(sends.claims).toBe(0);
    expect(seen).toEqual([]);
  }
});

criterion("FR-MAIL-026-c8", async () => {
  const period = testMail().compose({ from: sean, to: [mary], bcc: [jane], subject: "Dots" })({
    doc: [{ p: [".a line led by a period"] }],
  });
  expect(Buffer.from(period.bytes).toString("latin1")).toMatch(/\r\n\.a line/);
  expect(period.envelope.to).toContain("j-brown@other.example");
  const written = [...CASE_NAMES.map((name) => writeCase(name)), period];
  for (const message of written) {
    const { transport } = acceptingTransport();
    const sent = await createSender({ transport, sends: memorySends() })(message);
    expect(sent.outcomes).toHaveLength(message.envelope.to.length);
  }
});

criterion("FR-MAIL-027-c1", async () => {
  for (const g of GOLDENS) {
    const whole = await play(g);
    const bytewise = await play(g, true);
    expect(whole.client, g.name).toBe(clientOf(g.steps));
    expect(whole.outcomes, g.name).toEqual(g.outcomes);
    expect(bytewise).toEqual(whole);
  }
});

criterion("FR-MAIL-027-c2", async () => {
  const silent = scripted([]);
  const quiet = streamConnection(silent.streams, { timeoutMs: 20 });
  expect(await quiet.line()).toBeNull();
  expect(await quiet.line()).toBeNull();

  let trickle: ReturnType<typeof setInterval> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      trickle = setInterval(() => controller.enqueue(octets("x")), 5);
    },
  });
  const slow = streamConnection(
    { readable, writable: new WritableStream(), close: async () => undefined },
    { timeoutMs: 50 },
  );
  expect(await slow.line()).toBeNull();
  expect(await slow.line()).toBeNull();
  clearInterval(trickle);
});

criterion("FR-MAIL-027-c3", async () => {
  const writable = new WritableStream<Uint8Array>({ write: () => new Promise(() => undefined) });
  const conn = streamConnection(
    { readable: new ReadableStream(), writable, close: async () => undefined },
    { timeoutMs: 20 },
  );
  await expect(conn.write(octets("x"))).rejects.toThrow("no answer within 20 ms");
});

criterion("FR-MAIL-027-c4", async () => {
  const maxLine = 8;
  for (const bytewise of [false, true]) {
    const exact = "x".repeat(maxLine);
    const over = "x".repeat(maxLine + 1);
    const { streams } = scripted([{ server: `${exact}\r\n${over}\r\ngood\r\n` }], bytewise);
    const conn = streamConnection(streams, { maxLine, timeoutMs: 1_000 });
    expect(await conn.line()).toBe(exact);
    expect(await conn.line()).toBeNull();
    expect(await conn.line()).toBeNull();
  }
});

criterion("FR-MAIL-027-c5", async () => {
  const { conn } = scriptedConnection([{ server: "a\nb\r\n\xff\xfe\r\n" }]);
  expect(await conn.line()).toBe("a\nb");
  expect(await conn.line()).toBe("��");
});
