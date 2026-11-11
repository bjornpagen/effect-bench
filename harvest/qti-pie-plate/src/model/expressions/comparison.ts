/**
 * The comparison family of the item model: the kind rules and reader specs of `qti-match`,
 * `qti-equal`, `qti-gt`, `qti-gte`, `qti-lt`, `qti-lte`, `qti-duration-lt` and `qti-duration-gte`.
 *
 * Each kind gives a single boolean. `qti-match` takes two operands of one type, never a duration;
 * the two duration kinds take single durations; the others take single numbers, integer or float,
 * since a duration is not numerical (G-R1, pending). `qti-equal`'s `tolerance` may name a variable,
 * so its rule declares it in its reference facet, unchecked (9.11): the walks mark a token that
 * names a variable the engine does not hold, and the engine resolves the rest.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts`, `#plate/vocabulary.ts` and the leaf
 * `#plate/model/attributes.ts`, and names the registry's reader types with `import type` only, so
 * the registry in `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import { enumerated, valueOf, xmlWhitespaceRun, xsBoolean } from "#plate/model/attributes.ts";
import {
  accepts,
  everyOperand,
  floatOrRefOf,
  singleOf,
  toleranceModes,
} from "#plate/model/expression.ts";
import type {
  ExpressionType,
  FamilyRules,
  FloatOrRef,
  KindRule,
  OperandMismatch,
} from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";
import { baseTypes, cardinalities } from "#plate/vocabulary.ts";
import type { BaseType, Cardinality } from "#plate/vocabulary.ts";

/**
 * The base types `qti-match` takes: every one but `duration`, which it "must not" compare, in the
 * order `base-type` lists them.
 */
const matchBaseTypes: readonly BaseType[] = baseTypes.filter((baseType) => baseType !== "duration");

/**
 * Give the base types `qti-match` takes at its second operand: the first operand's own, which sets
 * the base type, or every one `qti-match` takes when the first has none yet (`any` or `unknown`)
 * or is a duration, which is refused on its own.
 *
 * @param first The first operand's type.
 * @returns The base types.
 */
const matchedBaseTypes = (first: ExpressionType): readonly BaseType[] =>
  first.baseType === "any" || first.baseType === "unknown" || first.baseType === "duration"
    ? matchBaseTypes
    : [first.baseType];

/**
 * Give the mismatch of one operand, when a kind does not take its type there.
 *
 * @param type The operand's type.
 * @param takenBaseTypes The base types the kind takes there.
 * @param takenCardinalities The cardinalities the kind takes there.
 * @param position The operand's position, counted from 1.
 * @returns The mismatch, or none when the kind takes the type.
 */
const mismatchAt = (
  type: ExpressionType,
  takenBaseTypes: readonly BaseType[],
  takenCardinalities: readonly Cardinality[],
  position: number,
): readonly OperandMismatch[] =>
  accepts(type, takenBaseTypes, takenCardinalities)
    ? []
    : [{ baseTypes: takenBaseTypes, cardinalities: takenCardinalities, position }];

/**
 * The operand rule of `qti-match`: two operands of the same base type and cardinality, unless one
 * says nothing yet, and neither a duration, as the qti package reads it (P23, the `Operand fit` and
 * `One base` laws in `packages/pantry/src/qti/expressions.ts`, over the kind's typing in
 * `expressionTypings`, `packages/pantry/src/grammar/expression.ts`).
 *
 * The first operand sets the type: it is refused only as a duration, when it takes every base type
 * but `duration`, in any cardinality. The second takes the first's base type and cardinality, or
 * every non-duration base type and every cardinality where the first says nothing. So a `qti-match`
 * of an integer and a string refuses its second operand, and one of two durations both.
 *
 * @param operands The operands' types.
 * @returns Each operand `qti-match` does not take, with what it takes there.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMatch
 */
const matchOperands: KindRule["operandsAccept"] = ([first, second]) =>
  first === undefined || second === undefined
    ? []
    : [
        ...mismatchAt(first, matchBaseTypes, cardinalities, 1),
        ...mismatchAt(
          second,
          matchedBaseTypes(first),
          first.cardinality === "unknown" ? cardinalities : [first.cardinality],
          2,
        ),
      ];

/**
 * The rule of `qti-match`: a single boolean, of two operands of one type ({@link matchOperands}).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMatch
 */
