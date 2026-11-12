# Generated from legion requirement NFR-MAIL-002, revision 2026-11-07T04:46:19.658332+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Every line of code is there for a reason a test shows

  @criterion-NFR-MAIL-002-c1
  Scenario: Every scenario is owned by exactly one test, and no test is declared another way
    Given text held in the guard's own test: a feature with a scenario that has no criterion tag, one with two criterion tags, one whose tag no test owns, one whose tag two step files own, one whose tag a Rust test named for it owns, one with a step holding an unbalanced parenthesis, and one that says a step twice; a step file owning an id no feature tags; a feature that features/pending.json lists whose header names another revision, and one whose regenerating issue's own requirement has a feature; a file under packages/x/tests/ named a.test.ts; and a step file that declares a bare it test
    When the guard reads them
    Then it names the untagged scenario, the twice-tagged one, the unowned tag, the twice-owned tag, the unbalanced step, the repeated step, the stray id, both pending features, the .test.ts file and the bare it test, and not the tag the Rust test owns
    When the guard reads features/, features/pending.json, every .steps.ts and .workerd.ts file under packages/*/tests/, and bridge/src
    Then it names nothing, and neither packages/core/tests/criteria.json nor packages/core/tests/criterion.ts exists
