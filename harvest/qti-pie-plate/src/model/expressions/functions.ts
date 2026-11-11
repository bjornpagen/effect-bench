/**
 * The functions family of the item model: the kind rules and reader specs of `qti-math-operator`,
 * `qti-math-constant`, `qti-stats-operator` and `qti-power`.
 *
 * Each kind gives a single float, except `qti-math-operator`'s `signum`, `floor` and `ceil`, which
 * give a single integer, so its rule reads the operator name its caller passes. Each operand is
 * numerical, an integer or a float: a single one for `qti-math-operator` and `qti-power`, a
 * container for `qti-stats-operator`. No kind has an attribute that names a variable.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts` and the leaf
 * `#plate/model/attributes.ts`, and names the registry's reader types with `import type` only, so
 * the registry in `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Result } from "effect";
import type { SourceElement } from "#plate/document/source.ts";
import { listed, requiredAttribute } from "#plate/model/attributes.ts";
import {
  acceptsAnyOperands,
  everyOperand,
  mathConstantNames,
  mathOperatorNames,
  singleOf,
  statsOperatorNames,
} from "#plate/model/expression.ts";
import type { FamilyRules, KindRule } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderContext, ReaderSpec } from "#plate/model/expressions/read.ts";
import type { Refusal } from "#plate/validate/refusal.ts";

/**
 * The `qti-math-operator` names whose result is an integer; every other name gives a float.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMathOp
 */
const integerMathOperators: ReadonlySet<string> = new Set(["ceil", "floor", "signum"]);

/**
 * The rule of `qti-math-operator`: a single integer for `signum`, `floor` and `ceil`, a single
 * float for every other name, and a single of no known base type when its caller passes no name.
 * Its operands must each be a single integer or float, whatever the name's arity: an operand count
 * that is not the name's (two for `atan2`, one for every other) is NULL at run time, never a
 * refusal (9.22). The qti package types and refuses the same (the kind's `attribute` typing and the
 * table `integerMathOperators` in `packages/pantry/src/grammar/expression.ts`, and P23's `Operand
 * fit` law in `packages/pantry/src/qti/expressions.ts`).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMathOp
 */
const mathOperatorRule: KindRule = {
  operandsAccept: everyOperand(["integer", "float"], ["single"]),
  references: [],
  resultType: (_operands, attributes) => {
    if (attributes.name === undefined) {
      return singleOf("unknown");
    }

    return singleOf(integerMathOperators.has(attributes.name) ? "integer" : "float");
  },
};

/**
 * The rule of `qti-math-constant`: a single float, of no operand.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMathConstant
 */
const mathConstantRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-stats-operator`: a single float, of one operand that must be a multiple or
 * ordered container of integers or floats. The qti package refuses the same (P23).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpStatsOp
 */
const statsOperatorRule: KindRule = {
  operandsAccept: everyOperand(["integer", "float"], ["multiple", "ordered"]),
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-power`: a single float, of two operands that must each be a single integer or
 * float. The qti package refuses the same (P23).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpPower
 */
const powerRule: KindRule = {
  operandsAccept: everyOperand(["integer", "float"], ["single"]),
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The functions family's kind rules by kind.
 */
export const functionsRules: FamilyRules<
  "math-constant" | "math-operator" | "power" | "stats-operator"
> = {
  "math-constant": mathConstantRule,
  "math-operator": mathOperatorRule,
  power: powerRule,
  "stats-operator": statsOperatorRule,
};

/**
 * Read the required `name` of an operator element, one of its closed list of names. The XSD types
 * each list as a restriction of `xs:string`, so a name is compared as written.
 *
 * @param context The reader context.
 * @param element The operator's element.
 * @param allowed The names it may take.
 * @returns The name, or the refusal `missing-attribute` when it is absent or `attribute-type` when
 *   it is not one of `allowed`, as a document the validator refuses first would.
 */
const operatorName = <const T extends string>(
  context: ReaderContext,
  element: SourceElement,
  allowed: readonly T[],
): Result.Result<T, Refusal> =>
  Result.flatMap(requiredAttribute(context.walk, element, "name"), (attribute) =>
    listed(context.walk, element, "name", attribute, allowed),
  );

/**
 * The reader spec of `qti-math-operator`: its operands, one or more, and its required `name`.
 */
const mathOperatorReader: ReaderSpec<"math-operator"> = {
  _tag: "generic",
  arity: "some",
  attributes: (context, element) =>
    Result.map(operatorName(context, element, mathOperatorNames), (name) => (operands) => ({
      kind: "math-operator",
      name,
      operands,
    })),
};

/**
 * The reader spec of `qti-math-constant`: no operand, and its required `name`.
 */
const mathConstantReader: ReaderSpec<"math-constant"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(operatorName(context, element, mathConstantNames), (name) => (operands) => ({
      kind: "math-constant",
      name,
      operands,
    })),
};

/**
 * The reader spec of `qti-stats-operator`: its one operand, and its required `name`.
 */
const statsOperatorReader: ReaderSpec<"stats-operator"> = {
  _tag: "generic",
  arity: "one",
  attributes: (context, element) =>
    Result.map(operatorName(context, element, statsOperatorNames), (name) => (operands) => ({
      kind: "stats-operator",
      name,
      operands,
    })),
};

/**
 * The reader spec of `qti-power`: its two operands, and no attribute.
 */
const powerReader: ReaderSpec<"power"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "power", operands })),
};

/**
 * The functions family's reader specs by kind.
 */
export const functionsReaders: FamilyReaders<
  "math-constant" | "math-operator" | "power" | "stats-operator"
> = {
  "math-constant": mathConstantReader,
  "math-operator": mathOperatorReader,
  power: powerReader,
  "stats-operator": statsOperatorReader,
};
