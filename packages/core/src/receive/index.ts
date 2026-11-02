// Receiving a message (RFC 5321 4.5.5): "There are several types of notification messages that
// are required by existing and proposed Standards to be sent with a null reverse-path", so a
// delivery's sender may be null. A provider hands mail an envelope and the bytes; mail decides
// whose mail it is from the envelope alone, reading no header, keeps the bytes exactly as handed,
// and records the envelope beside them.
import { z } from "zod";
import type { Random } from "../message/index.ts";
import { uuidv7 } from "../message-id/uuidv7.ts";
import { digest } from "./digest.ts";
import { type Directory, type Found, findMailbox } from "./directory.ts";
import { recipient } from "./recipient.ts";

export {
  type Directory,
  type Domain,
  domainSchema,
  findMailbox,
  type Found,
  type MailboxAddress,
  mailboxAddressSchema,
} from "./directory.ts";
export { canonicalLocal, domainName, type Recipient, recipient } from "./recipient.ts";

/** One reception as an adapter builds it from its provider's input. */
export const deliverySchema = z.strictObject({
  envelope: z.strictObject({
    // null is the null reverse-path, MAIL FROM:<>, RFC 5321 4.5.5.
    mailFrom: z.string().min(1).nullable(),
    rcptTo: z.array(z.string().min(1)).min(1),
  }),
  raw: z.instanceof(Uint8Array),
  receivedAt: z.date(),
  via: z.string().min(1), // the adapter's name, e.g. "cloudflare"
});
export type Delivery = z.infer<typeof deliverySchema>;
export type DeliveryInput = z.input<typeof deliverySchema>;

// accept: stored for these mailboxes. drop: every recipient found only switched-off addresses;
// nothing is stored and the sender is told nothing.
export type Verdict =
  | { kind: "accept"; mailboxes: string[] }
  | { kind: "drop" }
  | { kind: "reject"; reason: "no-such-user" };

/** What is recorded beside the bytes: the envelope, for one mailbox. */
export type DeliveryRow = {
  id: string; // uuidv7(receivedAt.getTime(), random)
  blob: string; // "sha256/" and the lowercase hex digest of raw
  mailbox: string;
  mailFrom: string | null;
  rcptTo: string; // the envelope recipient, as given, that found this mailbox
  receivedAt: Date;
  via: string;
};
export type Blobs = { put: (key: string, bytes: Uint8Array) => Promise<void> };
// record ignores a second row for the same (blob, mailbox).
export type Deliveries = { record: (row: DeliveryRow) => Promise<void> };
export type Receiver = (input: unknown) => Promise<Verdict>;

/**
 * RFC 5321 4.5.5 and form 01a19a5c, Receiving: no recipient found is a reject and every one found
 * switched off a drop, both storing nothing. Otherwise the bytes are stored first, so a failure
 * never leaves a record without them, then one record per distinct mailbox found switched on, for
 * the first recipient in envelope order that found it.
 */
export function createReceiver(ports: {
  directory: Directory;
  blobs: Blobs;
  deliveries: Deliveries;
  random?: Random;
}): Receiver {
  const find = findMailbox(ports.directory);
  const random = ports.random ?? ((into: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(into));
  return async (input) => {
    const delivery = deliverySchema.parse(input);
    const looked = await Promise.all(
      delivery.envelope.rcptTo.map(async (to) => ({ to, found: await find(recipient(to)) })),
    );
    const hits = looked.filter((r): r is { to: string; found: Found } => r.found !== null);
    if (hits.length === 0) return { kind: "reject", reason: "no-such-user" };
    const first = new Map<string, string>();
    for (const { to, found } of hits) {
      if (found.enabled && !first.has(found.mailbox)) first.set(found.mailbox, to);
    }
    if (first.size === 0) return { kind: "drop" };
    const blob = `sha256/${await digest(delivery.raw)}`;
    await ports.blobs.put(blob, delivery.raw);
    for (const [mailbox, rcptTo] of first) {
      await ports.deliveries.record({
        id: uuidv7(delivery.receivedAt.getTime(), random),
        blob,
        mailbox,
        mailFrom: delivery.envelope.mailFrom,
        rcptTo,
        receivedAt: delivery.receivedAt,
        via: delivery.via,
      });
    }
    return { kind: "accept", mailboxes: [...first.keys()] };
  };
}
