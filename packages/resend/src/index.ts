// What @rafters/mail-resend publishes (form 01a19d25): "Provider events have one shape and are
// believed only when authentic." Resend's submission settings, and its webhook as those events.
export { RESEND_SMTP, resendLogin } from "./smtp.ts";
export { fromResend, verifyWebhook } from "./webhook.ts";
