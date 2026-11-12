# Generated from legion requirement FR-MAIL-011, revision 2026-11-06T01:12:59.588647+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A reply goes to the right people with the right subject

  @criterion-FR-MAIL-011-c1
  Scenario: A reply to a parent with a Reply-To goes there
    Given the parent a2-2, which has Reply-To "Mary Smith: Personal Account" <smith@home.example>
    When john replies to it
    Then the reply is to "Mary Smith: Personal Account" <smith@home.example>, as in the third message of RFC 5322 A.2

  @criterion-FR-MAIL-011-c2
  Scenario: A reply to a parent without a Reply-To goes to its From
    Given the parent a2-1
    When mary replies to it
    Then the reply is to John Doe <jdoe@machine.example>

  @criterion-FR-MAIL-011-c3
  Scenario: A reply to all copies the other recipients, without the replier
    Given the parent a1.2
    When Mary Smith <mary@x.test> replies to all
    Then the reply is to Joe Q. Public and copies jdoe@example.org, Who? <one@y.test>, boss@nil.test and "Giant; \"Big\" Box", and not mary@x.test

  @criterion-FR-MAIL-011-c4
  Scenario: The subject gains one "Re: "
    Given the parent a2-1, subject "Saying Hello"
    When mary replies to it
    Then the reply's subject is "Re: Saying Hello"

  @criterion-FR-MAIL-011-c5
  Scenario: A subject that already starts "Re: " keeps one
    Given the parent a2-2, subject "Re: Saying Hello"
    When john replies to it
    Then the reply's subject is "Re: Saying Hello"

  @criterion-FR-MAIL-011-c6
  Scenario: "RE:" in any case becomes one "Re: "
    Given a parent with subject "RE: Saying Hello"
    When someone replies to it
    Then the reply's subject is "Re: Saying Hello"

  @criterion-FR-MAIL-011-c7
  Scenario: A parent with no subject gives "Re:"
    Given a parent with no subject
    When someone replies to it
    Then the reply's subject is "Re:"

  @criterion-FR-MAIL-011-c8
  Scenario: Reply-all copies each person once
    Given a parent from john to mary and Ann <ann@example.org>, Cc ann@EXAMPLE.org and john
    When mary replies to all
    Then the reply is to john and copies Ann <ann@example.org> once, and copies neither mary nor john

  @criterion-FR-MAIL-011-c9
  Scenario: Reply-all expands a group into its members
    Given a parent from john to the group "Team" of ann@example.org and bob@example.org
    When mary replies to all
    Then the reply copies ann@example.org and bob@example.org
