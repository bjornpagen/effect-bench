/**
 * A QTI 3.0 content package's manifest, read into its model and checked by every rule that needs
 * only the manifest: {@link readManifest}.
 *
 * The rules run in the order a host meets their failures. A root outside QTI 3.0's packaging
 * namespace is `not-qti3-package`, alone. `metadata/schemaversion` then picks the profile, `3.0.0`
 * or `3.0.1`, and any other value, or none, is `package-profile`, alone. The manifest is then
 * walked against that profile's tables (`packageTables`), every namespace its imports reach
 * included, so LOM, QTI metadata, curriculum standards and the CP extension are checked inside
 * `metadata` as XML Schema assesses them (Q6). Each element of the manifest's namespace the walk
 * checks then holds each child its profile names as many times as the profile's occurrences admit,
 * which the walk leaves alone: the root's `organizations` and `resources` once each, a resource's
 * `file` at least once. Each LOM element the walk checks holds each child the loose LOM binding's
 * Schematron caps at most once (reading 130, {@link lomCaps}). The manifest's own rules follow: a
 * resource's `href` references one of its `file` entries, a `dependency` names a resource, a
 * document resource's `href` names a path inside the package's root (reading 102), and no LOM
 * `learningResourceType` of the LOM vocabulary is `exam` or `self assessment` (reading 122). The
 * walk's refusals, the counts' and the rules' are reported together, in that order. What needs the
 * package's files or documents, which files exist and what each document's root is, belongs to the
 * package reader. {@link resourceLom} reads what each resource's own LOM metadata gives as its
 * object's identifier, title and languages, which the package reader compares with the object's
 * document (reading 62, "an item's or test's identifier and title are those its package's LOM
 * metadata gives it", and reading 134).
 *
 * The readings the manifest binds: `qtiMetadata` is admitted as a `cp:metadata` child or inside
 * `lom` (reading 32), a `controlfile` resource and a packaged XSD listed as a file are admitted
 * (reading 33), an absolute `href` is admitted and stored as written, never fetched (reading 35),
 * one file may be listed twice by a resource and by several resources (reading 36), and every
 * `href` and `xml:base` is collapsed, as an `xs:anyURI` is, and resolved by RFC 3986: a `file`'s or
 * a non-document resource's that leads outside the package is an external link, admitted and never
 * looked for (reading 102).
 *
 * @module
 */
import { Data, Option, Result } from "effect";
import type { Array as Arr } from "effect";
import { resolveInside, schemePrefix, withoutQuery } from "#plate/document/href.ts";
import { attributePath, walk, xmlNamespace } from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceChild,
  SourceDocument,
  SourceElement,
} from "#plate/document/source.ts";
import { collapseXmlSpace } from "#plate/model/attributes.ts";
import { isNcName } from "#plate/model/values.ts";
import { packageOccurrences, packageTables } from "#plate/package/tables.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import { checkStructure, governingTables } from "#plate/validate/structure.ts";
import type { ChildOccurrence, ContentTable, Occurrences, Tables } from "#plate/validate/xsd.ts";
import { cpVersions, manifestNamespace, resourceTypes } from "#plate/vocabulary.ts";
import type { CpVersion } from "#plate/vocabulary.ts";

/**
 * One `href` a manifest writes, on a `resource` or a `file`, with the package path it names.
 *
 * `path` is the file's path from the package's root, which is where the manifest sits: the
 * reference collapsed, resolved against the `xml:base` values above it, its dot segments removed,
 * each segment's percent escapes decoded and its query and fragment set aside, so
 * `./items/a%20b.xml`, padded with spaces or not, names `items/a b.xml`. It is none for an external
 * link, which the package does not hold and which is never fetched: an absolute URI (reading 35), a
 * path from a host's root, or one whose `..` climbs above the package's root (reading 102).
 */
export interface ManifestHref {
  /**
   * The value as the manifest writes it.
   */
  readonly href: string;
  readonly path: Option.Option<string>;
}

/**
 * One `resource` of a read manifest, its `file` and `dependency` entries in document order.
 */
export interface ManifestResource {
  /**
   * The `identifierref` of each `dependency` as written, each naming a resource of the same
   * manifest, compared with the resource's `identifier` collapsed, as `xs:IDREF` and `xs:ID` read
   * them.
   */
  readonly dependencies: readonly string[];
  /**
   * Each `file` entry, duplicates kept (reading 36).
   */
  readonly files: readonly ManifestHref[];
  /**
   * The resource's own `href`, its launchable entry, which one of its `file` entries references.
   */
  readonly href: Option.Option<ManifestHref>;
  readonly identifier: string;
  /**
   * The resource element's path in the manifest, the location a refusal of the resource names.
   */
  readonly location: string;
  /**
   * The resource type as written, one of the profile's enumeration.
   */
  readonly type: string;
}

/**
 * What one LOM `general` gives as its object's identifier or its title: each value as written, in
 * document order, with the language each states, and where the first element holding one is.
 */
export interface LomValues {
  /**
   * The `language` each value's `string` writes, as written, one for each of `values` in its order:
   * none for a `string` that writes none, and for every `identifier` entry, which states no
   * language. A title string is compared in its document's language by it (reading 62, "an item's
   * or test's identifier and title are those its package's LOM metadata gives it").
   */
  readonly languages: readonly Option.Option<string>[];
  /**
   * The path of the first `identifier`, or `title`, of the `general` that holds a value, where a
   * refusal of the values points.
   */
  readonly location: string;
  /**
   * The text of each `identifier`'s `entry`, or of each `title`'s `string`.
   */
  readonly values: Arr.NonEmptyReadonlyArray<string>;
}

