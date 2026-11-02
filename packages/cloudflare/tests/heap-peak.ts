// FR-MAIL-047-c2, in a child process: the real session over the real mailbox object runs one FETCH,
// and the peak of heapUsed plus arrayBuffers is what it reports. R2 is a file, since on the deployment
// the blob is not in the session's memory. Each sample calls gc() first, so live memory is what counts.
// Samples are taken in the calls the session allocates around: each chunk of a binary text, each slice
// of a parse, each join of a view, and when each call returns.
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImapSession, type ImapStore } from "../../core/src/imap/index.ts";
import { readMessage, section } from "../../core/src/read/index.ts";
import { hostile, SHAPES } from "../../core/tests/hostile.ts";
import { box, idAt } from "./imap-world.ts";

const [, , name, item = ""] = process.argv;
const shape = SHAPES.find((s) => s === name);
if (shape === undefined) throw new Error(`no shape ${name}`);
const collect: unknown = Reflect.get(globalThis, "gc");
if (typeof collect !== "function") throw new Error("run with --expose-gc");

const sha = (octets: Uint8Array): string => createHash("sha256").update(octets).digest("hex");
const dir = mkdtempSync(join(tmpdir(), "heap-peak-"));
const path = join(dir, "blob");

/** Writes the message to the file; the digests of what each FETCH should send, and its size. */
function prepare(): { size: number; whole: string; part: string } {
  const message = hostile(shape ?? "plain");
  writeFileSync(path, message);
  const range = section(readMessage(message).root, "2")?.body;
  const part = range === undefined ? "" : sha(message.subarray(range.start, range.end));
  return { size: message.length, whole: sha(message), part };
}
const expected = prepare();

const b = box();
b.env.MAIL_BLOBS = {
  get: async () => ({
    arrayBuffer: async () => {
      const buffer = new ArrayBuffer(expected.size);
      const file = openSync(path, "r");
      readSync(file, new Uint8Array(buffer));
      closeSync(file);
      return buffer;
    },
  }),
};
b.deliver(idAt(0x019cafbf0000, 1), null);
await b.object.ping();

let peak = 0;
let measuring = false;
/** One sample of what this process holds alive. */
const sample = (): void => {
  if (!measuring) return;
  collect();
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  peak = Math.max(peak, heapUsed + arrayBuffers);
};
const { subarray, set } = Uint8Array.prototype;
Uint8Array.prototype.subarray = function (this: Uint8Array<ArrayBuffer>, from, to) {
  const view = subarray.call(this, from, to);
  sample();
  return view;
};
Uint8Array.prototype.set = function (this: Uint8Array, source: ArrayLike<number>, at?: number) {
  set.call(this, source, at);
  sample();
};
const { slice } = String.prototype;
let slices = 0;
String.prototype.slice = function (this: string, from?: number, to?: number) {
  const part = slice.call(this, from, to);
  // A parse slices once per line, which is too many to collect at each.
  if (++slices % 65536 === 0) sample();
  return part;
};

const store: ImapStore = {
  login: async () => "account",
  mailboxes: async () => ["INBOX"],
  open: (_account, mailbox) => b.object.open(mailbox, "session"),
  held: (_account, _mailbox, uids) => b.object.held(uids),
  bytes: async (_account, _mailbox, uid) => {
    const octets = await b.object.bytes(uid);
    sample();
    return octets;
  },
  setFlags: (_account, _mailbox, uid, flags) => b.object.setFlags(uid, flags),
  expunge: (_account, _mailbox, uids) => b.object.expunge(uids),
};
const session = createImapSession({ store });
const command = (line: string) => session.receive(new TextEncoder().encode(`${line}\r\n`));
await command("A1 LOGIN u p");
await command("A2 SELECT INBOX");

measuring = true;
const response = await command(`A3 FETCH 1 ${item}`);
sample();
measuring = false;

const head = new TextDecoder("latin1").decode(response.subarray(0, 512));
const literal = /\{(\d+)\}\r\n/.exec(head);
const size = literal === null ? 0 : Number(literal[1]);
const at = literal === null ? 0 : literal.index + literal[0].length;
const digest = sha(response.subarray(at, at + size));
rmSync(dir, { recursive: true });
console.log(
  JSON.stringify({
    item,
    peak,
    completed: new TextDecoder("latin1")
      .decode(response.subarray(-40))
      .endsWith("A3 OK FETCH completed\r\n"),
    size,
    same: digest === (item.includes("[2]") ? expected.part : expected.whole),
  }),
);
