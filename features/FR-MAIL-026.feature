# Generated from legion requirement FR-MAIL-026, revision 2026-11-06T01:13:01.344930+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Each recipient is recorded unknown first, and a saved message is never sent twice on a guess

  @criterion-FR-MAIL-026-c1
  Scenario: Every recipient is claimed before the transport runs
    Given a transport that reads the rows when called
    When send runs
    Then it sees every recipient as unknown

  @criterion-FR-MAIL-026-c2
  Scenario: A transport that throws leaves the rows unknown, and send throws
    Given a transport that throws
    When send runs
    Then send throws, and every row remains unknown

  @criterion-FR-MAIL-026-c3
  Scenario: A recipient already answered is held
    Given rows accepted, unknown and finally refused
    When the same Written is sent again
    Then the transport is not called, outcomes is empty, and held lists them in envelope order

  @criterion-FR-MAIL-026-c4
  Scenario: Only recipients with no row or a row not final are sent to
    Given one recipient refused not final, one accepted, and one new
    When the same Written is sent again
    Then the transport's envelope holds exactly the first and third, in order, and the second is held

  @criterion-FR-MAIL-026-c5
  Scenario: A credential failure does not stop another provider sending
    Given a 535 at AUTH through one transport
    When the same Written is sent through another transport
    Then the recipient is reached

  @criterion-FR-MAIL-026-c6
  Scenario: A 251 at the terminator is not sent again
    Given a 251 at the terminator
    When the same Written is sent again
    Then the recipient is held

  @criterion-FR-MAIL-026-c7
  Scenario: Smuggling input throws, writing no row
    Given bytes with a byte of 0x80, with a bare CR, with a bare LF, and with no final CRLF, and an address with a control character, a space, a less-than and a greater-than
    When send runs
    Then each throws a TypeError, and no claim was made

  @criterion-FR-MAIL-026-c8
  Scenario: Everything the writer makes passes the checks
    Given every writer golden, and a real message with Bcc and a leading period
    When send runs
    Then none throws
