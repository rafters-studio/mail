# Generated from legion requirement FR-MAIL-012, revision 2026-11-06T01:12:59.705212+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Blind copies are never revealed

  @criterion-FR-MAIL-012-c1
  Scenario: A message with a blind copy has no Bcc field and does not name the blind recipient
    Given a message from sean to mary with blind copy hidden@example.net
    When mail writes it
    Then the bytes have no Bcc field and do not contain hidden@example.net
