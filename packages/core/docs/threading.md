# Threading

How @rafters/mail builds and maintains email threads.

---

## How threads work

Every email carries headers that identify its place in a conversation:

- **Message-ID**: a globally unique identifier assigned when the email is sent
- **In-Reply-To**: the Message-ID of the email being replied to
- **References**: the full chain of Message-IDs in the conversation, oldest to newest

When a new message arrives, the threading engine uses these headers to find or create a thread:

1. Check `In-Reply-To` -- if it matches an existing message, join that thread
2. Check `References` -- walk the chain looking for any known message
3. Fall back to subject matching within the same mailbox (configurable)
4. If no match, create a new thread

---

## Thread model

A thread is a container for related messages:

| Field | Purpose |
|---|---|
| subject | The conversation subject |
| snippet | Preview of the most recent message |
| participants | All email addresses involved |
| messageCount | Total messages in the thread |
| unreadCount | Messages not yet marked as read |
| status | open, pending, resolved, closed |
| priority | low, normal, high, urgent |
| folderId | Current folder (nullable) |
| lastMessageAt | Timestamp of the most recent message |

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

Messages are assigned to threads at ingest time. The assignment is permanent -- a message belongs to one thread for its lifetime. If the threading engine cannot find a match, it creates a new single-message thread.

Moving a thread between folders moves all its messages. Deleting a thread soft-deletes all its messages.

---

## Cross-mailbox threading

Threads are scoped to a mailbox. A conversation between `support@yourdomain.com` and a customer lives in the support mailbox's thread. The same customer emailing `sales@yourdomain.com` starts a separate thread in the sales mailbox.

This is intentional: different mailboxes serve different purposes. Cross-mailbox thread merging is not supported because it would break folder isolation and access control.
