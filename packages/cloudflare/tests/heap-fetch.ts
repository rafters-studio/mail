// FR-MAIL-046, in a child process with a 128 MB heap: the real session over the real mailbox object
// holding one hostile delivery runs each FETCH named, and says how each ended and what literal came back.
import { createImapSession, type ImapStore } from "../../core/src/imap/index.ts";
import { hostile, SHAPES } from "../../core/tests/hostile.ts";
import { box, idAt } from "./imap-world.ts";

const [, , name, ...items] = process.argv;
const shape = SHAPES.find((s) => s === name);
if (shape === undefined) throw new Error(`no shape ${name}`);

const message = hostile(shape);
const b = box();
b.deliver(idAt(0x019cafbf0000, 1), message);
await b.object.ping();
const store: ImapStore = {
  login: async () => "account",
  mailboxes: async () => ["INBOX"],
  open: (_account, mailbox) => b.object.open(mailbox, "session"),
  held: (_account, _mailbox, uids) => b.object.held(uids),
  bytes: (_account, _mailbox, uid) => b.object.bytes(uid),
  setFlags: (_account, _mailbox, uid, flags) => b.object.setFlags(uid, flags),
  expunge: (_account, _mailbox, uids) => b.object.expunge(uids),
};
const session = createImapSession({ store });
const command = (line: string) => session.receive(new TextEncoder().encode(`${line}\r\n`));
await command("A1 LOGIN u p");
await command("A2 SELECT INBOX");

const results = [];
for (const item of items) {
  const response = await command(`A3 FETCH 1 ${item}`);
  const head = new TextDecoder("latin1").decode(response.subarray(0, 512));
  const literal = /\{(\d+)\}\r\n/.exec(head);
  const size = literal === null ? 0 : Number(literal[1]);
  const at = literal === null ? 0 : literal.index + literal[0].length;
  const tail = new TextDecoder("latin1").decode(response.subarray(-40));
  results.push({
    item,
    completed: tail.endsWith("A3 OK FETCH completed\r\n"),
    size,
    // Whether the literal is the message's own first octets, which a whole BODY[] and a partial are.
    leading: Buffer.compare(response.subarray(at, at + size), message.subarray(0, size)) === 0,
  });
}
console.log(JSON.stringify({ total: message.length, results }));
