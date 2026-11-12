# Generated from legion requirement FR-MAIL-010, revision 2026-11-06T01:12:59.479211+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A reply carries the threading RFC 5322 prescribes

  @criterion-FR-MAIL-010-c1
  Scenario: A reply to the first A.2 message has In-Reply-To and References 1234@local.machine.example
    Given the parent a2-1
    When mary replies to it
    Then the reply's In-Reply-To and References are both 1234@local.machine.example, as in the second message of RFC 5322 A.2

  @criterion-FR-MAIL-010-c2
  Scenario: A reply to the second A.2 message threads as the third A.2 message does
    Given the parent a2-2
    When john replies to it
    Then the reply's In-Reply-To is 3456@example.net and its References are 1234@local.machine.example then 3456@example.net

  @criterion-FR-MAIL-010-c3
  Scenario: A parent with one In-Reply-To and no References gives References of that id then its Message-ID
    Given a parent with Message-ID c@x.test and In-Reply-To b@x.test
    When someone replies to it
    Then the reply's References are b@x.test then c@x.test

  @criterion-FR-MAIL-010-c4
  Scenario: A parent with no ids gives a reply with neither field
    Given a parent with no Message-ID, In-Reply-To or References
    When someone replies to it
    Then the reply has no In-Reply-To and no References

  @criterion-FR-MAIL-010-c5
  Scenario: A reply's threading reads back unchanged
    Given the reply case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads In-Reply-To and References as mail wrote them
