---
"@rafters/mail": minor
---

`@rafters/mail/imap`: a session can be saved and resumed. `session.snapshot()` gives what the session told its client, and `createImapSession({ store, resume })` continues from it, sending the client nothing, so a host can discard a session between any two calls. A resumed session names the same messages after another client expunges, through the new `ImapStore.held`, and a snapshot never holds a password. A buffer past `MAX_LITERAL` plus `MAX_LINE` after its whole commands are read gets `* BYE command too long`.
