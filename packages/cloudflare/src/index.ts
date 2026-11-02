// What @rafters/mail-cloudflare publishes (form 01a19a5c): "An adapter builds the delivery from
// its provider's input and acts on the verdict as far as its provider allows." The Worker, and
// the R2 and D1 ports it builds from its bindings, each usable on its own.
export { type D1Like, d1Deliveries, d1Directory } from "./d1.ts";
export { type R2Like, r2Blobs } from "./r2.ts";
export { type Bindings, type CloudflareMessage, emailWorker } from "./worker.ts";
