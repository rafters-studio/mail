# Generated from legion requirement FR-MAIL-008, revision 2026-11-06T01:12:59.252163+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A written message is bytes every client can read

  @criterion-FR-MAIL-008-c1
  Scenario: Every line is at most 78 characters, ends in CRLF and is 7-bit
    Given the cases plain, link, attachment, intl, long-filename, ascii-filename, docx, rich, rtl, reply and forward
    When mail writes each one
    Then every line is at most 78 characters, ends in CRLF, and has only 7-bit characters

  @criterion-FR-MAIL-008-c2
  Scenario: A sender named José Núñez and a Japanese subject read back unchanged
    Given the intl case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the sender's name and the subject exactly as given

  @criterion-FR-MAIL-008-c3
  Scenario: The text part comes before the HTML part, and both read back unchanged
    Given the link case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each finds the text part before the HTML part and reads both as mail rendered them

  @criterion-FR-MAIL-008-c4
  Scenario: An attachment named "résumé de José.pdf" reads back with its name and 3,000 bytes
    Given the attachment case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads one attachment named "résumé de José.pdf" of 3,000 bytes

  @criterion-FR-MAIL-008-c5
  Scenario: A long non-ASCII filename reads back unchanged, with no line over 78
    Given the long-filename case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the filename exactly, and no line of the message passes 78 characters

  @criterion-FR-MAIL-008-c6
  Scenario: A long ASCII filename reads back unchanged, with no line over 78
    Given the ascii-filename case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the filename exactly, and no line of the message passes 78 characters

  @criterion-FR-MAIL-008-c7
  Scenario: A long attachment type is written within 78 characters
    Given the docx case, whose type is application/vnd.openxmlformats-officedocument.wordprocessingml.document
    When mail writes it
    Then the type is on a line of its own after "Content-Type:", every line is at most 78 characters, and each reader reads the attachment report.docx

  @criterion-FR-MAIL-008-c8
  Scenario: A Reply-To is written
    Given a message from noreply@rafters.studio with Reply-To support@rafters.studio
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then the message has the field "Reply-To: support@rafters.studio"

  @criterion-FR-MAIL-008-c9
  Scenario: A line ending in a space keeps it
    Given the rich case, whose first paragraph ends in a space
    When mail writes it
    Then that line of the text part ends in "=20" and reads back ending in a space

  @criterion-FR-MAIL-008-c10
  Scenario: The Date carries the author's local time and offset
    Given the plain case, written at 2026-03-02 17:00:00 UTC by an author 420 minutes behind UTC
    When mail writes it
    Then its Date field is "Mon, 2 Mar 2026 10:00:00 -0700"

  @criterion-FR-MAIL-008-c11
  Scenario: An empty To list writes no To field
    Given a message from sean with an empty To list and Cc mary
    When mail writes it
    Then it has no To field and a Cc field

  @criterion-FR-MAIL-008-c12
  Scenario: HTML over 90,000 bytes once encoded is refused
    Given a message whose document encodes to more than 90,000 bytes of HTML
    When mail is asked to write it
    Then it is refused with error code too-large for field content, and nothing is written

  @criterion-FR-MAIL-008-c13
  Scenario: A document with no text is refused
    Given a message whose document is one paragraph of spaces
    When mail is asked to write it
    Then it is refused with error code no-text for field doc, and nothing is written

  @criterion-FR-MAIL-008-c14
  Scenario: A header word too long to fold under 998 is refused
    Given a message whose subject is one word of 1,000 characters
    When mail is asked to write it
    Then it is refused with error code word-too-long for field subject, and nothing is written

  @criterion-FR-MAIL-008-c15
  Scenario: An address that is not US-ASCII is refused
    Given a message to josé@ejemplo.es
    When mail is asked to write it
    Then it is refused with error code address for field to[0].addr.local, and nothing is written

  @criterion-FR-MAIL-008-c16
  Scenario: A key mail does not define is refused
    Given a message head with the extra key "priority"
    When mail is asked to write it
    Then it is refused with error code invalid for field priority, and nothing is written

  @criterion-FR-MAIL-008-c17
  Scenario: A field of the wrong kind is refused, naming the field
    Given a message head whose To is the text "mary@example.net" instead of a list of mailboxes
    When mail is asked to write it
    Then it is refused with error code invalid for field to, and nothing is written

  @criterion-FR-MAIL-008-c18
  Scenario: A display name with a comma or other special is written as a quoted string
    Given a message from "Silvius, Sean" <sean@rafters.studio>
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then its From field is From: "Silvius, Sean" <sean@rafters.studio>, and each reader reads one mailbox named Silvius, Sean

  @criterion-FR-MAIL-008-c19
  Scenario: A display name of only spaces is written as no name
    Given a message from a mailbox named "   " at sean@rafters.studio
    When mail writes it
    Then its From field is From: sean@rafters.studio
