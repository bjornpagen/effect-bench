/**
 * The test model: what M2 reads from a valid `qti-assessment-test`, typed, with every feature it
 * accepts and does not deliver named as a mark.
 *
 * {@link buildTest} reads the parts, their sections and item references in document order, each
 * `qti-item-session-control` attribute by attribute, each item reference's weights, variable
 * mappings and template defaults, the test's outcome declarations through the item model's own
 * reader, and its outcome processing into the item model's rules through the registry's expression
 * reader, with the item model's element and attribute readers. The features `testMarks` lists are
 * marks on the verdict, never notices, and the tree leaves them out or holds them inert, so a
 * sequence walked from it ignores them.
 *
 * @module
 */
import { Array as Arr, Option, Result } from "effect";
import { attributePath, walk } from "#plate/document/source.ts";
import type { SourceAttribute, SourceDocument, SourceElement } from "#plate/document/source.ts";
import {
  attributeOf,
  childrenNamed,
  collapseXmlSpace,
  elementsOf,
  floatOf,
  greatestInt,
  identifierAttribute,
  identifierOf,
  isQti,
  leastInt,
  listed,
  nameOf,
  pathOf,
  refusal,
  requiredAttribute,
  requiredValue,
  valueOf,
  xmlWhitespaceRun,
  xsBoolean,
  xsBooleanOf,
} from "#plate/model/attributes.ts";
import type { ModelWalk } from "#plate/model/attributes.ts";
import type { Branch, Expression, KindRule, Rule } from "#plate/model/expression.ts";
import { kindRules, readExpression } from "#plate/model/expressions/read.ts";
import { testRules } from "#plate/model/expressions/test.ts";
import type { ExpressionReading } from "#plate/model/expressions/read.ts";
import { outcomeDeclaration, pathsOf } from "#plate/model/item.ts";
import type { OutcomeDeclaration, UnsupportedFeature } from "#plate/model/item.ts";
import { occurrenceOf } from "#plate/model/item-refs.ts";
import { integerLexical, parseLexical, trimXmlSpace } from "#plate/model/values.ts";
import type { Refusal } from "#plate/validate/refusal.ts";
import { navigationModes, renders, submissionModes, testMarks } from "#plate/vocabulary.ts";
import type {
  Condition,
  FeatureRule,
  NavigationMode,
  SubmissionMode,
  TestMark,
} from "#plate/vocabulary.ts";

/**
 * The seven attributes of a `qti-item-session-control`, each as the element writes it, or none when
 * it does not, or when the element has no `qti-item-session-control`. Nothing is filled in from an
 * enclosing element or a default here: the session resolves each attribute from the nearest element
 * that sets it.
 */
export interface ControlAttributes {
  readonly allowComment: Option.Option<boolean>;
  readonly allowReview: Option.Option<boolean>;
  readonly allowSkipping: Option.Option<boolean>;
  /**
   * `max-attempts`, an `xs:int`. A negative value is valid, kept as written, and marked
   * `max-attempts:negative`.
   */
  readonly maxAttempts: Option.Option<number>;
  readonly showFeedback: Option.Option<boolean>;
  readonly showSolution: Option.Option<boolean>;
  readonly validateResponses: Option.Option<boolean>;
}

/**
 * A `qti-template-default` the engine can apply: the template variable of the referenced item it
 * sets, and the expression the test evaluates for it, over the test's processing names.
 */
export interface TemplateDefault {
  readonly expression: Expression;
  readonly templateIdentifier: string;
}

/**
 * A `qti-assessment-item-ref`.
 */
export interface ItemRef {
  /**
   * The `category` identifiers, in written order; none when it is absent.
   */
  readonly category: readonly string[];
  readonly control: ControlAttributes;
  readonly fixed: boolean;
  /**
   * The `href` as `xs:anyURI` reads it: outer XML whitespace removed and each inner run collapsed
   * to one space. It is resolved against the test's own location in its package.
   */
  readonly href: string;
  readonly identifier: string;
  readonly kind: "item-ref";
  /**
   * Each `qti-variable-mapping`'s `target-identifier`, keyed to its `source-identifier`: a read of
   * the target through this item reference reads the item's source outcome.
   */
  readonly mappings: ReadonlyMap<string, string>;
  readonly required: boolean;
  /**
   * Each `qti-template-default` the engine can apply, in document order. One whose expression
   * reads a name the engine does not hold in a test, or holds an element the engine does not
   * run, is marked at its element and left out, so the template variable starts at the item's
   * own declared default.
   */
  readonly templateDefaults: readonly TemplateDefault[];
  /**
   * Each `qti-weight`'s `identifier`, keyed to its `value`, an `xs:double`.
   */
  readonly weights: ReadonlyMap<string, number>;
}

/**
 * A `qti-assessment-section`. `children` holds its sections and item references in document order;
 * a `qti-assessment-section-ref` is marked and not among them.
 */
export interface Section {
  readonly children: readonly SectionChild[];
  readonly control: ControlAttributes;
  readonly fixed: boolean;
  readonly identifier: string;
  readonly keepTogether: boolean;
  readonly kind: "section";
  readonly required: boolean;
  readonly title: string;
  readonly visible: boolean;
}

/**
 * What a section holds: a nested section or an item reference.
 */
export type SectionChild = ItemRef | Section;

/**
 * A `qti-test-part`. `children` holds its sections in document order; a
 * `qti-assessment-section-ref` is marked and not among them.
 */
export interface TestPart {
  readonly children: readonly Section[];
  readonly control: ControlAttributes;
  readonly identifier: string;
  readonly navigation: NavigationMode;
  readonly submission: SubmissionMode;
}

/**
 * A feature a test holds and M2 does not deliver, where it is. A test feature is always a mark on
 * the verdict, never a notice.
 */
export interface MarkedFeature extends UnsupportedFeature {
  readonly shown: "mark";
}

/**
 * A test's `qti-outcome-processing`, in one of three states: `absent` when the test has none,
 * `marked` when it has one the engine cannot run (its marks are in `Test.unsupported`), and `runs`
 * with its rules otherwise. A reader switches over the three exhaustively.
 */
export type OutcomeProcessing =
  | { readonly kind: "absent" }
  | { readonly kind: "marked" }
  | { readonly kind: "runs"; readonly rules: readonly Rule[] };

/**
 * A valid `qti-assessment-test` as M2 models it.
 *
 * `outcomes` holds the test's outcome declarations of modelled base types and cardinalities, as the
 * item model holds an item's, and `outcomeProcessing` its outcome processing in one of three
 * states. `unsupported` lists every feature not delivered, in document order, each once per feature
 * and path: the keys of `testMarks`, the marks the item model gives an outcome declaration it does
 * not hold, and the marks of outcome processing the engine cannot run. A package's test may follow
 * them with the marks only its items show ({@link withUnheldReads}) and those of its item refs that
 * name an LTI link ({@link withLtiLinks}).
 */
export interface Test {
  /**
   * Every identifier the test's outcome and context declarations declare, those the model does not
   * hold included, so a test-level read never splits a dotted one into an item ref and a variable.
   * `buildTest` always gives it; a test built by hand may leave it out, and then declares only the
   * identifiers of `outcomes`.
   */
  readonly declared?: ReadonlySet<string>;
  /**
   * The document's location as the host named it.
   */
  readonly document: string;
  readonly identifier: string;
  readonly outcomeProcessing: OutcomeProcessing;
  readonly outcomes: ReadonlyMap<string, OutcomeDeclaration>;
  readonly parts: readonly TestPart[];
  /**
   * The identifiers of the test's own item refs that a selection with replacement can repeat: those
   * under a `qti-assessment-section` whose `qti-selection` has `with-replacement` true, anywhere
   * above them in the test document. Only through one of them does a numbered reading such as
   * `a.2.SCORE` count (reading 88, "a numbered reference such as `Q01.2.SCORE` names an instance of
   * an item ref that a selection with replacement can repeat, and nothing else"). `buildTest`
   * always gives it; a test built by hand may leave it out, and then no item ref is repeatable.
   */
  readonly repeatable?: ReadonlySet<string>;
  readonly title: string;
  readonly unsupported: readonly MarkedFeature[];
}

/**
 * The session control of an element that has no `qti-item-session-control`: every attribute
 * absent.
 */
export const absentControl: ControlAttributes = {
  allowComment: Option.none(),
  allowReview: Option.none(),
  allowSkipping: Option.none(),
  maxAttempts: Option.none(),
  showFeedback: Option.none(),
  showSolution: Option.none(),
  validateResponses: Option.none(),
};

/**
 * The `testMarks` keys that name an element: the element is the feature wherever it sits.
 */
const elementMarks: ReadonlySet<string> = new Set(
  testMarks.filter((mark) => mark.startsWith("qti-")),
);

