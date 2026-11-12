# Generated from legion requirement FR-MAIL-047, revision 2026-11-02T22:46:34.099290+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A FETCH does not copy the message

  @criterion-FR-MAIL-047-c1
  Scenario: A body leaves as a slice of the stored bytes, not a copy
    Given a FETCH of BODY[], BODY.PEEK[], RFC822, a part and a partial
    When the session answers
    Then each literal is a view on the bytes the store returned, with no string holding the body while the response is built, and the octets on the wire are exactly as before

  @criterion-FR-MAIL-047-c2
  Scenario: Peak memory counts ArrayBuffers too
    Given a child process calling gc() and sampling heapUsed plus arrayBuffers at each step, so that live memory is what counts, and a 25 MiB message of plain text and of one large attachment
    When FETCH BODY.PEEK[], and BODY.PEEK[2] on the attachment, run through the real session over the real mailbox object
    Then the peak stays under 100 MB

  @criterion-FR-MAIL-047-c3
  Scenario: The parse does not outlive its use
    Given a FETCH asking only for BODY.PEEK[]
    When the session answers
    Then the message is not parsed, and no binary text of it is made

  @criterion-FR-MAIL-047-c4
  Scenario: Every IMAP golden is unchanged
    Given all eight goldens
    When they run whole, one byte at a time, and resumed
    Then every response is byte for byte the same