/**
 * The identifier, languages and title one LOM `general` in a resource's own metadata gives the
 * object its document is, the identifier and title each none when the `general` gives none, and
 * where the `general` is.
 */
export interface LomGeneral {
  readonly identifier: Option.Option<LomValues>;
  /**
   * The text of each of the `general`'s `language` elements, as written, in document order: the
   * languages its object uses, which reading 134 compares with its document's `xml:lang` forms.
   */
  readonly languages: readonly string[];
  /**
   * The `general`'s path in the manifest, where a refusal of its languages points.
   */
  readonly location: string;
  readonly title: Option.Option<LomValues>;
}

/**
 * A manifest {@link readManifest} read: the profile its `schemaversion` names and its resources in
 * document order.
 */
export interface Manifest {
  readonly identifier: string;
  readonly resources: readonly ManifestResource[];
  readonly version: CpVersion;
}

/**
 * The defect of a manifest the walk accepted that lacks an attribute its profile requires, which
 * the walk refuses as `missing-attribute`, so a checked manifest cannot cause it.
 */
export class ManifestDefect extends Data.TaggedError("ManifestDefect")<{
  readonly attribute: string;
  readonly element: string;
}> {
  /**
   * The element and the attribute it lacks, why no manifest should reach this, and that it is the
   * renderer's to fix.
   */
  override get message(): string {
    return `The manifest element ${this.element} has no ${this.attribute} attribute, which its profile requires, yet the manifest walk accepted it. The walk refuses a missing attribute first, as missing-attribute, so this is a renderer defect; report it with the manifest.`;
  }
}

/**
 * The QTI tables the manifest walk passes `checkStructure`: none. Neither profile imports QTI's
 * own schema, so XML Schema finds no declaration for a QTI element in the manifest's lax wildcard
 * content and passes over it, and so does the walk.
 */
const noQtiTables: Tables = { elements: {}, types: {} };

/**
 * LOM's namespace, the IEEE LOM binding both profiles import for metadata.
 */
const lomNamespace = "http://ltsc.ieee.org/xsd/LOM";

/**
 * Where an `href` leads: a path inside the package, as its segments, an absolute URI with its query
 * and fragment set aside, or outside the package's root, with the reference's path as written,
 * which is all an external link is compared by (reading 102).
 */
type Target =
  | { readonly kind: "absolute"; readonly uri: string }
  | { readonly kind: "inside"; readonly segments: readonly string[] }
  | { readonly kind: "outside"; readonly written: string };

/**
 * The target of the package's root, the base every relative reference resolves against: its
 * directory is the root, so its last segment, the one a reference replaces, is empty.
 */
const packageRoot: Target = { kind: "inside", segments: [""] };

/**
 * Resolve a URI reference against a base target, as RFC 3986 section 5.2 merges a relative path
 * with its base and removes its dot segments.
 *
 * An absolute URI is its own target whatever its base, and a relative reference under an absolute
 * base is the absolute URI the URL parser resolves it to, or, when the parser refuses it, the base
 * and the reference joined, which no other reference shares. A relative reference under a path
 * inside the package resolves through {@link resolveInside}, and is outside when it names no path
 * inside, as is every relative reference under a base outside.
 *
 * @param base The target the reference is resolved against.
 * @param reference The reference, collapsed ({@link collapseXmlSpace}).
 * @returns Its target.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.2
 */
const resolve = (base: Target, reference: string): Target => {
  if (schemePrefix.test(reference)) {
    return { kind: "absolute", uri: withoutQuery(reference) };
  }

  if (base.kind === "absolute") {
    const parsed = URL.parse(withoutQuery(reference), base.uri);

    return { kind: "absolute", uri: parsed === null ? `${base.uri} ${reference}` : parsed.href };
  }

  const outside: Target = { kind: "outside", written: withoutQuery(reference) };
  if (base.kind === "outside") {
    return outside;
  }

  return Option.match(resolveInside(base.segments, reference), {
    onNone: () => outside,
    onSome: (segments): Target => ({ kind: "inside", segments }),
  });
};

/**
 * Name a target as a comparable key: two `href` values reference the same file exactly when their
 * keys are equal. A path inside the package is compared resolved, and a target outside it by its
 * path as written, since no URI outside the package is resolved (reading 102).
 *
 * @param target The target.
 * @returns Its key.
 */
const keyOf = (target: Target): string => {
  switch (target.kind) {
    case "absolute": {
      return `uri:${target.uri}`;
    }
    case "inside": {
      return `path:${target.segments.join("/")}`;
    }
    case "outside": {
      return `written:${target.written}`;
    }
    default: {
      return target satisfies never;
    }
  }
};

/**
 * Take an element's children in the manifest's namespace with one local name.
 *
 * @param element The element.
 * @param local The children's local name.
 * @returns The children, in document order.
 */
const childrenNamed = (element: SourceElement, local: string): readonly SourceElement[] =>
  element.children.filter(
    (child): child is SourceElement =>
      child.kind === "element" && child.namespace === manifestNamespace && child.local === local,
  );

/**
 * Take an element's children in LOM's namespace with one local name.
 *
 * @param element The element.
 * @param local The children's local name.
 * @returns The children, in document order.
 */
