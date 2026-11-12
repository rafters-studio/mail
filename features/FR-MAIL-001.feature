# Generated from legion requirement FR-MAIL-001, revision 2026-11-02T05:55:26.885551+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A received message is kept exactly as the provider handed it

  @criterion-FR-MAIL-001-c1
  Scenario: The stored bytes equal the delivered bytes
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support), and the plain golden as raw
    When createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives it for sean@rafters.studio
    Then the blob stored under its key is byte for byte the plain golden

  @criterion-FR-MAIL-001-c2
  Scenario: The bytes are stored under "sha256/" and their lowercase hex SHA-256
    Given the plain golden as raw
    When it is received for sean@rafters.studio
    Then the one blob key is "sha256/56256d5ce9ab71f847f0e609fe1aed13f3e4b59aec4740424fbb26991d9ab30b"

  @criterion-FR-MAIL-001-c3
  Scenario: The envelope is recorded beside the bytes, never written into them
    Given the plain golden, from mary@example.com
    When it is received for sean@rafters.studio
    Then the record holds mailFrom, rcptTo, receivedAt and via as the reference golden plain (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61) has them, and the stored bytes are unchanged

  @criterion-FR-MAIL-001-c4
  Scenario: The same bytes delivered twice add nothing
    Given the plain golden
    When it is received twice for sean@rafters.studio
    Then there is one blob and one record, as in the reference golden same-bytes-twice (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-001-c5
  Scenario: A retry with different bytes is kept as a second copy
    Given the plain golden, then the plain golden with "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=example.com" and CRLF prepended
    When both are received for sean@rafters.studio
    Then there are two blobs and two records, as in the reference golden retry-new-bytes (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-001-c6
  Scenario: A failure leaves no record without its bytes
    Given a deliveries port that throws
    When a message is received for sean@rafters.studio
    Then receive throws, the blob is stored, and no record exists
