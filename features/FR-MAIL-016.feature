# Generated from legion requirement FR-MAIL-016, revision 2026-11-06T01:13:00.169247+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: The directory finds the right mailbox

  @criterion-FR-MAIL-016-c1
  Scenario: Case and dots do not change the mailbox
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for S.e.a.n@Rafters.Studio
    Then it is recorded for mbx-sean, as in the reference golden case-and-dots (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-016-c2
  Scenario: An address with its own tag row reaches that row's mailbox
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for sean+lists@rafters.studio
    Then it is recorded for mbx-lists, as in the reference golden tag-own-address (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-016-c3
  Scenario: A tag with no row of its own reaches the address without it
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for se.an+receipts.2026@rafters.studio
    Then it is recorded for mbx-sean, as in the reference golden tag-falls-back (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), and recipient() gives the tag "receipts.2026"

  @criterion-FR-MAIL-016-c4
  Scenario: Postmaster in any case reaches the domain's postmaster mailbox
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for PostMaster@rafters.studio
    Then it is recorded for mbx-ops, as in the reference golden postmaster (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-016-c5
  Scenario: A domain's catch-all receives unknown local parts, however the domain is written
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for anyone@EXEMPLÉ.FR, and domainName is given exemplé.fr, EXEMPLÉ.FR and xn--exempl-gva.fr
    Then it is recorded for mbx-sean, as in the reference golden catch-all-idn (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61), and the three names are all "xn--exempl-gva.fr"

  @criterion-FR-MAIL-016-c6
  Scenario: A switched-off address on a domain with a catch-all is dropped, not caught
    Given a directory whose domain has a catch-all and a switched-off address there
    When mail is received for that address
    Then the verdict is drop

  @criterion-FR-MAIL-016-c7
  Scenario: A name that is not a domain finds nothing
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When domainName is given "rafters.studio:25", "[192.0.2.1]", "0x7f.1", ".", "" and "a b.org", and the plain golden is received for sean@rafters.studio:25
    Then each name gives null, and the delivery is rejected, as in the reference golden not-a-domain (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-016-c8
  Scenario: A domain the directory does not hold, or an empty local part, finds nothing
    Given a directory with a catch-all at rafters.studio
    When findMailbox is asked for sean@elsewhere.org, @rafters.studio and +tag@rafters.studio
    Then each finds null

  @criterion-FR-MAIL-016-c9
  Scenario: A domain cannot exist without a postmaster mailbox
    Given a domain row with no postmaster
    When domainSchema parses it
    Then it fails

  @criterion-FR-MAIL-016-c10
  Scenario: A quoted local part is lowercased and otherwise kept whole
    Given the address "\"A.B+c\"@rafters.studio"
    When recipient() and canonicalLocal() read it
    Then the local part is "\"a.b+c\"" with no tag

  @criterion-FR-MAIL-016-c11
  Scenario: An envelope recipient with no @ finds nothing
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for "postmaster" with no domain (RFC 5321 4.1.1.3 allows RCPT TO:<Postmaster>; mail routes by domain, so it has none to route by)
    Then recipient() gives domain null, and the verdict is reject with reason no-such-user

  @criterion-FR-MAIL-016-c12
  Scenario: An empty tag is no tag
    Given the seed directory of the reference goldens (rafters.studio with postmaster mbx-ops, no catch-all, masking on; xn--exempl-gva.fr with postmaster mbx-ops, catch-all mbx-sean; addresses sean, silvius and the switched-off quietotter4821 to mbx-sean, sean+lists to mbx-lists, support to mbx-support)
    When the plain golden is received for sean+@rafters.studio
    Then recipient() gives tag null, and it is recorded for mbx-sean
