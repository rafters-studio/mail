# Generated from legion requirement FR-MAIL-017, revision 2026-11-02T05:55:22.109374+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Cloudflare Email Routing delivers to mail through an email-only Worker

  @criterion-FR-MAIL-017-c1
  Scenario: The Worker's default export has the email handler alone
    Given emailWorker()
    When its keys are read
    Then they are exactly ["email"]

  @criterion-FR-MAIL-017-c2
  Scenario: A message for a mailbox is stored through D1 and R2
    Given the migration and the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support) on node:sqlite as D1, and a Map as R2
    When the Worker handles the plain golden from mary@example.com to sean@rafters.studio
    Then the blobs and rows are those of the reference golden worker-accept (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), with via "cloudflare"

  @criterion-FR-MAIL-017-c3
  Scenario: A message for no one is rejected and nothing is stored
    Given the same
    When the Worker handles the plain golden to nobody@rafters.studio
    Then setReject is called once with "No such user here", and there are no blobs and no rows

  @criterion-FR-MAIL-017-c4
  Scenario: An empty envelope sender is recorded as null
    Given the same
    When the Worker handles the plain golden with from "" to sean@rafters.studio
    Then the row's mail_from is null, as in the reference golden worker-bounce (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-017-c5
  Scenario: Bytes that do not match rawSize throw
    Given a message whose rawSize is one more than its bytes
    When the Worker handles it
    Then it throws "raw is 1522 bytes, rawSize says 1523" for the plain golden, and nothing is stored

  @criterion-FR-MAIL-017-c6
  Scenario: The migration refuses rows the form forbids
    Given the migration on node:sqlite with foreign keys on
    When a domain with no postmaster, and an address with mask_shown but no mask_label, are inserted
    Then both inserts fail

  @criterion-FR-MAIL-017-c7
  Scenario: The D1 directory reads rows into the core's schemas, and a bad row throws
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support) on node:sqlite
    When d1Directory reads rafters.studio and the address quietotter4821, then an address row whose mask_created_at is "not a date"
    Then it gives masking true, enabled false and mask { shown "quiet.otter.4821", label "bike shop", createdAt 2026-03-01T09:00:00Z }, and the bad row throws

  @criterion-FR-MAIL-017-c8
  Scenario: Recording the same blob for the same mailbox twice adds one row
    Given d1Deliveries on node:sqlite
    When one row is recorded twice
    Then the deliveries table has one row
