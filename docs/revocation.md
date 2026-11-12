# Revocation

Revoking a mailbox closes every IMAP and submission session logged in to it. A person who loses a password loses access.

## Calling it

The deployer's Worker calls the mailbox object:

```ts
const { told, closed, failed } = await env.IMAP_MAILBOX.get(
  env.IMAP_MAILBOX.idFromName(mailbox),
).revoke();
```

- `told` is how many registered sessions revoke reached for.
- `closed` is how many sockets those sessions closed.
- `failed` is how many sessions were not reached.

Remove the credential first, and revoke second. A session that reconnects before the credential is gone would otherwise log in again.

## Revocation is per mailbox

Revocation is per mailbox. Session state stores the account and not the user, so a session logged in with another valid password on the same mailbox also closes, and its client reconnects.

## What a client sees

An IMAP client receives `* BYE credential revoked`, and a submission client receives `421 Credential revoked`. Then the socket closes.

A message already handed to the send binding is not recalled. A message still being uploaded is dropped.

## When failed is above 0

A session was not reached: it did not answer within 10 seconds, its call rejected, or the Worker binds no `SUBMIT_SESSION`. A failed name stays registered, so call `revoke()` again, once the binding exists if that was the cause.

## What it does not cover

- A login already past its password check when `revoke()` runs was not measured, and that call does not close it.
- A session that logged in before this version and has not selected since is not registered.
- No close time is promised. Local workerd measured up to 8.2 s, with the cause not separated, and deployed latency was not measured. What real mail apps do on BYE or 421 was not measured either.
