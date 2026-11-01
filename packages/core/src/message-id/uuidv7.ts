// A time-ordered unique id (RFC 9562 5.7): "UUIDv7 features a time-ordered value field derived
// from the widely implemented and well-known Unix Epoch timestamp source." The time makes ids
// sort by when they were written; the random bits make them unique.

/**
 * RFC 9562 5.7: 48 bits of milliseconds, then 10 random bytes with version 7 in the high four
 * bits of the first and variant 10 in the high two bits of the third, as lowercase hex.
 */
export function uuidv7(
  ms: number,
  random: (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>,
): string {
  const id = new Uint8Array(16);
  const view = new DataView(id.buffer);
  view.setUint16(0, Math.floor(ms / 2 ** 32));
  view.setUint32(2, ms % 2 ** 32);
  id.set(random(new Uint8Array(10)), 6);
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x70);
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);
  const hex = Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
