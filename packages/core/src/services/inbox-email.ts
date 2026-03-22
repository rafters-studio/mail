import { and, desc, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import type { BlobStorage } from "../interfaces/blob-storage.js";
import type { EmailProvider } from "../interfaces/email-provider.js";
import type {
  InboxEmailService,
  ComposeEmailParams,
  ReplyToThreadParams,
} from "../interfaces/services.js";
import { inboxFolder, inboxMessage, inboxThread, mailbox } from "../schema/tables.js";
import { generateMessageId, buildReferences, generateSnippet } from "../threading.js";

type DB = BaseSQLiteDatabase<"async", unknown>;

export interface InboxEmailServiceConfig {
  db: DB;
  blobStorage: BlobStorage;
  emailProvider: EmailProvider;
  domain: string;
}

function generateRawEmail(params: {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: Date;
  body: string;
  bodyHtml?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): string {
  const lines: string[] = [];
  lines.push(`Message-ID: ${params.messageId}`);
  lines.push(`From: ${params.from}`);
  lines.push(`To: ${params.to}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push(`Date: ${params.date.toUTCString()}`);
  lines.push("MIME-Version: 1.0");
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    lines.push(`References: ${params.references}`);
  }
  if (params.bodyHtml) {
    lines.push('Content-Type: multipart/alternative; boundary="----=_Part_0"');
    lines.push("");
    lines.push("------=_Part_0");
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(params.body);
    lines.push("");
    lines.push("------=_Part_0");
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("");
    lines.push(params.bodyHtml);
    lines.push("");
    lines.push("------=_Part_0--");
  } else {
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(params.body);
  }
  return lines.join("\r\n");
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createInboxEmailService(config: InboxEmailServiceConfig): InboxEmailService {
  const { db, blobStorage, emailProvider, domain } = config;

  return {
    async replyToThread(params: ReplyToThreadParams): Promise<{ messageId: string }> {
      const { threadId, mailboxId, body, bodyHtml, cc, bcc } = params;

      const thread = await db
        .select()
        .from(inboxThread)
        .where(and(eq(inboxThread.id, threadId), isNull(inboxThread.deletedAt)))
        .get();

      if (!thread) throw new Error("Thread not found");
      if (thread.mailboxId !== mailboxId) throw new Error("Thread does not belong to this mailbox");

      const mb = await db
        .select()
        .from(mailbox)
        .where(and(eq(mailbox.id, mailboxId), isNull(mailbox.deletedAt)))
        .get();

      if (!mb) throw new Error("Mailbox not found");

      const latestMessage = await db
        .select({
          messageId: inboxMessage.messageId,
          references: inboxMessage.references,
          fromEmail: inboxMessage.fromEmail,
          toEmail: inboxMessage.toEmail,
        })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.threadId, threadId), isNull(inboxMessage.deletedAt)))
        .orderBy(desc(inboxMessage.receivedAt))
        .limit(1)
        .get();

      if (!latestMessage) throw new Error("No messages found in thread");

      const recipientEmail =
        latestMessage.fromEmail === mb.emailAddress
          ? latestMessage.toEmail
          : latestMessage.fromEmail;

      const newMessageId = generateMessageId(domain);
      const inReplyTo = latestMessage.messageId;
      const references = buildReferences(latestMessage.references, inReplyTo);

      const replySubject = thread.subject.startsWith("Re:")
        ? thread.subject
        : `Re: ${thread.subject}`;

      const finalBody = mb.signature ? `${body}\n\n--\n${mb.signature}` : body;
      const finalBodyHtml: string | null = mb.signature
        ? `${bodyHtml ?? `<p>${body}</p>`}<br><br>--<br>${mb.signature}`
        : (bodyHtml ?? null);

      await emailProvider.sendEmail({
        to: recipientEmail,
        subject: replySubject,
        text: finalBody,
        ...(finalBodyHtml ? { html: finalBodyHtml } : {}),
        from: mb.emailAddress,
        replyTo: mb.emailAddress,
      });

      const now = new Date();
      const rawEmail = generateRawEmail({
        messageId: newMessageId,
        from: mb.displayName ? `${mb.displayName} <${mb.emailAddress}>` : mb.emailAddress,
        to: recipientEmail,
        subject: replySubject,
        date: now,
        body: finalBody,
        ...(finalBodyHtml ? { bodyHtml: finalBodyHtml } : {}),
        inReplyTo,
        references: references ?? undefined,
      });

      const contentHash = await hashContent(rawEmail);
      const blobKeyRaw = blobStorage.generateKey(contentHash, "eml");
      const blobKeyText = blobStorage.generateKey(contentHash, "txt");
      const blobKeyHtml = bodyHtml ? blobStorage.generateKey(contentHash, "html") : null;

      await blobStorage.put(blobKeyRaw, rawEmail, {
        httpMetadata: { contentType: "message/rfc822" },
      });
      await blobStorage.put(blobKeyText, finalBody, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
      });
      if (bodyHtml && blobKeyHtml) {
        await blobStorage.put(blobKeyHtml, finalBodyHtml ?? bodyHtml, {
          httpMetadata: { contentType: "text/html; charset=utf-8" },
        });
      }

      const messageDbId = uuidv7();

      await db.insert(inboxMessage).values({
        id: messageDbId,
        mailboxId,
        threadId,
        messageId: newMessageId,
        fromEmail: mb.emailAddress,
        fromName: mb.displayName ?? null,
        toEmail: recipientEmail,
        toName: null,
        ccEmails: cc ?? null,
        bccEmails: bcc ?? null,
        subject: replySubject,
        snippet: generateSnippet(body),
        inReplyTo,
        references,
        isOutbound: true,
        isRead: true,
        isStarred: false,
        isSpam: false,
        attachmentCount: 0,
        sizeBytes: new TextEncoder().encode(rawEmail).length,
        blobKeyRaw,
        blobKeyText,
        blobKeyHtml,
        sentAt: now,
        receivedAt: now,
      });

      const newStatus = thread.status === "open" ? "pending" : thread.status;

      await db
        .update(inboxThread)
        .set({
          messageCount: thread.messageCount + 1,
          lastMessageAt: now,
          snippet: generateSnippet(body),
          status: newStatus,
        })
        .where(eq(inboxThread.id, threadId));

      return { messageId: messageDbId };
    },

    async composeEmail(
      params: ComposeEmailParams,
    ): Promise<{ threadId: string; messageId: string }> {
      const { mailboxId, to, subject, body, bodyHtml, cc, bcc } = params;

      const mb = await db
        .select()
        .from(mailbox)
        .where(and(eq(mailbox.id, mailboxId), isNull(mailbox.deletedAt)))
        .get();

      if (!mb) throw new Error("Mailbox not found");

      const sentFolder = await db
        .select({ id: inboxFolder.id })
        .from(inboxFolder)
        .where(
          and(
            eq(inboxFolder.mailboxId, mailboxId),
            eq(inboxFolder.slug, "sent"),
            isNull(inboxFolder.deletedAt),
          ),
        )
        .get();

      const newMessageId = generateMessageId(domain);
      const primaryRecipient = to[0]!; // Validated by Zod .min(1)

      const finalBody = mb.signature ? `${body}\n\n--\n${mb.signature}` : body;
      const finalBodyHtml: string | null = mb.signature
        ? `${bodyHtml ?? `<p>${body}</p>`}<br><br>--<br>${mb.signature}`
        : (bodyHtml ?? null);

      await emailProvider.sendEmail({
        to: primaryRecipient,
        subject,
        text: finalBody,
        ...(finalBodyHtml ? { html: finalBodyHtml } : {}),
        from: mb.emailAddress,
        replyTo: mb.emailAddress,
      });

      const now = new Date();
      const rawEmail = generateRawEmail({
        messageId: newMessageId,
        from: mb.displayName ? `${mb.displayName} <${mb.emailAddress}>` : mb.emailAddress,
        to: primaryRecipient,
        subject,
        date: now,
        body: finalBody,
        ...(finalBodyHtml ? { bodyHtml: finalBodyHtml } : {}),
      });

      const contentHash = await hashContent(rawEmail);
      const blobKeyRaw = blobStorage.generateKey(contentHash, "eml");
      const blobKeyText = blobStorage.generateKey(contentHash, "txt");
      const blobKeyHtml = bodyHtml ? blobStorage.generateKey(contentHash, "html") : null;

      await blobStorage.put(blobKeyRaw, rawEmail, {
        httpMetadata: { contentType: "message/rfc822" },
      });
      await blobStorage.put(blobKeyText, finalBody, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
      });
      if (bodyHtml && blobKeyHtml) {
        await blobStorage.put(blobKeyHtml, finalBodyHtml ?? bodyHtml, {
          httpMetadata: { contentType: "text/html; charset=utf-8" },
        });
      }

      const threadId = uuidv7();

      await db.insert(inboxThread).values({
        id: threadId,
        mailboxId,
        folderId: sentFolder?.id ?? null,
        subject,
        snippet: generateSnippet(body),
        participants: to,
        messageCount: 1,
        unreadCount: 0,
        status: "closed",
        priority: "normal",
        startedAt: now,
        lastMessageAt: now,
      });

      const messageDbId = uuidv7();

      await db.insert(inboxMessage).values({
        id: messageDbId,
        mailboxId,
        threadId,
        messageId: newMessageId,
        fromEmail: mb.emailAddress,
        fromName: mb.displayName ?? null,
        toEmail: primaryRecipient,
        toName: null,
        ccEmails: cc ?? null,
        bccEmails: bcc ?? null,
        subject,
        snippet: generateSnippet(body),
        inReplyTo: null,
        references: null,
        isOutbound: true,
        isRead: true,
        isStarred: false,
        isSpam: false,
        attachmentCount: 0,
        sizeBytes: new TextEncoder().encode(rawEmail).length,
        blobKeyRaw,
        blobKeyText,
        blobKeyHtml,
        sentAt: now,
        receivedAt: now,
      });

      return { threadId, messageId: messageDbId };
    },
  };
}
