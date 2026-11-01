// A forward bound to its original (RFC 2046 5.2.1): "No encoding other than '7bit', '8bit', or
// 'binary' is permitted for the body of a 'message/rfc822' entity." So the original is shown in
// full under a separator, never quoted, and attached as well only when it is already 7bit.
import { z } from "zod";
import { mailboxSchema, type Address } from "../address/index.ts";
import { mailboxText } from "../address/words.ts";
import { docSchema } from "../document/index.ts";
import { parentSchema, quotable, type Parent } from "./parent.ts";
import { parsed, writeMessage, type Env, type Written } from "./write.ts";

/** Form 01a18fda, Replies and forwards: who forwards, to whom, saying what, attaching the original or not. */
export const forwardSchema = z.strictObject({
  from: mailboxSchema,
  to: z.array(mailboxSchema).optional(),
  cc: z.array(mailboxSchema).optional(),
  bcc: z.array(mailboxSchema).optional(),
  doc: docSchema,
  offset: z.number().int().min(-1439).max(1439).default(0),
  attach: z.boolean().default(false),
});

/** RFC 5322 3.4: an address as people read it, a group as "name: members;". */
function addressText(address: Address): string {
  if ("group" in address)
    return `${address.group}: ${address.members.map(mailboxText).join(", ")};`;
  return mailboxText(address);
}

/** RFC 5322 3.4: addresses as people read them, joined by ", ". */
function addressesText(addresses: readonly Address[]): string {
  return addresses.map(addressText).join(", ");
}

/** Form 01a18fda, Replies and forwards: From, then Date, Subject, To and Cc when the original has them. */
function header(parent: Parent): string[] {
  const lines: [string, string | undefined][] = [
    ["From", addressesText(parent.from)],
    ["Date", parent.dateText],
    ["Subject", parent.subject],
    ["To", parent.to?.length ? addressesText(parent.to) : undefined],
    ["Cc", parent.cc?.length ? addressesText(parent.cc) : undefined],
  ];
  return lines.flatMap(([name, value]) => (value === undefined ? [] : [`${name}: ${value}`]));
}

/** Form 01a18fda, Replies and forwards: the original's subject after one "Fwd: ", however many "Fw:" it had. */
function subject(parent: Parent): string {
  return `Fwd: ${(parent.subject ?? "").replace(/^(\s*(fwd?|fw)\s*:\s*)+/i, "")}`.trim();
}

/**
 * Form 01a18fda: binds an original, throwing its ZodError here when it fails parentSchema; the
 * returned function writes a forward of it, its own words first and the original's below, with
 * the original's attachments and, when asked, the original itself.
 */
export function forward(env: Env, parentInput: unknown): (input: unknown) => Written {
  const parent = parentSchema.parse(parentInput);
  return (input) => {
    const { doc, attach, ...head } = parsed(forwardSchema, input);
    const block = { forward: { header: header(parent), blocks: quotable(parent.doc) } };
    return writeMessage(
      env,
      { ...head, subject: subject(parent), attachments: parent.attachments },
      { doc: [...doc, block] },
      { inReplyTo: [], references: [] },
      attach ? parent.raw : undefined,
    );
  };
}
