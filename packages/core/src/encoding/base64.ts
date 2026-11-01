// Bytes as 7-bit lines (RFC 2045 6.8): "The Base64 Content-Transfer-Encoding is designed to
// represent arbitrary sequences of octets in a form that need not be humanly readable."
// Attachments and the octets of non-ASCII header words travel this way.

/** RFC 2045 6.8: every 3 octets as 4 characters of the base64 alphabet, padded with "=". */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const octet of bytes) binary += String.fromCharCode(octet);
  return btoa(binary);
}

/** RFC 2045 6.8: "The encoded output stream must be represented in lines of no more than 76 characters each." */
export function base64Lines(bytes: Uint8Array): string {
  const text = base64(bytes);
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += 76) lines.push(text.slice(at, at + 76));
  return lines.join("\r\n");
}
