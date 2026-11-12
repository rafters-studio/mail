# Generated from legion requirement FR-MAIL-013, revision 2026-11-06T01:12:59.817379+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Person-written mail is HTML every client keeps, with the same words as text

  @criterion-FR-MAIL-013-c1
  Scenario: The HTML has no style block, table or colour, and only the closed vocabulary inside its wrapper
    Given the link case
    When mail writes it
    Then its HTML has no style element, no table and no color or background property, and inside the article wrapper only paragraphs, lists, list items, links, emphasis, strong emphasis, line breaks, block quotes and divisions

  @criterion-FR-MAIL-013-c2
  Scenario: The text part says the same words, with a link's address after its text
    Given the link case
    When mail writes it
    Then the text part has the line "Here is the getting started guide (https://rafters.studio/docs/getting-started/with-a-very-long-path/that-goes-on-and-on?utm_source=mail&utm_medium=reply&ref=abcdefghijklmnopqrstuvwxyz) — it covers everything."

  @criterion-FR-MAIL-013-c3
  Scenario: The HTML declares its language, direction and colour schemes
    Given the plain case
    When mail writes it
    Then its HTML has lang "en" and dir "ltr" on the document and on the article wrapper, and colour-scheme "light dark"

  @criterion-FR-MAIL-013-c4
  Scenario: Lists and emphasis render in both parts
    Given the rich case
    When mail writes it
    Then the HTML has a list of three items and emphasis and strong emphasis, and the text part has the lines "- the guide", "- the https://rafters.studio/docs" and "- the reply"

  @criterion-FR-MAIL-013-c5
  Scenario: A link whose text is its address appears once in the text part
    Given the rich case, whose list links https://rafters.studio/docs to itself
    When mail writes it
    Then the text part has "the https://rafters.studio/docs" and not the address twice

  @criterion-FR-MAIL-013-c6
  Scenario: Right-to-left mail declares its language and direction
    Given the rtl case
    When mail writes it
    Then its HTML has lang "he" and dir "rtl" on the document and on the article wrapper, and each reader reads the subject "שלום"

  @criterion-FR-MAIL-013-c7
  Scenario: A link to anything but http, https or mailto is refused
    Given a message whose only paragraph is a link to "javascript:alert(1)"
    When mail is asked to write it
    Then it is refused with error code unsafe-link for field doc[0].p[0].href, and nothing is written

  @criterion-FR-MAIL-013-c8
  Scenario: A reply quotes its parent under "On {date}, {author} wrote:"
    Given the reply case
    When mail writes it
    Then its HTML has "On Fri, 21 Nov 1997 09:55:06 -0600, John Doe <jdoe@machine.example> wrote:" in a gmail_attr division and the parent's words in a gmail_quote blockquote of type cite, and its text part has the line "> This is a message just to say hello."

  @criterion-FR-MAIL-013-c9
  Scenario: A forward shows the original under a separator, never quoted
    Given the forward case
    When mail writes it
    Then both parts show "---------- Forwarded message ---------", "From: John Doe <jdoe@machine.example>", "Date: Fri, 21 Nov 1997 09:55:06 -0600", "Subject: Saying Hello" and "To: Mary Smith <mary@example.net>", then the original's words, in no blockquote and on no line starting ">"

  @criterion-FR-MAIL-013-c10
  Scenario: A quote of several paragraphs keeps them apart with ">"
    Given a parent whose document is two paragraphs, "One." and "Two."
    When someone replies to it
    Then the text part has the lines "> One.", ">" and "> Two."

  @criterion-FR-MAIL-013-c11
  Scenario: A parent's link mail would not write is quoted as text
    Given a parent whose paragraph links "Call us" to "tel:+15551234"
    When someone replies to it
    Then the reply is written, and its quote holds the text "Call us (tel:+15551234)" and no link

  @criterion-FR-MAIL-013-c12
  Scenario: A forward of mail with a Cc shows the Cc line
    Given the parent a1.2
    When it is forwarded
    Then the forward block has a line that reads, exactly: Cc: boss@nil.test, Giant; "Big" Box <sysservices@example.net>

  @criterion-FR-MAIL-013-c13
  Scenario: A parent with no subject is forwarded as "Fwd:"
    Given a parent with no subject
    When it is forwarded
    Then the subject is "Fwd:"

  @criterion-FR-MAIL-013-c14
  Scenario: A forward's subject is "Fwd: " and the original's
    Given the forward case
    When mail writes it
    Then its subject is "Fwd: Saying Hello"

  @criterion-FR-MAIL-013-c15
  Scenario: "FW:" becomes one "Fwd: "
    Given a parent with subject "FW: Saying Hello"
    When it is forwarded
    Then the subject is "Fwd: Saying Hello"

  @criterion-FR-MAIL-013-c16
  Scenario: A forward carries the original's attachments
    Given the forward case
    When mail writes it and postal-mime, mailparser and Python email each read it back
    Then each reads the attachment "résumé de José.pdf" of 3,000 bytes

  @criterion-FR-MAIL-013-c17
  Scenario: A 7bit original is attached beside the inline forward
    Given the forward case, attaching its original
    When mail writes it
    Then the message has a message/rfc822 part whose body is exactly the parent's raw bytes

  @criterion-FR-MAIL-013-c18
  Scenario: An original that is not 7bit is refused as an attachment
    Given a forward attaching a raw original that holds the byte 0xE9
    When mail is asked to write it
    Then it is refused with error code not-7bit for field raw, and nothing is written, and its message says to forward it inline

  @criterion-FR-MAIL-013-c20
  Scenario: A forward of mail addressed to a group shows the group
    Given a parent from john to the group "Team" of ann@example.org and bob@example.org
    When it is forwarded
    Then the forward block has the line "To: Team: ann@example.org, bob@example.org;"
