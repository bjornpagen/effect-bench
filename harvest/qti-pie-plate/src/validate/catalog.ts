/**
 * The catalog rules of R9-a ("The catalog sentences of the information model hold as written"),
 * which the XSD states none of, as the qti package's `Card support`, `Card default entry` and
 * `Catalog reference` laws hold them (`packages/pantry/src/qti/catalog.ts`):
 *
 * - A `qti-catalog` holds one `qti-card` per support: "Use only one card for any particular named
 *   support in a catalog" (§5.26.1, `info.txt:21097`).
 * - A `qti-card` holds at most one `qti-card-entry` designated default: "Only one of the CardEntry
 *   instances can have a default designation" (§5.27.2, `info.txt:21284`).
 * - A `data-catalog-idref` names a `qti-catalog` of its own document: a catalog's `id` is "The unique
 *   identifier used to locate the catalog from a data-catalog-idref" (§5.28.1, `info.txt:21437`),
 *   and "The associated 'catalog' MUST be supplied in the same 'assessmentItem' definition"
 *   (§5.15.9). The XSD types the attribute `xs:IDREF`, so the ID table alone would accept a token
 *   that is any element's ID.
 *
 * A `support` is compared by its collapsed value (XML Schema's whiteSpace `collapse`), so
 * `" spoken "` and `spoken` name one support. An entry's `default` is an `xs:boolean`, which
 * designates where its collapsed value is `true` or `1`; `false`, `0` and an entry that writes no
 * `default` (the XSD's default, `false`) designate nothing. A `data-catalog-idref`'s token is its
 * value collapsed, as `xs:IDREF` reads it.
 *
 * Its limit, by rule `db2ef322`: plate judges each document alone, so a test's or a section's
 * `data-catalog-idref` that names a catalog of a section document it places (reading 117's
 * assembly) names no ID of its own document, and the ID table refuses it (`idref-target`). No
 * corpus test places one.
 *
 * @module
 */
import { Option } from "effect";
import { attributePath, qtiNamespace, walk } from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceDocument,
  SourceElement,
  Visit,
} from "#plate/document/source.ts";
import { collapseXmlSpace, xsBooleanOf } from "#plate/model/attributes.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import { holdsUnexpanded } from "#plate/validate/rules.ts";
import { governingTables, idHoldersOf, isIdrefType } from "#plate/validate/structure.ts";
import type { ContentTable, Tables } from "#plate/validate/xsd.ts";

/**
 * The line of QTI's information model that settles one card per support, which a `card-support`
 * refusal cites (R9-a has no number yet, and the line stays true when it gets one).
 */
const supportSource = "info.txt:21097";

/**
 * The line of QTI's information model that settles one default entry per card, which a
 * `card-default` refusal cites.
 */
const defaultSource = "info.txt:21284";

/**
 * The line of QTI's information model that settles that a `data-catalog-idref` names a catalog,
 * which a `catalog-reference` refusal cites.
 */
const referenceSource = "info.txt:21437";

/**
 * The attribute by which content names its catalog.
 */
const referenceName = "data-catalog-idref";

/**
 * Construct a refusal of the document at a path.
 *
 * @param source The document.
 * @param rule The rule it breaks.
 * @param path The element or attribute path.
 * @param detail The facts its wording reads.
 * @returns The refusal.
 */
