# Generated from legion requirement FR-MAIL-033, revision 2026-11-06T01:13:02.191474+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A session saves what it told its client, and resuming cannot be told apart

  @criterion-FR-MAIL-033-c1
  Scenario: Resuming after every step of every golden gives the same bytes
    Given all eight IMAP goldens
    When each is driven whole and one byte at a time, the session discarded and resumed from its snapshot after every step, not inside a command while not authenticated
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-033-c2
  Scenario: A resumed session names the same message after another client expunges
    Given a session that saw UID 1 as message 1, and a store that then expunged UID 1
    When the session resumes and FETCH 1 (UID) is sent, then changed() and NOOP
    Then FETCH says UID 1, and NOOP tells * 1 EXPUNGE

  @criterion-FR-MAIL-033-c3
  Scenario: A session in IDLE resumes and tells new mail
    Given a session idling, and a store with a new message
    When it resumes and changed() is called
    Then it tells the new message, with no second + idling

  @criterion-FR-MAIL-033-c4
  Scenario: Resuming sends the client nothing
    Given a snapshot in each phase
    When a session resumes
    Then no bytes are produced until the next call

  @criterion-FR-MAIL-033-c5
  Scenario: A flag the client was told comes from the snapshot, not the store
    Given a snapshot with a flag the store has since changed
    When the session resumes, changed() and NOOP
    Then the difference is told as a FETCH FLAGS

  @criterion-FR-MAIL-033-c6
  Scenario: No password reaches a snapshot
    Given a login split at every byte, plain and as literals, and a fatal over-long line
    When the snapshot is read after every byte
    Then none holds any part of the password, and while not authenticated buffer is empty and granted is 0

  @criterion-FR-MAIL-033-c7
  Scenario: A logged-out snapshot holds no buffer
    Given a session that logged out, and one closed by a fatal line
    When the snapshot is read
    Then it is logged-out with an empty buffer

  @criterion-FR-MAIL-033-c8
  Scenario: A snapshot is small for a mailbox's shape
    Given 100,000 contiguous UIDs with no flags, and 100,000 with alternating \Seen
    When the snapshot is serialised
    Then the first is under 1 KiB and the second under 1 MiB

  @criterion-FR-MAIL-033-c9
  Scenario: ranges and unranges round trip
    Given sorted UID lists, empty, single, contiguous and scattered
    When ranges then unranges runs
    Then the list comes back

  @criterion-FR-MAIL-033-c10
  Scenario: A bad snapshot throws
    Given a snapshot of the wrong version, and a selected phase with a tag
    When createImapSession is given it
    Then it throws a ZodError

  @criterion-FR-MAIL-033-c11
  Scenario: A held of the wrong count rejects
    Given a store whose held returns fewer messages than named
    When the session resumes and a command is sent
    Then the call rejects, as a store failure does

  @criterion-FR-MAIL-033-c12
  Scenario: snapshot is defined at any moment
    Given a call queued but not finished, and a session just resumed
    When snapshot is read
    Then it gives the state as of the last finished call, or the parsed resume

  @criterion-FR-MAIL-033-c13
  Scenario: A buffer past the bound gets the BYE, and whole commands do not
    Given a frame of 200,000 pipelined NOOPs, and a command of many literals past MAX_LITERAL plus MAX_LINE
    When receive runs
    Then the first is answered in full, and the second gets * BYE command too long and closes with an empty buffer
