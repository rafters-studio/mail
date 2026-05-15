# @rafters/mail-imap-cloudflare

## 0.1.0

### Minor Changes

- [#48](https://github.com/rafters-studio/mail/pull/48) [`13d4c9d`](https://github.com/rafters-studio/mail/commit/13d4c9d52090681b0f454dbced70020d85ba9f37) Thanks [@ssilvius](https://github.com/ssilvius)! - Initial release. Email inbox framework for the edge.

  Core: 13 Drizzle tables, Zod validators, service interfaces, threading (RFC 5322), migrations, auth adapter, service implementations, newsletter schema.

  Resend: ResendService, createResendProvider, MockEmailProvider, webhook handler.

  Cloudflare: R2 storage adapter, email parsing, content hashing.

  React Email: BaseEmail, OtpEmail templates, createReactEmailRenderer.

  Workers AI: DeBERTa-v3 classifier, priority determination, auto-tagging.

  better-auth-resend: resendOTP() one-line emailOTP integration.

  mail-imap: IMAP4rev1 protocol layer. Transport-agnostic command handlers (CAPABILITY, LOGIN, LOGOUT, SELECT, EXAMINE, LIST, LSUB, STATUS, FETCH, STORE, SEARCH, EXPUNGE, NOOP, CLOSE, UNSELECT, IDLE, COPY, MOVE, APPEND, UID), session state machine, UID mapping, flag mapping, and adapter interfaces (AuthAdapter, MailboxAdapter, MessageAdapter, ExtensionAdapter).

  mail-imap-cloudflare: Durable Object runtime adapter for mail-imap. One DO per mailbox, WebSocket transport, hibernation API for IDLE, inbound signal bridge for EXISTS notifications.

  mail-imap-server: Node TCP/TLS runtime adapter for mail-imap. Listens on port 993 (IMAPS), deploys on Fly, Railway, Fargate, Docker, VPS. Supports TLS-terminating proxy mode for platforms that handle TLS at the edge.

### Patch Changes

- Updated dependencies [[`13d4c9d`](https://github.com/rafters-studio/mail/commit/13d4c9d52090681b0f454dbced70020d85ba9f37)]:
  - @rafters/mail-imap@0.1.0
