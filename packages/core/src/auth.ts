import { z } from 'zod';

// -- Schemas --

export const inboxUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

export const inboxRoleSchema = z.enum(['owner', 'admin', 'agent', 'viewer']);

// -- Types --

export type InboxUser = z.infer<typeof inboxUserSchema>;
export type InboxRole = z.infer<typeof inboxRoleSchema>;

// -- Auth Adapter Interface --

export interface AuthAdapter {
  getCurrentUser(): Promise<InboxUser>;
  getUserById(id: string): Promise<InboxUser | null>;
  hasMailboxAccess(userId: string, mailboxId: string): Promise<boolean>;
  getUserRole(userId: string, mailboxId: string): Promise<InboxRole | null>;
}
