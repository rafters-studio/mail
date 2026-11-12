# Generated from legion requirement FR-MAIL-023, revision 2026-11-06T01:13:00.991099+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: An IMAP session serves each message's own structure and octets

  @criterion-FR-MAIL-023-c1
  Scenario: FLAGS, RFC822.SIZE, INTERNALDATE, ENVELOPE and BODYSTRUCTURE, and the macros, answer for every message
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A28 to A30
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-023-c2
  Scenario: Sections HEADER, TEXT, MIME, part numbers, a message's parts and HEADER.FIELDS are those octets
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A31 to A33 and A38
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-023-c3
  Scenario: UID FETCH puts UID first, and RFC822, RFC822.HEADER and RFC822.TEXT answer
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A34, A36 and A37
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-023-c4
  Scenario: A partial returns its octets and echoes its origin, and a zero count is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A35 and A40
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-023-c5
  Scenario: An unknown item is BAD
    Given the transcript golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps A39
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte

  @criterion-FR-MAIL-023-c6
  Scenario: Groups, Sender, Reply-To, a language list and a type with no subtype appear as RFC 3501 7.4.2 says
    Given the headers golden (goldens.01a19b9a-3c63-7402-acb0-92574ca88808 body.goldens), steps all
    When createImapSession is driven with each client step, whole and one byte at a time
    Then every server response equals the golden, byte for byte
