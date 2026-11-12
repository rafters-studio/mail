# Generated from legion requirement FR-MAIL-004, revision 2026-11-06T01:12:58.794206+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Addresses are read as RFC 5322 defines them, including obsolete and commented forms

  @criterion-FR-MAIL-004-c1
  Scenario: The To field of RFC 5322 A.1.2 is read as Mary Smith <mary@x.test>, jdoe@example.org and Who? <one@y.test>
    Given the RFC 5322 Appendix A.1.2 message
    When mail reads its To field
    Then it has three mailboxes: Mary Smith at mary@x.test, jdoe@example.org with no name, and Who? at one@y.test

  @criterion-FR-MAIL-004-c2
  Scenario: The Cc field of RFC 5322 A.1.2 is read with the display name Giant; "Big" Box
    Given the RFC 5322 Appendix A.1.2 message
    When mail reads its Cc field
    Then its second mailbox is named Giant; "Big" Box at sysservices@example.net

  @criterion-FR-MAIL-004-c3
  Scenario: The To field of RFC 5322 A.1.3 is read as the group A Group with three members
    Given the RFC 5322 Appendix A.1.3 message
    When mail reads its To field
    Then it is one group named A Group with members Ed Jones at c@a.test, joe@where.test and John at jdoe@one.test

  @criterion-FR-MAIL-004-c4
  Scenario: The Cc field of RFC 5322 A.1.3 is read as the empty group Undisclosed recipients
    Given the RFC 5322 Appendix A.1.3 message
    When mail reads its Cc field
    Then it is one group named Undisclosed recipients with no members

  @criterion-FR-MAIL-004-c5
  Scenario: The commented From field of RFC 5322 A.5 is read as Pete <pete@silly.test>
    Given the RFC 5322 Appendix A.5 message
    When mail reads its From field
    Then it is one mailbox named Pete at pete@silly.test

  @criterion-FR-MAIL-004-c6
  Scenario: The commented To field of RFC 5322 A.5 is read as the group A Group with exactly three members
    Given the RFC 5322 Appendix A.5 message
    When mail reads its To field
    Then it is one group named A Group with members Chris Jones at c@public.example, joe@example.org and John at jdoe@one.test, and nothing else

  @criterion-FR-MAIL-004-c7
  Scenario: The commented Cc field of RFC 5322 A.5 is read as the empty group Hidden recipients
    Given the RFC 5322 Appendix A.5 message
    When mail reads its Cc field
    Then it is one group named Hidden recipients with no members

  @criterion-FR-MAIL-004-c8
  Scenario: The obsolete To field of RFC 5322 A.6.1 is read as Mary Smith <mary@example.net> and jdoe@test.example
    Given the RFC 5322 Appendix A.6.1 message, whose To field has a route, an empty element and a spaced dot
    When mail reads its To field
    Then it has two mailboxes: Mary Smith at mary@example.net and jdoe@test.example

  @criterion-FR-MAIL-004-c9
  Scenario: The obsolete From field of RFC 5322 A.6.3 is read as John Doe <jdoe@machine.example>
    Given the RFC 5322 Appendix A.6.3 message
    When mail reads its From field
    Then it is one mailbox named John Doe at jdoe@machine.example

  @criterion-FR-MAIL-004-c10
  Scenario: Two addresses that differ only in the case of their domain are the same address
    Given the addresses mary@example.net and mary@EXAMPLE.NET
    When mail compares them
    Then they are the same address

  @criterion-FR-MAIL-004-c11
  Scenario: Two addresses that differ only in the case of their local part are different addresses
    Given the addresses mary@example.net and Mary@example.net
    When mail compares them
    Then they are different addresses

  @criterion-FR-MAIL-004-c12
  Scenario: A quoted local part and a domain literal are read as written
    Given the fixture r1-literal-quoted (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then From is the local part "\"john doe\"" at example.com, and To is jdoe at "[192.0.2.1]"

  @criterion-FR-MAIL-004-c13
  Scenario: Quoted words between the dots of a local part are kept
    Given the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then From is the local part a."b c" at x.test

  @criterion-FR-MAIL-004-c14
  Scenario: An unclosed comment, quoted string or domain literal makes the field unreadable
    Given the fixture r2-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then From, To and Cc are each null with an unparsed-value problem

  @criterion-FR-MAIL-004-c15
  Scenario: An address with no domain, or a group member that fits no grammar, makes the field unreadable
    Given the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then Cc ("lone@") and To ("G: <bad;") are each null with an unparsed-value problem

  @criterion-FR-MAIL-004-c16
  Scenario: From names mailboxes and Sender exactly one
    Given the fixture r5-group-from (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures), the fixture r4-one-each (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then a group in From, two Senders and an empty Sender are each null with an unparsed-value problem

  @criterion-FR-MAIL-004-c17
  Scenario: Domains compare ignoring ASCII case only
    Given the domains "\u212Aelvin.test" (Kelvin sign) and "kelvin.test"
    When sameMailbox compares a@ each
    Then they are different mailboxes

  @criterion-FR-MAIL-004-c18
  Scenario: Group members are separated by commas
    Given the field "G: a@x.test b@x.test;" and the field "G: a@x.test, b@x.test;"
    When mail reads each
    Then the first is null and the second is the group G with two members