const refuse = (
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
 * Report whether an element is QTI's element of a local name.
 *
 * @param element The element.
 * @param local The local name.
 * @returns Whether `element` is the QTI element `local`.
 */
const isQti = (element: SourceElement, local: string): boolean =>
  element.namespace === qtiNamespace && element.local === local;

/**
 * Find an element's attribute in no namespace.
 *
 * @param element The element.
 * @param local The attribute's name.
 * @returns The attribute, or none when the element does not carry it.
 */
const attributeOf = (element: SourceElement, local: string): Option.Option<SourceAttribute> =>
  Option.fromUndefinedOr(
    element.attributes.find((attribute) => attribute.namespace === "" && attribute.local === local),
  );

/**
 * Read an element's attribute collapsed, `""` where the element carries none: a catalog's `id` and
 * a card's `support` are required, so the structural walk refuses an element that lacks one.
 *
 * @param element The element.
 * @param local The attribute's name.
 * @returns The collapsed value.
 */
const collapsedAttribute = (element: SourceElement, local: string): string =>
  Option.match(attributeOf(element, local), {
    onNone: () => "",
    onSome: (attribute) => collapseXmlSpace(attribute.value),
  });

/**
 * Report whether a `qti-card-entry` designates itself its card's default: its `default`, read as
 * `xs:boolean`, is true.
 *
 * @param entry The entry.
 * @returns Whether it designates itself default.
 */
const designatesDefault = (entry: SourceElement): boolean =>
  Option.match(attributeOf(entry, "default"), {
    onNone: () => false,
    onSome: (attribute) => Option.getOrElse(xsBooleanOf(attribute.value), () => false),
  });

/**
 * Name an element as a refusal's detail does: its local name in the QTI namespace and
 * `{<namespace>}<local>` otherwise.
 *
 * @param element The element.
 * @returns Its name.
 */
const elementName = (element: SourceElement): string =>
  element.namespace === qtiNamespace ? element.local : `{${element.namespace}}${element.local}`;

/**
 * One `data-catalog-idref` whose token is no catalog's `id`, which the document's IDs settle.
 */
interface Unresolved {
  readonly attribute: SourceAttribute;
  /**
   * The value collapsed, as `xs:IDREF` reads it.
   */
  readonly token: string;
}

/**
 * Find an element's `data-catalog-idref` as the ID table reads it: an attribute in no namespace
 * that the table governing the element declares, not prohibited, of a type the ID table reads as an
 * IDREF ({@link isIdrefType}), as QTI's XSD types it `xs:IDREF` everywhere it declares it. An
 * undeclared one is no IDREF, and the structural walk judges it.
 *
 * @param element The element.
 * @param table The table that governs it.
 * @returns The attribute, or none.
 */
const catalogReferenceOf = (
  element: SourceElement,
  table: ContentTable,
): Option.Option<SourceAttribute> =>
  table.attributes.some(
    (declaration) =>
      declaration.namespace === "" &&
      declaration.local === referenceName &&
      declaration.use !== "prohibited" &&
      isIdrefType(declaration.type),
  )
    ? attributeOf(element, referenceName)
    : Option.none();

/**
 * Check one element against the card rules: a `qti-card` whose support its catalog already holds,
 * and a `qti-card` with more than one entry designated default.
 *
 * @param source The document.
 * @param visit The element, its parent and its path.
 * @param governing The table that governs each element the structural walk checks.
 * @param supports The supports each catalog's earlier cards gave, which this adds to.
 * @returns The element's refusals, its support's before its entries'.
 */
const checkCard = (
  source: SourceDocument,
  { element, parent, path }: Visit,
  governing: ReadonlyMap<SourceElement, ContentTable>,
  supports: Map<SourceElement, Set<string>>,
): readonly Refusal[] => {
  if (!isQti(element, "qti-card")) {
    return [];
  }

  const refusals: Refusal[] = [];
  const support = collapsedAttribute(element, "support");
  const supportAttribute = attributeOf(element, "support");
  if (
    Option.isSome(parent) &&
    isQti(parent.value, "qti-catalog") &&
    Option.isSome(supportAttribute)
  ) {
    const seen = supports.get(parent.value) ?? new Set<string>();
    supports.set(parent.value, seen);
    if (seen.has(support)) {
      refusals.push(
        refuse(source, "duplicate-identifier", attributePath(path, supportAttribute.value), {
          catalog: collapsedAttribute(parent.value, "id"),
          check: "card-support",
          source: supportSource,
          support,
        }),
      );
    }

    seen.add(support);
  }

  const defaults = element.children.filter(
    (child): child is SourceElement =>
      child.kind === "element" &&
      isQti(child, "qti-card-entry") &&
      governing.has(child) &&
      designatesDefault(child),
  ).length;
  if (defaults > 1) {
    refusals.push(
      refuse(source, "child-count", path, {
        check: "card-default",
        count: `${defaults}`,
        element: element.local,
        source: defaultSource,
        support,
      }),
    );
  }

  return refusals;
};

/**
 * Check one element's `data-catalog-idref`, whose token is no catalog's `id`, against the
 * document's IDs: a token that is the ID of an element other than a `qti-catalog` is
 * `attribute-type`, `check: "catalog-reference"`, at the attribute. A token that is no ID of the
 * document is the ID table's (`idref-target`), one cause under one rule, and is passed over here.
 *
 * @param source The document.
 * @param visit The element, its parent and its path.
 * @param reference The element's `data-catalog-idref` and its token.
 * @param holders The document's IDs, each with the element that holds it.
 * @returns The refusal, or none.
 */
const checkReference = (
  source: SourceDocument,
  { element, path }: Visit,
  reference: Unresolved,
  holders: ReadonlyMap<string, SourceElement>,
): readonly Refusal[] =>
  Option.toArray(
    Option.map(
      Option.filter(
        Option.fromUndefinedOr(holders.get(reference.token)),
        (holder) => !isQti(holder, "qti-catalog"),
      ),
      (holder) =>
        refuse(source, "attribute-type", attributePath(path, reference.attribute), {
          attribute: referenceName,
          check: "catalog-reference",
          element: elementName(element),
          source: referenceSource,
          target: holder.local,
          value: reference.token,
        }),
    ),
  );

/**
 * Check a document's catalogs against R9-a's card rules, in document order:
 *
 * - A `qti-card` of a `qti-catalog` whose collapsed `support` an earlier card of that catalog gave is
 *   `duplicate-identifier`, `check: "card-support"`, at its `support`, with the `support` and the
 *   catalog's collapsed `id` as `catalog`. The same support in two catalogs is two supports.
 * - A `qti-card` holding two or more `qti-card-entry` children that designate themselves default is
 *   `child-count`, `check: "card-default"`, at the card, once, with its `support` and the `count`
 *   of such entries.
 * - A `data-catalog-idref` whose token is the ID of an element other than a `qti-catalog` is
 *   `attribute-type`, `check: "catalog-reference"`, at the attribute, with the `element` that
 *   carries it, the token as the `value` and the local name of the element whose ID it is as the
 *   `target`. A token that is a catalog's `id` is accepted, and one that is no ID of the document
 *   is left to the ID table's `idref-target`. The document's IDs are the ID table's own
 *   ({@link idHoldersOf}), found only for a document with a token that is no catalog's `id`.
 *
 * A catalog stands in every root kind: `qti-catalog-info` is a child of an item, a stimulus, a PCI,
 * a rubric block, a template block, a feedback block, modal feedback and test feedback. It judges
 * as the other prose rules do: only the elements the structural walk checks, the keys of
 * `governingTables` (reading 57), and nothing in a document whose judged elements hold an
 * unexpanded entity reference, which the verdict leaves unchecked unless the structural walk
 * refuses it.
 *
 * @param source The document.
 * @param tables The tables generated from the QTI XSD.
 * @returns The refusals in document order, a card's support before its entries, an element's card
 *   refusals before its reference's.
 */
export const checkCatalogs = (source: SourceDocument, tables: Tables): readonly Refusal[] => {
  const governing = governingTables(source, tables);
  const visits = [...walk(source)].filter((visit) => governing.has(visit.element));
  if (visits.some((visit) => holdsUnexpanded(visit.element))) {
    return [];
  }

  const catalogIds = new Set(
    visits
      .filter(({ element }) => isQti(element, "qti-catalog"))
      .map(({ element }) => collapsedAttribute(element, "id")),
  );
  const unresolved = new Map<SourceElement, Unresolved>();
  for (const { element } of visits) {
    const attribute = Option.flatMap(Option.fromUndefinedOr(governing.get(element)), (table) =>
      catalogReferenceOf(element, table),
    );
    if (Option.isSome(attribute)) {
      const token = collapseXmlSpace(attribute.value.value);
      if (token !== "" && !catalogIds.has(token)) {
        unresolved.set(element, { attribute: attribute.value, token });
      }
    }
  }

  const holders =
    unresolved.size > 0 ? idHoldersOf(source, tables) : new Map<string, SourceElement>();
  const supports = new Map<SourceElement, Set<string>>();

  return visits.flatMap((visit) => {
    const reference = unresolved.get(visit.element);

    return [
      ...checkCard(source, visit, governing, supports),
      ...(reference === undefined ? [] : checkReference(source, visit, reference, holders)),
    ];
  });
};