const lomChildren = (element: SourceElement, local: string): readonly SourceElement[] =>
  element.children.filter(
    (child): child is SourceElement =>
      child.kind === "element" && child.namespace === lomNamespace && child.local === local,
  );

/**
 * Find an element's attribute in no namespace.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @returns The attribute, if the element writes it.
 */
const attributeOf = (element: SourceElement, local: string): Option.Option<SourceAttribute> =>
  Option.fromUndefinedOr(
    element.attributes.find((attribute) => attribute.namespace === "" && attribute.local === local),
  );

/**
 * Read an attribute the profile requires of a manifest the walk accepted.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @returns Its value.
 * @throws {ManifestDefect} When the element lacks it, which the walk refuses first.
 */
const required = (element: SourceElement, local: string): string =>
  Option.getOrThrowWith(
    Option.map(attributeOf(element, local), (attribute) => attribute.value),
    () => new ManifestDefect({ attribute: local, element: element.local }),
  );

/**
 * Resolve an element's `xml:base`, collapsed, against its parent's base. A base outside the
 * package is refused nowhere: what it places outside is an external link, refused only as a
 * document resource's `href`.
 *
 * @param base The parent's base.
 * @param element The element.
 * @returns The element's base: its `xml:base` resolved, or the parent's when it writes none.
 */
const baseOf = (base: Target, element: SourceElement): Target =>
  Option.match(
    Option.fromUndefinedOr(
      element.attributes.find(
        (attribute) => attribute.namespace === xmlNamespace && attribute.local === "base",
      ),
    ),
    { onNone: () => base, onSome: (attribute) => resolve(base, collapseXmlSpace(attribute.value)) },
  );

/**
 * Construct a refusal of the manifest, located at an element or attribute path.
 *
 * @param source The manifest.
 * @param rule The rule it breaks.
 * @param path The element or attribute path.
 * @param detail The facts the verdict's wording reads.
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
 * Name an element as a refusal's detail does, as its path step spells it.
 *
 * @param element The element.
 * @returns `{<namespace>}<local>`.
 */
const elementName = (element: SourceElement): string => `{${element.namespace}}${element.local}`;

/**
 * Write a child count as a refusal's `required` phrase spells it: `one` for 1, the digits
 * otherwise.
 *
 * @param count The count.
 * @returns Its word.
 */
const countWord = (count: bigint): string => (count === 1n ? "one" : count.toString());

/**
 * Write the counts a child is admitted with as a refusal's `required` phrase.
 *
 * @param least The least count.
 * @param greatest The greatest count, none when it is unbounded.
 * @returns `no`, `exactly one`, `at least one`, `at most one` or `from 2 to 3`, as the counts give.
 */
const requiredText = (least: bigint, greatest: Option.Option<bigint>): string => {
  if (Option.isNone(greatest)) {
    return `at least ${countWord(least)}`;
  }

  const most = greatest.value;
  if (most === 0n) {
    return "no";
  }

  if (least === most) {
    return `exactly ${countWord(most)}`;
  }

  return least === 0n
    ? `at most ${countWord(most)}`
    : `from ${countWord(least)} to ${countWord(most)}`;
};

/**
 * Find the occurrences of the table that governs an element of the manifest's namespace: its
 * name's, or, when a valid `xsi:type` names one of the namespace's types, that type's.
 *
 * @param tables The manifest namespace's tables.
 * @param occurrences The manifest namespace's occurrences.
 * @param element The element.
 * @param table The table that governs it, as `governingTables` gives it, never a copy.
 * @returns The counts of each child the table names; none for a table of another namespace.
 */
const occurrencesOf = (
  tables: Tables,
  occurrences: Occurrences,
  element: SourceElement,
  table: ContentTable,
): readonly ChildOccurrence[] => {
  if (Object.hasOwn(tables.elements, element.local) && tables.elements[element.local] === table) {
    return occurrences.elements[element.local] ?? [];
  }

  const type = Object.entries(tables.types).find(([, entry]) => entry === table);

  return type === undefined ? [] : (occurrences.types[type[0]] ?? []);
};

/**
 * A table of LOM repetition caps: for each Schematron context, the local names from a `lom` down,
 * the greatest number of times its element holds each LOM child the context names.
 */
type LomCaps = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * The repetition caps of the loose LOM binding both profiles import, `imsmd_loose_v1p3p2.xsd`
 * (reading 130, "a LOM element repeats no more than the loose binding's Schematron allows").
 *
 * The binding's XSD writes each LOM type as an unbounded choice of its elements, so the walk admits
 * any number of each; its embedded Schematron caps those the XSD bounds to one inside that choice.
 * Each key is a Schematron rule's context, the local names from a `lom` down to the capped element,
 * and each value the greatest number of times that element holds each LOM child the rule names.
 * The binding's 43 rules make 94 asserts, every cap one, over these 41 contexts; its rules for
 * `lom/technical/requirement` and `lom/relation/resource` assert nothing. An element no context
 * caps, such as `keyword`, `language`, `educational` or `identifier`, repeats freely. The table is
 * numbers, not a copy of the binding; `manifest.test.ts` derives it from the cached binding.
 */
