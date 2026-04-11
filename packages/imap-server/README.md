# @rafters/mail-imap-server

Node TCP/TLS runtime for [`@rafters/mail-imap`](https://www.npmjs.com/package/@rafters/mail-imap). Listens on port 993 (IMAPS). One TCP connection per IMAP session. Deploys anywhere Node runs: Fly, Railway, AWS Fargate, DigitalOcean, Docker, VPS.

Standard email clients (Apple Mail, Thunderbird, Outlook, K-9) connect directly over TLS, no local proxy.

## Install

```bash
pnpm add @rafters/mail-imap-server @rafters/mail-imap @rafters/mail
```

## Usage

### TLS-terminated at the server

```typescript
import { createImapServer } from "@rafters/mail-imap-server";
import { readFileSync } from "node:fs";
import { createAuthAdapter, createMailboxAdapter, createMessageAdapter } from "./adapters.ts";

const server = createImapServer({
  adapters: {
    authAdapter: createAuthAdapter(),
    mailboxAdapter: createMailboxAdapter(),
    messageAdapter: createMessageAdapter(),
  },
  tls: {
    cert: readFileSync("/etc/letsencrypt/live/imap.example.com/fullchain.pem"),
    key: readFileSync("/etc/letsencrypt/live/imap.example.com/privkey.pem"),
  },
  host: "0.0.0.0",
  port: 993,
  async resolveMailboxId(email) {
    return lookupMailboxIdByEmail(email);
  },
});

await server.listen();
```

### TLS-terminating proxy mode (Fly, Railway, ALB)

On platforms that terminate TLS at the edge and forward plain TCP to your app, omit the `tls` config:

```typescript
const server = createImapServer({
  adapters: {
    /* ... */
  },
  // No tls field -- plain TCP mode.
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? 993),
  async resolveMailboxId(email) {
    /* ... */
  },
});

await server.listen();
```

The proxy handles TLS on 993 with its own certificate and forwards plain TCP to the server's internal port.

## Configuration

| Option             | Default       | Description                                                           |
| ------------------ | ------------- | --------------------------------------------------------------------- |
| `adapters`         | required      | `authAdapter`, `mailboxAdapter`, `messageAdapter`, `extensionAdapter` |
| `resolveMailboxId` | required      | Function mapping authenticated email to mailbox ID                    |
| `tls`              | optional      | `{ cert, key }`. Omit for plain TCP behind a TLS proxy                |
| `host`             | `0.0.0.0`     | Bind address                                                          |
| `port`             | `993`         | Listen port                                                           |
| `maxConnections`   | `1000`        | Concurrent connection cap. Excess get `BYE Server too busy`           |
| `sessionTimeoutMs` | `30 * 60_000` | Idle session timeout before `BYE Session timeout`                     |

## Deployment

The server is a long-lived Node process. It cannot run on serverless-function runtimes that do not support persistent TCP connections (Vercel, Deno Deploy). For those, deploy the Node server in Docker on a platform that does (Fly, Railway, Fargate, VPS).

## Documentation

Per-package docs ship in the `docs/` directory and on npm:

- [`quickstart.md`](./docs/quickstart.md) -- Zero-to-running IMAP server in a few minutes with a working adapter stub
- [`deployment.md`](./docs/deployment.md) -- Platform-by-platform deployment (Fly, Railway, Fargate, Docker, VPS) with TLS certificate handling

See the [monorepo README](https://github.com/rafters-studio/mail#readme) for the IMAP architecture overview.

## License

MIT