/**
 * The mark of a `qti-item-session-control` whose `allow-comment` is true.
 */
const commentMark: TestMark = 'allow-comment="true"';

/**
 * The mark of a negative `max-attempts`, at the attribute's path.
 */
const negativeAttemptsMark: TestMark = "max-attempts:negative";

/**
 * The item model's marks, which `renders` lists, that sit on an outcome declaration, such as
 * `base-type="file"`.
 */
const declarationMarks: readonly FeatureRule[] = renders.marks.filter(
  (mark: FeatureRule) => mark.on !== "body" && mark.on.includes("qti-outcome-declaration"),
);

/**
 * The `qti-*` elements below an outcome declaration that the model reads: the item model's, which
 * `renders` lists, so the two cannot drift. Any other is a mark keyed by its name, as the item
 * model marks it.
 */
const declarationContent: ReadonlySet<string> = new Set(renders.elements);

/**
 * Read an integer written in an attribute, its outer whitespace gone, exactly.
 *
 * @param written The value as written.
 * @returns The integer, or none when the value is not one.
 */
const integerOf = (written: string): Option.Option<bigint> => {
  const lexical = trimXmlSpace(written);

  return integerLexical.test(lexical) ? Option.some(BigInt(lexical)) : Option.none();
};

/**
 * Read an attribute the element must carry whose value is one of a closed list, such as
 * `navigation-mode`.
 *
 * @param build The build.
 * @param element The element.
 * @param name The attribute's name.
 * @param allowed The values it may take.
 * @returns The value, or the refusal `missing-attribute` or `attribute-type`.
 */
const requiredListed = <const T extends string>(
  build: ModelWalk,
  element: SourceElement,
  name: string,
  allowed: readonly T[],
): Result.Result<T, Refusal> =>
  Result.flatMap(requiredAttribute(build, element, name), (attribute) =>
    listed(build, element, name, attribute, allowed),
  );

/**
 * Read an `xs:boolean` attribute's value through {@link xsBooleanOf}.
 *
 * @param build The build.
 * @param element The element.
 * @param attribute The attribute.
 * @returns The boolean, or the refusal `value-type` at the attribute.
 */
const booleanValue = (
  build: ModelWalk,
  element: SourceElement,
  attribute: SourceAttribute,
): Result.Result<boolean, Refusal> =>
  Option.match(xsBooleanOf(attribute.value), {
    onNone: () =>
      Result.fail(
        refusal(build, "value-type", attributePath(pathOf(build, element), attribute), {
          baseType: "boolean",
          lexical: attribute.value,
        }),
      ),
    onSome: (value) => Result.succeed(value),
  });

/**
 * Read an optional `xs:boolean` attribute through {@link xsBooleanOf}.
 *
 * @param build The build.
 * @param element The element.
 * @param name The attribute's name.
 * @returns The boolean, none when absent, or the refusal `value-type` at the attribute.
 */
const booleanAttribute = (
  build: ModelWalk,
  element: SourceElement,
  name: string,
): Result.Result<Option.Option<boolean>, Refusal> =>
  Result.transposeOption(
    Option.map(attributeOf(element, name), (attribute) => booleanValue(build, element, attribute)),
  );

/**
 * Read an `xs:boolean` attribute the element must carry, such as a section's `visible`.
 *
 * @param build The build.
 * @param element The element.
 * @param name The attribute's name.
 * @returns The boolean, or the refusal `missing-attribute` or `value-type`.
 */
const requiredBoolean = (
  build: ModelWalk,
  element: SourceElement,
  name: string,
): Result.Result<boolean, Refusal> =>
  Result.flatMap(requiredAttribute(build, element, name), (attribute) =>
    booleanValue(build, element, attribute),
  );

/**
 * Read an `xs:int` attribute, such as `max-attempts`, exactly: outer whitespace goes, and the value
 * keeps `xs:int`'s range (readings 45 and 46), so a number holds it exactly.
 *
 * @param build The build.
 * @param element The element.
 * @param name The attribute's name.
 * @returns The number, none when absent, or the refusal `value-type` at the attribute when the value
 *   is not an integer from -2^31 to 2^31-1.
 */
const intAttribute = (
  build: ModelWalk,
  element: SourceElement,
  name: string,
): Result.Result<Option.Option<number>, Refusal> =>
  Result.transposeOption(
    Option.map(attributeOf(element, name), (attribute) =>
      Option.match(
        Option.filter(
          integerOf(attribute.value),
          (value) => value >= leastInt && value <= greatestInt,
        ),
        {
          onNone: () =>
            Result.fail(
              refusal(build, "value-type", attributePath(pathOf(build, element), attribute), {
                baseType: "xs:int",
                lexical: trimXmlSpace(attribute.value),
              }),
            ),
          onSome: (value) => Result.succeed(Number(value)),
        },
      ),
    ),
  );

/**
 * Read an element's `qti-item-session-control`, attribute by attribute.
 *
 * @param build The build.
 * @param owner A test part, a section or an item reference.
 * @returns Each attribute the control writes, {@link absentControl} when the element has none, or a
 *   refusal at an attribute outside its type.
 */
const controlOf = (
  build: ModelWalk,
  owner: SourceElement,
): Result.Result<ControlAttributes, Refusal> =>
  Option.match(Arr.head(childrenNamed(owner, "qti-item-session-control")), {
    onNone: () => Result.succeed(absentControl),
    onSome: (control) =>
      Result.gen(function* readControl() {
        const allowComment = yield* booleanAttribute(build, control, "allow-comment");
        const allowReview = yield* booleanAttribute(build, control, "allow-review");
        const allowSkipping = yield* booleanAttribute(build, control, "allow-skipping");
        const maxAttempts = yield* intAttribute(build, control, "max-attempts");
        const showFeedback = yield* booleanAttribute(build, control, "show-feedback");
        const showSolution = yield* booleanAttribute(build, control, "show-solution");
        const validateResponses = yield* booleanAttribute(build, control, "validate-responses");

        return {
          allowComment,
          allowReview,
          allowSkipping,
          maxAttempts,
          showFeedback,
          showSolution,
          validateResponses,
        };
      }),
  });

/**
 * Read a `qti-weight`: its `identifier`, and its `value` as an `xs:double`, outer whitespace gone,
 * by reading 7 and reading 56 ("an `xs:double` literal beyond the largest finite double names the
 * largest finite double of its sign"), as `doubleAttribute` in `#plate/model/attributes.ts` reads
 * one.
 *
 * @param build The build.
 * @param element The weight.
 * @returns The identifier and the weight, or the refusal `value-type` at a value outside the
 *   double's lexical space. A document the validator would refuse can also fail with
 *   `missing-attribute`.
 */
const weightOf = (
  build: ModelWalk,
  element: SourceElement,
): Result.Result<readonly [string, number], Refusal> =>
  Result.gen(function* readWeight() {
    const identifier = yield* identifierAttribute(build, element, "identifier");
    const written = yield* requiredAttribute(build, element, "value");
    const lexical = trimXmlSpace(written.value);
    const value = yield* Result.mapError(parseLexical("float", lexical), () =>
      refusal(build, "value-type", attributePath(pathOf(build, element), written), {
        baseType: "xs:double",
        lexical,
      }),
    );

    return [identifier, floatOf(build, value)] as const;
  });

/**
 * Read a `qti-variable-mapping`: its `target-identifier` and the `source-identifier` it reads.
 *
 * @param build The build.
 * @param element The mapping.
 * @returns The target and the source; a document the validator would refuse can fail with
 *   `missing-attribute`.
 */
const mappingOf = (
  build: ModelWalk,
  element: SourceElement,
): Result.Result<readonly [string, string], Refusal> =>
  Result.gen(function* readMapping() {
    const target = yield* identifierAttribute(build, element, "target-identifier");
    const source = yield* identifierAttribute(build, element, "source-identifier");

    return [target, source] as const;
  });

/**
 * Read a `qti-template-default` into the default the engine applies, none when the engine cannot
 * apply it. It records its own marks, so the reader that builds the item references stays unaware
 * of the test's processing names.
 *
 * @param element The template default.
 * @returns The default, none when it is marked, or a refusal at an attribute outside its type.
 */
type DefaultReader = (
  element: SourceElement,
) => Result.Result<Option.Option<TemplateDefault>, Refusal>;

/**
 * Read a `qti-assessment-item-ref`, its weights, its variable mappings and its template defaults
 * among it. A later weight or mapping of the same identifier replaces an earlier one; the template
 * defaults keep document order, each the engine cannot apply left out.
 *
 * @param build The build.
 * @param readDefault How a template default is read.
 * @param element The item reference.
 * @returns The model, or a refusal at an attribute that is missing or outside its type.
 */
