// A clock the test owns (NFR-MAIL-004): code takes `now` as a port and the test sets it; nothing patches the runtime's clock.
export type ManualClock = {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
  reset(): void;
};

/** Real time until the test sets it, then exactly what it set, until the test moves it or resets it. */
export function manualClock(): ManualClock {
  let held: number | undefined;
  return {
    now: () => held ?? Date.now(),
    set: (ms) => {
      held = ms;
    },
    advance: (ms) => {
      held = (held ?? Date.now()) + ms;
    },
    reset: () => {
      held = undefined;
    },
  };
}

/** The one clock the test worlds give their objects. */
export const clock = manualClock();
