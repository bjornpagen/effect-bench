/**
 * The arithmetic family of the engine: the evaluators of `qti-sum`, `qti-product`, `qti-subtract`,
 * `qti-divide`, `qti-min` and `qti-max`.
 *
 * Integers are exact `bigint`s (reading 45), so when every operand is an integer, `qti-sum`,
 * `qti-product`, `qti-subtract`, `qti-min` and `qti-max` compute exactly and give a single integer.
 * The integer `qti-sum`, `qti-product` and `qti-subtract` compute is held to `integerBitBound`
 * (`#plate/engine/numbers.ts`, the operator's ruling `afb7e648`): one of more than 1,000,000 bits
 * is the integer NULL, so rules that square an outcome again and again cannot hang scoring.
 * `qti-min` and `qti-max` compute no new integer, they give one of their operands, so they are not
 * held to it, and no operand, as written or stored, is. Otherwise each integer meets the floats
 * through `toFloat`, the one integer-to-float conversion, and the kind gives a single float of
 * 64-bit double arithmetic, left to right. `qti-divide` always gives a single float, and gives NULL
 * for a divisor of 0 and for a quotient of INF, -INF or NaN, which the information model's float
 * value set does not hold (§4.4); every other kind keeps INF as the value its arithmetic gives.
 *
 * Any NULL operand, an empty container among them, gives NULL, and so does an operand that is not
 * a number, which the validator refuses on a checked item (P23). The NULL keeps the type the kind's
 * rule gives (`#plate/model/expressions/arithmetic.ts`).
 *
 * It value-imports only engine leaves, `#plate/model/values.ts` and `effect`'s `Array`, `Option`
 * and `Result`, and reads the evaluator's types from `#plate/engine/evaluate.ts` as types, so the
 * dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Array, Option, Result } from "effect";
import type { Evaluator, FamilyTable } from "#plate/engine/evaluate.ts";
import {
  boundedInteger,
  boundedTimes,
  emptyProduct,
  floatNull,
  floatOf,
  floatValue,
  integerNull,
  integerValue,
  numberOf,
} from "#plate/engine/numbers.ts";
import type { PartialProduct } from "#plate/engine/numbers.ts";
import { operandValues } from "#plate/engine/operands.ts";
import { isNull, nullOf } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * The numbers an arithmetic expression's operands hold, in order, each member of a container in
 * its place: exact integers when every one is an integer, else floats, each integer through
 * `toFloat`.
 */
type Members =
  | { readonly _tag: "float"; readonly values: Array.NonEmptyReadonlyArray<number> }
  | { readonly _tag: "integer"; readonly values: Array.NonEmptyReadonlyArray<bigint> };

/**
 * How an arithmetic kind combines its numbers: floats two at a time, the one held so far and the
 * next, and integers all at once, so a kind that computes a new integer can hold it to the bound.
 */
interface Step {
  /**
   * Combine the float held so far with the next, in 64-bit double arithmetic.
   *
   * @param held The float the numbers before `next` combine to.
   * @param next The next float.
   * @returns The float the two combine to.
   */
  readonly float: (held: number, next: number) => number;

  /**
   * Combine every integer, left to right.
   *
   * @param values The integers, one or more.
   * @returns The integer, or none when the kind's result is past `integerBitBound`, for the
   *   integer NULL.
   */
  readonly integer: (values: Array.NonEmptyReadonlyArray<bigint>) => Option.Option<bigint>;
}

/**
 * Give the base type of the NULL an arithmetic kind's operands give, the kind's rule over their
 * types: integer when every operand that says its base type is an integer, else float. A NULL of a
 * base type that is not numerical says nothing, as the rule passes over `qti-null`'s `any`: it is
 * the only such NULL on a checked item, which refuses every other operand that is not a number.
 *
 * @param values The operands' values.
 * @returns The base type.
 */
const resultBaseOf = (values: readonly Value[]): "float" | "integer" => {
  const said = values.filter(
    (value) => !isNull(value) || value.baseType === "integer" || value.baseType === "float",
  );

  return said.length > 0 && said.every((value) => value.baseType === "integer")
    ? "integer"
    : "float";
};

/**
 * Give the numbers the operands hold, each member of a container in its place.
 *
 * @param values The operands' values.
 * @returns The numbers; none when an operand is NULL, an empty container included, or holds a
 *   value that is not a number.
 */
