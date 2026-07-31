# IMAP Deployment Guide

Deploy `@rafters/mail-imap-server` on your platform of choice. Each guide assumes you have the server code written per the quickstart.

---

## Prerequisites

Common to every platform below:

- **A database with the mail schema applied.** D1, Turso, or any libSQL-compatible SQLite. The IMAP server reads messages and folders; it does not create the schema.
- **Blob storage** holding the raw message bodies -- R2, S3, or anything implementing core's `BlobStorage`. Message metadata lives in the database, bodies live in blobs, and `FETCH BODY[]` needs both.
- **An auth adapter you supply.** `@rafters/mail-imap` ships the `ImapAuthAdapter` contract, not an implementation. LOGIN is your credential check, not ours.
- **A TLS certificate for port 993.** Every platform handles this differently; each section says how.
- **A DNS record** for the mail hostname clients will connect to.

What you do **not** need: a public HTTP surface. This is a TCP service. The only reason to expose HTTP is a health check, and most platforms can probe the TCP port directly.

Requirements that rule a platform out: a persistent process, a listener on an arbitrary TCP port, and a filesystem or secret store for the certificate. Any host that gives you all three can run this.

---

## Fly.io

Best option for most deployments. $5-15/mo. TLS handled automatically.

### Dockerfile

Multi-stage build: compile TypeScript to `dist/`, then run the compiled output with plain Node. No `tsx` in production -- compiled JavaScript only.

```dockerfile
# Build stage: install dev deps, compile to dist/
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime stage: prod deps only, run compiled output
FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
```

This assumes your consumer app has a `build` script that produces `dist/main.js`. Most TypeScript setups use `tsup`, `tsc`, or `esbuild` -- any of them work. Your `main.js` is the file that calls `createImapServer` and `server.listen()`.

### fly.toml

```toml
app = "mail-imap"
primary_region = "sjc"

[build]

[[services]]
  internal_port = 1993
  protocol = "tcp"

  [[services.ports]]
    port = 993
    handlers = ["tls"]

  [[services.tcp_checks]]
    grace_period = "10s"
    interval = "30s"
    timeout = "5s"
```

### Deploy

```bash
fly launch --no-deploy
fly secrets set DB_URL="libsql://your-db.turso.io" DB_TOKEN="your-token"
fly certs add mail.yourdomain.com
fly deploy
```

### DNS

```
mail.yourdomain.com  CNAME  mail-imap.fly.dev
```

### Health check

Fly's TCP check verifies the server accepts connections. The IMAP greeting confirms the protocol is working.

---

## Railway

Similar to Fly. TLS termination via Railway's proxy.

### railway.json

```json
{
  "build": { "builder": "DOCKERFILE" },
  "deploy": {
    "startCommand": "node dist/main.js",
    "healthcheckPath": null
  }
}
```

Uses the same multi-stage Dockerfile as Fly.io. Compile TypeScript to `dist/` at image build time, run the compiled output at startup.

### Settings

- Custom domain: `mail.yourdomain.com`
- TCP proxy: enable, external port 993, internal port 1993
- Railway provisions TLS automatically for custom domains

### Secrets

Set `DB_URL`, `DB_TOKEN`, and any auth secrets via Railway dashboard or CLI.

---

## AWS Fargate

For teams already on AWS. ~$15-30/mo.

### Architecture

```
Internet -> NLB (port 993, TLS via ACM) -> Fargate task (port 1993, plain TCP)
```

### Key resources

- **NLB** (Network Load Balancer): TCP passthrough on port 993
- **ACM certificate**: for `mail.yourdomain.com`
- **ECS Service**: runs the container
- **Security Group**: allow inbound 993 from 0.0.0.0/0

### Task definition (simplified)

```json
{
  "containerDefinitions": [
    {
      "name": "mail-imap",
      "image": "your-ecr-repo/mail-imap:latest",
      "portMappings": [{ "containerPort": 1993, "protocol": "tcp" }],
      "environment": [{ "name": "PORT", "value": "1993" }],
      "secrets": [
        { "name": "DB_URL", "valueFrom": "arn:aws:ssm:..." },
        { "name": "DB_TOKEN", "valueFrom": "arn:aws:ssm:..." }
      ]
    }
  ]
}
```

### NLB listener

- Protocol: TLS
- Port: 993
- Certificate: ACM cert for `mail.yourdomain.com`
- Target group: Fargate tasks on port 1993 (TCP)

### DNS

```
mail.yourdomain.com  CNAME  your-nlb-dns.elb.amazonaws.com
```

---

## Docker / VPS

Direct deployment. You manage TLS.

### With Let's Encrypt (certbot)

```bash
certbot certonly --standalone -d mail.yourdomain.com
```

### Server config

```typescript
import { readFileSync } from "node:fs";

const server = createImapServer({
  port: 993,
  tls: {
    cert: readFileSync("/etc/letsencrypt/live/mail.yourdomain.com/fullchain.pem"),
    key: readFileSync("/etc/letsencrypt/live/mail.yourdomain.com/privkey.pem"),
  },
  // ... adapters
});
```

### docker-compose.yml

```yaml
services:
  imap:
    build: .
    ports:
      - "993:993"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    environment:
      - DB_URL=libsql://your-db.turso.io
      - DB_TOKEN=your-token
    restart: unless-stopped
```

### Certificate renewal

