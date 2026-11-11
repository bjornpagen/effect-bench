/**
 * The integers family of the engine: the evaluators of `qti-integer-divide`,
 * `qti-integer-modulus`, `qti-integer-to-float`, `qti-gcd` and `qti-lcm`.
 *
 * Every integer is an exact `bigint` (reading 45), so each kind but `qti-integer-to-float`
 * computes exactly; `qti-integer-to-float` makes its float through the one conversion, `toFloat`,
 * which gives an integer beyond the largest finite float that float, of its sign. A NULL operand
 * gives the NULL of the kind's type before any other rule, so a NULL beside a zero operand of
 * `qti-lcm` gives NULL, not 0; a divisor of 0 gives NULL too. An operand that holds a value other
 * than an integer, which the validator refuses (P23) on a checked item, counts as NULL, as the
 * information model counts a value that is not numerical.
 *
 * `qti-lcm` is the one kind here that can grow past its operands, so its integer is held to
 * `integerBitBound` (`#plate/engine/numbers.ts`, the operator's ruling `afb7e648`): one of more
 * than 1,000,000 bits is the integer NULL. `qti-integer-divide`, `qti-integer-modulus` and
 * `qti-gcd` cannot grow past their operands, a quotient, a remainder and a common divisor being no
 * larger in magnitude than the dividend, the divisor and each operand that is not 0, so they are
 * not held to it and stay exact at any size their operands have.
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
import {
  boundedTimes,
  emptyProduct,
  floatNull,
  floatValue,
  integerNull,
  integerOf,
  integerValue,
  toFloat,
} from "#plate/engine/numbers.ts";
import type { PartialProduct } from "#plate/engine/numbers.ts";
import { operandValues } from "#plate/engine/operands.ts";
import type { Expression } from "#plate/model/expression.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * Give every integer an operand of `qti-gcd` or `qti-lcm` holds: the one of a single, or each
 * member of a multiple or ordered container.
 *
 * Every operand of these kinds holds integers on a checked item: the validator refuses any other
 * (P23). One that holds another base type is counted as NULL, as the information model counts a
 * value that is not numerical.
 *
 * @param value The operand's value.
 * @returns The integers, in order; none when the value is NULL, an empty container included, or
 *   holds a member that is not an integer.
 */
const integersOf = (value: Value): Option.Option<readonly bigint[]> =>
  value.values.length === 0
    ? Option.none()
    : Option.all(
        value.values.map((single) =>
          single.baseType === "integer" ? Option.some(single.value) : Option.none(),
        ),
      );

/**
 * Give the magnitude of an integer.
 *
 * @param integer The integer.
 * @returns Its absolute value.
 */
const magnitudeOf = (integer: bigint): bigint => (integer < 0n ? -integer : integer);

/**
 * Give the quotient of two integers rounded down, the greatest integer `i` such that `i ≤ x / y`:
 * `bigint` division rounds toward zero, so a quotient with a remainder whose operands differ in
 * sign is one less.
 *
 * @param dividend The integer divided, `x`.
 * @param divisor The integer it is divided by, `y`, not 0.
 * @returns The floored quotient.
 */
const flooredQuotient = (dividend: bigint, divisor: bigint): bigint => {
  const quotient = dividend / divisor;

  return dividend % divisor !== 0n && dividend < 0n !== divisor < 0n ? quotient - 1n : quotient;
};

/**
 * Give the greatest common divisor of two integers' magnitudes, by Euclid's algorithm, in a loop,
 * so an integer of any size takes no stack. The divisor of 0 and `n` is `|n|`, so a zero is
 * ignored, and of 0 and 0 is 0.
 *
 * @param left One integer.
 * @param right The other.
 * @returns Their greatest common divisor, not negative.
 */
const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
  let larger = magnitudeOf(left);
  let smaller = magnitudeOf(right);
  while (smaller !== 0n) {
    [larger, smaller] = [smaller, larger % smaller];
  }

  return larger;
};

/**
 * Evaluate every operand, left to right ({@link operandValues}), and give the integers each holds;
 * the first failure is the result.
 *
 * @param operands The operands.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns Every operand's integers, in order, or none when any operand is NULL or holds a value
 *   that is not an integer; or the first operand's failure.
 */
const aggregateOf = (
  operands: readonly Expression[],
  scope: Scope,
  evaluate: Evaluate,
): Result.Result<Option.Option<readonly bigint[]>, EngineFailure> =>
  Result.map(operandValues(operands, scope, evaluate), (values) =>
    Option.map(Option.all(values.map((value) => integersOf(value))), (lists): readonly bigint[] =>
      lists.flat(),
    ),
  );

/**
 * Evaluate the two operands of `qti-integer-divide` or `qti-integer-modulus`, left to right, and
 * give an integer of them, NULL when either is NULL or the divisor is 0.
 *
 * @param operands The dividend and the divisor.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @param divided The integer of a dividend and a divisor that is not 0.
 * @returns The single integer, or the first operand's failure.
 */
const dividedOf = (
  [dividend, divisor]: readonly [Expression, Expression],
  scope: Scope,
  evaluate: Evaluate,
  divided: (dividend: bigint, divisor: bigint) => bigint,
): Result.Result<Value, EngineFailure> =>
  Result.map(
    Result.all([evaluate(dividend, scope), evaluate(divisor, scope)]),
    ([dividendValue, divisorValue]) =>
      Option.match(
        Option.filter(
          Option.all([integerOf(dividendValue), integerOf(divisorValue)]),
          ([, y]) => y !== 0n,
        ),
        {
          onNone: () => integerNull,
          onSome: ([x, y]) => integerValue(divided(x, y)),
        },
      ),
  );

