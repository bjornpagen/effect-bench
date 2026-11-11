/**
 * The engine's numbers, a leaf the evaluator and the expression families share: the single values
 * a kind gives ({@link singleValue} for any single, {@link booleanOf}, {@link integerValue},
 * {@link floatValue}) and the single NULLs ({@link booleanNull}, {@link integerNull},
 * {@link floatNull}), the one conversion from an integer to a float ({@link toFloat}, and
 * {@link floatOf} for a single number), the one number a single numeric value holds
 * ({@link numberOf}, and {@link integerOf} for an integer), exact equality of two numbers
 * ({@link sameNumber}), and the bounds on what the engine computes ({@link integerBitBound},
 * {@link containerSizeBound}), with the checks that hold a computed integer, a product built one
 * factor at a time ({@link boundedTimes}) and a container to them.
 *
 * Integers are exact `bigint`s (reading 45) and floats are 64-bit doubles, never infinite when made
 * from an integer. An integer and a float compare exactly, never through a lossy conversion. The
 * module value-imports only `Option` from `effect`, and imports only types from the value model.
 *
 * @module
 */
import { Option } from "effect";
import type { Single, Value } from "#plate/model/values.ts";

/**
 * Construct the single value that holds one single, of the single's base type.
 *
 * @param single The single.
 * @returns The value.
 */
export const singleValue = (single: Single): Value => ({
  baseType: single.baseType,
  cardinality: "single",
  values: [single],
});

/**
 * Construct a single boolean value.
 *
 * @param value The boolean.
 * @returns The value.
 */
export const booleanOf = (value: boolean): Value => ({
  baseType: "boolean",
  cardinality: "single",
  values: [{ baseType: "boolean", value }],
});

/**
 * Construct a single integer value.
 *
 * @param value The integer.
 * @returns The value.
 */
export const integerValue = (value: bigint): Value => ({
  baseType: "integer",
  cardinality: "single",
  values: [{ baseType: "integer", value }],
});

/**
 * Construct a single float value.
 *
 * @param value The float.
 * @returns The value.
 */
export const floatValue = (value: number): Value => ({
  baseType: "float",
  cardinality: "single",
  values: [{ baseType: "float", value }],
});

/**
 * The single boolean NULL: the value of a comparison, logic or text expression whose truth is not
 * known.
 */
export const booleanNull: Value = { baseType: "boolean", cardinality: "single", values: [] };

/**
 * The single integer NULL: the value of an integer expression whose value is not defined.
 */
export const integerNull: Value = { baseType: "integer", cardinality: "single", values: [] };

/**
 * The single float NULL: the value of a float expression whose value is not defined.
 */
export const floatNull: Value = { baseType: "float", cardinality: "single", values: [] };

/**
 * Convert an exact integer to a float: the nearest double, ties to even, and the largest finite
 * double of its sign for an integer beyond it. It is the one conversion from an integer to a float
 * (integer plan `10f98260` part C), so every kind that makes a float of an integer clamps alike.
 *
 * Beyond 2^53 a double cannot hold every integer, so `2^53 + 1` becomes `2^53`. That loss is the
 * float QTI specifies wherever an integer is compared as one, so it is not reported.
 *
 * An integer has no largest value (reading 45), and the float base type holds no infinity, so "an
 * integer beyond the largest finite float becomes the largest finite float of its sign" (reading
 * 45): from 2^1024 − 2^970, the least integer whose nearest double is an infinity, `10^400`
 * among them, it gives `Number.MAX_VALUE`, and its negative `-Number.MAX_VALUE`. `Number` of a
 * `bigint` is never NaN.
 *
 * @param integer The integer.
 * @returns The nearest double, finite.
 */
export const toFloat = (integer: bigint): number => {
  const nearest = Number(integer);
  if (nearest === Number.POSITIVE_INFINITY) {
    return Number.MAX_VALUE;
  }

  return nearest === Number.NEGATIVE_INFINITY ? -Number.MAX_VALUE : nearest;
};

/**
 * A single of a numeric base type: an exact integer or a 64-bit double.
 */
export type NumberSingle = Extract<Single, { readonly baseType: "float" | "integer" }>;

/**
 * Give the one number a single integer or float value holds.
 *
 * @param value The value, not NULL.
 * @returns The single integer or float, or none when the value is not a single of a numeric base
 *   type.
 */
export const numberOf = (value: Value): Option.Option<NumberSingle> => {
  const [single, ...rest] = value.values;
  if (value.cardinality !== "single" || single === undefined || rest.length > 0) {
    return Option.none();
  }

  return single.baseType === "integer" || single.baseType === "float"
    ? Option.some(single)
    : Option.none();
};

/**
 * Give the integer a single integer value holds.
 *
 * @param value The value.
 * @returns The integer, or none when the value is NULL or not a single integer.
 */
export const integerOf = (value: Value): Option.Option<bigint> =>
  Option.flatMap(numberOf(value), (single) =>
    single.baseType === "integer" ? Option.some(single.value) : Option.none(),
  );

/**
 * Give the float a single number stands for: a float as it is, an integer through
 * {@link toFloat}, the one integer-to-float conversion.
 *
 * @param single The number.
 * @returns The float.
 */
export const floatOf = (single: NumberSingle): number =>
  single.baseType === "integer" ? toFloat(single.value) : single.value;

/**
 * Report whether an integer and a float are the same number, exactly: the float is integral and
 * converts to that integer. A float that is integral and finite converts to a `bigint` exactly, so
 * the comparison loses nothing, as `bigint == number` would not (integer plan `10f98260` part C);
 * no integer is converted to a float.
 *
 * @param integer The integer.
 * @param float The float.
 * @returns Whether they are equal.
 */
