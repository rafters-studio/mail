// Reads a written message back three independent ways, so a test judges the bytes by what
// readers see in them rather than by what the writer meant (form 01a18fda, Tests).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import PostalMime from "postal-mime";

type Mailbox = { name: string; address: string };

export type ReadBack = {
  messageId: string | null;
  subject: string | null;
  from: Mailbox[];
  to: (Mailbox | { group: string; members: Mailbox[] })[];
  cc: ReadBack["to"];
  textBeforeHtml: boolean;
  text: string | null;
  html: string | null;
  attachments: { filename: string; size: number }[];
  inReplyTo: string[];
  references: string[];
};

type Parsed = { name?: string; address?: string | undefined; group?: Parsed[] | undefined };

const PYTHON_READ = fileURLToPath(new URL("../python_read.py", import.meta.url));

/** Message ids without their angle brackets, in the order written. */
function ids(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const text = Array.isArray(value) ? value.join(" ") : value;
  return [...text.matchAll(/<([^>]+)>/g)].map((m) => m[1] ?? "");
}

/** A missing name is "", so the three readers compare equal. */
function mailbox(a: Parsed): Mailbox {
  return { name: a.name ?? "", address: a.address ?? "" };
}

function addresses(list: Parsed[] | undefined): ReadBack["to"] {
  return (list ?? []).map((a) =>
    a.group === undefined ? mailbox(a) : { group: a.name ?? "", members: a.group.map(mailbox) },
  );
}

/** CRLF read as LF. */
function lf(text: string | false | undefined): string | null {
  return typeof text === "string" ? text.replace(/\r\n/g, "\n") : null;
}

/** From the order of the parts in the bytes, not from what a reader reports. */
function textBeforeHtml(bytes: Uint8Array): boolean {
  const raw = new TextDecoder("latin1").decode(bytes);
  const text = raw.indexOf("Content-Type: text/plain");
  return text >= 0 && raw.indexOf("Content-Type: text/html") > text;
}

async function readPostalMime(bytes: Uint8Array): Promise<ReadBack> {
  const m = await PostalMime.parse(bytes);
  return {
    messageId: ids(m.messageId)[0] ?? null,
    subject: m.subject ?? null,
    from: m.from === undefined ? [] : [mailbox(m.from)],
    to: addresses(m.to),
    cc: addresses(m.cc),
    textBeforeHtml: textBeforeHtml(bytes),
    text: lf(m.text),
    html: lf(m.html),
    attachments: m.attachments
      .filter((a) => a.mimeType !== "message/rfc822")
      .map((a) => ({
        filename: a.filename ?? "",
        size: typeof a.content === "string" ? a.content.length : a.content.byteLength,
      })),
    inReplyTo: ids(m.inReplyTo),
    references: ids(m.references),
  };
}

async function readMailparser(bytes: Uint8Array): Promise<ReadBack> {
  const m = await simpleParser(Buffer.from(bytes));
  return {
    messageId: ids(m.messageId)[0] ?? null,
    subject: m.subject ?? null,
    from: (m.from?.value ?? []).map(mailbox),
    to: addresses(m.to?.value),
    cc: addresses(m.cc?.value),
    textBeforeHtml: textBeforeHtml(bytes),
    text: lf(m.text),
    html: lf(m.html),
    attachments: m.attachments
      .filter((a) => a.contentType !== "message/rfc822")
      .map((a) => ({ filename: a.filename ?? "", size: a.size })),
    inReplyTo: ids(m.inReplyTo),
    references: ids(m.references),
  };
}

/** Runs python_read.py with the message on stdin; rejects with its stderr on a non-zero exit. */
function readPython(bytes: Uint8Array): Promise<ReadBack> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", PYTHON_READ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(err).toString("utf8")));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    // A reader that exits before reading all of stdin is reported by its exit, not by EPIPE.
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
}

/** The message as postal-mime, mailparser and Python's email package each read it. */
export async function readBack(
  bytes: Uint8Array,
): Promise<{ "postal-mime": ReadBack; mailparser: ReadBack; python: ReadBack }> {
  const [postal, mailparser, python] = await Promise.all([
    readPostalMime(bytes),
    readMailparser(bytes),
    readPython(bytes),
  ]);
  return { "postal-mime": postal, mailparser, python };
}
