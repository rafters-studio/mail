// What a reply or forward is bound to (research 01a194af): "An inline style attribute on an
// ordinary element is the only styling that survives on every client surface." A parent is mail
// someone else wrote, read into the same document, so its words are quoted in the same vocabulary.
import { z } from "zod";
import { addressSchema, mailboxSchema } from "../address/index.ts";
import { docSchema, type Doc } from "../document/index.ts";
import { inlineText } from "../document/render.ts";
import { words } from "../encoding/chars.ts";
import { messageIdSchema } from "../message-id/index.ts";
import { attachmentSchema, SAFE_LINK } from "./write.ts";

/** RFC 5322 3.6: the fields of a message someone else wrote, its words as a document, and its bytes. */
export const parentSchema = z.strictObject({
  messageId: messageIdSchema.optional(),
  inReplyTo: z.array(messageIdSchema).optional(),
  references: z.array(messageIdSchema).optional(),
  from: z.array(mailboxSchema).min(1),
  replyTo: z.array(addressSchema).optional(),
  to: z.array(addressSchema).optional(),
  cc: z.array(addressSchema).optional(),
  subject: words.optional(),
  dateText: words.optional(),
  doc: docSchema,
  attachments: z.array(attachmentSchema).optional(),
  raw: z.instanceof(Uint8Array).optional(),
});

export type Parent = z.output<typeof parentSchema>;

const linkSchema = z.strictObject({ a: z.string(), href: z.string() });

/**
 * Form 01a18fda, Replies and forwards: the parent's document as it is, except that a link mail
 * would not write itself becomes its text, so replying to real mail never fails on its links.
 */
export function quotable(doc: Doc): Doc {
  // JSON.parse's reviver visits every node, so a link is found in any block or inline that
  // holds one, and the copy is parsed back into a document rather than asserted to be one.
  const copy: unknown = JSON.parse(JSON.stringify(doc), (_key, node: unknown) => {
    const link = linkSchema.safeParse(node);
    return link.success && !SAFE_LINK.test(link.data.href) ? inlineText(link.data) : node;
  });
  return docSchema.parse(copy);
}