const membersOf = (values: readonly Value[]): Option.Option<Members> => {
  if (values.some((value) => isNull(value))) {
    return Option.none();
  }

  const singles = values.flatMap((value) => value.values);
  const integers = singles.flatMap((single) =>
    single.baseType === "integer" ? [single.value] : [],
  );
  if (integers.length === singles.length && Array.isReadonlyArrayNonEmpty(integers)) {
    return Option.some({ _tag: "integer", values: integers });
  }

  const floats = singles.flatMap((single) =>
    single.baseType === "integer" || single.baseType === "float" ? [floatOf(single)] : [],
  );

  return floats.length === singles.length && Array.isReadonlyArrayNonEmpty(floats)
    ? Option.some({ _tag: "float", values: floats })
    : Option.none();
};

/**
 * Combine numbers left to right: the first, then each next with the one held so far.
 *
 * @param values The numbers, one or more.
 * @param step How two combine.
 * @returns The number they combine to.
 */
const fold = <A>(values: Array.NonEmptyReadonlyArray<A>, step: (held: A, next: A) => A): A => {
  const [first, ...rest] = values;
  let held = first;
  for (const next of rest) {
    held = step(held, next);
  }

  return held;
};

/**
 * Give the value an arithmetic kind combines its operands' values to: a single integer of the
 * integers when every number is one, else a single float of the floats, or NULL of the kind's type
 * when {@link membersOf} gives none or the integer is past the bound.
 *
 * @param values The operands' values.
 * @param step How the kind combines its numbers.
 * @returns The value.
 */
const combined = (values: readonly Value[], step: Step): Value =>
  Option.match(membersOf(values), {
    onNone: () => nullOf(resultBaseOf(values), "single"),
    onSome: (members) =>
      members._tag === "integer"
        ? Option.match(step.integer(members.values), {
            onNone: () => integerNull,
            onSome: integerValue,
          })
        : floatValue(fold(members.values, step.float)),
  });

/**
 * Give the product of integers, held to the bound without building a product far past it: 0 when
 * any is 0, whatever the others' size; else the product `boundedTimes` builds from the empty
 * product, one integer at a time, none at the first partial product past the bound. Each integer
 * is measured once and the range of each partial product's bit length is carried, so no partial
 * product is measured unless its factors' bit lengths cannot decide it. With no 0, each partial
 * product's magnitude is at least the one before it, so the first past the bound means the whole
 * product is past it. The first integer alone is held to the bound too, for a product of one
 * operand is computed, not written.
 *
 * @param values The integers.
 * @returns The product, or none when it has more than 1,000,000 bits.
 */
const productOf = (values: Array.NonEmptyReadonlyArray<bigint>): Option.Option<bigint> => {
  if (values.includes(0n)) {
    return Option.some(0n);
  }

  let held: PartialProduct = emptyProduct;
  for (const next of values) {
    const product = boundedTimes(held, next);
    if (Option.isNone(product)) {
      return Option.none();
    }

    held = product.value;
  }

  return Option.some(held.integer);
};

/**
 * Addition: exact on integers, held to the bound, and IEEE 754 on floats. A sum of `n` integers has
 * at most ⌈log2 n⌉ bits more than its largest operand, so it is computed whole, then checked: a
 * sum whose operands cancel stays exact, however large they are.
 */
const add: Step = {
  float: (held, next) => held + next,
  integer: (values) => boundedInteger(fold(values, (held, next) => held + next)),
};

/**
 * Multiplication: exact on integers, held to the bound ({@link productOf}), and IEEE 754 on
 * floats.
 */
const multiply: Step = { float: (held, next) => held * next, integer: productOf };

/**
 * Subtraction: exact on integers, held to the bound, and IEEE 754 on floats. A difference has at
 * most one bit more than its larger operand, so it is computed, then checked.
 */
const takeAway: Step = {
  float: (held, next) => held - next,
  integer: (values) => boundedInteger(fold(values, (held, next) => held - next)),
};

/**
 * The lesser of two numbers. Of two floats it is `Math.min`'s, so a NaN gives NaN and -0 is less
 * than 0. The least integer is one of the operands, not a computed integer, so it is not held to
 * the bound.
 *
 * Integers that meet a float are compared as their floats here, never exactly, and that gives the
 * same result: `toFloat` keeps order (a greater integer never becomes a lesser float) and leaves a
 * float as it is, so the least float of the numbers is the float of the least number.
 */
