/**
 * The logic family of the item model: the kind rules and reader specs of `qti-and`, `qti-or`,
 * `qti-not` and `qti-any-n`.
 *
 * Each kind takes single boolean operands and gives a single boolean. `qti-any-n`'s `min` and `max`
 * may name an integer variable, so its rule declares both in its reference facet, and the
 * validator, the walks and the engine check and resolve them from there.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts` and the leaf
 * `#plate/model/attributes.ts`, and names the registry's reader types with `import type` only, so
 * the registry in `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Result } from "effect";
import { requiredValue } from "#plate/model/attributes.ts";
import { everyOperand, integerOrRefOf, singleOf } from "#plate/model/expression.ts";
import type { FamilyRules, KindRule } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";

/**
 * The rule of `qti-and`, `qti-or` and `qti-not`: a single boolean, of operands that must each be a
 * single boolean, so each operand of another type is a mismatch that accepts `boolean`, `single`.
 * The qti package refuses the same (P23, the `Operand fit` law in
 * `packages/pantry/src/qti/expressions.ts`, over the kinds' typings in `expressionTypings`,
 * `packages/pantry/src/grammar/expression.ts`).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpAnd
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpOr
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpNot
 */
const logicRule: KindRule = {
  operandsAccept: everyOperand(["boolean"], ["single"]),
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-any-n`: the rule of the other logic kinds, with a reference facet for its `min`
 * and `max`, each of which may name a variable of base type integer (`IntegerOrVariableRef`). A
 * reference there is checked: the validator refuses one that names no variable (P8) or a variable
 * that is not a single integer template or outcome variable (P24), and the walks mark one the
 * engine does not hold.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpAnyN
 */
const anyNRule: KindRule = {
  ...logicRule,
  references: [
    { attribute: "min", baseType: "integer", checked: true, field: "min", list: false },
    { attribute: "max", baseType: "integer", checked: true, field: "max", list: false },
  ],
};

/**
 * The logic family's kind rules by kind.
 */
export const logicRules: FamilyRules<"and" | "any-n" | "not" | "or"> = {
  and: logicRule,
  "any-n": anyNRule,
  not: logicRule,
  or: logicRule,
};

/**
 * The reader spec of `qti-and`: its operands, one or more, and no attribute.
 */
const andReader: ReaderSpec<"and"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "and", operands })),
};

/**
 * The reader spec of `qti-or`: its operands, one or more, and no attribute.
 */
const orReader: ReaderSpec<"or"> = {
  _tag: "generic",
  arity: "some",
  attributes: () => Result.succeed((operands) => ({ kind: "or", operands })),
};

/**
 * The reader spec of `qti-not`: its one operand, and no attribute.
 */
const notReader: ReaderSpec<"not"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "not", operands })),
};

/**
 * The reader spec of `qti-any-n`: its operands, one or more, and its required `min` and `max`, each
 * an `xs:integer` literal or the name of a variable, as `integerOrRefOf` classifies it. A name is
 * held as a reference here, whatever it names: the validator and the walks judge it through the
 * kind's reference facet.
 *
 * Its read fails with `missing-attribute` for an absent `min` or `max`, as a document the validator
 * refuses first would.
 */
const anyNReader: ReaderSpec<"any-n"> = {
  _tag: "generic",
  arity: "some",
  attributes: (context, element) =>
    Result.gen(function* readAnyNBounds() {
      const min = integerOrRefOf(yield* requiredValue(context.walk, element, "min"));
      const max = integerOrRefOf(yield* requiredValue(context.walk, element, "max"));

      return (operands) => ({ kind: "any-n", max, min, operands });
    }),
};

/**
 * The logic family's reader specs by kind.
 */
export const logicReaders: FamilyReaders<"and" | "any-n" | "not" | "or"> = {
  and: andReader,
  "any-n": anyNReader,
  not: notReader,
  or: orReader,
};
