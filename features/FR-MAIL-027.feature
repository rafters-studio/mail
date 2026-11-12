# Generated from legion requirement FR-MAIL-027, revision 2026-11-06T01:13:01.488028+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A byte stream becomes lines, under one timeout

  @criterion-FR-MAIL-027-c1
  Scenario: Every row of the session table gives the same result whole and one byte at a time
    Given the session goldens over in-memory streams
    When each is driven through streamConnection whole and one byte at a time
    Then the client's bytes and the outcomes are identical

  @criterion-FR-MAIL-027-c2
  Scenario: A read past the timeout returns null, and null stays
    Given a stream that sends nothing, and a server trickling a line one byte at a time past the timeout
    When line is called, and called again
    Then it returns null both times

  @criterion-FR-MAIL-027-c3
  Scenario: A write past the timeout throws
    Given a writable that never accepts
    When write is called
    Then it throws

  @criterion-FR-MAIL-027-c4
  Scenario: maxLine excludes the CRLF, and passing it closes for good
    Given a line of exactly maxLine bytes, and one a byte longer followed by a good line
    When line is called
    Then the first is returned, and the second gives null, as does every later call

  @criterion-FR-MAIL-027-c5
  Scenario: Only CRLF ends a line, and bytes that do not decode cannot throw
    Given a line holding a bare LF, and a line holding invalid UTF-8
    When line is called
    Then the first is one line with the LF in it, and the second returns text
