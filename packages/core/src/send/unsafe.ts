// What an address may not hold (form 01a19d25): "It throws the same when the envelope `from` or
// any `to` holds a control character, space, `<` or `>`." An address is copied into a command line,
// so it cannot be allowed to hold a command line's own syntax. It has its own file so submission
// reads the same rule without pulling in the transports (form 01a19de8).

/** Form 01a19d25: what an address copied into a command line may not hold. */
export const UNSAFE_ADDRESS = /[\p{Cc} <>]/u;
