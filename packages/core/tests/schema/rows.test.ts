import { describe, it, expectTypeOf } from "vitest";
import type { InferSelectModel } from "drizzle-orm";
import type { z } from "zod";
import {
  mailboxRowSchema,
  inboxFolderRowSchema,
  inboxLabelRowSchema,
  inboxThreadRowSchema,
  inboxMessageRowSchema,
  inboxMessageLabelRowSchema,
  inboxThreadLabelRowSchema,
  inboxAttachmentRowSchema,
  threadAssignmentRowSchema,
  threadNoteRowSchema,
} from "../../src/schema/rows.ts";
import {
  platformAudienceRowSchema,
  platformSubscriberRowSchema,
  broadcastAuditRowSchema,
} from "../../src/schema/rows.ts";
import {
  mailbox,
  inboxFolder,
  inboxLabel,
  inboxThread,
  inboxMessage,
  inboxMessageLabel,
  inboxThreadLabel,
  inboxAttachment,
  threadAssignment,
  threadNote,
} from "../../src/schema/tables.ts";
import {
  platformAudience,
  platformSubscriber,
  broadcastAudit,
} from "../../src/schema/newsletter.ts";

// Phase-0 parity: Zod row schemas must match Drizzle InferSelectModel exactly.
// This file is deleted in Phase 2 when Drizzle leaves core (see issue #88).

describe("Zod row schemas match Drizzle InferSelectModel", () => {
  it("mailbox", () => {
    expectTypeOf<z.infer<typeof mailboxRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof mailbox>
    >();
  });

  it("inbox_folder", () => {
    expectTypeOf<z.infer<typeof inboxFolderRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxFolder>
    >();
  });

  it("inbox_label", () => {
    expectTypeOf<z.infer<typeof inboxLabelRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxLabel>
    >();
  });

  it("inbox_thread", () => {
    expectTypeOf<z.infer<typeof inboxThreadRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxThread>
    >();
  });

  it("inbox_message", () => {
    expectTypeOf<z.infer<typeof inboxMessageRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxMessage>
    >();
  });

  it("inbox_message_label", () => {
    expectTypeOf<z.infer<typeof inboxMessageLabelRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxMessageLabel>
    >();
  });

  it("inbox_thread_label", () => {
    expectTypeOf<z.infer<typeof inboxThreadLabelRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxThreadLabel>
    >();
  });

  it("inbox_attachment", () => {
    expectTypeOf<z.infer<typeof inboxAttachmentRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof inboxAttachment>
    >();
  });

  it("thread_assignment", () => {
    expectTypeOf<z.infer<typeof threadAssignmentRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof threadAssignment>
    >();
  });

  it("thread_note", () => {
    expectTypeOf<z.infer<typeof threadNoteRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof threadNote>
    >();
  });

  it("platform_audience", () => {
    expectTypeOf<z.infer<typeof platformAudienceRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof platformAudience>
    >();
  });

  it("platform_subscriber", () => {
    expectTypeOf<z.infer<typeof platformSubscriberRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof platformSubscriber>
    >();
  });

  it("broadcast_audit", () => {
    expectTypeOf<z.infer<typeof broadcastAuditRowSchema>>().toEqualTypeOf<
      InferSelectModel<typeof broadcastAudit>
    >();
  });
});
