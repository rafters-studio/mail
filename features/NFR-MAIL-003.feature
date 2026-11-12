# Generated from legion requirement NFR-MAIL-003, revision 2026-11-07T04:46:20.004316+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: The code teaches how email works

  @criterion-NFR-MAIL-003-c1
  Scenario: Every source file begins with its concept, the citation the form gives it, and a quoted rule
    Given the source files of every package the teaching step lists, packages/core/src, packages/cloudflare/src, packages/cloudflare/migrations and packages/resend/src among them, and the citation its package's table gives each
    When the teaching step reads each file's opening comment
    Then each file is in its package's table, and its opening comment holds that citation and a double-quoted sentence of at least 20 characters
    And every table but packages/core's names no file its package does not have

  @criterion-NFR-MAIL-003-c2
  Scenario: Every function has a doc comment saying the rule it carries out
    Given the source files of every package the teaching step lists
    When the teaching step finds each function declaration, as its package's own pattern finds them
    Then a doc comment ends on the line above each