const least: Step = {
  float: (held, next) => Math.min(held, next),
  integer: (values) => Option.some(fold(values, (held, next) => (next < held ? next : held))),
};

/**
 * The greater of two numbers. Of two floats it is `Math.max`'s, so a NaN gives NaN and 0 is
 * greater than -0. Integers that meet a float are compared as their floats, which gives the
 * greatest number's float, as {@link least} says of the least.
 */
const greatest: Step = {
  float: (held, next) => Math.max(held, next),
  integer: (values) => Option.some(fold(values, (held, next) => (next > held ? next : held))),
};

/**
 * Give the value of a `qti-sum`: the sum of every number its operands hold, a container's members
 * each in its place; a single integer when every operand is an integer, else a single float. NULL
 * when any operand is NULL, and the integer NULL for an integer of more than 1,000,000 bits.
 *
 * @param expression The `qti-sum`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single number, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpSum
 */
const evaluateSum: Evaluator<"sum"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    combined(values, add),
  );

/**
 * Give the value of a `qti-product`: the product of every number its operands hold, a container's
 * members each in its place; a single integer when every operand is an integer, else a single
 * float. NULL when any operand is NULL, and the integer NULL for an integer of more than 1,000,000
 * bits.
 *
 * @param expression The `qti-product`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single number, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpProduct
 */
const evaluateProduct: Evaluator<"product"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    combined(values, multiply),
  );

/**
 * Give the value of a `qti-subtract`: its first operand less its second; a single integer when
 * both are integers, else a single float. NULL when either is NULL or not a single number, and the
 * integer NULL for an integer of more than 1,000,000 bits.
 *
 * @param expression The `qti-subtract`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single number, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpSubcontract
 */
const evaluateSubtract: Evaluator<"subtract"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    values.every((value) => value.cardinality === "single")
      ? combined(values, takeAway)
      : nullOf(resultBaseOf(values), "single"),
  );

/**
 * Give the quotient of two floats, when the float value set holds it.
 *
 * @param dividend The dividend.
 * @param divisor The divisor.
 * @returns The quotient; none for a divisor of 0 or -0, and for a quotient of INF, -INF or NaN.
 */
const quotientOf = (dividend: number, divisor: number): Option.Option<number> => {
  if (divisor === 0) {
    return Option.none();
  }

  const quotient = dividend / divisor;

  return Number.isFinite(quotient) ? Option.some(quotient) : Option.none();
};

/**
 * Give the value of a `qti-divide`: a single float, its first operand divided by its second, each
 * an integer through `toFloat`. NULL when either is NULL or not a single number, when the divisor
 * is 0, and when the quotient is INF, -INF or NaN, which the float value set does not hold (§4.4).
 *
 * @param expression The `qti-divide`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single float, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDivide
 */
const evaluateDivide: Evaluator<"divide"> = (expression, scope, evaluate) => {
  const [dividend, divisor] = expression.operands;

  return Result.map(
    Result.all([evaluate(dividend, scope), evaluate(divisor, scope)]),
    ([left, right]) =>
      Option.match(
        Option.flatMap(Option.all([numberOf(left), numberOf(right)]), ([over, under]) =>
          quotientOf(floatOf(over), floatOf(under)),
        ),
        { onNone: () => floatNull, onSome: floatValue },
      ),
  );
};

/**
 * Give the value of a `qti-min`: the least number its operands hold, a container's members each in
 * its place; a single integer when every operand is an integer, else a single float. NULL when any
 * operand is NULL.
 *
 * @param expression The `qti-min`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single number, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMin
 */
const evaluateMin: Evaluator<"min"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    combined(values, least),
  );

/**
 * Give the value of a `qti-max`: the greatest number its operands hold, a container's members each
 * in its place; a single integer when every operand is an integer, else a single float. NULL when
 * any operand is NULL.
 *
 * @param expression The `qti-max`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single number, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMax
 */
const evaluateMax: Evaluator<"max"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    combined(values, greatest),
  );

/**
 * The arithmetic family's evaluators by kind.
 */
export const arithmeticEvaluators: FamilyTable<
  "divide" | "max" | "min" | "product" | "subtract" | "sum"
> = {
  divide: evaluateDivide,
  max: evaluateMax,
  min: evaluateMin,
  product: evaluateProduct,
  subtract: evaluateSubtract,
  sum: evaluateSum,
};
