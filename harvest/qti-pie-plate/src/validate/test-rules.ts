/**
 * The test prose rules: what QTI's information model and the project's readings require of a test
 * or section document beyond what its XSD can say.
 *
 * {@link checkTestRules} is to a test or section document what `checkRules` is to an item, and the
 * two never overlap: `checkRules` gives nothing for a root that is not an item, and this module
 * gives nothing for one that is not a test or a section. It returns every refusal it finds, in
 * document order, and never stops at the first. The list of rules is closed, and each rule's
 * function names the sentence of the information model, or the reading, that settles it.
 *
 * A test's printed variables are judged as an item's are, by the item rules' own judgement
 * (`printedVariableReferences`), against the test's declarations and built-ins: the test declares
 * the variables its printed variables name, as the qti package binds them (`bindsVariables`). A
 * section declares nothing, so a section document's printed variables are not judged.
 *
 * A test's and a section's expressions, in outcome processing, pre-conditions, branch rules and
 * template defaults, are judged by the item's processing rules too (`processingRefusals`), against
 * the processing scope: a test's processing reads more built-ins than its printed variables name.
 *
 * A field of a record declaration's value is judged as an item's is (`recordFieldRefusals`): it
 * carries `field-identifier` and `base-type`, its text is a value of its own `base-type`, and no
 * field of the same value wrote its `field-identifier` before it (`repeatedField`, reading 158). An
 * outcome declaration's `mastery-value` lies within the bounds it writes, as an item's does
 * (`masteryRange`, reading 9).
 *
 * A branch rule's target is judged as far as the document alone shows it (reading 87): a target
 * only where it lies inside the document, and one no name of it gives only in a test that places
 * no section document and holds no include. The assembled test judges the rest (`openPackage`),
 * with the same refusal for what both see.
 *
 * Two things a test may hold are valid here and are never refused. A dotted reference
 * (`ITEMREF.VAR`, `ITEMREF.N.VAR`, a part's or a section's `duration`) is valid in pre-conditions,
 * branch rules and outcome processing (readings 4, 5 and 37), and is typed `unknown` here ({@link
 * unknownPrefix}); reading 48 ("a dotted reference is accepted when exactly one reading names a
 * real item ref, test part or section and its variable") refuses one only when two readings of it
 * each name a real item ref, part or section and a variable it has, which needs the items' declared
 * variables, so only a package can judge it. A `min-time` above a `max-time` is valid, each limit
 * enforced on its own (T-O8).
 *
 * @module
 */
import { Option } from "effect";
import { attributePath, qtiNamespace, walk, xincludeNamespace } from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceDocument,
  SourceElement,
  Visit,
} from "#plate/document/source.ts";
import { xsBooleanOf } from "#plate/model/attributes.ts";
import { singleOf } from "#plate/model/expression.ts";
import { integerLexical, isNcName, trimXmlSpace } from "#plate/model/values.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import {
  dataSsml,
  declarationType,
  declarationsOf,
  holdsUnexpanded,
  masteryRange,
  placingOf,
  printedVariableReferences,
  processingRefusals,
  quotation,
  recordFieldRefusals,
  repeatedField,
  tableHeaders,
} from "#plate/validate/rules.ts";
import type { NamedVariable, PrefixedTyper, VariableScope } from "#plate/validate/rules.ts";
import { governingTables } from "#plate/validate/structure.ts";
import type { Tables } from "#plate/validate/xsd.ts";

/**
 * The roots these rules judge, by local name in QTI's namespace: a test and a section document.
 */
const testRoots: ReadonlySet<string> = new Set(["qti-assessment-section", "qti-assessment-test"]);

/**
 * The elements whose identifiers share one scope, the test: "The identifier of the test part must
 * be unique within the test and must not be the identifier of any qti-assessment-section or
 * qti-assessment-item-ref" (info.txt:47082), "the identifier of the section or item reference must
 * be unique within the test" (info.txt:10759), and of section refs "each reference must have a
 * unique identifier" (info.txt:67406). A branch rule's `target` may name any of the four, so they
 * share one scope.
 */
const identifiedParts: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-assessment-section",
  "qti-assessment-section-ref",
  "qti-test-part",
]);

/**
 * A section's parts, the children a `qti-selection` selects from: "Sub-sections always count as 1,
 * regardless of how many child elements they have and whether or not they are visible" (reading
 * 79), so an item ref, a section and a section ref each count once.
 */
const sectionParts: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-assessment-section",
  "qti-assessment-section-ref",
]);

/**
 * The elements a branch rule may sit on, its owner, as the ASI XSD places `qti-branch-rule`: a test
 * part, a section and an item ref.
 */
const branchOwners: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-assessment-section",
  "qti-test-part",
]);

/**
 * The reserved targets every branch rule may name (reading 87; information model section 5.23.1).
 */
const branchExits: ReadonlySet<string> = new Set(["EXIT_SECTION", "EXIT_TEST", "EXIT_TESTPART"]);

/**
 * The test content that holds no interaction and no template element (reading 25): a test's
 * rubric blocks and its test feedback.
 */
const testContent: ReadonlySet<string> = new Set(["qti-rubric-block", "qti-test-feedback"]);

/**
 * The template elements reading 25 keeps out of test content.
 */
const templateElements: ReadonlySet<string> = new Set([
  "qti-template-block",
  "qti-template-inline",
]);

/**
 * The eight expressions the information model allows only in outcome processing: each "can only be
 * used in outcomes processing" (info.txt:9332-9360, reading 23).
 */
