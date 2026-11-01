// A test exists for a criterion of the spec, never for a line (NFR-MAIL-002): "No test SHALL
// exist without a criterion behind it."
import { it } from "vitest";
import criteria from "./criteria.json" with { type: "json" };

const known: ReadonlySet<string> = new Set(criteria);

/** Declares the test of one spec criterion, named by its id; throws for an id the spec lacks. */
export function criterion(id: string, fn: () => unknown | Promise<unknown>): void {
  if (!known.has(id)) throw new Error(`${id} is not a criterion of the spec (tests/criteria.json)`);
  it(id, fn);
}
