// The code teaches how email works (NFR-MAIL-003): what each package's own teaching check finds.

/**
 * One package's teaching check, as its `tests/citations.ts` exports it. Each function runs that package's
 * check as its teaching test ran it at b4953c9, with its own table, walk and patterns, and gives one line per
 * thing wrong, or [] when nothing is.
 */
export type Teaching = {
  /** The package's folder under packages/, which prefixes each line. */
  name: string;
  /** NFR-MAIL-003-c1: a file missing from the table, or whose opening comment lacks its citation or a quoted rule. */
  openings: () => string[];
  /** NFR-MAIL-003-c1: a table entry for a file the package does not have. packages/core's check has none, so it gives []. */
  stale: () => string[];
  /** NFR-MAIL-003-c2: a function declaration, as the package's own pattern finds one, with no doc comment above it. */
  undocumented: () => string[];
};
