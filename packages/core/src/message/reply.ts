// A reply bound to its parent (RFC 5322 3.6.4): "The 'References:' field will contain the contents
// of the parent's 'References:' field (if any) followed by the contents of the parent's
// 'Message-ID:' field (if any)." Binding the parent first means the threading, the recipients and
// the quote are built from it, and cannot be forgotten or forged.
import { z } from "zod";
import { mailboxSchema, type Address, type Mailbox } from "../address/index.ts";
import { mailboxBodyText, sameAddress } from "../address/words.ts";
import { docSchema } from "../document/index.ts";
import { parentSchema, quotable, type Parent } from "./parent.ts";
import {
  attachmentSchema,
  parsed,
  writeMessage,
  type Env,
  type Thread,
  type Written,
} from "./write.ts";

/** Form 01a18fda, Replies and forwards: who replies, to everyone or not, saying what. */
export const replySchema = z.strictObject({
  from: mailboxSchema,
  all: z.boolean().default(false),
  doc: docSchema,
  offset: z.number().int().min(-1439).max(1439).default(0),
  attachments: z.array(attachmentSchema).optional(),
});

/** RFC 5322 3.4: the mailboxes of some addresses, each group replaced by its members. */
function mailboxesOf(addresses: readonly Address[]): Mailbox[] {
  return addresses.flatMap((address) => ("group" in address ? address.members : [address]));
}

/** RFC 5322 3.6.2: a reply goes to the parent's Reply-To when it has one, else to its From. */
function recipients(parent: Parent): Mailbox[] {
  return mailboxesOf(parent.replyTo?.length ? parent.replyTo : parent.from);
}

/**
 * RFC 5322 3.6.3: a reply to all copies the parent's To then Cc, once each, without the replier
 * or anyone it is to, compared as RFC 5322 3.4.1 compares addresses.
 */
function copies(parent: Parent, from: Mailbox, to: readonly Mailbox[]): Mailbox[] {
  const all = mailboxesOf([parent.to, parent.cc].flatMap((list) => list ?? []));
  return all.filter(
    (mailbox, i) =>
      ![from, ...to, ...all.slice(0, i)].some((other) => sameAddress(other.addr, mailbox.addr)),
  );
}

/** RFC 5322 3.6.5: the parent's subject after one "Re: ", however many it had, in whatever case. */
function subject(parent: Parent): string {
  return `Re: ${(parent.subject ?? "").replace(/^(\s*re\s*:\s*)+/i, "")}`.trim();
}

/**
 * RFC 5322 3.6.4: In-Reply-To is the parent's Message-ID; References are the parent's
 * References, else its In-Reply-To when that holds one id, then its Message-ID.
 */
function thread(parent: Parent): Thread {
  const own = parent.messageId === undefined ? [] : [parent.messageId];
  const before = parent.references?.length
    ? parent.references
    : parent.inReplyTo?.length === 1
      ? parent.inReplyTo
      : [];
  return { inReplyTo: own, references: [...before, ...own] };
}

/** Form 01a18fda, Replies and forwards: "On {dateText}, {who} wrote:", or "{who} wrote:" without a date. */
function attribution(parent: Parent): string {
  const who = parent.from.slice(0, 1).map(mailboxBodyText).join("");
  return parent.dateText === undefined ? `${who} wrote:` : `On ${parent.dateText}, ${who} wrote:`;
}

/**
 * Form 01a18fda: binds a parent, throwing its ZodError here when it fails parentSchema; the
 * returned function writes a reply to it, its own words first and the parent's quoted below.
 */
export function replyTo(env: Env, parentInput: unknown): (input: unknown) => Written {
  const parent = parentSchema.parse(parentInput);
  return (input) => {
    const { all, doc, ...reply } = parsed(replySchema, input);
    const to = recipients(parent);
    const head = {
      ...reply,
      to,
      cc: all ? copies(parent, reply.from, to) : [],
      subject: subject(parent),
    };
    const quote = { quote: { attribution: attribution(parent), blocks: quotable(parent.doc) } };
    return writeMessage(env, head, { doc: [...doc, quote] }, thread(parent));
  };
}
