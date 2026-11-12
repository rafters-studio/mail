# Generated from legion requirement FR-MAIL-002, revision 2026-11-06T01:12:58.561473+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Header fields are read in order, with repeated fields kept

  @criterion-FR-MAIL-002-c1
  Scenario: The RFC 5322 A.4 message is read as two Received fields, in order, then From, To, Subject, Date and Message-ID
    Given the RFC 5322 Appendix A.4 message with two Received fields
    When mail reads it
    Then its fields are Received, Received, From, To, Subject, Date and Message-ID, in that order

  @criterion-FR-MAIL-002-c2
  Scenario: The RFC 5322 A.3 message is read with Resent-From, Resent-To, Resent-Date and Resent-Message-ID before the original fields
    Given the RFC 5322 Appendix A.3 resent message
    When mail reads it
    Then its first four fields are Resent-From, Resent-To, Resent-Date and Resent-Message-ID, followed by From, To, Subject, Date and Message-ID

  @criterion-FR-MAIL-002-c3
  Scenario: A message with two Subject fields is read with both, in order, and a problem recorded for the repeated Subject
    Given a message with Subject "first" followed by Subject "second"
    When mail reads it
    Then both Subject fields are kept in order and a repeated-field problem names Subject
