# Generated from legion requirement FR-MAIL-022, revision 2026-11-06T01:13:00.876339+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: An IMAP session lists, opens and watches mailboxes, reporting changes only where IMAP allows

  @criterion-FR-MAIL-022-c1
  Scenario: LIST and LSUB match patterns as RFC 3501 does
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A8 to A12
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c2
  Scenario: STATUS answers MESSAGES, UIDNEXT, UIDVALIDITY and UNSEEN, and refuses other items
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A13 to A15, A69 and A83
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c3
  Scenario: SELECT and EXAMINE answer in the stated order, and a failed SELECT leaves the session authenticated
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A20, A21, A27 and A80
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c4
  Scenario: A read-only mailbox refuses STORE, EXPUNGE and UID EXPUNGE
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A22 to A25
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c5
  Scenario: CLOSE expunges silently, UNSELECT does not
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A26, A79, A81 and A82
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c6
  Scenario: Another client's changes are reported at NOOP, CHECK and UID commands, and not during FETCH by sequence number
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps the change flag-2, A65, A70, the change expunge-6, A71 and A72
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-022-c7
  Scenario: A mailbox that disappears reports each message expunged
    Given the vanish golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte
