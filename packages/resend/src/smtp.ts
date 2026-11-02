// Resend's submission settings (Resend SMTP docs): "Ports help to instruct the type of security
// you want to use in your SMTP connection." Port 465 is implicit TLS, so the connection already
// speaks TLS before the first command, as core's Connection requires.

export const RESEND_SMTP: { hostname: "smtp.resend.com"; port: 465 } = {
  hostname: "smtp.resend.com",
  port: 465,
};

/** Resend SMTP docs: the user is `resend` and the password an API key. */
export function resendLogin(apiKey: string): { user: "resend"; password: string } {
  return { user: "resend", password: apiKey };
}
