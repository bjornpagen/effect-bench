/**
 * The refusals a document's QTI version decides, which only a package's manifest states.
 *
 * `check` calls {@link checkVersion} after the structural validator and the prose rules, with
 * their refusals in hand, under the version its caller gives: a package's own, as its manifest's
 * `schemaversion` states it, or none for a document opened alone (OD-A54-3), which no rule here
 * judges. Like the prose rules, these judge exactly the elements the structural walk checks, the
 * keys of `governingTables`: reading 57, "In lax wildcard content, every prose rule judges the QTI
 * elements the structural walk checks there, as it judges them anywhere else". So in a
 * `qti-custom-interaction`'s lax content a global QTI element the walk checks is judged here, and
 * what the walk passes over earns nothing: a QTI element the XSD declares only locally, and a
 * nested QTI root with all it holds (reading 6). Each rule judges one version:
 *
 * - QTI 3.0.0: a `qti-custom-interaction` is refused (the operator's P2), as 3.0.0 deprecates it for
 *   a Portable Custom Interaction.
 * - QTI 3.0.1: an item root that carries a `label` carries `tool-name` and `tool-version` (reading
 *   128, "A `label` asks for the tool that labelled it where its own characteristic's description
 *   says so: a body element's in both versions, and a QTI 3.0.1 item's own"), and a `mastery-value`
 *   is at least 0.0 where its outcome declaration writes no `normal-minimum` (reading 149, "An
 *   outcome declaration's `normal-minimum` is 0.0 where a QTI 3.0.1 document writes none").
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
import { readIeeeDouble, trimXmlSpace } from "#plate/model/values.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import { governingTables } from "#plate/validate/structure.ts";
import type { Tables } from "#plate/validate/xsd.ts";
import type { CpVersion } from "#plate/vocabulary.ts";

/**
 * The tool attributes an item root carries when it uses labels, in the order a refusal lists
 * them.
 */
const toolAttributes = ["tool-name", "tool-version"] as const;

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
 * List the elements this module's rules judge, in document order: exactly those the structural
 * walk checks, the keys of `governingTables` (reading 57), as `judgedVisits` in
 * `#plate/validate/rules.ts` lists them for the prose rules. That module imports this one, so this
 * one reads the same admission here rather than import it, which would close a cycle.
 *
 * @param source The document.
 * @param tables The tables generated from the QTI XSD, the ones the structural walk checks it by.
 * @returns Each judged element, with the path and the parent `walk` gives it.
 */
const judgedVisits = (source: SourceDocument, tables: Tables): readonly Visit[] => {
  const governing = governingTables(source, tables);

  return [...walk(source)].filter((visit) => governing.has(visit.element));
};

/**
 * Give the tool attributes an item root lacks, in the order a `label-tool` refusal lists them
 * (reading 128): this module's E31b for a QTI 3.0.1 root's own `label`, and E31a for a body
 * element's (`labelTool` in `#plate/validate/rules.ts`).
 *
 * @param root The item root.
 * @returns The missing ones of `tool-name` and `tool-version`; none when it carries both.
 */
export const missingToolAttributes = (root: SourceElement): readonly string[] =>
  toolAttributes.filter((name) => Option.isNone(attributeOf(root, name)));

/**
 * Refuse each `qti-custom-interaction` of a QTI 3.0.0 document (the operator's P2): 3.0.0
 * deprecates it and requires a `qti-portable-custom-interaction` in its place. Plate keeps the
 * operator's ruling (overseer `b7d702d6`), which main now shares as R10-b ("A 3.0.0 document holds
 * no `qti-custom-interaction`; a 3.0.1 document may"): main and pantry refuse it too (pantry's
 * `Custom interaction version` law, `packages/pantry/src/qti/interactions.ts`). Only a custom
 * interaction the structural walk checks is judged (reading 57). The XSD declares it only locally,
 * so one inside another's lax content has no declaration the walk can find there: the walk passes
 * it over, and it earns nothing.
 *
 * @param visits The document's judged elements, as {@link judgedVisits} lists them.
 * @param source The document.
 * @returns One `unknown-element` refusal at each judged custom interaction, in document order.
 */
const customInteractions = (visits: readonly Visit[], source: SourceDocument): readonly Refusal[] =>
  visits
    .filter(
      ({ element }) =>
        element.namespace === qtiNamespace && element.local === "qti-custom-interaction",
    )
    .map(({ element, parent, path }) =>
      refuse(source, "unknown-element", path, {
        check: "custom-interaction",
        element: element.local,
        ...Option.match(parent, {
          onNone: () => ({}),
          onSome: (holder) => ({ parent: holder.local }),
        }),
        version: "3.0.0",
      }),
    );

/**
 * Report whether a refusal is a `label-tool` refusal at the item root, the one an item that
 * labels a body element earns (E31a), which a root's own label adds nothing to.
 *
 * @param refusal A refusal already given.
 * @param rootPath The item root's path.
 * @returns Whether it is that refusal.
 */