const outcomeOnly: ReadonlySet<string> = new Set([
  "qti-number-correct",
  "qti-number-incorrect",
  "qti-number-presented",
  "qti-number-responded",
  "qti-number-selected",
  "qti-outcome-maximum",
  "qti-outcome-minimum",
  "qti-test-variables",
]);

/**
 * The elements outside outcome processing that hold a test's expressions, one of which a
 * misplaced expression's refusal names as its `context`.
 */
const expressionContexts: ReadonlySet<string> = new Set([
  "qti-branch-rule",
  "qti-pre-condition",
  "qti-template-default",
]);

/**
 * The declarations a test holds whose variables its printed variables may name: "This allows
 * globally scoped varables to be defined" (`info.txt:11725`, the test's context declarations) and
 * its outcome declarations. A test declares no template or response variable. They are one
 * namespace (reading 74, "a test's own declarations form one namespace"), so two that share an
 * identifier are `duplicate-identifier` ({@link duplicateDeclaration}); the printed variables'
 * scope still resolves such a name, the later kind here winning, as in an item.
 */
const testDeclarations = ["qti-context-declaration", "qti-outcome-declaration"] as const;

/**
 * The built-in variables of a test, each declared implicitly: "QTI_CONTEXT is a built-in variable
 * and so any references within an item or an assessment to the QTI_CONTEXT variable [...] must
 * succeed" (`info.txt:8456`), a record, and "The time spent on the test is recorded as if it were a
 * built-in response variable called 'duration' declared at the test-level and of base-type duration
 * and single cardinality" (`info.txt:9226`). An item's `completionStatus` and `numAttempts` are
 * item session variables, so a test does not build them in.
 */
const testBuiltIns: ReadonlyMap<string, NamedVariable> = new Map<string, NamedVariable>([
  ["duration", { kind: "response", type: Option.some(singleOf("duration")) }],
  [
    "QTI_CONTEXT",
    { kind: "context", type: Option.some({ baseType: "unknown", cardinality: "record" }) },
  ],
]);

/**
 * Collect what a test's printed variables resolve their names against: the test's declarations
 * ({@link testDeclarations}) and its built-ins ({@link testBuiltIns}).
 *
 * @param source The test.
 * @returns The test's scope.
 */
const testScope = (source: SourceDocument): VariableScope => ({
  builtIns: testBuiltIns,
  declarer: "test",
  variables: new Map(testDeclarations.flatMap((kind) => [...declarationsOf(source, kind)])),
});

/**
 * Type a test's prefixed read when the test is checked alone: `unknown`, which satisfies every
 * rule, since only a package holds the items whose variables it reads.
 *
 * @returns The type `unknown` of `unknown` cardinality.
 */
const unknownPrefix: PrefixedTyper = () => ({ baseType: "unknown", cardinality: "unknown" });

/**
 * Give the element path a refusal points at: an element's path as it is, an attribute's without
 * its last step, and none for a refusal located otherwise.
 *
 * @param refusal The refusal.
 * @returns The path of its element, or the empty string when it points at no path.
 */
const elementPathOf = (refusal: Refusal): string => {
  if (refusal.location.kind !== "path") {
    return "";
  }

  const { path } = refusal.location;
  const attribute = path.lastIndexOf("/@");

  return attribute === -1 ? path : path.slice(0, attribute);
};

/**
 * The elements the rules judge, with each element's parent, and whether the document holds an
 * XInclude element anywhere.
 *
 * `parents` covers every element of the document, so an ancestor the structural walk passes over
 * is still reached when a rule climbs from a judged element. `includes` tells a rule that what an
 * include stands for, which no rule reads, may hold what the rule looks for.
 */
interface Judged {
  readonly includes: boolean;
  readonly parents: ReadonlyMap<SourceElement, SourceElement>;
  readonly visits: readonly Visit[];
}

/**
 * Report whether an element is a QTI element whose local name passes a test.
 *
 * @param element The element.
 * @param test The test of its local name.
 * @returns Whether `element` is in the QTI namespace and its local name passes `test`.
 */
const isQti = (element: SourceElement, test: (local: string) => boolean): boolean =>
  element.namespace === qtiNamespace && test(element.local);

/**
 * Find an element's attribute in no namespace by its local name.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @returns The attribute, or none when the element does not carry it.
 */
const attributeOf = (element: SourceElement, local: string): Option.Option<SourceAttribute> =>
  Option.fromUndefinedOr(
    element.attributes.find((attribute) => attribute.namespace === "" && attribute.local === local),
  );

/**
 * Find the nearest ancestor of an element that is a QTI element whose local name passes a test.
 *
 * @param parents Each element's parent.
 * @param element The element to climb from.
 * @param test The test of an ancestor's local name.
 * @returns The nearest such ancestor, or none when no ancestor passes.
 */
const ancestor = (
  parents: ReadonlyMap<SourceElement, SourceElement>,
  element: SourceElement,
  test: (local: string) => boolean,
): Option.Option<SourceElement> => {
  for (let above = parents.get(element); above !== undefined; above = parents.get(above)) {
    if (isQti(above, test)) {
      return Option.some(above);
    }
  }

  return Option.none();
};

/**
 * Construct a refusal of this document at a path.
 *
 * @param source The document refused.
 * @param rule The rule it breaks.
 * @param path The element or attribute path the refusal points at.
 * @param detail The facts the verdict's wording needs.
 * @returns The refusal, with no suggestion and no reader rule.
 */
