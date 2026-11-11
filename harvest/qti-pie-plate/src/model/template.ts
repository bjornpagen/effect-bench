/**
 * The template processing reader: a `qti-template-processing` read into the template rules the
 * item model holds as `Item.templateProcessing`.
 *
 * It reads each rule through the vocabulary's list of template rules (`renders.templateRules` in
 * `#plate/vocabulary.ts`) and each expression through the registry's generic reader
 * (`readExpression` in `#plate/model/expressions/read.ts`), in the reading context the item model
 * builds, so the marks it records join the item's. Template processing that holds any element
 * outside that list, a rule of a malformed shape, or a rule that sets a record response is none,
 * each such element marked, as response processing is. It value-imports the registry, the attribute
 * leaf and the vocabulary, never `#plate/model/item.ts`, which imports it.
 *
 * @module
 */
import { Array as Arr, Option, Result } from "effect";
import type { SourceElement } from "#plate/document/source.ts";
import { elementsOf, identifierAttribute, isQti } from "#plate/model/attributes.ts";
import type { Expression, TemplateBranch, TemplateRule } from "#plate/model/expression.ts";
import { readExpression } from "#plate/model/expressions/read.ts";
import type { ExpressionReading } from "#plate/model/expressions/read.ts";
import type { Refusal } from "#plate/validate/refusal.ts";
import { renders } from "#plate/vocabulary.ts";

/**
 * The name of one template rule element, as the vocabulary lists it.
 */
type TemplateRuleName = (typeof renders.templateRules)[number];

/**
 * What template processing reads through: the item's {@link ExpressionReading}, and the identifiers
 * of the item's record responses, which no template rule the engine runs may set.
 */
interface TemplateReading extends ExpressionReading {
  readonly recordResponses: ReadonlySet<string>;
}

/**
 * How one template rule element reads: into its rule, none when it holds anything the engine does
 * not run, or a refusal.
 */
type RuleReader = (
  reading: TemplateReading,
  element: SourceElement,
) => Result.Result<Option.Option<TemplateRule>, Refusal>;

/**
 * Construct a branch of a template condition.
 *
 * @param when Its condition.
 * @param then The template rules it runs.
 * @returns The branch.
 */
const branchOf = (when: Expression, then: readonly TemplateRule[]): TemplateBranch => ({
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is the branch's rule list, the name section 0.5 of the phase-8 slice list fixes, as `Branch`'s is; it is an array, never a function, so no `await` treats a branch as a promise.
  then,
  when,
});

/**
 * Read a sequence of template rules.
 *
 * @param reading The item's reading context.
 * @param elements The rule elements, in order.
 * @returns The rules, none when any holds an element the engine does not run, or the first
 * refusal.
 */
const sequence = (
  reading: TemplateReading,
  elements: readonly SourceElement[],
): Result.Result<Option.Option<readonly TemplateRule[]>, Refusal> =>
  Result.gen(function* readSequence() {
    const read: Option.Option<TemplateRule>[] = [];
    for (const element of elements) {
      // oxlint-disable-next-line eslint/no-use-before-define -- `sequence` and `rule` are mutually recursive, as template conditions nest; the call runs only after both are defined.
      read.push(yield* rule(reading, element));
    }

    return Option.all(read);
  });

/**
 * Read the one expression a setting rule or a `qti-template-constraint` holds.
 *
 * @param reading The item's reading context.
 * @param element The rule element.
 * @returns The expression; none when the element does not hold exactly one child element, the
 *   element then marked by its name, or when its expression holds an element the engine does not
 *   run; or a refusal.
 */
const soleExpression = (
  reading: TemplateReading,
  element: SourceElement,
): Result.Result<Option.Option<Expression>, Refusal> => {
  const [operand, ...extra] = elementsOf(element);

  return operand === undefined || extra.length > 0
    ? reading.unread(element)
    : readExpression(reading, operand);
};

/**
 * Read a rule that names its target variable and holds one expression: a
 * `qti-set-template-value`, a `qti-set-correct-response` or a `qti-set-default-value`.
 *
 * A `qti-set-correct-response` or `qti-set-default-value` whose target is a record response is
 * marked `record-set` at the rule, and its expression is still read, so what it holds is marked
 * too. An expression gives a value, never a record, so the engine sets no record, and such
 * template processing does not run (G-R4, pending: a rule that sets a record response is marked
 * `record-set`, and the response keeps the default and the correct response its declaration
 * writes). A record outcome or template variable is not a record response; a rule that sets one
 * is marked as a name the engine does not hold (`unheldIdentifiers` in `#plate/model/item.ts`).
 *
 * @param kind The rule's kind.
 * @returns Its reader: the rule, none when it sets a record response, when the element does not
 *   hold exactly one expression or when its expression holds an element the engine does not run,
 *   or a refusal.
 */
const setting =
  (kind: "set-correct-response" | "set-default-value" | "set-template-value"): RuleReader =>
  (reading, element) =>
    Result.gen(function* readSetting() {
      const identifier = yield* identifierAttribute(reading.walk, element, "identifier");
      const setsRecord = kind !== "set-template-value" && reading.recordResponses.has(identifier);
      if (setsRecord) {
        yield* reading.mark(element, "record-set");
      }

      const read = yield* soleExpression(reading, element);

      return setsRecord
        ? Option.none()
        : read.pipe(Option.map((expression): TemplateRule => ({ expression, identifier, kind })));
    });

/**
 * Read a `qti-template-constraint`, which holds one expression.
 *
 * @param reading The item's reading context.
 * @param element The constraint.
 * @returns The rule, none when it does not hold exactly one expression or its expression holds an
 *   element the engine does not run, or a refusal.
 */