export const lomCaps = {
  lom: { general: 1, lifeCycle: 1, metaMetadata: 1, rights: 1, technical: 1 },
  "lom/annotation": { date: 1, description: 1, entity: 1 },
  "lom/annotation/date": { dateTime: 1, description: 1 },
  "lom/classification": { description: 1, purpose: 1 },
  "lom/classification/purpose": { source: 1, value: 1 },
  "lom/classification/taxonPath": { source: 1 },
  "lom/classification/taxonPath/taxon": { entry: 1, id: 1 },
  "lom/educational": {
    description: 1,
    difficulty: 1,
    interactivityLevel: 1,
    interactivityType: 1,
    semanticDensity: 1,
    typicalLearningTime: 1,
  },
  "lom/educational/context": { source: 1, value: 1 },
  "lom/educational/difficulty": { source: 1, value: 1 },
  "lom/educational/intendedEndUserRole": { source: 1, value: 1 },
  "lom/educational/interactivityLevel": { source: 1, value: 1 },
  "lom/educational/interactivityType": { source: 1, value: 1 },
  "lom/educational/learningResourceType": { source: 1, value: 1 },
  "lom/educational/semanticDensity": { source: 1, value: 1 },
  "lom/educational/typicalLearningTime": { description: 1, duration: 1 },
  "lom/general": { aggregationLevel: 1, structure: 1, title: 1 },
  "lom/general/aggregationLevel": { source: 1, value: 1 },
  "lom/general/identifier": { catalog: 1, entry: 1 },
  "lom/general/structure": { source: 1, value: 1 },
  "lom/lifeCycle": { status: 1, version: 1 },
  "lom/lifeCycle/contribute": { date: 1, role: 1 },
  "lom/lifeCycle/contribute/date": { dateTime: 1, description: 1 },
  "lom/lifeCycle/contribute/role": { source: 1, value: 1 },
  "lom/lifeCycle/status": { source: 1, value: 1 },
  "lom/metaMetadata": { language: 1 },
  "lom/metaMetadata/contribute": { date: 1, role: 1 },
  "lom/metaMetadata/contribute/date": { dateTime: 1, description: 1 },
  "lom/metaMetadata/contribute/role": { source: 1, value: 1 },
  "lom/metaMetadata/identifier": { catalog: 1, entry: 1 },
  "lom/relation": { kind: 1, resource: 1 },
  "lom/relation/kind": { source: 1, value: 1 },
  "lom/relation/resource/identifier": { catalog: 1, entry: 1 },
  "lom/rights": { copyrightAndOtherRestrictions: 1, cost: 1, description: 1 },
  "lom/rights/copyrightAndOtherRestrictions": { source: 1, value: 1 },
  "lom/rights/cost": { source: 1, value: 1 },
  "lom/technical": {
    duration: 1,
    installationRemarks: 1,
    otherPlatformRequirements: 1,
    size: 1,
  },
  "lom/technical/duration": { description: 1, duration: 1 },
  "lom/technical/requirement/orComposite": {
    maximumVersion: 1,
    minimumVersion: 1,
    name: 1,
    type: 1,
  },
  "lom/technical/requirement/orComposite/name": { source: 1, value: 1 },
  "lom/technical/requirement/orComposite/type": { source: 1, value: 1 },
} satisfies LomCaps;

/**
 * The caps of {@link lomCaps} by context, for a context read from a document.
 */
const capsByContext: ReadonlyMap<string, Readonly<Record<string, number>>> = new Map(
  Object.entries(lomCaps),
);

/**
 * The context of {@link lomCaps} where a LOM learning resource type stands, the one element
 * reading 122 reads.
 */
const learningResourceTypeContext = "lom/educational/learningResourceType";

/**
 * Name the Schematron context a LOM element stands at, as a key of {@link lomCaps} spells it: the
 * local names of the element and its parents up to the nearest `lom`, joined by `/`.
 *
 * A context names a chain of parents and children in LOM's namespace, so an element with an
 * element of another namespace, or none, between it and every `lom` stands at none.
 *
 * @param element The element.
 * @param parents Each element's parent, as the walk gives it.
 * @returns Its context, none when no `lom` is above it through LOM's namespace.
 */
const lomContext = (
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, Option.Option<SourceElement>>,
): Option.Option<string> => {
  const steps: string[] = [];
  for (
    let at: Option.Option<SourceElement> = Option.some(element);
    Option.isSome(at) && at.value.namespace === lomNamespace;
    at = parents.get(at.value) ?? Option.none()
  ) {
    steps.push(at.value.local);
    if (at.value.local === "lom") {
      return Option.some(steps.toReversed().join("/"));
    }
  }

  return Option.none();
};

/**
 * Count an element's children of one namespace and local name.
 *
 * @param element The element.
 * @param namespace The children's namespace.
 * @param local The children's local name.
 * @returns How many it holds.
 */
const heldCount = (element: SourceElement, namespace: string, local: string): bigint =>
  BigInt(
    element.children.filter(
      (held) => held.kind === "element" && held.namespace === namespace && held.local === local,
    ).length,
  );

