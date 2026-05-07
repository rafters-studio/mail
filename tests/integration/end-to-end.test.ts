import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { migrationSQL } from "@rafters/mail/migrations";
import {
  createFolderService,
  createInboxEmailService,
  inboxMessage,
  inboxThread,
  mailbox,
} from "@rafters/mail-drizzle";
import { createMockEmailProvider } from "@rafters/mail-resend";
import {
  determinePriority,
  extractTags,
  DEFAULT_URGENT_KEYWORDS,
  DEFAULT_HIGH_PRIORITY_KEYWORDS,
  DEFAULT_TAG_PATTERNS,
} from "@rafters/mail-workers-ai";

type AsyncDB = BaseSQLiteDatabase<"async", unknown>;

let sqlite: InstanceType<typeof Database>;
let db: AsyncDB;

function createDB(): { sqlite: InstanceType<typeof Database>; db: AsyncDB } {
  const raw = new Database(":memory:");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const statements = migrationSQL.split(";").filter((s) => s.trim());
  for (const stmt of statements) {
    raw.exec(stmt);
  }
  const d = drizzle(raw) as unknown as AsyncDB;
  return { sqlite: raw, db: d };
}

function createMockBlobStorage() {
  const store = new Map<string, string | ArrayBuffer>();

  return {
    async put(key: string, content: string | ArrayBuffer) {
      store.set(key, content);
    },
    async get(key: string) {
      const content = store.get(key);
      if (!content) return null;
      return {
        text: async () =>
          typeof content === "string" ? content : new TextDecoder().decode(content),
        arrayBuffer: async () =>
          typeof content === "string"
            ? (new TextEncoder().encode(content).buffer as ArrayBuffer)
            : content,
      };
    },
    async delete(key: string) {
      store.delete(key);
    },
    generateKey(contentHash: string, extension: string) {
      return `test/${contentHash}.${extension}`;
    },
    getStore: () => store,
  };
}

describe("end-to-end: outbound email flow", () => {
  let mailboxId: string;

  beforeEach(async () => {
    const created = createDB();
    sqlite = created.sqlite;
    db = created.db;

    mailboxId = uuidv7();
    await db.insert(mailbox).values({
      id: mailboxId,
      emailAddress: "support@example.com",
      localPart: "support",
      organizationId: "org-1",
      displayName: "Support Team",
      signature: "-- Support Team",
    });

    const folders = createFolderService(db);
    await folders.initSystemFolders(mailboxId);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it("composes email: creates thread + message, stores in blob, sends via provider", async () => {
    const mockProvider = createMockEmailProvider();
    const blobStorage = createMockBlobStorage();

    const emailService = createInboxEmailService({
      db,
      blobStorage: blobStorage as Parameters<typeof createInboxEmailService>[0]["blobStorage"],
      emailProvider: mockProvider,
      domain: "example.com",
    });

    const result = await emailService.composeEmail({
      mailboxId,
      senderId: "user-1",
      to: ["customer@test.com"],
      subject: "Welcome",
      body: "Hello, welcome to our service.",
    });

    expect(result.threadId).toBeTruthy();
    expect(result.messageId).toBeTruthy();

    // Email sent via provider
    expect(mockProvider.sentEmails).toHaveLength(1);
    expect(mockProvider.sentEmails[0]!.params.to).toBe("customer@test.com");

    // Thread created in DB
    const thread = await db
      .select()
      .from(inboxThread)
      .where(eq(inboxThread.id, result.threadId))
      .get();
    expect(thread).toBeTruthy();
    expect(thread!.subject).toBe("Welcome");
    expect(thread!.messageCount).toBe(1);

    // Message created in DB
    const message = await db
      .select()
      .from(inboxMessage)
      .where(eq(inboxMessage.id, result.messageId))
      .get();
    expect(message).toBeTruthy();
    expect(message!.fromEmail).toBe("support@example.com");
    expect(message!.toEmail).toBe("customer@test.com");

    // Blob storage has content
    expect(blobStorage.getStore().size).toBeGreaterThanOrEqual(2);

    // Signature appended
    expect(mockProvider.sentEmails[0]!.params.text).toContain("-- Support Team");
  });
});

describe("cross-package: classifier functions work with core types", () => {
  it("determinePriority uses core AiCategory values", () => {
    expect(
      determinePriority(
        "abuse",
        "normal",
        "email",
        DEFAULT_URGENT_KEYWORDS,
        DEFAULT_HIGH_PRIORITY_KEYWORDS,
      ),
    ).toBe("high");
    expect(
      determinePriority(
        "legal",
        "normal",
        "email",
        DEFAULT_URGENT_KEYWORDS,
        DEFAULT_HIGH_PRIORITY_KEYWORDS,
      ),
    ).toBe("high");
    expect(
      determinePriority(
        "support",
        "normal",
        "email",
        DEFAULT_URGENT_KEYWORDS,
        DEFAULT_HIGH_PRIORITY_KEYWORDS,
      ),
    ).toBe("normal");
    expect(
      determinePriority(
        "support",
        "URGENT: system down",
        "",
        DEFAULT_URGENT_KEYWORDS,
        DEFAULT_HIGH_PRIORITY_KEYWORDS,
      ),
    ).toBe("urgent");
  });

  it("extractTags returns tags for email content", () => {
    const tags = extractTags(
      "error with account",
      "I have an error with my account login",
      DEFAULT_TAG_PATTERNS,
    );
    expect(tags).toContain("bug-report");
    expect(tags).toContain("account");
  });
});
