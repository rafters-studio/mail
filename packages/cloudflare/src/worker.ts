// The Email Worker (Cloudflare Email Workers runtime API): the message's to is the "Recipient
// email address (envelope RCPT TO)", its from the envelope MAIL FROM, and raw its bytes. Email
// Routing lists a Worker as a destination only when its default export has no handler but email
// (observed 2026-05-26), so email is all it exports.
import { createReceiver } from "@rafters/mail/receive";
import { type D1Like, d1Deliveries, d1Directory } from "./d1.ts";
import { type R2Like, r2Blobs } from "./r2.ts";

/** The parts of Cloudflare's ForwardableEmailMessage the Worker uses; headers is never read. */
export type CloudflareMessage = {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
};

/** The Worker's bindings, by the names wrangler.jsonc gives them. */
export type Bindings = { MAIL_DB: D1Like; MAIL_BLOBS: R2Like };

/**
 * Form 01a19a5c, The Cloudflare Worker: the bytes as read, checked against rawSize, are received
 * from the envelope alone (never message.headers, which sorts names and joins repeated fields);
 * an empty from is the null reverse-path, and a reject becomes Cloudflare's permanent SMTP error.
 */
export function emailWorker(): {
  email(message: CloudflareMessage, env: Bindings): Promise<void>;
} {
  return {
    async email(message, env) {
      const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
      if (raw.byteLength !== message.rawSize) {
        throw new Error(`raw is ${raw.byteLength} bytes, rawSize says ${message.rawSize}`);
      }
      const receive = createReceiver({
        directory: d1Directory(env.MAIL_DB),
        blobs: r2Blobs(env.MAIL_BLOBS),
        deliveries: d1Deliveries(env.MAIL_DB),
      });
      const verdict = await receive({
        envelope: { mailFrom: message.from === "" ? null : message.from, rcptTo: [message.to] },
        raw,
        receivedAt: new Date(),
        via: "cloudflare",
      });
      if (verdict.kind === "reject") message.setReject("No such user here");
    },
  };
}
