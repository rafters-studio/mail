export interface ParsedEmailHeaders {
  messageId: string | null;
  from: string;
  to: string;
  cc: string[];
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  date: Date | null;
  fromName: string | null;
  toName: string | null;
  replyTo: string | null;
}

export function parseEmailHeaders(headers: Headers): ParsedEmailHeaders {
  const from = headers.get("from") ?? "";
  const to = headers.get("to") ?? "";

  return {
    messageId: headers.get("message-id"),
    from: extractEmailAddress(from),
    to: extractEmailAddress(to),
    cc: parseAddressList(headers.get("cc")),
    subject: headers.get("subject") ?? "(no subject)",
    inReplyTo: headers.get("in-reply-to"),
    references: headers.get("references"),
    date: parseDate(headers.get("date")),
    fromName: extractDisplayName(from),
    toName: extractDisplayName(to),
    replyTo: headers.get("reply-to") ? extractEmailAddress(headers.get("reply-to")!) : null,
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

export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
