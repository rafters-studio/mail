// Text as octets, and comparing it (form 01a19daa, The Worker): a secret is "compared through an HMAC
// with `crypto.subtle`", so how long the comparison takes says nothing about where two strings differ.

/** The octets of a binary string, one per character, as the session hands text over. */
export function octets(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Bytes as lowercase hex. */
export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Two strings compared through an HMAC of each under a key made for this call, so how long the
 * comparison takes says nothing about where they differ (form 01a19daa).
 */
export async function sameText(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(a));
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(b));
}
