// Writing a login is an operator's SQL (form 01a19daa, Not decided). Run with IMAP_USER, IMAP_MAILBOX
// and IMAP_PASSWORD in the environment; it prompts for nothing and prints the SQL.
import { hashPassword } from "@rafters/mail-cloudflare";
import { binary } from "@rafters/mail/read";

const { IMAP_USER, IMAP_MAILBOX, IMAP_PASSWORD } = process.env;
if (!IMAP_USER || !IMAP_MAILBOX || !IMAP_PASSWORD) {
  throw new Error("Set IMAP_USER, IMAP_MAILBOX and IMAP_PASSWORD");
}

const encoder = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
// Binary text, as the session hands both over, so non-ASCII ones match.
const user = binary(encoder.encode(IMAP_USER));
const hash = await hashPassword(binary(encoder.encode(IMAP_PASSWORD)), salt);
const hex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

// A mailbox made after 0004_sent.sql has no Sent until this row, as that migration gives the others.
console.log(`INSERT OR IGNORE INTO mailboxes (id) VALUES (${quoted(`${IMAP_MAILBOX}/Sent`)});`);
console.log(
  `INSERT INTO imap_logins (user, mailbox, salt, hash) VALUES (${quoted(user)}, ${quoted(IMAP_MAILBOX)}, ${quoted(hex)}, ${quoted(hash)});`,
);