const itemRef = (
  build: ModelWalk,
  readDefault: DefaultReader,
  element: SourceElement,
): Result.Result<ItemRef, Refusal> =>
  Result.gen(function* readItemRef() {
    const identifier = yield* identifierAttribute(build, element, "identifier");
    const href = yield* requiredValue(build, element, "href");
    const required = yield* xsBoolean(build, element, "required", false);
    const fixed = yield* xsBoolean(build, element, "fixed", false);
    const control = yield* controlOf(build, element);
    const mappings: (readonly [string, string])[] = [];
    for (const each of childrenNamed(element, "qti-variable-mapping")) {
      mappings.push(yield* mappingOf(build, each));
    }

    const weights: (readonly [string, number])[] = [];
    for (const each of childrenNamed(element, "qti-weight")) {
      weights.push(yield* weightOf(build, each));
    }

    const templateDefaults: Option.Option<TemplateDefault>[] = [];
    for (const each of childrenNamed(element, "qti-template-default")) {
      templateDefaults.push(yield* readDefault(each));
    }

    return {
      category: Option.match(valueOf(element, "category"), {
        onNone: () => [],
        onSome: (written) => written.split(xmlWhitespaceRun).filter((token) => token !== ""),
      }),
      control,
      fixed,
      href: collapseXmlSpace(href),
      identifier,
      kind: "item-ref",
      mappings: new Map(mappings),
      required,
      templateDefaults: Arr.getSomes(templateDefaults),
      weights: new Map(weights),
    };
  });

/**
 * Read a `qti-assessment-section` and, in document order, the sections and item references it
 * holds.
 *
 * @param build The build.
 * @param readDefault How a template default is read.
 * @param element The section.
 * @returns The model, or a refusal at an attribute that is missing or outside its type.
 */
const section = (
  build: ModelWalk,
  readDefault: DefaultReader,
  element: SourceElement,
): Result.Result<Section, Refusal> =>
  Result.gen(function* readSection() {
    const identifier = yield* identifierAttribute(build, element, "identifier");
    const required = yield* xsBoolean(build, element, "required", false);
    const fixed = yield* xsBoolean(build, element, "fixed", false);
    const title = yield* requiredValue(build, element, "title");
    const visible = yield* requiredBoolean(build, element, "visible");
    const keepTogether = yield* xsBoolean(build, element, "keep-together", true);
    const control = yield* controlOf(build, element);
    const children: SectionChild[] = [];
    for (const child of element.children.filter(
      (each): each is SourceElement =>
        each.kind === "element" &&
        isQti(each) &&
        (each.local === "qti-assessment-section" || each.local === "qti-assessment-item-ref"),
    )) {
      children.push(
        child.local === "qti-assessment-section"
          ? yield* section(build, readDefault, child)
          : yield* itemRef(build, readDefault, child),
      );
    }

    return {
      children,
      control,
      fixed,
      identifier,
      keepTogether,
      kind: "section",
      required,
      title,
      visible,
    };
  });

/**
 * Read a `qti-test-part` and its sections, in document order.
 *
 * @param build The build.
 * @param readDefault How a template default is read.
 * @param element The test part.
 * @returns The model, or a refusal at an attribute that is missing or outside its type.
 */
const testPart = (
  build: ModelWalk,
  readDefault: DefaultReader,
  element: SourceElement,
): Result.Result<TestPart, Refusal> =>
  Result.gen(function* readTestPart() {
    const identifier = yield* identifierAttribute(build, element, "identifier");
    const navigation = yield* requiredListed(build, element, "navigation-mode", navigationModes);
    const submission = yield* requiredListed(build, element, "submission-mode", submissionModes);
    const control = yield* controlOf(build, element);
    const children: Section[] = [];
    for (const child of childrenNamed(element, "qti-assessment-section")) {
      children.push(yield* section(build, readDefault, child));
    }

    return { children, control, identifier, navigation, submission };
  });

/**
 * Report whether a `renders` condition holds on an outcome declaration, as the item model judges
 * it.
 *
 * @param condition The condition.
 * @param declaration The declaration.
 * @returns Whether the declaration carries the feature. The conditions on an interaction's binding,
 *   its pattern, a count or a processing template never hold on a declaration.
 */
const holdsOn = (condition: Condition, declaration: SourceElement): boolean => {
  if (condition.kind === "element") {
    return true;
  }

  if (condition.kind === "attribute") {
    return Option.isSome(attributeOf(declaration, condition.name));
  }

  if (condition.kind === "attribute-value") {
    return Option.getOrUndefined(valueOf(declaration, condition.name)) === condition.value;
  }

  if (condition.kind === "attribute-true") {
    return Option.getOrElse(
      Option.flatMap(valueOf(declaration, condition.name), xsBooleanOf),
      () => false,
    );
  }

  return (
    condition.kind === "untyped" &&
    Option.isNone(attributeOf(declaration, "base-type")) &&
    Option.getOrUndefined(valueOf(declaration, "cardinality")) !== "record"
  );
};

/**
 * Name the element feature an element is, if it is one: a `qti-*` element `testMarks` names.
 *
 * @param element The element.
 * @returns The feature's key, or none when the element is not one.
 */
const elementMark = (element: SourceElement): Option.Option<string> =>
  isQti(element) && elementMarks.has(element.local) ? Option.some(element.local) : Option.none();

/**
 * Give the marks a `qti-item-session-control` carries, in the order its attributes are written:
 * `allow-comment` true at the element, and a negative `max-attempts` at the attribute.
 *
 * @param control The control.
 * @param path Its path.
 * @returns Its marks.
 */
const controlMarks = (control: SourceElement, path: string): readonly MarkedFeature[] =>
  control.attributes.flatMap((attribute): readonly MarkedFeature[] => {
    if (attribute.namespace !== "") {
      return [];
    }

    if (
      attribute.local === "allow-comment" &&
      Option.getOrElse(xsBooleanOf(attribute.value), () => false)
    ) {
      return [{ feature: commentMark, path, shown: "mark" }];
    }

    return attribute.local === "max-attempts" &&
      Option.exists(integerOf(attribute.value), (value) => value < 0n)
      ? [{ feature: negativeAttemptsMark, path: attributePath(path, attribute), shown: "mark" }]
      : [];
  });

/**
 * Give every feature a test holds and M2 does not deliver, in document order.
 *
 * An element `testMarks` names is marked at its path, and its own subtree is not searched, so a
 * rubric block's stylesheet is not marked apart from the block. A `qti-item-session-control` gives
 * its own marks. A test-level outcome declaration is marked as the
 * item model marks an item's: the `renders` marks that sit on it, at its path, and each `qti-*`
 * element below it that the model does not read, keyed by its name, its subtree not searched. An
 * element a reader has marked already, the outcome processing and each template default, gives its
 * own mark when it is an element feature, then the reader's marks, where it stands, its subtree not
 * searched, so an element the reader marked in it is not marked again.
 *
 * @param source The test.
 * @param placed The marks a reader gave, keyed by the element they stand at.
 * @returns The marks, each once per feature and path.
 */
const marksOf = (
  source: SourceDocument,
  placed: ReadonlyMap<SourceElement, readonly MarkedFeature[]>,
): readonly MarkedFeature[] => {
  const marks: MarkedFeature[] = [];
  const quiet = new Set<SourceElement>();
  const declared = new Set<SourceElement>();
  for (const visit of walk(source)) {
    const { element, path } = visit;
    const parent = Option.getOrUndefined(visit.parent);
    const feature = Option.getOrUndefined(elementMark(element));
    const read = placed.get(element);
    if (parent !== undefined && quiet.has(parent)) {
      quiet.add(element);
    } else if (read !== undefined) {
      const repeated = read.some((each) => each.feature === feature && each.path === path);
      if (feature !== undefined && !repeated) {
        marks.push({ feature, path, shown: "mark" });
      }

      marks.push(...read);
      quiet.add(element);
    } else if (parent !== undefined && declared.has(parent)) {
      if (
        isQti(element) &&
        element.local.startsWith("qti-") &&
        !declarationContent.has(element.local)
      ) {
        marks.push({ feature: element.local, path, shown: "mark" });
        quiet.add(element);
      } else {
        declared.add(element);
      }
    } else if (feature !== undefined) {
      marks.push({ feature, path, shown: "mark" });
      quiet.add(element);
    } else if (isQti(element) && element.local === "qti-item-session-control") {
      marks.push(...controlMarks(element, path));
    } else if (
      isQti(element) &&
      element.local === "qti-outcome-declaration" &&
      parent === source.root
    ) {
      for (const mark of declarationMarks) {
        if (holdsOn(mark.when, element)) {
          marks.push({ feature: mark.feature, path, shown: "mark" });
        }
      }
      declared.add(element);
    }
  }

  return marks;
};

