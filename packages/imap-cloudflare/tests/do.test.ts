import { describe, it, expect } from "vitest";
import { createImapDurableObject } from "../src/do.ts";
import type { ImapAuthAdapter, MailboxAdapter, MessageAdapter } from "@rafters/mail-imap";

describe("createImapDurableObject", () => {
  it("returns a class constructor", () => {
    const DOClass = createImapDurableObject({
      createAdapters() {
        return {
          authAdapter: {} as ImapAuthAdapter,
          mailboxAdapter: {} as MailboxAdapter,
          messageAdapter: {} as MessageAdapter,
        };
      },
    });
    expect(typeof DOClass).toBe("function");
  });

  it("accepts custom options", () => {
    const DOClass = createImapDurableObject(
      {
        createAdapters() {
          return {
            authAdapter: {} as ImapAuthAdapter,
            mailboxAdapter: {} as MailboxAdapter,
            messageAdapter: {} as MessageAdapter,
          };
        },
      },
      { maxSessionsPerMailbox: 5, sessionTimeoutMs: 60000 },
    );
    expect(typeof DOClass).toBe("function");
  });
});