```bash
# Cron job: renew cert and restart container
0 3 * * * certbot renew --quiet && docker compose restart imap
```

---

## Testing with a real client

Verify the transport before touching a mail client, so that a failure has one possible cause rather than two:

```bash
openssl s_client -connect mail.yourdomain.com:993 -crlf
# * OK IMAP4rev1 Service Ready
a1 LOGIN you@yourdomain.com hunter2
a2 LIST "" "*"
a3 SELECT INBOX
a4 FETCH 1 (FLAGS BODY[HEADER.FIELDS (SUBJECT FROM DATE)])
a5 LOGOUT
```

`-crlf` matters. IMAP requires CRLF line endings per RFC 3501, and without it the server sees unterminated commands and appears to hang after LOGIN -- which reads exactly like an auth failure and sends you debugging the wrong thing.

### Thunderbird

Account Settings > Server Settings:

| Field               | Value                 |
| ------------------- | --------------------- |
| Server              | `mail.yourdomain.com` |
| Port                | 993                   |
| Connection security | SSL/TLS               |
| Authentication      | Normal password       |
| Username            | full email address    |

Thunderbird is the better first client to test with: its Activity Manager (Tools > Activity Manager) shows the actual IMAP dialogue, so a failure names itself.

### Apple Mail

Add an account manually rather than letting autodiscovery run -- there are no autoconfig records, so autodiscovery will guess wrong and then cache the guess.

Mail > Settings > Accounts > Add Other Mail Account, then set the incoming server to `mail.yourdomain.com`. Apple Mail will not offer a port field until it fails once; let it fail, then set 993 with TLS in Server Settings and uncheck "Automatically manage connection settings".

Apple Mail opens several concurrent connections -- roughly one per folder it watches -- so a per-mailbox session limit below about 5 shows up as folders that intermittently fail to sync rather than as an obvious connection error.

### What to check

- `LIST "" "*"` returns your folders. If LOGIN succeeds but LIST is empty, the server is pointed at the wrong database.
- `FETCH 1 BODY[]` returns a full message. If headers come back but bodies do not, blob storage is misconfigured -- metadata and bodies come from different places.
- New mail appears without a manual refresh, which exercises IDLE.

---

## Monitoring

The useful signals are the same everywhere:

- **TCP reachability on 993.** A plain connect-and-read of the greeting is a sufficient liveness probe, and better than an HTTP endpoint because it exercises the actual listener and its TLS.
- **Certificate expiry.** The most common way a working IMAP server stops working. `openssl s_client -connect host:993 2>/dev/null | openssl x509 -noout -enddate` in a cron job with an alert at 14 days is enough.
- **Concurrent connection count** against your per-mailbox session limit. Clients that reconnect without closing cleanly will pile up.
- **Database and blob latency.** `FETCH` fans out to both; a slow blob store shows up as clients timing out mid-download rather than as an error in your logs.

Each platform section above gives its own health-check configuration.

---

## Cost expectations

Rough monthly figures for a small deployment, excluding the database and blob storage you are already paying for:

| Platform     | Typical | Notes                                                                                                                               |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fly.io       | $5-15   | Cheapest workable option. TLS automatic. Scales to a few hundred connections on the smallest paid instance.                         |
| Railway      | $5-20   | Comparable to Fly. Simpler setup, less control over TCP.                                                                            |
| Docker / VPS | $5-10   | A small VPS is the cheapest at the low end, and the only option with no per-connection pricing at all. You own certificate renewal. |
| AWS Fargate  | $30-60  | The NLB alone is roughly $20/mo before traffic. Worth it only if you are already on ECS.                                            |

IMAP connections are long-lived and mostly idle, so the driver is concurrent connection count and memory, not request volume. A mailbox with one client attached costs essentially nothing beyond keeping the process alive; the platform floor dominates until you have many mailboxes.

Compare against [`@rafters/mail-imap-cloudflare`](https://www.npmjs.com/package/@rafters/mail-imap-cloudflare), where hibernation makes idle mailboxes near-free -- at the cost of no native TCP, so no standard mail clients.

---

## Not supported

### Vercel

Vercel Functions are stateless request/response. No persistent TCP connections. Cannot host IMAP.

### Deno Deploy

Deno Deploy is request/response. No TCP listeners. Use Deno in a Docker container instead.

### Cloudflare Containers

HTTP-only sidecars. No TCP port exposure. Cannot host IMAP.

### Cloudflare (native TCP/993)

Requires Spectrum (Enterprise plan, ~$5k/mo). Use the Cloudflare DO runtime (`@rafters/mail-imap-cloudflare`) with WebSocket transport instead, or deploy `@rafters/mail-imap-server` on Fly.

---

## Multi-domain

One deployment serves all your domains. The `resolveMailboxId` callback maps email addresses to mailbox IDs:

```typescript
async resolveMailboxId(email) {
  const domain = email.split("@")[1];
  // Look up mailbox by email in your database
  const mailbox = await db.query.mailbox.findFirst({
    where: eq(mailbox.emailAddress, email),
  });
  return mailbox?.id;
}
```

DNS: point each domain's mail subdomain at the same server.

```
mail.silvius.me       CNAME  mail-imap.fly.dev
mail.runlegion.dev    CNAME  mail-imap.fly.dev
mail.gitpress.app     CNAME  mail-imap.fly.dev
```

Apple Mail: configure each account with its domain's mail hostname. All resolve to the same server. The server routes by email address after LOGIN.
