// Mailboxes and groups (RFC 5322 3.4): "A mailbox receives mail. It is a conceptual entity that
// does not necessarily pertain to file storage." An address names a mailbox, or a group of them.
import { z } from "zod";
import { words } from "../encoding/chars.ts";

/** RFC 5322 3.4.1: an addr-spec, a local part and a domain, branded so only this schema makes one. */
export const addrSpecSchema = z
  .strictObject({ local: z.string(), domain: z.string() })
  .brand<"AddrSpec">();

/** RFC 5322 3.4: a mailbox, an addr-spec with an optional display name. */
export const mailboxSchema = z.strictObject({ name: words.optional(), addr: addrSpecSchema });

/** RFC 5322 3.4: a named group of mailboxes; groups only arrive in a parent. */
export const groupSchema = z.strictObject({ group: words.min(1), members: z.array(mailboxSchema) });

/** RFC 5322 3.4: an address is a mailbox or a group. */
export const addressSchema = z.union([mailboxSchema, groupSchema]);

export type AddrSpec = z.infer<typeof addrSpecSchema>;
export type Mailbox = z.infer<typeof mailboxSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Address = z.infer<typeof addressSchema>;
