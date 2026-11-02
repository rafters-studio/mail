---
"@rafters/mail": minor
---

`@rafters/mail/submit`: an SMTP submission session, octets in and octets out, so a mail app can send through mail. `createSubmission({ ports, hostname })` requires a login, lets a login send only as its own address, refuses smuggling, removes blind copies, holds a retry by a hash of the mailbox and the exact bytes, answers from what the send log recorded, and resumes after every whole command through `snapshot()`. `writeNotice` writes the plain message that tells a person of a failure known after a 250. `UNSAFE_ADDRESS` moves to `send/unsafe.ts`, still re-exported by `@rafters/mail/send`.
