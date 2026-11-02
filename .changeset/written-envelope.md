---
"@rafters/mail": patch
---

Every `Written` from `compose`, `replyTo` and `forward` carries its SMTP `envelope`: the From address as the sender and the To, Cc and Bcc addresses as recipients, each once, so whoever sends the bytes reaches the blind copies the bytes never name. `Envelope` is exported beside `Written`.
