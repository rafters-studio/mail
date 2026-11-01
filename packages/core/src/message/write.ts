// Header fields and body into bytes (RFC 5322 3.6, RFC 2046 5.1.4): "The only required header
// fields are the origination date field and the originator address field(s)." Every check runs
// first, so a message mail refuses is never half written and draws nothing from entropy.
import { z } from "zod";
import { mailboxSchema, type Mailbox } from "../address/index.ts";
import { mailboxWords } from "../address/words.ts";
import { formatDate } from "../date/format.ts";
import { contentSchema, type Content, type Doc, type Inline } from "../document/index.ts";
import { toHtml, toText } from "../document/render.ts";
import { base64Lines } from "../encoding/base64.ts";
import { DOT_ATOM, utf8, words } from "../encoding/chars.ts";
import { textWords } from "../encoding/encoded-word.ts";
import { fold } from "../encoding/fold.ts";
import { multipart, type Part } from "../encoding/multipart.ts";
import { never } from "../encoding/never.ts";
import { filenameParameters } from "../encoding/parameter.ts";
import { quotedPrintable } from "../encoding/quoted-printable.ts";
import { messageIdSchema, type MessageId } from "../message-id/index.ts";
import { uuidv7 } from "../message-id/uuidv7.ts";

/** RFC 2183 2: a file sent with the message, its type lowercase and without parameters. */
const attachmentSchema = z.strictObject({
  filename: words.min(1),
  type: z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
  content: z.instanceof(Uint8Array),
});

/** RFC 5322 3.6: what a message is from, to and about, and the author's clock and language. */
export const headSchema = z.strictObject({
  from: mailboxSchema,
  replyTo: z.array(mailboxSchema).optional(),
  to: z.array(mailboxSchema).optional(),
  cc: z.array(mailboxSchema).optional(),
  bcc: z.array(mailboxSchema).optional(),
  subject: words.optional(),
  offset: z.number().int().min(-1439).max(1439).default(0),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/)
    .default("en"),
  dir: z.enum(["ltr", "rtl"]).default("ltr"),
  attachments: z.array(attachmentSchema).optional(),
});

type Head = z.output<typeof headSchema>;
type Attachment = z.output<typeof attachmentSchema>;

export const MAIL_WRITE_CODES = [
  "invalid",
  "address",
  "unsafe-link",
  "no-text",
  "not-7bit",
  "word-too-long",
  "too-large",
] as const;

export type MailWriteCode = (typeof MAIL_WRITE_CODES)[number];

const TEXT: Record<MailWriteCode, string> = {
  invalid: "does not match its schema",
  address: "addresses must be US-ASCII dot-atom text",
  "unsafe-link": "links must be http, https or mailto",
  "no-text": "every message needs a text part",
  "not-7bit": "the original is not 7bit; forward it inline",
  "word-too-long": "has a word too long for 998 characters",
  "too-large": "the HTML part is over 90,000 bytes once encoded",
};

/** Form 01a18fda, Errors: why a message cannot be written, naming its code and the field at fault. */
export class MailWriteError extends Error {
  override readonly name = "MailWriteError";
  readonly code: MailWriteCode;
  readonly field: string;

  /** Form 01a18fda, Errors: the message is the field, then what the code means. */
  constructor(code: MailWriteCode, field: string) {
    super(`${field}: ${TEXT[code]}`);
    this.code = code;
    this.field = field;
  }
}

export type Random = (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
export type Written = { bytes: Uint8Array; messageId: MessageId };
export type Env = { domain: string; random: Random; now: () => Date };

/** Form 01a18fda, Errors: a path within the argument the caller passed, as `to[0].addr.local`. */
function pathText(path: readonly PropertyKey[]): string {
  return path
    .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
    .join("")
    .replace(/^\./, "");
}

/** Form 01a18fda, Errors: the first issue's path; for an unknown key, the path and the key. */
function issueField(issue: z.core.$ZodIssue): string {
  const keys = issue.code === "unrecognized_keys" ? issue.keys.slice(0, 1) : [];
  return pathText([...issue.path, ...keys]);
}

/** Form 01a18fda, Errors: a value its schema accepts, or `invalid` naming where it is not. */
function parsed<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new MailWriteError("invalid", result.error.issues.slice(0, 1).map(issueField).join(""));
}

/** RFC 5322 3.4.1: each local part and domain, of from, replyTo, to, cc and bcc in order, is dot-atom text. */
function checkAddresses(head: Head): void {
  const lists = [
    ["replyTo", head.replyTo],
    ["to", head.to],
    ["cc", head.cc],
    ["bcc", head.bcc],
  ] as const;
  const boxes: [PropertyKey[], Mailbox][] = [
    [["from"], head.from],
    ...lists.flatMap(([name, list]) =>
      (list ?? []).map((m, i): [PropertyKey[], Mailbox] => [[name, i], m]),
    ),
  ];
  for (const [at, mailbox] of boxes) {
    for (const part of ["local", "domain"] as const) {
      if (!DOT_ATOM.test(mailbox.addr[part])) {
        throw new MailWriteError("address", pathText([...at, "addr", part]));
      }
    }
  }
}

