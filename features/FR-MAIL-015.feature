# Generated from legion requirement FR-MAIL-015, revision 2026-11-06T01:13:00.036122+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Receiving decides from the envelope alone

  @criterion-FR-MAIL-015-c1
  Scenario: A message whose headers are garbage is still accepted
    Given the plain golden with a line of control characters prepended
    When it is received for sean@rafters.studio
    Then the verdict is accept for mbx-sean

  @criterion-FR-MAIL-015-c2
  Scenario: No recipient found is a reject, and nothing is stored
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives the plain golden for nobody@rafters.studio
    Then the verdict is reject with reason no-such-user and there are no blobs and no records, as in the reference golden unknown (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-015-c3
  Scenario: Every recipient found switched off is a drop, and nothing is stored
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for quiet.otter.4821@rafters.studio
    Then the verdict is drop and there are no blobs and no records, as in the reference golden masked-off-drops (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-015-c4
  Scenario: Only recipients found switched on are recorded, in envelope order
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the intl golden is received for sean@ and support@rafters.studio, and the plain golden for quietOtter4821@ and support@rafters.studio
    Then the verdicts and records are those of the reference golden two-mailboxes (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61) and the reference golden masked-off-and-on (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-015-c5
  Scenario: Two recipients finding one mailbox give one record, for the first
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for sean@ and silvius@rafters.studio
    Then there is one record, with rcptTo sean@rafters.studio, as in the reference golden alias-once (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-015-c6
  Scenario: A bounce is recorded with a null sender
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received with mailFrom null for sean@rafters.studio
    Then the record's mailFrom is null, as in the reference golden bounce (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-015-c7
  Scenario: Each record id is a UUIDv7 from the receipt time and the random
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When createReceiver over that directory, with the counter random and receivedAt 2026-03-02T17:00:00Z receives the plain golden for sean@rafters.studio
    Then the record id is "019caf7e-0e80-7001-8203-040506070809"

  @criterion-FR-MAIL-015-c8
  Scenario: Without a random, record ids are still UUIDv7 from the receipt time
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When createReceiver with no random receives the plain golden for sean@rafters.studio
    Then the record id is a version 7 UUID whose time is 2026-03-02T17:00:00Z

  @criterion-FR-MAIL-015-c9
  Scenario: A delivery the adapter built wrongly throws
    Given a delivery with an empty rcptTo list
    When it is received
    Then receive throws a ZodError and nothing is stored
