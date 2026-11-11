/**
 * The test family of the item model: the kind rules and reader specs of the outcome-only
 * expressions `qti-number-correct`, `qti-number-incorrect`, `qti-number-presented`,
 * `qti-number-responded`, `qti-number-selected`, `qti-outcome-minimum`, `qti-outcome-maximum` and
 * `qti-test-variables`, which only a test's outcome processing holds (reading 23 refuses them
 * anywhere else, as `expression-placement`).
 *
 * Each kind reads the test's items through its filters, `section-identifier`, `include-category`
 * and `exclude-category`; the engine evaluates them over the test scope
 * (`#plate/engine/expressions/test.ts`). Their rules type them as the engine gives their values:
 * each count a single integer, `qti-outcome-minimum` and `qti-outcome-maximum` a multiple float,
 * and `qti-test-variables` a multiple of its written `base-type`, a float when it is weighted and
 * has none, and unknown otherwise (G-R3 199). So the validator refuses a multiple set straight into
 * a single outcome (P20), as the qti package does, and a minimum, a maximum or a weighted
 * `qti-test-variables` set into an integer, which the qti package's rows (the `qti-test-variables`
 * typing in `packages/pantry/src/grammar/expression.ts`, typed by the written `base-type` alone)
 * accept: an agreement difference G-R3 199 settles.
 *
 * It value-imports only `effect`, `#plate/model/expression.ts`, the leaf
 * `#plate/model/attributes.ts`, `#plate/model/values.ts` and `#plate/vocabulary.ts`, and names the
 * registry's reader types with `import type` only, so the registry in
 * `#plate/model/expressions/read.ts` may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { SourceElement } from "#plate/document/source.ts";
import {
  elementsOf,
  enumerated,
  identifierAttribute,
  identifierOf,
  valueOf,
  xmlWhitespaceRun,
} from "#plate/model/attributes.ts";
import { acceptsAnyOperands, singleOf } from "#plate/model/expression.ts";
import type { FamilyRules, KindRule } from "#plate/model/expression.ts";
import type { FamilyReaders, ReaderSpec, Variant } from "#plate/model/expressions/read.ts";
import { isModelled } from "#plate/model/values.ts";
import { baseTypes } from "#plate/vocabulary.ts";

/**
 * The five kinds that count the items they read.
 */
type CountKind =
  | "number-correct"
  | "number-incorrect"
  | "number-presented"
  | "number-responded"
  | "number-selected";

/**
 * The family's kinds.
 */
type TestKind = CountKind | "outcome-maximum" | "outcome-minimum" | "test-variables";

/**
 * The filters every kind of the family takes over the test's items, as its variant holds them.
 */
type Filters = Pick<
  Variant<"number-selected">,
  "excludeCategory" | "includeCategory" | "sectionIdentifier"
>;

/**
 * The rule of each count: a single integer, the number of items it counts, whatever it reads.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberCorrect
 */
const countRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => singleOf("integer"),
};

/**
 * The rule of `qti-outcome-minimum` and `qti-outcome-maximum`: a multiple float, whatever they
 * read. "The result has cardinality multiple and base-type float" (`info.txt:9352`, `:9356`; G-R3
 * 199), and the engine gives each value as a float.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutOutcomeMin
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutOutcomeMax
 */
const extremesRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: () => ({ baseType: "float", cardinality: "multiple" }),
};

/**
 * The rule of `qti-test-variables`: a multiple of the base type the caller passes in its
 * attributes, the expression's own `base-type`, which "also becomes the base-type of the result"
 * (`info.txt:71484`); with none, a float when it is weighted, since "when a weighting is specified
 * the result of the expression always has base-type float" (`info.txt:71457`; G-R3 199), and when
 * it is not, the base type the caller collected from the test's items (`collected`: integer when
 * every single integer or float declaration of the variable is integer, else float; G-R3 199),
 * unknown when the caller holds no items, as for a test checked alone.
 *
 * The information model words the unweighted case by the values the expression collects
 * (`info.txt:71484`); G-R3 199 decides it by the declarations, so a package the validator accepts
 * agrees with the engine's run (`collectedBaseType` in `#plate/engine/expressions/test.ts`) even
 * where every float value collected is NULL.
 *
 * A weighted one with a written `base-type` keeps that base type, the weight ignored, as a
 * `qti-variable` ignores a weight on a variable that is not numeric. A weight is defined only for a
 * `base-type` of `float` or none, so the validator refuses any other written with a weight
 * (`weightType` in `#plate/validate/rules.ts`, pantry's P29).
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutTestVariables
 */
const testVariablesRule: KindRule = {
  operandsAccept: acceptsAnyOperands,
  references: [],
  resultType: (_operands, attributes) => ({
    baseType:
      attributes.baseType ??
      (attributes.weighted === true ? "float" : (attributes.collected ?? "unknown")),
    cardinality: "multiple",
  }),
};

/**
 * The test family's kind rules by kind.
 */
export const testRules: FamilyRules<TestKind> = {
  "number-correct": countRule,
  "number-incorrect": countRule,
  "number-presented": countRule,
  "number-responded": countRule,
  "number-selected": countRule,
  "outcome-maximum": extremesRule,
  "outcome-minimum": extremesRule,
  "test-variables": testVariablesRule,
};