const constraint: RuleReader = (reading, element) =>
  Result.gen(function* readConstraint() {
    const read = yield* soleExpression(reading, element);

    return read.pipe(
      Option.map((expression): TemplateRule => ({ expression, kind: "template-constraint" })),
    );
  });

/**
 * Read a `qti-template-if` or `qti-template-else-if`: its first child is the condition and the
 * rest are the rules it runs.
 *
 * @param reading The item's reading context.
 * @param element The branch element.
 * @returns The branch, none when it holds no condition or an element the engine does not run, or a
 *   refusal.
 */
const branch = (
  reading: TemplateReading,
  element: SourceElement,
): Result.Result<Option.Option<TemplateBranch>, Refusal> =>
  Result.gen(function* readTemplateBranch() {
    const [test, ...body] = elementsOf(element);
    if (test === undefined) {
      return yield* reading.unread(element);
    }

    const when = yield* readExpression(reading, test);
    const run = yield* sequence(reading, body);

    return Option.all([when, run]).pipe(Option.map(([read, then]) => branchOf(read, then)));
  });

/**
 * Report whether a part of a template condition is a branch: a `qti-template-if` or a
 * `qti-template-else-if`.
 *
 * @param part The part.
 * @returns Whether it is one.
 */
const isBranch = (part: SourceElement): boolean =>
  isQti(part, "qti-template-if") || isQti(part, "qti-template-else-if");

/**
 * Read a `qti-template-condition`: its `qti-template-if` and each `qti-template-else-if` in order
 * as its branches, and its first `qti-template-else` as its otherwise. Every other child is marked
 * by its name, as a `qti-response-condition`'s is.
 *
 * @param reading The item's reading context.
 * @param element The condition.
 * @returns The rule, none when any part holds an element the engine does not run, or a refusal.
 */
const condition: RuleReader = (reading, element) =>
  Result.gen(function* readTemplateCondition() {
    const parts = elementsOf(element);
    const branches: Option.Option<TemplateBranch>[] = [];
    for (const part of parts.filter(isBranch)) {
      branches.push(yield* branch(reading, part));
    }

    const otherwise = yield* Option.match(
      Arr.findFirst(parts, (part) => isQti(part, "qti-template-else")),
      {
        onNone: () => Result.succeed(Option.some(Option.none<readonly TemplateRule[]>())),
        onSome: (part) => Result.map(sequence(reading, elementsOf(part)), Option.map(Option.some)),
      },
    );
    const strays: Option.Option<never>[] = [];
    for (const part of parts.filter(
      (each) => !isBranch(each) && !isQti(each, "qti-template-else"),
    )) {
      strays.push(yield* reading.unread(part));
    }

    return Option.map(
      Option.all({ branches: Option.all(branches), otherwise, strays: Option.all(strays) }),
      (read): TemplateRule => ({
        branches: read.branches,
        kind: "template-condition",
        otherwise: read.otherwise,
      }),
    );
  });

/**
 * Mark a part of a template condition met outside one, as a response rule reader marks an element
 * that is not a rule.
 *
 * @param reading The item's reading context.
 * @param element The part.
 * @returns None, so the processing that holds it is none.
 */
const misplaced: RuleReader = (reading, element) => reading.unread(element);

/**
 * Each template rule element's reader, by its name. The three parts of a template condition are
 * read by {@link condition}, so one met as a rule is misplaced.
 */
const readers = {
  "qti-exit-template": () => Result.succeed(Option.some<TemplateRule>({ kind: "exit-template" })),
  "qti-set-correct-response": setting("set-correct-response"),
  "qti-set-default-value": setting("set-default-value"),
  "qti-set-template-value": setting("set-template-value"),
  "qti-template-condition": condition,
  "qti-template-constraint": constraint,
  "qti-template-else": misplaced,
  "qti-template-else-if": misplaced,
  "qti-template-if": misplaced,
} satisfies { readonly [Name in TemplateRuleName]: RuleReader };

/**
 * Read one template rule element through its reader; any element outside the vocabulary's template
 * rules is marked by its name.
 *
 * @param reading The item's reading context.
 * @param element The rule element.
 * @returns The rule, none when it holds an element the engine does not run, or a refusal.
 */
const rule = (
  reading: TemplateReading,
  element: SourceElement,
): Result.Result<Option.Option<TemplateRule>, Refusal> =>
  Option.match(
    Arr.findFirst(renders.templateRules, (name) => isQti(element, name)),
    {
      onNone: () => reading.unread(element),
      onSome: (name) => readers[name](reading, element),
    },
  );

/**
 * Read a `qti-template-processing` into its template rules, in document order.
 *
 * A rule element outside the vocabulary's template rules, a rule of a malformed shape (a setting
 * rule or a constraint without exactly one expression, a branch with no condition, a stray part in
 * a condition), or a rule that sets a record response (`record-set`, {@link setting}) is marked at
 * its path, and the whole processing is then none, as `rules` in `#plate/model/item.ts` reads
 * response processing. A `qti-exit-template` is read whatever it holds, as a `qti-exit-response`
 * is.
 *
 * @param reading The item's reading context, which `#plate/model/item.ts` builds for its build.
 * @param processing The `qti-template-processing` element.
 * @param recordResponses The identifiers of the item's record responses.
 * @returns The rules, none when any holds an element the engine does not run, each such element
 *   marked; or the refusal an attribute gives: `value-type` for a `qti-base-value` outside its
 *   lexical space and, in a document the validator refuses first, `missing-attribute` for a rule
 *   with no `identifier`.
 */
export const templateRules = (
  reading: ExpressionReading,
  processing: SourceElement,
  recordResponses: ReadonlySet<string>,
): Result.Result<Option.Option<readonly TemplateRule[]>, Refusal> =>
  sequence({ ...reading, recordResponses }, elementsOf(processing));