/**
 * The built-in variables a test's processing may name, as plate reads them: `completionStatus`,
 * `duration`, `numAttempts` and `QTI_CONTEXT`, whatever the engine holds of them. The qti package
 * now gives a test only `duration` and `QTI_CONTEXT` (`builtIns` in
 * `packages/pantry/src/grammar/references.ts`, typed by `builtInTypes` in
 * `packages/pantry/src/grammar/expression.ts`); plate keeps a test's own `numAttempts` and
 * `completionStatus` where the test declares neither, accepted and marked, as ruled (B4), an
 * agreement difference (G-R3 184, pending). A test may declare either (reading 168, "A test may
 * declare a variable named `numAttempts` or `completionStatus`; in a test only `duration` is
 * reserved"), and its processing then reads the declared variable, not this built-in. Of these the
 * engine holds only the test's own `duration` (G-R3, pending: a test's processing reads only the
 * test's declared outcomes and its own `duration`).
 */
const processingBuiltIns: readonly string[] = [
  "completionStatus",
  "duration",
  "numAttempts",
  "QTI_CONTEXT",
];

/**
 * What a test's processing, its outcome processing and its template defaults, resolves a name
 * against.
 */
interface ProcessingNames {
  /**
   * Every identifier the test's outcome and context declarations declare whole.
   */
  readonly declared: ReadonlySet<string>;
  /**
   * {@link ProcessingNames.declared} and {@link processingBuiltIns}: the names a braced string
   * attribute reads as a reference, and an unchecked reference is judged by.
   */
  readonly named: ReadonlySet<string>;
  /**
   * The outcomes the model holds, which the engine reads and sets.
   */
  readonly outcomes: ReadonlyMap<string, OutcomeDeclaration>;
  /**
   * The identifiers of the test's own item references that a selection with replacement can
   * repeat (`Test.repeatable`), through which alone a numbered reading counts
   * ({@link isPrefixedHeld}).
   */
  readonly repeatable: ReadonlySet<string>;
  /**
   * Whether the test holds a `qti-assessment-section-ref` under one of its parts or sections. A
   * section document it references holds parts of the test the engine does not deliver, so a dotted
   * name that may resolve through it is not held ({@link isPrefixedHeld}), and an outcome-only
   * expression, which would count only the test document's own items, marks the outcome processing
   * ({@link outcomeOnlyMarks}).
   */
  readonly referencesSection: boolean;
  /**
   * The identifiers of the test's own parts, sections and item references, none of a section
   * document it references.
   */
  readonly structure: ReadonlySet<string>;
}

/**
 * A test's own structure, as {@link structureOf} reads it.
 */
interface Structure {
  readonly identifiers: ReadonlySet<string>;
  readonly referencesSection: boolean;
  readonly repeatable: ReadonlySet<string>;
}

/**
 * Report whether a section's `qti-selection` has `with-replacement` true, as `xs:boolean` reads it,
 * which lets each item reference beneath the section, at any depth, be instantiated more than once
 * (reading 88), as the package judges it (`replacesItems` in `#plate/package/open.ts`).
 *
 * @param element The section.
 * @returns Whether it does.
 */
const replacesItems = (element: SourceElement): boolean =>
  childrenNamed(element, "qti-selection").some((selection) =>
    Option.exists(Option.flatMap(valueOf(selection, "with-replacement"), xsBooleanOf), Boolean),
  );

/**
 * Add the identifier an element writes to a set, when it writes one.
 *
 * @param element The element.
 * @param into The set.
 */
const addIdentifier = (element: SourceElement, into: Set<string>): void => {
  for (const identifier of Option.toArray(
    Option.map(valueOf(element, "identifier"), identifierOf),
  )) {
    into.add(identifier);
  }
};

/**
 * Give the identifiers of a test's parts, sections and item references, nested sections included,
 * read from the elements the tree holds as {@link testPart} and {@link section} walk them, so the
 * names are known before the item references, whose template defaults read them, are built;
 * whether the walk meets a `qti-assessment-section-ref`, which the tree leaves out; and the item
 * references a selection with replacement can repeat, those under a section whose `qti-selection`
 * has `with-replacement` true ({@link replacesItems}), anywhere above them.
 *
 * @param root The test's root.
 * @returns Their identifiers, whether the test references a section document, and its repeatable
 *   item references.
 */
const structureOf = (root: SourceElement): Structure => {
  const identifiers = new Set<string>();
  const repeatable = new Set<string>();
  let referencesSection = false;
  const addChildren = (element: SourceElement, replacing: boolean): void => {
    for (const child of elementsOf(element)) {
      if (isQti(child, "qti-assessment-section-ref")) {
        referencesSection = true;
      } else if (isQti(child, "qti-assessment-section")) {
        addIdentifier(child, identifiers);
        addChildren(child, replacing || replacesItems(child));
      } else if (
        isQti(child, "qti-assessment-item-ref") &&
        isQti(element, "qti-assessment-section")
      ) {
        addIdentifier(child, identifiers);
        if (replacing) {
          addIdentifier(child, repeatable);
        }
      }
    }
  };
  for (const part of childrenNamed(root, "qti-test-part")) {
    addIdentifier(part, identifiers);
    addChildren(part, false);
  }

  return { identifiers, referencesSection, repeatable };
};

/**
 * Give what a test's processing resolves a name against.
 *
 * @param root The test's root.
 * @param outcomes The outcomes the model holds.
 * @returns The names.
 */
const processingNamesOf = (
  root: SourceElement,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
): ProcessingNames => {
  const declared = new Set(
    [
      ...childrenNamed(root, "qti-outcome-declaration"),
      ...childrenNamed(root, "qti-context-declaration"),
    ].flatMap((declaration) =>
      Option.toArray(Option.map(valueOf(declaration, "identifier"), identifierOf)),
    ),
  );

  const { identifiers, referencesSection, repeatable } = structureOf(root);

  return {
    declared,
    named: new Set([...declared, ...processingBuiltIns]),
    outcomes,
    referencesSection,
    repeatable,
    structure: identifiers,
  };
};

/**
 * Report whether a reading of a dotted name, split at one of its dots, reads a part's, a section's
 * or an item reference's `duration`: its prefix is an identifier of the test's own structure and
 * its rest names `duration`, directly or in the occurrence form `N.duration` (reading 4), as the
 * test scope splits a rest ({@link occurrenceOf}).
 *
 * @param names What the processing resolves a name against.
 * @param prefix The part before the dot.
 * @param rest The part after it.
 * @returns Whether it reads a `duration` of the test's structure.
 */
const readsStructureDuration = (names: ProcessingNames, prefix: string, rest: string): boolean =>
  names.structure.has(prefix) && occurrenceOf(rest).variable === "duration";

/**
 * Report whether a reading of a dotted name, split at one of its dots, counts as a read of the
 * test's own structure: its prefix is an identifier of that structure, and the variable its rest
 * names holds no dot. Through an item reference a selection with replacement can repeat, a rest in
 * the numbered form `N.VAR` ({@link occurrenceOf}) names `VAR`; through any other prefix the rest
 * is the variable whole, so a numbered rest holds a dot and does not count. A numbered reading
 * counts only through such an item reference (reading 88, "a numbered reference such as
 * `Q01.2.SCORE` names an instance of an item ref that a selection with replacement can repeat, and
 * nothing else"), as the package counts it (`isCounted` in `#plate/package/open.ts`) and the test
 * scope resolves it (`prefixedVariable` in `#plate/engine/scope.ts`).
 *
 * A variable whose name holds a dot does not count, though reading 37 lets an identifier hold one.
 * The test model reads no item, so it cannot tell `a.b.SCORE` read through the test's own `a`,
 * whose item declares `b.SCORE`, from the same name whose one resolving reading is a section
 * document's item ref `a.b`, which the engine does not deliver. A reading whose rest holds no dot
 * is the name's longest split, and its prefix, given once across the test's reach, is no section
 * document's. A numbered reading through a repeatable item reference has a longer split, as `a.2`
 * is of `a.2.SCORE`; where a section document gives that prefix and both items declare the
 * variable, both readings count, and the package refuses the name `ambiguous-reference`.
 *
 * @param names What the processing resolves a name against.
 * @param prefix The part before the dot.
 * @param rest The part after it.
 * @returns Whether it counts as a read of the test's own structure.
 */
const readsOwnStructure = (names: ProcessingNames, prefix: string, rest: string): boolean =>
  names.structure.has(prefix) &&
  !(names.repeatable.has(prefix) ? occurrenceOf(rest).variable : rest).includes(".");

