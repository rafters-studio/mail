# Generated from legion requirement FR-MAIL-019, revision 2026-11-06T01:13:00.532993+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A message is read as a tree of byte ranges, and decoded only when asked

  @criterion-FR-MAIL-019-c1
  Scenario: Every leaf part of a written message is where Python email finds it, with the same bytes
    Given the writer goldens plain, attachment, forward, rich, intl and reply
    When mail parses each
    Then every leaf's section, type and raw body bytes equal goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.goldens.read, which match Python email (compat32)

  @criterion-FR-MAIL-019-c2
  Scenario: A message/rfc822 part is read as a message
    Given the forward golden
    When mail parses it
    Then part 3 is message/rfc822 whose header begins "From: John Doe <jdoe@machine.example>", and section 3.1 is its text/plain body

  @criterion-FR-MAIL-019-c3
  Scenario: A line that only begins with "--" is no boundary
    Given the forward golden, whose text part holds "---------- Forwarded message ---------"
    When mail parses it
    Then part 1.1 holds that line and part 1 has two children

  @criterion-FR-MAIL-019-c4
  Scenario: A multipart with no boundary has no parts and records a problem
    Given the fixture r8-broken-multipart (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail parses it
    Then the root has no children and a multipart-no-boundary problem

  @criterion-FR-MAIL-019-c5
  Scenario: A multipart with no closing line keeps its last part to the end and records a problem
    Given the fixture r10-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail parses it
    Then the root has one child running to the end, and a multipart-unclosed problem

  @criterion-FR-MAIL-019-c6
  Scenario: The parts of a digest are messages, and a part may have an empty header or no body
    Given the fixture r6-digest (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail parses it
    Then the boundary is d"q; child 1 is message/rfc822 with an empty header holding "From: inner@x.test"; child 2 is text/plain, all header, with an empty body

  @criterion-FR-MAIL-019-c7
  Scenario: A message with no empty line is all header
    Given the fixture r9-all-header (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail parses it
    Then the body is empty and section "1" is the root

  @criterion-FR-MAIL-019-c8
  Scenario: A section that does not exist is null
    Given the attachment golden
    When sections "9" and "2.1.1" are asked for
    Then both are null

  @criterion-FR-MAIL-019-c9
  Scenario: Each text part decodes as Python email decodes it
    Given the six writer goldens
    When partText decodes every text leaf
    Then each equals the text Python email decodes (get_payload(decode=True), the part charset)

  @criterion-FR-MAIL-019-c10
  Scenario: A base64 part decodes to its bytes
    Given the attachment golden
    When part 2 is transfer-decoded
    Then the bytes equal what Python email decodes for it

  @criterion-FR-MAIL-019-c11
  Scenario: Quoted-printable keeps an "=" that is no escape, and an unknown charset decodes as UTF-8
    Given the fixture r7-decode (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When partText decodes the root
    Then the text is "a=b =zz café" and CRLF

  @criterion-FR-MAIL-019-c12
  Scenario: Encoded words decode, join, and leave what does not decode
    Given the fixture r7-decode (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When decodeWords decodes its Subject
    Then it is "café ok ✔ =?nosuch?Q?x?="

  @criterion-FR-MAIL-019-c13
  Scenario: A written subject in another script decodes as Python decodes it
    Given the intl golden
    When decodeWords decodes its Subject
    Then it equals make_header(decode_header(Subject)) in Python

  @criterion-FR-MAIL-019-c14
  Scenario: Every fixture reads exactly as its golden
    Given every fixture of the reading reference
    When readMessage reads each
    Then the result equals goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.goldens.read (dates as ISO strings)

  @criterion-FR-MAIL-019-c15
  Scenario: Quoted-printable drops white space at the end of a line, so "=" and spaces is a soft break
    Given the text "a" two spaces CRLF "b=" two spaces CRLF "c" tab, encoded " Quoted-Printable "
    When transferDecode decodes it
    Then the bytes are "a" CRLF "bc"

  @criterion-FR-MAIL-019-c16
  Scenario: Nesting deeper than 50 is read as a leaf, and reading never throws
    Given the fixture r12-deep (60 nested message/rfc822 parts), and a message nested 5,000 deep
    When mail reads each
    Then each records one too-deep problem, field content-type, detail "nesting over 50", and nothing throws

  @criterion-FR-MAIL-019-c17
  Scenario: A Content-Type value gives its type and parameters
    Given the value text/plain; charset="utf-8"; format=flowed
    When contentType reads it
    Then the type is text/plain and the parameters are charset utf-8 and format flowed

  @criterion-FR-MAIL-019-c18
  Scenario: A part's own header fields are read
    Given part 2 of the attachment golden
    When partFields reads it
    Then its fields are Content-Type, Content-Transfer-Encoding and Content-Disposition, in that order

  @criterion-FR-MAIL-019-c19
  Scenario: A part's body lines are counted as IMAP counts them
    Given parts 1.1 and 2 of the attachment golden, and the root of r9-all-header
    When bodyLines counts each
    Then they are 1, 53 and 0
