/**
 * The containers family of the item model: the kind rules and reader specs of `qti-is-null`,
 * `qti-multiple`, `qti-ordered`, `qti-repeat`, `qti-container-size`, `qti-index`, `qti-random`,
 * `qti-member`, `qti-delete`, `qti-contains` and `qti-field-value`.
 *
 * The constructors (`qti-multiple`, `qti-ordered`, `qti-repeat`) give a container of the base type
 * their operands share; the readers (`qti-container-size`, `qti-index`, `qti-random`) take a
 * container of any base type; and `qti-member`, `qti-delete` and `qti-contains` relate their two
 * operands. A rule that relates its operands judges each against the base type the first operand
 * that says one sets, as the qti package's operand rules do (P23, the `One base` law in
 * `packages/pantry/src/qti/expressions.ts`). `qti-index`'s `n` and `qti-repeat`'s `number-repeats`
 * may name an integer variable, so their rules declare them in their reference facet, and the
 * validator, the walks and the engine check and resolve them from there. `qti-field-value` reads a
 * field of a record, whose `field-identifier` names a field inside the record, never a variable,
 * so its rule declares no reference.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts`, the leaf
 * `#plate/model/attributes.ts` and `#plate/vocabulary.ts`, and names the registry's reader types
 * with `import type` only, so the registry in `#plate/model/expressions/read.ts` may import it
 * without a cycle.
 *
 * @module
 */
import { Result } from "effect";
import { identifierAttribute, requiredValue } from "#plate/model/attributes.ts";
import {
  accepts,
  acceptsAnyOperands,
  everyOperand,
  intOrIdentifierOf,
  singleOf,
} from "#plate/model/expression.ts";
import type {
  ExpressionType,
  FamilyRules,
  KindRule,
  OperandMismatch,
} from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";
import { baseTypes } from "#plate/vocabulary.ts";
import type { BaseType, Cardinality } from "#plate/vocabulary.ts";

/**
 * The base types `qti-member` and `qti-contains` accept: every base type but `duration`, which the
 * information model says they "must not be used on", in the vocabulary's order.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMember
 */
const notDuration: readonly BaseType[] = baseTypes.filter((baseType) => baseType !== "duration");

/**
 * The two container cardinalities.
 */
const containers: readonly Cardinality[] = ["multiple", "ordered"];

/**
 * Give the base type a type says, none when it says nothing yet (`any` or `unknown`).
 *
 * @param type The type.
 * @returns The base type, or `undefined`.
 */
const concrete = (type: ExpressionType): BaseType | undefined =>
  type.baseType === "any" || type.baseType === "unknown" ? undefined : type.baseType;

/**
 * Give the base type operands share, as the qti package joins them (the `container` typing in
 * `packages/pantry/src/grammar/expression.ts`): `any` for no operands or only `any` ones, which
 * yield to the others; one base type when every other operand has it; `unknown` when any operand
 * is unknown or two differ, which the operand rule refuses on its own. So a container beside a
 * `qti-custom-operator`'s value is unknown, which every rule that takes it accepts, and the engine
 * gives it NULL, the one value of every type (`untyped` in
 * `#plate/engine/expressions/containers.ts`).
 *
 * @param operands The operands' types.
 * @returns The shared base type.
 */
const sharedBase = (operands: readonly ExpressionType[]): ExpressionType["baseType"] => {
  let shared: ExpressionType["baseType"] = "any";
  for (const { baseType } of operands) {
    if (shared === "any") {
      shared = baseType;
    } else if (baseType !== "any" && baseType !== shared) {
      shared = "unknown";
    }
  }

  return shared;
};

/**
 * Construct the operand rule of a container constructor: every operand of one base type, set by
 * the first that says one, and of one of the cardinalities given. So each later operand of another
 * base type is a mismatch that accepts the set one, and each operand of another cardinality a
 * mismatch that accepts those given; an operand before the set base type accepts any. The qti
 * package refuses the same (`oneBase` and the cardinalities of `qti-multiple`, `qti-ordered` and
 * `qti-repeat` in `operandRules`).
 *
 * @param cardinalities The cardinalities each operand may have, in the rule's order.
 * @returns The rule.
 */
