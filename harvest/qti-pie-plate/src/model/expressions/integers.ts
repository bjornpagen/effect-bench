/**
 * The integers family of the item model: the kind rules and reader specs of `qti-integer-divide`,
 * `qti-integer-modulus`, `qti-integer-to-float`, `qti-gcd` and `qti-lcm`.
 *
 * `qti-integer-divide`, `qti-integer-modulus` and `qti-integer-to-float` take single integers;
 * `qti-gcd` and `qti-lcm` take integers of single, multiple or ordered cardinality. Each gives a
 * single integer but `qti-integer-to-float`, which gives a single float. No kind has an attribute,
 * so none declares a reference or a declaration.
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
 * The operand rule of `qti-integer-divide`, `qti-integer-modulus` and `qti-integer-to-float`: each
 * operand must be a single integer, so each operand of another type is a mismatch that accepts
 * `integer`, `single`. The qti package refuses the same (P23, the `Operand fit` law in
 * `packages/pantry/src/qti/expressions.ts`, over the kinds' typings in `expressionTypings`,
 * `packages/pantry/src/grammar/expression.ts`).
 */
const integerSingle: KindRule["operandsAccept"] = everyOperand(["integer"], ["single"]);

/**
 * The rule of `qti-integer-divide` and `qti-integer-modulus`: a single integer, of two single
 * integers.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIntDivide
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIntModulus
 */
const integerDivisionRule: KindRule = {
  operandsAccept: integerSingle,
  references: [],
  resultType: () => singleOf("integer"),
};

/**
 * The rule of `qti-integer-to-float`: a single float, of one single integer.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpInttoFloat
 */
const integerToFloatRule: KindRule = {
  operandsAccept: integerSingle,
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-gcd` and `qti-lcm`: a single integer, of operands that must each be integers of
 * multiple, ordered or single cardinality, so each operand of another type is a mismatch that
 * accepts `integer`, `multiple ordered single`, as the qti package's `operandRules` orders them
 * (P23).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGcd
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLcm
 */
const integerAggregateRule: KindRule = {
  operandsAccept: everyOperand(["integer"], ["multiple", "ordered", "single"]),
  references: [],
  resultType: () => singleOf("integer"),
};

/**
 * The integers family's kind rules by kind.
 */
export const integersRules: FamilyRules<
  "gcd" | "integer-divide" | "integer-modulus" | "integer-to-float" | "lcm"
> = {
  gcd: integerAggregateRule,
  "integer-divide": integerDivisionRule,
  "integer-modulus": integerDivisionRule,
  "integer-to-float": integerToFloatRule,
  lcm: integerAggregateRule,
};

/**
 * The reader spec of `qti-integer-divide`: its two operands, and no attribute.
 */
const integerDivideReader: ReaderSpec<"integer-divide"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "integer-divide", operands })),
};

/**
 * The reader spec of `qti-integer-modulus`: its two operands, and no attribute.
 */
const integerModulusReader: ReaderSpec<"integer-modulus"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "integer-modulus", operands })),
};

/**
 * The reader spec of `qti-integer-to-float`: its one operand, and no attribute.
 */
const integerToFloatReader: ReaderSpec<"integer-to-float"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "integer-to-float", operands })),
};

/**
 * The reader spec of `qti-gcd`: its operands, one or more, and no attribute.
 */
const gcdReader: ReaderSpec<"gcd"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "gcd", operands })),
};

/**
 * The reader spec of `qti-lcm`: its operands, one or more, and no attribute.
 */
const lcmReader: ReaderSpec<"lcm"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "lcm", operands })),
};

/**
 * The integers family's reader specs by kind.
 */
export const integersReaders: FamilyReaders<
  "gcd" | "integer-divide" | "integer-modulus" | "integer-to-float" | "lcm"
> = {
  gcd: gcdReader,
  "integer-divide": integerDivideReader,
  "integer-modulus": integerModulusReader,
  "integer-to-float": integerToFloatReader,
  lcm: lcmReader,
};
