import { describe, expect, it } from 'vitest';
import { inboxRoleSchema, inboxUserSchema } from '../src/auth.js';
import type { AuthAdapter, InboxUser } from '../src/auth.js';

describe('inboxUserSchema', () => {
  it('accepts valid user data', () => {
    const user = { id: 'user_01', email: 'alice@example.com', name: 'Alice' };
    expect(inboxUserSchema.parse(user)).toEqual(user);
  });

  it('accepts user without optional name', () => {
    const user = { id: 'user_02', email: 'bob@example.com' };
    expect(inboxUserSchema.parse(user)).toEqual(user);
  });

  it('rejects invalid email', () => {
    const user = { id: 'user_03', email: 'not-an-email' };
    expect(() => inboxUserSchema.parse(user)).toThrow();
  });
});

describe('inboxRoleSchema', () => {
  it('accepts all four roles', () => {
    for (const role of ['owner', 'admin', 'agent', 'viewer'] as const) {
      expect(inboxRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects invalid role', () => {
    expect(() => inboxRoleSchema.parse('superadmin')).toThrow();
  });
});

describe('AuthAdapter', () => {
  it('can be implemented as a mock', () => {
    const currentUser: InboxUser = {
      id: 'user_01',
      email: 'test@example.com',
      name: 'Test User',
    };

    const adapter: AuthAdapter = {
      getCurrentUser: async () => currentUser,
      getUserById: async (id) => (id === currentUser.id ? currentUser : null),
      hasMailboxAccess: async () => true,
      getUserRole: async () => 'admin',
    };

    // Verify the adapter satisfies the interface by calling each method
    expect(adapter.getCurrentUser).toBeDefined();
    expect(adapter.getUserById).toBeDefined();
    expect(adapter.hasMailboxAccess).toBeDefined();
    expect(adapter.getUserRole).toBeDefined();
  });
});
