# IMAP Command Reference

All commands supported by `@rafters/mail-imap`. Each command references the RFC section it implements.

---

## Any State (RFC 3501 Section 6.1)

### CAPABILITY

Returns the server's supported extensions.

```
C: a001 CAPABILITY
S: * CAPABILITY IMAP4rev1 IDLE LITERAL+ UIDPLUS NAMESPACE ID
S: a001 OK CAPABILITY completed
```

### NOOP

Keepalive. Returns any pending notifications.

```
C: a001 NOOP
S: a001 OK NOOP completed
```

### LOGOUT

Cleanly disconnects. Server sends BYE before tagged OK.

```
C: a001 LOGOUT
S: * BYE LOGOUT requested
S: a001 OK LOGOUT completed
```

---

## Not Authenticated State (RFC 3501 Section 6.2)

### LOGIN

Authenticate with email address and app-specific password.

```
C: a001 LOGIN user@example.com myapppassword
S: a001 OK LOGIN completed
```

Security:
- Generic "LOGIN failed" on bad credentials (no information leakage)
- 3-attempt rate limit per session
- Disconnect after max attempts

---

## Authenticated State (RFC 3501 Section 6.3)

### SELECT

Open a folder for read-write access.

```
C: a001 SELECT INBOX
S: * 47 EXISTS
S: * 3 RECENT
S: * FLAGS (\Answered \Flagged \Deleted \Seen \Draft)
S: * OK [PERMANENTFLAGS (\Answered \Flagged \Deleted \Seen \Draft \*)]
S: * OK [UIDVALIDITY 1]
S: * OK [UIDNEXT 48]
S: * OK [UNSEEN 12]
S: * OK [READ-WRITE]
S: a001 OK [READ-WRITE] SELECT completed
```

### EXAMINE

Open a folder read-only. Same response as SELECT but with `[READ-ONLY]`.

### LIST

List available folders.

```
C: a001 LIST "" *
S: * LIST (\HasNoChildren \Inbox) "/" INBOX
S: * LIST (\HasNoChildren \Sent) "/" Sent
S: * LIST (\HasNoChildren \Drafts) "/" Drafts
S: * LIST (\HasNoChildren \Trash) "/" Trash
S: a001 OK LIST completed
```

Pattern wildcards: `*` matches everything, `%` matches within one hierarchy level.

### LSUB

List subscribed folders. MVP: same as LIST (all folders subscribed).

### STATUS

Get folder stats without selecting.

```
C: a001 STATUS INBOX (MESSAGES RECENT UNSEEN UIDNEXT UIDVALIDITY)
S: * STATUS INBOX (MESSAGES 47 RECENT 3 UNSEEN 12 UIDNEXT 48 UIDVALIDITY 1)
S: a001 OK STATUS completed
```

### APPEND (RFC 3501 Section 6.3.6 + RFC 4315)

Upload a message to a folder.

```
C: a001 APPEND Sent (\Seen) {310}
S: + Ready for literal data
C: <message content>
S: a001 OK [APPENDUID 1 305] APPEND completed
```

---

## Selected State (RFC 3501 Section 6.4)

### FETCH

Retrieve message data. Supports individual items and macros.

```
C: a001 FETCH 1:* (FLAGS UID ENVELOPE)
S: * 1 FETCH (FLAGS (\Seen) UID 101 ENVELOPE (...))
S: * 2 FETCH (FLAGS () UID 102 ENVELOPE (...))
S: a001 OK FETCH completed
```

Data items: FLAGS, UID, ENVELOPE, RFC822.SIZE, INTERNALDATE, BODYSTRUCTURE, BODY[section].

Macros: ALL, FAST, FULL.

BODY.PEEK[section] fetches without setting \Seen flag.

### STORE

Update message flags.

```
C: a001 STORE 1 +FLAGS (\Seen)
S: * 1 FETCH (FLAGS (\Seen))
S: a001 OK STORE completed
```

Modes: `FLAGS` (replace), `+FLAGS` (add), `-FLAGS` (remove). Add `.SILENT` to suppress response.

### SEARCH

Find messages by criteria.

```
C: a001 SEARCH UNSEEN SINCE 1-Mar-2026
S: * SEARCH 3 7 12
S: a001 OK SEARCH completed
```

Criteria: ALL, ANSWERED, DELETED, DRAFT, FLAGGED, NEW, SEEN, UNSEEN, FROM, TO, CC, BCC, SUBJECT, BEFORE, ON, SINCE, LARGER, SMALLER, TEXT, BODY, UID, NOT, OR.

### EXPUNGE

Permanently remove messages marked \Deleted.

```
C: a001 EXPUNGE
S: * 3 EXPUNGE
S: a001 OK EXPUNGE completed
```

### CLOSE

Close folder and silently expunge deleted messages (no EXPUNGE responses).

### COPY (RFC 3501 Section 6.4.7 + RFC 4315)

Copy messages to another folder.

```
C: a001 COPY 1:3 Sent
S: a001 OK [COPYUID 1 10,20,30 200,201,202] COPY completed
```

### MOVE (RFC 6851)

Atomically move messages to another folder.

```
C: a001 MOVE 1 Archive
S: * 1 EXPUNGE
S: a001 OK [COPYUID 1 10 300] MOVE completed
```

### UNSELECT (RFC 3691)

Close folder without expunging.

---

## Extensions

### IDLE (RFC 2177)

Wait for server push notifications.

```
C: a001 IDLE
S: + idling
... (time passes, new mail arrives)
S: * 48 EXISTS
C: DONE
S: a001 OK IDLE completed
```

### UID prefix

Any of FETCH, STORE, SEARCH, COPY, MOVE can be prefixed with UID to operate on UIDs instead of sequence numbers.

```
C: a001 UID FETCH 101 FLAGS
S: * 1 FETCH (FLAGS (\Seen) UID 101)
S: a001 OK FETCH completed
```

---

## Flag Mapping

| IMAP Flag | @rafters/mail Field | Notes |
|---|---|---|
| \Seen | isRead | Settable |
| \Flagged | isStarred | Settable |
| \Deleted | deletedAt (soft delete) | Settable |
| \Answered | thread has outbound reply | Derived, read-only |
| \Draft | folder slug = "drafts" | Derived, read-only |
| Custom keywords | labels (inboxMessageLabel) | Settable |
