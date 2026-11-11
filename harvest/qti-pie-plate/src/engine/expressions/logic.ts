/**
 * The logic family of the engine: the evaluators of `qti-and`, `qti-or`, `qti-not` and
 * `qti-any-n`, each with the information model's three-valued rules, under which a NULL operand is
 * a truth not known.
 *
 * It value-imports only engine leaves, `#plate/model/values.ts` and `effect`'s `Option` and
 * `Result`, and reads the evaluator's types from `#plate/engine/evaluate.ts` as types, so the
 * dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluate, Evaluator, FamilyTable, Scope } from "#plate/engine/evaluate.ts";
import type { EngineFailure } from "#plate/engine/failures.ts";
import { booleanNull, booleanOf } from "#plate/engine/numbers.ts";
import { operandValues } from "#plate/engine/operands.ts";
import { referenceInteger } from "#plate/engine/refs.ts";
import type { Expression } from "#plate/model/expression.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * Give the truth an operand's value holds: the boolean of a single boolean, none for NULL.
 *
 * Every operand of a logic kind is a single boolean on a checked item: the validator refuses any
 * other (P23). One that is not is counted as NULL, a truth not known, never as true or false.
 *
 * @param value The operand's value.
 * @returns The boolean, or none when the value is NULL or not a single boolean.
 */
const truthOf = (value: Value): Option.Option<boolean> => {
  const [single, ...rest] = value.values;

  return value.cardinality === "single" && rest.length === 0 && single?.baseType === "boolean"
    ? Option.some(single.value)
    : Option.none();
};

/**
 * How many of an expression's operands are true, false and NULL.
 */
interface Tally {
  readonly falses: bigint;
  readonly nulls: bigint;
  readonly trues: bigint;
}

/**
 * Evaluate every operand and count its truths.
 *
 * Every operand is evaluated, left to right ({@link operandValues}), and the first failure is the
 * result, so a later operand's failure is not hidden by an earlier false. No operand is skipped
 * once the value is known, as a short-circuit would skip it: a skipped operand would draw nothing,
 * which would change the values a seed gives every later draw of the run (OD-3).
 *
 * @param operands The operands.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The counts, or the first operand's failure.
 */
const tallyOf = (
  operands: readonly Expression[],
  scope: Scope,
  evaluate: Evaluate,
): Result.Result<Tally, EngineFailure> =>
  Result.map(operandValues(operands, scope, evaluate), (values): Tally => {
    const truths = values.map((value) => truthOf(value));

    return {
      falses: BigInt(truths.filter((truth) => Option.contains(truth, false)).length),
      nulls: BigInt(truths.filter((truth) => Option.isNone(truth)).length),
      trues: BigInt(truths.filter((truth) => Option.contains(truth, true)).length),
    };
  });

/**
 * Give the value of a `qti-and`: a single boolean, true when every operand is true. It is false
 * when any operand is false, whatever the others are, and NULL when some are NULL and the rest
 * true.
 *
 * @param expression The `qti-and`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpAnd
 */
const evaluateAnd: Evaluator<"and"> = (expression, scope, evaluate) =>
  Result.map(tallyOf(expression.operands, scope, evaluate), ({ falses, nulls }) => {
    if (falses > 0n) {
      return booleanOf(false);
    }

    return nulls > 0n ? booleanNull : booleanOf(true);
  });

/**
 * Give the value of a `qti-or`: a single boolean, true when any operand is true, whatever the
 * others are. It is false when every operand is false, and NULL when some are NULL and the rest
 * false.
 *
 * @param expression The `qti-or`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpOr
 */
const evaluateOr: Evaluator<"or"> = (expression, scope, evaluate) =>
  Result.map(tallyOf(expression.operands, scope, evaluate), ({ nulls, trues }) => {
    if (trues > 0n) {
      return booleanOf(true);
    }

    return nulls > 0n ? booleanNull : booleanOf(false);
  });

/**
 * Give the value of a `qti-not`: a single boolean, the negation of its operand; NULL when the
 * operand is NULL.
 *
 * @param expression The `qti-not`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single boolean, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpNot
 */
const evaluateNot: Evaluator<"not"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) =>
    Option.match(truthOf(value), {
      onNone: () => booleanNull,
      onSome: (held) => booleanOf(!held),
    }),
  );
};

/**
 * Give the truth of a `qti-any-n` from its operands' counts and its bounds, by the information
 * model's three-valued rule, over `t` true, `f` false and `u` NULL operands of `n`:
 *
 * - False when `f > n − min`, so fewer than `min` can be true, or `t > max`, so more than `max` are;
 * - True when `t ≥ min` and `t + u ≤ max`, so the count is in range whatever the NULLs are;
 * - NULL otherwise.
 *
 * With `min` 3 and `max` 4 it gives NULL for {T,T,F,NULL}, false for {T,F,F,NULL} and true for
 * {T,T,T,NULL}, the information model's examples. The counts and the bounds are exact integers, so
 * no bound is too large to compare.
 *
 * @param tally The operands' counts.
 * @param min The least number of true operands.
 * @param max The greatest number of true operands.
 * @returns The single boolean.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpAnyN
 */
const anyNOf = ({ falses, nulls, trues }: Tally, min: bigint, max: bigint): Value => {
  if (falses > falses + nulls + trues - min || trues > max) {
    return booleanOf(false);
  }

  return trues >= min && trues + nulls <= max ? booleanOf(true) : booleanNull;
};

/**
 * Give the value of a `qti-any-n`: a single boolean, whether at least `min` and at most `max` of
 * its operands are true ({@link anyNOf}); NULL when a bound names a variable that holds NULL.
 *
 * The bounds are resolved first, `min` then `max`, as the item model's walks visit them before the
 * operands, then every operand is evaluated left to right; the first failure is the result.
 *
 * @param expression The `qti-any-n`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first failure of a bound or an operand.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpAnyN
 */
const evaluateAnyN: Evaluator<"any-n"> = (expression, scope, evaluate) =>
  Result.gen(function* countAnyN() {
    const min = yield* referenceInteger(scope.variables, expression.min);
    const max = yield* referenceInteger(scope.variables, expression.max);
    const tally = yield* tallyOf(expression.operands, scope, evaluate);

    return Option.match(Option.all([min, max]), {
      onNone: () => booleanNull,
      onSome: ([least, greatest]) => anyNOf(tally, least, greatest),
    });
  });

/**
 * The logic family's evaluators by kind.
 */
export const logicEvaluators: FamilyTable<"and" | "any-n" | "not" | "or"> = {
  and: evaluateAnd,
  "any-n": evaluateAnyN,
  not: evaluateNot,
  or: evaluateOr,
};
