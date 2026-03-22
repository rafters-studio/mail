export * from './schema/index.js';
export * from './threading.js';
export * from './interfaces/index.js';

export { createInboxEmailService } from './services/inbox-email.js';
export type { InboxEmailServiceConfig } from './services/inbox-email.js';

export {
  inboxUserSchema,
  inboxRoleSchema,
} from './auth.js';

export type {
  InboxUser,
  InboxRole,
  AuthAdapter,
} from './auth.js';
