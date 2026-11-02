---
"@rafters/mail": minor
---

`@rafters/mail/imap`: an IMAP4rev1 session, `createImapSession({ store })`, octets in and octets out over an `ImapStore` port, so one session serves any transport. It frames commands before parsing them (literals by count, `LITERAL+`), keeps to RFC 3501's states, answers every malformed command and carries on, and closes on abuse. It serves LIST, LSUB, STATUS, SELECT, EXAMINE, FETCH (ENVELOPE, BODYSTRUCTURE and every BODY section read from the stored bytes), STORE, SEARCH, EXPUNGE, UID commands, IDLE and UNSELECT, and advertises exactly `IMAP4rev1 LITERAL+ IDLE UIDPLUS UNSELECT`.
