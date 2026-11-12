# Generated from legion requirement FR-MAIL-038, revision 2026-11-06T01:13:02.652996+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: The Worker in front, and receiving announcing new mail

  @criterion-FR-MAIL-038-c1
  Scenario: The Worker answers in order
    Given another path, a bad secret, no upgrade, and a good request
    When fetch runs
    Then they answer 404, 401, 426, and reach a new session object

  @criterion-FR-MAIL-038-c2
  Scenario: Nothing authorizes with no secret
    Given BRIDGE_SECRET unset and empty, and the header Bearer undefined
    When fetch runs
    Then each answers 401

  @criterion-FR-MAIL-038-c3
  Scenario: An accept pings each mailbox
    Given IMAP_MAILBOX bound and two deliveries, one per email call, to two mailboxes
    When email runs
    Then ping is called on the mailbox each one accepted for

  @criterion-FR-MAIL-038-c4
  Scenario: A ping that throws still accepts
    Given a ping that throws
    When email runs
    Then the message is stored, the sender sees nothing, and it is logged

  @criterion-FR-MAIL-038-c5
  Scenario: With no binding nothing changes
    Given IMAP_MAILBOX unbound
    When email runs
    Then nothing is called and receiving behaves as before
