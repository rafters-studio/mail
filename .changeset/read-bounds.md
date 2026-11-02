---
"@rafters/mail": patch
---

No message runs a reader out of memory: `readMessage` reads 1 MiB of a header section and 10,000 MIME parts, past which it records a `header-too-large` or `too-many-parts` problem.
