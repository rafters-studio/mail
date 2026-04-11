# @rafters/mail-imap

IMAP4rev1 protocol layer for [@rafters/mail](https://github.com/rafters-studio/mail). Transport-agnostic command handlers, session state machine, UID mapping, and adapter interfaces. The protocol surface that makes standard email clients (Apple Mail, Thunderbird, Outlook, K-9) connect to your edge-native inbox.

This package contains no transport. Pair it with a runtime:

- [`@rafters/mail-imap-cloudflare`](https://www.npmjs.com/package/@rafters/mail-imap-cloudflare) -- Durable Object over WebSocket (hibernation, near-zero cost when idle)
- [`@rafters/mail-imap-server`](https://www.npmjs.com/package/@rafters/mail-imap-server) -- Node TCP/TLS server for Fly, Railway, Fargate, Docker, VPS

## Install

```bash
pnpm add @rafters/mail-imap @rafters/mail
```

You will almost always install one of the runtime adapters alongside this package. Use this package directly only if you are writing your own runtime.

## What you get

**IMAP4rev1 command handlers** covering the RFC 3501 surface plus common extensions:

- Authentication: `CAPABILITY`, `LOGIN`, `LOGOUT`
- Mailbox: `SELECT`, `EXAMINE`, `LIST`, `LSUB`, `STATUS`
- Message: `FETCH`, `STORE`, `SEARCH`, `EXPUNGE`, `NOOP`, `CLOSE`, `UID` prefix
- Session: `IDLE` (RFC 2177), `UNSELECT` (RFC 3691)
- Extensions: `COPY`, `MOVE` (RFC 6851), `APPEND`

**Session state machine** with `Not Authenticated`, `Authenticated`, and `Selected` states plus the RFC-correct transitions between them.

**UID map** for stable, monotonic message UIDs per folder across sessions.

**Flag mapping** between IMAP flags and `@rafters/mail` message field booleans (seen, answered, flagged, deleted, draft).

**Adapter interfaces** that the runtime implementations wire to your database:

- `AuthAdapter` -- `verifyAppPassword(email, password)` to your credential store
- `MailboxAdapter` -- folder listing, folder stats, UID enumeration
- `MessageAdapter` -- fetch messages, update flags, delete, blob retrieval, search
- `ExtensionAdapter` -- `COPY`, `MOVE`, and `APPEND` operations

You bring your own auth system. This package does not own credential storage, hashing, or app-password generation.

## Usage

Importing individual subpaths keeps bundle size small:

```typescript
// Protocol layer
import { parseCommand, formatTagged, generateGreeting } from "@rafters/mail-imap";

// Command handlers
import { handleLogin, handleLogout } from "@rafters/mail-imap/commands/auth";
import { handleSelect, handleList, handleStatus } from "@rafters/mail-imap/commands/mailbox";
import { handleFetch, handleStore, handleSearch } from "@rafters/mail-imap/commands/message";
import { handleIdleStart, handleIdleDone } from "@rafters/mail-imap/commands/session";
import { handleCopy, handleMove, handleAppend } from "@rafters/mail-imap/commands/extensions";

// Session state and UID map
import { ImapSession } from "@rafters/mail-imap/session";
import { UidMap } from "@rafters/mail-imap/uid-map";

// Adapter interfaces
import type {
  AuthAdapter,
  MailboxAdapter,
  MessageAdapter,
  ExtensionAdapter,
} from "@rafters/mail-imap";
```

## Documentation

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the IMAP architecture, runtime options, and the broader @rafters/mail framework.

## License

MIT
