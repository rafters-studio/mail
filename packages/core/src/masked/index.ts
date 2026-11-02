// Making a masked address (RFC 5322 3.4.1): "The local-part portion is a domain-dependent
// string." A domain may therefore hand a person a local part made of random words for each place
// they give an address out, labelled with where it went, and switch it off when that place leaks
// it. Every word is lowercase letters and at most one hyphen, so every candidate is a dot-atom.
import { z } from "zod";
import type { Random } from "../message/index.ts";
import type { Directory, Domain, MailboxAddress } from "../receive/directory.ts";
import { canonicalLocal } from "../receive/recipient.ts";
import { WORDS } from "./words.ts";

/** How a person's masked addresses read: three words, or two words and four digits, joined. */
export const maskStyleSchema = z.strictObject({
  form: z.enum(["words", "words-digits"]),
  separator: z.enum(["camel", "underscore", "period"]),
});
export type MaskStyle = z.infer<typeof maskStyleSchema>;

/** Makes a free masked address for a mailbox; the caller writes the row. */
export type Masker = (input: {
  mailbox: string;
  domain: Domain; // must have masking: true
  style: MaskStyle;
  label: string;
}) => Promise<MailboxAddress>;

// A random address can be taken; five tries keep a full domain from looping forever.
const TRIES = 5;

// Words then digits each form draws: a lookup, not a chain.
const COUNTS: Record<MaskStyle["form"], readonly [number, number]> = {
  words: [3, 0],
  "words-digits": [2, 4],
};

// How each separator joins the words and the digits, which are empty for the words form.
const JOINS: Record<MaskStyle["separator"], (words: string[], digits: string) => string> = {
  camel: (words, digits) =>
    words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("") + digits,
  underscore: (words, digits) => [...words, digits].filter((p) => p !== "").join("_"),
  period: (words, digits) => [...words, digits].filter((p) => p !== "").join("."),
};

/**
 * A number below n with no bias: two random bytes read big-endian, drawn again while they are at
 * or above the largest multiple of n that fits in 16 bits, so every remainder is equally likely.
 */
function drawer(random: Random): (n: number) => number {
  return (n) => {
    const limit = 65536 - (65536 % n);
    for (;;) {
      const bytes = new Uint8Array(2);
      random(bytes);
      const value = new DataView(bytes.buffer).getUint16(0);
      if (value < limit) return value % n;
    }
  };
}

/**
 * RFC 5322 3.4.1: a masked local part is a dot-atom of fair draws from the EFF short wordlist 1,
 * free at its domain. Throws before asking the directory when the domain does not offer masking,
 * and after five taken candidates.
 */
export function createMasker(env: {
  directory: Directory;
  random?: Random;
  now?: () => Date;
}): Masker {
  const draw = drawer(env.random ?? ((into) => crypto.getRandomValues(into)));
  const now = env.now ?? (() => new Date());
  return async ({ mailbox, domain, style, label }) => {
    if (!domain.masking) throw new Error(`masking is off at ${domain.name}`);
    const [wordCount, digitCount] = COUNTS[style.form];
    for (let tried = 0; tried < TRIES; tried++) {
      // A slice of one, since a draw below WORDS.length always names a word.
      const words = Array.from({ length: wordCount }, () => draw(WORDS.length)).flatMap((i) =>
        WORDS.slice(i, i + 1),
      );
      const digits = Array.from({ length: digitCount }, () => draw(10)).join("");
      const shown = JOINS[style.separator](words, digits);
      const local = canonicalLocal(shown);
      if ((await env.directory.address(local, domain.name)) === null) {
        return {
          local,
          domain: domain.name,
          mailbox,
          enabled: true,
          mask: { shown, label, createdAt: now() },
        };
      }
    }
    throw new Error(`no free masked address at ${domain.name} after ${TRIES} tries`);
  };
}
