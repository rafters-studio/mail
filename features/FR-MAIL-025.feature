# Generated from legion requirement FR-MAIL-025, revision 2026-11-07T04:46:20.225249+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A message goes to a submission server as its exact bytes, and the server's reply decides

  @criterion-FR-MAIL-025-c1
  Scenario: A session writes exactly the form's commands, in order
    Given a server answering every command positively
    When submit sends a message to two recipients
    Then the client's bytes equal the golden: EHLO, AUTH PLAIN, MAIL FROM, two RCPT TO, DATA, the stuffed message and QUIT, each command followed by CRLF

  @criterion-FR-MAIL-025-c2
  Scenario: A real server stores the bytes exactly
    Given smtp-server on 127.0.0.1
    When each writer golden and a variant with period-led lines is submitted
    Then the bytes the server stored equal the input

  @criterion-FR-MAIL-025-c3
  Scenario: A refusal before the message refuses every recipient, not final, and writes no message byte
    Given a server answering not 2yz at the greeting, EHLO, AUTH or MAIL FROM, or not 3yz at DATA
    When submit runs
    Then every recipient is refused at that stage with final false, and no byte of the message was written

  @criterion-FR-MAIL-025-c4
  Scenario: A server not offering AUTH PLAIN gets no credential
    Given EHLO replies with no AUTH line, with AUTH LOGIN PLAIN-CLIENTTOKEN, with AUTH=PLAIN, and with a first line reading AUTH.example.com PLAIN greeting
    When submit runs
    Then every recipient is refused at stage auth with code null and the form's text, and no AUTH command was written

  @criterion-FR-MAIL-025-c5
  Scenario: AUTH PLAIN is recognised in any case
    Given an EHLO reply line of auth login plain
    When submit runs
    Then the AUTH PLAIN command is written

  @criterion-FR-MAIL-025-c6
  Scenario: The credential is RFC 4616's message as UTF-8 then base64
    Given a login whose password holds a character above Latin-1
    When submit runs
    Then the AUTH PLAIN argument decodes to NUL, the user, NUL and the password in UTF-8

  @criterion-FR-MAIL-025-c7
  Scenario: A login too long for one command line is not sent
    Given a login whose AUTH line would pass 512 octets
    When submit runs
    Then every recipient is refused at stage auth, code null, not final, and no AUTH command was written

  @criterion-FR-MAIL-025-c8
  Scenario: A refusal at RCPT is that recipient's alone
    Given RCPT answers 550 for the first of three recipients and 451 for the second
    When submit runs
    Then the first is refused with final true, the second with final false, and the third is accepted after the message

  @criterion-FR-MAIL-025-c9
  Scenario: A connection closed during RCPT refuses all but those already refused
    Given the connection closes after the second of three RCPT commands, the first having been refused
    When submit runs
    Then the first keeps its own refusal and the others are refused at stage rcpt, code null, text connection closed, not final

  @criterion-FR-MAIL-025-c10
  Scenario: With no recipient accepted, no message is sent
    Given RCPT refuses every recipient
    When submit runs
    Then QUIT is written, and DATA is not

  @criterion-FR-MAIL-025-c11
  Scenario: Any 2yz at the terminator is accepted
    Given the terminator is answered with 250, then in another session with 251 and with 200
    When submit runs
    Then every recipient RCPT accepted is accepted, with providerId null and the reply's text

  @criterion-FR-MAIL-025-c12
  Scenario: At the terminator 4yz is not final and 5yz is final
    Given the terminator is answered with 451, then in another session with 554
    When submit runs
    Then those recipients are refused at stage data, not final and then final

  @criterion-FR-MAIL-025-c13
  Scenario: Any other reply at the terminator is unknown
    Given the terminator is answered with 354
    When submit runs
    Then those recipients are unknown, with detail unexpected reply: 354 and the text

  @criterion-FR-MAIL-025-c14
  Scenario: A connection really lost after the terminator is unknown
    Given a node:net server destroying its socket after reading the terminator
    When submit runs over a real socket
    Then those recipients are unknown, with detail connection lost after the message began

  @criterion-FR-MAIL-025-c15
  Scenario: A connection really lost during the message is unknown, not a throw
    Given a node:net server destroying its socket while a large message is being written
    When submit runs over a real socket
    Then submit returns those recipients as unknown

  @criterion-FR-MAIL-025-c16
  Scenario: A server silent at QUIT does not delay a known result
    Given a server answering 250 at the terminator and never answering QUIT, and a deadline the test holds
    When submit runs with a quitWaitMs of 60000, and once QUIT is written the test fires the 60000 ms the deadline was asked for
    Then it returns accepted, with no real time passing

  @criterion-FR-MAIL-025-c17
  Scenario: close can neither replace nor lose a result
    Given a close that throws, and one that never resolves
    When submit runs to an accepted result
    Then accepted is returned in both

  @criterion-FR-MAIL-025-c18
  Scenario: Replies are read as RFC 5321 4.2.1 says
    Given a reply of 2500 x before the message, and a multi-line reply whose lines have different codes
    When submit runs
    Then the first counts as a closed connection, and the second's code is its last line's

  @criterion-FR-MAIL-025-c19
  Scenario: A line or write that throws before the message counts as a closed connection
    Given a connection whose line or write throws during MAIL FROM
    When submit runs
    Then every recipient is refused at stage mail, code null, not final

  @criterion-FR-MAIL-025-c20
  Scenario: Stuffing doubles a period at the start and after each CRLF, and ends the data
    Given bytes beginning with a period, holding CRLF then a period, and holding a period mid-line
    When stuff runs
    Then only the first two gain a period, and the result ends in a period and CRLF

  @criterion-FR-MAIL-025-c21
  Scenario: A failure to open is a refusal
    Given an open that throws an Error, then one that throws a string
    When smtpTransport sends
    Then every recipient is refused at stage connect, code null, not final, with the message, then with String of the value
