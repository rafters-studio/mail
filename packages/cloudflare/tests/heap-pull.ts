// FR-MAIL-045-c4, in a child process with a 128 MB heap: a mailbox pulls each hostile delivery and
// a good one after them, then says which messages it holds.
import { hostile } from "../../core/tests/hostile.ts";
import { box, idAt, mail } from "./imap-world.ts";

const T = 0x019cafbf0000;
const b = box();
b.deliver(idAt(T, 1), hostile("fields"));
b.deliver(idAt(T + 1, 2), hostile("folded"));
b.deliver(idAt(T + 2, 3), hostile("parts"));
b.deliver(idAt(T + 3, 4), mail("good@x"));
await b.object.ping();
console.log(
  JSON.stringify(
    b.rows("SELECT message_id FROM messages ORDER BY delivery").map((r) => r["message_id"]),
  ),
);
