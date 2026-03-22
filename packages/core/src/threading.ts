import { uuidv7 } from "uuidv7";

/**
 * Generate an RFC 5322 compliant Message-ID using UUIDv7.
 * Format: <uuidv7@domain>
 */
export function generateMessageId(domain: string): string {
  return `<${uuidv7()}@${domain}>`;
}

/**
 * Build an RFC 5322 References header by appending In-Reply-To to the
 * existing References chain. Caps at 50 entries to prevent unbounded growth.
 */
export function buildReferences(
  existingReferences: string | null,
  inReplyTo: string | null,
): string | null {
  if (!existingReferences && !inReplyTo) {
    return null;
  }

  const refs: string[] = existingReferences ? existingReferences.trim().split(/\s+/) : [];

  if (inReplyTo) {
    const trimmed = inReplyTo.trim();
    if (trimmed && !refs.includes(trimmed)) {
      refs.push(trimmed);
    }
  }

  // Cap at 50 entries, keeping the most recent (tail)
  const capped = refs.length > 50 ? refs.slice(refs.length - 50) : refs;

  return capped.length > 0 ? capped.join(" ") : null;
}

/**
 * Generate a plain-text snippet from a message body.
 * Returns the first `maxLength` characters, trimmed.
 */
export function generateSnippet(body: string, maxLength = 200): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength);
}

// TODO: matchThread requires a database parameter and belongs in the service
// layer. Deferred to issue #13 (service implementations).
// export function matchThread(...) { ... }
