---
"@rafters/mail": patch
---

Reading never throws on deep nesting: a multipart or message part nested `MAX_DEPTH` (50) deep is read as a leaf with a `too-deep` problem. `contentType`, `partFields` and `bodyLines` give IMAP each part's Content-Type parameters, its own header fields and its line count.
