/**
 * The signed 64-bit range of the count attributes reading 46 names, in a module of its own.
 *
 * The model builder and the structural walk refuse a `max-choices` or `min-choices` outside it
 * (`count-range`), and `decodeRedacted` bounds a payload's counts by it. It lives apart from
 * `vocabulary.ts` so that `decodeRedacted` loads none of the vocabulary's tables, which it has no
 * other use for.
 *
 * @module
 */

/**
 * The least value a count attribute reading 46 names may hold, -2^63, the low end of the signed
 * 64-bit range a `count-range` refusal names.
 */
export const leastCount = -9_223_372_036_854_775_808n;

/**
 * The greatest value a count attribute reading 46 names may hold, 2^63-1: such a count holds a
 * signed 64-bit value, read exactly, and a greater one is refused (operator ruling D, 2026-11-04).
 */
export const greatestCount = 9_223_372_036_854_775_807n;
