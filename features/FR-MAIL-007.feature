# Generated from legion requirement FR-MAIL-007, revision 2026-11-06T01:12:59.143588+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: What cannot be read is reported, never invented

  @criterion-FR-MAIL-007-c1
  Scenario: A message with no Date and no From records a missing-required problem for each and has no date and no author
    Given a message with only To and Subject fields
    When mail reads it
    Then it has no date and no author, and missing-required problems name Date and From

  @criterion-FR-MAIL-007-c2
  Scenario: A message with bare line feeds records a bare line-break problem
    Given a message whose lines end in a line feed alone
    When mail reads it
    Then a bare line-break problem is recorded

  @criterion-FR-MAIL-007-c3
  Scenario: A message with a header line over 998 characters records a line-too-long problem
    Given a message whose Subject line is 2,000 characters long
    When mail reads it
    Then a line-too-long problem is recorded and the Subject is kept whole

  @criterion-FR-MAIL-007-c4
  Scenario: A From field that fits no address grammar records an unparsed-value problem and yields no address
    Given a message whose From field is "<<<>>> ,,, @@@"
    When mail reads it
    Then it has no author and an unparsed-value problem names From

  @criterion-FR-MAIL-007-c5
  Scenario: A header line with no colon records a no-colon problem and the fields around it are still read
    Given a message with the line "this line has no colon" between its From and Date fields
    When mail reads it
    Then a no-colon problem is recorded and From and Date are both read
