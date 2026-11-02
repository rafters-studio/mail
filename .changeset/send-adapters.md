---
"@rafters/mail-cloudflare": minor
---

Sending on Cloudflare: `bindingTransport` sends raw bytes through the binding once per recipient, `socketConnection` gives a Workers socket as a `Connection`, `fromCloudflare` maps the six sending events, `d1Sends`, `d1Events` and `d1History` keep the send log (migration `0002_sending.sql`), and `sendingWorker` is the second Worker, with `fetch` and `queue`, that hears what happened. It now depends on `zod`.