/**
 * Report whether the engine holds what a dotted name the test does not declare whole reads, judged
 * on each of its readings, one for each dot it may split at, from the first.
 *
 * It is not held when a reading reads a `duration` of the test's structure ({@link
 * readsStructureDuration}; G-R3, pending: the engine holds no part's, section's or item reference's
 * `duration`, the occurrence form included). In a test that references a section document, it is
 * not held when no reading counts as a read of the test's own structure ({@link
 * readsOwnStructure}): it may resolve only through the section document, whose items the engine
 * does not deliver. A reading through the test's own prefix whose variable holds a dot does not
 * count. One is a numbered rest after an own item reference no selection with replacement can
 * repeat: its numbered reading names nothing, and read whole it names a variable whose identifier
 * starts with a digit, which nothing declares. Another is a rest that is itself dotted, which the
 * test model cannot tell from a section document's longer prefix. So `a.2.SCORE`, with an own `a`
 * that is not repeatable, reads only a section document's `a.2` and is not held, as `b.SCORE`
 * through one is not; nor is `a.b.SCORE` with an own `a` and no own `a.b`, `a.SCORE.SCORE` with an
 * own `a` and no own `a.SCORE`, or `S.x.SCORE` with an own section or part `S` and no own `S.x`.
 * With an own `a.2` or `a.b`, each stays held. A read that counts as one of the test's own
 * structure stays held there; an outcome-only expression in such a test is marked on its own
 * ({@link outcomeOnlyMarks}). Otherwise it is held, the test scope's to resolve.
 *
 * The test model reads no item, so it holds a name whose own reading counts whether or not that
 * item declares the variable. Where it does not, and a section document's item reference resolves
 * the name, as a section document's `a.2` resolves `a.2.SCORE` beside an own repeatable `a` whose
 * item declares no `SCORE`, or a section document's `x` resolves `x.y.SCORE` beside an own `x.y`
 * whose item declares no `SCORE`, the package counts that reading alone and accepts the name. The
 * package reads the items, so it marks the processing that reads such a name (`judgeTest` in
 * `#plate/package/open.ts`, through {@link withUnheldReads}), and no session runs it. A test built
 * apart from its items holds it, and there the engine finds no reading of it.
 *
 * @param names What the processing resolves a name against.
 * @param name The dotted name.
 * @returns Whether the engine holds it.
 */
const isPrefixedHeld = (names: ProcessingNames, name: string): boolean => {
  let ownPrefix = false;
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const prefix = name.slice(0, dot);
    const rest = name.slice(dot + 1);
    if (readsStructureDuration(names, prefix, rest)) {
      return false;
    }

    ownPrefix ||= readsOwnStructure(names, prefix, rest);
  }

  return ownPrefix || !names.referencesSection;
};

/**
 * Report whether the engine holds a variable a test's processing reads by a name. A name the test
 * declares whole is held when the model holds it as an outcome, so a context variable and an
 * outcome the model does not hold are not. A dotted name the test does not declare whole is a
 * prefixed read, which the test scope resolves, held as {@link isPrefixedHeld} judges it: not when
 * it reads a part's, a section's or an item reference's `duration`, directly or in the occurrence
 * form, nor, in a test that references a section document, when no reading of it counts as a read
 * of the test's own structure, one whose variable holds no dot, a numbered one counting only
 * through a repeatable item reference. Any other name is held only when it is the test's own
 * `duration`: `numAttempts`, `completionStatus` and `QTI_CONTEXT` are not.
 *
 * @param names What the processing resolves a name against.
 * @param name The name.
 * @returns Whether the engine holds it.
 */
const isHeld = (names: ProcessingNames, name: string): boolean => {
  if (names.declared.has(name)) {
    return names.outcomes.has(name);
  }

  if (name.includes(".")) {
    return isPrefixedHeld(names, name);
  }

  return name === "duration";
};

/**
 * Report whether a value a variant's field holds is a reference to a variable, the `ref` member of
 * `LiteralOrRef` in `#plate/model/expression.ts`.
 *
 * @param held The field's value, or one value of a list field.
 * @returns Whether it is a reference.
 */
const isReference = (
  held: unknown,
): held is { readonly _tag: "ref"; readonly identifier: string } =>
  typeof held === "object" &&
  held !== null &&
  "_tag" in held &&
  held._tag === "ref" &&
  "identifier" in held &&
  typeof held.identifier === "string";

/**
 * Give each variable an expression's attributes name through its kind's reference facet, with
 * whether a reference there is checked, in the facet's order and, within a list attribute, in
 * written order.
 *
 * @param operand The expression.
 * @param kindRule Its kind's rule.
 * @returns The names and whether each is checked.
 */
const referencesOf = (
  operand: Expression,
  kindRule: KindRule,
): readonly { readonly checked: boolean; readonly identifier: string }[] => {
  const fields = new Map<string, unknown>(Object.entries(operand));

  return kindRule.references.flatMap((entry) => {
    const held = fields.get(entry.field);
    const values: readonly unknown[] = entry.list && Array.isArray(held) ? held : [held];

    return values
      .filter((value) => isReference(value))
      .map((reference) => ({ checked: entry.checked, identifier: reference.identifier }));
  });
};

/**
 * Add each name an expression and its operands read that the engine does not hold, in the order
 * they first name it, each expression through its kind's rule in the registry. An expression
 * reads, by its kind's declaration facet, a name {@link isHeld} holds; a kind that expects a
 * response reads only a prefixed one, since a test declares no response. A checked reference reads
 * a name {@link isHeld} holds; an unchecked one is judged only when a declaration or a built-in
 * names it.
 *
 * @param operand The expression.
 * @param names What the processing resolves a name against.
 * @param unheld Where the names are added.
 */
const addUnheldReads = (operand: Expression, names: ProcessingNames, unheld: Set<string>): void => {
  const kindRule: KindRule = kindRules[operand.kind];
  if (kindRule.declaration !== undefined && "identifier" in operand) {
    const { identifier } = operand;
    const held =
      kindRule.declaration.expected === "response"
        ? !names.declared.has(identifier) && identifier.includes(".") && isHeld(names, identifier)
        : isHeld(names, identifier);
    if (!held) {
      unheld.add(identifier);
    }
  }

  for (const { checked, identifier } of referencesOf(operand, kindRule)) {
    if ((checked || names.named.has(identifier)) && !isHeld(names, identifier)) {
      unheld.add(identifier);
    }
  }

  for (const each of operand.operands) {
    addUnheldReads(each, names, unheld);
  }
};

/**
 * Give each name a test's outcome rules read or set that the engine does not hold, once, in the
 * order the rules first name it, as the item model finds an item's (`unheldIdentifiers` in
 * `#plate/model/item.ts`). A rule sets a name the engine holds only when the model holds it as an
 * outcome; its expressions read as {@link addUnheldReads} judges them.
 *
 * @param rules The rules.
 * @param names What the processing resolves a name against.
 * @returns The names the engine does not hold, empty when it can run the rules.
 */
const unheldNames = (rules: readonly Rule[], names: ProcessingNames): readonly string[] => {
  const unheld = new Set<string>();

  /**
   * Add each name a rule sequence names, nested branches included, that the engine does not hold.
   *
   * @param sequence The rules, in order.
   */
  const run = (sequence: readonly Rule[]): void => {
    for (const each of sequence) {
      if (each.kind === "condition") {
        for (const { then, when } of each.branches) {
          addUnheldReads(when, names, unheld);
          run(then);
        }
        if (Option.isSome(each.otherwise)) {
          run(each.otherwise.value);
        }
      } else if (each.kind !== "exit") {
        if (!names.outcomes.has(each.identifier)) {
          unheld.add(each.identifier);
        }

        addUnheldReads(each.expression, names, unheld);
      }
    }
  };
  run(rules);

  return [...unheld];
};

/**
 * Report whether an element holds a `qti-test-variables` whose `variable-identifier` is `duration`,
 * read from the attribute whatever the kind's reader holds: the engine holds no item's `duration`
 * (G-R3, pending).
 *
 * @param element The element.
 * @returns Whether it, or an element below it, is one.
 */
const collectsDurations = (element: SourceElement): boolean =>
  (isQti(element, "qti-test-variables") &&
    Option.exists(
      valueOf(element, "variable-identifier"),
      (written) => identifierOf(written) === "duration",
    )) ||
  elementsOf(element).some(collectsDurations);

/**
 * The local names of the eight outcome-only expressions, `qti-<kind>` for each kind of the test
 * family's rules ({@link testRules}), the list `outcomeOnly` in `#plate/validate/test-rules.ts`
 * holds: each looks up a sub-set of the items the test refers to (`info.txt:9332-9360`).
 */
const outcomeOnlyKinds: ReadonlySet<string> = new Set(
  Object.keys(testRules).map((kind) => `qti-${kind}`),
);

