/**
 * IMAP4rev1 (RFC 3501) response formatter.
 *
 * Generates spec-compliant IMAP responses: untagged (*), tagged
 * (OK/NO/BAD), continuation (+), and structured responses for
 * FETCH, LIST, STATUS, and SEARCH.
 */

export interface FetchResponseData {
  flags?: string[];
  uid?: number;
  internalDate?: Date;
  rfc822Size?: number;
  envelope?: EnvelopeData;
  bodyStructure?: string;
  body?: { section: string; content: string };
}

export interface EnvelopeData {
  date: string;
  subject: string;
  from: AddressData[];
  sender: AddressData[];
  replyTo: AddressData[];
  to: AddressData[];
  cc: AddressData[];
  bcc: AddressData[];
  inReplyTo: string;
  messageId: string;
}

export interface AddressData {
  name: string | null;
  adl: string | null;
  mailbox: string;
  host: string;
}

const CRLF = "\r\n";

export function formatGreeting(capabilities: string[]): string {
  return `* OK [CAPABILITY ${capabilities.join(" ")}] @rafters/mail ready${CRLF}`;
}

export function formatBye(reason: string): string {
  return `* BYE ${reason}${CRLF}`;
}

export function formatTagged(tag: string, status: "OK" | "NO" | "BAD", message: string): string {
  return `${tag} ${status} ${message}${CRLF}`;
}

export function formatUntagged(response: string): string {
  return `* ${response}${CRLF}`;
}

export function formatContinuation(message: string): string {
  return `+ ${message}${CRLF}`;
}

export function formatCapability(capabilities: string[]): string {
  return formatUntagged(`CAPABILITY ${capabilities.join(" ")}`);
}

export function formatListResponse(
  flags: string[],
  delimiter: string,
  name: string,
): string {
  const flagStr = flags.length > 0 ? `(${flags.join(" ")})` : "()";
  const delimStr = delimiter === "" ? "NIL" : `"${delimiter}"`;
  const nameStr = needsQuoting(name) ? `"${escapeQuoted(name)}"` : name;
  return formatUntagged(`LIST ${flagStr} ${delimStr} ${nameStr}`);
}

export function formatStatusResponse(
  mailbox: string,
  items: Record<string, number>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(items)) {
    parts.push(`${key} ${value}`);
  }
  const nameStr = needsQuoting(mailbox) ? `"${escapeQuoted(mailbox)}"` : mailbox;
  return formatUntagged(`STATUS ${nameStr} (${parts.join(" ")})`);
}

export function formatFetchResponse(
  seqNum: number,
  data: FetchResponseData,
): string {
  const parts: string[] = [];

  if (data.flags !== undefined) {
    parts.push(`FLAGS (${data.flags.join(" ")})`);
  }

  if (data.uid !== undefined) {
    parts.push(`UID ${data.uid}`);
  }

  if (data.internalDate !== undefined) {
    parts.push(`INTERNALDATE "${formatImapDate(data.internalDate)}"`);
  }

  if (data.rfc822Size !== undefined) {
    parts.push(`RFC822.SIZE ${data.rfc822Size}`);
  }

  if (data.envelope !== undefined) {
    parts.push(`ENVELOPE ${formatEnvelope(data.envelope)}`);
  }

  if (data.bodyStructure !== undefined) {
    parts.push(`BODYSTRUCTURE ${data.bodyStructure}`);
  }

  if (data.body !== undefined) {
    const { section, content } = data.body;
    const sectionStr = section.length > 0 ? `BODY[${section}]` : "BODY[]";
    const byteLength = new TextEncoder().encode(content).byteLength;
    parts.push(`${sectionStr} {${byteLength}}${CRLF}${content}`);
  }

  return formatUntagged(`${seqNum} FETCH (${parts.join(" ")})`);
}

export function formatSearchResponse(uids: number[]): string {
  if (uids.length === 0) {
    return formatUntagged("SEARCH");
  }
  return formatUntagged(`SEARCH ${uids.join(" ")}`);
}

export function formatSelectResponse(stats: {
  exists: number;
  recent: number;
  unseen: number | null;
  uidValidity: number;
  uidNext: number;
  flags: string[];
  permanentFlags: string[];
  readWrite: boolean;
}): string[] {
  const lines: string[] = [];
  lines.push(formatUntagged(`${stats.exists} EXISTS`));
  lines.push(formatUntagged(`${stats.recent} RECENT`));
  lines.push(formatUntagged(`FLAGS (${stats.flags.join(" ")})`));
  lines.push(formatUntagged(`OK [PERMANENTFLAGS (${stats.permanentFlags.join(" ")})]`));
  lines.push(formatUntagged(`OK [UIDVALIDITY ${stats.uidValidity}]`));
  lines.push(formatUntagged(`OK [UIDNEXT ${stats.uidNext}]`));
  if (stats.unseen !== null) {
    lines.push(formatUntagged(`OK [UNSEEN ${stats.unseen}]`));
  }
  lines.push(formatUntagged(`OK [${stats.readWrite ? "READ-WRITE" : "READ-ONLY"}]`));
  return lines;
}

export function formatExpungeResponse(seqNum: number): string {
  return formatUntagged(`${seqNum} EXPUNGE`);
}

export function formatExistsResponse(count: number): string {
  return formatUntagged(`${count} EXISTS`);
}

function formatEnvelope(env: EnvelopeData): string {
  const parts = [
    formatNString(env.date),
    formatNString(env.subject),
    formatAddressList(env.from),
    formatAddressList(env.sender),
    formatAddressList(env.replyTo),
    formatAddressList(env.to),
    formatAddressList(env.cc),
    formatAddressList(env.bcc),
    formatNString(env.inReplyTo),
    formatNString(env.messageId),
  ];
  return `(${parts.join(" ")})`;
}

function formatAddressList(addresses: AddressData[]): string {
  if (addresses.length === 0) return "NIL";
  const formatted = addresses.map(
    (a) => `(${formatNString(a.name)} ${formatNString(a.adl)} ${formatNString(a.mailbox)} ${formatNString(a.host)})`,
  );
  return `(${formatted.join(" ")})`;
}

function formatNString(value: string | null): string {
  if (value === null) return "NIL";
  return `"${escapeQuoted(value)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatImapDate(date: Date): string {
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()] as string;
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${String(day).padStart(2, " ")}-${month}-${year} ${hours}:${minutes}:${seconds} +0000`;
}

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f || value[i] === '"' || value[i] === "\\") {
      return true;
    }
  }
  return false;
}

function escapeQuoted(value: string): string {
  if (/[\r\n\x00]/.test(value)) {
    throw new Error("Value contains characters forbidden in IMAP quoted strings (CR, LF, NUL)");
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
