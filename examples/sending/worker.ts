// The deployable Worker for the facts only a real send settles (form 01a19d25). It is the one place
// `cloudflare:sockets` and `cloudflare:email` are imported; the packages take them as arguments.
import { EmailMessage } from "cloudflare:email";
import { connect } from "cloudflare:sockets";
import {
  bindingTransport,
  d1History,
  d1Sends,
  type EmailBinding,
  sendingWorker,
  type SendingBindings,
  socketConnection,
} from "@rafters/mail-cloudflare";
import { createMail, type Written } from "@rafters/mail/message";
import { createSender, smtpTransport, type Transport } from "@rafters/mail/send";
import { fromResend, RESEND_SMTP, resendLogin, verifyWebhook } from "@rafters/mail-resend";

type Env = SendingBindings & {
  EMAIL: EmailBinding;
  TRANSPORT: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  TEST_SEND_SECRET: string;
};

const json = (value: unknown, status = 200) => Response.json(value, { status });
const refuse = (status: number) => new Response(null, { status });

const heard = sendingWorker<Env>({
  resend: async (request, env) => {
    const id = request.headers.get("svix-id");
    const body = await request.text();
    const authentic = await verifyWebhook({
      secret: env.RESEND_WEBHOOK_SECRET,
      id,
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
      body,
      now: new Date(),
    });
    return authentic && id !== null ? fromResend(id, JSON.parse(body)) : null;
  },
});

/** Form 01a19d25: the bearer secret, compared through an HMAC of both values. */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`Bearer ${env.TEST_SEND_SECRET}`),
  );
  const given = encoder.encode(request.headers.get("authorization") ?? "");
  return crypto.subtle.verify("HMAC", key, expected, given);
}

type TestSend = { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string };

const ADDRESS = /^[^@\s]+@[^@\s]+$/;
const isAddress = (value: unknown): value is string =>
  typeof value === "string" && ADDRESS.test(value);
const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isAddress);

/** Form 01a19d25: the body of POST /test-send, or null when it is malformed. */
function testSend(value: unknown): TestSend | null {
  if (typeof value !== "object" || value === null) return null;
  const { from, to, cc, bcc, subject }: Record<string, unknown> = { ...value };
  if (!isAddress(from) || typeof subject !== "string" || !isList(to)) return null;
  if ((cc !== undefined && !isList(cc)) || (bcc !== undefined && !isList(bcc))) return null;
  return { from, to, subject, ...(cc && { cc }), ...(bcc && { bcc }) };
}

// Keyed by outside text, so a Map: the TRANSPORT variable names one of these.
const TRANSPORTS = new Map<string, (env: Env, ehlo: string) => Transport>([
  [
    "resend",
    (env, ehlo) =>
      smtpTransport({
        name: "resend",
        open: () => socketConnection(connect, RESEND_SMTP),
        ehlo,
        login: resendLogin(env.RESEND_API_KEY),
      }),
  ],
  [
    "cloudflare",
    (env) => bindingTransport(env.EMAIL, (from, to, raw) => new EmailMessage(from, to, raw)),
  ],
]);

/** Form 01a19d25: writes one message, sends it by the transport TRANSPORT names, returns the Sent. */
async function postTestSend(request: Request, env: Env): Promise<Response> {
  const input = testSend(await request.json().catch(() => null));
  const make = TRANSPORTS.get(env.TRANSPORT);
  if (input === null) return refuse(400);
  if (make === undefined) throw new Error(`TRANSPORT names nothing: ${env.TRANSPORT}`);
  const domain = input.from.slice(input.from.indexOf("@") + 1);
  const mailbox = (address: string) => {
    const at = address.indexOf("@");
    return { addr: { local: address.slice(0, at), domain: address.slice(at + 1) } };
  };
  const mailboxes = (list: string[]) => list.map(mailbox);
  let written: Written;
  try {
    written = createMail({ domain }).compose({
      from: mailbox(input.from),
      to: mailboxes(input.to),
      ...(input.cc && { cc: mailboxes(input.cc) }),
      ...(input.bcc && { bcc: mailboxes(input.bcc) }),
      subject: input.subject,
    })({ doc: [{ p: ["A test of mail's sending path."] }] });
  } catch {
    return refuse(400);
  }
  const send = createSender({ transport: make(env, domain), sends: d1Sends(env.MAIL_DB) });
  return json(await send(written));
}

export default {
  queue: heard.queue,
  fetch: async (request: Request, env: Env): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const history = /^\/history\/([^/]+)$/.exec(pathname)?.[1];
    const testing = request.method === "POST" && pathname === "/test-send";
    const reading = request.method === "GET" && history !== undefined;
    if (!testing && !reading) return heard.fetch(request, env);
    if (!(await authorized(request, env))) return refuse(401);
    if (testing) return postTestSend(request, env);
    return json(await d1History(env.MAIL_DB)(decodeURIComponent(history ?? "")));
  },
};