const oneBaseOf =
  (cardinalities: readonly Cardinality[]): KindRule["operandsAccept"] =>
  (operands) => {
    let set: BaseType | undefined;
    const mismatches: OperandMismatch[] = [];
    for (const [index, operand] of operands.entries()) {
      const accepted = set === undefined ? "any" : [set];
      if (!accepts(operand, accepted, cardinalities)) {
        mismatches.push({ baseTypes: accepted, cardinalities, position: index + 1 });
      }

      set ??= concrete(operand);
    }

    return mismatches;
  };

/**
 * Construct the operand rule of `qti-member`, `qti-delete` or `qti-contains`, whose two operands
 * share a base type, which the first sets: the first must have one of `firstCardinalities` and a
 * base type of `allowed`, and the second the first's base type when it says one it may have (else
 * one of `allowed`) and one of the cardinalities `secondCardinalities` gives from the first's type.
 *
 * @param allowed The base types either operand may have, or `any`.
 * @param firstCardinalities The cardinalities the first operand may have.
 * @param secondCardinalities The cardinalities the second operand may have, from the first's type.
 * @returns The rule, which gives each operand of a type it does not accept.
 */
const relatedPair =
  (
    allowed: readonly BaseType[] | "any",
    firstCardinalities: readonly Cardinality[],
    secondCardinalities: (first: ExpressionType) => readonly Cardinality[],
  ): KindRule["operandsAccept"] =>
  ([first, second]) => {
    if (first === undefined || second === undefined) {
      return [];
    }

    const set = concrete(first);
    const secondBaseTypes =
      set !== undefined && (allowed === "any" || allowed.includes(set)) ? [set] : allowed;
    const cardinalities = secondCardinalities(first);

    return [
      ...(accepts(first, allowed, firstCardinalities)
        ? []
        : [{ baseTypes: allowed, cardinalities: firstCardinalities, position: 1 }]),
      ...(accepts(second, secondBaseTypes, cardinalities)
        ? []
        : [{ baseTypes: secondBaseTypes, cardinalities, position: 2 }]),
    ];
  };

/**
 * The rule of `qti-is-null`: a single boolean, of an operand of any type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIsNull
 */
const isNullRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-multiple`: a multiple container of the base type its operands share, of
 * operands that are single or multiple and share one base type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMultiple
 */
const multipleRule: KindRule = {
  operandsAccept: oneBaseOf(["single", "multiple"]),
  references: [],
  resultType: (operands) => ({ baseType: sharedBase(operands), cardinality: "multiple" }),
};

/**
 * The rule of `qti-ordered`: an ordered container of the base type its operands share, of operands
 * that are single or ordered and share one base type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpOrdered
 */
const orderedRule: KindRule = {
  operandsAccept: oneBaseOf(["single", "ordered"]),
  references: [],
  resultType: (operands) => ({ baseType: sharedBase(operands), cardinality: "ordered" }),
};

/**
 * The rule of `qti-repeat`: `qti-ordered`'s, with a reference facet for its `number-repeats`,
 * which may name a variable of base type integer (`IntOrIdentifier`). A reference there is
 * checked: the validator refuses one that names no variable (P8) or a variable that is not a
 * single integer template or outcome variable (P24), and the walks mark one the engine does not
 * hold.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRepeat
 */
const repeatRule: KindRule = {
  ...orderedRule,
  references: [
    {
      attribute: "number-repeats",
      baseType: "integer",
      checked: true,
      field: "numberRepeats",
      list: false,
    },
  ],
};

/**
 * The rule of `qti-container-size`: a single integer, of a container of any base type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpContainerSize
 */
const containerSizeRule: KindRule = {
  operandsAccept: everyOperand("any", containers),
  references: [],
  resultType: () => singleOf("integer"),
};

/**
 * The rule of `qti-index`: a single value of its operand's base type, of a container of any base
 * type, with a reference facet for its `n`, which may name a variable of base type integer
 * (`IntOrIdentifier`), checked as `qti-repeat`'s `number-repeats` is. The qti package accepts a
 * multiple container as well as an ordered one, and so does this rule.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIndex
 */
const indexRule: KindRule = {
  operandsAccept: everyOperand("any", containers),
  references: [{ attribute: "n", baseType: "integer", checked: true, field: "n", list: false }],
  resultType: ([operand]) => singleOf(operand?.baseType ?? "unknown"),
};

/**
 * The rule of `qti-random`: a single value of its operand's base type, of a container of any base
 * type, typed as `qti-index` is. The information model takes "a sub-expression with a multiple or
 * ordered container value and any base-type", and the qti package accepts the same (its container
 * readers' operand rule) and types the result by its operand's base type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRandom
 */
const randomRule: KindRule = { ...indexRule, references: [] };

/**
 * The rule of `qti-member`: a single boolean, of a single value and a container of its base type,
 * neither of base type `duration`.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMember
 */
const memberRule: KindRule = {
  operandsAccept: relatedPair(notDuration, ["single"], () => containers),
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-delete`: the type of its second operand, of a single value and a container of
 * its base type. The information model says `qti-member`'s restrictions apply to it, but the qti
 * package refuses no `duration` here, so neither does this rule.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDelete
 */