/**
 * Give the mark of each outcome-only expression under an element, in document order: its local
 * name, the feature the reader gives an expression the engine does not run, at the expression's
 * own path, each once.
 *
 * It reads the source, not the model, so it finds each expression whatever the reader made of it.
 * The processing of a test that references a section document takes these marks, by the Mind's
 * ruling: mark, do not narrow. The engine delivers no section document's item, so such an
 * expression would count the test document's own items alone, and its result would be a wrong
 * score reported without saying so. Every one is marked, whatever its `section-identifier` names.
 * A package's test whose item refs name an LTI link takes them too ({@link withLtiLinks}), since
 * the delivered test leaves those item refs out.
 *
 * @param build The build.
 * @param element The `qti-outcome-processing` element.
 * @returns The marks.
 */
const outcomeOnlyMarks = (build: ModelWalk, element: SourceElement): readonly MarkedFeature[] =>
  elementsOf(element).flatMap((child): readonly MarkedFeature[] => [
    ...(isQti(child) && outcomeOnlyKinds.has(child.local)
      ? [{ feature: child.local, path: pathOf(build, child), shown: "mark" } as const]
      : []),
    ...outcomeOnlyMarks(build, child),
  ]);

/**
 * Give the key a mark is recorded once under: its feature and its path.
 *
 * @param mark The mark.
 * @returns The key.
 */
const markKey = (mark: Pick<MarkedFeature, "feature" | "path">): string =>
  JSON.stringify([mark.feature, mark.path]);

/**
 * Give the generic expression reader its context for a test's outcome processing: the walk, the
 * names a braced string attribute reads as a reference, and the two ways to record a mark, each
 * recorded once per feature and path, in the order they are read.
 *
 * @param build The build.
 * @param named The names a braced string attribute reads as a reference.
 * @param marks Where the marks are recorded.
 * @returns The reading context.
 */
const processingReading = (
  build: ModelWalk,
  named: ReadonlySet<string>,
  marks: MarkedFeature[],
): ExpressionReading => {
  const recorded = new Set<string>();
  const record = (element: SourceElement, feature: string): void => {
    const path = pathOf(build, element);
    const key = markKey({ feature, path });
    if (!recorded.has(key)) {
      recorded.add(key);
      marks.push({ feature, path, shown: "mark" });
    }
  };

  return {
    declared: named,
    mark: (element, feature) => {
      record(element, feature);

      return Result.void;
    },
    unread: (element, feature = nameOf(element)) => {
      record(element, feature);

      return Result.succeed(Option.none());
    },
    walk: build,
  };
};

/**
 * Construct a branch of an outcome condition.
 *
 * @param when Its condition.
 * @param then The rules it runs.
 * @returns The branch.
 */
// oxlint-disable-next-line unicorn/no-thenable -- `then` is the branch's rule list, as `Branch` names it; it is an array, never a function, so no `await` treats a branch as a promise.
const branchOf = (when: Expression, then: readonly Rule[]): Branch => ({ then, when });

/**
 * Read a sequence of outcome rules. A `qti-outcome-processing-fragment`'s rules take its place, so
 * the sequence holds no fragment.
 *
 * @param reading The processing's reading context.
 * @param elements The rule elements, in order.
 * @returns The rules, none when any holds an element the engine does not run, or a refusal.
 */
const outcomeRules = (
  reading: ExpressionReading,
  elements: readonly SourceElement[],
): Result.Result<Option.Option<readonly Rule[]>, Refusal> =>
  Result.gen(function* readOutcomeRules() {
    const read: Option.Option<readonly Rule[]>[] = [];
    for (const element of elements) {
      // oxlint-disable-next-line eslint/no-use-before-define -- `outcomeRules` and `outcomeRule` are mutually recursive, as conditions and fragments nest; the call runs only after both are defined.
      read.push(yield* outcomeRule(reading, element));
    }

    return Option.map(Option.all(read), (each) => each.flat());
  });

/**
 * Read a `qti-outcome-if` or `qti-outcome-else-if`: its first child is the condition and the rest
 * are the rules it runs.
 *
 * @param reading The processing's reading context.
 * @param element The branch element.
 * @returns The branch, none when it holds no condition or an element the engine does not run, or a
 *   refusal.
 */
const outcomeBranch = (
  reading: ExpressionReading,
  element: SourceElement,
): Result.Result<Option.Option<Branch>, Refusal> =>
  Result.gen(function* readOutcomeBranch() {
    const [test, ...body] = elementsOf(element);
    if (test === undefined) {
      return yield* reading.unread(element);
    }

    const when = yield* readExpression(reading, test);
    const run = yield* outcomeRules(reading, body);

    return Option.all([when, run]).pipe(Option.map(([read, then]) => branchOf(read, then)));
  });

/**
 * Report whether a part of an outcome condition is a branch: a `qti-outcome-if` or a
 * `qti-outcome-else-if`.
 *
 * @param part The part.
 * @returns Whether it is one.
 */
const isOutcomeBranch = (part: SourceElement): boolean =>
  isQti(part, "qti-outcome-if") || isQti(part, "qti-outcome-else-if");

/**
 * Read a `qti-outcome-condition`: its `qti-outcome-if` and each `qti-outcome-else-if` in order as
 * its branches, and its first `qti-outcome-else` as its otherwise. Every other child is marked by
 * its name.
 *
 * @param reading The processing's reading context.
 * @param element The condition.
 * @returns The rule, none when any part holds an element the engine does not run, or a refusal.
 */
const outcomeCondition = (
  reading: ExpressionReading,
  element: SourceElement,
): Result.Result<Option.Option<readonly Rule[]>, Refusal> =>
  Result.gen(function* readOutcomeCondition() {
    const parts = elementsOf(element);
    const branches: Option.Option<Branch>[] = [];
    for (const part of parts.filter(isOutcomeBranch)) {
      branches.push(yield* outcomeBranch(reading, part));
    }

    const otherwise = yield* Option.match(
      Arr.findFirst(parts, (part) => isQti(part, "qti-outcome-else")),
      {
        onNone: () => Result.succeed(Option.some(Option.none<readonly Rule[]>())),
        onSome: (part) =>
          Result.map(outcomeRules(reading, elementsOf(part)), Option.map(Option.some)),
      },
    );
    const strays: Option.Option<never>[] = [];
    for (const part of parts.filter(
      (each) => !isOutcomeBranch(each) && !isQti(each, "qti-outcome-else"),
    )) {
      strays.push(yield* reading.unread(part));
    }

    return Option.map(
      Option.all({ branches: Option.all(branches), otherwise, strays: Option.all(strays) }),
      (read): readonly Rule[] => [
        { branches: read.branches, kind: "condition", otherwise: read.otherwise },
      ],
    );
  });

/**
 * Read a `qti-set-outcome-value` or a `qti-lookup-outcome-value`: the outcome it names and the one
 * expression it holds.
 *
 * @param reading The processing's reading context.
 * @param element The rule element.
 * @param kind The rule's kind.
 * @returns The rule, none when it does not hold exactly one expression or its expression holds an
 *   element the engine does not run, or a refusal.
 */
const outcomeSetting = (
  reading: ExpressionReading,
  element: SourceElement,
  kind: "lookup-outcome" | "set-outcome",
): Result.Result<Option.Option<readonly Rule[]>, Refusal> =>
  Result.gen(function* readOutcomeSetting() {
    const identifier = yield* identifierAttribute(reading.walk, element, "identifier");
    const [operand, ...extra] = elementsOf(element);
    if (operand === undefined || extra.length > 0) {
      return yield* reading.unread(element);
    }

    const read = yield* readExpression(reading, operand);

    return read.pipe(
      Option.map((expression): readonly Rule[] => [{ expression, identifier, kind }]),
    );
  });

/**
 * Read one outcome rule element into the rules it runs: a `qti-outcome-condition`, a
 * `qti-set-outcome-value`, a `qti-lookup-outcome-value` and a `qti-exit-test` are one rule each,
 * and a `qti-outcome-processing-fragment` is its own rules, read in place, nested fragments
 * included. Any other element is marked by its name.
 *
 * @param reading The processing's reading context.
 * @param element The rule element.
 * @returns The rules, none when it holds an element the engine does not run, or a refusal.
 */
const outcomeRule = (
  reading: ExpressionReading,
  element: SourceElement,
): Result.Result<Option.Option<readonly Rule[]>, Refusal> => {
  if (isQti(element, "qti-outcome-processing-fragment")) {
    return outcomeRules(reading, elementsOf(element));
  }

  if (isQti(element, "qti-exit-test")) {
    return Result.succeed(Option.some<readonly Rule[]>([{ kind: "exit" }]));
  }

  if (isQti(element, "qti-set-outcome-value")) {
    return outcomeSetting(reading, element, "set-outcome");
  }

  if (isQti(element, "qti-lookup-outcome-value")) {
    return outcomeSetting(reading, element, "lookup-outcome");
  }

  return isQti(element, "qti-outcome-condition")
    ? outcomeCondition(reading, element)
    : reading.unread(element);
};

