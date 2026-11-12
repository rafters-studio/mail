// The submission object and its ports over the IMAP world: the real send log, directory and mailbox
// objects on node:sqlite, a binding that records what it is handed, and D1 that fails on request.
import { vi } from "vite-plus/test";
import {
  type D1Like,
  type DurableObjectStateLike,
  submitObject,
  type SubmitBindings,
} from "../src/index.ts";
import { submitPorts } from "../src/submit-object.ts";
import {
  fakeSocket,
  fakeState,
  ImapMailbox,
  type Log,
  login,
  MAILBOX,
  namespace,
  USER,
  world,
} from "./imap-world.ts";
import { clock } from "./clock.ts";

export const make = (from: string, to: string, raw: string) => ({ from, to, raw });

/** The base class the Worker hands over, reduced to what the object needs of it. */
class Base {
  constructor(_ctx: DurableObjectStateLike, _env: SubmitBindings) {}
}
export const SubmitSession = submitObject(Base, make, login, { now: () => clock.now() });

/** A message as `ports.submit` is handed it; CRLF and 7-bit, as `createSender` requires. */
export const BYTES = new TextEncoder().encode(`From: ${USER}\r\nSubject: Hi\r\n\r\nbody\r\n`);
export const input = (
  over: Partial<Parameters<ReturnType<typeof submitPorts>["submit"]>[0]> = {},
) => ({
  mailbox: MAILBOX,
  from: USER,
  to: ["a@x.example"],
  bytes: BYTES,
  holdKey: "h1@hold.invalid",
  blobKey: "sha256/k1",
  messageId: "v1@rafters.studio",
  subject: "Hi",
  ...over,
});

/** A world with a directory, a binding that records, pings that record, and a D1 that can fail. */
export function submitWorld() {
  const w = world();
  w.db
    .exec(`INSERT INTO domains (name, postmaster, catch_all) VALUES ('rafters.studio', '${MAILBOX}', '${MAILBOX}');
INSERT INTO addresses (local, domain, mailbox) VALUES ('sean', 'rafters.studio', '${MAILBOX}');`);
  const handed: { from: string; to: string; raw?: string }[] = [];
  const email = {
    answer: (to: string): unknown => ({ messageId: `cf-${to}` }),
  };
  const hold = { send: async (): Promise<void> => {} };
  const fails: { sql: RegExp | null } = { sql: null };
  const d1: D1Like = {
    prepare: (sql) => {
      if (fails.sql?.test(sql)) throw new Error("D1 failed");
      return w.d1.prepare(sql);
    },
  };
  const pings: string[] = [];
  w.swap.reach = (id) => ({
    ping: async () => {
      pings.push(id);
    },
  });
  const env: SubmitBindings = {
    ...w.env(),
    MAIL_DB: d1,
    MAIL_BLOBS: w.r2,
    EMAIL: {
      send: async (message) => {
        handed.push(message);
        await hold.send();
        const answer = email.answer(message.to);
        if (
          answer instanceof Error ||
          (typeof answer === "object" && answer !== null && "code" in answer)
        )
          throw answer;
        return answer;
      },
    },
    SUBMIT_SESSION: namespace(() => ({
      fetch: async () => new Response(null),
      revoked: async () => 0,
    })),
    SUBMIT_HOSTNAME: "smtp.example",
  };
  const ports = () => submitPorts(env, make, async () => null, { now: () => clock.now() });
  const rows = (sql: string) =>
    w.db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  /** How many messages a mailbox holds after it pulls, as a fresh object on its own state. */
  const uids = async (mailbox: string) => {
    const state = fakeState({ name: mailbox, hex: `pull-${mailbox}` });
    const box = new ImapMailbox(state.ctx, w.env());
    const opened = await box.open("INBOX", "pull");
    return opened?.messages.length;
  };
  /** A new connection: an object on its own state, past its greeting. */
  const connect = async () => {
    const own: Log = [];
    const state = fakeState({ hex: "submit" }, own);
    const client = fakeSocket();
    const server = fakeSocket(own);
    vi.stubGlobal(
      "WebSocketPair",
      class {
        0 = client.socket;
        1 = server.socket;
      },
    );
    const conn = { object: new SubmitSession(state.ctx, env), state, server, own };
    const response = await conn.object.fetch(
      new Request("https://mail.example/submit", {
        headers: { "X-Client-Address": "203.0.113.9" },
      }),
    );
    const octets = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
    /** One frame from the client. */
    const frame = (text: string) => conn.object.webSocketMessage(server.socket, octets(text));
    /** A new instance on the same state, as after an eviction. */
    const evict = () => {
      conn.object = new SubmitSession(state.ctx, env);
    };
    /** Runs the alarm only if its time has come, as the runtime does. */
    const fire = async () => {
      if (state.alarm.at !== null && state.alarm.at <= clock.now()) await conn.object.alarm();
    };
    /** What came back after the login and envelope, past `before` octets. */
    const text = (before = 0) => server.text().slice(before);
    return { conn, state, server, own, response, frame, evict, fire, text };
  };
  /** A connection logged in as the world's user. */
  const loggedIn = async () => {
    const client = await connect();
    await client.frame(`AUTH PLAIN ${btoa(`\0${USER}\0correct horse`)}\r\n`);
    return client;
  };
  /** A logged-in connection whose next frame is the message. */
  const inData = async () => {
    const client = await loggedIn();
    await client.frame(`MAIL FROM:<${USER}>\r\nRCPT TO:<a@x.example>\r\nDATA\r\n`);
    return client;
  };
  return {
    ...w,
    d1,
    env,
    email,
    hold,
    handed,
    fails,
    pings,
    ports,
    rows,
    uids,
    connect,
    loggedIn,
    inData,
  };
}
