# Generated from legion requirement FR-MAIL-042, revision 2026-11-06T01:13:03.187867+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Keeping what was sent, and hearing of a later bounce

  @criterion-FR-MAIL-042-c1
  Scenario: A send keeps its bytes and its link
    Given a message accepted
    When ports.submit runs
    Then the blob, a delivery row to mailbox/Sent with via submission, and a submissions row exist, and the mailbox is pinged

  @criterion-FR-MAIL-042-c2
  Scenario: A send refused entirely keeps nothing but its link
    Given every recipient refused
    When ports.submit runs
    Then there is no blob and no Sent row, and a submissions row exists

  @criterion-FR-MAIL-042-c3
  Scenario: A failure keeping never changes the reply
    Given a failing put, row and ping, each after an accepted send
    When ports.submit runs
    Then each returns the outcomes, and it is logged

  @criterion-FR-MAIL-042-c4
  Scenario: A crash after the send still ends with one Sent copy
    Given a crash at each step of Keeping, against the real createSender and d1Sends on node:sqlite
    When the same bytes are retried, past the running window
    Then each ends with the recipient sent to once and at most one Sent UID after a pull where any was accepted

  @criterion-FR-MAIL-042-c5
  Scenario: A retry answers from its row, in envelope order
    Given held rows accepted, final and unknown, in an order unlike the envelope, and a row for a recipient outside this envelope
    When ports.submit runs
    Then each recipient has its row's outcome in envelope order, and the outside row is left out

  @criterion-FR-MAIL-042-c6
  Scenario: A young unknown row says still sending, and tells nobody
    Given an unknown row younger and older than 900 seconds
    When ports.submit runs
    Then the younger is refused not final with the text still sending, and the older is unknown

  @criterion-FR-MAIL-042-c7
  Scenario: A later bounce tells the mailbox that sent it
    Given a bounced event found by provider_id, one found by visible id, and an address since moved to another mailbox
    When the worker handles it
    Then a notice reaches the mailbox in the submissions row each time

  @criterion-FR-MAIL-042-c8
  Scenario: Mail not from an app tells nobody
    Given a sends row with no submissions row, and a delayed event
    When the worker handles it
    Then no notice is delivered

  @criterion-FR-MAIL-042-c9
  Scenario: A repeated event adds no message, and each recipient is told
    Given an event delivered twice, and one event listing two recipients
    When the worker handles it and the mailbox pulls
    Then the first adds one UID and the second two

  @criterion-FR-MAIL-042-c10
  Scenario: An untraced event is retried, then logged
    Given an event with no row, younger and older than an hour, and a notice that fails
    When the worker handles it
    Then the younger throws, the older is logged, and the failed notice throws

  @criterion-FR-MAIL-042-c11
  Scenario: A later bounce needs its bindings
    Given a worker without MAIL_BLOBS or IMAP_MAILBOX
    When it handles an event
    Then it records as today and tells nobody

  @criterion-FR-MAIL-042-c12
  Scenario: Every mailbox has a Sent
    Given the migration run twice, and a mailbox made after it
    When a send runs
    Then rows are added once, there is no /Sent/Sent, and the later mailbox gets its Sent

  @criterion-FR-MAIL-042-c13
  Scenario: The binding decodes to one flat string
    Given 26 MB of 7-bit bytes
    When bindingTransport sends them
    Then the text equals the bytes, built without one element per byte

  @criterion-FR-MAIL-042-c14
  Scenario: mayUse follows the directory's own row
    Given a mailbox's own row, its tagged row, another mailbox's tagged row, a disabled row, and a catch-all
    When mayUse runs
    Then only the first two are true
