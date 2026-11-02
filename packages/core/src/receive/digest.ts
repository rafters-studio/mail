// The bytes' own name (FIPS 180-4): "This standard specifies hash algorithms that can be used to
// generate digests of messages." Stored mail is named by its SHA-256, so the same bytes stored
// twice are one object, and different bytes can never overwrite each other.

/**
 * FIPS 180-4 SHA-256 as lowercase hex. The copy is a `Uint8Array<ArrayBuffer>`, which
 * `crypto.subtle.digest` takes and a caller's view over a shared buffer is not.
 */
export async function digest(raw: Uint8Array): Promise<string> {
  return digestOwned(new Uint8Array(raw));
}

/**
 * FIPS 180-4 SHA-256 as lowercase hex of bytes the caller made and holds alone, so a message near the
 * size limit is not copied once more in an isolate of 128 MB.
 */
export async function digestOwned(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
