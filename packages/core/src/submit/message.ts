// What mail may change in a message (RFC 6409 8): "Sites MAY modify submissions to ensure compliance
// with standards and site policy." Mail changes only what a sender cannot be trusted with or left
// without: blind copies go, a bad Message-ID is replaced, a missing Date is written. Every other byte
// stays as sent, so all of this works on the raw text and nothing is rebuilt.
import { formatDate } from "../date/format.ts";
import { messageIdSchema } from "../message-id/index.ts";
import type { Read } from "../read/index.ts";

const BLIND = /^(resent-)?bcc[ \t]*:/i;
const MESSAGE_ID = /^message-id\s*:/i;

/** The octets of binary text, one per character. */
export function octets(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/**
 * RFC 5321 2.3.8 and 4.5.3.1.6: a bare CR or LF, a byte of 0x80 or above (no 8BITMIME is advertised,
 * and `createSender` refuses them), a NUL, or a line over 1,000 octets with its CRLF.
 */
export function hasBadBytes(text: string): boolean {
  // oxlint-disable-next-line no-control-regex -- these control characters are what is refused
  return /\r(?!\n)|(?<!\r)\n|[\0\x80-\xff]|[^\r\n]{999}/.test(text);
}

/** RFC 5322 3.6: how many fields of this name a message holds; `readMessage` reads only the first. */
function count(read: Read, name: string): number {
  return read.fields.filter((f) => f.name.toLowerCase() === name).length;
}

/**
 * RFC 5322 3.6.2: the addresses that must be the sender's own, the one From first, or null when a
 * message has anything but one From naming one address, or more than one Sender, or one unreadable.
 */
export function originators(read: Read): { from: string; all: string[] } | null {
  const [one, ...more] = read.from ?? [];
  if (count(read, "from") !== 1 || one === undefined || more.length > 0) return null;
  const senders = count(read, "sender");
  if (senders > 1 || (senders === 1 && read.sender === null)) return null;
  const from = `${one.local}@${one.domain}`;
  const sender = read.sender === null ? [] : [`${read.sender.local}@${read.sender.domain}`];
  return { from, all: [from, ...sender] };
}

/** RFC 5322 2.2: removes every matching field of the header, whole, with its folded lines. */
function withoutFields(text: string, name: RegExp): string {
  // A line break's far side, or the start, where the next line is empty or the message has ended.
  const end = text.search(/(?<=^|\r\n)(?=\r\n|$)/);
  let dropping = false;
  const kept = text
    .slice(0, end)
    .split(/(?<=\r\n)/)
    .filter((line) => {
      if (!/^[ \t]/.test(line)) dropping = name.test(line);
      return !dropping;
    });
  return kept.join("") + text.slice(end);
}

/** RFC 6409 8.3: the message with exactly one Message-ID, at the top. */
export function withMessageId(text: string, id: string): string {
  return `Message-ID: <${id}>\r\n${withoutFields(text, MESSAGE_ID)}`;
}

/** Whether the message has a Date of its own, which decides what the hold's hash covers. */
export function hasDate(read: Read): boolean {
  return count(read, "date") > 0;
}

/**
 * What the hold hashes (form 01a19de8, The hold): the mailbox, a NUL and the bytes as received, so
 * one mailbox can never suppress another's and an edit is a new message; and the UTC day when the
 * message has no Date of its own, so a cron job's identical mail tomorrow is new.
 */
export function holdInput(mailbox: string, received: Uint8Array, day: string): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(`${mailbox}\0`);
  const tail = encoder.encode(day);
  const all = new Uint8Array(head.length + received.length + tail.length);
  all.set(head);
  all.set(received, head.length);
  all.set(tail, head.length + received.length);
  return all;
}

/**
 * RFC 6409 8: the message as it is sent. A blind name never leaves; anything but one good Message-ID
 * is replaced by one whose left side is the hold's hash, so a retry writes the same id; a missing
 * Date is written, because Cloudflare's raw path will not add it (form 01a19d25).
 */
export function asSent(
  received: string,
  read: Read,
  written: { hash: string; domain: string; at: Date },
): { bytes: Uint8Array; messageId: string } {
  const text = withoutFields(received, BLIND);
  const parsed = messageIdSchema.safeParse(read.messageId);
  const kept = count(read, "message-id") === 1 && parsed.success ? parsed.data : null;
  const messageId = kept ?? `${written.hash}@${written.domain}`;
  const identified = kept === null ? withMessageId(text, messageId) : text;
  const dated = hasDate(read) ? identified : `Date: ${formatDate(written.at, 0)}\r\n${identified}`;
  return { bytes: octets(dated), messageId };
}
