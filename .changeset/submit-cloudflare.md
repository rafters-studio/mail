---
"@rafters/mail-cloudflare": minor
---

Submission on Cloudflare: `submitObject` gives a hibernating object per connection that keeps a message in memory only, sends through the `EMAIL` binding, and keeps the bytes sent in `<mailbox>/Sent` (migration `0004_sent.sql`). `imapWorker` gains the path `/submit`, `sendingWorker` tells the mailbox that sent it of a later bounce when `MAIL_BLOBS` and `IMAP_MAILBOX` are bound, and `bindingTransport` decodes in chunks, so 26 MB fits in an isolate.