/**
 * Check the child counts of every element the walk checks: one of the manifest's namespace against
 * its profile's occurrences, and one of LOM's against the loose LOM binding's caps
 * ({@link lomCaps}). An element of the manifest's namespace holds each child the governing table
 * names at least its `minOccurs` and at most its `maxOccurs` times, and a LOM element each child
 * its context caps at most that many times, or the element is refused `child-count` as the walk
 * refuses one, its detail naming the child, the counts, the profile and the `source` that settles
 * them: the profile for the manifest's counts, reading 130 for LOM's.
 *
 * The walk checks no XSD counts, and LOM's binding states its caps in Schematron, not its XSD, so
 * this is where a manifest without `organizations` or `resources`, a resource without a `file`, or
 * a LOM `general` with two titles, is refused. An element the walk passes over, such as a manifest
 * nested in LOM's lax content (reading 6), is not counted.
 *
 * @param source The manifest.
 * @param version The profile its `schemaversion` names.
 * @param paths Each element's path, as the walk spells it.
 * @param parents Each element's parent, as the walk gives it.
 * @param governing The table that governs each element the walk checks, as `governingTables`
 *   gives it, in document order.
 * @returns The refusals, in document order of the elements.
 */
const checkCounts = (
  source: SourceDocument,
  version: CpVersion,
  paths: ReadonlyMap<SourceElement, string>,
  parents: ReadonlyMap<SourceElement, Option.Option<SourceElement>>,
  governing: ReadonlyMap<SourceElement, ContentTable>,
): readonly Refusal[] => {
  const tables = packageTables.get(version)?.get(manifestNamespace) ?? noQtiTables;
  const occurrences = packageOccurrences.get(version)?.get(manifestNamespace) ?? {
    elements: {},
    types: {},
  };
  /**
   * Refuse an element's count of one child.
   *
   * @param element The element.
   * @param child The child's name, `{<namespace>}<local>`.
   * @param least The least count.
   * @param greatest The greatest count, none when it is unbounded.
   * @param settledBy What settles the counts, the detail's `source`.
   * @returns The `child-count` refusal at the element.
   */
  const refuseCount = (
    element: SourceElement,
    child: string,
    least: bigint,
    greatest: Option.Option<bigint>,
    settledBy: string,
  ): Refusal =>
    refuse(source, "child-count", paths.get(element) ?? "", {
      child,
      element: elementName(element),
      required: requiredText(least, greatest),
      schemaversion: version,
      source: settledBy,
    });
  /**
   * Check a LOM element against the caps of the context it stands at.
   *
   * @param element The element.
   * @returns Its refusals, one per child it holds past its cap, in the table's order.
   */
  const lomCounts = (element: SourceElement): readonly Refusal[] =>
    Option.match(
      Option.flatMap(lomContext(element, parents), (context) =>
        Option.fromUndefinedOr(capsByContext.get(context)),
      ),
      {
        onNone: () => [],
        onSome: (caps) =>
          Object.entries(caps).flatMap(([child, cap]) =>
            heldCount(element, lomNamespace, child) > BigInt(cap)
              ? [
                  refuseCount(
                    element,
                    `{${lomNamespace}}${child}`,
                    0n,
                    Option.some(BigInt(cap)),
                    "reading 130",
                  ),
                ]
              : [],
          ),
      },
    );

  return [...governing].flatMap(([element, table]) => {
    if (element.namespace === lomNamespace) {
      return lomCounts(element);
    }

    if (element.namespace !== manifestNamespace) {
      return [];
    }

    return occurrencesOf(tables, occurrences, element, table).flatMap((child) => {
      const count = heldCount(element, child.namespace, child.local);
      const least = BigInt(child.minOccurs);
      const greatest =
        child.maxOccurs === "unbounded" ? Option.none() : Option.some(BigInt(child.maxOccurs));
      const within =
        count >= least &&
        Option.match(greatest, { onNone: () => true, onSome: (most) => count <= most });

      return within
        ? []
        : [
            refuseCount(
              element,
              `{${child.namespace}}${child.local}`,
              least,
              greatest,
              `QTI 3.0 content packaging profile ${version}`,
            ),
          ];
    });
  });
};

/**
 * One `href` attribute with its target and the path of the attribute.
 */
interface Located {
  readonly at: string;
  readonly href: string;
  readonly target: Target;
}

/**
 * One resource as the manifest's rules read it, before the model is built.
 */
interface ResourceEntry {
  readonly dependencies: readonly { readonly at: string; readonly identifier: string }[];
  readonly element: SourceElement;
  readonly files: readonly Located[];
  readonly href: Option.Option<Located>;
  readonly path: string;
}

/**
 * Read the manifest's resources, the `resource` children of its `resources`, each `href` resolved
 * through the `xml:base` values of the manifest, the `resources` and the resource.
 *
 * @param root The manifest's root.
 * @param paths Each element's path, as the walk spells it.
 * @returns The resources, in document order.
 */
const resourcesOf = (
  root: SourceElement,
  paths: ReadonlyMap<SourceElement, string>,
): readonly ResourceEntry[] => {
  /**
   * Give an element's path, as the walk spells it.
   *
   * @param element An element of the manifest.
   * @returns Its path.
   */
  const pathOf = (element: SourceElement): string => paths.get(element) ?? "";
  /**
   * Read an element's `href`, collapsed and resolved against a base.
   *
   * @param base The base its `xml:base` values give the element.
   * @param element A `resource` or a `file`.
   * @returns The `href` with its target and its attribute's path, or none when it has no `href`.
   */
  const located = (base: Target, element: SourceElement): Option.Option<Located> =>
    Option.map(attributeOf(element, "href"), (attribute) => ({
      at: attributePath(pathOf(element), attribute),
      href: attribute.value,
      target: resolve(base, collapseXmlSpace(attribute.value)),
    }));
  const rootBase = baseOf(packageRoot, root);

  return childrenNamed(root, "resources").flatMap((resources) => {
    const listBase = baseOf(rootBase, resources);

    return childrenNamed(resources, "resource").map((element): ResourceEntry => {
      const base = baseOf(listBase, element);

      return {
        dependencies: childrenNamed(element, "dependency").flatMap((dependency) =>
          Option.toArray(
            Option.map(attributeOf(dependency, "identifierref"), (attribute) => ({
              at: attributePath(pathOf(dependency), attribute),
              identifier: attribute.value,
            })),
          ),
        ),
        element,
        files: childrenNamed(element, "file").flatMap((file) =>
          Option.toArray(located(base, file)),
        ),
        href: located(base, element),
        path: pathOf(element),
      };
    });
  });
};

