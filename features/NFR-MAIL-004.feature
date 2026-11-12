# Generated from legion requirement NFR-MAIL-004, revision 2026-11-07T04:46:19.793237+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Tests control time and never measure it

  @criterion-NFR-MAIL-004-c1
  Scenario: No test file reads a measuring clock, subtracts from the wall clock or waits a set time without a marker
    Given test text held in the check's own test: a line that reads performance.now(), one that subtracts Date.now(), one that calls setTimeout with no marker, one that calls setTimeout marked no-timing: fake timers, one that calls setTimeout marked no-timing: event wait, one that reads performance.now() marked no-timing: recorded, never asserted, one that fires a deadline the test holds, and one that passes a timeout to criterion
    When the check reads it as a .test.ts file, as a .steps.ts file and as a .workerd.ts file
    Then each time it names the first four lines by line number, and none of the others
    When the check reads every git-tracked test file under packages/*/tests/ but its own
    Then it names no line

  @criterion-NFR-MAIL-004-c2
  Scenario: A benchmark file records numbers and asserts nothing
    Given text held in the check's own test as a .bench.ts file: one that reads performance.now() and logs it with a comment saying it asserts nothing, and one that also calls expect
    When the check reads them
    Then the first passes, and the second fails naming its expect line
    When the check reads every git-tracked .bench.ts file under packages/*/tests/
    Then it names no line

  @criterion-NFR-MAIL-004-c3
  Scenario: workerd's unsafe module stays in tests
    Given text held in the check's own test: a source file that imports workerd:unsafe, one that builds the specifier from workerd and unsafe on one line, one that names workerd:unsafe only in a comment, and a wrangler.jsonc outside packages/*/tests/ that names unsafe_module
    When the check reads them
    Then it names the first, the second and the fourth, and not the third
    When the check reads the repository's git-tracked files
    Then it names none

  @criterion-NFR-MAIL-004-c5
  Scenario: No test file uses fake timers
    Given test text held in the check's own test: a line that calls vi.useFakeTimers, one that calls vi.setSystemTime, one that calls vi.advanceTimersByTimeAsync and one that enables mock.timers from node:test, each marked no-timing: hang guard, and one that advances a manual clock the test owns
    When the check reads it as a .test.ts file, as a .steps.ts file and as a .workerd.ts file
    Then each time it names the first four lines by line number, marker or not, and not the fifth
    When the check reads every git-tracked test file under packages/*/tests/ but its own
    Then it names no line
