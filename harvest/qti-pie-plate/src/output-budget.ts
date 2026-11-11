/**
 * The output budget's default and its largest value, and the clamp that holds a budget between 1
 * and that value, in a module of their own.
 *
 * `configuration.ts`'s Schema reads both values, and `redactItem` reads the default, the budget a
 * redaction runs under when its caller passes none, and the clamp, which holds the budget it is
 * passed. They live apart from `configuration.ts`, which value-imports Schema, so that `redact` and
 * `render`, browser modules, read them without loading the Schema side. This module imports
 * nothing.
 *
 * @module
 */

/**
 * The output budget a configuration holds when the host sets none, and the one a redaction runs
 * under when its caller passes none: 16,777,216 characters (16 MiB of ASCII), counted as a
 * string's `length` counts them (UTF-16 code units).
 */
export const defaultOutputBudget = 16_777_216;

/**
 * The largest output budget a configuration admits: 536,870,888 characters, V8's longest string,
 * the smallest of the engines' limits, so no budget asks an engine for a string it cannot build.
 */
export const maximumOutputBudget = 536_870_888;

/**
 * Hold an output budget to the range a configuration admits, 1 to {@link maximumOutputBudget}, so
 * the bound holds whatever number a host passes, not only one `configure` decoded.
 *
 * `NaN` becomes {@link defaultOutputBudget}, as no budget does. A finite fraction becomes its floor
 * first. Anything above the maximum, `Infinity` included, becomes the maximum, and anything below
 * 1, `-Infinity`, 0 and a fraction below 1 included, becomes 1. A whole budget in the range is held
 * as given.
 *
 * @param budget The output budget a host passed.
 * @returns A whole number of characters from 1 to {@link maximumOutputBudget}.
 */
export const clampOutputBudget = (budget: number): number =>
  Number.isNaN(budget)
    ? defaultOutputBudget
    : Math.min(maximumOutputBudget, Math.max(1, Math.floor(budget)));
