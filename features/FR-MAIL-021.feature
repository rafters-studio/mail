# Generated from legion requirement FR-MAIL-021, revision 2026-11-06T01:13:00.764706+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: An IMAP session frames commands from bytes, keeps to its states and survives bad input

  @criterion-FR-MAIL-021-c1
  Scenario: The greeting and CAPABILITY name exactly IMAP4rev1 LITERAL+ IDLE UIDPLUS UNSELECT
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps greeting and A1
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c2
  Scenario: A command outside its state is BAD with its tag
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A3 and A19
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c3
  Scenario: A failed login is NO, and a login sent as synchronising literals gets a continuation for each
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A4 to A6
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c4
  Scenario: LOGIN once authenticated is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A7
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c5
  Scenario: A non-synchronising literal gets no continuation, and a synchronising one over 1 MiB is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A16 to A18
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c6
  Scenario: The third failed login ends the session
    Given the lockout golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c7
  Scenario: A non-synchronising literal over 1 MiB, or a line over 64 KiB, ends the session
    Given the toobig golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all and the longline golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c8
  Scenario: Each malformed command is answered with its reason, and the next command is read
    Given the malformed golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps E1 to E35
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c9
  Scenario: An unknown command or UID command, and an unterminated string, are BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A76 to A78
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c10
  Scenario: LOGOUT says BYE and the session reads nothing more
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A86 and A87
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c11
  Scenario: Every step of every golden transcript matches
    Given the seven goldens of goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens, every entry
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-021-c12
  Scenario: A line in IDLE that never ends is cut off as any long line is
    Given the idlelong golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), all steps
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte, the last "* BYE line too long", and the session is closed

  @criterion-FR-MAIL-021-c13
  Scenario: A store call that rejects rejects that session call and every later one
    Given a session over the test store whose open() rejects, logged in
    When SELECT INBOX is sent, then NOOP
    Then both receive calls reject with the store's error
