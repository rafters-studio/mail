# Generated from legion requirement FR-MAIL-031, revision 2026-11-06T01:13:01.958687+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: The send log on D1, and the way out of a held row

  @criterion-FR-MAIL-031-c1
  Scenario: claim takes a new row and a refused row not final, and holds the others
    Given no row, then rows unknown, accepted, finally refused and refused not final, on node:sqlite
    When claim runs on each
    Then it returns true, false, false, false, true

  @criterion-FR-MAIL-031-c2
  Scenario: A re-claim clears the earlier refusal and takes the new provider
    Given a row refused not final through one provider
    When claim runs through another
    Then the row is unknown with that provider, and its final, stage, code and text are null

  @criterion-FR-MAIL-031-c3
  Scenario: The migration refuses rows the form forbids
    Given a refused row with no final, a refused row with no stage, and a stage outside the list
    When each is written
    Then each fails a CHECK

  @criterion-FR-MAIL-031-c4
  Scenario: settle writes each kind
    Given an unknown row
    When settle runs with accepted, refused and unknown outcomes
    Then the columns match each, and unknown leaves the state and writes detail to text

  @criterion-FR-MAIL-031-c5
  Scenario: A settle after a release changes nothing
    Given a row released, then claimed and settled accepted
    When the old attempt settles refused
    Then the row stays accepted

  @criterion-FR-MAIL-031-c6
  Scenario: The release frees a row from any state
    Given rows unknown, accepted and finally refused
    When the form's release statement runs, then claim
    Then each is refused not final with the text released by hand, and each claim returns true

  @criterion-FR-MAIL-031-c7
  Scenario: A crash row reads as no answer recorded
    Given a row claimed and never settled
    When d1History runs
    Then the outcome is unknown, with detail no answer recorded

  @criterion-FR-MAIL-031-c8
  Scenario: History matches events by Message-ID and by provider id
    Given one event with the message_id, one with the row's provider and provider_id, one for another message, on node:sqlite
    When d1History runs
    Then it returns the first two, ordered by at, and outcomes ordered by recipient

  @criterion-FR-MAIL-031-c9
  Scenario: A row failing its schema throws
    Given an event row whose kind passes the table but whose at is not a date
    When d1History runs
    Then it throws
