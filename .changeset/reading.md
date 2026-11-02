---
"@rafters/mail": minor
---

Add `@rafters/mail/read`: `readMessage` reads a received message from its stored bytes into its header fields in order, its addresses, message identifiers and date (obsolete forms included), and a tree of MIME parts as byte ranges, recording a problem for whatever it cannot read and never throwing. `section`, `partText` and `decodeWords` find a part by its IMAP section and decode its text and encoded words when asked.
