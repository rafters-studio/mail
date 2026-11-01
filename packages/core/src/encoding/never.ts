// The end of an exhaustive switch (form 01a18fda, Craft): "Every `switch` or `if` chain over a
// union ends in `never(x)` from `encoding/never.ts`."

/** Ends a chain over a union: the compiler proves no member is left, so this never runs. */
export function never(x: never): never {
  throw new Error(`unexpected ${JSON.stringify(x)}`);
}