const integerIsFloat = (integer: bigint, float: number): boolean =>
  Number.isInteger(float) && BigInt(float) === integer;

/**
 * Report whether two numbers are equal exactly: two integers or two floats by value, and an integer
 * and a float as {@link integerIsFloat} compares them, so `1` and `1.0` are equal and `1` and
 * `1.0000000000000002` are not.
 *
 * @param left One number.
 * @param right The other.
 * @returns Whether they are equal.
 */
export const sameNumber = (left: NumberSingle, right: NumberSingle): boolean => {
  if (left.baseType === "integer") {
    return right.baseType === "integer"
      ? left.value === right.value
      : integerIsFloat(left.value, right.value);
  }

  return right.baseType === "integer"
    ? integerIsFloat(right.value, left.value)
    : left.value === right.value;
};

/**
 * The most bits an integer the engine computes may have: 1,000,000 (the operator's ruling
 * `afb7e648`, option B). An integer is unbounded (reading 45), so an item whose rules square an
 * outcome rule after rule would double its size each time and hang scoring; a computed integer
 * past this bound is NULL instead, as other impossible results are. An integer as written (a
 * literal, a declared default, a stored value) is never held to it.
 */
export const integerBitBound = 1_000_000;

/**
 * The most values a container the engine computes may hold: 1,000,000, the principle of the
 * operator's ruling `afb7e648` applied to containers. A computed container past it is NULL instead,
 * so `qti-repeat` with a `number-repeats` of 2147483647 cannot hang scoring. A container as written
 * or stored is never held to it.
 */
export const containerSizeBound = 1_000_000;

/**
 * Give the number of bits an integer has: the binary digits of its magnitude, so 0 has none, 1 has
 * one and 2^999999 has 1,000,000, and an integer and its negative have the same. It reads the
 * hexadecimal digits, which `bigint` writes in time linear in its size, so it makes a string the
 * integer's size: {@link boundedTimes} measures each factor once this way, and a product only when
 * its factors cannot decide it.
 *
 * @param integer The integer.
 * @returns Its bit length.
 */
export const bitLengthOf = (integer: bigint): number => {
  if (integer === 0n) {
    return 0;
  }

  const digits = (integer < 0n ? -integer : integer).toString(16);

  return (digits.length - 1) * 4 + 32 - Math.clz32(Number.parseInt(digits.charAt(0), 16));
};

/**
 * Give an integer the engine computed when it is within {@link integerBitBound}.
 *
 * @param integer The computed integer.
 * @returns The integer, or none when it has more than 1,000,000 bits, for the kind's NULL.
 */
export const boundedInteger = (integer: bigint): Option.Option<bigint> =>
  bitLengthOf(integer) <= integerBitBound ? Option.some(integer) : Option.none();

/**
 * A product the engine is building factor by factor, with the range its bit length lies in:
 * `leastBits <= bitLengthOf(integer) <= mostBits`. A product's bit length is known from its
 * factors' to within one bit, so the range is carried from one factor to the next instead of
 * measuring each partial product.
 */
export interface PartialProduct {
  readonly integer: bigint;
  readonly leastBits: number;
  readonly mostBits: number;
}

/**
 * The product of no factor: 1, of exactly one bit, where a product built by
 * {@link boundedTimes} starts.
 */
export const emptyProduct: PartialProduct = { integer: 1n, leastBits: 1, mostBits: 1 };

/**
 * The product of 0 and any integer: 0, of no bits.
 */
const zeroProduct: PartialProduct = { integer: 0n, leastBits: 0, mostBits: 0 };

/**
 * Multiply a product by one more integer when the result is within {@link integerBitBound},
 * deciding from bit lengths wherever they suffice. The factor is measured once; the product is
 * not. A product of `a` and `b` bits, neither 0, has `a + b` or `a + b − 1` bits, and exactly the
 * other's bits when one is ±1, the one factor of one bit. So the product is kept unmeasured when
 * the most it can have is at most the bound, and is none before any multiplication when the least
 * it can have is past it; only in between is it measured, exactly, and it is then at most the
 * factor's bits past the bound. A product with 0 is 0, whatever the other's size.
 *
 * @param held The product so far, within the bound.
 * @param factor The next integer.
 * @returns The product with the range of its bit length, exact once measured, or none when it has
 *   more than 1,000,000 bits.
 */
export const boundedTimes = (
  held: PartialProduct,
  factor: bigint,
): Option.Option<PartialProduct> => {
  if (held.integer === 0n || factor === 0n) {
    return Option.some(zeroProduct);
  }

  const bits = bitLengthOf(factor);
  const leastBits = held.leastBits + bits - 1;
  if (leastBits > integerBitBound) {
    return Option.none();
  }

  const integer = held.integer * factor;
  const mostBits = held.mostBits + bits - (held.mostBits === 1 || bits === 1 ? 1 : 0);
  if (mostBits <= integerBitBound) {
    return Option.some({ integer, leastBits, mostBits });
  }

  const exact = bitLengthOf(integer);

  return exact <= integerBitBound
    ? Option.some({ integer, leastBits: exact, mostBits: exact })
    : Option.none();
};

/**
 * Report whether a container the engine computes, of a size, is within {@link containerSizeBound}.
 *
 * @param size How many values it holds, or would hold if it were built.
 * @returns Whether it holds at most 1,000,000 values.
 */
export const withinContainerBound = (size: bigint): boolean => size <= BigInt(containerSizeBound);
