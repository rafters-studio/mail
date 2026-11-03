// The deployable Worker for the facts only a real IMAP session or submission settles (forms 01a19daa
// and 01a19de8). It is the one place `cloudflare:workers` and `cloudflare:email` are imported; the
// package takes the base class, the message and the login as arguments. This login lets nobody in.
import { EmailMessage } from "cloudflare:email";
import { DurableObject } from "cloudflare:workers";
import { imapObjects, imapWorker, submitObject } from "@rafters/mail-cloudflare";

const { ImapSession, ImapMailbox } = imapObjects(DurableObject, async () => null);
export const SubmitSession = submitObject(
  DurableObject,
  (from, to, raw) => new EmailMessage(from, to, raw),
  async () => null,
);
export { ImapSession, ImapMailbox };
export default imapWorker();
