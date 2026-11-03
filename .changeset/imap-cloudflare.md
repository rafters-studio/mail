---
"@rafters/mail-cloudflare": minor
---

IMAP on Cloudflare: `imapObjects` gives a hibernating session object per connection, which saves before it sends, and a mailbox object per mailbox, which pulls deliveries and assigns UIDs. `imapWorker` is the Worker in front of them, the caller's `login` function decides who gets in, and `emailWorker` pings a mailbox after an accept when `IMAP_MAILBOX` is bound.
