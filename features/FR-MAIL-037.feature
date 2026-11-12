# Generated from legion requirement FR-MAIL-037, revision 2026-11-06T01:13:02.541577+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A bridge carries octets from TCP to the Worker and knows nothing of IMAP

  @criterion-FR-MAIL-037-c1
  Scenario: Octets pass unchanged both ways
    Given a chunk split anywhere, and a 25 MiB message
    When they cross the bridge
    Then the bytes are identical, in frames of at most 1 MiB

  @criterion-FR-MAIL-037-c2
  Scenario: The PROXY line gives the address
    Given a line split byte by byte, sent with the first command, an IPv6 address and a mapped address
    When a connection opens
    Then X-Client-Address has the address, cut to /64 for IPv6, and the first command still arrives

  @criterion-FR-MAIL-037-c3
  Scenario: No line, a long line, or none in time closes the connection
    Given no PROXY line, one over 107 octets, and a connection silent past its wait for the line, a wait the test holds
    When each runs, and the test reads the silent one's wait and fires it
    Then it closes, the silent one's wait is 5 seconds, and the silent one counts against MAX_CONNECTIONS until its wait is fired

  @criterion-FR-MAIL-037-c4
  Scenario: It authenticates to the Worker
    Given a fake Worker
    When a connection opens
    Then it sends the bearer secret

  @criterion-FR-MAIL-037-c5
  Scenario: Either side closing closes both, after the last bytes
    Given a client close, a Worker close, and a reply followed by a close
    When each runs
    Then both sides close, and the reply's bytes arrive first

  @criterion-FR-MAIL-037-c6
  Scenario: A text frame closes both
    Given a text frame from the Worker
    When it arrives
    Then both sides close

  @criterion-FR-MAIL-037-c7
  Scenario: A silent connection is pinged
    Given a connection with no traffic, its ping wait held by the test
    When the test reads the wait and fires it, twice
    Then the wait is 30 seconds, a WebSocket ping is sent each time, and the connection stays open

  @criterion-FR-MAIL-037-c8
  Scenario: The caps refuse, and return slots
    Given connections past MAX_CONNECTIONS and MAX_PER_ADDRESS, then one closing
    When each arrives
    Then the excess closes, and a slot opens

  @criterion-FR-MAIL-037-c9
  Scenario: A Worker it cannot reach closes the connection
    Given an unreachable target
    When a connection opens
    Then it closes at once

  @criterion-FR-MAIL-037-c10
  Scenario: It refuses bad settings
    Given no TARGET_URL, no BRIDGE_SECRET, and ws:// off loopback
    When it starts
    Then it exits with a message naming the setting, and ws:// on loopback is accepted

  @criterion-FR-MAIL-037-c11
  Scenario: It logs no octets
    Given a session with a password in it
    When the log is read
    Then there is one line per connection and no octets
