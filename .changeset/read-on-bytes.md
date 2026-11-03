---
"@rafters/mail": patch
---

Reading a message's structure works on its bytes: `readMessage` and `BODYSTRUCTURE` decode only header sections, so a mail app can read a message with a large attachment. `parseParts`, `partFields` and `bodyLines` now take the message's `Uint8Array` in place of its binary text.