/**
 * Read a category list attribute, an XSD list of identifiers: its identifiers in written order,
 * an empty list when it is written empty, none when it is absent.
 *
 * @param element The kind's element.
 * @param name The attribute's name, `include-category` or `exclude-category`.
 * @returns The identifiers.
 */
const categoriesOf = (element: SourceElement, name: string): Option.Option<readonly string[]> =>
  Option.map(valueOf(element, name), (written) =>
    written.split(xmlWhitespaceRun).filter((token) => token !== ""),
  );

/**
 * Read the filters every kind of the family takes, each none when absent: the `section-identifier`,
 * read as an identifier, and the two category lists.
 *
 * @param element The kind's element.
 * @returns The filters.
 */
const filtersOf = (element: SourceElement): Filters => ({
  excludeCategory: categoriesOf(element, "exclude-category"),
  includeCategory: categoriesOf(element, "include-category"),
  sectionIdentifier: Option.map(valueOf(element, "section-identifier"), identifierOf),
});

/**
 * Read an optional `weight-identifier`, as an identifier.
 *
 * @param element The kind's element.
 * @returns The weight's identifier, none when absent.
 */
const weightOf = (element: SourceElement): Option.Option<string> =>
  Option.map(valueOf(element, "weight-identifier"), identifierOf);

/**
 * Construct the reader spec of a count: no operand, and its filters.
 *
 * @param build The count's variant from its filters and its operands.
 * @returns The spec.
 */
const countReader = <K extends CountKind>(
  build: (filters: Filters, operands: readonly []) => Variant<K>,
): ReaderSpec<K> => ({
  _tag: "generic",
  arity: "none",
  attributes: (_context, element) =>
    Result.succeed((operands) => build(filtersOf(element), operands)),
});

/**
 * Construct the reader spec of `qti-outcome-minimum` or `qti-outcome-maximum`: no operand, its
 * required `outcome-identifier`, its optional `weight-identifier`, and its filters.
 *
 * Its read fails with `missing-attribute` for an absent `outcome-identifier`, as a document the
 * validator refuses first would.
 *
 * @param build The kind's variant from its attributes and its operands.
 * @returns The spec.
 */
const boundReader = <K extends "outcome-maximum" | "outcome-minimum">(
  build: (
    attributes: Filters & {
      readonly outcomeIdentifier: string;
      readonly weightIdentifier: Option.Option<string>;
    },
    operands: readonly [],
  ) => Variant<K>,
): ReaderSpec<K> => ({
  _tag: "generic",
  arity: "none",
  attributes: (context, element) =>
    Result.map(
      identifierAttribute(context.walk, element, "outcome-identifier"),
      (outcomeIdentifier) => (operands) =>
        build(
          { ...filtersOf(element), outcomeIdentifier, weightIdentifier: weightOf(element) },
          operands,
        ),
    ),
});

/**
 * The reader spec of `qti-test-variables`: no operand, its required `variable-identifier`, its
 * optional `base-type` and `weight-identifier`, and its filters. A `base-type` of `file`, whose
 * values the value model does not hold, is the mark `base-type="file"` at its path, and builds
 * nothing, as `qti-base-value`'s reader marks it; so is an element with an operand, as the generic
 * reader marks a kind that takes none.
 *
 * Its read fails with `missing-attribute` for an absent `variable-identifier` and `attribute-type`
 * for a `base-type` outside its values, as a document the validator refuses first would.
 */
const testVariablesReader: ReaderSpec<"test-variables"> = {
  _tag: "custom",
  read: (context, element) =>
    Result.gen(function* readTestVariables() {
      if (elementsOf(element).length > 0) {
        return yield* context.unread(element);
      }

      const variableIdentifier = yield* identifierAttribute(
        context.walk,
        element,
        "variable-identifier",
      );
      const baseType = yield* enumerated(context.walk, element, "base-type", baseTypes);
      if (Option.isSome(baseType) && !isModelled(baseType.value)) {
        return yield* context.unread(element, `base-type="${baseType.value}"`);
      }

      return Option.some({
        ...filtersOf(element),
        baseType,
        kind: "test-variables",
        operands: [],
        variableIdentifier,
        weightIdentifier: weightOf(element),
      });
    }),
};

/**
 * The test family's reader specs by kind.
 */
export const testReaders: FamilyReaders<TestKind> = {
  "number-correct": countReader((filters, operands) => ({
    ...filters,
    kind: "number-correct",
    operands,
  })),
  "number-incorrect": countReader((filters, operands) => ({
    ...filters,
    kind: "number-incorrect",
    operands,
  })),
  "number-presented": countReader((filters, operands) => ({
    ...filters,
    kind: "number-presented",
    operands,
  })),
  "number-responded": countReader((filters, operands) => ({
    ...filters,
    kind: "number-responded",
    operands,
  })),
  "number-selected": countReader((filters, operands) => ({
    ...filters,
    kind: "number-selected",
    operands,
  })),
  "outcome-maximum": boundReader((attributes, operands) => ({
    ...attributes,
    kind: "outcome-maximum",
    operands,
  })),
  "outcome-minimum": boundReader((attributes, operands) => ({
    ...attributes,
    kind: "outcome-minimum",
    operands,
  })),
  "test-variables": testVariablesReader,
};
