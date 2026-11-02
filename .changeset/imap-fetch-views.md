---
"@rafters/mail": patch
---

A `FETCH` of a whole message, or of one part, no longer copies the message into strings: a body goes out as a view on the stored bytes, joined once with the words around it, and a message is parsed only when an item asks for what parsing gives.
