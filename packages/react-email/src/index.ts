// @rafters/mail-react-email: React Email templates rendered as `{ html, text }` for @rafters/mail
// (form 01a18fda, The template plugin): "It publishes `renderTemplate`, `OtpEmail`, `OtpEmailProps`,
// `BaseEmail` and `BaseEmailProps`."

export { renderTemplate } from "./render.ts";
export { BaseEmail, type BaseEmailProps } from "./templates/base-email.tsx";
export { OtpEmail, type OtpEmailProps } from "./templates/otp-email.tsx";