const refusal = (
  source: SourceDocument,
  rule: RefusalRule,
  path: string,
  detail: Readonly<Record<string, string>>,
): Refusal =>
  new Refusal({
    detail,
    document: source.location,
    location: { kind: "path", path },
    readerRule: Option.none(),
    rule,
    suggestion: Option.none(),
  });

/**
 * List the elements the rules judge, in document order: exactly those the structural walk checks,
 * the keys of `governingTables` (reading 57).
 *
 * One admission decides for both stages, so the rules never refuse what the walk does not check,
 * nor skip what it does. In lax wildcard content, such as a `qti-selection`'s or a
 * `qti-ordering`'s, the rules judge what the walk checks there and not what it passes over: a
 * nested `qti-assessment-section` stays foreign content (reading 6), so neither its identifier nor
 * its children are judged.
 *
 * @param source The document.
 * @param tables The tables generated from the QTI XSD, the ones the structural walk checks it by.
 * @returns The judged visits, the parent of every element of the document, and whether it holds an
 *   XInclude element.
 */
const judgedVisits = (source: SourceDocument, tables: Tables): Judged => {
  const governing = governingTables(source, tables);
  const parents = new Map<SourceElement, SourceElement>();
  const visits: Visit[] = [];
  let includes = false;
  for (const visit of walk(source)) {
    if (Option.isSome(visit.parent)) {
      parents.set(visit.element, visit.parent.value);
    }

    if (governing.has(visit.element)) {
      visits.push(visit);
    }

    includes ||= visit.element.namespace === xincludeNamespace;
  }

  return { includes, parents, visits };
};

/**
 * Report whether an element has an XInclude element among its children, which may stand for any
 * number of children of its own (reading 117: an included fragment is judged in place).
 *
 * @param element The element.
 * @returns Whether one of its children is in the XInclude namespace.
 */
const holdsInclude = (element: SourceElement): boolean =>
  element.children.some(
    (child) => child.kind === "element" && child.namespace === xincludeNamespace,
  );

/**
 * Apply `duplicate-identifier` to one element: a part's, a section's, an item ref's or a section
 * ref's `identifier` is not one an earlier such element of the document already gave.
 *
 * Identifiers are compared as their `xs:NCName` type reads them, with the outer whitespace
 * collapsed, as the item rules compare theirs. A section document's identifiers are compared
 * within it, its root's included: any test that includes it holds them all. An identifier that is
 * no NCName names nothing (reading 152 as amended, "a value names something only where it is an
 * NCName"): it shares no name with another, so its value domain, the structural validator's
 * `attribute-type`, refuses it alone.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param seen The identifiers given so far, which this adds the element's to.
 * @returns The refusal at the repeated `identifier` attribute's path, or none for the first
 *   occurrence, for an identifier that names nothing and for any other element.
 */
const duplicateIdentifier = (
  source: SourceDocument,
  visit: Visit,
  seen: Set<string>,
): readonly Refusal[] => {
  const attribute = attributeOf(visit.element, "identifier");
  if (!isQti(visit.element, (local) => identifiedParts.has(local)) || Option.isNone(attribute)) {
    return [];
  }

  const identifier = trimXmlSpace(attribute.value.value);
  if (!isNcName(identifier)) {
    return [];
  }

  if (!seen.has(identifier)) {
    seen.add(identifier);

    return [];
  }

  return [
    refusal(source, "duplicate-identifier", attributePath(visit.path, attribute.value), {
      identifier,
    }),
  ];
};

/**
 * Apply readings 24 and 25's `misplaced-element` to an interaction or a template element: it does
 * not sit in a test's rubric block or test feedback.
 *
 * The full ASI XSD admits interactions and template content there; the information model's prose
 * and the test profile XSD forbid them, and reading 25 follows the prose. Printed variables and
 * inline or block feedback stay allowed, so they are not refused. Every interaction and template
 * element inside is refused, nested ones included.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param parents Each element's parent.
 * @returns The refusal at the element's path, naming the test content it sits in, or none.
 */
const misplacedInTestContent = (
  source: SourceDocument,
  visit: Visit,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): readonly Refusal[] => {
  const { element } = visit;
  const excluded = isQti(
    element,
    (local) =>
      templateElements.has(local) || (local.startsWith("qti-") && local.endsWith("-interaction")),
  );
  if (!excluded) {
    return [];
  }

  return Option.match(
    ancestor(parents, element, (local) => testContent.has(local)),
    {
      onNone: () => [],
      onSome: (container) => [
        refusal(source, "misplaced-element", visit.path, {
          element: element.local,
          reading: "25",
          requires: `outside a test's ${container.local}`,
        }),
      ],
    },
  );
};

/**
 * Apply reading 23's `expression-placement` to an expression: an outcome-only expression, or a
 * `qti-variable` carrying `weight-identifier`, sits inside `qti-outcome-processing`.
 *
 * Weights are "defined only in the test context (and hence only in outcomes processing)", so a
 * weighted variable follows the eight expressions (T-O10, pick A) and cites the same reading. The
 * refusal names the pre-condition, branch rule or template default the expression sits in as its
 * `context`. A prefixed reference is never refused here.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param parents Each element's parent.
 * @returns The refusal at the expression's path, or at its `weight-identifier`'s, or none.
 */
