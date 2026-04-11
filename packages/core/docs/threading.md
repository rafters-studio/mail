# Threading

How `@rafters/mail` builds and maintains email threads.

---

## RFC 5322 headers

Every email carries three headers that identify its place in a conversation:

- **`Message-ID`**: a globally unique identifier assigned when the email is sent
- **`In-Reply-To`**: the `Message-ID` of the email being replied to
- **`References`**: the full chain of `Message-ID` values in the conversation, oldest to newest

`@rafters/mail` ships three building blocks for working with these headers from the `@rafters/mail/threading` subpath export:

```typescript
import { generateMessageId, buildReferences, generateSnippet } from "@rafters/mail/threading";

const id = generateMessageId("yourdomain.com");
// -> "<019d7d...@yourdomain.com>"

const refs = buildReferences("<A> <B>", "<B>");
// -> "<A> <B>"  (already present, not re-appended)

const snippet = generateSnippet("Hello world\n\nLong body text...", 200);
// -> "Hello world  Long body text..." (first 200 chars)
```

`buildReferences` caps the chain at 50 entries to prevent unbounded growth; the most recent 50 are kept and the oldest are dropped. This matches the RFC 5322 recommendation for trimming long reference chains.

---

## Thread matching is the inbound adapter's job

The `@rafters/mail/threading` module does not match messages to threads. Matching is the responsibility of the code that ingests inbound email -- typically an implementation of `InboundAdapter` -- because it requires database queries that the threading module cannot do on its own.

The expected matching strategy, in priority order:

1. **`In-Reply-To`** -- if the incoming header matches a `messageIdHeader` on an existing `inbox_message` row, join that message's thread.
2. **`References`** -- walk the chain; any hit on an existing `messageIdHeader` joins that thread.
3. **Fresh thread** -- if no header match, create a new thread.

Subject-based matching is intentionally NOT part of this flow. Subject lines collide across unrelated conversations; header-based matching is the only reliable path.

The shipped `InboxEmailService.composeEmail` always creates a fresh thread. Replies go through `replyToThread`, which takes an explicit `threadId` -- the caller is expected to know the target thread. Inbound matching logic is not yet shipped in a runtime adapter.

---

## Thread model

A thread is a container for related messages in `inbox_thread`:

| Field           | Type                       | Purpose                                 |
| --------------- | -------------------------- | --------------------------------------- |
| `subject`       | text (NOT NULL)            | The conversation subject                |
| `snippet`       | text (nullable)            | Preview of the most recent message      |
| `participants`  | json string[] (nullable)   | All email addresses involved            |
| `messageCount`  | integer (default 1)        | Total messages in the thread            |
| `unreadCount`   | integer (default 1)        | Messages not yet marked as read         |
| `status`        | text (default "open")      | `open`, `pending`, `resolved`, `closed` |
| `priority`      | text (default "normal")    | `low`, `normal`, `high`, `urgent`       |
| `folderId`      | text (nullable)            | Current folder. `ON DELETE SET NULL`.   |
| `startedAt`     | timestamp (NOT NULL)       | When the thread was created             |
| `lastMessageAt` | timestamp (NOT NULL)       | Timestamp of the most recent message    |
| `updatedAt`     | timestamp (NOT NULL, auto) | Last time any thread field changed      |
| `archivedAt`    | timestamp (nullable)       | When archived, if applicable            |
| `deletedAt`     | timestamp (nullable)       | Soft-delete marker                      |

Threads track their own read state via `unreadCount` rather than a single boolean. A thread with 10 messages where 3 are unread shows `unreadCount: 3`.

---

## Building references

When composing a reply, the system builds the References header by appending the In-Reply-To to the existing chain:

```
Original:     Message-ID: <A>
First reply:  In-Reply-To: <A>, References: <A>
Second reply: In-Reply-To: <B>, References: <A> <B>
Third reply:  In-Reply-To: <C>, References: <A> <B> <C>
```

The chain is capped at 50 entries to prevent unbounded growth. When the cap is reached, the oldest references are dropped but the most recent are kept.

---

## Message-ID generation

Outbound messages use UUIDv7 for Message-ID generation:

```
<019d5a9d-b939-77a3-8b8c-4e170fc35b76@yourdomain.com>
```

UUIDv7 is timestamp-ordered, which means Message-IDs naturally sort by creation time. This property is used by the IMAP UID mapping to derive UIDs from message ordering.

---

## Thread assignment

Messages are assigned to threads at ingest time. The assignment is permanent -- a message belongs to one thread for its lifetime. If the inbound adapter cannot find a match via `In-Reply-To` / `References`, it creates a new single-message thread.

Moving a thread between folders is a logical operation that updates `inbox_thread.folderId`; messages stay in place.

**On deletion:** `inbox_message.threadId` has `ON DELETE CASCADE`, so **hard-deleting** a thread row also hard-deletes all its messages. **Soft-deleting** a thread (setting `deletedAt`) does NOT cascade to messages -- soft deletes are manual per-row. If you want to hide a thread and all its messages together, either hard-delete (irreversible) or soft-delete the thread AND each message explicitly.

---

## Cross-mailbox threading

Threads are scoped to a mailbox. A conversation between `support@yourdomain.com` and a customer lives in the support mailbox's thread. The same customer emailing `sales@yourdomain.com` starts a separate thread in the sales mailbox.

This is intentional: different mailboxes serve different purposes. Cross-mailbox thread merging is not supported because it would break folder isolation and access control.
