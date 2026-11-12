# Generated from legion requirement FR-MAIL-006, revision 2026-11-06T01:12:59.033617+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: A date is read only when it is a real date

  @criterion-FR-MAIL-006-c1
  Scenario: The obsolete date of RFC 5322 A.6.2 is read as 21 November 1997, 09:55:06 Universal Time
    Given the RFC 5322 Appendix A.6.2 message dated "21 Nov 97 09:55:06 GMT"
    When mail reads its date
    Then the instant is 1997-11-21 09:55:06 UTC and the zone is Universal Time

  @criterion-FR-MAIL-006-c2
  Scenario: The obsolete date of RFC 5322 A.6.3 is read as 21 November 1997, 15:55:06 Universal Time
    Given the RFC 5322 Appendix A.6.3 message with comments and spaces inside its date
    When mail reads its date
    Then the instant is 1997-11-21 15:55:06 UTC and the zone is six hours behind Universal Time

  @criterion-FR-MAIL-006-c3
  Scenario: The folded date of RFC 5322 A.5 is read as 14 February 1969, 03:02:00 Universal Time
    Given the RFC 5322 Appendix A.5 message dated 13 Feb 1969 23:32 -0330 over several lines
    When mail reads its date
    Then the instant is 1969-02-14 03:02:00 UTC

  @criterion-FR-MAIL-006-c4
  Scenario: A date of 30 February has no instant and records an invalid-date problem
    Given a message dated "Mon, 30 Feb 2026 10:00:00 +0000"
    When mail reads its date
    Then the date has no instant, its text is kept, and an invalid-date problem is recorded

  @criterion-FR-MAIL-006-c5
  Scenario: A date whose day of the week does not match has no instant and records an invalid-date problem
    Given a message dated "Fri, 2 Mar 2026 10:00:00 +0000", a Monday
    When mail reads its date
    Then the date has no instant, its text is kept, and an invalid-date problem is recorded

  @criterion-FR-MAIL-006-c6
  Scenario: A date whose zone minutes are over 59 has no instant and records an invalid-date problem
    Given a message dated "Mon, 2 Mar 2026 10:00:00 +0060"
    When mail reads its date
    Then the date has no instant, its text is kept, and an invalid-date problem is recorded

  @criterion-FR-MAIL-006-c7
  Scenario: A date in zone -0000 keeps its instant and an unknown zone
    Given a message dated "Mon, 2 Mar 2026 10:00:00 -0000"
    When mail reads its date
    Then the instant is 2026-03-02 10:00:00 UTC and the zone is unknown, not Universal Time

  @criterion-FR-MAIL-006-c8
  Scenario: A date in a military zone keeps an unknown zone
    Given a message dated "Mon, 2 Mar 2026 10:00:00 Z"
    When mail reads its date
    Then the zone is unknown

  @criterion-FR-MAIL-006-c9
  Scenario: A two-digit year under 50 is in the 2000s, and a named US zone is applied
    Given the date "2 Mar 26 10:00 EST"
    When mail reads it
    Then its instant is 2026-03-02T15:00:00Z and its zone "EST"

  @criterion-FR-MAIL-006-c10
  Scenario: A three-digit year adds 1900
    Given the date "2 Mar 126 10:00 +0000"
    When mail reads it
    Then its instant is 2026-03-02T10:00:00Z

  @criterion-FR-MAIL-006-c11
  Scenario: An hour of 24 is not a time of day
    Given the date "2 Mar 2026 24:00 +0000"
    When mail reads it
    Then it has no instant and the problem "not a time of day"

  @criterion-FR-MAIL-006-c12
  Scenario: Text that is not a date, or an empty Date, has no instant and is unreadable
    Given the fixture r10-unclosed (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures) and the fixture r11-edges (goldens.01a19b44-5fe5-7342-bb90-85b91511d33d body.fixtures)
    When mail reads it
    Then each Date has no instant and an unparsed-value problem

  @criterion-FR-MAIL-006-c13
  Scenario: A leap second is the first second of the next minute
    Given the date "Sat, 31 Dec 2016 23:59:60 +0000"
    When mail reads it
    Then its instant is 2017-01-01T00:00:00Z

  @criterion-FR-MAIL-006-c14
  Scenario: A four-digit year under 100 is that year
    Given the date "1 Jan 0049 00:00 +0000"
    When mail reads it
    Then its instant is in the year 49

  @criterion-FR-MAIL-006-c15
  Scenario: A signed zone that is not four digits is no date
    Given the date "2 Mar 2026 10:00 +05"
    When mail reads it
    Then it has no instant and the problem "not a date"

  @criterion-FR-MAIL-006-c16
  Scenario: A named zone is kept as written
    Given the date "2 Mar 2026 10:00 Gmt"
    When mail reads it
    Then its instant is 2026-03-02T10:00:00Z and its zone "Gmt"
