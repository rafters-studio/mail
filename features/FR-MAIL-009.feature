# Generated from legion requirement FR-MAIL-009, revision 2026-11-06T01:12:59.362624+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Every message has a unique Message-ID at the sending domain

  @criterion-FR-MAIL-009-c1
  Scenario: Ten thousand messages from one mail have ten thousand different Message-IDs at its domain
    Given a mail for rafters.studio with the real entropy and clock
    When it writes the plain case ten thousand times
    Then all ten thousand Message-IDs are different and each ends in "@rafters.studio"

  @criterion-FR-MAIL-009-c2
  Scenario: A message's Message-ID reads back as the one mail reported
    Given the plain case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the Message-ID that mail returned with the bytes
