# Generated from legion requirement FR-MAIL-048, revision 2026-11-03T03:36:12.557401+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A message's attachment can be read at any size mail accepts

  @criterion-FR-MAIL-048-c1
  Scenario: Reading a message's structure does not make a text copy of its bodies
    Given a message with a large attachment
    When readMessage and BODYSTRUCTURE run
    Then no binary text of the whole message is made: headers are decoded where they are read, and boundaries and line counts are found on the bytes

  @criterion-FR-MAIL-048-c2
  Scenario: Every read and IMAP golden is unchanged
    Given the read fixtures against golden.json, and all eight IMAP goldens whole, one byte at a time and resumed
    When they run
    Then every result is exactly as before
