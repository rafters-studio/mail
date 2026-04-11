# IMAP Authentication

How email clients authenticate with the IMAP server.

---

## The AuthAdapter

The IMAP server delegates all authentication to the consumer via the `AuthAdapter` interface:

```typescript
interface AuthAdapter {
  verifyAppPassword(email: string, appPassword: string): Promise<boolean>;
}
```

The IMAP server calls this on every LOGIN command. It does not know or care how the credential is stored, hashed, or managed. That is entirely the consumer's responsibility.

---

## How LOGIN works

```
C: a001 LOGIN user@example.com some-credential
S: a001 OK LOGIN completed
```

1. Client sends email + credential
2. IMAP server calls `authAdapter.verifyAppPassword(email, credential)`
3. Adapter returns `true` (authenticated) or `false` (rejected)
4. IMAP server responds OK or NO

The IMAP server enforces:

- **No information leakage**: generic "LOGIN failed" on bad credentials (never reveals whether the email exists)
- **Rate limiting**: 3 failed attempts per session, then disconnect
- **TLS required**: credentials are never transmitted in plaintext

Everything else -- credential storage, hashing, generation, revocation, UI -- is the consumer's domain.

---

## Implementing the adapter

The adapter is a single function. Wire it to your auth system:

### With an API token system

```typescript
const authAdapter: AuthAdapter = {
  async verifyAppPassword(email, token) {
    // Call your auth service
    const valid = await myAuthService.validateToken(email, token);
    return valid;
  },
};
```

### With a database lookup

```typescript
const authAdapter: AuthAdapter = {
  async verifyAppPassword(email, password) {
    const record = await db.findCredential(email);
    if (!record) return false;
    return await verifyHash(record.hash, password);
  },
};
```

### With an external auth provider

```typescript
const authAdapter: AuthAdapter = {
  async verifyAppPassword(email, token) {
    const response = await fetch("https://auth.example.com/verify", {
      method: "POST",
      body: JSON.stringify({ email, token }),
    });
    return response.ok;
  },
};
```

The IMAP server does not prescribe how credentials are created, stored, hashed, or managed. Any system that can answer "is this credential valid for this email?" works.

---

## Security guarantees from the IMAP server

These are enforced regardless of the adapter implementation:

| Guarantee                          | How                                               |
| ---------------------------------- | ------------------------------------------------- |
| No credential leakage in responses | Generic "LOGIN failed" message                    |
| Brute force protection             | 3 attempts per session, then BYE + disconnect     |
| Encrypted transport                | TLS required (server-managed or proxy-terminated) |
| Session isolation                  | Each connection has its own attempt counter       |

---

## What the consumer owns

| Concern               | Consumer's responsibility                          |
| --------------------- | -------------------------------------------------- |
| Credential storage    | Database table, KV store, auth service             |
| Hashing               | argon2, bcrypt, scram -- consumer chooses          |
| Generation UI         | Dashboard, CLI, API endpoint                       |
| Revocation            | Delete the credential, next LOGIN fails            |
| Per-device management | Multiple credentials per user if needed            |
| Password policy       | Length, complexity, expiration -- consumer decides |

---

## Future: SASL

If the consumer's auth system supports SASL mechanisms (OAUTHBEARER, SCRAM-SHA-256), the IMAP server may add AUTHENTICATE command support. The AuthAdapter interface would extend to support SASL negotiation. LOGIN with the current interface remains the default.
