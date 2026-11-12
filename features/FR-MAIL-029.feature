# Generated from legion requirement FR-MAIL-029, revision 2026-11-06T01:13:01.716345+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Sending through Cloudflare's binding, and a Workers socket as a connection

  @criterion-FR-MAIL-029-c1
  Scenario: One send per recipient, and one throw stops no other
    Given a binding that throws for the first of two recipients
    When bindingTransport sends
    Then both were attempted, in order, with the bytes unchanged, and there is one outcome each

  @criterion-FR-MAIL-029-c2
  Scenario: A code about this recipient or message is final
    Given each of E_RECIPIENT_SUPPRESSED, E_VALIDATION_ERROR, E_FIELD_MISSING, E_TOO_MANY_RECIPIENTS, E_TOO_MANY_ATTACHMENTS, E_CONTENT_TOO_LARGE and E_HEADER_NOT_ALLOWED
    When the binding throws it
    Then the outcome is refused, final, stage provider, code null, text the code and message

  @criterion-FR-MAIL-029-c3
  Scenario: A code about the account or the binding is not final
    Given each of E_RECIPIENT_NOT_ALLOWED, E_RATE_LIMIT_EXCEEDED, E_DAILY_LIMIT_EXCEEDED, E_SENDER_NOT_VERIFIED, E_SENDER_DOMAIN_NOT_AVAILABLE and E_ACCOUNT_SUSPENDED
    When the binding throws it
    Then the outcome is refused, not final

  @criterion-FR-MAIL-029-c4
  Scenario: Anything else thrown is unknown
    Given E_DELIVERY_FAILED, E_INTERNAL_SERVER_ERROR, E_NEW, constructor, a numeric code, no code, and a thrown string
    When the binding throws it
    Then the outcome is unknown, with detail the code or no code and the message or String of the value

  @criterion-FR-MAIL-029-c5
  Scenario: providerId is a non-empty string or null
    Given results with a messageId, with an empty one, with a number, and no object
    When bindingTransport sends
    Then the first gives that id and the others null, with text null

  @criterion-FR-MAIL-029-c6
  Scenario: make throwing is a refusal, since nothing was handed over
    Given a make that throws
    When bindingTransport sends
    Then the outcome is refused, stage provider, not final, and the binding was not called

  @criterion-FR-MAIL-029-c7
  Scenario: A socket is opened with TLS on, and its opening is bounded
    Given a fake Connect that opens, one whose opened rejects, and one whose opened never settles
    When socketConnection runs
    Then the options are secureTransport on and allowHalfOpen false, the first gives a Connection, and the others reject

  @criterion-FR-MAIL-029-c8
  Scenario: No package imports a Cloudflare runtime module
    Given the source of packages/cloudflare and packages/resend
    When it is read
    Then neither cloudflare:email nor cloudflare:sockets appears in an import