const isRootLabelTool = (refusal: Refusal, rootPath: string): boolean =>
  refusal.rule === "missing-attribute" &&
  refusal.detail["check"] === "label-tool" &&
  refusal.location.kind === "path" &&
  refusal.location.path === rootPath;

/**
 * Refuse a QTI 3.0.1 item root that carries a `label` and lacks a tool attribute (reading 128,
 * E31b): the 3.0.1 information model states of the item's own `label` that "If an item uses labels
 * then values for the associated toolName and toolVersion attributes must also be provided"
 * (section 4.1.3). An item one of whose body elements already earned the `label-tool` refusal at
 * its root gets no second one.
 *
 * @param source The document.
 * @param refusals The refusals the validators already gave it.
 * @returns The one refusal, at the root, listing the missing tool attributes; none otherwise.
 */
const rootLabel = (source: SourceDocument, refusals: readonly Refusal[]): readonly Refusal[] => {
  const { root } = source;
  const path = root.local;
  const missing = missingToolAttributes(root);
  const judged =
    root.namespace === qtiNamespace &&
    root.local === "qti-assessment-item" &&
    Option.isSome(attributeOf(root, "label")) &&
    missing.length > 0 &&
    !refusals.some((refusal) => isRootLabelTool(refusal, path));

  return judged
    ? [
        refuse(source, "missing-attribute", path, {
          attribute: missing.join(" "),
          check: "label-tool",
          element: root.local,
          labelled: path,
          reading: "128",
        }),
      ]
    : [];
};

/**
 * Refuse each `mastery-value` below 0.0 on a QTI 3.0.1 outcome declaration that writes no
 * `normal-minimum` (reading 149, E42b): 3.0.1 gives `normal-minimum` the default 0.0, and the
 * Schematron's RULE SPECIFIC CLASS OUTCOMEDEC 1 holds a mastery value at least the normal minimum.
 * The value is compared by its IEEE double (reading 144); one outside xs:double's lexical space is
 * the structural validator's to refuse, and earns nothing here. A declaration that writes its
 * `normal-minimum` is not judged here: its written bounds are E42a's. Only a declaration the
 * structural walk checks is judged (reading 57). The walk checks one in a custom interaction's lax
 * content as QTI, so it is judged as anywhere else, while one inside a nested QTI root there
 * (reading 6) is passed over and earns nothing.
 *
 * @param visits The document's judged elements, as {@link judgedVisits} lists them.
 * @param source The document, an item's or a test's outcome declarations alike.
 * @returns One `attribute-type` refusal at each such `mastery-value`, in document order.
 */
const masteryFloor = (visits: readonly Visit[], source: SourceDocument): readonly Refusal[] =>
  visits.flatMap(({ element, path }) => {
    if (
      element.namespace !== qtiNamespace ||
      element.local !== "qti-outcome-declaration" ||
      Option.isSome(attributeOf(element, "normal-minimum"))
    ) {
      return [];
    }

    return Option.toArray(attributeOf(element, "mastery-value")).flatMap((mastery) =>
      Option.match(readIeeeDouble(trimXmlSpace(mastery.value)), {
        onNone: () => [],
        onSome: (value) =>
          value < 0
            ? [
                refuse(source, "attribute-type", attributePath(path, mastery), {
                  attribute: mastery.local,
                  check: "mastery-range",
                  element: element.local,
                  least: "0.0",
                  reading: "149",
                  value: mastery.value,
                }),
              ]
            : [],
      }),
    );
  });

/**
 * Give the refusals a document's QTI version decides, after the structural validator and the prose
 * rules gave theirs: under 3.0.0 each `qti-custom-interaction` (P2), and under 3.0.1 an item root's
 * own `label` without its tools (E31b) and a `mastery-value` below the default `normal-minimum`
 * (E42b). A document of no stated version, opened alone, earns none (OD-A54-3). P2 and E42b judge
 * only the elements the structural walk checks, the keys of `governingTables` (reading 57), as the
 * prose rules do.
 *
 * @param source The document, its root in QTI's namespace.
 * @param tables The tables generated from the QTI XSD, the ones the structural walk checks it by.
 * @param version Its version as its package's manifest states it, or none.
 * @param refusals The refusals the validators already gave it, which E31b reads.
 * @returns The refusals, in the order above, each rule's in document order.
 */
export const checkVersion = (
  source: SourceDocument,
  tables: Tables,
  version: Option.Option<CpVersion>,
  refusals: readonly Refusal[],
): readonly Refusal[] =>
  Option.match(version, {
    onNone: () => [],
    onSome: (stated) => {
      switch (stated) {
        case "3.0.0": {
          return customInteractions(judgedVisits(source, tables), source);
        }
        case "3.0.1": {
          return [
            ...rootLabel(source, refusals),
            ...masteryFloor(judgedVisits(source, tables), source),
          ];
        }
        default: {
          return stated satisfies never;
        }
      }
    },
  });