/**
 * The document types, whose resource's `href` names the one document the package holds at that
 * path: the eight QTI types (`imsqti_*`) and the LOM and usage-data records, the ten types reading
 * 102's "Document entry" holds to an entry, as pantry's `documentTypes` (`src/grammar/install.ts`)
 * lists them.
 */
const documentTypes: ReadonlySet<string> = new Set([
  ...Object.values(resourceTypes).flatMap((types) =>
    types.filter((type) => type.startsWith("imsqti_")),
  ),
  "qtiusagedata/xml",
  "resourcemetadata/xml",
]);

/**
 * Check the manifest's own rules over its resources: a document resource's `href` names a path
 * inside the package (`package-path-outside`, `check: "document-entry"`, reading 102), a resource's
 * `href` references one of its `file` entries (`child-count`, Content Packaging 1.2 section 6.6.2),
 * and each `dependency` names a resource (`dependency-unresolved`).
 *
 * A `dependency`'s `identifierref` is an `xs:IDREF` and a resource's `identifier` an `xs:ID`, both
 * of whose whitespace facet is `collapse`, so the two are compared collapsed: `identifierref=" a "`
 * names the resource `a`. One that is no NCName names nothing (reading 152 as amended, "Any other
 * value names nothing: no row holds it as a name"), so it is not `dependency-unresolved`: its value
 * domain, the walk's `attribute-type`, refuses it alone. The refusal's facts keep the values as
 * written.
 *
 * An `href` leads outside when it is an absolute URI, starts with `/`, or climbs above the root
 * through the `xml:base` values above it and its own `..` segments. A `file`'s and a non-document
 * resource's `href` that does is an external link, admitted (reading 102); a document resource's is
 * refused, since its document is an entry of the package. A resource's `href` outside the package
 * references a `file` entry whose `href` is outside with the same path as written.
 *
 * @param source The manifest.
 * @param entries Its resources.
 * @returns The refusals, in document order of the resources.
 */
const checkResources = (
  source: SourceDocument,
  entries: readonly ResourceEntry[],
): readonly Refusal[] => {
  const identifiers = new Set(
    entries.flatMap((entry) =>
      Option.toArray(
        Option.map(attributeOf(entry.element, "identifier"), (id) => collapseXmlSpace(id.value)),
      ),
    ),
  );

  return entries.flatMap((entry) => {
    const owner = Option.map(attributeOf(entry.element, "identifier"), (id) => id.value);
    const isDocument = Option.exists(attributeOf(entry.element, "type"), (type) =>
      documentTypes.has(type.value),
    );
    const outsideDocument = entry.href.pipe(
      Option.filter((href) => isDocument && href.target.kind !== "inside"),
      Option.map((href) =>
        refuse(source, "package-path-outside", href.at, {
          check: "document-entry",
          path: href.href,
          reading: "102",
        }),
      ),
    );
    const fileKeys = new Set(entry.files.map((file) => keyOf(file.target)));
    const unmatched = entry.href.pipe(
      Option.filter((href) => !fileKeys.has(keyOf(href.target))),
      Option.map((href) =>
        refuse(source, "child-count", entry.path, {
          child: `file entry that references its href ${href.href}`,
          element: elementName(entry.element),
          required: "at least one",
          source: "Content Packaging 1.2, section 6.6.2",
        }),
      ),
    );
    const unresolved = entry.dependencies
      .filter((dependency) => {
        const named = collapseXmlSpace(dependency.identifier);

        return isNcName(named) && !identifiers.has(named);
      })
      .map((dependency) =>
        refuse(source, "dependency-unresolved", dependency.at, {
          dependency: dependency.identifier,
          ...Option.match(owner, { onNone: () => ({}), onSome: (resource) => ({ resource }) }),
        }),
      );

    return [...Option.toArray(outsideDocument), ...Option.toArray(unmatched), ...unresolved];
  });
};

/**
 * Turn a reference the rules accepted into the model's form.
 *
 * @param reference The reference.
 * @returns Its value as written and the package path it names.
 */
const hrefOf = (reference: Located): ManifestHref => ({
  href: reference.href,
  path:
    reference.target.kind === "inside"
      ? Option.some(reference.target.segments.join("/"))
      : Option.none(),
});

/**
 * Write one child of a text-only element as the document spells it: its characters, or an
 * unexpanded entity reference in its form `&name;`.
 *
 * @param child The child.
 * @returns Its text, `""` for an element child.
 */
const writtenText = (child: SourceChild): string => {
  if (child.kind === "text") {
    return child.text;
  }

  return child.kind === "entity" ? `&${child.name};` : "";
};