const expressionPlacement = (
  source: SourceDocument,
  visit: Visit,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): readonly Refusal[] => {
  const { element } = visit;
  const weight = isQti(element, (local) => local === "qti-variable")
    ? attributeOf(element, "weight-identifier")
    : Option.none();
  const restricted = isQti(element, (local) => outcomeOnly.has(local)) || Option.isSome(weight);
  if (
    !restricted ||
    Option.isSome(ancestor(parents, element, (local) => local === "qti-outcome-processing"))
  ) {
    return [];
  }

  const context = Option.match(
    ancestor(parents, element, (local) => expressionContexts.has(local)),
    {
      onNone: () => ({}),
      onSome: (container) => ({ context: container.local }),
    },
  );

  return Option.match(weight, {
    onNone: () => [
      refusal(source, "expression-placement", visit.path, {
        ...context,
        element: element.local,
        reading: "23",
      }),
    ],
    onSome: (attribute) => [
      refusal(source, "expression-placement", attributePath(visit.path, attribute), {
        attribute: attribute.local,
        ...context,
        element: element.local,
        reading: "23",
      }),
    ],
  });
};

/**
 * Apply `duplicate-identifier` to one of a test's declarations: its `identifier` is not one an
 * earlier declaration of the test gave, of either kind ({@link testDeclarations}).
 *
 * Reading 74 ("an identifier names one variable among the declarations of its document") makes a
 * test's own declarations one namespace, as an item's are: two outcomes named `SCORE`, or a context
 * variable and an outcome of one name, would be two variables a variable expression could not tell
 * apart. Identifiers are compared as their `xs:NCName` type reads them, with the outer whitespace
 * collapsed. One that is no NCName names nothing (readings 152 and 157): it shares no name with
 * another, and its value domain refuses it alone, as an item's declarations are read (`nameOf` in
 * `#plate/validate/rules.ts`). The parts' identifiers are another scope, {@link
 * duplicateIdentifier}'s.
 *
 * @param source The test.
 * @param visit The element's visit.
 * @param declared The identifiers the test's declarations have given so far, which this adds the
 *   element's to.
 * @returns The refusal at the repeated `identifier` attribute's path, or none for the first
 *   occurrence, for an identifier that names nothing and for an element that is no declaration of
 *   the root.
 */
const duplicateDeclaration = (
  source: SourceDocument,
  visit: Visit,
  declared: Set<string>,
): readonly Refusal[] => {
  const attribute = attributeOf(visit.element, "identifier");
  const declaration =
    Option.exists(visit.parent, (parent) => parent === source.root) &&
    isQti(visit.element, (local) => testDeclarations.some((kind) => kind === local));
  if (!declaration || Option.isNone(attribute)) {
    return [];
  }

  const identifier = trimXmlSpace(attribute.value.value);
  if (!isNcName(identifier)) {
    return [];
  }

  if (!declared.has(identifier)) {
    declared.add(identifier);

    return [];
  }

  return [
    refusal(source, "duplicate-identifier", attributePath(visit.path, attribute.value), {
      identifier,
      reading: "74",
    }),
  ];
};

/**
 * Apply reading 77 to a test's `qti-test-feedback`: its `outcome-identifier` is "The identifier of
 * an outcome variable that must have a base-type of identifier and be of either single or multiple
 * cardinality".
 *
 * A name the test declares no outcome for, a context variable or the built-in `duration` among
 * them, is `undeclared-variable`, expecting an outcome of the test; it is not refused where the
 * test's root holds an XInclude element, which may stand for the declaration (E23). A declared
 * outcome of another cardinality, or whose `base-type` is written and is not `identifier`, is
 * `expression-type` with `check: "feedback-outcome"`, its `baseType` (empty for a record, which has
 * none) and `cardinality`. A declaration whose type is not judged ({@link declarationType}), and an
 * `outcome-identifier` that is no NCName, are the structural validator's.
 *
 * @param source The test.
 * @param visit The element's visit.
 * @param outcomes The test's outcome declarations, by identifier.
 * @param rootIncludes Whether the test's root holds an XInclude element.
 * @returns The refusal at the `outcome-identifier` attribute's path, or none.
 */
const feedbackOutcome = (
  source: SourceDocument,
  visit: Visit,
  outcomes: ReadonlyMap<string, SourceElement>,
  rootIncludes: boolean,
): readonly Refusal[] => {
  const written = attributeOf(visit.element, "outcome-identifier");
  if (!isQti(visit.element, (local) => local === "qti-test-feedback") || Option.isNone(written)) {
    return [];
  }

  const identifier = trimXmlSpace(written.value.value);
  if (!isNcName(identifier)) {
    return [];
  }

  const path = attributePath(visit.path, written.value);
  const declaration = outcomes.get(identifier);
  if (declaration === undefined) {
    return rootIncludes
      ? []
      : [
          refusal(source, "undeclared-variable", path, {
            attribute: "outcome-identifier",
            declarer: "test",
            element: "qti-test-feedback",
            expected: "outcome",
            identifier,
            reading: "77",
          }),
        ];
  }

  return Option.match(declarationType(declaration), {
    onNone: () => [],
    onSome: ({ baseType, cardinality }) => {
      const typed = Option.isSome(attributeOf(declaration, "base-type"));
      const fits =
        (cardinality === "single" || cardinality === "multiple") &&
        (!typed || baseType === "identifier");

      return fits
        ? []
        : [
            refusal(source, "expression-type", path, {
              baseType: typed ? baseType : "",
              cardinality,
              check: "feedback-outcome",
              element: "qti-test-feedback",
              identifier,
              reading: "77",
            }),
          ];
    },
  });
};