/** Research 01a194af: every link among some inlines, with its path, in document order. */
function inlineLinks(inlines: readonly Inline[], at: PropertyKey[]): [string, PropertyKey[]][] {
  return inlines.flatMap((inline, i): [string, PropertyKey[]][] => {
    if (typeof inline === "string") return [];
    if ("a" in inline) return [[inline.href, [...at, i, "href"]]];
    if ("em" in inline) return inlineLinks(inline.em, [...at, i, "em"]);
    /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
    if ("strong" in inline) return inlineLinks(inline.strong, [...at, i, "strong"]);
    else return never(inline);
  });
}

/** Research 01a194af: a link goes only to http, https or mailto, ignoring ASCII case. */
function checkLinks(doc: Doc): void {
  const links = doc.flatMap((block, i): [string, PropertyKey[]][] => {
    if ("p" in block) return inlineLinks(block.p, ["doc", i, "p"]);
    /* v8 ignore else -- the compiler proves no member is left (form 01a18fda, Craft) */
    if ("ul" in block) return block.ul.flatMap((item, j) => inlineLinks(item, ["doc", i, "ul", j]));
    else return never(block);
  });
  const unsafe = links.find(([href]) => !/^(https?:\/\/|mailto:)/i.test(href));
  if (unsafe !== undefined) throw new MailWriteError("unsafe-link", pathText(unsafe[1]));
}

/** RFC 5322 2.1.1: a field folded within 78, or `word-too-long` when a line must pass 998. */
function field(name: string, fieldWords: readonly string[]): string {
  const lines = fold(`${name}:`, fieldWords);
  if (lines.some((line) => line.length > 998)) {
    throw new MailWriteError("word-too-long", name.toLowerCase());
  }
  return lines.join("\r\n");
}

/** RFC 5322 3.6, 3.6.3: From, Reply-To, To, Cc and Subject, each when it has a value; never Bcc. */
function addressFields(head: Head): string[] {
  const lists: [string, readonly Mailbox[]][] = [
    ["From", [head.from]],
    ["Reply-To", head.replyTo ?? []],
    ["To", head.to ?? []],
    ["Cc", head.cc ?? []],
  ];
  const fields = lists
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => field(name, mailboxWords(list)));
  const subject = head.subject ?? "";
  return subject === "" ? fields : [...fields, field("Subject", textWords(subject))];
}

/** RFC 2046 5.1.1: a boundary of 16 random bytes, "=_" first so no encoded body can hold it. */
function boundary(random: Random): string {
  return `=_mail_${Array.from(random(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** RFC 2046 4.1.2: a text part as UTF-8 quoted-printable. */
function textPart(subtype: string, body: string): Part {
  return {
    headers: [
      `Content-Type: text/${subtype}; charset=utf-8`,
      "Content-Transfer-Encoding: quoted-printable",
    ],
    body,
  };
}

/** RFC 2183 2 and RFC 2045 6.8: an attachment, its type on a line of its own when it is long, in base64. */
function attachmentPart(attachment: Attachment): Part {
  const parameters = filenameParameters(attachment.filename);
  const first = `Content-Type: ${attachment.type};`;
  const type = first.length > 78 ? ["Content-Type:", ` ${attachment.type};`] : [first];
  return {
    headers: [
      [...type, ...parameters.name].join("\r\n"),
      "Content-Transfer-Encoding: base64",
      ["Content-Disposition: attachment;", ...parameters.filename].join("\r\n"),
    ],
    body: base64Lines(attachment.content),
  };
}

/**
 * RFC 5322 3.6 and RFC 2046 5.1.4: a message as 7-bit CRLF bytes, text part first and HTML
 * last, inside multipart/mixed when there are attachments. Every check passes before `now` or
 * `random` is read; then the Message-ID, the alternative boundary and the mixed one are drawn.
 */
export function writeMessage(env: Env, headInput: unknown, contentInput: unknown): Written {
  const head = parsed(headSchema, headInput);
  const content: Content = parsed(contentSchema, contentInput);
  checkAddresses(head);
  checkLinks(content.doc);
  const text = toText(content.doc);
  if (text.trim() === "") throw new MailWriteError("no-text", "doc");
  const fields = addressFields(head);
  const page = { lang: head.lang, dir: head.dir, title: head.subject ?? "" };
  const html = quotedPrintable(toHtml(content.doc, page));
  if (html.length > 90_000) throw new MailWriteError("too-large", "content");

  // One reading of the clock serves the Date and the Message-ID.
  const now = env.now();
  const messageId = messageIdSchema.parse(`${uuidv7(now.getTime(), env.random)}@${env.domain}`);
  const alternative = multipart("alternative", boundary(env.random), [
    textPart("plain", quotedPrintable(text)),
    textPart("html", html),
  ]);
  const attachments = (head.attachments ?? []).map(attachmentPart);
  const body =
    attachments.length > 0
      ? multipart("mixed", boundary(env.random), [alternative, ...attachments])
      : alternative;
  const header = [
    ...fields,
    `Date: ${formatDate(now, head.offset)}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    ...body.headers,
  ];
  return { bytes: utf8(`${header.join("\r\n")}\r\n\r\n${body.body}\r\n`), messageId };
}