/**
 * Give the marks an element of a test's processing gives: `variable:<name>` at the element's path
 * for each name the engine does not hold, as the item model marks an item's, then the marks its
 * reading recorded.
 *
 * @param build The build.
 * @param element The `qti-outcome-processing` or the `qti-template-default`.
 * @param unheld The names the engine does not hold, in the order they were found.
 * @param recorded The marks its reading recorded, in reading order.
 * @returns The marks.
 */
const processingMarks = (
  build: ModelWalk,
  element: SourceElement,
  unheld: ReadonlySet<string>,
  recorded: readonly MarkedFeature[],
): readonly MarkedFeature[] => {
  const path = pathOf(build, element);

  return [
    ...Array.from(unheld, (name): MarkedFeature => ({
      feature: `variable:${name}`,
      path,
      shown: "mark",
    })),
    ...recorded,
  ];
};

/**
 * A test's outcome processing as read: its state, and the marks it gives, in reading order.
 */
interface ReadProcessing {
  readonly marks: readonly MarkedFeature[];
  readonly outcomeProcessing: OutcomeProcessing;
}

/**
 * Read a test's `qti-outcome-processing` into the rules it runs.
 *
 * Its rules are read into the item model's {@link Rule} union, each expression through the
 * registry's generic reader. It is `marked`, and nothing is refused, when the engine cannot run it:
 * an element the reader marks at its path (a rule of a malformed shape), a name
 * the engine does not hold in a test ({@link unheldNames}, and a `qti-test-variables` that names
 * `duration`, {@link collectsDurations}), each the mark `variable:<name>` at the processing
 * element's path, as the item model marks an item's, or, in a test that references a section
 * document, an outcome-only expression, each marked by its name at its own path
 * ({@link outcomeOnlyMarks}): the engine delivers no section document's item, so it would count the
 * test document's own items alone. Otherwise it `runs` with its rules.
 *
 * @param build The build.
 * @param element The `qti-outcome-processing` element.
 * @param names What the processing resolves a name against.
 * @returns The state and its marks: the processing element's own `variable:` marks first, then
 *   each outcome-only expression's in document order, then those its reading recorded that are not
 *   already among them; or the refusal an attribute gives, such as `value-type` for a
 *   `qti-base-value` outside its lexical space.
 */
const outcomeProcessingOf = (
  build: ModelWalk,
  element: SourceElement,
  names: ProcessingNames,
): Result.Result<ReadProcessing, Refusal> =>
  Result.gen(function* readOutcomeProcessing() {
    const recorded: MarkedFeature[] = [];
    const tree = yield* outcomeRules(
      processingReading(build, names.named, recorded),
      elementsOf(element),
    );
    const unheld = new Set(Option.isSome(tree) ? unheldNames(tree.value, names) : []);
    if (collectsDurations(element)) {
      unheld.add("duration");
    }

    const besideReference = names.referencesSection ? outcomeOnlyMarks(build, element) : [];
    const besideKeys = new Set(besideReference.map(markKey));
    const marks = processingMarks(build, element, unheld, [
      ...besideReference,
      ...recorded.filter((mark) => !besideKeys.has(markKey(mark))),
    ]);

    return {
      marks,
      outcomeProcessing:
        Option.isSome(tree) && marks.length === 0
          ? { kind: "runs", rules: tree.value }
          : { kind: "marked" },
    };
  });

/**
 * A `qti-template-default` as read: the default the engine applies, none when it is marked, and the
 * marks it gives, in reading order.
 */
interface ReadDefault {
  readonly marks: readonly MarkedFeature[];
  readonly templateDefault: Option.Option<TemplateDefault>;
}

/**
 * Read a `qti-template-default` into the default the engine applies.
 *
 * Its one expression is read through the registry's generic reader, over the names a test's outcome
 * processing resolves (G-R3, pending: of those, the engine holds in a template default only the
 * test's declared outcomes, the test's own `duration`, which reads NULL there, and an item's
 * variables read by a prefixed name, as in outcome processing). It is left out, and nothing is
 * refused, when the engine cannot apply it: an element the reader marks at its path (a default
 * that does not hold exactly one expression), or a name the engine does not
 * hold in a test ({@link addUnheldReads}, and a `qti-test-variables` that names `duration`,
 * {@link collectsDurations}), each the mark `variable:<name>` at the default's path.
 *
 * @param build The build.
 * @param names What the test's processing resolves a name against.
 * @param element The `qti-template-default` element.
 * @returns The default and its marks, the default's own `variable:` marks first; or the refusal an
 *   attribute gives, such as `value-type` for a `qti-base-value` outside its lexical space.
 */
const templateDefaultOf = (
  build: ModelWalk,
  names: ProcessingNames,
  element: SourceElement,
): Result.Result<ReadDefault, Refusal> =>
  Result.gen(function* readTemplateDefault() {
    const templateIdentifier = yield* identifierAttribute(build, element, "template-identifier");
    const recorded: MarkedFeature[] = [];
    const reading = processingReading(build, names.named, recorded);
    const [operand, ...extra] = elementsOf(element);
    const expression =
      operand === undefined || extra.length > 0
        ? yield* reading.unread(element)
        : yield* readExpression(reading, operand);
    const unheld = new Set<string>();
    if (Option.isSome(expression)) {
      addUnheldReads(expression.value, names, unheld);
    }

    if (collectsDurations(element)) {
      unheld.add("duration");
    }

    const marks = processingMarks(build, element, unheld, recorded);

    return {
      marks,
      templateDefault:
        marks.length === 0
          ? expression.pipe(
              Option.map((read): TemplateDefault => ({ expression: read, templateIdentifier })),
            )
          : Option.none(),
    };
  });

/**
 * Build the test model of a valid `qti-assessment-test`.
 *
 * The parts, their sections and item references are read in document order; a
 * `qti-assessment-section-ref` is marked and left out, and every other
 * `testMarks` feature is marked and left out of the tree or, as `allow-comment` and a negative
 * `max-attempts`, held as written. Each `qti-item-session-control` attribute is held as written or
 * absent, and each item reference's weights, variable mappings and template defaults are read, a
 * template default the engine cannot apply marked and left out ({@link templateDefaultOf}). The
 * test's outcome declarations are held and marked as the item model holds and marks an item's. Its
 * outcome processing is `absent` when it has none, `marked` when the engine cannot run it
 * ({@link outcomeProcessingOf}), as when it holds an outcome-only expression in a test that
 * references a section document (the engine delivers no section document's item, so the
 * expression would count the test document's own items alone), and `runs` with its rules
 * otherwise; nothing in it or in a template default is refused but an attribute outside its type.
 * `declared` holds every identifier the test's outcome and context declarations declare, and
 * `repeatable` the item references a selection with replacement can repeat.
 *
 * A test holding an XInclude `include` is never built: `check` leaves it unchecked (E23) before it
 * reaches here, so no include is read or marked.
 *
 * @param source A document the structural validator and the prose rules accepted.
 * @returns The test, or the refusal `value-type` at the first typed value outside its lexical
 *   space. A document the validator would refuse can also fail with `missing-attribute` or
 *   `attribute-type`.
 */
export const buildTest = (source: SourceDocument): Result.Result<Test, Refusal> =>
  Result.gen(function* readTest() {
    const build: ModelWalk = { builder: "buildTest", document: source, paths: pathsOf(source) };
    const { root } = source;
    const identifier = yield* identifierAttribute(build, root, "identifier");
    const title = yield* requiredValue(build, root, "title");
    const outcomes = new Map<string, OutcomeDeclaration>();
    for (const declaration of childrenNamed(root, "qti-outcome-declaration")) {
      const read = yield* outcomeDeclaration(build, declaration);
      if (Option.isSome(read)) {
        outcomes.set(read.value.identifier, read.value);
      }
    }

    const names = processingNamesOf(root, outcomes);
    const placed = new Map<SourceElement, readonly MarkedFeature[]>();
    const readDefault: DefaultReader = (element) =>
      Result.gen(function* readPlacedDefault() {
        const read = yield* templateDefaultOf(build, names, element);
        placed.set(element, read.marks);

        return read.templateDefault;
      });
    const parts: TestPart[] = [];
    for (const part of childrenNamed(root, "qti-test-part")) {
      parts.push(yield* testPart(build, readDefault, part));
    }

    const processing = Arr.head(childrenNamed(root, "qti-outcome-processing"));
    const read = yield* Option.match(processing, {
      onNone: () =>
        Result.succeed<ReadProcessing>({ marks: [], outcomeProcessing: { kind: "absent" } }),
      onSome: (element) => outcomeProcessingOf(build, element, names),
    });
    if (Option.isSome(processing)) {
      placed.set(processing.value, read.marks);
    }

    return {
      declared: names.declared,
      document: source.location,
      identifier,
      outcomeProcessing: read.outcomeProcessing,
      outcomes,
      parts,
      repeatable: names.repeatable,
      title,
      unsupported: marksOf(source, placed),
    };
  });

