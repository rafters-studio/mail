# Generated from legion requirement FR-MAIL-035, revision 2026-11-02T20:54:27.729114+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: One hibernating object per connection, which saves before it sends

  @criterion-FR-MAIL-035-c1
  Scenario: It saves before it sends
    Given a fake state recording order
    When a command is received
    Then the write comes before the send

  @criterion-FR-MAIL-035-c2
  Scenario: A fresh instance continues the conversation
    Given a logged-in session with a selected mailbox and a partial command buffered
    When a new instance on the same state receives the rest
    Then it answers as the first would have

  @criterion-FR-MAIL-035-c3
  Scenario: A silent loop before login writes nothing, and the frame cap closes
    Given 1,000 NOOPs before login, one per frame, across fresh instances on one state, 100 to each, since the count is in memory, and 101 frames to one instance
    When they are received
    Then no row is written by the NOOPs, and frame 101 to one instance closes with 1000 and ends

  @criterion-FR-MAIL-035-c4
  Scenario: A long reply goes in small frames
    Given a 25 MiB reply
    When it is sent
    Then every frame is at most 1 MiB and the bytes are in order

  @criterion-FR-MAIL-035-c5
  Scenario: It is reached by its id, never by name
    Given a fake namespace telling idFromName from idFromString
    When a mailbox tells a session by its name
    Then the session with the socket is reached

  @criterion-FR-MAIL-035-c6
  Scenario: A session not logged in is closed by its alarm
    Given a session at the alarm, not logged in, one logged in, and one with no snapshot
    When the alarm fires
    Then the first closes with 1000 and ends, and the others stay as they are

  @criterion-FR-MAIL-035-c7
  Scenario: Ending tells the mailbox, then deallocates
    Given logout, a client close, a socket error, a fatal line and a store failure, each while selected
    When the session ends
    Then forget is called with the account from the account row before deleteAll

  @criterion-FR-MAIL-035-c8
  Scenario: A forget that rejects still deallocates
    Given a forget that rejects
    When the session ends
    Then it is logged and deleteAll runs

  @criterion-FR-MAIL-035-c9
  Scenario: A call finishing after the end does nothing
    Given a client closing during a receive
    When the receive finishes
    Then nothing is saved or sent

  @criterion-FR-MAIL-035-c10
  Scenario: A failure closes with 1011
    Given a store failure, and a save past 2 MB
    When a command is received
    Then the socket closes with 1011 and the session ends

  @criterion-FR-MAIL-035-c11
  Scenario: changed answers truthfully
    Given no socket, no snapshot, and a live session
    When changed is called
    Then the first two return false and close any socket, and the third returns true and sends what the session told

  @criterion-FR-MAIL-035-c12
  Scenario: A client address is required, and kept
    Given a request with no X-Client-Address, and one with it, then an eviction
    When fetch runs, and a login after waking
    Then the first answers 400, and the login uses the stored address

  @criterion-FR-MAIL-035-c13
  Scenario: A string frame is encoded
    Given a string message
    When it is received
    Then it is handled as its UTF-8 octets
