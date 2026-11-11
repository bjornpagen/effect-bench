/**
 * The references family of the item model: the kind rules and reader specs of `qti-variable`,
 * `qti-correct`, `qti-base-value`, `qti-map-response`, `qti-map-response-point`, `qti-default`,
 * `qti-null`, `qti-random-integer` and `qti-random-float`.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts`, the leaf
 * `#plate/model/attributes.ts`, `#plate/model/values.ts` and `#plate/vocabulary.ts`, and names the
 * registry's reader types with `import type` only, so the registry in
 * `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import {
  enumerated,
  identifierAttribute,
  identifierOf,
  pathOf,
  refusal,
  requiredValue,
  textOf,
  typed,
  valueOf,
} from "#plate/model/attributes.ts";
import {
  acceptsAnyOperands,
  floatOrRefOf,
  integerOrRefOf,
  singleOf,
} from "#plate/model/expression.ts";
import type { FamilyRules, FloatOrRef, IntegerOrRef, KindRule } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";
import { isModelled, parseElementText } from "#plate/model/values.ts";
import { baseTypes } from "#plate/vocabulary.ts";

/**
 * The result type of a kind that reads a declaration: the declaration's type, which the caller
 * passes in its attributes, unknown where it passes none.
 *
 * @param _operands The operands' types; the kind has none.
 * @param attributes The type of the declaration the kind names.
 * @returns The declaration's type.
 */
const declared: KindRule["resultType"] = (_operands, attributes) => ({
  baseType: attributes.baseType ?? "unknown",
  cardinality: attributes.cardinality ?? "unknown",
});

/**
 * The rule of `qti-variable`: the type of the variable it names, a response, an outcome, a
 * template or context variable, or a built-in, whose value it reads.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpVariable
 */
const variableRule: KindRule = {
  declaration: { attribute: "identifier", expected: "variable" },
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: declared,
};

/**
 * The rule of `qti-correct`: the type of the response it names, whose correct response it reads.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpCorrect
 */
const correctRule: KindRule = {
  declaration: { attribute: "identifier", expected: "response" },
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: declared,
};

/**
 * The rule of `qti-default`: the type of the variable it names, a response, an outcome, a template
 * or context variable, or a built-in, whose declared default value it reads. The declaration facet
 * types it as that declaration and has the validator refuse a name no variable has (P8) and the
 * walks mark one the engine does not hold, as for `qti-variable`.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpDefault
 */
const defaultRule: KindRule = {
  declaration: { attribute: "identifier", expected: "variable" },
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: declared,
};

/**
 * The rule of `qti-null`: a NULL "treated as if it is of any desired base-type", so any base type
 * of a cardinality unknown, which every operand rule and every check of a type accepts. The qti
 * package types it the same (its typing in `expressionTypings`,
 * `packages/pantry/src/grammar/expression.ts`: `any`, `unknown`).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-null
 */
const nullRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => ({ baseType: "any", cardinality: "unknown" }),
};

/**
 * The rule of `qti-base-value`: a single value of its `base-type`, which the caller passes in its
 * attributes.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpBaseValue
 */
const baseValueRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: (_operands, attributes) => singleOf(attributes.baseType ?? "unknown"),
};

/**
 * The rule of `qti-map-response`: a single float, the mapped value of the response it names.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponse
 */
const mapResponseRule: KindRule = {
  declaration: { attribute: "identifier", expected: "response" },
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-map-response-point`: a single float, the mapped value of the point response it
 * names.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponsePoint
 */
const mapResponsePointRule: KindRule = {
  declaration: { attribute: "identifier", expected: "response" },
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-random-integer`: a single integer, drawn from its range, with a reference facet
 * for its `min`, `max` and `step`, each of which may name a variable of base type integer
 * (`IntegerOrVariableRef`). A reference there is checked: the validator refuses one that names no
 * variable (P8) or a variable that is not a single integer template or outcome variable (P24), and
 * the walks mark one the engine does not hold.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-random-integer
 */
const randomIntegerRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [
    { attribute: "min", baseType: "integer", checked: true, field: "min", list: false },
    { attribute: "max", baseType: "integer", checked: true, field: "max", list: false },
    { attribute: "step", baseType: "integer", checked: true, field: "step", list: false },
  ],
  resultType: () => singleOf("integer"),
};

/**
 * The rule of `qti-random-float`: a single float, drawn from its range, with a reference facet for
 * its `min` and `max`, each of which may name a variable of base type float
 * (`FloatOrVariableRef`), checked as `qti-random-integer`'s are.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-random-float
 */
const randomFloatRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [
    { attribute: "min", baseType: "float", checked: true, field: "min", list: false },
    { attribute: "max", baseType: "float", checked: true, field: "max", list: false },
  ],
  resultType: () => singleOf("float"),
};

/**
 * The references family's kind rules by kind.
 */
export const referencesRules: FamilyRules<
  | "base-value"
  | "correct"
  | "default"
  | "map-response"
  | "map-response-point"
  | "null"
  | "random-float"
  | "random-integer"
  | "variable"
> = {
  "base-value": baseValueRule,
  correct: correctRule,
  default: defaultRule,
  "map-response": mapResponseRule,
  "map-response-point": mapResponsePointRule,
  null: nullRule,
  "random-float": randomFloatRule,
  "random-integer": randomIntegerRule,
  variable: variableRule,
};

/**
 * The reader spec of `qti-variable`: no operand, its `identifier`, and its optional
 * `weight-identifier`, which is held and which an item's processing never evaluates.
 */
const variableReader: ReaderSpec<"variable"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "identifier"),
      (identifier) => (operands) => ({
        identifier,
        kind: "variable",
        operands,
        weightIdentifier: Option.map(valueOf(element, "weight-identifier"), identifierOf),
      }),
    ),
};

