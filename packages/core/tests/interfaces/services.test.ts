import { describe, expect, it } from "vitest";
import {
  composeEmailParamsSchema,
  replyToThreadParamsSchema,
} from "../../src/interfaces/services.js";

describe("replyToThreadParamsSchema", () => {
  it("accepts valid reply params", () => {
    const result = replyToThreadParamsSchema.parse({
      threadId: "thread-1",
      mailboxId: "mbox-1",
      senderId: "user-1",
      body: "Thanks for reaching out.",
    });
    expect(result.threadId).toBe("thread-1");
  });

  it("rejects empty body", () => {
    expect(() =>
      replyToThreadParamsSchema.parse({
        threadId: "thread-1",
        mailboxId: "mbox-1",
        senderId: "user-1",
        body: "",
      }),
    ).toThrow();
  });

  it("accepts optional cc and bcc", () => {
    const result = replyToThreadParamsSchema.parse({
      threadId: "thread-1",
      mailboxId: "mbox-1",
      senderId: "user-1",
      body: "Reply",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
    expect(result.cc).toEqual(["cc@example.com"]);
  });

  it("rejects invalid cc email", () => {
    expect(() =>
      replyToThreadParamsSchema.parse({
        threadId: "thread-1",
        mailboxId: "mbox-1",
        senderId: "user-1",
        body: "Reply",
        cc: ["not-email"],
      }),
    ).toThrow();
  });
});

describe("composeEmailParamsSchema", () => {
  it("accepts valid compose params", () => {
    const result = composeEmailParamsSchema.parse({
      mailboxId: "mbox-1",
      senderId: "user-1",
      to: ["recipient@example.com"],
      subject: "Hello",
      body: "World",
    });
    expect(result.to).toEqual(["recipient@example.com"]);
  });

  it("rejects empty recipients", () => {
    expect(() =>
      composeEmailParamsSchema.parse({
        mailboxId: "mbox-1",
        senderId: "user-1",
        to: [],
        subject: "Hello",
        body: "World",
      }),
    ).toThrow();
  });

  it("rejects missing subject", () => {
    expect(() =>
      composeEmailParamsSchema.parse({
        mailboxId: "mbox-1",
        senderId: "user-1",
        to: ["a@b.com"],
        subject: "",
        body: "World",
      }),
    ).toThrow();
  });
});
