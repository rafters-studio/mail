import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import { z } from "zod";
import { messageIdSchema } from "../src/message-id/index.ts";
import { binary, readMessage } from "../src/read/index.ts";
import type { Outcome } from "../src/send/index.ts";
import { createSubmission, writeNotice, type SubmitSession } from "../src/submit/index.ts";
import { criterion } from "./criterion.ts";
import { createRandom, now } from "./env.ts";
import { GOLDENS, HOST, PASSWORD, PLAIN, USER, type Golden } from "./submit/goldens.ts";
import {
  answerTo,
  fakePorts,
  latin1,
  logIn,
  say,
  send,
  sentText,
  session,
} from "./submit/harness.ts";

// A message with every field a session would otherwise write, for tests of what it leaves alone.
const DATED = "Date: Mon, 2 Mar 2026 10:00:00 -0700\r\nMessage-ID: <kept@rafters.studio>\r\n";
const FROM = "From: sean@rafters.studio\r\n";
const WRITTEN_DATE = "Date: Mon, 2 Mar 2026 17:00:00 +0000";

/** RFC 5321 2.3.8's bytes: the hash the hold takes, with the UTC day when there is no Date. */
function holdHash(mailbox: string, message: string, day = ""): string {
  return createHash("sha256")
    .update(latin1(`${mailbox}\0${message}${day}`))
    .digest("hex");
}

/** Each turn of a golden, its client bytes whole, against a session of the fake ports. */
async function driveWhole(golden: Golden, resume: boolean): Promise<void> {
  const { ports } = fakePorts();
  let s: SubmitSession = session(ports);
  expect(binary(s.greeting()), golden.name).toBe(`220 ${HOST} ESMTP\r\n`);
  for (const { client, server, inside } of golden.turns) {
    expect(await say(s, client), `${golden.name}: ${client}`).toBe(server);
    if (resume && inside !== true) {
      s = session(ports, { resume: JSON.parse(JSON.stringify(s.snapshot())) });
    }
  }
}

/** A golden one byte at a time: the replies, joined, are the golden's. */
async function driveBytes(golden: Golden): Promise<void> {
  const s = session(fakePorts().ports);
  for (const { client, server } of golden.turns) {
    let replies = "";
    for (const c of client) replies += await say(s, c);
    expect(replies, `${golden.name}: ${client}`).toBe(server);
  }
}

criterion("FR-MAIL-040-c1", async () => {
  for (const golden of GOLDENS) {
    await driveWhole(golden, false);
    await driveBytes(golden);
    // Pipelined, as a client may: everything at once, read one command at a time.
    const s = session(fakePorts().ports);
    const client = golden.turns.map((t) => t.client).join("");
    expect(await say(s, client), golden.name).toBe(golden.turns.map((t) => t.server).join(""));
  }
});

criterion("FR-MAIL-040-c2", async () => {
  for (const golden of GOLDENS) await driveWhole(golden, true);
});

criterion("FR-MAIL-040-c3", async () => {
  const fake = fakePorts();
  const live = session(fake.ports);
  await logIn(live);
  await say(live, "MAIL FROM:<sean@rafters.studio>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n");
  expect(live.snapshot().phase).toEqual({ name: "data", mailbox: "box" });
  const s = session(fake.ports, { resume: JSON.parse(JSON.stringify(live.snapshot())) });
  expect(await say(s, "RCPT TO:<x>\r\n")).toBe("421 Connection lost\r\n");
  expect(s.closed()).toBe(true);
  expect(s.snapshot().phase).toEqual({ name: "closed" });
  expect(await say(s, "NOOP\r\n")).toBe("");
  expect(fake.submitted).toEqual([]);
});