/**
 * The reader spec of `qti-correct`: no operand, and its `identifier`.
 */
const correctReader: ReaderSpec<"correct"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "identifier"),
      (identifier) => (operands) => ({ identifier, kind: "correct", operands }),
    ),
};

/**
 * The reader spec of `qti-map-response`: no operand, and its `identifier`.
 */
const mapResponseReader: ReaderSpec<"map-response"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "identifier"),
      (identifier) => (operands) => ({ identifier, kind: "map-response", operands }),
    ),
};

/**
 * The reader spec of `qti-map-response-point`: no operand, and its `identifier`.
 */
const mapResponsePointReader: ReaderSpec<"map-response-point"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "identifier"),
      (identifier) => (operands) => ({ identifier, kind: "map-response-point", operands }),
    ),
};

/**
 * The reader spec of `qti-default`: no operand, and its `identifier`.
 */
const defaultReader: ReaderSpec<"default"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "identifier"),
      (identifier) => (operands) => ({ identifier, kind: "default", operands }),
    ),
};

/**
 * The reader spec of `qti-null`: no operand, and no attribute.
 */
const nullReader: ReaderSpec<"null"> = {
  _tag: "generic",
  arity: "none",
  attributes: () => Result.succeed((operands) => ({ kind: "null", operands })),
};

/**
 * The reader spec of `qti-base-value`: its `base-type` and its text, typed as that base type, a
 * duration as its seconds. `file`, the base type the value model does not hold, is the mark
 * `base-type="file"` at its path, and builds nothing.
 *
 * Its read fails with `value-type` for text outside the base type's lexical space, at the
 * element's path. A document the validator refuses first can also fail it with
 * `missing-attribute` for an absent `base-type` and `attribute-type` for one outside its values.
 */
const baseValueReader: ReaderSpec<"base-value"> = {
  _tag: "custom",
  read: (context, element) =>
    Result.gen(function* readBaseValue() {
      const baseType = yield* enumerated(context.walk, element, "base-type", baseTypes);
      if (Option.isNone(baseType)) {
        return yield* Result.fail(
          refusal(context.walk, "missing-attribute", pathOf(context.walk, element), {
            attribute: "base-type",
            element: element.local,
          }),
        );
      }

      if (!isModelled(baseType.value)) {
        return yield* context.unread(element, `base-type="${baseType.value}"`);
      }

      const single = yield* typed(
        context.walk,
        pathOf(context.walk, element),
        parseElementText(baseType.value, textOf(element)),
      );

      return Option.some({
        kind: "base-value",
        operands: [],
        value: {
          baseType: baseType.value,
          cardinality: "single",
          values: Option.toArray(single),
        },
      });
    }),
};

/**
 * The literal 0, the `min` a `qti-random-integer` holds when the attribute is absent.
 */
const integerZero: IntegerOrRef = { _tag: "literal", value: 0n };

/**
 * The literal 1, the `step` a `qti-random-integer` holds when the attribute is absent.
 */
const integerOne: IntegerOrRef = { _tag: "literal", value: 1n };

/**
 * The literal 0, the `min` a `qti-random-float` holds when the attribute is absent.
 */
const floatZero: FloatOrRef = { _tag: "literal", value: 0 };

/**
 * The reader spec of `qti-random-integer`: no operand, its required `max`, and its `min` and
 * `step`, 0 and 1 when absent, each an `xs:integer` literal or the name of a variable, as
 * `integerOrRefOf` classifies it. A name is held as a reference here, whatever it names: the
 * validator and the walks judge it through the kind's reference facet.
 *
 * Its read fails with `missing-attribute` for an absent `max`, as a document the validator refuses
 * first would.
 */
const randomIntegerReader: ReaderSpec<"random-integer"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(requiredValue(context.walk, element, "max"), (written) => {
      const max = integerOrRefOf(written);
      const min = Option.match(valueOf(element, "min"), {
        onNone: () => integerZero,
        onSome: integerOrRefOf,
      });
      const step = Option.match(valueOf(element, "step"), {
        onNone: () => integerOne,
        onSome: integerOrRefOf,
      });

      return (operands) => ({ kind: "random-integer", max, min, operands, step });
    }),
};

/**
 * The reader spec of `qti-random-float`: no operand, its required `max`, and its `min`, 0 when
 * absent, each an `xs:double` literal or the name of a variable, as `floatOrRefOf` classifies it.
 * A name is held as a reference here, whatever it names: the validator and the walks judge it
 * through the kind's reference facet.
 *
 * Its read fails with `missing-attribute` for an absent `max`, as a document the validator refuses
 * first would.
 */
const randomFloatReader: ReaderSpec<"random-float"> = {
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(requiredValue(context.walk, element, "max"), (written) => {
      const max = floatOrRefOf(written);
      const min = Option.match(valueOf(element, "min"), {
        onNone: () => floatZero,
        onSome: floatOrRefOf,
      });

      return (operands) => ({ kind: "random-float", max, min, operands });
    }),
};

/**
 * The references family's reader specs by kind.
 */
export const referencesReaders: FamilyReaders<
  | "base-value"
  | "correct"
  | "default"
  | "map-response"
  | "map-response-point"
  | "null"
  | "random-float"
  | "random-integer"
  | "variable"
> = {
  "base-value": baseValueReader,
  correct: correctReader,
  default: defaultReader,
  "map-response": mapResponseReader,
  "map-response-point": mapResponsePointReader,
  null: nullReader,
  "random-float": randomFloatReader,
  "random-integer": randomIntegerReader,
  variable: variableReader,
};