/**
 * Give the value of a `qti-integer-divide`: a single integer, its first operand divided by its
 * second rounded down ({@link flooredQuotient}), so −7 / 2 gives −4; NULL when either operand is
 * NULL or the divisor is 0.
 *
 * @param expression The `qti-integer-divide`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single integer, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIntDivide
 */
const evaluateIntegerDivide: Evaluator<"integer-divide"> = (expression, scope, evaluate) =>
  dividedOf(expression.operands, scope, evaluate, flooredQuotient);

/**
 * Give the value of a `qti-integer-modulus`: a single integer, `x − z × y` for `z` the quotient
 * `qti-integer-divide` gives, so the remainder takes the divisor's sign: 7 mod −2 gives −1 and −7
 * mod 2 gives 1. NULL when either operand is NULL or the divisor is 0.
 *
 * @param expression The `qti-integer-modulus`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single integer, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIntModulus
 */
const evaluateIntegerModulus: Evaluator<"integer-modulus"> = (expression, scope, evaluate) =>
  dividedOf(
    expression.operands,
    scope,
    evaluate,
    (dividend, divisor) => dividend - flooredQuotient(dividend, divisor) * divisor,
  );

/**
 * Give the value of a `qti-integer-to-float`: a single float, its operand's nearest double through
 * `toFloat`, so 10^400 gives the largest finite float (reading 45); NULL when the operand is NULL.
 *
 * @param expression The `qti-integer-to-float`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single float, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpInttoFloat
 */
const evaluateIntegerToFloat: Evaluator<"integer-to-float"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) =>
    Option.match(integerOf(value), {
      onNone: () => floatNull,
      onSome: (integer) => floatValue(toFloat(integer)),
    }),
  );
};

/**
 * Give the value of a `qti-gcd`: a single integer, the greatest common divisor of every integer
 * its operands hold, a container's members each counted, by their magnitudes (9.20). gcd(0, 0) is
 * 0, and a zero among other integers is ignored, gcd(0, n) = |n|. NULL when any operand is NULL.
 *
 * @param expression The `qti-gcd`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single integer, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGcd
 */
const evaluateGcd: Evaluator<"gcd"> = (expression, scope, evaluate) =>
  Result.map(aggregateOf(expression.operands, scope, evaluate), (held) =>
    Option.match(held, {
      onNone: () => integerNull,
      onSome: (integers) => {
        let divisor = 0n;
        for (const integer of integers) {
          divisor = greatestCommonDivisor(divisor, integer);
        }

        return integerValue(divisor);
      },
    }),
  );

/**
 * Give the least common multiple of integers that are not 0, by their magnitudes, held to the
 * bound without building a multiple far past it: each partial multiple is the one before times
 * the next integer divided by their common divisor, lcm(m, n) = m × (n / gcd(m, n)), through
 * `boundedTimes`, so the first past the bound gives none. Only that quotient, no larger than the
 * integer, is measured; the range of each partial multiple's bit length is carried, so no partial
 * multiple is measured unless the bit lengths cannot decide it. Each partial multiple divides the
 * whole one, so the first past the bound means the whole is past it. The first integer's
 * magnitude alone is held to the bound too, for the multiple of one operand is computed, not
 * written.
 *
 * @param integers The integers, none of them 0.
 * @returns The least common multiple, or none when it has more than 1,000,000 bits.
 */
const leastCommonMultiple = (integers: readonly bigint[]): Option.Option<bigint> => {
  let multiple: PartialProduct = emptyProduct;
  for (const integer of integers) {
    const factor = magnitudeOf(integer);
    const next = boundedTimes(multiple, factor / greatestCommonDivisor(multiple.integer, factor));
    if (Option.isNone(next)) {
      return Option.none();
    }

    multiple = next.value;
  }

  return Option.some(multiple.integer);
};

/**
 * Give the value of a `qti-lcm`: a single integer, the least common multiple of every integer its
 * operands hold, a container's members each counted, by their magnitudes (9.20). It is 0 when any
 * integer is 0, lcm(0, n) = 0, whatever the others' size. NULL when any operand is NULL, a zero
 * beside it included, and for a multiple of more than 1,000,000 bits.
 *
 * @param expression The `qti-lcm`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single integer, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLcm
 */
const evaluateLcm: Evaluator<"lcm"> = (expression, scope, evaluate) =>
  Result.map(aggregateOf(expression.operands, scope, evaluate), (held) =>
    Option.match(held, {
      onNone: () => integerNull,
      onSome: (integers) =>
        integers.includes(0n)
          ? integerValue(0n)
          : Option.match(leastCommonMultiple(integers), {
              onNone: () => integerNull,
              onSome: integerValue,
            }),
    }),
  );

/**
 * The integers family's evaluators by kind.
 */
export const integersEvaluators: FamilyTable<
  "gcd" | "integer-divide" | "integer-modulus" | "integer-to-float" | "lcm"
> = {
  gcd: evaluateGcd,
  "integer-divide": evaluateIntegerDivide,
  "integer-modulus": evaluateIntegerModulus,
  "integer-to-float": evaluateIntegerToFloat,
  lcm: evaluateLcm,
};
