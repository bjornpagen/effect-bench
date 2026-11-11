/**
 * The arithmetic family of the item model: the kind rules and reader specs of `qti-sum`,
 * `qti-product`, `qti-subtract`, `qti-divide`, `qti-min` and `qti-max`.
 *
 * Each kind takes numerical operands, integer or float, never duration (9.5). `qti-sum`,
 * `qti-product`, `qti-min` and `qti-max` take one or more, each single, multiple or ordered;
 * `qti-subtract` and `qti-divide` take two single ones. `qti-divide` gives a single float, and
 * every other kind a single integer when every operand is an integer, else a single float. No kind
 * has an attribute, so none declares a reference.
 *
 * It value-imports only `effect` and `#plate/model/expression.ts`, and names the registry's reader
 * types with `import type` only, so the registry in `#plate/model/expressions/read.ts` may import
 * it without a cycle.
 *
 * @module
 */
import { Result } from "effect";
import { everyOperand, singleOf } from "#plate/model/expression.ts";
import type { FamilyRules, KindRule } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";

/**
 * The base types every arithmetic operand must have: numerical is integer or float, never duration
 * (9.5), as the qti package reads it (P23, the `numerical` typing in
 * `packages/pantry/src/grammar/expression.ts`, judged by the `Operand fit` law in
 * `packages/pantry/src/qti/expressions.ts`).
 */
const numerical = ["integer", "float"] as const;

/**
 * The type of `qti-sum`, `qti-product`, `qti-subtract`, `qti-min` and `qti-max`: a single integer
 * when every operand that says its base type is an integer, else a single float. An operand of
 * base type `any`, `qti-null`'s NULL, says nothing and is passed over, so a kind of NULLs alone is
 * a float; one of base type `unknown` makes the result unknown. It is the qti package's numeric
 * aggregate (the `numeric` typing in `packages/pantry/src/grammar/expression.ts`).
 *
 * @param operands The operands' types.
 * @returns The type.
 */
const numericalAggregate: KindRule["resultType"] = (operands) => {
  const said = operands.filter((operand) => operand.baseType !== "any");
  if (said.some((operand) => operand.baseType === "unknown")) {
    return singleOf("unknown");
  }

  return singleOf(
    said.length > 0 && said.every((operand) => operand.baseType === "integer")
      ? "integer"
      : "float",
  );
};

/**
 * The rule of `qti-sum`, `qti-product`, `qti-min` and `qti-max`: the numerical aggregate of one or
 * more numbers, each single, multiple or ordered, so each operand of another type is a mismatch
 * that accepts `integer` and `float`, `multiple`, `ordered` and `single`.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpSum
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpProduct
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMin
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMax
 */
const aggregateRule: KindRule = {
  operandsAccept: everyOperand(numerical, ["multiple", "ordered", "single"]),
  references: [],
  resultType: numericalAggregate,
};

/**
 * The rule of `qti-subtract`: the numerical aggregate of two single numbers, so each operand of
 * another type is a mismatch that accepts `integer` and `float`, `single`.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpSubcontract
 */
const subtractRule: KindRule = {
  operandsAccept: everyOperand(numerical, ["single"]),
  references: [],
  resultType: numericalAggregate,
};

/**
 * The rule of `qti-divide`: a single float, of two single numbers.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDivide
 */
const divideRule: KindRule = {
  operandsAccept: everyOperand(numerical, ["single"]),
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The arithmetic family's kind rules by kind.
 */
export const arithmeticRules: FamilyRules<
  "divide" | "max" | "min" | "product" | "subtract" | "sum"
> = {
  divide: divideRule,
  max: aggregateRule,
  min: aggregateRule,
  product: aggregateRule,
  subtract: subtractRule,
  sum: aggregateRule,
};

/**
 * The reader spec of `qti-sum`: its operands, one or more, and no attribute.
 */
const sumReader: ReaderSpec<"sum"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "sum", operands })),
};

/**
 * The reader spec of `qti-product`: its operands, one or more, and no attribute.
 */
const productReader: ReaderSpec<"product"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "product", operands })),
};

/**
 * The reader spec of `qti-subtract`: its two operands, and no attribute.
 */
const subtractReader: ReaderSpec<"subtract"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "subtract", operands })),
};

/**
 * The reader spec of `qti-divide`: its two operands, and no attribute.
 */
const divideReader: ReaderSpec<"divide"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "divide", operands })),
};

/**
 * The reader spec of `qti-min`: its operands, one or more, and no attribute.
 */
const minReader: ReaderSpec<"min"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "min", operands })),
};

/**
 * The reader spec of `qti-max`: its operands, one or more, and no attribute.
 */
const maxReader: ReaderSpec<"max"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "max", operands })),
};

/**
 * The arithmetic family's reader specs by kind.
 */
export const arithmeticReaders: FamilyReaders<
  "divide" | "max" | "min" | "product" | "subtract" | "sum"
> = {
  divide: divideReader,
  max: maxReader,
  min: minReader,
  product: productReader,
  subtract: subtractReader,
  sum: sumReader,
};
