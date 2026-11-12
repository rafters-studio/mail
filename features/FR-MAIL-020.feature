# Generated from legion requirement FR-MAIL-020, revision 2026-11-06T01:13:00.649746+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A written message carries its envelope

  @criterion-FR-MAIL-020-c1
  Scenario: A blind copy is in the envelope and not in the bytes
    Given a message from sean@rafters.studio to mary@example.com with blind copy hidden@example.net
    When mail writes it
    Then envelope.to is ["mary@example.com", "hidden@example.net"] and the bytes do not contain hidden@example.net

  @criterion-FR-MAIL-020-c2
  Scenario: The envelope sender is the From address
    Given a message from "Sean Silvius" <sean@rafters.studio>
    When mail writes it
    Then envelope.from is "sean@rafters.studio"

  @criterion-FR-MAIL-020-c3
  Scenario: Envelope recipients are To, then Cc, then Bcc, each once, compared as sameAddress compares
    Given a message to mary@example.com, cc john@example.org, mary@EXAMPLE.COM and Mary@example.com, bcc john@example.org
    When mail writes it
    Then envelope.to is ["mary@example.com", "john@example.org", "Mary@example.com"]

  @criterion-FR-MAIL-020-c4
  Scenario: A reply and a forward carry their envelopes
    Given the reply and forward cases
    When mail writes each
    Then each envelope.to holds every recipient its head names, and envelope.from its from
