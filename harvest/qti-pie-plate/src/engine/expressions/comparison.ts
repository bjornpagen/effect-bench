/**
 * The comparison family of the engine: the evaluators of `qti-match`, `qti-equal` in its three
 * tolerance modes, `qti-gt`, `qti-gte`, `qti-lt`, `qti-lte`, `qti-duration-lt` and
 * `qti-duration-gte`.
 *
 * Integers are exact and floats are doubles. An integer and a float compare exactly, never through
 * a lossy conversion ({@link orderOf}), and `qti-equal`'s tolerance modes decide their range
 * exactly too, every finite operand and tolerance as the exact fraction it is ({@link
 * withinTolerance}). A duration is its seconds in a double, and the two duration kinds compare
 * those doubles as they are ({@link comparingDurations}).
 *
 * `qti-match` compares two records too, each read through `recordOrValue`
 * (`#plate/engine/refs.ts`), which gives the record an operand names before any value read.
 *
 * It value-imports only engine leaves, `#plate/engine/refs.ts` among them, `#plate/model/values.ts`
 * and `effect`'s `Option` and `Result`, and reads the evaluator's types from
 * `#plate/engine/evaluate.ts` as types, so the dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluator, FamilyTable, Scope } from "#plate/engine/evaluate.ts";
import type { EngineFailure } from "#plate/engine/failures.ts";
import { booleanNull, booleanOf, floatOf, numberOf, sameNumber } from "#plate/engine/numbers.ts";
import type { NumberSingle } from "#plate/engine/numbers.ts";
import { recordOrValue, referenceValue } from "#plate/engine/refs.ts";
import type { Expression, FloatOrRef } from "#plate/model/expression.ts";
import { isNull, isNullResponse, isRecordValue, match, sameRecord } from "#plate/model/values.ts";
import type { ResponseValue, Value } from "#plate/model/values.ts";

/**
 * Report whether two operands of a `qti-match`, neither NULL, match: two records by `sameRecord`,
 * the same fields in any order; two values by `match`; and a record never matches a value, as two
 * values of different cardinalities never match. On a checked item the kind's rule refuses a record
 * beside a single, multiple or ordered operand (P23), so only the first two meet.
 *
 * @param left One operand's record or value.
 * @param right The other's.
 * @returns Whether they match.
 */
const matches = (left: ResponseValue, right: ResponseValue): boolean => {
  if (isRecordValue(left) || isRecordValue(right)) {
    return isRecordValue(left) && isRecordValue(right) && sameRecord(left, right);
  }

  return match(left, right);
};

/**
 * Give the value of a `qti-match`: a single boolean, whether the operands match ({@link matches});
 * NULL when either is NULL, a record with no field among them. An operand that names a record
 * response gives its record (`recordOrValue` in `#plate/engine/refs.ts`).
 *
 * Operands are read left to right, and the first failure is the result.
 *
 * @param expression The `qti-match`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value when it names no record.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMatch
 */
const evaluateMatch: Evaluator<"match"> = (expression, scope, evaluate) => {
  const [left, right] = expression.operands;

  return Result.gen(function* matchOperands() {
    const leftValue = yield* recordOrValue(left, scope, evaluate);
    const rightValue = yield* recordOrValue(right, scope, evaluate);

    return isNullResponse(leftValue) || isNullResponse(rightValue)
      ? booleanNull
      : booleanOf(matches(leftValue, rightValue));
  });
};

/**
 * The order of one number against another: below, the same, or above.
 */
type Order = -1 | 0 | 1;

/**
 * Give the order of two numbers of one kind, two integers or two floats, by `<`, `>` and `===`.
 *
 * @param left One number.
 * @param right The other, of the same kind.
 * @returns The order of `left` against `right`, or none when the two are unordered, as NaN is
 *   against every float.
 */
const orderWithin = (left: bigint | number, right: bigint | number): Option.Option<Order> => {
  if (left < right) {
    return Option.some(-1);
  }

  if (left > right) {
    return Option.some(1);
  }

  return left === right ? Option.some(0) : Option.none();
};

/**
 * Give the order seen from the other side: below for above, above for below.
 *
 * @param order An order.
 * @returns The reverse order.
 */
const reverse = (order: Order): Order => {
  switch (order) {
    case -1: {
      return 1;
    }
    case 0: {
      return 0;
    }
    case 1: {
      return -1;
    }
    default: {
      return order satisfies never;
    }
  }
};

/**
 * Give the order of an integer against a float, exactly.
 *
 * An infinity lies beyond every integer. A finite float is compared through its floor, an integer
 * that converts to a `bigint` exactly: an integer below the floor is below the float, one above it
 * is at least the floor plus one and so above the float, and the floor itself is the float when the
 * float is integral and below it otherwise. So `2^53 + 1` is above the float `2^53`, which
 * `toFloat` would make it equal to; no integer is converted to a float.
 *
 * @param integer The integer.
 * @param float The float.
 * @returns The integer's order against the float, or none when the float is NaN.
 */
const integerAgainstFloat = (integer: bigint, float: number): Option.Option<Order> => {
  if (Number.isNaN(float)) {
    return Option.none();
  }

  if (!Number.isFinite(float)) {
    return Option.some(float > 0 ? -1 : 1);
  }

  const floor = BigInt(Math.floor(float));
  if (integer !== floor) {
    return Option.some(integer < floor ? -1 : 1);
  }

  return Option.some(Number.isInteger(float) ? 0 : -1);
};

/**
 * Give the order of one number against another, exactly: two integers or two floats by value, and
 * an integer and a float by {@link integerAgainstFloat}, so the order {@link sameNumber}'s
 * equality agrees with.
 *
 * @param left One number.
 * @param right The other.
 * @returns The order of `left` against `right`, or none when a float is NaN.
 */
const orderOf = (left: NumberSingle, right: NumberSingle): Option.Option<Order> => {
  if (left.baseType === "integer") {
    return right.baseType === "integer"
      ? orderWithin(left.value, right.value)
      : integerAgainstFloat(left.value, right.value);
  }

  return right.baseType === "integer"
    ? Option.map(integerAgainstFloat(right.value, left.value), reverse)
    : orderWithin(left.value, right.value);
};

/**
 * Construct the evaluator of an order comparison: a single boolean, whether its first operand's
 * order against its second is one `holds` accepts; NULL when either operand is NULL.
 *
 * QTI types both operands as single numbers. Two numbers that have no order, a NaN among them, or
 * an operand that is not a single number, compare as false, as `qti-equal` gives false for values
 * that are not numerically equal. Operands are evaluated left to right, and the first failure is
 * the result.
 *
 * @param holds Whether an order makes the comparison true.
 * @returns The evaluator.
 */
const comparing =
  <K extends "gt" | "gte" | "lt" | "lte">(holds: (order: Order) => boolean): Evaluator<K> =>
  (expression, scope, evaluate) => {
    const [left, right] = expression.operands;

    return Result.gen(function* orderOperands() {
      const leftValue = yield* evaluate(left, scope);
      const rightValue = yield* evaluate(right, scope);
      if (isNull(leftValue) || isNull(rightValue)) {
        return booleanNull;
      }

      return booleanOf(
        Option.exists(Option.all([numberOf(leftValue), numberOf(rightValue)]), ([one, other]) =>
          Option.exists(orderOf(one, other), holds),
        ),
      );
    });
  };

/**
 * Give the value of a `qti-gt`: whether the first operand is greater than the second.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGT
 */
const evaluateGt: Evaluator<"gt"> = comparing((order) => order > 0);

/**
 * Give the value of a `qti-gte`: whether the first operand is greater than or equal to the second.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGTE
 */
const evaluateGte: Evaluator<"gte"> = comparing((order) => order >= 0);

/**
 * Give the value of a `qti-lt`: whether the first operand is less than the second.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLT
 */
const evaluateLt: Evaluator<"lt"> = comparing((order) => order < 0);

/**
 * Give the value of a `qti-lte`: whether the first operand is less than or equal to the second.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLTE
 */
const evaluateLte: Evaluator<"lte"> = comparing((order) => order <= 0);

/**
 * Give the seconds a single duration value holds.
 *
 * @param value The value, not NULL.
 * @returns The seconds, or none when the value is not a single duration.
 */
const secondsOf = (value: Value): Option.Option<number> => {
  const [single, ...rest] = value.values;
  if (value.cardinality !== "single" || single?.baseType !== "duration" || rest.length > 0) {
    return Option.none();
  }

  return Option.some(single.value);
};

/**
 * Construct the evaluator of a duration comparison: a single boolean, whether `holds` holds of its
 * first operand's seconds and its second's; NULL when either operand is NULL.
 *
 * The seconds are compared exactly as the doubles they are, with nothing truncated, so 89.95 is
 * shorter than 90. The truncation the information model describes (`info.txt:9492`) is the
 * measuring system's, which reports a duration to its own resolution; the comparison of two
 * reported values is exact (G-R3, pending: a duration comparison reads its seconds as IEEE
 * doubles). So a NaN is neither shorter nor as long as anything, and `INF` and `-INF` compare as
 * the infinities they are. QTI types both operands as single durations; an operand that is not one
 * compares as false, as an order comparison's does. Operands are evaluated left to right, and the
 * first failure is the result.
 *
 * @param holds Whether the comparison is true of the first operand's seconds and the second's.
 * @returns The evaluator.
 */
const comparingDurations =
  <K extends "duration-gte" | "duration-lt">(
    holds: (left: number, right: number) => boolean,
  ): Evaluator<K> =>
  (expression, scope, evaluate) => {
    const [left, right] = expression.operands;

    return Result.gen(function* durationOperands() {
      const leftValue = yield* evaluate(left, scope);
      const rightValue = yield* evaluate(right, scope);
      if (isNull(leftValue) || isNull(rightValue)) {
        return booleanNull;
      }

      return booleanOf(
        Option.exists(Option.all([secondsOf(leftValue), secondsOf(rightValue)]), ([one, other]) =>
          holds(one, other),
        ),
      );
    });
  };

/**
 * Give the value of a `qti-duration-lt`: whether the first duration is shorter than the second.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDurationLT
 */
const evaluateDurationLt: Evaluator<"duration-lt"> = comparingDurations(
  (left, right) => left < right,
);

/**
 * Give the value of a `qti-duration-gte`: whether the first duration is as long as the second or
 * longer.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDurationGTE
 */
const evaluateDurationGte: Evaluator<"duration-gte"> = comparingDurations(
  (left, right) => left >= right,
);

/**
 * Give the number one `tolerance` token stands for: its literal, or the value of the float or
 * integer template or outcome variable it names (9.11), an integer kept exact.
 *
 * The token is resolved through `referenceValue` with `qti-equal`'s unchecked facet, which never
 * fails and reads only the outcomes the attempt holds: a token that names a response, a built-in
 * or no variable the attempt holds gives NULL.
 *
 * @param scope The item and the variables of the attempt.
 * @param token The token.
 * @returns The number, or none when the token names no outcome, a NULL, or a value that is not a
 *   single number.
 */
const toleranceTokenOf = (
  scope: Scope,
  token: FloatOrRef,
): Result.Result<Option.Option<NumberSingle>, EngineFailure> =>
  Result.map(
    referenceValue(scope.variables, { baseType: "float", checked: false, reference: token }),
    numberOf,
  );

/**
 * Give the tolerance of a `qti-equal` in a tolerance mode: `t0`, the distance below its first
 * operand, and `t1`, the distance above it. "If only one value is given it is used for both."
 *
 * The information model defines a tolerance of one or two numbers, so a tolerance of none, or of
 * more than two tokens, holds no `t0` and `t1`, and neither does one whose token stands for no
 * number ({@link toleranceTokenOf}); the `qti-equal` is then NULL.
 *
 * @param scope The item and the variables of the attempt.
 * @param tolerance The tokens of its `tolerance`, in written order.
 * @returns `t0` and `t1`, or none when the tolerance holds no such pair.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#DataCharacteristic_Equal.Attr_tolerance
 */
const toleranceOf = (
  scope: Scope,
  tolerance: readonly FloatOrRef[],
): Result.Result<Option.Option<readonly [NumberSingle, NumberSingle]>, EngineFailure> =>
  Result.map(
    Result.all(tolerance.map((token) => toleranceTokenOf(scope, token))),
    (numbers): Option.Option<readonly [NumberSingle, NumberSingle]> => {
      const [lower, upper, ...extra] = numbers;
      if (lower === undefined || extra.length > 0) {
        return Option.none();
      }

      return Option.all([lower, upper ?? lower]);
    },
  );

/**
 * The side of a `qti-equal`'s range a bound closes: the lower, which `t0` reaches below the first
 * operand, or the upper, which `t1` reaches above it.
 */
type Side = "lower" | "upper";

/**
 * A finite number as an exact fraction, `numerator / 2^shift`: every integer, with a shift of 0,
 * and every finite double.
 */
interface Fraction {
  readonly numerator: bigint;
  readonly shift: bigint;
}

/**
 * Give the exact fraction a finite number is.
 *
 * Every finite double is an integer times a power of two. One that is not integral is below 2^52
 * in magnitude, so doubling it is exact, and at most 1,074 doublings, a subnormal's, make it
 * integral; an integral double converts to a `bigint` exactly.
 *
 * @param single The number.
 * @returns The fraction, or none for an infinite or NaN float.
 */
const fractionOf = (single: NumberSingle): Option.Option<Fraction> => {
  if (single.baseType === "integer") {
    return Option.some({ numerator: single.value, shift: 0n });
  }

  if (!Number.isFinite(single.value)) {
    return Option.none();
  }

  let numerator = single.value;
  let shift = 0n;
  while (!Number.isInteger(numerator)) {
    numerator *= 2;
    shift += 1n;
  }

  return Option.some({ numerator: BigInt(numerator), shift });
};

/**
 * Give a fraction's numerator over a power of two at least its own.
 *
 * @param fraction The fraction.
 * @param shift The power of two, not below the fraction's.
 * @returns The numerator over `2^shift`.
 */
const over = (fraction: Fraction, shift: bigint): bigint =>
  fraction.numerator * 2n ** (shift - fraction.shift);

/**
 * Give the greater of two powers of two, the one two fractions share.
 *
 * @param left One fraction.
 * @param right The other.
 * @returns The greater shift.
 */
const commonShift = (left: Fraction, right: Fraction): bigint =>
  left.shift > right.shift ? left.shift : right.shift;

/**
 * Give one fraction less another, exactly.
 *
 * @param left The fraction subtracted from.
 * @param right The fraction subtracted.
 * @returns The difference.
 */
const less = (left: Fraction, right: Fraction): Fraction => {
  const shift = commonShift(left, right);

  return { numerator: over(left, shift) - over(right, shift), shift };
};

/**
 * Give the product of two fractions, exactly.
 *
 * @param left One factor.
 * @param right The other.
 * @returns The product.
 */
const times = (left: Fraction, right: Fraction): Fraction => ({
  numerator: left.numerator * right.numerator,
  shift: left.shift + right.shift,
});

/**
 * Give the order of one fraction against another, exactly.
 *
 * @param left One fraction.
 * @param right The other.
 * @returns The order of `left` against `right`; two fractions are always ordered.
 */
const fractionOrder = (left: Fraction, right: Fraction): Option.Option<Order> => {
  const shift = commonShift(left, right);

  return orderWithin(over(left, shift), over(right, shift));
};

/**
 * Give a `qti-equal`'s bound on one side in floats, by the written formula: `x − t0` and `x + t1`
 * in `absolute` mode, and in `relative` mode the band by the sign of `x` (Mind amendments 2 and 3,
 * for the M3.b-1 readings), `[x·(1 − t0/100), x·(1 + t1/100)]` for `x ≥ 0`, `−0` included, and
 * `[x·(1 + t0/100), x·(1 − t1/100)]` for `x < 0`, where the range as written would put its lower
 * bound above its upper.
 *
 * {@link boundOrder} uses it only for a bound that an infinite or NaN `x` or tolerance enters, so
 * an infinite `x` holds itself alone for a relative tolerance below 100, and a NaN bound, such as
 * `INF·0` for an infinite `x` and a relative tolerance of 100, or for `x = 0` and an infinite one,
 * or `INF − INF`, holds nothing.
 *
 * @param mode The tolerance mode, `absolute` or `relative` (`exact` reads no range).
 * @param x The first operand, as a float.
 * @param tolerance The side's tolerance, `t0` or `t1`, as a float.
 * @param side The side.
 * @returns The bound.
 */
const floatBound = (
  mode: Extract<Expression, { readonly kind: "equal" }>["toleranceMode"],
  x: number,
  tolerance: number,
  side: Side,
): number => {
  const below = side === "lower";
  if (mode !== "relative") {
    return below ? x - tolerance : x + tolerance;
  }

  // The lower bound of a non-negative x and the upper bound of a negative one take 1 − t/100.
  const shrinks = below === x >= 0;

  return shrinks ? x * (1 - tolerance / 100) : x * (1 + tolerance / 100);
};

/**
 * Give the order of a `qti-equal`'s second operand against the bound of its range on one side,
 * exactly.
 *
 * With `x`, `y` and the side's tolerance `t` finite, each is the exact fraction it is
 * ({@link fractionOf}) and the bound is decided with no step rounded: in `absolute` mode
 * `y − x` against `−t0` below and `t1` above; in `relative` mode, the band of {@link floatBound}
 * multiplied out by 100, `100·(y − x)` against `−|x|·t0` below and `|x|·t1` above, for either sign
 * of `x`, so `x = 0` holds 0 alone. An infinite `y` lies beyond every finite bound, so its order is
 * its order against 0, and a NaN `y` has none. A bound an infinite or NaN `x` or `t` enters keeps
 * the written float formula ({@link floatBound}), `y` compared with it exactly ({@link orderOf}).
 *
 * @param equal The `qti-equal`, in its `absolute` or `relative` mode.
 * @param x The first operand.
 * @param y The second operand.
 * @param tolerance The side's tolerance, `t0` below or `t1` above.
 * @param side The side.
 * @returns The order of `y` against the bound, or none when they have no order.
 */
const boundOrder = (
  equal: Extract<Expression, { readonly kind: "equal" }>,
  x: NumberSingle,
  y: NumberSingle,
  tolerance: NumberSingle,
  side: Side,
): Option.Option<Order> =>
  Option.match(Option.all([fractionOf(x), fractionOf(tolerance)]), {
    onNone: () =>
      orderOf(y, {
        baseType: "float",
        value: floatBound(equal.toleranceMode, floatOf(x), floatOf(tolerance), side),
      }),
    onSome: ([first, reach]) =>
      Option.match(fractionOf(y), {
        onNone: () => orderWithin(floatOf(y), 0),
        onSome: (second) => {
          const relative = equal.toleranceMode === "relative";
          const magnitude =
            first.numerator < 0n ? { ...first, numerator: -first.numerator } : first;
          const signed = side === "lower" ? { ...reach, numerator: -reach.numerator } : reach;
          const scale: Fraction = { numerator: relative ? 100n : 1n, shift: 0n };
          const weight: Fraction = relative ? magnitude : { numerator: 1n, shift: 0n };

          return fractionOrder(times(scale, less(second, first)), times(weight, signed));
        },
      }),
  });

/**
 * Report whether a `qti-equal` in a tolerance mode holds: whether its second operand, `y`, lies in
 * the range its first, `x`, defines with `t0` below it and `t1` above it, each bound closed when
 * its flag is true.
 *
 * Every finite operand and tolerance is compared as the exact fraction it is, an integer and a
 * float alike (Mind amendment 1 to repair7-3), so `equal(v, v)` holds for every finite `v` with
 * tolerances of 0 or more, past 2^53 and past the largest float, and the float 2^53 and the
 * integer 2^53 + 1 differ by 1, as {@link orderOf} has them ({@link boundOrder}).
 *
 * @param equal The `qti-equal`, in its `absolute` or `relative` mode.
 * @param x The first operand.
 * @param y The second operand.
 * @param tolerance `t0`, the tolerance below `x`, then `t1`, the tolerance above it.
 * @returns Whether `y` lies in the range; never when it has no order against a bound.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#DataCharacteristic_Equal.Attr_tolerance
 */
const withinTolerance = (
  equal: Extract<Expression, { readonly kind: "equal" }>,
  x: NumberSingle,
  y: NumberSingle,
  [t0, t1]: readonly [NumberSingle, NumberSingle],
): boolean =>
  Option.exists(boundOrder(equal, x, y, t0, "lower"), (order) =>
    equal.includeLowerBound ? order >= 0 : order > 0,
  ) &&
  Option.exists(boundOrder(equal, x, y, t1, "upper"), (order) =>
    equal.includeUpperBound ? order <= 0 : order < 0,
  );

/**
 * Give the value of a `qti-equal`: a single boolean; NULL when either operand is NULL, or, in a
 * tolerance mode, when its tolerance holds no `t0` and `t1` ({@link toleranceOf}).
 *
 * In `exact` mode it is whether the operands are the same number ({@link sameNumber}), and its
 * tolerance is not read. In `absolute` and `relative` mode it is whether the second operand lies in
 * the range the first defines ({@link withinTolerance}). QTI types both operands as single numbers;
 * an operand that is not one is not numerically equal to anything, so the value is false, as
 * `match` gives false for values of different types.
 *
 * The tolerance is resolved first, as the item model's walks visit it before the operands, then
 * the operands left to right; the first failure is the result.
 *
 * @param expression The `qti-equal`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpEqual
 */
const evaluateEqual: Evaluator<"equal"> = (expression, scope, evaluate) => {
  const [left, right] = expression.operands;

  return Result.gen(function* equalOperands() {
    const exact = expression.toleranceMode === "exact";
    const tolerance = exact ? Option.none() : yield* toleranceOf(scope, expression.tolerance);
    const leftValue = yield* evaluate(left, scope);
    const rightValue = yield* evaluate(right, scope);
    if (isNull(leftValue) || isNull(rightValue)) {
      return booleanNull;
    }

    const numbers = Option.all([numberOf(leftValue), numberOf(rightValue)]);
    if (exact) {
      return booleanOf(Option.exists(numbers, ([one, other]) => sameNumber(one, other)));
    }

    return Option.match(tolerance, {
      onNone: () => booleanNull,
      onSome: (pair) =>
        booleanOf(Option.exists(numbers, ([x, y]) => withinTolerance(expression, x, y, pair))),
    });
  });
};

/**
 * The comparison family's evaluators by kind.
 */
export const comparisonEvaluators: FamilyTable<
  "duration-gte" | "duration-lt" | "equal" | "gt" | "gte" | "lt" | "lte" | "match"
> = {
  "duration-gte": evaluateDurationGte,
  "duration-lt": evaluateDurationLt,
  equal: evaluateEqual,
  gt: evaluateGt,
  gte: evaluateGte,
  lt: evaluateLt,
  lte: evaluateLte,
  match: evaluateMatch,
};
