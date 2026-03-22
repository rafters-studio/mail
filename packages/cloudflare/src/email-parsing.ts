export interface ParsedEmailHeaders {
  messageId: string | null;
  from: string;
  to: string;
  cc: string[];
  subject: string;
  inReplyTo: string | null;
  references: string[];
  date: Date | null;
  fromName: string | null;
  toName: string | null;
  replyTo: string | null;
}

export function parseEmailHeaders(headers: Headers | Record<string, string>): ParsedEmailHeaders {
  const h = headers instanceof Headers ? headers : new Headers(headers);
  const from = h.get("from") ?? "";
  const to = h.get("to") ?? "";

  return {
    messageId: h.get("message-id"),
    from: extractEmailAddress(from),
    to: extractEmailAddress(to),
    cc: parseAddressList(h.get("cc")),
    subject: h.get("subject") ?? "(no subject)",
    inReplyTo: h.get("in-reply-to"),
    references: parseReferences(h.get("references")),
    date: parseDate(h.get("date")),
    fromName: extractDisplayName(from),
    toName: extractDisplayName(to),
    replyTo: h.get("reply-to") ? extractEmailAddress(h.get("reply-to")!) : null,
  };
}

export function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1];
  return value.trim();
}

export function extractDisplayName(value: string): string | null {
  const match = value.match(/^(.+?)\s*<[^>]+>$/);
  if (match?.[1]) return match[1].replace(/^["']|["']$/g, "").trim();
  return null;
}

// RFC 5322 References header: space-delimited list of Message-IDs
function parseReferences(value: string | null): string[] {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean);
}

// CC parsing splits on comma. Known limitation: does not handle
// commas inside quoted display names (e.g., "Last, First" <a@b.com>).
function parseAddressList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((addr) => extractEmailAddress(addr.trim()))
    .filter(Boolean);
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function hashContent(content: string | ArrayBuffer): Promise<string> {
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
