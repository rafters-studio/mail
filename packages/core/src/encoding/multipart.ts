// One body, several parts (RFC 2046 5.1.1): "The boundary delimiter MUST occur at the beginning
// of a line, i.e., following a CRLF, and the initial CRLF is considered to be attached to the
// boundary delimiter line rather than part of the preceding part."

/** A MIME entity: its header lines and its body, both already 7-bit. */
export type Part = { headers: string[]; body: string };

/** RFC 2045 3: an entity is its header fields, an empty line, then its body. */
export function entity(part: Part): string {
  return `${part.headers.join("\r\n")}\r\n\r\n${part.body}`;
}

/**
 * RFC 2046 5.1.1: parts joined by delimiter lines, the CRLF before each delimiter its own, and
 * a close delimiter after the last, with no preamble or epilogue.
 */
export function multipart(subtype: string, boundary: string, parts: readonly Part[]): Part {
  const delimited = parts.map((p) => `--${boundary}\r\n${entity(p)}\r\n`).join("");
  return {
    headers: [`Content-Type: multipart/${subtype};\r\n boundary="${boundary}"`],
    body: `${delimited}--${boundary}--`,
  };
}
