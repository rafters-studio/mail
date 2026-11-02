// The deployable Worker for the facts only a real IMAP session settles (form 01a19daa). It is the one
// place `cloudflare:workers` is imported; the package takes the base class as an argument.
import { DurableObject } from "cloudflare:workers";
import { imapObjects, imapWorker } from "@rafters/mail-cloudflare";

const { ImapSession, ImapMailbox } = imapObjects(DurableObject);
export { ImapSession, ImapMailbox };
export default imapWorker();
