# Generated from legion requirement FR-MAIL-040, revision 2026-11-06T01:13:02.942113+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A submission session answers every command as the form's tables say, and lets nothing through it should not

  @criterion-FR-MAIL-040-c1
  Scenario: Every row of the command table answers exactly, whole and one byte at a time
    Given the session goldens, with fixed random and now
    When each is driven whole and one byte at a time
    Then every reply equals the golden, byte for byte

  @criterion-FR-MAIL-040-c2
  Scenario: Resuming after every whole command gives the same bytes
    Given the session goldens
    When the session is discarded and resumed after every whole command, outside DATA and AUTH's continuations
    Then every reply equals the golden

  @criterion-FR-MAIL-040-c3
  Scenario: A session resumed in data reads nothing as a command
    Given a snapshot in the data phase, and a line reading RCPT TO:<x>
    When it resumes and receives the line
    Then it answers 421 Connection lost and closes, with no envelope

  @criterion-FR-MAIL-040-c4
  Scenario: A real client completes a session
    Given Python's smtplib against a local server hosting the session
    When it sends with AUTH PLAIN, with AUTH LOGIN forced, with a Bcc, a period-led line, and a message at maxSize less the written fields' room
    Then each is accepted and the bytes arrive as the form says

  @criterion-FR-MAIL-040-c5
  Scenario: Smuggling reads to the real terminator and is refused
    Given bodies with LF dot LF, LF dot CRLF, CRLF dot LF, CR dot CR and CR dot CRLF
    When the message ends
    Then each answers 554 Bad message, with nothing stored or sent

  @criterion-FR-MAIL-040-c6
  Scenario: A bad line ending or an over-long line in a command closes
    Given a bare LF, a bare CR, a 513-octet line and a 1,013-octet MAIL
    When each is received
    Then each answers 500 and closes, and the rest is not read as a command

  @criterion-FR-MAIL-040-c7
  Scenario: Logging in answers as the form says
    Given bad base64, a star continuation, an unknown mechanism, a differing authorization identity, a wrong password, a login that throws, and AUTH LOGIN with and without a username on its line
    When each runs
    Then they answer 501, 501, 504, 535, 535, 454 and the prompts, and only 535 counts toward the three that close

  @criterion-FR-MAIL-040-c8
  Scenario: Mail cannot be sent without a login
    Given no login
    When MAIL, RCPT and DATA are sent, pipelined
    Then they answer 530, 503 and 503, and nothing is stored or sent

  @criterion-FR-MAIL-040-c9
  Scenario: MAIL refuses what it should, and accepts a null path
    Given an unsafe address, SIZE over the limit, an unknown parameter, someone else's address, a mayUse that throws, AUTH=<>, BODY=7BIT, and <>
    When MAIL runs
    Then they answer 501, 552, 555, 553, 451, 250, 250 and 250

  @criterion-FR-MAIL-040-c10
  Scenario: RCPT refuses what it should
    Given no dot in the domain, a route, an address literal, a comma, a parameter, and past maxRecipients
    When RCPT runs
    Then they answer 501, 501, 501, 501, 555 and 452, and a repeated address is named once

  @criterion-FR-MAIL-040-c11
  Scenario: Only the sender's own address may be used
    Given two From fields in either order, a From of two addresses, none, a group, two Sender fields, a Sender of someone else's, an unreadable Sender, and a catch-all as ceo@
    When the message ends
    Then each answers 553

  @criterion-FR-MAIL-040-c12
  Scenario: A person's own address is allowed in each form it takes
    Given an alias with MAIL FROM differing from From, null MAIL FROM with a good From, and a display name
    When the message ends
    Then each is sent, with the envelope sender the one From address as written

  @criterion-FR-MAIL-040-c13
  Scenario: Blind copies leave no trace, and nothing else changes
    Given Bcc, BCC, Bcc with a tab before the colon, folded, two of them, and Resent-Bcc, beside X-Bcc and a body line reading Bcc:
    When the message is sent
    Then every blind field is gone, and every other byte is the same

  @criterion-FR-MAIL-040-c14
  Scenario: A bad Message-ID is replaced with one field
    Given none, empty, bad syntax, and two
    When the message is sent
    Then there is exactly one, whose left side is the hold's hash, at From's domain

  @criterion-FR-MAIL-040-c15
  Scenario: A missing Date is written
    Given a message with no Date
    When the message is sent
    Then it has one Date from now, at +0000

  @criterion-FR-MAIL-040-c16
  Scenario: Bad bytes are refused after the whole message is read
    Given a byte of 0x80, a NUL and a 1,001-octet line, each followed by a command
    When the message ends
    Then each answers 554, and the next command is read in step

  @criterion-FR-MAIL-040-c17
  Scenario: A message that written fields push past the limit is refused
    Given a message at maxSize with no Date
    When the message ends
    Then it answers 552

  @criterion-FR-MAIL-040-c18
  Scenario: Provider text cannot break a reply
    Given a refusal whose text holds a line break and a line reading 250 Ok
    When the reply is written
    Then it is cut at the first control character and limited to 400 octets, and the client stays in step

  @criterion-FR-MAIL-040-c19
  Scenario: The limits are settings
    Given a session with its own maxSize and maxRecipients
    When EHLO and RCPT run
    Then they follow the settings

  @criterion-FR-MAIL-040-c20
  Scenario: A header section past 1 MiB is refused
    Given a message whose header section passes 1 MiB, within maxSize
    When the message ends
    Then it answers 552 Too large, and readMessage is not called on it
