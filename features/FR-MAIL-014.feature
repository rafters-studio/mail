# Generated from legion requirement FR-MAIL-014, revision 2026-11-06T01:12:59.924820+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A template plugin's content is written as given, under the same byte rules

  @criterion-FR-MAIL-014-c1
  Scenario: A React Email template's one-line HTML is written in lines of at most 78, CRLF and 7-bit
    Given the template case, whose HTML is one line longer than 998 characters
    When mail writes it
    Then every line is at most 78 characters, ends in CRLF, and has only 7-bit characters

  @criterion-FR-MAIL-014-c2
  Scenario: A template's HTML and text read back as the plugin returned them
    Given the template case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the HTML and the text as the plugin returned them

  @criterion-FR-MAIL-014-c3
  Scenario: Template content with no text is refused
    Given template content of some HTML and an empty text
    When mail is asked to write it
    Then it is refused with error code no-text for field text, and nothing is written

  @criterion-FR-MAIL-014-c4
  Scenario: Template text with CR or CRLF line breaks is written with CRLF only
    Given template content whose text has the line breaks CR, LF and CRLF
    When mail writes it
    Then every line ends in CRLF and there is no bare CR or LF

  @criterion-FR-MAIL-014-c5
  Scenario: A template text line ending in a tab keeps it
    Given template content whose text has a line ending in a tab
    When mail writes it
    Then that line of the text part ends in "=09"

  @criterion-FR-MAIL-014-c6
  Scenario: A template renders the same on any day
    Given the OtpEmail template rendered with year 2026
    When the plugin renders it on any date
    Then its HTML holds "© 2026" and the rendered bytes equal the template golden

  @criterion-FR-MAIL-014-c7
  Scenario: The plugin removes React's server-rendering comments
    Given the OtpEmail template
    When the plugin renders it
    Then its HTML holds no "<!--$-->", "<!--/$-->", "<!--$?-->", "<!--$!-->", "<!-- -->" or other comment of only lowercase letters
