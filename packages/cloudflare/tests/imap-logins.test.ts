// Logins on the real migration, against vectors computed outside the code with Python's hashlib:
//   hashlib.pbkdf2_hmac("sha256", password, salt, 100000).hex()   hashlib.sha256(user).hexdigest()
import { afterEach, expect, vi } from "vitest";
import { binary } from "../../core/src/read/index.ts";
import { criterion } from "../../core/tests/criterion.ts";
import { d1Logins, hashPassword } from "../src/index.ts";
import { d1World, MAILBOX, PASSWORD, USER } from "./imap-world.ts";

const ADDRESS = "198.51.100.7";
const NOW = new Date("2026-03-02T17:00:00.000Z");
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const utf8 = (text: string) => binary(new TextEncoder().encode(text));
const HEX_16 = "000102030405060708090a0b0c0d0e0f";
const SALT_ASCII = Uint8Array.from({ length: 16 }, (_, i) => i);
const SALT_LATIN = Uint8Array.from({ length: 16 }, (_, i) => i + 16);
const HASH_ASCII = "57f2c2f0739748d516419b062a884666323c583ea4ae165504a81f7b53c62a09";
const HASH_LATIN = "7b9c9728904bc1584e9079c357b9234667de08ab84bbbfa2f10b8f5fee039089";
const SHA_USER = "a6167356a1b7f9cd8f9eaf6f2b1188c36140e892adb7e0732d5ce62ea6d90cc2";
const SHA_LATIN_USER = "1c25f5c0a3796162aacc931c72e091070de1fb45688410b0c885a7dc9da4dd11";

/** The tables with one login, from the vector for the ASCII password. */
function logins() {
  const w = d1World();
  w.db
    .prepare("INSERT INTO imap_logins (user, mailbox, salt, hash) VALUES (?, ?, ?, ?)")
    .run(USER, MAILBOX, HEX_16, HASH_ASCII);
  const rows = () =>
    w.db
      .prepare("SELECT key, count FROM imap_login_failures ORDER BY key")
      .all()
      .map((row) => ({ ...row }));
  return { ...w, rows, verify: d1Logins(w.d1).verify };
}

afterEach(() => vi.restoreAllMocks());

criterion("FR-MAIL-036-c1", async () => {
  expect(await hashPassword(PASSWORD, SALT_ASCII)).toBe(HASH_ASCII);
  expect(await hashPassword(utf8("pässwörd"), SALT_LATIN)).toBe(HASH_LATIN);
  const w = logins();
  const user = utf8("josé@example.es");
  w.db
    .prepare("INSERT INTO imap_logins (user, mailbox, salt, hash) VALUES (?, ?, ?, ?)")
    .run(user, "mbx-other", Buffer.from(SALT_LATIN).toString("hex"), HASH_LATIN);
  expect(await w.verify(user, utf8("pässwörd"), ADDRESS, NOW)).toBe("mbx-other");
  expect(await w.verify(user, "wrong", ADDRESS, NOW)).toBeNull();
  expect(w.rows()).toContainEqual({ key: `user:${SHA_LATIN_USER}:${ADDRESS}`, count: 1 });
});

criterion("FR-MAIL-036-c2", async () => {
  const { verify } = logins();
  expect(await verify(USER, PASSWORD, ADDRESS, NOW)).toBe(MAILBOX);
  expect(await verify(USER, "wrong", ADDRESS, NOW)).toBeNull();
});

criterion("FR-MAIL-036-c3", async () => {
  const { verify } = logins();
  for (let i = 0; i < 10; i++) await verify(USER, "wrong", ADDRESS, later(i));
  const derive = vi.spyOn(crypto.subtle, "deriveBits");
  expect(await verify(USER, PASSWORD, ADDRESS, later(10))).toBeNull();
  expect(derive).not.toHaveBeenCalled();
  expect(await verify(USER, PASSWORD, "198.51.100.8", later(10))).toBe(MAILBOX);
  expect(derive).toHaveBeenCalledTimes(1);
});

criterion("FR-MAIL-036-c4", async () => {
  const { verify } = logins();
  for (let i = 0; i < 30; i++) await verify(`user${i}@example.net`, "wrong", ADDRESS, later(i));
  const derive = vi.spyOn(crypto.subtle, "deriveBits");
  expect(await verify(USER, PASSWORD, ADDRESS, later(30))).toBeNull();
  expect(derive).not.toHaveBeenCalled();
});

criterion("FR-MAIL-036-c5", async () => {
  const { verify, rows } = logins();
  for (let i = 0; i < 10; i++) await verify(USER, "wrong", ADDRESS, NOW);
  await verify("other@example.net", "wrong", "198.51.100.8", later(1));
  const derive = vi.spyOn(crypto.subtle, "deriveBits");
  expect(await verify(USER, "wrong", ADDRESS, later(900))).toBeNull();
  expect(derive).toHaveBeenCalledTimes(1);
  // The old window's rows are gone: these two started new ones, and the other's has not passed.
  expect(rows()).toHaveLength(4);
  for (const key of ["address:198.51.100.7", "address:198.51.100.8", `user:${SHA_USER}:${ADDRESS}`])
    expect(rows()).toContainEqual({ key, count: 1 });
});

criterion("FR-MAIL-036-c6", async () => {
  const { verify, rows } = logins();
  const derive = vi.spyOn(crypto.subtle, "deriveBits");
  expect(await verify("nobody@example.net", PASSWORD, ADDRESS, NOW)).toBeNull();
  expect(derive).toHaveBeenCalledTimes(1);
  expect(rows()).toHaveLength(2);
});

criterion("FR-MAIL-036-c7", async () => {
  const { verify, rows } = logins();
  await verify(USER, "wrong", ADDRESS, NOW);
  expect(rows()).toHaveLength(2);
  expect(await verify(USER, PASSWORD, ADDRESS, later(1))).toBe(MAILBOX);
  expect(rows()).toEqual([{ key: `address:${ADDRESS}`, count: 1 }]);
});

criterion("FR-MAIL-036-c8", async () => {
  const { verify, counts } = logins();
  const derive = vi.spyOn(crypto.subtle, "deriveBits");
  expect(await verify("a".repeat(321), PASSWORD, ADDRESS, NOW)).toBeNull();
  expect(counts.queries).toBe(0);
  expect(derive).not.toHaveBeenCalled();
});

criterion("FR-MAIL-036-c9", async () => {
  const { verify, rows } = logins();
  await verify(USER, "wrong", ADDRESS, NOW);
  expect(rows()).toContainEqual({ key: `user:${SHA_USER}:${ADDRESS}`, count: 1 });
  expect(JSON.stringify(rows())).not.toContain(USER);
});

criterion("FR-MAIL-036-c10", async () => {
  const { verify, rows } = logins();
  await verify(USER, "wrong", "2001:DB8:1:2:a:b:c:d", NOW);
  await verify(USER, "wrong", "2001:db8:1:2::9", NOW);
  expect(rows()).toEqual([
    { key: "address:2001:db8:1:2::", count: 2 },
    { key: `user:${SHA_USER}:2001:db8:1:2::`, count: 2 },
  ]);
  await verify(USER, "wrong", "::ffff:192.0.2.1", NOW);
  expect(rows()).toContainEqual({ key: "address:192.0.2.1", count: 1 });
});