/**
 * Apply reading 79's `count-range` to a section's `qti-selection`: a selection without replacement
 * selects at most its section's parts ({@link sectionParts}), each counted once, "The number of
 * children to select may exceed the number of child elements defined only if with-replacement is
 * true".
 *
 * `with-replacement` is read as `xs:boolean` reads it, false when unwritten. A `select` that is no
 * integer, or a `with-replacement` that is no `xs:boolean`, is the structural validator's. A
 * section holding an XInclude element among its children is not counted, since the include may
 * stand for parts (E23).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @returns The refusal at `select`'s path, its detail the `select` and the number of `parts`, or
 *   none.
 */
const selectionCount = (source: SourceDocument, visit: Visit): readonly Refusal[] => {
  const { element } = visit;
  const select = attributeOf(element, "select");
  const section = visit.parent.pipe(
    Option.filter((above) => isQti(above, (local) => local === "qti-assessment-section")),
  );
  if (
    !isQti(element, (local) => local === "qti-selection") ||
    Option.isNone(select) ||
    Option.isNone(section) ||
    holdsInclude(section.value)
  ) {
    return [];
  }

  const lexical = trimXmlSpace(select.value.value);
  const replaces = Option.match(attributeOf(element, "with-replacement"), {
    onNone: () => Option.some(false),
    onSome: (written) => xsBooleanOf(written.value),
  });
  if (!integerLexical.test(lexical) || !Option.exists(replaces, (replacing) => !replacing)) {
    return [];
  }

  const parts = section.value.children.filter(
    (child) => child.kind === "element" && isQti(child, (local) => sectionParts.has(local)),
  ).length;
  const selected = BigInt(lexical);

  return selected > BigInt(parts)
    ? [
        refusal(source, "count-range", attributePath(visit.path, select.value), {
          check: "selection",
          parts: String(parts),
          reading: "79",
          select: String(selected),
        }),
      ]
    : [];
};

/**
 * Read an `xs:boolean` attribute of an element, as `xs:boolean` reads it.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @param otherwise The value when it is unwritten or no `xs:boolean`.
 * @returns Its value.
 */
const flagOf = (element: SourceElement, local: string, otherwise: boolean): boolean =>
  attributeOf(element, local).pipe(
    Option.flatMap((attribute) => xsBooleanOf(attribute.value)),
    Option.getOrElse(() => otherwise),
  );

/**
 * Report whether a section has a child of a local name, in QTI's namespace, whose `xs:boolean`
 * attribute is true: a `qti-ordering` that shuffles, or a `qti-selection` with replacement.
 *
 * @param section The section.
 * @param child The child's local name.
 * @param attribute The attribute's local name.
 * @returns Whether such a child is there.
 */
const flaggedChild = (section: SourceElement, child: string, attribute: string): boolean =>
  section.children.some(
    (one) =>
      one.kind === "element" &&
      isQti(one, (local) => local === child) &&
      flagOf(one, attribute, false),
  );

/**
 * What a branch rule's target reads of the element a name gives, the scope it lies in: its test
 * part, whether a selection with replacement lies above it, and, for a section, how the order of
 * its children is drawn.
 */
interface BranchScope {
  /**
   * Whether it is a loose section whose looseness reaches its document's root, so in a section
   * document the section ref that places the document may draw its children's order.
   */
  readonly looseChain: boolean;
  /**
   * Whether its children's order is drawn at delivery: it is a section that shuffles, or a loose
   * section (invisible, not kept together) whose parent's order is drawn, which mixes its children
   * into its parent's (reading 87).
   */
  readonly mixes: boolean;
  /**
   * Its test part: itself for a test part, the part above it otherwise, none in a section document.
   */
  readonly part: Option.Option<SourceElement>;
  /**
   * Whether it lies under a section whose `qti-selection` has `with-replacement` true, that section
   * included.
   */
  readonly replaced: boolean;
}

/**
 * One element of the document a branch rule's `target` may name, one of {@link identifiedParts}
 * that writes an identifier, with its pre-order interval among the judged elements.
 */
interface BranchName extends BranchScope {
  readonly element: SourceElement;
  /**
   * One past the pre-order index of its last judged descendant.
   */
  readonly end: number;
  readonly parent: Option.Option<SourceElement>;
  /**
   * Its pre-order index among the judged elements.
   */
  readonly start: number;
}

/**
 * What reading 87 reads of a test or section document judged alone: its names, and what the
 * document alone cannot see.
 */
interface BranchContext {
  /**
   * Each name by its identifier, the first in document order where two share one.
   */
  readonly byIdentifier: ReadonlyMap<string, BranchName>;
  /**
   * Each name by its element.
   */
  readonly names: ReadonlyMap<SourceElement, BranchName>;
  /**
   * Whether a section ref places the document, so the order its placement draws may reorder the
   * root's children: true for a section document.
   */
  readonly placed: boolean;
  /**
   * Whether every target the document can reach is one of its names, so a target no name gives is
   * `unknown`: true for a test holding no section ref and no XInclude element. It is false for a
   * section document, whose test may supply the target, and for any document holding a section ref,
   * whose placed document may supply it, or an include, which may stand for it.
   */
  readonly resolvesAll: boolean;
}

/**
 * The scope above a section document's root, or above any element no scope covers: no part, no
 * replacement, no drawn order, and a looseness that reaches the root.
 */
