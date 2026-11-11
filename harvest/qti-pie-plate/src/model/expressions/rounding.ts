/**
 * The rounding family of the item model: the kind rules and reader specs of `qti-round`,
 * `qti-truncate`, `qti-round-to` and `qti-equal-rounded`.
 *
 * Each kind takes single numerical operands, integer or float, never duration. `qti-round` and
 * `qti-truncate` give a single integer, `qti-round-to` a single float and `qti-equal-rounded` a
 * single boolean. The `figures` of `qti-round-to` and `qti-equal-rounded` may name an integer
 * variable, so their rules declare it in their reference facet, and the validator, the walks and
 * the engine check and resolve it from there.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts` and the leaf
 * `#plate/model/attributes.ts`, and names the registry's reader types with `import type` only, so
 * the registry in `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import { enumerated, listed, requiredAttribute, requiredValue } from "#plate/model/attributes.ts";
import { everyOperand, integerOrRefOf, roundingModes, singleOf } from "#plate/model/expression.ts";
import type { FamilyRules, KindRule, ReferenceEntry } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec } from "#plate/model/expressions/read.ts";

/**
 * The operand rule of every rounding kind: each operand must be a single number, so each operand of
 * another type is a mismatch that accepts `integer` and `float`, `single`. Numerical is integer or
 * float, never duration (9.5), as the qti package reads it (P23, the `Operand fit` law in
 * `packages/pantry/src/qti/expressions.ts`, over the kinds' typings in `expressionTypings`,
 * `packages/pantry/src/grammar/expression.ts`).
 */
const numericalSingle: KindRule["operandsAccept"] = everyOperand(["integer", "float"], ["single"]);

/**
 * The reference facet of `qti-round-to` and `qti-equal-rounded`: `figures` may name a variable of
 * base type integer (`IntegerOrVariableRef`). A reference there is checked: the validator refuses
 * one that names no variable (P8) or a variable that is not a single integer template or outcome
 * variable (P24), and the walks mark one the engine does not hold.
 */
const figuresFacet: readonly ReferenceEntry[] = [
  { attribute: "figures", baseType: "integer", checked: true, field: "figures", list: false },
];

/**
 * The rule of `qti-round` and `qti-truncate`: a single integer, of one single number.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRound
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpTruncate
 */
const toIntegerRule: KindRule = {
  operandsAccept: numericalSingle,
  references: [],
  resultType: () => singleOf("integer"),
};

/**
 * The rule of `qti-round-to`: a single float, of one single number, with `figures` in its
 * reference facet.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRoundTo
 */
const roundToRule: KindRule = {
  operandsAccept: numericalSingle,
  references: figuresFacet,
  resultType: () => singleOf("float"),
};

/**
 * The rule of `qti-equal-rounded`: a single boolean, of two single numbers, with `figures` in its
 * reference facet.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpEqualRounded
 */
const equalRoundedRule: KindRule = {
  operandsAccept: numericalSingle,
  references: figuresFacet,
  resultType: () => singleOf("boolean"),
};

/**
 * The rounding family's kind rules by kind.
 */
export const roundingRules: FamilyRules<"equal-rounded" | "round" | "round-to" | "truncate"> = {
  "equal-rounded": equalRoundedRule,
  round: toIntegerRule,
  "round-to": roundToRule,
  truncate: toIntegerRule,
};

/**
 * The reader spec of `qti-round`: its one operand, and no attribute.
 */
const roundReader: ReaderSpec<"round"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "round", operands })),
};

/**
 * The reader spec of `qti-truncate`: its one operand, and no attribute.
 */
const truncateReader: ReaderSpec<"truncate"> = {
  _tag: "generic",
  arity: "one",
  attributes: () => Result.succeed((operands) => ({ kind: "truncate", operands })),
};

/**
 * The reader spec of `qti-round-to`: its one operand, its required `rounding-mode`, compared as
 * written (its XSD type restricts `xs:string`), and its required `figures`, an `xs:integer`
 * literal, exact at any size, or the name of a variable, as `integerOrRefOf` classifies it. A
 * name is held as a reference here, whatever it names: the validator and the walks judge it
 * through the kind's reference facet. A literal's range (reading 46) and its least value under the
 * rounding mode (P10) are the structure check's.
 *
 * Its read fails, as a document the validator refuses first would, with `missing-attribute` for
 * an absent `rounding-mode` or `figures` and `attribute-type` for a `rounding-mode` outside its two
 * values.
 */
const roundToReader: ReaderSpec<"round-to"> = {
  _tag: "generic",
  arity: "one",
  attributes: (context, element) =>
    Result.gen(function* readRoundTo() {
      const mode = yield* requiredAttribute(context.walk, element, "rounding-mode");
      const roundingMode = yield* listed(
        context.walk,
        element,
        "rounding-mode",
        mode,
        roundingModes,
      );
      const figures = integerOrRefOf(yield* requiredValue(context.walk, element, "figures"));

      return (operands) => ({ figures, kind: "round-to", operands, roundingMode });
    }),
};

/**
 * The reader spec of `qti-equal-rounded`: its two operands, its `rounding-mode`, compared as
 * written, with the XSD's default `significantFigures`, and its required `figures`, read as
 * `qti-round-to`'s is.
 *
 * Its read fails, as a document the validator refuses first would, with `missing-attribute` for
 * an absent `figures` and `attribute-type` for a `rounding-mode` outside its two values.
 */
const equalRoundedReader: ReaderSpec<"equal-rounded"> = {
  _tag: "generic",
  arity: "two",
  attributes: (context, element) =>
    Result.gen(function* readEqualRounded() {
      const roundingMode = Option.getOrElse(
        yield* enumerated(context.walk, element, "rounding-mode", roundingModes),
        () => "significantFigures" as const,
      );
      const figures = integerOrRefOf(yield* requiredValue(context.walk, element, "figures"));

      return (operands) => ({ figures, kind: "equal-rounded", operands, roundingMode });
    }),
};

/**
 * The rounding family's reader specs by kind.
 */
export const roundingReaders: FamilyReaders<"equal-rounded" | "round" | "round-to" | "truncate"> = {
  "equal-rounded": equalRoundedReader,
  round: roundReader,
  "round-to": roundToReader,
  truncate: truncateReader,
};
