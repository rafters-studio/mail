// What the submission tests run against (form 01a19de8, Tests): a session over fake ports that record
// what reached them, driven by binary text, and a message sent through it whole.
import { binary } from "../../src/read/index.ts";
import type { Outcome } from "../../src/send/index.ts";
import {
  createSubmission,
  type SubmitInput,
  type SubmitPorts,
  type SubmitSession,
} from "../../src/submit/index.ts";
import { createRandom, now } from "../env.ts";
import { HOST, PLAIN } from "./goldens.ts";

/** Sean's addresses, as the directory would answer `mayUse`. */
const OWN = new Set(["sean@rafters.studio", "alias@rafters.studio", "boss@rafters.studio"]);

/** Binary text as its octets, one per character. */
export function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** The message bytes that were submitted, as binary text. */
export function sentText(input: SubmitInput | undefined): string {
  if (input === undefined) throw new Error("nothing was submitted");
  return binary(input.bytes);
}

export type Fake = {
  ports: SubmitPorts;
  submitted: SubmitInput[];
  notices: { mailbox: string; bytes: Uint8Array; to: string }[];
};

/** Ports for one mailbox, `box`, whose only login is user and password; every recipient is accepted. */
export function fakePorts(overrides: Partial<SubmitPorts> = {}): Fake {
  const submitted: SubmitInput[] = [];
  const notices: Fake["notices"] = [];
  const ports: SubmitPorts = {
    login: async (user, password) => (user === "user" && password === "password" ? "box" : null),
    mayUse: async (_mailbox, address) => OWN.has(address.toLowerCase()),
    submit: async (input) => {
      submitted.push(input);
      return input.to.map(
        (recipient): Outcome => ({ recipient, kind: "accepted", providerId: null, text: null }),
      );
    },
    notify: async (mailbox, bytes, to) => {
      notices.push({ mailbox, bytes, to });
    },
    ...overrides,
  };
  return { ports, submitted, notices };
}

/** A session with the tests' fixed entropy and clock. */
export function session(
  ports: SubmitPorts,
  more: Partial<Parameters<typeof createSubmission>[0]> = {},
): SubmitSession {
  return createSubmission({ ports, hostname: HOST, random: createRandom(), now, ...more });
}

/** Sends binary text and returns the reply as binary text. */
export async function say(s: SubmitSession, client: string): Promise<string> {
  return binary(await s.receive(latin1(client)));
}

/** Logs in, so a test begins where its scenario does. */
export async function logIn(s: SubmitSession): Promise<void> {
  await say(s, `AUTH PLAIN ${PLAIN}\r\n`);
}

/** The whole of one message after login: MAIL, RCPT, DATA, and its already stuffed lines. */
export async function send(
  s: SubmitSession,
  message: string,
  envelope: { from?: string; to?: string[] } = {},
): Promise<string> {
  const to = envelope.to ?? ["mary@example.net"];
  await say(s, `MAIL FROM:<${envelope.from ?? "sean@rafters.studio"}>\r\n`);
  for (const address of to) await say(s, `RCPT TO:<${address}>\r\n`);
  await say(s, "DATA\r\n");
  return say(s, `${message}.\r\n`);
}

/** A logged in session's answer to a message given as its lines. */
export async function answerTo(fake: Fake, message: string): Promise<string> {
  const s = session(fake.ports);
  await logIn(s);
  return send(s, message);
}
