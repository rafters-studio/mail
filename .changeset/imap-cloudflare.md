---
"@rafters/mail-cloudflare": minor
---

IMAP on Cloudflare: `imapObjects` gives a hibernating session object per connection, which saves before it sends, and a mailbox object per mailbox, which pulls deliveries and assigns UIDs. `imapWorker` is the Worker in front of them, `d1Logins` and `hashPassword` verify logins (migration `0003_imap.sql`), and `emailWorker` pings a mailbox after an accept when `IMAP_MAILBOX` is bound.
