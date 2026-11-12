# Generated from legion requirement FR-MAIL-003, revision 2026-11-06T01:12:58.678804+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Folded header fields are read unfolded

  @criterion-FR-MAIL-003-c1
  Scenario: The first Received field of the RFC 5322 A.4 message is read as one line
    Given the RFC 5322 Appendix A.4 message, whose first Received field is folded over six lines
    When mail reads it
    Then the field reads "from x.y.test   by example.net   via TCP   with ESMTP   id ABC12345   for <mary@example.net>;  21 Nov 1997 10:05:43 -0600"
