# Generated from legion requirement FR-MAIL-046, revision 2026-11-06T01:13:03.657896+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Any message mail accepted can be read over IMAP

  @criterion-FR-MAIL-046-c1
  Scenario: A message at the provider's limit can be read whole
    Given a child process with a 128 MB heap, the real createImapSession over the real mailbox object, and a 25 MiB message of plain text
    When LOGIN, SELECT and FETCH 1 BODY[] run
    Then the response holds the message byte for byte, and the command completes

  @criterion-FR-MAIL-046-c2
  Scenario: Every hostile shape can be read too
    Given the same child process, and 25 MiB of many fields, one folded field, millions of parts, and every line empty
    When FETCH 1 BODY[] runs on each
    Then each completes

  @criterion-FR-MAIL-046-c3
  Scenario: The other items a mail app asks for complete
    Given the same child process and a 25 MiB message with one large attachment
    When FETCH runs for BODYSTRUCTURE, ENVELOPE, RFC822.SIZE, BODY.PEEK[HEADER], BODY.PEEK[1] and BODY.PEEK[]<0.65536>
    Then each completes, and the partial returns exactly its octets

  @criterion-FR-MAIL-046-c4
  Scenario: A response becomes octets without one element per byte
    Given the function turning a response into octets
    When it runs on 25 MiB
    Then the octets equal the text, and heap use stays under twice the input

  @criterion-FR-MAIL-046-c5
  Scenario: Every IMAP golden is unchanged
    Given all eight goldens
    When they run whole, one byte at a time, and resumed
    Then every response is byte for byte the same
