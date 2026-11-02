// Who may log in (NIST SP 800-132 5.1): "The length of the randomly-generated portion of the salt
// shall be at least 128 bits." A guess costs a derivation, so failures are counted by client address:
// a stranger elsewhere cannot lock the owner out, and a missing user costs what a wrong password does.
import { z } from "zod";
import type { D1Like } from "./d1.ts";

/** Checks one login attempt from one client address, giving the mailbox or null. */
export type Logins = {
  verify(user: string, password: string, address: string, now: Date): Promise<string | null>;
};

const ITERATIONS = 100_000;
const WINDOW_MS = 900_000;
const MAX_PAIR = 10;
const MAX_ADDRESS = 30;
// RFC 5321 4.5.3.1.3 gives a path 256 octets, so 320 is generous; a longer one is no user's.
const MAX_USER = 320;
// Derived against when no login exists, so a missing user takes as long as a wrong password.
const NO_SALT = new Uint8Array(16);

const failureSchema = z.object({ key: z.string(), count: z.number(), window_start: z.string() });
const loginSchema = z.object({ mailbox: z.string(), salt: z.string(), hash: z.string() });

/** The octets of a binary string, one per character, as the session hands text over. */
export function octets(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Bytes as lowercase hex, the form every stored hash and salt takes. */
export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bytes a hex salt stands for. */
function unhex(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: text.length / 2 }, (_, i) =>
    parseInt(text.slice(i * 2, i * 2 + 2), 16),
  );
}

/**
 * NIST SP 800-132 5.3: PBKDF2 with HMAC-SHA-256 at 100,000 iterations, over the octets of a binary
 * string, as lowercase hex. Not a TextEncoder: a non-ASCII password reaches here as its octets already.
 */
export async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", octets(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return hex(bits);
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

/**
 * Form 01a19daa: an address as one client. One routed IPv6 /64 is one client, whatever its low bits,
 * and an IPv4 address mapped into IPv6 counts as that IPv4 address.
 */
function clientKey(address: string): string {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped !== null) return String(mapped[1]);
  if (!lower.includes(":")) return lower;
  const gap = lower.indexOf("::");
  const groups = (text: string) => text.split(":").filter(Boolean);
  const head = groups(gap < 0 ? lower : lower.slice(0, gap));
  const tail = groups(gap < 0 ? "" : lower.slice(gap + 2));
  const zeros = Array.from({ length: 8 - head.length - tail.length }, () => "0");
  const prefix = [...head, ...zeros, ...tail].slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(":")}::`;
}

/**
 * Form 01a19daa, Logins: an oversized user touches nothing; a block by pair or by address returns
 * null before deriving; a right password clears its pair; anything else derives once and counts,
 * whether the user exists or not, so nothing says who does.
 */
export function d1Logins(db: D1Like): Logins {
  return {
    verify: async (user, password, address, now) => {
      if (user.length > MAX_USER) return null;
      const digest = await crypto.subtle.digest("SHA-256", octets(user));
      const client = clientKey(address);
      const pair = `user:${hex(digest)}:${client}`;
      const whole = `address:${client}`;
      const { results } = await db
        .prepare("SELECT key, count, window_start FROM imap_login_failures WHERE key IN (?, ?)")
        .bind(pair, whole)
        .all();
      const blocked = results
        .map((row) => failureSchema.parse(row))
        .some(
          (row) =>
            now.getTime() - Date.parse(row.window_start) < WINDOW_MS &&
            row.count >= (row.key === pair ? MAX_PAIR : MAX_ADDRESS),
        );
      if (blocked) return null;
      const found = await db
        .prepare("SELECT mailbox, salt, hash FROM imap_logins WHERE user = ?")
        .bind(user)
        .first();
      const login = found === null ? null : loginSchema.parse(found);
      const derived = await hashPassword(password, login === null ? NO_SALT : unhex(login.salt));
      if (login !== null && (await sameText(derived, login.hash))) {
        await db.prepare("DELETE FROM imap_login_failures WHERE key = ?").bind(pair).run();
        return login.mailbox;
      }
      // Passed rows go first, so an upsert on one of them starts a new window.
      const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
      await db
        .prepare("DELETE FROM imap_login_failures WHERE window_start <= ?")
        .bind(cutoff)
        .run();
      for (const key of [pair, whole]) {
        await db
          .prepare(
            "INSERT INTO imap_login_failures (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = count + 1",
          )
          .bind(key, now.toISOString())
          .run();
      }
      return null;
    },
  };
}
