# Generated from legion requirement FR-MAIL-024, revision 2026-11-06T01:13:01.114168+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: An IMAP session stores flags both ways, searches, expunges and idles

  @criterion-FR-MAIL-024-c1
  Scenario: FLAGS, +FLAGS and -FLAGS, with and without .SILENT, leave exactly the stated set
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A41 to A47
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-024-c2
  Scenario: An unknown system flag is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A48
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-024-c3
  Scenario: SEARCH answers every supported key, and an unknown key is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A49 to A64
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-024-c4
  Scenario: EXPUNGE and UID EXPUNGE remove only deleted messages and report each
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A66 to A68
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-024-c5
  Scenario: IDLE reports a change at once and ends at DONE; any other line ends it with BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A73, the change idle, DONE, A74 and A75
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte
