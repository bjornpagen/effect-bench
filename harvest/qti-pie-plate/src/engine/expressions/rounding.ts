/**
 * The rounding family of the engine: the evaluators of `qti-round`, `qti-truncate`, `qti-round-to`
 * and `qti-equal-rounded`.
 *
 * `qti-round` and `qti-truncate` give the exact integer of their operand's value (reading 45), so a
 * finite float of any size rounds to its exact `bigint`. The integer base type holds no infinity,
 * so they give NULL for INF and -INF, as for NaN (9.10, ruled NULL by head-cto `5e755443`).
 *
 * `qti-round-to` and `qti-equal-rounded` round on §5.3's rounding basis: the shortest decimal that
 * reads back to the same double, as ECMAScript's Number::toString writes it (`shortestDecimal` in
 * `#plate/engine/math.ts`, the form reading 54 prints), never the double's exact binary expansion;
 * an integer operand rounds its own decimal digits. The digit rule is the information model's
 * (2.11.3.43): "If the deciding digit is 5 or greater, the nth digit is increased by 1", which acts
 * on the magnitude, so a tie rounds away from zero. `qti-round-to` gives the double nearest the
 * rounded decimal and keeps INF and -INF; `qti-equal-rounded` compares the two rounded decimals
 * exactly.
 *
 * It value-imports only engine leaves, `#plate/model/values.ts` and `effect`'s `Option` and
 * `Result`, and reads the evaluator's types from `#plate/engine/evaluate.ts` as types, so the
 * dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluator, FamilyTable } from "#plate/engine/evaluate.ts";
import { shortestDecimal } from "#plate/engine/math.ts";
import {
  booleanNull,
  booleanOf,
  floatNull,
  floatValue,
  integerNull,
  integerValue,
  numberOf,
  toFloat,
} from "#plate/engine/numbers.ts";
import type { NumberSingle } from "#plate/engine/numbers.ts";
import { referenceInteger } from "#plate/engine/refs.ts";
import type { Expression } from "#plate/model/expression.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * The rounding mode of `qti-round-to` and `qti-equal-rounded`.
 */
type RoundingMode = Extract<Expression, { readonly kind: "round-to" }>["roundingMode"];

/**
 * A number on the decimal rounding basis: a finite decimal `±digits × 10^exponent`, or an
 * infinity, which rounds to itself.
 *
 * A decimal's digits hold no leading or trailing zero, its trailing zeros counted in the exponent,
 * and zero is `0` with no sign, so two decimals of one value are equal field by field.
 */
type Rounded =
  | {
      readonly _tag: "decimal";
      readonly digits: string;
      readonly exponent: bigint;
      readonly negative: boolean;
    }
  | { readonly _tag: "infinity"; readonly negative: boolean };

/**
 * A finite number on the decimal rounding basis.
 */
type Decimal = Extract<Rounded, { readonly _tag: "decimal" }>;

/**
 * The decimal zero.
 */
const zero: Decimal = { _tag: "decimal", digits: "0", exponent: 0n, negative: false };

/**
 * The leading zeros of a run of digits.
 */
const leadingZeros = /^0+/u;

/**
 * The trailing zeros of a run of digits.
 */
const trailingZeros = /0+$/u;

/**
 * The form `String` writes a finite number in (ECMA-262 Number::toString): an optional minus sign,
 * the digits before the point, an optional fraction, and an optional exponent with its sign, as in
 * `-2.675`, `1.2345e-7` or `1e+21`.
 */
const writtenNumber =
  /^(?<sign>-?)(?<whole>[0-9]+)(?:\.(?<fraction>[0-9]+))?(?:e(?<power>[+-][0-9]+))?$/u;

/**
 * Construct a decimal from its sign, its digits as written and the exponent of its last digit: the
 * leading zeros go, and the trailing zeros move into the exponent.
 *
 * @param negative Whether the number is negative.
 * @param written Its digits, which may have leading and trailing zeros.
 * @param exponent The power of ten of the last digit written.
 * @returns The decimal; zero, with no sign, when every digit is zero.
 */
const decimalOf = (negative: boolean, written: string, exponent: bigint): Decimal => {
  const significant = written.replace(leadingZeros, "");
  const digits = significant.replace(trailingZeros, "");

  return digits === ""
    ? zero
    : {
        _tag: "decimal",
        digits,
        exponent: exponent + BigInt(significant.length - digits.length),
        negative,
      };
};

/**
 * Read an exact integer as a decimal of its own digits.
 *
 * @param integer The integer.
 * @returns Its decimal.
 */
const integerDecimal = (integer: bigint): Decimal =>
  integer < 0n
    ? decimalOf(true, (-integer).toString(), 0n)
    : decimalOf(false, integer.toString(), 0n);

/**
 * Read a finite float as the shortest decimal that reads back to it, as `shortestDecimal` writes
 * it: the rounding basis of §5.3.
 *
 * @param float The float, finite.
 * @returns Its decimal, or none when the text is not in the form `String` writes every finite
 *   number in, which it always is.
 */
const floatDecimal = (float: number): Option.Option<Decimal> =>
  Option.map(
    Option.fromNullishOr(writtenNumber.exec(shortestDecimal(float))?.groups),
    ({ fraction = "", power = "0", sign = "", whole = "" }) =>
      decimalOf(sign === "-", `${whole}${fraction}`, BigInt(power) - BigInt(fraction.length)),
  );

/**
 * Round a decimal to its first `keep` digits by the information model's digit rule: when the
 * deciding digit, the one after them, is 5 or greater, the last digit kept is increased by 1,
 * carrying as it must, and every digit after it is discarded. The rule acts on the magnitude, so a
 * tie rounds away from zero.
 *
 * @param decimal The decimal.
 * @param keep How many of its digits, counted from its first, are kept: as many as it has or more
 *   keep it as it is; none keeps only a carry from its first digit; fewer than none give zero.
 * @returns The rounded decimal.
 */
const roundDecimal = (decimal: Decimal, keep: bigint): Decimal => {
  const length = BigInt(decimal.digits.length);
  if (keep >= length) {
    return decimal;
  }

  if (keep < 0n) {
    return zero;
  }

  const at = Number(keep);
  const carry = "56789".includes(decimal.digits.charAt(at)) ? 1n : 0n;
  const kept = BigInt(`0${decimal.digits.slice(0, at)}`) + carry;

  return decimalOf(decimal.negative, kept.toString(), decimal.exponent + length - keep);
};

/**
 * The least `figures` of each rounding mode: "If roundingMode= 'significantFigures', the value of
 * figures must be a non-zero positive integer. If roundingMode='decimalPlaces', the value of
 * figures must be an integer greater than or equal to zero" (information model, 5.47.2 and
 * 5.119.2).
 */
const leastFigures: Readonly<Record<RoundingMode, bigint>> = {
  decimalPlaces: 0n,
  significantFigures: 1n,
};

/**
 * Round a number to `figures` in a rounding mode, on the decimal basis: a float's shortest decimal
 * or an integer's own digits, by {@link roundDecimal}. In `significantFigures` mode the digits kept
 * are the first `figures`; in `decimalPlaces` mode they are those down to the `figures`th place
 * after the point.
 *
 * @param single The number.
 * @param mode The rounding mode.
 * @param figures How many figures it is rounded to.
 * @returns The rounded number, INF and -INF as themselves; none for NaN, which `qti-round-to` and
 *   `qti-equal-rounded` give NULL for, and for `figures` below its mode's least
 *   ({@link leastFigures}), which the information model does not define.
 */
const roundedOf = (
  single: NumberSingle,
  mode: RoundingMode,
  figures: bigint,
): Option.Option<Rounded> => {
  if (figures < leastFigures[mode]) {
    return Option.none();
  }

  const round = (decimal: Decimal): Decimal =>
    roundDecimal(
      decimal,
      mode === "significantFigures"
        ? figures
        : BigInt(decimal.digits.length) + decimal.exponent + figures,
    );

  if (single.baseType === "integer") {
    return Option.some(round(integerDecimal(single.value)));
  }

  if (Number.isNaN(single.value)) {
    return Option.none();
  }

  if (!Number.isFinite(single.value)) {
    return Option.some({ _tag: "infinity", negative: single.value < 0 });
  }

  return Option.map(floatDecimal(single.value), round);
};

/**
 * Give the double nearest a rounded number, the value `qti-round-to` gives.
 *
 * A decimal whose exponent is not negative is an integer, exact as a `bigint`, which `toFloat`
 * converts to its nearest double. One whose exponent is negative is a float's rounded shortest
 * decimal, of at most 17 significant digits, which `Number` reads to its nearest double exactly:
 * ECMA-262 lets an engine approximate a decimal only beyond 20 significant digits (RoundMVResult).
 *
 * @param rounded The rounded number.
 * @returns The double.
 */
const doubleOf = (rounded: Rounded): number => {
  if (rounded._tag === "infinity") {
    return rounded.negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }

  if (rounded.exponent >= 0n) {
    const magnitude = BigInt(rounded.digits) * 10n ** rounded.exponent;

    return toFloat(rounded.negative ? -magnitude : magnitude);
  }

  return Number(`${rounded.negative ? "-" : ""}${rounded.digits}e${rounded.exponent.toString()}`);
};

/**
 * Report whether two rounded numbers are the same number: two decimals equal digit by digit, or
 * two infinities of one sign.
 *
 * @param left One rounded number.
 * @param right The other.
 * @returns Whether they are equal.
 */
const sameRounded = (left: Rounded, right: Rounded): boolean =>
  left._tag === "infinity" || right._tag === "infinity"
    ? left._tag === right._tag && left.negative === right.negative
    : left.negative === right.negative &&
      left.digits === right.digits &&
      left.exponent === right.exponent;

/**
 * Give the integer `qti-round` gives for a number: the integer `n` for every value in
 * `[n − 0.5, n + 0.5)`, so 6.5 gives 7, −6.5 gives −6 and 6.49 gives 6, exactly.
 *
 * Every double of magnitude 2^52 or more is an integer, so a float that is not lies below it,
 * where its floor plus one half is a double and the comparison loses nothing.
 *
 * @param single The number.
 * @returns The integer, or none for INF, -INF and NaN (9.10).
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRound
 */
const roundedInteger = (single: NumberSingle): Option.Option<bigint> => {
  if (single.baseType === "integer") {
    return Option.some(single.value);
  }

  if (!Number.isFinite(single.value)) {
    return Option.none();
  }

  if (Number.isInteger(single.value)) {
    return Option.some(BigInt(single.value));
  }

  const floor = Math.floor(single.value);

  return Option.some(BigInt(single.value >= floor + 0.5 ? floor + 1 : floor));
};

/**
 * Give the integer `qti-truncate` gives for a number: its integer part, toward zero, so 6.8 gives
 * 6 and −6.8 gives −6.
 *
 * @param single The number.
 * @returns The integer, or none for INF, -INF and NaN (9.10).
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpTruncate
 */
const truncatedInteger = (single: NumberSingle): Option.Option<bigint> => {
  if (single.baseType === "integer") {
    return Option.some(single.value);
  }

  return Number.isFinite(single.value)
    ? Option.some(BigInt(Math.trunc(single.value)))
    : Option.none();
};

/**
 * Construct the value of an integer a rounding gave: a single integer, or the integer NULL.
 *
 * @param held The integer, or none.
 * @returns The value.
 */
const integerOrNull = (held: Option.Option<bigint>): Value =>
  Option.match(held, {
    onNone: () => integerNull,
    onSome: integerValue,
  });

/**
 * Give the value of a `qti-round`: a single integer, its operand rounded by {@link roundedInteger};
 * NULL when the operand is NULL, INF, -INF or NaN.
 *
 * @param expression The `qti-round`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single integer, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRound
 */
const evaluateRound: Evaluator<"round"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) =>
    integerOrNull(Option.flatMap(numberOf(value), roundedInteger)),
  );
};

/**
 * Give the value of a `qti-truncate`: a single integer, its operand truncated toward zero by
 * {@link truncatedInteger}; NULL when the operand is NULL, INF, -INF or NaN.
 *
 * @param expression The `qti-truncate`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single integer, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpTruncate
 */
const evaluateTruncate: Evaluator<"truncate"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) =>
    integerOrNull(Option.flatMap(numberOf(value), truncatedInteger)),
  );
};

/**
 * Give the value of a `qti-round-to`: a single float, the double nearest its operand rounded to
 * `figures` in its rounding mode ({@link roundedOf}, {@link doubleOf}), so 3.175 to 3 significant
 * figures is 3.18 and −2.675 to 2 decimal places is −2.68. It keeps INF and -INF, and gives NULL
 * when the operand is NULL or NaN, or `figures` names a variable that holds NULL or is below its
 * mode's least.
 *
 * `figures` is resolved first, as the item model's walks visit it before the operand; the first
 * failure is the result.
 *
 * @param expression The `qti-round-to`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single float, or the first failure of `figures` or the operand.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRoundTo
 */
const evaluateRoundTo: Evaluator<"round-to"> = (expression, scope, evaluate) =>
  Result.gen(function* roundTo() {
    const figures = yield* referenceInteger(scope.variables, expression.figures);
    const [operand] = expression.operands;
    const value = yield* evaluate(operand, scope);
    const rounded = Option.flatMap(Option.all([figures, numberOf(value)]), ([held, single]) =>
      roundedOf(single, expression.roundingMode, held),
    );

    return Option.match(rounded, {
      onNone: () => floatNull,
      onSome: (number) => floatValue(doubleOf(number)),
    });
  });

/**
 * Give the value of a `qti-equal-rounded`: a single boolean, whether its two operands are the same
 * number once each is rounded as `qti-round-to` rounds it ({@link roundedOf}), compared exactly as
 * decimals ({@link sameRounded}), so an integer and a float compare without a lossy conversion. It
 * gives NULL when either operand is NULL or NaN, or `figures` names a variable that holds NULL or
 * is below its mode's least.
 *
 * `figures` is resolved first, then the operands left to right; the first failure is the result.
 *
 * @param expression The `qti-equal-rounded`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first failure of `figures` or an operand.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpEqualRounded
 */
const evaluateEqualRounded: Evaluator<"equal-rounded"> = (expression, scope, evaluate) =>
  Result.gen(function* equalRounded() {
    const figures = yield* referenceInteger(scope.variables, expression.figures);
    const [left, right] = expression.operands;
    const leftValue = yield* evaluate(left, scope);
    const rightValue = yield* evaluate(right, scope);
    const round = (value: Value): Option.Option<Rounded> =>
      Option.flatMap(Option.all([figures, numberOf(value)]), ([held, single]) =>
        roundedOf(single, expression.roundingMode, held),
      );

    return Option.match(Option.all([round(leftValue), round(rightValue)]), {
      onNone: () => booleanNull,
      onSome: ([one, other]) => booleanOf(sameRounded(one, other)),
    });
  });

/**
 * The rounding family's evaluators by kind.
 */
export const roundingEvaluators: FamilyTable<"equal-rounded" | "round" | "round-to" | "truncate"> =
  {
    "equal-rounded": evaluateEqualRounded,
    round: evaluateRound,
    "round-to": evaluateRoundTo,
    truncate: evaluateTruncate,
  };
