---
"@rafters/mail": patch
---

A message at the provider's 25 MiB limit can be read over IMAP: a response becomes octets without listing every character, so `FETCH BODY[]` no longer runs a session out of a 128 MB heap.
