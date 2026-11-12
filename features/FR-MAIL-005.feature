# Generated from legion requirement FR-MAIL-005, revision 2026-11-06T01:12:58.919072+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Message identifiers are read without angle brackets or obsolete white space

  @criterion-FR-MAIL-005-c1
  Scenario: The third message of RFC 5322 A.2 is read with In-Reply-To 3456@example.net and References 1234@local.machine.example then 3456@example.net
    Given the third message of RFC 5322 Appendix A.2
    When mail reads it
    Then its In-Reply-To is 3456@example.net and its References are 1234@local.machine.example followed by 3456@example.net

  @criterion-FR-MAIL-005-c2
  Scenario: The obsolete Message-ID of RFC 5322 A.6.3 is read as 1234@local.machine.example
    Given the RFC 5322 Appendix A.6.3 message
    When mail reads its Message-ID
    Then it is 1234@local.machine.example

  @criterion-FR-MAIL-005-c3
  Scenario: The Message-ID of RFC 5322 A.5, preceded by white space, is read as testabcd.1234@silly.test
    Given the RFC 5322 Appendix A.5 message
    When mail reads its Message-ID
    Then it is testabcd.1234@silly.test

  @criterion-FR-MAIL-005-c4
  Scenario: A Message-ID holding two identifiers is unreadable
    Given the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then Message-ID is null with an unparsed-value problem

  @criterion-FR-MAIL-005-c5
  Scenario: An identifier without "@", without its ">", or with an unclosed comment makes the field unreadable
    Given the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures), the fixture r2-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then In-Reply-To, Message-ID and In-Reply-To are each null with an unparsed-value problem

  @criterion-FR-MAIL-005-c6
  Scenario: Words between identifiers in References are skipped
    Given the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then References is ["1@x.test", "2@x.test"]

  @criterion-FR-MAIL-005-c7
  Scenario: An identifier with a quoted left side and a literal right side is read as written
    Given the fixture r1-literal-quoted (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then Message-ID is "\"quoted\"@[192.0.2.1]"
