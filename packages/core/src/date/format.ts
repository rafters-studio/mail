// The Date field (RFC 5322 3.3): "The date and time-of-day SHOULD express local time." So the
// field carries the author's own clock and its offset from UTC, not the server's.

const DAYS = "SunMonTueWedThuFriSat";
const MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";

/** Two digits, as RFC 5322 3.3 writes the hour, minute and second. */
function two(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * RFC 5322 3.3: an instant at an offset of minutes east of UTC, as "Mon, 2 Mar 2026 10:00:00
 * -0700". Zero is "+0000", never "-0000", which 3.3 reserves for an unknown zone.
 */
export function formatDate(instant: Date, offset: number): string {
  const local = new Date(instant.getTime() + offset * 60_000);
  const day = DAYS.slice(local.getUTCDay() * 3, local.getUTCDay() * 3 + 3);
  const month = MONTHS.slice(local.getUTCMonth() * 3, local.getUTCMonth() * 3 + 3);
  const year = String(local.getUTCFullYear()).padStart(4, "0");
  const time = `${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`;
  const zone = `${offset < 0 ? "-" : "+"}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
  return `${day}, ${local.getUTCDate()} ${month} ${year} ${time} ${zone}`;
}
