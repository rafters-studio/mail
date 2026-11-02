// The right mailbox for a recipient (RFC 5321 4.5.1): "Any system that includes an SMTP server
// supporting mail relaying or delivery MUST support the reserved mailbox postmaster". The
// directory holds the domains mail receives for, the addresses at each, and the one mailbox each
// address delivers to; a domain without a postmaster cannot be written.
import { z } from "zod";
import { canonicalLocal, domainName, type Recipient } from "./recipient.ts";

/** A domain mail receives for, in its `domainName` form, with its postmaster and catch-all. */
export const domainSchema = z.strictObject({
  name: z.string().transform(domainName).pipe(z.string()),
  postmaster: z.string().min(1), // a mailbox id
  catchAll: z.string().min(1).nullable(), // a mailbox id
  masking: z.boolean(), // whether people at this domain may make masked addresses
});
export type Domain = z.infer<typeof domainSchema>;

/** An address at a domain, in its `canonicalLocal` form, so a row and a recipient always meet. */
export const mailboxAddressSchema = z.strictObject({
  local: z.string().transform(canonicalLocal).pipe(z.string().min(1)), // may hold a +tag
  domain: z.string().transform(domainName).pipe(z.string()),
  mailbox: z.string().min(1),
  enabled: z.boolean(), // false: mail to it is accepted and dropped
  // A masked address: the local part as the person hands it out (quietOtter4821), what it is
  // for, and when it was made. null for others.
  mask: z
    .strictObject({ shown: z.string().min(1), label: z.string(), createdAt: z.date() })
    .nullable(),
});
export type MailboxAddress = z.infer<typeof mailboxAddressSchema>;

/** The mailbox a recipient found, and whether its address is switched on. */
export type Found = { mailbox: string; enabled: boolean };

/** Where the domains and addresses are kept; an adapter implements it over its own storage. */
export type Directory = {
  domain: (name: string) => Promise<Domain | null>;
  address: (local: string, domain: string) => Promise<MailboxAddress | null>;
};

/**
 * RFC 5321 4.5.1: the first that exists of the address with its tag, the address, the domain's
 * postmaster for `postmaster`, and the domain's catch-all. A switched-off address is found as
 * switched off, so its mail never falls through to the catch-all.
 */
export function findMailbox(directory: Directory): (r: Recipient) => Promise<Found | null> {
  return async (r) => {
    if (r.local === "" || r.domain === null) return null;
    const domain = await directory.domain(r.domain);
    if (domain === null) return null;
    const tagged =
      r.tag === null ? null : await directory.address(`${r.local}+${r.tag}`, domain.name);
    const row = tagged ?? (await directory.address(r.local, domain.name));
    if (row !== null) return { mailbox: row.mailbox, enabled: row.enabled };
    const mailbox = r.local === "postmaster" ? domain.postmaster : domain.catchAll;
    return mailbox === null ? null : { mailbox, enabled: true };
  };
}
