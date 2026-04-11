# IMAP Deployment Guide

Deploy `@rafters/mail-imap-server` on your platform of choice. Each guide assumes you have the server code written per the quickstart.

---

## Fly.io

Best option for most deployments. $5-15/mo. TLS handled automatically.

### Dockerfile

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
CMD ["node", "--import", "tsx", "src/main.ts"]
```

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
    "startCommand": "node --import tsx src/main.ts",
    "healthcheckPath": null
  }
}
```

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
