---
"@rafters/mail": minor
---

Add `@rafters/mail/receive`: `createReceiver` decides from the envelope alone whose mail a delivery is, stores the bytes exactly as handed under their SHA-256, and records one delivery per mailbox found. The directory finds a recipient's mailbox through its tag, its address, postmaster and the domain's catch-all, ignoring case and dots.
