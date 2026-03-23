---
"@rafters/mail": minor
"@rafters/mail-resend": minor
"@rafters/mail-cloudflare": minor
"@rafters/mail-react-email": minor
"@rafters/mail-workers-ai": minor
"@rafters/better-auth-resend": minor
---

Initial release. Email inbox framework for the edge.

Core: 13 Drizzle tables, Zod validators, service interfaces, threading (RFC 5322), migrations, auth adapter, service implementations, newsletter schema.

Resend: ResendService, createResendProvider, MockEmailProvider, webhook handler.

Cloudflare: R2 storage adapter, email parsing, content hashing.

React Email: BaseEmail, OtpEmail templates, createReactEmailRenderer.

Workers AI: DeBERTa-v3 classifier, priority determination, auto-tagging.

better-auth-resend: resendOTP() one-line emailOTP integration.
