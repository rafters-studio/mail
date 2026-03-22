// @rafters/mail-react-email -- React Email template renderer

export { BaseEmail } from "./templates/base-email.js";
export type { BaseEmailProps } from "./templates/base-email.js";

export { OtpEmail } from "./templates/otp-email.js";
export type { OtpEmailProps } from "./templates/otp-email.js";

export { createReactEmailRenderer } from "./renderer.js";
export type { ReactEmailRenderer } from "./renderer.js";
