---
"@rafters/mail": minor
"@rafters/mail-resend": minor
"@rafters/mail-cloudflare": minor
"@rafters/mail-react-email": minor
"@rafters/mail-workers-ai": minor
"@rafters/better-auth-resend": minor
"@rafters/mail-imap": minor
"@rafters/mail-imap-cloudflare": minor
"@rafters/mail-imap-server": minor
---

Initial release. Email inbox framework for the edge.

Core: 13 Drizzle tables, Zod validators, service interfaces, threading (RFC 5322), migrations, auth adapter, service implementations, newsletter schema.

Resend: ResendService, createResendProvider, MockEmailProvider, webhook handler.

Cloudflare: R2 storage adapter, email parsing, content hashing.

React Email: BaseEmail, OtpEmail templates, createReactEmailRenderer.

Workers AI: DeBERTa-v3 classifier, priority determination, auto-tagging.

better-auth-resend: resendOTP() one-line emailOTP integration.

mail-imap: IMAP4rev1 protocol layer. Transport-agnostic command handlers (CAPABILITY, LOGIN, LOGOUT, SELECT, EXAMINE, LIST, LSUB, STATUS, FETCH, STORE, SEARCH, EXPUNGE, NOOP, CLOSE, UNSELECT, IDLE, COPY, MOVE, APPEND, UID), session state machine, UID mapping, flag mapping, and adapter interfaces (AuthAdapter, MailboxAdapter, MessageAdapter, ExtensionAdapter).

mail-imap-cloudflare: Durable Object runtime adapter for mail-imap. One DO per mailbox, WebSocket transport, hibernation API for IDLE, inbound signal bridge for EXISTS notifications.

mail-imap-server: Node TCP/TLS runtime adapter for mail-imap. Listens on port 993 (IMAPS), deploys on Fly, Railway, Fargate, Docker, VPS. Supports TLS-terminating proxy mode for platforms that handle TLS at the edge.