const deleteRule: KindRule = {
  operandsAccept: relatedPair("any", ["single"], () => containers),
  references: [],
  resultType: ([, container]) => container ?? { baseType: "unknown", cardinality: "unknown" },
};

/**
 * The rule of `qti-contains`: a single boolean, of two containers of one base type and one
 * cardinality, neither of base type `duration`; the first sets both.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpContains
 */
const containsRule: KindRule = {
  operandsAccept: relatedPair(notDuration, containers, (first) =>
    first.cardinality === "multiple" || first.cardinality === "ordered"
      ? [first.cardinality]
      : containers,
  ),
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-field-value`: a single of base type `unknown`, of a record operand. The field's
 * base type is the record's to say, so the rule leaves it unknown, as the qti package types the
 * kind (its typing in `expressionTypings`, `packages/pantry/src/grammar/expression.ts`), and every
 * rule that takes a single accepts it. Its operand is a record, or of a cardinality not known yet,
 * as `qti-null`'s and `qti-custom-operator`'s are; one of any other cardinality is refused (P23),
 * as the qti package's operand rule of the kind refuses it (the `Operand fit` law in
 * `packages/pantry/src/qti/expressions.ts`).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpFieldValue
 */
const fieldValueRule: KindRule = {
  operandsAccept: everyOperand("any", ["record"]),
  references: [],
  resultType: () => singleOf("unknown"),
};

/**
 * The containers family's kind rules by kind.
 */
export const containersRules: FamilyRules<
  | "container-size"
  | "contains"
  | "delete"
  | "field-value"
  | "index"
  | "is-null"
  | "member"
  | "multiple"
  | "ordered"
  | "random"
  | "repeat"
> = {
  "container-size": containerSizeRule,
  contains: containsRule,
  delete: deleteRule,
  "field-value": fieldValueRule,
  index: indexRule,
  "is-null": isNullRule,
  member: memberRule,
  multiple: multipleRule,
  ordered: orderedRule,
  random: randomRule,
  repeat: repeatRule,
};

/**
 * The reader spec of `qti-is-null`: its one operand, and no attribute.
 */
const isNullReader: ReaderSpec<"is-null"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "is-null", operands })),
};

/**
 * The reader spec of `qti-multiple`: its operands, zero or more, and no attribute.
 */
const multipleReader: ReaderSpec<"multiple"> = {
  _tag: "generic",
  arity: "any",
  attributes: () => Result.succeed((operands) => ({ kind: "multiple", operands })),
};

/**
 * The reader spec of `qti-ordered`: its operands, zero or more, and no attribute.
 */
const orderedReader: ReaderSpec<"ordered"> = {
  _tag: "generic",
  arity: "any",
  attributes: () => Result.succeed((operands) => ({ kind: "ordered", operands })),
};

/**
 * The reader spec of `qti-repeat`: its operands, one or more (reading 21), and its required
 * `number-repeats`, an `xs:int` literal or the name of a variable, as `intOrIdentifierOf`
 * classifies it. A name is held as a reference here, whatever it names: the validator and the
 * walks judge it through the kind's reference facet. The range of a literal is the XSD's `xs:int`
 * member's.
 *
 * Its read fails with `missing-attribute` for an absent `number-repeats`, as a document the
 * validator refuses first would.
 */
const repeatReader: ReaderSpec<"repeat"> = {
  _tag: "generic",
  arity: "some",
  attributes: (context, element) =>
    Result.gen(function* readNumberRepeats() {
      const numberRepeats = intOrIdentifierOf(
        yield* requiredValue(context.walk, element, "number-repeats"),
      );

      return (operands) => ({ kind: "repeat", numberRepeats, operands });
    }),
};

/**
 * The reader spec of `qti-container-size`: its one operand, and no attribute.
 */
const containerSizeReader: ReaderSpec<"container-size"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "container-size", operands })),
};

/**
 * The reader spec of `qti-index`: its one operand, and its required `n`, an `xs:int` literal or the
 * name of a variable, read as `qti-repeat`'s `number-repeats` is. A literal below 1 is held as
 * written: the structure check refuses it (P11), and the engine gives NULL for an `n` below 1
 * (9.20).
 *
 * Its read fails with `missing-attribute` for an absent `n`, as a document the validator refuses
 * first would.
 */
const indexReader: ReaderSpec<"index"> = {
  _tag: "generic",
  arity: "one",
  attributes: (context, element) =>
    Result.gen(function* readIndexN() {
      const n = intOrIdentifierOf(yield* requiredValue(context.walk, element, "n"));

      return (operands) => ({ kind: "index", n, operands });
    }),
};

/**
 * The reader spec of `qti-random`: its one operand, and no attribute.
 */
const randomReader: ReaderSpec<"random"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "random", operands })),
};

/**
 * The reader spec of `qti-member`: its two operands, and no attribute.
 */
const memberReader: ReaderSpec<"member"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "member", operands })),
};

/**
 * The reader spec of `qti-delete`: its two operands, and no attribute.
 */
const deleteReader: ReaderSpec<"delete"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "delete", operands })),
};

/**
 * The reader spec of `qti-contains`: its two operands, and no attribute.
 */
const containsReader: ReaderSpec<"contains"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "contains", operands })),
};

/**
 * The reader spec of `qti-field-value`: its one operand, and its required `field-identifier`, the
 * NCName of the field it reads, read as `identifierOf` reads an identifier, its outer whitespace
 * gone.
 *
 * Its read fails with `missing-attribute` for an absent `field-identifier`, as a document the
 * validator refuses first would.
 */
const fieldValueReader: ReaderSpec<"field-value"> = {
  _tag: "generic",
  arity: "one",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "field-identifier"),
      (fieldIdentifier) => (operands) => ({ fieldIdentifier, kind: "field-value", operands }),
    ),
};

/**
 * The containers family's reader specs by kind.
 */
export const containersReaders: FamilyReaders<
  | "container-size"
  | "contains"
  | "delete"
  | "field-value"
  | "index"
  | "is-null"
  | "member"
  | "multiple"
  | "ordered"
  | "random"
  | "repeat"
> = {
  "container-size": containerSizeReader,
  contains: containsReader,
  delete: deleteReader,
  "field-value": fieldValueReader,
  index: indexReader,
  "is-null": isNullReader,
  member: memberReader,
  multiple: multipleReader,
  ordered: orderedReader,
  random: randomReader,
  repeat: repeatReader,
};
