// An envelope address (RFC 5321 2.4): "The local-part of a mailbox MUST BE treated as case
// sensitive." Mail chooses otherwise, so a person is found however a sender types them: case is
// folded and the dots of an unquoted local part before its tag are dropped, as Gmail does, and no
// two addresses at a domain differ only by those (toy 01a19a03, R4: `Sean@` missed `sean@`).

/** An envelope address as mail finds it: the canonical local part, its tag, and its domain. */
export type Recipient = { local: string; tag: string | null; domain: string | null };

/**
 * RFC 5233 subaddressing: splits at the last "@" and then at the first "+" of an unquoted local
 * part. A quoted local part has no tag, and an empty tag (`sean+@`) is none.
 */
export function recipient(address: string): Recipient {
  const at = address.lastIndexOf("@");
  const local = canonicalLocal(at === -1 ? address : address.slice(0, at));
  const domain = at === -1 ? null : domainName(address.slice(at + 1));
  const plus = local.startsWith('"') ? -1 : local.indexOf("+");
  if (plus === -1) return { local, tag: null, domain };
  return { local: local.slice(0, plus), tag: local.slice(plus + 1) || null, domain };
}

/**
 * The one form a stored row and a recipient meet in: lowercased, and when unquoted, without the
 * dots before the first "+". Dots in a tag are kept; a quoted local part keeps all it holds.
 */
export function canonicalLocal(text: string): string {
  const lower = text.toLowerCase();
  if (lower.startsWith('"')) return lower;
  const plus = lower.indexOf("+");
  const head = plus === -1 ? lower : lower.slice(0, plus);
  return head.replaceAll(".", "") + (plus === -1 ? "" : lower.slice(plus));
}

/**
 * UTS 46 through URL parsing, so `exemplé.fr` and `xn--exempl-gva.fr` are one name. A name with a
 * port, path or literal character is null first, since URL parsing would drop them
 * (`rafters.studio:25` would become `rafters.studio`); an IPv4 address and an RFC 5321 address
 * literal are no one's domain.
 */
export function domainName(name: string): string | null {
  if (name === "" || /[:/?#%[\]\\@\s]/.test(name)) return null;
  const host = URL.parse(`http://${name}`)?.hostname.replace(/\.$/, "") ?? "";
  return host === "" || /(^|\.)\d+$/.test(host) ? null : host;
}
