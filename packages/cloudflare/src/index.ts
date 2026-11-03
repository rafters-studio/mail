// What @rafters/mail-cloudflare publishes (form 01a19a5c): "An adapter builds the delivery from
// its provider's input and acts on the verdict as far as its provider allows." The Worker, and
// the R2 and D1 ports it builds from its bindings, each usable on its own; and, by form 01a19d25,
// the sending transport, the socket, the send log and the Worker that hears what happened; and, by
// form 01a19daa, the IMAP objects and their Worker; and, by form 01a19de8, the object
// for one submission connection.
export {
  bindingTransport,
  type EmailBinding,
  type MakeMessage,
  type RawMessage,
} from "./binding.ts";
export { type D1Like, d1Deliveries, d1Directory } from "./d1.ts";
export { fromCloudflare } from "./events.ts";
export {
  type DurableObjectStateLike,
  type ImapBindings,
  imapObjects,
  type MailboxStub,
  type NamespaceOf,
  type R2ObjectLike,
  type R2Reader,
  type SessionStub,
  type SocketLike,
  type SqlLike,
} from "./imap-objects.ts";
export { imapWorker } from "./imap-worker.ts";
export { type R2Like, r2Blobs } from "./r2.ts";
export { d1Events, d1History, d1Sends, type History } from "./send-log.ts";
export {
  type QueueBatch,
  type SendingBindings,
  sendingWorker,
  type Webhooks,
} from "./sending-worker.ts";
export { type Connect, socketConnection } from "./socket.ts";
export { type SubmitBindings, submitObject } from "./submit-object.ts";
export { type Bindings, type CloudflareMessage, emailWorker } from "./worker.ts";
