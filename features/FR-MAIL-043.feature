# Generated from legion requirement FR-MAIL-043, revision 2026-11-06T01:13:03.305699+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: One object per connection, with a message held only in memory

  @criterion-FR-MAIL-043-c1
  Scenario: 354 goes out after data is saved
    Given a fake state recording order
    When DATA runs
    Then the save comes before the 354

  @criterion-FR-MAIL-043-c2
  Scenario: A stall in DATA keeps the message
    Given a timer held while in data, and a stall
    When the rest of the message arrives
    Then the message is answered, and the timer has ended

  @criterion-FR-MAIL-043-c3
  Scenario: Nothing of a message reaches storage
    Given a message with a marker in it
    When every write is read
    Then none holds the marker

  @criterion-FR-MAIL-043-c4
  Scenario: A frame moves the idle alarm, and passing it closes
    Given a session in DATA receiving frames, and one silent
    When 300 seconds pass
    Then the first stays open, and the second answers 421 Idle and closes

  @criterion-FR-MAIL-043-c5
  Scenario: It ends as the IMAP object does
    Given a QUIT, a client close, a store failure and a login never made
    When the session ends
    Then it calls deleteAll, and a call finishing afterward saves and sends nothing

  @criterion-FR-MAIL-043-c6
  Scenario: The Worker reaches it
    Given /submit with a good secret and with none
    When fetch runs
    Then it reaches a new object, and answers 401

  @criterion-FR-MAIL-043-c7
  Scenario: The bridge carries a second listener
    Given a connection on each listener
    When each opens
    Then each reaches its own target, with the caps shared

  @criterion-FR-MAIL-043-c8
  Scenario: The bridge refuses a bad second target
    Given no TARGET_URL_SUBMIT, and ws:// off loopback
    When it starts
    Then it exits with a message naming the setting
