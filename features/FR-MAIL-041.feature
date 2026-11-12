# Generated from legion requirement FR-MAIL-041, revision 2026-11-06T01:13:03.062705+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A retry cannot send twice and cannot lie, and a failure reaches the person

  @criterion-FR-MAIL-041-c1
  Scenario: The reply follows the outcome table
    Given every combination of accepted, refused final, refused not final and unknown over one to three recipients
    When the message ends
    Then the reply is the table's

  @criterion-FR-MAIL-041-c2
  Scenario: The hold key is the same for the same bytes, and differs for an edit or another mailbox
    Given the same bytes twice, an edit under one Message-ID, and the same bytes from another mailbox
    When the session hashes them
    Then the first two share a key and parse with messageIdSchema, and the others differ

  @criterion-FR-MAIL-041-c3
  Scenario: Identical bytes with no Date are new on a later day
    Given the same bytes with no Date, the same day and a later day
    When the session hashes them
    Then the same day is held and the later day is new, while a message with its own Date is held on both

  @criterion-FR-MAIL-041-c4
  Scenario: A throw answers by what it means
    Given a TypeError or ZodError from submit, and any other throw
    When the message ends
    Then the first answers 554 Bad message and the second 451 Try again

  @criterion-FR-MAIL-041-c5
  Scenario: A notice is written before the 250
    Given a recipient refused beside one accepted, and one unknown
    When the message ends
    Then notify is called before the 250 is sent, naming only the failed recipients

  @criterion-FR-MAIL-041-c6
  Scenario: A notice can always be written, or its failure changes nothing
    Given a subject folded with a tab, 2,000 unbroken characters, encoded with CRLF, provider text with a line break, and a notify that throws, through the session; and writeNotice given a From with a trailing dot
    When the message ends, or writeNotice runs
    Then each session answers 250, with a notice where one can be written and a logged line where not, and writeNotice writes the domain without the dot

  @criterion-FR-MAIL-041-c7
  Scenario: A notice's Message-ID collapses a retry
    Given the same failure twice, and a different failure
    When writeNotice runs
    Then the first two share a Message-ID left side, and the third differs