const rootScope: BranchScope = {
  looseChain: true,
  mixes: false,
  part: Option.none(),
  replaced: false,
};

/**
 * Read the names a branch rule's target may give in a document, with the scope each lies in, as the
 * qti package reads a test or section document for reading 87.
 *
 * A test part scopes what lies under it to itself, with no drawn order. A section takes its
 * parent's part and replacement, adds its own `qti-selection`'s replacement, and draws its
 * children's order when it shuffles or is loose under a parent whose order is drawn; it is loose
 * when it is invisible (`visible`, false when unwritten) and does not keep together
 * (`keep-together`, true when unwritten). An item ref or a section ref takes its parent's part and
 * replacement, and draws no order. Only an identifier that is an NCName gives a name: one that is
 * not names nothing (reading 152 as amended), so no target resolves to it, and a rule its element
 * owns is left to the assembled test, as one whose owner writes no identifier is ({@link
 * branchTarget}).
 *
 * It reads the judged visits, where `openPackage`'s E8b (`layoutOf` in `#plate/package/open.ts`)
 * reads every element. The two differ only for an identified element in content the structural walk
 * passes over (what a `skip` wildcard admits, or an element under a `strict` one of a namespace
 * plate holds no tables for). No such element is a part, section or item ref the test delivers, so
 * the judged visits are the right reading, and a target that names one names nothing of the test.
 * The walks stay apart: moving E8b onto the judged visits would change what it refuses there.
 *
 * @param visits The judged visits, in document order, each parent before its children.
 * @param context Whether the document is a section document a section ref places, and whether a
 *   target no name gives is refused as `unknown`.
 * @returns The names, with the context.
 */
const branchContext = (
  visits: readonly Visit[],
  context: Pick<BranchContext, "placed" | "resolvesAll">,
): BranchContext => {
  const ends = new Map<SourceElement, number>();
  for (const [offset, { element, parent }] of visits.toReversed().entries()) {
    const end = ends.get(element) ?? visits.length - offset;
    ends.set(element, end);
    for (const above of Option.toArray(parent)) {
      ends.set(above, Math.max(ends.get(above) ?? 0, end));
    }
  }

  const scopes = new Map<SourceElement, BranchScope>();
  const byIdentifier = new Map<string, BranchName>();
  const names = new Map<SourceElement, BranchName>();
  for (const [start, { element, parent }] of visits.entries()) {
    const outer = parent.pipe(
      Option.flatMap((above) => Option.fromUndefinedOr(scopes.get(above))),
      Option.getOrElse(() => rootScope),
    );
    if (isQti(element, (local) => local === "qti-test-part")) {
      scopes.set(element, { ...rootScope, looseChain: false, part: Option.some(element) });
    } else if (isQti(element, (local) => local === "qti-assessment-section")) {
      const loose = !flagOf(element, "visible", false) && !flagOf(element, "keep-together", true);
      scopes.set(element, {
        looseChain: loose && outer.looseChain,
        mixes: flaggedChild(element, "qti-ordering", "shuffle") || (loose && outer.mixes),
        part: outer.part,
        replaced: outer.replaced || flaggedChild(element, "qti-selection", "with-replacement"),
      });
    } else if (isQti(element, (local) => identifiedParts.has(local))) {
      scopes.set(element, { ...outer, looseChain: false, mixes: false });
    }

    const identifier = attributeOf(element, "identifier").pipe(
      Option.filter((written) => isNcName(trimXmlSpace(written.value))),
    );
    const scope = scopes.get(element);
    if (scope !== undefined && Option.isSome(identifier)) {
      const name: BranchName = {
        ...scope,
        element,
        end: ends.get(element) ?? start + 1,
        parent,
        start,
      };
      names.set(element, name);

      const key = trimXmlSpace(identifier.value.value);
      if (!byIdentifier.has(key)) {
        byIdentifier.set(key, name);
      }
    }
  }

  return { ...context, byIdentifier, names };
};

/**
 * Report whether a name's pre-order interval holds a point.
 *
 * @param name The name.
 * @param point A pre-order index.
 * @returns Whether `start ≤ point < end`.
 */
const holdsPoint = (name: BranchName, point: number): boolean =>
  name.start <= point && point < name.end;

/**
 * Report whether a target lies after its rule's source, or their order is drawn at delivery.
 *
 * "After" is document order, which is the test's sequence wherever no shuffle can reorder the two
 * (reading 87): a target at or after the end of the rule's owner is forward. One before it is still
 * not judged when the two do not nest and the nearest name above the target that holds the source
 * draws its children's order (it shuffles, or a loose section mixes its children into one that
 * does), since "their order is drawn at delivery and is not judged here, in either direction". In a
 * section document that nearest name may be loose up to the root, so the section ref that places
 * the document may draw the order; the assembled test judges that (`openPackage`), not the
 * document alone.
 *
 * A `fixed` item ref or section, which keeps its place under a shuffle, is not read, so a pair it
 * would hold backward is accepted: a limit reading 87 records.
 *
 * @param owner The rule's owner.
 * @param target The name the target gives.
 * @param context The document's names.
 * @returns Whether the target lies after the source, or their order is drawn.
 */
