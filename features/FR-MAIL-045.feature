# Generated from legion requirement FR-MAIL-045, revision 2026-11-06T01:13:03.539691+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A hostile message cannot run a reader out of memory

  @criterion-FR-MAIL-045-c1
  Scenario: A header section past the bound is read only to the bound
    Given a message whose header section passes 1 MiB, with a Message-ID before the bound and one field after it
    When readMessage runs
    Then the Message-ID reads, the later field does not, and a header-too-large problem is recorded

  @criterion-FR-MAIL-045-c2
  Scenario: Parts past the bound are not walked
    Given a multipart message of more than 10,000 parts, nested and flat
    When readMessage runs
    Then at most 10,000 parts are read, the rest is left unread inside its parent, and a too-many-parts problem is recorded

  @criterion-FR-MAIL-045-c3
  Scenario: No shape runs a reader out of memory at 25 MiB
    Given a child process with a 128 MB heap, and at 25 MiB: many fields, one field folded millions of times, millions of parts, and plain text
    When readMessage runs on each
    Then each returns

  @criterion-FR-MAIL-045-c4
  Scenario: A hostile message cannot stop a mailbox
    Given a 25 MiB delivery of each hostile shape, and a good delivery after it
    When the mailbox pulls under a 128 MB heap
    Then the pull finishes, and the good delivery is in the mailbox

  @criterion-FR-MAIL-045-c5
  Scenario: Every read golden is unchanged
    Given the existing read fixtures
    When readMessage runs
    Then every result equals what it was before the bound
