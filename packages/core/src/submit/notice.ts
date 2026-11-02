// Telling the person of a failure (RFC 5321 6.1): "If there is a delivery failure after acceptance
// of a message, the receiver-SMTP MUST formulate and mail a notification message." A 250 tells the
// app to stop trying, so a failure known after it can only reach the person as mail. A notice is a
// plain message to the sender's own mailbox, so it cannot loop or reach another person.
import { z } from "zod";
import { createMail, type Random } from "../message/index.ts";
import { binary, decodeWords } from "../read/index.ts";
import { digest } from "../receive/digest.ts";
import { domainName } from "../receive/recipient.ts";
import { octets, withMessageId } from "./message.ts";

/**
 * Form 01a19de8, The answer: a provider's text cut at its first control character and limited to
 * 400 octets, because otherwise it can break the client's framing, and a line break in it can supply
 * a reply to a later command. A character the limit splits is dropped whole.
 */
export function providerText(text: string): string {
  const line = text.replace(/\p{Cc}[^]*$/u, "");
  const limited = new TextEncoder().encode(line).subarray(0, 400);
  return new TextDecoder().decode(limited).replace(/�$/u, "");
}

/**
 * Form 01a19de8, Notices: a subject as a notice quotes it, decoded, every control character replaced
 * by a space and cut to 200 characters, so a tab-folded or oversized subject cannot throw.
 */
export function noticeSubject(value: string): string {
  return [...decodeWords(value).replace(/\p{Cc}/gu, " ")].slice(0, 200).join("");
}

/** RFC 5322 3.4.1: an address's domain with no trailing dot, or a ZodError when it has none. */
function domainOf(address: string): string {
  return z.string().parse(domainName(address.slice(address.lastIndexOf("@") + 1)));
}

/**
 * RFC 5321 6.1: the notice of a failure, from `postmaster@` the domain of `from`, saying which
 * recipients, what happened and the original subject. Its Message-ID's left side is a hash of `key`,
 * so a retry's notice collapses to one message in the mailbox. A throw here is the caller's to log.
 */
export async function writeNotice(input: {
  key: string;
  from: string;
  to: string;
  recipients: string[];
  what: string;
  subject: string;
  random: Random;
  now: () => Date;
}): Promise<Uint8Array> {
  const domain = domainOf(input.from);
  const local = input.to.slice(0, input.to.lastIndexOf("@"));
  const mail = createMail({ domain, random: input.random, now: input.now });
  const send = mail.compose({
    from: { addr: { local: "postmaster", domain } },
    to: [{ addr: { local, domain: domainOf(input.to) } }],
    subject: `Not delivered: ${input.subject}`,
  });
  const { bytes } = send({
    doc: [
      { p: [`Your message may not have reached everyone it was sent to: ${input.subject}`] },
      { ul: input.recipients.map((recipient) => [recipient]) },
      { p: [providerText(input.what)] },
    ],
  });
  const left = await digest(new TextEncoder().encode(input.key));
  return octets(withMessageId(binary(bytes), `${left}@${domain}`));
}