const isForward = (owner: BranchName, target: BranchName, context: BranchContext): boolean => {
  if (target.start >= owner.end) {
    return true;
  }

  const point = owner.start;
  /**
   * Give the name that is a name's parent.
   *
   * @param name The name.
   * @returns Its parent's name, undefined when its parent is no name.
   */
  const above = (name: BranchName): BranchName | undefined =>
    name.parent.pipe(
      Option.flatMap((parent) => Option.fromUndefinedOr(context.names.get(parent))),
      Option.getOrUndefined,
    );
  let common = above(target);
  while (common !== undefined && !holdsPoint(common, point)) {
    common = above(common);
  }

  const nested = holdsPoint(target, point) || point <= target.start;

  return !nested && common !== undefined && (common.mixes || (context.placed && common.looseChain));
};

/**
 * Give why reading 87 refuses a target a name of the document gives, as the qti package's laws
 * "Branch target" and "Branch forward" judge it, in this order, one fault, one reason: a test
 * part's rule names a test part, and any other rule an item ref, section or section ref of its own
 * test part (`outside-part`); the target is no item ref a selection with replacement can repeat
 * (`repeatable`); it is not the rule's own owner (`self`); and it lies after the source
 * ({@link isForward}, `backward`).
 *
 * @param owner The rule's owner.
 * @param target The name the target gives.
 * @param context The document's names.
 * @returns The reason, none when the target holds.
 */
const branchFault = (
  owner: BranchName,
  target: BranchName,
  context: BranchContext,
): Option.Option<string> => {
  const ownsPart = isQti(owner.element, (local) => local === "qti-test-part");
  const isPart = isQti(target.element, (local) => local === "qti-test-part");
  const samePart = Option.getOrUndefined(owner.part) === Option.getOrUndefined(target.part);
  if (ownsPart ? !isPart : isPart || !samePart) {
    return Option.some("outside-part");
  }

  if (isQti(target.element, (local) => local === "qti-assessment-item-ref") && target.replaced) {
    return Option.some("repeatable");
  }

  if (target.element === owner.element) {
    return Option.some("self");
  }

  return isForward(owner, target, context) ? Option.none() : Option.some("backward");
};

/**
 * Apply reading 87's `branch-target` to a branch rule of a test or section document judged alone:
 * its `target` is a reserved exit ({@link branchExits}), or names a later part of the source's kind
 * in its own test part, never the source, an ancestor or a descendant ({@link branchFault}), with
 * section refs as leaves, since from outside a section document no target lies inside it.
 *
 * A target no name of the document gives is `unknown` in a test, but not where the test holds a
 * section ref, since the section document it places may supply the target once or twice, or an
 * XInclude element, which may stand for it (E23); in a section document it is left to the assembled
 * test, which may supply it. So is what only the placement of a section document decides: a
 * replacement or a shuffle above the section ref that places it. `openPackage` judges the same
 * rule over the assembled test (E8b), with the same detail at the same path, and does not give
 * again what this gives. A rule on an owner that writes no identifier, or one that names nothing
 * (reading 152 as amended: it is no NCName), is not judged here: the structural validator refuses
 * the owner, and `openPackage` refuses the rule `unknown` over the assembled test (reading 147).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's names ({@link branchContext}).
 * @returns The refusal at the `target` attribute's path, its detail the `target`, as its outer
 *   whitespace is removed, the `reason` and `reading: "87"`; or none.
 */
const branchTarget = (
  source: SourceDocument,
  visit: Visit,
  context: BranchContext,
): readonly Refusal[] => {
  const written = attributeOf(visit.element, "target");
  const owner = visit.parent.pipe(
    Option.filter((above) => isQti(above, (local) => branchOwners.has(local))),
    Option.flatMap((above) => Option.fromUndefinedOr(context.names.get(above))),
  );
  if (
    !isQti(visit.element, (local) => local === "qti-branch-rule") ||
    Option.isNone(written) ||
    Option.isNone(owner)
  ) {
    return [];
  }

  const target = trimXmlSpace(written.value.value);
  if (branchExits.has(target)) {
    return [];
  }

  const reason = Option.match(Option.fromUndefinedOr(context.byIdentifier.get(target)), {
    onNone: () => (context.resolvesAll ? Option.some("unknown") : Option.none()),
    onSome: (named) => branchFault(owner.value, named, context),
  });

  return Option.match(reason, {
    onNone: () => [],
    onSome: (fault) => [
      refusal(source, "branch-target", attributePath(visit.path, written.value), {
        reading: "87",
        reason: fault,
        target,
      }),
    ],
  });
};