criterion("FR-MAIL-040-c4", async () => {
  // Past 65,536 octets, so the message store grows as a real upload's does.
  const maxSize = 100_000;
  const fake = fakePorts();
  const server = createServer((socket) => {
    const s = createSubmission({
      ports: fake.ports,
      hostname: HOST,
      now,
      limits: { maxSize },
    });
    socket.write(s.greeting());
    socket.on("data", (chunk) => {
      void s.receive(chunk).then((reply) => {
        socket.write(reply);
        if (s.closed()) socket.end();
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = z.object({ port: z.number() }).parse(server.address());

  const small = `${FROM}To: mary@example.net\r\n${DATED}`;
  const room = `${WRITTEN_DATE}\r\n`.length + "Message-ID: <@rafters.studio>\r\n".length + 64;
  const head = `${FROM}To: mary@example.net\r\n\r\n`;
  const line = `${"x".repeat(996)}\r\n`;
  const fill = maxSize - room - head.length;
  const filler = line.repeat(Math.floor(fill / line.length));
  const rest = fill - filler.length;
  const atLimit = `${head}${filler}${"y".repeat(rest - 2)}\r\n`;
  const scenarios = [
    { mechanism: "PLAIN", to: ["mary@example.net"], message: `${small}\r\nBody\r\n` },
    { mechanism: "LOGIN", to: ["mary@example.net"], message: `${small}\r\nLogin\r\n` },
    {
      mechanism: "PLAIN",
      to: ["mary@example.net", "hidden@example.org"],
      message: `${small}Bcc: hidden@example.org\r\n\r\nBlind\r\n`,
    },
    { mechanism: "PLAIN", to: ["mary@example.net"], message: `${small}\r\n.lead\r\n..two\r\n` },
    { mechanism: "PLAIN", to: ["mary@example.net"], message: atLimit },
  ].map((scenario) => ({ ...scenario, from: "sean@rafters.studio" }));

  const script = fileURLToPath(new URL("./submit/smtplib_client.py", import.meta.url));
  const child = spawn("python3", ["-I", script, String(address.port)]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  child.stdin.end(JSON.stringify(scenarios));
  const [code] = await once(child, "close");
  server.close();
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toEqual([{}, {}, {}, {}, {}]);

  const [plain, login, blind, period, limit] = fake.submitted;
  expect(sentText(plain)).toBe(`${small}\r\nBody\r\n`);
  expect(sentText(login)).toBe(`${small}\r\nLogin\r\n`);
  expect(sentText(blind)).toBe(`${small}\r\nBlind\r\n`);
  expect(blind?.to).toEqual(["mary@example.net", "hidden@example.org"]);
  expect(sentText(period)).toBe(`${small}\r\n.lead\r\n..two\r\n`);
  expect(limit?.bytes.length).toBe(maxSize);
});

criterion("FR-MAIL-040-c5", async () => {
  for (const smuggled of ["\n.\n", "\n.\r\n", "\r\n.\n", "\r.\r", "\r.\r\n", "\r\n.\rx"]) {
    const fake = fakePorts();
    const s = session(fake.ports);
    await logIn(s);
    // The second MAIL FROM is what a smuggler hopes a server reads as a command: here it is body text.
    const message = `${FROM}${DATED}\r\nhello${smuggled}MAIL FROM:<x@y.z>\r\n`;
    expect(await send(s, message), JSON.stringify(smuggled)).toBe("554 Bad message\r\n");
    expect(fake.submitted, JSON.stringify(smuggled)).toEqual([]);
  }
});

criterion("FR-MAIL-040-c6", async () => {
  const cases = [
    ["NOOP\nQUIT\r\n", "500 bad line ending\r\n"],
    ["NOOP\rQUIT\r\n", "500 bad line ending\r\n"],
    [`${"x".repeat(511)}\r\nQUIT\r\n`, "500 line too long\r\n"],
    [`MAIL ${"x".repeat(1006)}\r\nQUIT\r\n`, "500 line too long\r\n"],
  ] as const;
  for (const [client, reply] of cases) {
    for (const bytewise of [false, true]) {
      const s = session(fakePorts().ports);
      let replies = "";
      for (const part of bytewise ? client : [client]) replies += await say(s, part);
      expect(replies, client.slice(0, 20)).toBe(reply);
      expect(s.closed()).toBe(true);
    }
  }
  // The longest lines allowed, with their CRLF, are still read: the limit is not one short.
  const s = session(fakePorts().ports);
  expect(await say(s, `${"x".repeat(510)}\r\n`)).toBe("502 Not implemented\r\n");
  expect(await say(s, `MAIL ${"x".repeat(1005)}\r\n`)).toBe("530 Authentication required\r\n");
  expect(await say(s, "AUTH PLAIN\r\n")).toBe("334 \r\n");
  expect(await say(s, `${"x".repeat(12_287)}\r\n`)).toBe("500 line too long\r\n");
});

criterion("FR-MAIL-040-c7", async () => {
  const encode = (text: string): string => btoa(text);
  const one = async (...lines: string[]): Promise<string[]> => {
    const s = session(fakePorts().ports);
    const replies: string[] = [];
    for (const line of lines) replies.push(await say(s, `${line}\r\n`));
    return replies;
  };
  expect(await one("AUTH PLAIN !!!!")).toEqual(["501 Bad encoding\r\n"]);
  expect(await one(`AUTH PLAIN ${encode("no nuls")}`)).toEqual(["501 Bad encoding\r\n"]);
  expect(await one(`AUTH PLAIN ${encode("a\0b\0c\0d")}`)).toEqual(["501 Bad encoding\r\n"]);
  expect(await one("AUTH PLAIN", "*")).toEqual(["334 \r\n", "501 Bad encoding\r\n"]);
  expect(await one("AUTH LOGIN", "*")).toEqual(["334 VXNlcm5hbWU6\r\n", "501 Bad encoding\r\n"]);
  expect(await one(`AUTH LOGIN ${USER}`, "*")).toEqual([
    "334 UGFzc3dvcmQ6\r\n",
    "501 Bad encoding\r\n",
  ]);
  expect(await one("AUTH GSSAPI")).toEqual(["504 Unknown mechanism\r\n"]);
  expect(await one(`AUTH PLAIN ${encode("other\0user\0password")}`)).toEqual([
    "535 Bad credentials\r\n",
  ]);
  expect(await one(`AUTH PLAIN ${encode("user\0user\0password")}`)).toEqual(["235 Ok\r\n"]);
  expect(await one(`AUTH PLAIN ${encode("\0user\0wrong")}`)).toEqual(["535 Bad credentials\r\n"]);
  expect(await one("AUTH LOGIN", USER, PASSWORD)).toEqual([
    "334 VXNlcm5hbWU6\r\n",
    "334 UGFzc3dvcmQ6\r\n",
    "235 Ok\r\n",
  ]);
  expect(await one(`AUTH LOGIN ${USER}`, PASSWORD)).toEqual(["334 UGFzc3dvcmQ6\r\n", "235 Ok\r\n"]);

  const throwing = fakePorts({
    login: async () => {
      throw new Error("D1 is down");
    },
  });
  const outage = session(throwing.ports);
  for (let i = 0; i < 4; i++) {
    expect(await say(outage, `AUTH PLAIN ${PLAIN}\r\n`)).toBe("454 Try again\r\n");
  }
  expect(outage.closed()).toBe(false);

  // Only a 535 counts: the 501, 504 and 454 between them close nothing, and the count is saved.
  const wrong = `AUTH PLAIN ${encode("\0user\0wrong")}\r\n`;
  let s = session(fakePorts().ports);
  expect(await say(s, wrong)).toBe("535 Bad credentials\r\n");
  expect(await say(s, "AUTH PLAIN !!!!\r\n")).toBe("501 Bad encoding\r\n");
  expect(await say(s, "AUTH GSSAPI\r\n")).toBe("504 Unknown mechanism\r\n");
  expect(await say(s, wrong)).toBe("535 Bad credentials\r\n");
  s = session(fakePorts().ports, { resume: s.snapshot() });
  expect(s.snapshot().failures).toBe(2);
  expect(await say(s, `${wrong}NOOP\r\n`)).toBe("535 Bad credentials\r\n421 Too many failures\r\n");
  expect(s.closed()).toBe(true);
});

criterion("FR-MAIL-040-c8", async () => {
  const fake = fakePorts();
  const s = session(fake.ports);
  const pipelined = "MAIL FROM:<sean@rafters.studio>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n";
  expect(await say(s, pipelined)).toBe(
    "530 Authentication required\r\n503 Bad sequence\r\n503 Bad sequence\r\n",
  );
  expect(fake.submitted).toEqual([]);
});

criterion("FR-MAIL-040-c9", async () => {
  const mail = async (line: string, fake = fakePorts()): Promise<string> => {
    const s = session(fake.ports);
    await logIn(s);
    return say(s, `${line}\r\n`);
  };
  const own = "MAIL FROM:<sean@rafters.studio>";
  expect(await mail("MAIL FROM:<sean smith@rafters.studio>")).toBe("501 Bad address\r\n");
  expect(await mail("MAIL FROM:<sean@localhost>")).toBe("501 Bad address\r\n");
  expect(await mail(`${own} SIZE=26214001`)).toBe("552 Too large\r\n");
  expect(await mail(`${own} SIZE=26214000`)).toBe("250 Ok\r\n");
  expect(await mail(`${own} size=100`)).toBe("250 Ok\r\n");
  expect(await mail(`${own} SMTPUTF8`)).toBe("555 Unknown parameter\r\n");
  expect(await mail(`${own} BODY=8BITMIME`)).toBe("555 Unknown parameter\r\n");
  expect(await mail(`${own} SIZE=lots`)).toBe("555 Unknown parameter\r\n");
  expect(await mail("MAIL FROM:<ceo@rafters.studio>")).toBe("553 Not your address\r\n");
  const down = fakePorts({
    mayUse: async () => {
      throw new Error("D1 is down");
    },
  });
  expect(await mail(own, down)).toBe("451 Try again\r\n");
  expect(await mail(`${own} AUTH=<>`)).toBe("250 Ok\r\n");
  expect(await mail(`${own} BODY=7BIT`)).toBe("250 Ok\r\n");
  expect(await mail("mail from:<>")).toBe("250 Ok\r\n");
  // A null path asks the directory nothing: identity rests on the From check.
  const asked = vi.fn(async () => false);
  expect(await mail("MAIL FROM:<>", fakePorts({ mayUse: asked }))).toBe("250 Ok\r\n");
  expect(asked).not.toHaveBeenCalled();
});

criterion("FR-MAIL-040-c10", async () => {
  const start = async (limits: { maxRecipients?: number } = {}): Promise<SubmitSession> => {
    const s = session(fakePorts().ports, { limits });
    await logIn(s);
    await say(s, "MAIL FROM:<sean@rafters.studio>\r\n");
    return s;
  };
  for (const [address, reply] of [
    ["<mary@localhost>", "501 Bad address\r\n"],
    ["<@a.example,@b.example:mary@example.net>", "501 Bad address\r\n"],
    ["<mary@[192.0.2.1]>", "501 Bad address\r\n"],
    ["<mary@example.net,jane@example.net>", "501 Bad address\r\n"],
    ["<mary@two@example.net>", "501 Bad address\r\n"],
    ["<mary>", "501 Bad address\r\n"],
    ["<>", "501 Bad address\r\n"],
    ["<mary@example.net> NOTIFY=NEVER", "555 Unknown parameter\r\n"],
  ] as const) {
    expect(await say(await start(), `RCPT TO:${address}\r\n`), address).toBe(reply);
  }
  const s = await start({ maxRecipients: 2 });
  expect(await say(s, "rcpt to:<mary@example.net>\r\n")).toBe("250 Ok\r\n");
  expect(await say(s, "RCPT TO:<jane@example.net>\r\n")).toBe("250 Ok\r\n");
  expect(await say(s, "RCPT TO:<john@example.net>\r\n")).toBe("452 Too many recipients\r\n");
  // A repeat at the limit is not one more, and is named once.
  expect(await say(s, "RCPT TO:<mary@example.net>\r\n")).toBe("250 Ok\r\n");
  expect(s.snapshot().phase).toMatchObject({ to: ["mary@example.net", "jane@example.net"] });
});

criterion("FR-MAIL-040-c11", async () => {
  const body = `${DATED}\r\nBody\r\n`;
  const refused = [
    `From: sean@rafters.studio\r\nFrom: ceo@rafters.studio\r\n${body}`,
    `From: ceo@rafters.studio\r\nFrom: sean@rafters.studio\r\n${body}`,
    `From: sean@rafters.studio, alias@rafters.studio\r\n${body}`,
    body,
    `From: staff: sean@rafters.studio;\r\n${body}`,
    `${FROM}Sender: sean@rafters.studio\r\nSender: alias@rafters.studio\r\n${body}`,
    `${FROM}Sender: ceo@rafters.studio\r\n${body}`,
    `${FROM}Sender: not an address\r\n${body}`,
    `From: ceo@rafters.studio\r\n${body}`,
    `From: sean@localhost\r\n${body}`,
  ];
  for (const message of refused) {
    const fake = fakePorts();
    expect(await answerTo(fake, message), message).toBe("553 Not your address\r\n");
    expect(fake.submitted).toEqual([]);
  }
  const down = fakePorts();
  const s = session(down.ports);
  await logIn(s);
  await say(s, "MAIL FROM:<>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n");
  down.ports.mayUse = async () => {
    throw new Error("D1 is down");
  };
  expect(await say(s, `${FROM}${body}.\r\n`)).toBe("451 Try again\r\n");
});

criterion("FR-MAIL-040-c12", async () => {
  const body = `${DATED}\r\nBody\r\n`;
  const allowed = [
    {
      from: "sean@rafters.studio",
      header: "From: alias@rafters.studio",
      as: "alias@rafters.studio",
    },
    { from: "", header: "From: sean@rafters.studio", as: "sean@rafters.studio" },
    {
      from: "sean@rafters.studio",
      header: 'From: "Sean S." <Sean@rafters.studio>',
      as: "Sean@rafters.studio",
    },
    {
      from: "sean@rafters.studio",
      header: `${FROM}Sender: boss@rafters.studio`,
      as: "sean@rafters.studio",
    },
  ];
  for (const { from, header, as } of allowed) {
    const fake = fakePorts();
    const s = session(fake.ports);
    await logIn(s);
    expect(await send(s, `${header}\r\n${body}`, { from }), header).toBe("250 Ok\r\n");
    expect(fake.submitted[0]?.from, header).toBe(as);
  }
});

criterion("FR-MAIL-040-c13", async () => {
  const blind = [
    "Bcc: hidden@example.org\r\n",
    "BCC: hidden@example.org\r\n",
    "Bcc\t: hidden@example.org\r\n",
    "Bcc: hidden@example.org,\r\n\tother@example.org\r\n",
    "Bcc: one@example.org\r\nBcc: two@example.org\r\n",
    "Resent-Bcc: hidden@example.org\r\n",
  ];
  const before = `${FROM}X-Bcc: stays@example.org\r\n Folded: stays\r\n`;
  const after = `${DATED}\r\nBcc: this body line stays\r\n`;
  for (const field of blind) {
    const fake = fakePorts();
    expect(await answerTo(fake, `${before}${field}${after}`), field).toBe("250 Ok\r\n");
    expect(sentText(fake.submitted[0]), field).toBe(`${before}${after}`);
  }
  // A message that is all header has no blank line for the scan to stop at.
  const fake = fakePorts();
  expect(await answerTo(fake, `${FROM}${DATED}Bcc: hidden@example.org\r\n`)).toBe("250 Ok\r\n");
  expect(sentText(fake.submitted[0])).toBe(`${FROM}${DATED}`);
});

criterion("FR-MAIL-040-c14", async () => {
  const date = "Date: Mon, 2 Mar 2026 10:00:00 -0700\r\n";
  const rest = `${FROM}${date}\r\nBody\r\n`;
  const expected = (message: string): string => `<${holdHash("box", message)}@rafters.studio>`;
  for (const field of [
    "",
    "Message-ID:\r\n",
    "Message-ID: not an id\r\n",
    "Message-ID: <a@b.example>\r\nMessage-ID: <c@d.example>\r\n",
    "Message-ID:\r\n <folded@\r\n",
  ]) {
    const fake = fakePorts();
    const message = `${field}${rest}`;
    expect(await answerTo(fake, message), field).toBe("250 Ok\r\n");
    expect(sentText(fake.submitted[0]), field).toBe(`Message-ID: ${expected(message)}\r\n${rest}`);
    expect(fake.submitted[0]?.messageId, field).toBe(expected(message).slice(1, -1));
  }
  const fake = fakePorts();
  const kept = `Message-ID: <kept@rafters.studio>\r\n${rest}`;
  await answerTo(fake, kept);
  expect(sentText(fake.submitted[0])).toBe(kept);
  expect(fake.submitted[0]?.messageId).toBe("kept@rafters.studio");
});

criterion("FR-MAIL-040-c15", async () => {
  const fake = fakePorts();
  const message = `${FROM}Message-ID: <kept@rafters.studio>\r\n\r\nBody\r\n`;
  expect(await answerTo(fake, message)).toBe("250 Ok\r\n");
  expect(sentText(fake.submitted[0])).toBe(`${WRITTEN_DATE}\r\n${message}`);
  expect(readMessage(latin1(sentText(fake.submitted[0]))).date?.instant).toEqual(now());
});

criterion("FR-MAIL-040-c16", async () => {
  for (const bad of ["caf\xe9", "nul\0", "x".repeat(999)]) {
    const fake = fakePorts();
    const s = session(fake.ports);
    await logIn(s);
    await say(s, "MAIL FROM:<sean@rafters.studio>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n");
    const reply = await say(s, `${FROM}${DATED}\r\n${bad}\r\n.\r\nNOOP\r\n`);
    expect(reply, bad.slice(0, 8)).toBe("554 Bad message\r\n250 Ok\r\n");
    expect(fake.submitted).toEqual([]);
  }
  // 998 octets and a CRLF is the 1,000 the rule allows.
  const fake = fakePorts();
  expect(await answerTo(fake, `${FROM}${DATED}\r\n${"x".repeat(998)}\r\n`)).toBe("250 Ok\r\n");
});

criterion("FR-MAIL-040-c17", async () => {
  const room = `${FROM}Message-ID: <kept@rafters.studio>\r\n\r\n`;
  const maxSize = room.length + 20;
  const send20 = async (head: string): Promise<[string, number]> => {
    const fake = fakePorts();
    const s = session(fake.ports, { limits: { maxSize } });
    await logIn(s);
    const reply = await send(s, `${head}${"x".repeat(18)}\r\n`);
    return [reply, fake.submitted.length];
  };
  // At maxSize as received, with no Date: what mail writes pushes it past.
  expect(await send20(room)).toEqual(["552 Too large\r\n", 0]);
  // Past maxSize as received, the whole message is still read and the next command is in step.
  const fake = fakePorts();
  const s = session(fake.ports, { limits: { maxSize: 10 } });
  await logIn(s);
  await say(s, "MAIL FROM:<sean@rafters.studio>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n");
  expect(await say(s, `${FROM}${DATED}\r\nBody\r\n.\r\nNOOP\r\n`)).toBe(
    "552 Too large\r\n250 Ok\r\n",
  );
  expect(fake.submitted).toEqual([]);
});

/** One refusal, final, with this text. */
function refusedFinally(recipient: string, text: string): Outcome {
  return { recipient, kind: "refused", final: true, stage: "data", code: 550, text };
}

criterion("FR-MAIL-040-c18", async () => {
  const replyTo = async (text: string): Promise<string> => {
    const fake = fakePorts({ submit: async () => [refusedFinally("mary@example.net", text)] });
    return answerTo(fake, `${FROM}${DATED}\r\nBody\r\n`);
  };
  expect(await replyTo("no such user\r\n250 Ok")).toBe("554 no such user\r\n");
  expect(await replyTo("a\tb")).toBe("554 a\r\n");
  expect(await replyTo("x".repeat(500))).toBe(`554 ${"x".repeat(400)}\r\n`);
  // A character the limit would split is dropped whole, so the client is given no broken text.
  const split = await replyTo(`${"x".repeat(399)}é`);
  expect(split).toBe(`554 ${"x".repeat(399)}\r\n`);
  // A line break late in the text cannot supply a reply: the next command is still answered alone.
  const fake = fakePorts({
    submit: async () => [refusedFinally("mary@example.net", "bad\r\n250 Ok")],
  });
  const s = session(fake.ports);
  await logIn(s);
  await say(s, "MAIL FROM:<sean@rafters.studio>\r\nRCPT TO:<mary@example.net>\r\nDATA\r\n");
  expect(await say(s, `${FROM}${DATED}\r\nBody\r\n.\r\nNOOP\r\n`)).toBe("554 bad\r\n250 Ok\r\n");
});

criterion("FR-MAIL-040-c19", async () => {
  const s = createSubmission({
    ports: fakePorts().ports,
    hostname: HOST,
    limits: { maxSize: 1000, maxRecipients: 1 },
  });
  expect(await say(s, "EHLO client.example\r\n")).toBe(
    `250-${HOST}\r\n250-SIZE 1000\r\n250 AUTH PLAIN LOGIN\r\n`,
  );
  await logIn(s);
  expect(await say(s, "MAIL FROM:<sean@rafters.studio> SIZE=1001\r\n")).toBe("552 Too large\r\n");
  await say(s, "MAIL FROM:<sean@rafters.studio>\r\n");
  expect(await say(s, "RCPT TO:<mary@example.net>\r\n")).toBe("250 Ok\r\n");
  expect(await say(s, "RCPT TO:<jane@example.net>\r\n")).toBe("452 Too many recipients\r\n");
});

// The outcome table's four kinds, each by its recipient's place in the envelope.
const KINDS = {
  accepted: (recipient: string): Outcome => ({
    recipient,
    kind: "accepted",
    providerId: null,
    text: null,
  }),
  final: (recipient: string): Outcome => refusedFinally(recipient, `refused ${recipient}`),
  notFinal: (recipient: string): Outcome => ({
    recipient,
    kind: "refused",
    final: false,
    stage: "data",
    code: 451,
    text: "later",
  }),
  unknown: (recipient: string): Outcome => ({
    recipient,
    kind: "unknown",
    detail: "connection lost after the message began",
  }),
};
type Kind = keyof typeof KINDS;
const ALL_KINDS: Kind[] = ["accepted", "final", "notFinal", "unknown"];

/** The form's outcome table, written out: what a set of kinds answers, first refusal named. */
function tableReply(kinds: Kind[], first: string): string {
  if (kinds.includes("accepted")) return "250 Ok\r\n";
  if (kinds.includes("notFinal")) return "451 Try again\r\n";
  if (kinds.includes("unknown")) return "250 Ok\r\n";
  return `554 refused ${first}\r\n`;
}

criterion("FR-MAIL-041-c1", async () => {
  const lists: Kind[][] = ALL_KINDS.flatMap((a) => [
    [a],
    ...ALL_KINDS.flatMap((b) => [[a, b], ...ALL_KINDS.map((c) => [a, b, c])]),
  ]);
  expect(lists).toHaveLength(4 + 16 + 64);
  for (const kinds of lists) {
    const to = kinds.map((_, i) => `r${i}@example.net`);
    const fake = fakePorts({
      submit: async () => kinds.map((kind, i) => KINDS[kind](`r${i}@example.net`)),
    });
    const s = session(fake.ports);
    await logIn(s);
    const reply = await send(s, `${FROM}${DATED}\r\nBody\r\n`, { to });
    expect(reply, kinds.join()).toBe(tableReply(kinds, String(to[0])));
    expect(s.snapshot().phase, kinds.join()).toEqual({ name: "ready", mailbox: "box" });
    // A notice only after a 250 that has a failure to report.
    const failed = kinds.some((k) => k !== "accepted");
    expect(fake.notices.length, kinds.join()).toBe(failed && reply.startsWith("250") ? 1 : 0);
  }
});

/** The hold key a session gives a message, in a mailbox, on a day. */
async function holdKeyOf(
  message: string,
  options: { mailbox?: string; at?: string } = {},
): Promise<string> {
  const fake = fakePorts({ login: async () => options.mailbox ?? "box" });
  const s = session(fake.ports, { now: () => new Date(options.at ?? "2026-03-02T17:00:00Z") });
  await logIn(s);
  await send(s, message);
  const [input] = fake.submitted;
  if (input === undefined) throw new Error("nothing was submitted");
  return input.holdKey;
}

criterion("FR-MAIL-041-c2", async () => {
  const message = `${FROM}${DATED}\r\nBody\r\n`;
  const key = await holdKeyOf(message);
  expect(messageIdSchema.safeParse(key).success).toBe(true);
  expect(key).toBe(`${holdHash("box", message)}@hold.invalid`);
  expect(await holdKeyOf(message)).toBe(key);
  expect(await holdKeyOf(`${FROM}${DATED}\r\nEdited\r\n`)).not.toBe(key);
  expect(await holdKeyOf(message, { mailbox: "other" })).not.toBe(key);
});

criterion("FR-MAIL-041-c3", async () => {
  const noDate = `${FROM}Message-ID: <kept@rafters.studio>\r\n\r\nBody\r\n`;
  const today = { at: "2026-03-02T01:00:00Z" };
  const laterToday = { at: "2026-03-02T23:00:00Z" };
  const tomorrow = { at: "2026-03-03T01:00:00Z" };
  expect(await holdKeyOf(noDate, today)).toBe(await holdKeyOf(noDate, laterToday));
  expect(await holdKeyOf(noDate, today)).not.toBe(await holdKeyOf(noDate, tomorrow));
  expect(await holdKeyOf(noDate, today)).toBe(
    `${holdHash("box", noDate, "2026-03-02")}@hold.invalid`,
  );
  const dated = `${FROM}${DATED}\r\nBody\r\n`;
  expect(await holdKeyOf(dated, today)).toBe(await holdKeyOf(dated, tomorrow));
});

criterion("FR-MAIL-041-c4", async () => {
  const replyTo = (error: unknown): Promise<string> =>
    answerTo(
      fakePorts({
        submit: async () => {
          throw error;
        },
      }),
      `${FROM}${DATED}\r\nBody\r\n`,
    );
  expect(await replyTo(new TypeError("send: bare LF"))).toBe("554 Bad message\r\n");
  expect(z.string().safeParse(1).error).toBeInstanceOf(z.ZodError);
  expect(await replyTo(z.string().safeParse(1).error)).toBe("554 Bad message\r\n");
  expect(await replyTo(new Error("D1 is down"))).toBe("451 Try again\r\n");
  expect(await replyTo("not even an error")).toBe("451 Try again\r\n");
});

criterion("FR-MAIL-041-c5", async () => {
  const events: string[] = [];
  const fake = fakePorts({
    submit: async () => [
      KINDS.accepted("mary@example.net"),
      KINDS.final("jane@example.net"),
      KINDS.unknown("john@example.net"),
    ],
    notify: async (mailbox, bytes, to) => {
      events.push("notify");
      fake.notices.push({ mailbox, bytes, to });
    },
  });
  const s = session(fake.ports);
  await logIn(s);
  const to = ["mary@example.net", "jane@example.net", "john@example.net"];
  await send(s, `${FROM}${DATED}\r\nBody\r\n`, { to }).then((reply) => {
    events.push(reply);
  });
  expect(events).toEqual(["notify", "250 Ok\r\n"]);
  const [notice] = fake.notices;
  expect(notice?.mailbox).toBe("box");
  expect(notice?.to).toBe("sean@rafters.studio");
  const text = binary(notice?.bytes ?? new Uint8Array());
  const read = readMessage(notice?.bytes ?? new Uint8Array());
  expect(read.from).toMatchObject([{ local: "postmaster", domain: "rafters.studio" }]);
  expect(read.to).toMatchObject([{ local: "sean", domain: "rafters.studio" }]);
  expect(text).toContain("jane@example.net");
  expect(text).toContain("john@example.net");
  expect(text).not.toContain("mary@example.net");

  // A row still sending will be asked about again, so no notice reports it.
  const quiet = fakePorts({
    submit: async () => [
      KINDS.accepted("mary@example.net"),
      {
        recipient: "jane@example.net",
        kind: "refused",
        final: false,
        stage: "provider",
        code: null,
        text: "still sending",
      },
    ],
  });
  const q = session(quiet.ports);
  await logIn(q);
  const both = { to: ["mary@example.net", "jane@example.net"] };
  expect(await send(q, `${FROM}${DATED}\r\nBody\r\n`, both)).toBe("250 Ok\r\n");
  expect(quiet.notices).toEqual([]);
});

criterion("FR-MAIL-041-c6", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const outcome = (text: string): Outcome[] => [
    KINDS.accepted("mary@example.net"),
    refusedFinally("jane@example.net", text),
  ];
  const run = async (
    head: string,
    text = "550 no such user",
  ): Promise<{ reply: string; notice: Uint8Array | undefined }> => {
    const fake = fakePorts({ submit: async () => outcome(text), mayUse: async () => true });
    const s = session(fake.ports);
    await logIn(s);
    const reply = await send(s, `${head}${DATED}\r\nBody\r\n`, {
      to: ["mary@example.net", "jane@example.net"],
    });
    return { reply, notice: fake.notices[0]?.bytes };
  };
  const subjectOf = (bytes: Uint8Array | undefined): string | null =>
    readMessage(bytes ?? new Uint8Array()).subject;

  const tabbed = await run(`${FROM}Subject: one\r\n\ttwo\r\n`);
  expect(tabbed.reply).toBe("250 Ok\r\n");
  expect(subjectOf(tabbed.notice)).toBe("Not delivered: one two");

  // No line may pass 1,000 octets, so 2,000 unbroken characters arrive as adjacent encoded words.
  const word = `=?UTF-8?Q?${"x".repeat(500)}?=`;
  const long = await run(`${FROM}Subject: ${[word, word, word, word].join("\r\n ")}\r\n`);
  expect(long.reply).toBe("250 Ok\r\n");
  expect(subjectOf(long.notice)).toBe(`Not delivered: ${"x".repeat(200)}`);

  const encoded = await run(`${FROM}Subject: =?UTF-8?B?${btoa("one\r\ntwo")}?=\r\n`);
  expect(encoded.reply).toBe("250 Ok\r\n");
  expect(subjectOf(encoded.notice)).toBe("Not delivered: one  two");

  const none = await run(FROM);
  expect(none.reply).toBe("250 Ok\r\n");
  expect(subjectOf(none.notice)).toBe("Not delivered:");

  const provider = await run(FROM, "550 first\r\n250 Ok");
  expect(provider.reply).toBe("250 Ok\r\n");
  const body = binary(provider.notice ?? new Uint8Array());
  expect(body).toContain("550 first");
  expect(body).not.toContain("250 Ok");

  // readMessage reads no From with a trailing dot, so this is writeNotice's own rule.
  const dotted = await writeNotice({
    key: "hold jane@example.net",
    from: "sean@rafters.studio.",
    to: "sean@rafters.studio.",
    recipients: ["jane@example.net"],
    what: "550 no such user",
    subject: "Hello",
    random: createRandom(),
    now,
  });
  const read = readMessage(dotted);
  expect(read.from).toMatchObject([{ local: "postmaster", domain: "rafters.studio" }]);
  expect(read.to).toMatchObject([{ local: "sean", domain: "rafters.studio" }]);
  expect(error).not.toHaveBeenCalled();

  // A notice that cannot be written: a quoted local part is not dot-atom text. Logged, and still 250.
  const unwritable = await run('From: "sean"@rafters.studio\r\n');
  expect(unwritable.reply).toBe("250 Ok\r\n");
  expect(unwritable.notice).toBeUndefined();
  expect(error).toHaveBeenCalledTimes(1);

  // A notify that throws: logged, and still 250.
  const fake = fakePorts({
    submit: async () => outcome("550 no such user"),
    notify: async () => {
      throw new Error("the mailbox is down");
    },
  });
  expect(await answerTo(fake, `${FROM}${DATED}\r\nBody\r\n`)).toBe("250 Ok\r\n");
  expect(error).toHaveBeenCalledTimes(2);
  expect(String(error.mock.lastCall?.[0])).toContain("the mailbox is down");
  error.mockRestore();

  // The platform's own clock and entropy write a notice as well as a test's do.
  const own = fakePorts({ submit: async () => outcome("550 no such user") });
  const live = createSubmission({ ports: own.ports, hostname: HOST });
  await logIn(live);
  expect(await send(live, `${FROM}${DATED}\r\nBody\r\n`)).toBe("250 Ok\r\n");
  expect(own.notices).toHaveLength(1);
});

criterion("FR-MAIL-041-c7", async () => {
  const write = (key: string): Promise<Uint8Array> =>
    writeNotice({
      key,
      from: "sean@rafters.studio",
      to: "sean@rafters.studio",
      recipients: ["jane@example.net"],
      what: "550 no such user",
      subject: "Hello",
      random: createRandom(),
      now,
    });
  const idOf = async (key: string): Promise<string> => {
    const read = readMessage(await write(key));
    expect(read.fields.filter((f) => f.name === "Message-ID")).toHaveLength(1);
    return String(read.messageId);
  };
  const first = await idOf("hold jane@example.net");
  expect(await idOf("hold jane@example.net")).toBe(first);
  expect(first).toMatch(/^[0-9a-f]{64}@rafters\.studio$/);
  expect(messageIdSchema.safeParse(first).success).toBe(true);
  expect(await idOf("hold john@example.net")).not.toBe(first);

  // The session's own key: a retry's notice collapses, whatever order the recipients failed in.
  const noticeId = async (order: Kind[]): Promise<string> => {
    const addresses = ["jane@example.net", "john@example.net"];
    const fake = fakePorts({
      submit: async () => order.map((kind, i) => KINDS[kind](String(addresses[i]))),
    });
    const s = session(fake.ports);
    await logIn(s);
    await send(s, `${FROM}${DATED}\r\nBody\r\n`, { to: addresses });
    return String(readMessage(fake.notices[0]?.bytes ?? new Uint8Array()).messageId);
  };
  expect(await noticeId(["unknown", "unknown"])).toBe(await noticeId(["unknown", "unknown"]));
  expect(await noticeId(["unknown", "unknown"])).not.toBe(await noticeId(["unknown", "accepted"]));
});
