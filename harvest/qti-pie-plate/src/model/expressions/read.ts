/**
 * The registry of the item model's expressions: every kind's rule and reader spec, by kind, from
 * the ten families under `#plate/model/expressions/`, and the one generic reader that reads every
 * expression element through them.
 *
 * The model, the validator and the engine read a kind through its entry here in place of a case
 * per kind, so a kind's rule and reader spec change in its family's own files alone. It
 * value-imports the ten families, which value-import `#plate/model/expression.ts` and the leaf
 * `#plate/model/attributes.ts`, never this module: they name its reader types with `import type`
 * only. So the value imports point one way: from the item model and the validator to here, and
 * from here to the families.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { SourceElement } from "#plate/document/source.ts";
import { elementsOf, isQti } from "#plate/model/attributes.ts";
import type { ModelWalk } from "#plate/model/attributes.ts";
import { expressionKinds } from "#plate/model/expression.ts";
import type { Expression, ExpressionKind, FamilyRules } from "#plate/model/expression.ts";
import { arithmeticReaders, arithmeticRules } from "#plate/model/expressions/arithmetic.ts";
import { comparisonReaders, comparisonRules } from "#plate/model/expressions/comparison.ts";
import { containersReaders, containersRules } from "#plate/model/expressions/containers.ts";
import { functionsReaders, functionsRules } from "#plate/model/expressions/functions.ts";
import { integersReaders, integersRules } from "#plate/model/expressions/integers.ts";
import { logicReaders, logicRules } from "#plate/model/expressions/logic.ts";
import { referencesReaders, referencesRules } from "#plate/model/expressions/references.ts";
import { roundingReaders, roundingRules } from "#plate/model/expressions/rounding.ts";
import { testReaders, testRules } from "#plate/model/expressions/test.ts";
import { textReaders, textRules } from "#plate/model/expressions/text.ts";
import type { Refusal } from "#plate/validate/refusal.ts";

/**
 * The variant of {@link Expression} of one kind.
 */
export type Variant<K extends ExpressionKind> = Extract<Expression, { readonly kind: K }>;

/**
 * What the item model gives the generic reader for one item: its walk, the names a string
 * attribute may name, and the two ways to record a mark. The item model builds it, so the build
 * that collects the marks stays private to it.
 */
export interface ExpressionReading {
  /**
   * The names of the variables the item holds: every declaration's identifier and the built-in
   * variables. `StringOrRef`'s classifier (`stringOrRefOf` in `#plate/model/expression.ts`) reads
   * a braced name as a reference only when it is one of them (ruling R1), so a literal is split
   * from a reference at read time.
   */
  readonly declared: ReadonlySet<string>;
  /**
   * Record a mark at an element and keep reading, so its operands are still read and marked, as
   * the text family does for a `qti-pattern-match` literal pattern that `compile` in
   * `#plate/model/regex.ts` refuses, a `qti-inside` coordinate written with `%` and every
   * `qti-custom-operator`.
   *
   * @param element The element the mark sits on.
   * @param feature The mark's key.
   */
  readonly mark: (element: SourceElement, feature: string) => Result.Result<void>;
  /**
   * Record a mark at an element and build nothing.
   *
   * @param element The element the engine does not run.
   * @param feature The mark's key, the element's name when absent.
   * @returns None, so the rule tree that holds the element is none.
   */
  readonly unread: (
    element: SourceElement,
    feature?: string,
  ) => Result.Result<Option.Option<never>>;
  /**
   * The walk a reader reads attributes and paths through, and builds refusals in.
   */
  readonly walk: ModelWalk;
}

/**
 * What a reader spec reads through: the item's {@link ExpressionReading}, and the recursion into
 * an operand, which reads it through the generic reader again.
 */
export interface ReaderContext extends ExpressionReading {
  /**
   * Read an operand element as an expression, through its own kind's reader spec.
   *
   * @param element The operand element.
   * @returns Its expression, none when it holds an element the engine does not run, or the
   *   refusal an attribute in it gives.
   */
  readonly expression: (
    element: SourceElement,
  ) => Result.Result<Option.Option<Expression>, Refusal>;
}