/**
 * Pick the profile a manifest names: the text of its first `metadata`'s first `schemaversion`,
 * when that is exactly one of {@link cpVersions}, since the profiles type it as an `xs:string`
 * enumeration, whose whitespace is kept.
 *
 * @param source The manifest.
 * @param root Its root.
 * @param paths Each element's path, as the walk spells it.
 * @returns The profile, or the `package-profile` refusal: at the `schemaversion` with the value it
 *   holds, or, when there is none, at the `metadata` or the root that lacks it.
 */
const profileOf = (
  source: SourceDocument,
  root: SourceElement,
  paths: ReadonlyMap<SourceElement, string>,
): Result.Result<CpVersion, Refusal> => {
  const metadata = Option.fromUndefinedOr(childrenNamed(root, "metadata")[0]);
  const schemaversion = metadata.pipe(
    Option.flatMap((holder) => Option.fromUndefinedOr(childrenNamed(holder, "schemaversion")[0])),
  );

  return Option.match(schemaversion, {
    onNone: () =>
      Result.fail(
        refuse(
          source,
          "package-profile",
          paths.get(Option.getOrElse(metadata, () => root)) ?? "",
          {},
        ),
      ),
    onSome: (element) => {
      const written = element.children.map((child) => writtenText(child)).join("");
      const version = cpVersions.find((candidate) => candidate === written);

      return version === undefined
        ? Result.fail(
            refuse(source, "package-profile", paths.get(element) ?? "", {
              schemaversion: written,
            }),
          )
        : Result.succeed(version);
    },
  });
};

/**
 * The source that names the LOM vocabulary, which the loose binding gives a learning resource
 * type's `source` as its default.
 */
const lomVocabulary = "LOMv1.0";

/**
 * The LOM vocabulary's learning resource types QTI forbids, since "QTI objects are designed to be
 * reusable in a variety of assessment scenarios" (QTI 3.0 Metadata binding, section 2.7.5.1;
 * reading 122). Each is compared with a value collapsed and with its case kept.
 */
const forbiddenResourceTypes: ReadonlySet<string> = new Set(["exam", "self assessment"]);

/**
 * Read a text-only element's text as XML Schema's `collapse` whitespace facet reads it: its outer
 * XML whitespace removed and each inner run of it one space.
 *
 * @param element The element.
 * @returns Its text, collapsed.
 */
const collapsedText = (element: SourceElement): string =>
  collapseXmlSpace(element.children.map((child) => writtenText(child)).join(""));

/**
 * Check every LOM learning resource type the walk checks against reading 122: one whose `source`
 * names the LOM vocabulary and whose `value` is `exam` or `self assessment` is refused
 * `lom-learning-resource-type` at the type, its detail the collapsed `value` and the `reading`.
 *
 * The type's term is the LOM vocabulary's when its `source` collapses to `LOMv1.0` or to nothing,
 * which the binding's default fills, or when it writes no `source`; a term of any other source is
 * another vocabulary's, which the loose binding does not enforce, and is not read. Every LOM record
 * of the manifest is read, the manifest's own, a resource's and a file's. A type holding two
 * `source`s or two `value`s is refused `child-count` by {@link checkCounts} and not read here, and a
 * type with no `value` names no term.
 *
 * @param source The manifest.
 * @param paths Each element's path, as the walk spells it.
 * @param parents Each element's parent, as the walk gives it.
 * @param governing Each element the walk checks, in document order.
 * @returns The refusals, in document order of the types.
 */
const checkLearningResourceTypes = (
  source: SourceDocument,
  paths: ReadonlyMap<SourceElement, string>,
  parents: ReadonlyMap<SourceElement, Option.Option<SourceElement>>,
  governing: ReadonlyMap<SourceElement, ContentTable>,
): readonly Refusal[] =>
  [...governing.keys()]
    .filter((element) =>
      Option.exists(
        lomContext(element, parents),
        (context) => context === learningResourceTypeContext,
      ),
    )
    .flatMap((type) => {
      const sources = lomChildren(type, "source");
      const [value, ...others] = lomChildren(type, "value");
      if (value === undefined || others.length > 0 || sources.length > 1) {
        return [];
      }

      const vocabulary = sources[0] === undefined ? lomVocabulary : collapsedText(sources[0]);
      const term = collapsedText(value);

      return (vocabulary === lomVocabulary || vocabulary === "") && forbiddenResourceTypes.has(term)
        ? [
            refuse(source, "lom-learning-resource-type", paths.get(type) ?? "", {
              reading: "122",
              value: term,
            }),
          ]
        : [];
    });

/**
 * Read a package's manifest and check it by every rule that needs only the manifest.
 *
 * A root outside {@link manifestNamespace} is refused `not-qti3-package` alone, and a
 * `schemaversion` other than `3.0.0` or `3.0.1`, or none, `package-profile` alone. Otherwise the
 * manifest is walked against its profile's tables with `checkStructure`, each refusal of the walk
 * carrying the profile it was judged against as `schemaversion` in its detail; its elements' child
 * counts are checked against the profile's occurrences and its LOM elements' against the loose LOM
 * binding's caps (`child-count`, also carrying `schemaversion`); and it is checked by the
 * manifest's own rules: `package-path-outside` for a document resource's `href` that leads outside
 * the package, `child-count` for a resource whose `href` no `file` entry references,
 * `dependency-unresolved`, and `lom-learning-resource-type`. All are reported,
 * in that order. Nothing is read or fetched beyond the document given.
 *
 * @param source The manifest, as the reader adapter built it, whose location every refusal carries.
 * @returns The manifest, or every refusal of it in the order above.
 * @throws {ManifestDefect} When the walk accepts a resource that lacks a required attribute, a
 *   defect of the walk.
 */
