# Generated from legion requirement FR-MAIL-028, revision 2026-11-06T01:13:01.609677+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Resend's settings and webhooks, believed only when authentic

  @criterion-FR-MAIL-028-c1
  Scenario: The settings are exactly Resend's
    Given the published names
    When RESEND_SMTP and resendLogin are read
    Then they give smtp.resend.com, 465, the user resend and the key as password

  @criterion-FR-MAIL-028-c2
  Scenario: A good signature passes, in any list position
    Given a signature built with Web Crypto, alone and second in a space-delimited list
    When verifyWebhook runs
    Then it returns true

  @criterion-FR-MAIL-028-c3
  Scenario: Anything else fails without throwing
    Given a changed byte, a timestamp over 300 seconds away, a non-digit timestamp, each header missing, only a v2 entry, and undecodable base64
    When verifyWebhook runs
    Then each returns false

  @criterion-FR-MAIL-028-c4
  Scenario: A malformed secret throws
    Given a secret of whsec_ with nothing after it, and one with invalid base64
    When verifyWebhook runs
    Then it throws

  @criterion-FR-MAIL-028-c5
  Scenario: Resend's documented bounce maps exactly
    Given the documented email.bounced sample, verbatim
    When fromResend runs
    Then there is one event with the top-level created_at, the unbracketed Message-ID, email_id as providerId, permanent true, smtp null and detail Suppressed and its message

  @criterion-FR-MAIL-028-c6
  Scenario: Failed, suppressed and diagnostics reach detail
    Given the documented email.failed and email.suppressed samples, and a bounce with diagnosticCode
    When fromResend runs
    Then detail holds failed.reason, the suppressed type and message, and the diagnostics joined

  @criterion-FR-MAIL-028-c7
  Scenario: Each tracked type maps to its kind
    Given email.delivered, email.delivery_delayed and email.complained
    When fromResend runs
    Then the kinds are delivered, delayed and complained, with detail null

  @criterion-FR-MAIL-028-c8
  Scenario: A type not tracked returns nothing, whatever its data
    Given email.opened, email.sent, contact.created with its own shape, and constructor
    When fromResend runs
    Then each returns an empty list

  @criterion-FR-MAIL-028-c9
  Scenario: A malformed tracked event throws
    Given email.bounced with no data.to
    When fromResend runs
    Then it throws a ZodError

  @criterion-FR-MAIL-028-c10
  Scenario: One event per listed recipient, under the delivery's id
    Given an event listing two recipients, with the svix-id x
    When fromResend runs
    Then there are two events, each with eventId x
