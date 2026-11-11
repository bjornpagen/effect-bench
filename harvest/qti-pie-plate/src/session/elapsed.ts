/**
 * The seconds a test session has run, in a module that loads no other, so the session's
 * transitions and its results measure a test's `duration` the same way.
 *
 * `#plate/session/submit.ts` reads it for the test scope's `duration` at each outcome run, and
 * `#plate/results/results.ts` for the `duration` a test result reports.
 *
 * @module
 */

/**
 * Give the seconds between two times, truncated to a tenth of a second, and 0 when the second is
 * not later than the first: the test's `duration` from the session's start to a time.
 *
 * @param from The earlier time, in milliseconds since the epoch, such as a session's `started`
 *   read by `Date.parse`.
 * @param to The later time, in milliseconds since the epoch.
 * @returns The seconds between them.
 */
export const elapsedSeconds = (from: number, to: number): number =>
  Math.max(Math.trunc((to - from) / 100) / 10, 0);