export const readManifest = (
  source: SourceDocument,
): Result.Result<Manifest, Arr.NonEmptyReadonlyArray<Refusal>> => {
  const { root } = source;
  const visits = [...walk(source)];
  const paths = new Map(visits.map((visit) => [visit.element, visit.path]));
  if (root.namespace !== manifestNamespace) {
    return Result.fail([
      refuse(source, "not-qti3-package", paths.get(root) ?? "", {
        element: root.local,
        namespace: root.namespace,
      }),
    ]);
  }

  const profile = profileOf(source, root, paths);
  if (Result.isFailure(profile)) {
    return Result.fail([profile.failure]);
  }

  const version = profile.success;
  const parents = new Map(visits.map((visit) => [visit.element, visit.parent]));
  const governing = governingTables(source, noQtiTables, packageTables.get(version));
  const walked = checkStructure(source, noQtiTables, packageTables.get(version)).map(
    (refusal) =>
      new Refusal({
        detail: { ...refusal.detail, schemaversion: version },
        document: refusal.document,
        location: refusal.location,
        readerRule: refusal.readerRule,
        rule: refusal.rule,
        suggestion: refusal.suggestion,
      }),
  );
  const entries = resourcesOf(root, paths);
  const [first, ...rest] = [
    ...walked,
    ...checkCounts(source, version, paths, parents, governing),
    ...checkResources(source, entries),
    ...checkLearningResourceTypes(source, paths, parents, governing),
  ];
  if (first !== undefined) {
    return Result.fail([first, ...rest]);
  }

  return Result.succeed({
    identifier: required(root, "identifier"),
    resources: entries.map((entry): ManifestResource => ({
      dependencies: entry.dependencies.map((dependency) => dependency.identifier),
      files: entry.files.map((file) => hrefOf(file)),
      href: entry.href.pipe(Option.map((href) => hrefOf(href))),
      identifier: required(entry.element, "identifier"),
      location: entry.path,
      type: required(entry.element, "type"),
    })),
    version,
  });
};

/**
 * Gather the values a LOM `general` gives through its children of one name: the text of each of
 * their children of another name, as written, each with the `language` it writes.
 *
 * Only a title's `string`, a LOM `LanguageString`, carries a `language`, an `xs:string` kept as
 * written (`imsmd_loose_v1p3p2.xsd`); an identifier's `entry` is a `CharacterString` and states
 * none.
 *
 * @param general The `general`.
 * @param holder The local name of the children that hold the values, `identifier` or `title`.
 * @param value The local name of each value's element, `entry` or `string`.
 * @param paths Each element's path, as the walk spells it.
 * @returns The values and their languages with the path of the first holder that holds one, none
 *   when none does.
 */
const lomValues = (
  general: SourceElement,
  holder: "identifier" | "title",
  value: "entry" | "string",
  paths: ReadonlyMap<SourceElement, string>,
): Option.Option<LomValues> => {
  const [first, ...rest] = lomChildren(general, holder).flatMap((element) =>
    lomChildren(element, value).map((child) => ({
      holder: element,
      language:
        value === "string"
          ? Option.map(attributeOf(child, "language"), (attribute) => attribute.value)
          : Option.none<string>(),
      text: child.children.map((part) => writtenText(part)).join(""),
    })),
  );

  return first === undefined
    ? Option.none()
    : Option.some({
        languages: [first.language, ...rest.map(({ language }) => language)],
        location: paths.get(first.holder) ?? "",
        values: [first.text, ...rest.map(({ text }) => text)],
      });
};

/**
 * Read the LOM `general` of each resource's own metadata, which reading 62 ("an item's or test's
 * identifier and title are those its package's LOM metadata gives it") and reading 134 ("an item's
 * or a test's languages are listed by its records' general categories") compare with the
 * resource's document.
 *
 * Every resource of the manifest's `resources` is keyed by its location, the path its
 * {@link ManifestResource} holds as `location`, with each `general` of each `lom` its `metadata`
 * holds, in document order, none when it holds no LOM. The manifest's own metadata and a file's are
 * not read: the metadata binding ties only a resource's to the object its document is. Values,
 * their languages and the `general`'s own languages stay as written; comparing them is the package
 * reader's.
 *
 * @param source A manifest {@link readManifest} read.
 * @returns Each resource's LOM generals, keyed by its location.
 */
export const resourceLom = (source: SourceDocument): ReadonlyMap<string, readonly LomGeneral[]> => {
  const paths = new Map(Array.from(walk(source), (visit) => [visit.element, visit.path]));

  return new Map(
    childrenNamed(source.root, "resources").flatMap((resources) =>
      childrenNamed(resources, "resource").map(
        (resource) =>
          [
            paths.get(resource) ?? "",
            childrenNamed(resource, "metadata").flatMap((metadata) =>
              lomChildren(metadata, "lom").flatMap((lom) =>
                lomChildren(lom, "general").map((general): LomGeneral => ({
                  identifier: lomValues(general, "identifier", "entry", paths),
                  languages: lomChildren(general, "language").map((language) =>
                    language.children.map((part) => writtenText(part)).join(""),
                  ),
                  location: paths.get(general) ?? "",
                  title: lomValues(general, "title", "string", paths),
                })),
              ),
            ),
          ] as const,
      ),
    ),
  );
};
