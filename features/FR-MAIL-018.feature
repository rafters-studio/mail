# Generated from legion requirement FR-MAIL-018, revision 2026-11-07T04:46:20.346305+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A person can make masked addresses and switch them off

  @criterion-FR-MAIL-018-c1
  Scenario: Each style makes the golden addresses
    Given a domain with masking on and an empty directory
    When createMasker with a fresh counter random makes three addresses in each of the six styles
    Then each local and shown form is that of the reference golden masked (goldens.01a19a9e-65ae-73a1-a384-82a2a6f6ac61)

  @criterion-FR-MAIL-018-c2
  Scenario: A draw at or above the fair limit is drawn again
    Given a random that gives 0xFFFF and then 0x0000 for every draw
    When one address is made in the words/period style
    Then its first word is "acid"

  @criterion-FR-MAIL-018-c3
  Scenario: A candidate already taken is skipped
    Given a directory holding the first words-digits/period candidate
    When an address is made with a fresh counter random
    Then it is "golf.slimy.3715"

  @criterion-FR-MAIL-018-c4
  Scenario: Five taken candidates throw
    Given a directory that holds every candidate
    When an address is made
    Then it throws "no free masked address at rafters.studio after 5 tries"

  @criterion-FR-MAIL-018-c5
  Scenario: A domain with masking off is refused
    Given a domain with masking off
    When an address is made
    Then it throws "masking is off at rafters.studio" and the directory is never asked

  @criterion-FR-MAIL-018-c6
  Scenario: The address made is canonical, switched on and labelled, and is not written
    Given a directory that records any write
    When an address is made with label "bike shop" at now 2026-03-02T17:00:00Z
    Then its local is the canonical form of its shown form, enabled is true, mask is { shown, "bike shop", now }, and nothing was written

  @criterion-FR-MAIL-018-c7
  Scenario: The word list is the EFF short wordlist 1
    Given WORDS
    When it is read
    Then it has 1,296 words, each matching ^[a-z]+(-[a-z]+)?$, and the SHA-256 of WORDS.join("\n") is 3680fb8483e03eab3067f20ef8b8848a086006b25981b0df6c8bdc603c4ed55e

  @criterion-FR-MAIL-018-c8
  Scenario: Without a random or a clock, an address is still made
    Given a domain with masking on and an empty directory
    When createMasker with only the directory makes an address
    Then it parses with mailboxAddressSchema, and its createdAt is no earlier than the clock read just before the call and no later than the clock read just after