const matchRule: KindRule = {
  operandsAccept: matchOperands,
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The operand rule of `qti-equal`, `qti-gt`, `qti-gte`, `qti-lt` and `qti-lte`: each operand must
 * be a single number, so each operand of another type is a mismatch that accepts `integer` and
 * `float`, `single`. Numerical is integer or float, never duration, as the qti package reads it
 * (P23).
 */
const numericalSingle: KindRule["operandsAccept"] = everyOperand(["integer", "float"], ["single"]);

/**
 * The rule of `qti-gt`, `qti-gte`, `qti-lt` and `qti-lte`: a single boolean, of two single
 * numbers.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGT
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpGTE
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLT
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpLTE
 */
const orderRule: KindRule = {
  operandsAccept: numericalSingle,
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-equal`: a single boolean, of "two sub-expressions which must both have single
 * cardinality and have a numerical base-type" (`info-compact.txt:11415`).
 *
 * Each token of its `tolerance` may name a float or integer variable (9.11), so its reference facet
 * lists the attribute, a list, unchecked. The structure check refuses a token that is neither an
 * `xs:double` nor an NCName (pantry's P6), and no prose rule refuses a name, as the qti package
 * checks none. The walks mark a token that names a variable the engine does not hold. A name is
 * resolved at run time, where only a template or outcome variable's value is used and any other
 * name gives NULL.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpEqual
 */
const equalRule: KindRule = {
  operandsAccept: numericalSingle,
  references: [
    { attribute: "tolerance", baseType: "float", checked: false, field: "tolerance", list: true },
  ],
  resultType: () => singleOf("boolean"),
};

/**
 * The rule of `qti-duration-lt` and `qti-duration-gte`: a single boolean, of "two sub-expressions
 * which must both have single cardinality and base-type duration" (`info.txt:9486`, `:9490`), as
 * the qti package reads it (P23, the `Operand fit` law in `packages/pantry/src/qti/expressions.ts`,
 * over the kinds' typings in `expressionTypings`, `packages/pantry/src/grammar/expression.ts`).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDurationLT
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDurationGTE
 */
const durationRule: KindRule = {
  operandsAccept: everyOperand(["duration"], ["single"]),
  references: [],
  resultType: () => singleOf("boolean"),
};

/**
 * The comparison family's kind rules by kind.
 */
export const comparisonRules: FamilyRules<
  "duration-gte" | "duration-lt" | "equal" | "gt" | "gte" | "lt" | "lte" | "match"
> = {
  "duration-gte": durationRule,
  "duration-lt": durationRule,
  equal: equalRule,
  gt: orderRule,
  gte: orderRule,
  lt: orderRule,
  lte: orderRule,
  match: matchRule,
};

/**
 * The reader spec of `qti-match`: its two operands, and no attribute.
 */
const matchReader: ReaderSpec<"match"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "match", operands })),
};

/**
 * The reader spec of `qti-equal`: its two operands and its attributes, in every tolerance mode.
 *
 * Its `tolerance-mode`, `tolerance`, `include-lower-bound` and `include-upper-bound` are read with
 * the XSD's defaults: `exact`, no tolerance, and both bounds included. Each token of `tolerance`,
 * an XSD list whose tokens are a number or a variable's name, is classified by `floatOrRefOf`, so a
 * token that names nothing is held as a reference and marks nothing here.
 *
 * Its read fails, as a document the validator refuses first would, with `attribute-type` for a
 * `tolerance-mode` outside its three values and `value-type` for a bound outside `xs:boolean`.
 */
const equalReader: ReaderSpec<"equal"> = {
  _tag: "generic",
  arity: "two",
  attributes: (context, element) =>
    Result.gen(function* readEqualAttributes() {
      const toleranceMode = Option.getOrElse(
        yield* enumerated(context.walk, element, "tolerance-mode", toleranceModes),
        () => "exact" as const,
      );
      const includeLowerBound = yield* xsBoolean(
        context.walk,
        element,
        "include-lower-bound",
        true,
      );
      const includeUpperBound = yield* xsBoolean(
        context.walk,
        element,
        "include-upper-bound",
        true,
      );
      const tolerance = Option.match(valueOf(element, "tolerance"), {
        onNone: (): readonly FloatOrRef[] => [],
        onSome: (written) =>
          written
            .split(xmlWhitespaceRun)
            .filter((token) => token !== "")
            .map((token) => floatOrRefOf(token)),
      });

      return (operands) => ({
        includeLowerBound,
        includeUpperBound,
        kind: "equal",
        operands,
        tolerance,
        toleranceMode,
      });
    }),
};

/**
 * The reader spec of `qti-gt`: its two operands, and no attribute.
 */
const gtReader: ReaderSpec<"gt"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "gt", operands })),
};

/**
 * The reader spec of `qti-gte`: its two operands, and no attribute.
 */
const gteReader: ReaderSpec<"gte"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "gte", operands })),
};

/**
 * The reader spec of `qti-lt`: its two operands, and no attribute.
 */
const ltReader: ReaderSpec<"lt"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "lt", operands })),
};

/**
 * The reader spec of `qti-lte`: its two operands, and no attribute.
 */
const lteReader: ReaderSpec<"lte"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "lte", operands })),
};

/**
 * The reader spec of `qti-duration-lt`: its two operands, and no attribute.
 */
const durationLtReader: ReaderSpec<"duration-lt"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "duration-lt", operands })),
};

/**
 * The reader spec of `qti-duration-gte`: its two operands, and no attribute.
 */
const durationGteReader: ReaderSpec<"duration-gte"> = {
  _tag: "generic",
  arity: "two",
  attributes: () => Result.succeed((operands) => ({ kind: "duration-gte", operands })),
};

/**
 * The comparison family's reader specs by kind.
 */
export const comparisonReaders: FamilyReaders<
  "duration-gte" | "duration-lt" | "equal" | "gt" | "gte" | "lt" | "lte" | "match"
> = {
  "duration-gte": durationGteReader,
  "duration-lt": durationLtReader,
  equal: equalReader,
  gt: gtReader,
  gte: gteReader,
  lt: ltReader,
  lte: lteReader,
  match: matchReader,
};
