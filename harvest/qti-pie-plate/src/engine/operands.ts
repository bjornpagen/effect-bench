/**
 * The order the expression families evaluate a list of operands in, a leaf they share: every
 * operand, left to right ({@link operandValues}).
 *
 * The order is part of the contract (OD-3): a random kind draws from the scope's one stream when it
 * is evaluated, so an operand evaluated out of order, or skipped, changes the values a seed gives
 * every later draw. A family that takes its operands as a fixed tuple evaluates them in the same
 * order by name. `qti-custom-operator` is the one exception: it evaluates none of its operands
 * (`evaluateCustomOperator` in `#plate/engine/expressions/text.ts`), so a random kind inside it
 * never draws.
 *
 * It value-imports only `Result` from `effect`, and reads the evaluator's types from
 * `#plate/engine/evaluate.ts` as types only, so every family may import it.
 *
 * @module
 */
import { Result } from "effect";
import type { Evaluate, Scope } from "#plate/engine/evaluate.ts";
import type { EngineFailure } from "#plate/engine/failures.ts";
import type { Expression } from "#plate/model/expression.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * Evaluate every operand, left to right, in the caller's scope, so each draws from the same stream
 * in order; the first failure is the result.
 *
 * An operand after a failing one is evaluated too. What it draws reaches no value: a failure ends
 * the processing run, and the one caller that goes on past a failure, a drawing `qti-repeat`
 * typing its operands, evaluates them against a stream of its own.
 *
 * @param operands The operands.
 * @param scope The item, the variables of the attempt and the stream.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The operands' values in order, or the failure of the leftmost operand that fails.
 */
export const operandValues = (
  operands: readonly Expression[],
  scope: Scope,
  evaluate: Evaluate,
): Result.Result<readonly Value[], EngineFailure> =>
  Result.all(operands.map((operand) => evaluate(operand, scope)));
