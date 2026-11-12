# Generated from legion requirement FR-MAIL-030, revision 2026-11-06T01:13:01.844426+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A second Worker hears what happened

  @criterion-FR-MAIL-030-c1
  Scenario: The Worker has fetch and queue alone
    Given sendingWorker's result
    When its keys are read
    Then they are exactly fetch and queue

  @criterion-FR-MAIL-030-c2
  Scenario: An authentic webhook is recorded and answered 200
    Given a handler returning two events
    When POST /webhooks/resend arrives
    Then both are recorded, and the answer is 200

  @criterion-FR-MAIL-030-c3
  Scenario: A request not authentic is 401, recording nothing
    Given a handler returning null
    When POST /webhooks/resend arrives
    Then the answer is 401, and no row was written

  @criterion-FR-MAIL-030-c4
  Scenario: Any other request is 404
    Given a key not registered, the key constructor, a GET and another path
    When fetch runs
    Then each answers 404

  @criterion-FR-MAIL-030-c5
  Scenario: A failure reaches the provider
    Given a handler or port that throws
    When fetch runs
    Then it throws

  @criterion-FR-MAIL-030-c6
  Scenario: A queue retries only what failed
    Given a batch of a good event, an untracked type and a malformed event
    When queue runs
    Then the first is recorded and acked, the second acked with nothing recorded, and only the third retried

  @criterion-FR-MAIL-030-c7
  Scenario: Cloudflare's six documented events map exactly
    Given the documented delivered, deferred, bounced, failed, rejected and complained examples, verbatim
    When fromCloudflare runs
    Then each has the form's kind, eventId, providerId, recipient, at, permanent and detail, and messageId null

  @criterion-FR-MAIL-030-c8
  Scenario: smtp is null where Cloudflare gives none
    Given the failed, rejected and complained examples
    When fromCloudflare runs
    Then smtp is null, and it is the three fields on the others

  @criterion-FR-MAIL-030-c9
  Scenario: A type not tracked returns null, and a malformed event throws
    Given another type, the type cf.email.sending.message.constructor, and a bounced event with no payload
    When fromCloudflare runs
    Then the first two return null, and the third throws a ZodError

  @criterion-FR-MAIL-030-c10
  Scenario: A redelivered event adds no row
    Given an event recorded once
    When it is recorded again
    Then there is one row