/**
 * The reader spec of a kind that reads itself: its operand count, its attributes, its marks and
 * its operands, in that order, through the context. `qti-base-value` reads its typed text and
 * `qti-custom-operator` marks itself and keeps reading.
 */
export interface CustomReader<K extends ExpressionKind> {
  readonly _tag: "custom";
  /**
   * Read the element.
   *
   * @param context The reader context.
   * @param element The kind's element.
   * @returns Its variant, none when it holds an element the engine does not run, or a refusal.
   */
  readonly read: (
    context: ReaderContext,
    element: SourceElement,
  ) => Result.Result<Option.Option<Variant<K>>, Refusal>;
}

/**
 * The reader spec of a kind the generic reader reads as data: its operand count, and how its
 * attributes read into the typed build of its variant from its operands.
 *
 * The generic reader marks the element at its path and builds nothing when its element children
 * do not fit `arity`; otherwise it reads the attributes, then every operand, in document order, so
 * every element in them the engine does not run is marked.
 */
interface GenericReader<
  K extends ExpressionKind,
  A extends string,
  O extends readonly Expression[],
> {
  readonly _tag: "generic";
  /**
   * The operand count: `none`, `one`, `two`, `some` (one or more) or `any` (zero or more).
   */
  readonly arity: A;
  /**
   * Read the kind's attributes, each as its XSD type reads it, a reference attribute through its
   * classifier, and give the build of the variant from its operands. The build is typed by the
   * variant, so a spec cannot drift from it.
   *
   * @param context The reader context.
   * @param element The kind's element.
   * @returns The build, or the refusal an attribute gives.
   */
  readonly attributes: (
    context: ReaderContext,
    element: SourceElement,
  ) => Result.Result<(operands: O) => Variant<K>, Refusal>;
}

/**
 * How the item model reads one expression kind: a custom reader, or a generic spec of one of the
 * five operand counts, whose build takes the operands as the count types them.
 */
export type ReaderSpec<K extends ExpressionKind> =
  | CustomReader<K>
  | GenericReader<K, "any", readonly Expression[]>
  | GenericReader<K, "none", readonly []>
  | GenericReader<K, "one", readonly [Expression]>
  | GenericReader<K, "some", readonly [Expression, ...Expression[]]>
  | GenericReader<K, "two", readonly [Expression, Expression]>;

/**
 * A family's reader specs: one entry per kind of the family.
 */
export type FamilyReaders<K extends ExpressionKind> = { readonly [P in K]: ReaderSpec<P> };

/**
 * Every kind's rule: the ten families' tables in one, keyed by {@link ExpressionKind}. Its type
 * requires an entry for each of the 64 kinds, so a kind no family holds fails the type check.
 */
export const kindRules: FamilyRules<ExpressionKind> = {
  ...arithmeticRules,
  ...comparisonRules,
  ...containersRules,
  ...functionsRules,
  ...integersRules,
  ...logicRules,
  ...referencesRules,
  ...roundingRules,
  ...testRules,
  ...textRules,
};

/**
 * Every kind's reader spec: the ten families' tables in one, keyed by {@link ExpressionKind}, so a
 * kind no family reads fails the type check.
 */
export const kindReaders: FamilyReaders<ExpressionKind> = {
  ...arithmeticReaders,
  ...comparisonReaders,
  ...containersReaders,
  ...functionsReaders,
  ...integersReaders,
  ...logicReaders,
  ...referencesReaders,
  ...roundingReaders,
  ...testReaders,
  ...textReaders,
};

/**
 * Each kind, keyed by its element's local name, `qti-<kind>`.
 */
const kindsByElement: ReadonlyMap<string, ExpressionKind> = new Map(
  expressionKinds.map((kind) => [`qti-${kind}`, kind]),
);

