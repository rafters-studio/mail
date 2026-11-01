// The impure inputs the tests give createMail, so every written message is the same bytes on
// every run (form 01a18fda, Tests).

/** Fills each request from a counter that starts at 0: the nth byte drawn is n mod 256. Make one per createMail. */
export function createRandom(): (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> {
  let count = 0;
  return (into) => {
    for (let i = 0; i < into.length; i++) into[i] = count++ % 256;
    return into;
  };
}

/** The clock every test reads: 2026-03-02T17:00:00Z. */
export function now(): Date {
  return new Date("2026-03-02T17:00:00Z");
}
