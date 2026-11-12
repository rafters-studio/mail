# Generated from legion requirement FR-MAIL-049, revision 2026-11-06T01:12:57.653784+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Revoking a mailbox ends every session logged in to it

  @criterion-FR-MAIL-049-c1
  Scenario: A session registers when it logs in, before it is told so
    Given a client that sends LOGIN with a correct password and has not selected
    When the session answers OK
    Then the session's name is registered with the account's mailbox, and the registration completed before the OK was sent

  @criterion-FR-MAIL-049-c2
  Scenario: A registration that fails gives no login
    Given the mailbox rejects a registration at login
    When a client sends IMAP LOGIN or submission AUTH with a correct password
    Then the client gets no success reply, the socket closes with 1011, and the session's state is deleted

  @criterion-FR-MAIL-049-c3
  @local
  Scenario: Revoking closes every logged-in IMAP session, evicted or not
    Given four IMAP sessions on one mailbox, one selected, one in IDLE, one logged in and unselected, and one logged in with another valid password, each evicted by the test with workerd's evict, its socket kept hibernating, after the session's last reply was read
    When revoke runs on that mailbox
    Then each client receives * BYE credential revoked and its socket closes, and the constructor count of each session object rose

  @criterion-FR-MAIL-049-c4
  @local
  Scenario: Revoking closes every logged-in submission session, evicted or not
    Given two logged-in submission sessions on the same mailbox, one with another valid password, each evicted by the test with workerd's evict, its socket kept hibernating, after the session's last reply was read
    When revoke runs on that mailbox
    Then each client receives 421 Credential revoked and its socket closes, and the constructor count of each session object rose

  @criterion-FR-MAIL-049-c5
  @local
  Scenario: Revoke reports what it did, and another valid password can reconnect
    Given the four IMAP sessions and two submission sessions of the scenarios above
    When revoke returns
    Then it gives told 6, closed 6 and failed 0, the mailbox holds no registered name, and a client logging in again with the other valid password selects and fetches the seeded message

  @criterion-FR-MAIL-049-c6
  Scenario: A message still being uploaded is dropped
    Given a submission session inside DATA with a message partly received
    When revoked runs
    Then the client receives 421 Credential revoked, its socket closes, the message is not handed to the binding, and the hold timer is cleared

  @criterion-FR-MAIL-049-c7
  Scenario: A message already handed to the binding is not recalled
    Given a submission session whose message has been handed to the binding and has not been answered
    When revoked runs and the binding then answers
    Then nothing throws, no further reply is sent, and nothing is written back to the session's state

  @criterion-FR-MAIL-049-c8
  Scenario: A logged-in unselected session hears nothing of a change
    Given a logged-in unselected IMAP session
    When the mailbox tells its sessions of a change
    Then changed gives true, the client receives no bytes, and the socket stays open

  @criterion-FR-MAIL-049-c9
  Scenario: Telling reaches IMAP sessions alone
    Given a mailbox with both an IMAP session and a submission session registered
    When it tells its sessions of a change
    Then changed is called only for the IMAP session, no call goes through the IMAP session namespace with the submission session's name, and no tell stays owed

  @criterion-FR-MAIL-049-c10
  Scenario: A submission session that ends forgets its name
    Given a logged-in submission session
    When it ends by QUIT, by the client closing, or by its idle alarm, and again when the forget rejects
    Then its name is no longer registered with the mailbox; and when the forget rejects, the failure is logged and the session's state is still deleted

  @criterion-FR-MAIL-049-c11
  Scenario: A connection that has not logged in is not touched
    Given a connection that has not logged in, and a mailbox with no registered session
    When revoke runs, and runs again after a first that closed every session
    Then that connection is not told and stays open, and revoke gives told 0, closed 0 and failed 0

  @criterion-FR-MAIL-049-c12
  Scenario: A session that does not answer counts as failed and is told again
    Given one registered session that never answers revoked and one that answers, with revoke's bound held by the test
    When revoke runs, and the test reads the bound revoke asked for and fires it
    Then the bound asked for is 10 seconds, revoke gives told 2, closed 1 and failed 1 and logs the failure, the unanswering name stays registered, and a later revoke, its bound fired the same way, tells it again

  @criterion-FR-MAIL-049-c13
  Scenario: A name with no socket goes
    Given a registered IMAP name and a registered submission name whose revoked each gives 0 because the object has no socket
    When revoke returns
    Then both names are no longer registered, and they count in told and not in failed

  @criterion-FR-MAIL-049-c14
  Scenario: A Worker with no submission binding still closes its IMAP sessions
    Given a mailbox whose Worker binds no submission namespace and which holds a registered submission name
    When revoke runs
    Then its IMAP sessions still close, the name counts in failed, and the failure is logged

  @criterion-FR-MAIL-049-c17
  Scenario: Registering at login adds to what SELECT does
    Given a name the mailbox was never told to register
    When open runs for INBOX with that name
    Then the name is registered