/**
 * Read operand elements in document order, each through the generic reader, so every element in
 * them the engine does not run is marked, not only the first.
 *
 * @param context The reader context.
 * @param elements The operand elements.
 * @returns Their expressions, none when any holds an element the engine does not run, or the first
 *   refusal.
 */
const readAll = (
  context: ReaderContext,
  elements: readonly SourceElement[],
): Result.Result<Option.Option<readonly Expression[]>, Refusal> =>
  Result.gen(function* readOperandList() {
    const read: Option.Option<Expression>[] = [];
    for (const element of elements) {
      read.push(yield* context.expression(element));
    }

    return Option.all(read);
  });

/**
 * Read an element through a generic reader spec: its operand count first, then its attributes,
 * then its operands in document order.
 *
 * @param context The reader context.
 * @param element The kind's element.
 * @param spec The kind's generic spec.
 * @returns The variant, none when its children do not fit the count or an operand holds an
 *   element the engine does not run, or the refusal an attribute gives.
 */
const readGeneric = (
  context: ReaderContext,
  element: SourceElement,
  spec: Exclude<ReaderSpec<ExpressionKind>, CustomReader<ExpressionKind>>,
): Result.Result<Option.Option<Expression>, Refusal> =>
  Result.gen(function* readOperands() {
    const children = elementsOf(element);
    switch (spec.arity) {
      case "none": {
        if (children.length > 0) {
          return yield* context.unread(element);
        }

        const build = yield* spec.attributes(context, element);

        return Option.some(build([]));
      }
      case "one": {
        const [operand, ...extra] = children;
        if (operand === undefined || extra.length > 0) {
          return yield* context.unread(element);
        }

        const build = yield* spec.attributes(context, element);
        const read = yield* context.expression(operand);

        return read.pipe(Option.map((only) => build([only])));
      }
      case "two": {
        const [left, right, ...extra] = children;
        if (left === undefined || right === undefined || extra.length > 0) {
          return yield* context.unread(element);
        }

        const build = yield* spec.attributes(context, element);
        const read = Option.all([
          yield* context.expression(left),
          yield* context.expression(right),
        ]);

        return read.pipe(Option.map((pair) => build(pair)));
      }
      case "some": {
        const [first, ...rest] = children;
        if (first === undefined) {
          return yield* context.unread(element);
        }

        const build = yield* spec.attributes(context, element);
        const head = yield* context.expression(first);
        const tail = yield* readAll(context, rest);

        return Option.all([head, tail]).pipe(
          Option.map(([operand, operands]) => build([operand, ...operands])),
        );
      }
      case "any": {
        const build = yield* spec.attributes(context, element);
        const read = yield* readAll(context, children);

        return read.pipe(Option.map((operands) => build(operands)));
      }
      default: {
        return spec satisfies never;
      }
    }
  });

/**
 * Read an expression element: one in the QTI namespace named `qti-<kind>` for one of the 64 kinds
 * by that kind's reader spec, and any other element as one the engine does not run, marked by its
 * name. Operands are read through this reader again.
 *
 * @param reading The item's reading context.
 * @param element The expression element.
 * @returns The expression, none when it holds anything the engine does not run, each such thing
 *   marked, or the refusal an attribute gives, such as `value-type` for a `qti-base-value` outside
 *   its lexical space.
 */
export const readExpression = (
  reading: ExpressionReading,
  element: SourceElement,
): Result.Result<Option.Option<Expression>, Refusal> => {
  const kind = isQti(element) ? kindsByElement.get(element.local) : undefined;
  if (kind === undefined) {
    return reading.unread(element);
  }

  const context: ReaderContext = {
    ...reading,
    expression: (operand) => readExpression(reading, operand),
  };
  const spec: ReaderSpec<ExpressionKind> = kindReaders[kind];
  switch (spec._tag) {
    case "custom": {
      return spec.read(context, element);
    }
    case "generic": {
      return readGeneric(context, element, spec);
    }
    default: {
      return spec satisfies never;
    }
  }
};
