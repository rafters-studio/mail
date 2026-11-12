# Generated from legion requirement FR-MAIL-034, revision 2026-11-02T20:14:58.557507+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: One mailbox object assigns UIDs and never loses a delivery

  @criterion-FR-MAIL-034-c1
  Scenario: UIDs rise and are never reused
    Given messages pulled, one expunged, and more pulled
    When the rows are read
    Then every UID is greater than the last and the expunged UID does not come back

  @criterion-FR-MAIL-034-c2
  Scenario: A delivery committing behind the newest id is still pulled
    Given a delivery with a later id pulled first, then one with an earlier id committed
    When pull runs
    Then both are in the mailbox

  @criterion-FR-MAIL-034-c3
  Scenario: A delivery just ahead of the cursor is pulled
    Given the cursor, and a delivery 5 seconds after it sharing its first eight hex digits
    When pull runs
    Then it is in the mailbox, and the cursor is dashed and has not fallen

  @criterion-FR-MAIL-034-c4
  Scenario: A repeated Message-ID adds no message and leaves a record
    Given a held Message-ID and an expunged one, delivered again
    When pull runs
    Then no UID is added and each has a skipped row as held-message-id

  @criterion-FR-MAIL-034-c5
  Scenario: A message with no Message-ID is always added, and an oversized one counts as none
    Given two deliveries with no Message-ID, and two with one over 998 octets
    When pull runs
    Then all four are added

  @criterion-FR-MAIL-034-c6
  Scenario: A blob that is gone stops nothing
    Given a delivery whose blob is gone, and one after it
    When pull runs
    Then the first has a skipped row as no-blob and the second is added

  @criterion-FR-MAIL-034-c7
  Scenario: A row that fails stops nothing
    Given a row that makes the insert throw, and one after it
    When pull runs
    Then the first has a skipped row as unreadable and the second is added

  @criterion-FR-MAIL-034-c8
  Scenario: Overlapping pulls add each row once and miss nothing
    Given two pulls at once with no Message-ID, and a ping during a pull
    When they finish
    Then each row is added once and the ping's row is there

  @criterion-FR-MAIL-034-c9
  Scenario: Nothing waits for a tell
    Given sessions with a real serial queue over createImapSession, one mid-receive and one in IDLE
    When open, ping and setFlags run
    Then each returns while a tell is outstanding, and no cycle hangs

  @criterion-FR-MAIL-034-c10
  Scenario: A pull that adds a row tells everyone, from any caller
    Given a session in IDLE, and another session's open that pulls a new row
    When the tell finishes
    Then the idler is told

  @criterion-FR-MAIL-034-c11
  Scenario: A flag change and an expunge tell, and an empty expunge does not
    Given two sessions
    When setFlags, expunge and expunge of an empty list run
    Then the first two tell and the last tells nobody

  @criterion-FR-MAIL-034-c12
  Scenario: Telling tolerates a bad session
    Given one session answering false, one rejecting, one never settling, one healthy
    When a tell runs
    Then the first is forgotten, the second kept with a logged line, the third bounded by 10 seconds as a rejection, and the fourth told

  @criterion-FR-MAIL-034-c13
  Scenario: A commit with no tell is told by the next alarm
    Given a commit whose tell never ran
    When the alarm fires
    Then every session is told and tell-owed is cleared

  @criterion-FR-MAIL-034-c14
  Scenario: A pull that throws leaves an alarm set
    Given a registered session and a pull that throws
    When the alarm fires
    Then another alarm is set and the error is logged

  @criterion-FR-MAIL-034-c15
  Scenario: The alarm finds a delivery no ping announced
    Given a delivery with no ping
    When the alarm fires
    Then it is pulled and sessions are told

  @criterion-FR-MAIL-034-c16
  Scenario: An expunged message stays readable and out of open
    Given an expunged message
    When held, bytes and open run
    Then held and bytes give it, and open does not

  @criterion-FR-MAIL-034-c17
  Scenario: held takes more than 100 messages
    Given 101 messages, and a SQLite wrapper refusing more than 100 parameters and rows over 2 MB
    When held runs
    Then it returns all 101 in the order named

  @criterion-FR-MAIL-034-c18
  Scenario: Only INBOX exists
    Given any other mailbox name
    When open and mailboxes run
    Then open gives null and mailboxes gives INBOX

  @criterion-FR-MAIL-034-c19
  Scenario: A fresh object has a greater uid_validity
    Given an object created, and a fresh one later on the same mailbox
    When open runs on each
    Then the later value is greater, and it never changes within an object