/**
 * Check a test or section document against the test prose rules: `duplicate-identifier` over its
 * parts, sections, item refs and section refs, readings 24 and 25's `misplaced-element` for an
 * interaction or a template element in a rubric block or test feedback, reading 23's
 * `expression-placement` for an outcome-only expression, or a weighted `qti-variable`, outside
 * outcome processing, reading 79's `count-range` for a selection without replacement of more than
 * its section's parts ({@link selectionCount}), reading 87's `branch-target` for a branch rule's
 * target ({@link branchTarget}), and, in a test, reading 74's `duplicate-identifier` over its
 * declarations, one namespace ({@link duplicateDeclaration}), reading 77's `undeclared-variable`
 * and `expression-type` for what a `qti-test-feedback` names ({@link feedbackOutcome}), and
 * `undeclared-variable` and `expression-type` for what a
 * `qti-printed-variable` names, judged as an item's are (`printedVariableReferences`): its
 * `identifier` names an outcome the test declares, and its `base` and `index`, written as a name, a
 * single integer outcome the test declares, where a context variable or a built-in of the test
 * (`QTI_CONTEXT`, `duration`) is refused by its kind. A section document's printed variables are
 * not judged, since a section declares nothing. A field of a record declaration's value that lacks
 * `field-identifier` or `base-type` is `missing-attribute`, and one whose text is outside its own
 * `base-type` is `value-type`, at the paths and with the details an item's gets
 * (`recordFieldRefusals`, `info.txt:73046`). A `data-ssml` value that is not Data-SSML JSON, in a
 * rubric block or test feedback of a test or a section, is `attribute-type`, `check: "data-ssml"`,
 * as an item's is ({@link dataSsml}, the operator's P3). Readings 126 and 127 name no document
 * kind, so a rubric block's and a test feedback's content is judged as an item's body is: a `td`'s
 * or a `th`'s `headers` that names no header of the cell's own table, or names one twice, is
 * `attribute-type`, `check: "headers"` ({@link tableHeaders}, reading 126, E29), and a `q` a
 * quotation mark stands against is `text-not-allowed`, `check: "quotation"` ({@link quotation},
 * reading 127, E30), each read through the document's own placing ({@link placingOf}).
 *
 * A section's parts are not counted: a section that holds a rubric block alone, or nothing, is
 * valid, since reading 26 holds that "an assessment section may hold no part".
 *
 * Its expressions are judged by the item's processing rules (`processingRefusals`, the qti
 * package's P8, P20 to P24 and P29), with every prefixed read typed `unknown`
 * ({@link unknownPrefix}). Each of their refusals is placed after the test rules' at the element
 * it judges ({@link elementPathOf}); one at no judged element, which those rules never give, would
 * follow all the others rather than be lost.
 *
 * The rules judge exactly what the structural walk checks, and only a document they can read
 * whole:
 *
 * - A root other than a QTI `qti-assessment-test` or `qti-assessment-section` gives no refusal; an
 *   item's rules are `checkRules`'.
 * - A document whose judged elements hold an unexpanded entity reference anywhere gives no refusal,
 *   as `checkRules` gives none for such an item: `identifier="&id;"` on one item ref could equal
 *   any other's, and an entity among an element's children may stand for an item ref or a section
 *   whose identifier repeats another's. The verdict leaves such a document unchecked unless the
 *   structural walk refuses it.
 * - Only the elements the structural walk checks are visited, the keys of `governingTables` for the
 *   same tables (reading 57).
 * - Nothing inside an XInclude `include` is judged, its `xi:fallback` included: the walk passes over
 *   an include and everything below it, in a section, in outcome processing and in wildcard content
 *   alike, so no rule here or in the processing rules reads what a fragment stands in for. The
 *   verdict leaves a document holding an include unchecked (E23), since an included fragment is
 *   judged in place, as its merged document holds it (reading 117), and plate never fetches it.
 *
 * Every refusal is located at an element or attribute path. An empty list means no rule this module
 * implements refuses the document, not that it is valid: the structural validator judges the XSD's
 * rules, and a package judges what needs the items it holds.
 *
 * @param source The test or section document to check.
 * @param tables The tables generated from the QTI XSD, the ones `checkStructure` checks the
 *   document by.
 * @returns The refusals in document order, empty when every rule holds or the document is one the
 *   rules do not judge.
 * @see {@link Refusal} for what each refusal carries.
 */
export const checkTestRules = (source: SourceDocument, tables: Tables): readonly Refusal[] => {
  if (!isQti(source.root, (local) => testRoots.has(local))) {
    return [];
  }

  const { includes, parents, visits } = judgedVisits(source, tables);
  if (visits.some((visit) => holdsUnexpanded(visit.element))) {
    return [];
  }

  const seen = new Set<string>();
  const declared = new Set<string>();
  const fields = new Map<SourceElement, Set<string>>();
  const test = isQti(source.root, (local) => local === "qti-assessment-test");
  const scope = test ? Option.some(testScope(source)) : Option.none();
  const outcomes = declarationsOf(source, "qti-outcome-declaration");
  const rootIncludes = holdsInclude(source.root);
  const placesSections = visits.some((visit) =>
    isQti(visit.element, (local) => local === "qti-assessment-section-ref"),
  );
  const branches = branchContext(visits, {
    placed: !test,
    resolvesAll: test && !includes && !placesSections,
  });
  const processing = Map.groupBy(processingRefusals(source, tables, unknownPrefix), elementPathOf);
  const placing = placingOf(source);
  const placed = visits.flatMap((visit) => {
    const atVisit = processing.get(visit.path) ?? [];
    processing.delete(visit.path);

    return [
      ...duplicateIdentifier(source, visit, seen),
      ...misplacedInTestContent(source, visit, parents),
      ...expressionPlacement(source, visit, parents),
      ...recordFieldRefusals(source, visit, parents),
      ...repeatedField(source, visit, parents, fields),
      ...masteryRange(source, visit),
      ...Option.match(scope, {
        onNone: () => [],
        onSome: (variables) => [
          ...duplicateDeclaration(source, visit, declared),
          ...printedVariableReferences(source, visit, variables),
          ...feedbackOutcome(source, visit, outcomes, rootIncludes),
        ],
      }),
      ...selectionCount(source, visit),
      ...branchTarget(source, visit, branches),
      ...tableHeaders(source, visit, placing),
      ...quotation(source, visit, placing),
      ...dataSsml(source, visit, tables),
      ...atVisit,
    ];
  });

  return [...placed, ...[...processing.values()].flat()];
};