/**
 * A read by a test's processing of a variable the engine holds no value of, which the test model
 * cannot see from the test document alone: an item's context variable read through its item ref
 * (`ITEMREF.VAR` naming the item's `qti-context-declaration`), which the item marks; any variable
 * read through an item ref that names an LTI link; or a name whose one counting reading reads
 * through an item ref, part or section a section document writes, though a reading through the
 * test's own structure counts in the test document alone ({@link isPrefixedHeld}). A package,
 * which reads the test's items and the section documents it reaches, finds each one.
 *
 * It lies in the test's outcome processing, or in a template default of one of the test's own item
 * refs, named by the item ref's identifier. `name` is the name read, as written, and `path` the
 * path of the `qti-outcome-processing` or the `qti-template-default` it lies in.
 */
export type UnheldRead =
  | { readonly kind: "outcome-processing"; readonly name: string; readonly path: string }
  | {
      readonly itemRef: string;
      readonly kind: "template-default";
      readonly name: string;
      readonly path: string;
    };

/**
 * The kinds of expression that read a variable by an `identifier` a test may prefix with an item
 * ref: its value, its default, a response's correct response, and a response mapped through its
 * mapping or its area mapping.
 */
const prefixedReads: ReadonlySet<Expression["kind"]> = new Set([
  "correct",
  "default",
  "map-response",
  "map-response-point",
  "variable",
]);

/**
 * Report whether an expression or one of its operands reads a variable by one of some names, by
 * any of the expressions whose `identifier` a test may prefix ({@link prefixedReads}).
 *
 * @param expression The expression.
 * @param names The names.
 * @returns Whether it reads one of them.
 */
const readsAny = (expression: Expression, names: ReadonlySet<string>): boolean =>
  ("identifier" in expression &&
    prefixedReads.has(expression.kind) &&
    names.has(expression.identifier)) ||
  expression.operands.some((operand) => readsAny(operand, names));

/**
 * Give a test whose processing marks the reads a package found it cannot run, so none runs: the
 * marks the test model would give, had it seen what the package sees.
 *
 * When the outcome processing reads one, it is `marked`, as {@link outcomeProcessingOf} marks an
 * unheld read. Each template default of an item ref whose expression reads one, by a
 * `qti-variable`, a `qti-default`, a `qti-correct`, a `qti-map-response` or a
 * `qti-map-response-point` ({@link readsAny}), is left out of the item ref's `templateDefaults`, as
 * {@link templateDefaultOf} leaves out one the engine cannot apply, so its template variable starts
 * at its item's declared default. Each read is the mark `variable:<name>` at its path, and the
 * marks follow the test's own in `unsupported`, each once per feature and path. A test with no
 * reads is returned unchanged.
 *
 * @param test The test model, as {@link buildTest} gives it.
 * @param reads The reads, in document order.
 * @returns The test with its processing marked where it reads one.
 */
export const withUnheldReads = (test: Test, reads: readonly UnheldRead[]): Test => {
  if (reads.length === 0) {
    return test;
  }

  const byItemRef = new Map<string, Set<string>>();
  for (const read of reads) {
    if (read.kind === "template-default") {
      const names = byItemRef.get(read.itemRef) ?? new Set<string>();
      names.add(read.name);
      byItemRef.set(read.itemRef, names);
    }
  }

  /**
   * Give a section with each template default of its item refs, nested sections' included, that
   * reads one left out.
   *
   * @param held The section.
   * @returns The section.
   */
  const sectionWith = (held: Section): Section => ({
    ...held,
    // oxlint-disable-next-line eslint/no-use-before-define -- `sectionWith` and `childWith` are mutually recursive, as sections nest; the call runs only after both are defined.
    children: held.children.map(childWith),
  });

  /**
   * Give a section's child with each template default of an item ref that reads one left out.
   *
   * @param child The section's child.
   * @returns The child.
   */
  const childWith = (child: SectionChild): SectionChild => {
    if (child.kind === "section") {
      return sectionWith(child);
    }

    const names = byItemRef.get(child.identifier);

    return names === undefined
      ? child
      : {
          ...child,
          templateDefaults: child.templateDefaults.filter(
            ({ expression }) => !readsAny(expression, names),
          ),
        };
  };

  const marked = new Set(test.unsupported.map(markKey));
  const added: MarkedFeature[] = [];
  for (const { name, path } of reads) {
    const mark: MarkedFeature = { feature: `variable:${name}`, path, shown: "mark" };
    if (!marked.has(markKey(mark))) {
      marked.add(markKey(mark));
      added.push(mark);
    }
  }

  return {
    ...test,
    outcomeProcessing:
      test.outcomeProcessing.kind === "runs" &&
      reads.some((read) => read.kind === "outcome-processing")
        ? { kind: "marked" }
        : test.outcomeProcessing,
    parts: test.parts.map((part) => ({ ...part, children: part.children.map(sectionWith) })),
    unsupported: [...test.unsupported, ...added],
  };
};

/**
 * An item ref of a test document that names an LTI link in place of an item (reading 110, "under
 * an item ref that names an LTI link a variable mapping is accepted unchecked, a recorded limit,
 * and a template default is refused"), which the test model cannot see from the test document
 * alone: its identifier, and its path in the test document. A package, which reads the resource an
 * item ref names, finds each one (`#plate/package/open.ts`). It leaves a variable mapping's source
 * under the ref unchecked, judges the mapping's target by reading 97, refuses a template default
 * `undeclared-variable`, and delivers the test without the ref ({@link withLtiLinks}).
 */
export interface LtiLink {
  readonly identifier: string;
  readonly path: string;
}

/**
 * The mark of an item ref that names an LTI link, at the item ref's path.
 */
const ltiLinkMark: TestMark = "lti-link";

/**
 * Give a test whose item refs that name an LTI link are marked and left out of the tree, as every
 * other `testMarks` feature is, so a session walked from it never meets them: plate launches no LTI
 * link, and an LTI link holds no item a session could deliver.
 *
 * Each item ref of an identifier a link names is left out of its section, a nested section's
 * included, and each link is the mark `lti-link` at its path. The item ref's identifier stays a
 * name of the test's structure, so the test's own reads through it stay as the test model read
 * them; a package marks each read through it that the engine holds no value of ({@link
 * withUnheldReads}). Each outcome-only expression of the test's outcome processing, which counts or
 * collects over the test's items, is then marked by its name at its own path, and the processing is
 * `marked`, as a test that references a section document marks it ({@link outcomeOnlyMarks}): the
 * delivered test holds no item a link names, so the expression would count the delivered items
 * alone, and its result would be a wrong score reported without saying so. The marks follow the
 * test's own in `unsupported`, the links' first, each once per feature and path. A test with no
 * links is returned unchanged.
 *
 * @param test The test model, as {@link buildTest} gives it.
 * @param links The test document's item refs that name an LTI link, in document order.
 * @param source The test document the model was built from, where each outcome-only expression is
 *   found.
 * @returns The test without them, each marked, and its processing marked where it counts over
 *   the test's items.
 */
export const withLtiLinks = (
  test: Test,
  links: readonly LtiLink[],
  source: SourceDocument,
): Test => {
  if (links.length === 0) {
    return test;
  }

  const linked = new Set(links.map(({ identifier }) => identifier));

  /**
   * Give a section without the item refs, its nested sections' included, that name an LTI link.
   *
   * @param held The section.
   * @returns The section.
   */
  const unlinked = (held: Section): Section => ({
    ...held,
    children: held.children.flatMap((child): readonly SectionChild[] => {
      if (child.kind === "section") {
        return [unlinked(child)];
      }

      return linked.has(child.identifier) ? [] : [child];
    }),
  });

  const build: ModelWalk = { builder: "buildTest", document: source, paths: pathsOf(source) };
  const counting = childrenNamed(source.root, "qti-outcome-processing").flatMap((element) =>
    outcomeOnlyMarks(build, element),
  );
  const marked = new Set(test.unsupported.map(markKey));
  const added: MarkedFeature[] = [];
  for (const mark of [
    ...links.map(({ path }): MarkedFeature => ({ feature: ltiLinkMark, path, shown: "mark" })),
    ...counting,
  ]) {
    if (!marked.has(markKey(mark))) {
      marked.add(markKey(mark));
      added.push(mark);
    }
  }

  return {
    ...test,
    outcomeProcessing:
      test.outcomeProcessing.kind === "runs" && counting.length > 0
        ? { kind: "marked" }
        : test.outcomeProcessing,
    parts: test.parts.map((part) => ({ ...part, children: part.children.map(unlinked) })),
    unsupported: [...test.unsupported, ...added],
  };
};
