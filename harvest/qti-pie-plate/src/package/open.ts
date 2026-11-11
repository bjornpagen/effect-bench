/**
 * `openPackage`, the host's one entry from a QTI 3.0 content package's files to its verdict, and
 * the {@link AcceptedPackage} an accepting verdict holds.
 *
 * A package is judged whole (OD-4, per package). Its files are keyed by their normal form and its
 * manifest is read at `imsmanifest.xml`; a refusal of either ends the reading there. The file rules
 * run against the manifest, then each document a resource of one of the ten document types names
 * is read once, at its `href`, as one document of one type (readings 93 and 146):
 *
 * - A path the resources name under two document types is read as the first of them, in the
 *   manifest's order, that its root bears out, and as the first of all where none does; each
 *   resource of another type is `resource-type-mismatch` with `check: "path-type"` (reading 162). A
 *   document resource whose `href` names `imsmanifest.xml` is `resource-type-mismatch` with `check:
 *   "manifest-document"`: the manifest is no resource's document, and it is never read again
 *   (reading 146);
 * - A document read as one of the four QTI types plate judges, item, test, section and stimulus, is
 *   judged as `open` judges one, read by the shared reader and checked against the committed
 *   tables, and keeps that verdict beneath the package's resources of that type;
 * - A resource of a QTI type with a fixed root (`resourceRoots`) whose document has another root is
 *   `resource-type-mismatch` at the resource (T-h, refuse), which also reads, without judging, the
 *   documents of the three types M3 checks: outcome declarations, response processing and its
 *   templates;
 * - A fragment, LOM metadata or usage-data document is read for its root alone: one in a namespace of
 *   QTI 2 is `not-qti-root` at the document (reading 89), and nothing else of it is judged;
 * - Each test places, through its section refs and then each placed section document's, every section
 *   document a section resource names, once for each section ref that names it (reading 86), as if
 *   it were inline; a section ref that returns to a document already on its chain is
 *   `inclusion-cycle` (reading 85) and places nothing. A section ref of the test or of a placed
 *   document whose `href` names no path inside the package, through the `xml:base` in scope, places
 *   nothing and is `package-path-outside` with `check: "remote-section"`, given once however many
 *   placements reach it (reading 170, "A section ref whose href is external is refused under the
 *   stated limit 'Remote section ref'"): a stated limit, not a rule of QTI, since plate assembles a
 *   test from its package's documents and never fetches a section; a fetch of the section at import
 *   would lift it. Every test is assembled before any is judged, and across them the placements of
 *   section documents are held to plate's assembly limit, 2,048 placements and 4 MiB placed: past
 *   either, the package is refused `assembly-limit` and no test is judged, a stated limit and not a
 *   rule of QTI. That reach is the test's own parts, sections and item refs and each placed
 *   document's. Through that reach:
 *
 *   - Each part's, section's and item ref's identifier is given once: one a section document gives
 *     again after the test or a document reached before it gave it is `duplicate-identifier` at that
 *     document (`info.txt:10759`, pantry's `structure-identifier`), given once however many tests
 *     reach it, and is left out of the reach, so the first wins; a section document placed twice
 *     gives its identifiers once;
 *   - Each item ref resolves through the `xml:base` in scope, or else against its own document's path,
 *     to an item resource the manifest lists, or to an LTI link resource (`ltiLinkTypes`), which an
 *     item ref may name in place of an item (reading 110); an item ref of the test or of a placed
 *     document that does neither is `item-ref-unresolved`, one that writes no identifier included
 *     (reading 155), given once however many placements reach it. The package declares nothing a link
 *     reports, so a reading through it names a built-in every item has as that built-in and any other
 *     name unchecked (reading 106, "an item ref that names an LTI link has no item whose declarations
 *     a prefix reads, so a prefixed reference through it is accepted unchecked, a recorded limit"),
 *     and its variable mappings' sources are judged by no rule, their targets only against one
 *     another and the session variables (reading 97), while each of its template defaults is
 *     `undeclared-variable` (reading 110, "under an item ref that names an LTI link a variable
 *     mapping is accepted unchecked, a recorded limit, and a template default is refused"): a link is
 *     no QTI item and has no template variables to override. A source that listed the outcomes a link
 *     reports would lift the limit;
 *   - Each dotted reference in the test, a name an expression reads, is judged by reading 48 ("a dotted
 *     reference is accepted when exactly one reading names a real item ref, test part or section and
 *     its variable") against the test's own variables, the items the item refs resolve to, their
 *     variable mappings and built-ins, `QTI_CONTEXT` among them (reading 106), and the reach's parts
 *     and sections: the unsplit reading, the test's own variable of the whole name, counts among the
 *     readings, and a numbered one only through an item ref a selection with replacement can repeat
 *     (reading 88). A reading through an element of a section document placed twice reads one
 *     placement each time: the one that holds the reference, from inside it, and each, from outside
 *     it (reading 86). One no reading counts for is `undeclared-variable`, and one two readings count
 *     for is `ambiguous-reference`. A name an outcome rule sets is the test's own variable (reading
 *     112), so one the test does not declare is `undeclared-variable`. An item's `duration` resolves
 *     whether or not the item is time dependent (reading 150). A variable read through a prefix is
 *     judged by its kind, a built-in by the kind it stands as (reading 111): a reference attribute
 *     reads only a template or outcome variable (`expression-type`), a `qti-correct` only a response
 *     (`undeclared-variable`), and a mapping expression only a response its item declares
 *     (`undeclared-variable`) with the mapping it needs (`template-requirements`);
 *   - The variable mappings of each item ref that names an item, the test's own and a reached section
 *     document's, name an outcome its item declares as their source (`undeclared-variable`) and each
 *     its own target, no other variable its item holds (`duplicate-identifier`, reading 97), and its
 *     template defaults a template variable its item declares (`undeclared-variable`), each refusal
 *     at its own document and given once however many tests reach it;
 *   - The test's expressions are typed through its reach, so the item's processing rules judge what
 *     they read there and what each template default sets (`expression-type`);
 *   - Each placement of a section document a test places is judged under that test as the test is, its
 *     dotted references against the test's reach and its expressions in the test's processing scope
 *     (`undeclared-variable`, `expression-type`; readings 5 and 145), each refusal at the section
 *     document and given once however many placements and tests give it;
 *   - Each branch rule of the test and of each placement names a reserved exit or a later element of
 *     its own kind in its own test part, never inside a section document a ref places from outside
 *     it, and never an item ref a selection with replacement can repeat (`branch-target`, reading
 *     87);
 *   - Each read in the test document's outcome processing or in one of its item refs' template defaults
 *     of an item's context variable through its item ref, one the item declares in a
 *     `qti-context-declaration` or the built-in `QTI_CONTEXT`, is found: the engine holds no value of
 *     it, and the delivered test marks the processing that reads it (see below);
 * - An item or test resource whose own LOM metadata gives identifier entries or title strings gives
 *   one equal to its document's `identifier` and, in the document's language, its `title`
 *   (`lom-identifier` and `lom-title`, reading 62, "an item's or test's identifier and title are
 *   those its package's LOM metadata gives it"), a document that writes neither having none to
 *   match (reading 148), and each general category of that metadata lists every language the
 *   document's `xml:lang` forms state (`document-lang`, reading 134, "an item's or a test's
 *   languages are listed by its records' general categories, compared as language tags"), every
 *   such resource that names the path, whatever type its document is read as (reading 162);
 * - Each file reference of each document read as a type plate judges, an attribute reading 103's
 *   census names, that resolves through the `xml:base` in scope to a path inside the package names
 *   a file the package holds or the manifest lists, or it is `package-file-missing` with `check:
 *   "reference"` at the attribute (reading 103, "an xml:base is a base, resolved and never a file
 *   reference"). An item ref's `href` is one of them, so one that names no such file is refused
 *   both ways, `item-ref-unresolved` and `package-file-missing`. The text of a card's or card
 *   entry's `qti-file-href` and of a `qti-resource-icon` is one too, refused at the element (R9-b,
 *   "Card files and resource icons are file references").
 *
 * A resource with no `href` names no document (reading 93), so nothing of it is read. A document
 * resource whose `href` leads outside the package is refused by the manifest's own rules
 * (`package-path-outside`, `check: "document-entry"`, reading 102), and a resource of another type
 * whose `href` does names an external link the package does not hold. The package's verdict follows
 * from its parts: `refused` when anything is refused, `unchecked` when nothing is and some document
 * is, then `accepted-with-unsupported` when some document is or some test is delivered with an item
 * ref or processing the package marks (see below), and `accepted` otherwise. Only an accepting
 * package's documents are delivered. A test is delivered with the model its document's own verdict
 * holds, except that each of its item refs that names an LTI link is marked `lti-link` at it and
 * left out, since plate launches no LTI link, its outcome processing then `marked` with each
 * outcome-only expression in it marked by its name, since such an expression would count the
 * delivered items alone, and one whose processing reads, through an item ref,
 * an item's context variable or any variable of an LTI link is delivered with that processing
 * marked, `variable:<name>` at it: its outcome processing `marked`, and each template default that
 * reads one left out, so its template variable starts at its declared default. The test document's
 * own verdict cannot carry those marks, since the document is judged without its items, and it
 * keeps its own; the package's verdict carries them, so a read of the built-in `QTI_CONTEXT`, which
 * marks no item, still makes the package `accepted-with-unsupported`. Like `open`, it runs over the
 * shared reader and the Schema-decoded tables, so it stays server-side.
 *
 * @module
 * @see https://www.imsglobal.org/content/packaging/cpv1p2pd2/imscp_infov1p2pd2.html
 */
import { Brand, Effect, Option, Result } from "effect";
import type { Array as Arr } from "effect";
import {
  directoryOf,
  pathOf,
  resolveIn,
  schemePrefix,
  withoutQuery,
} from "#plate/document/href.ts";
import type { Directory, Resolved } from "#plate/document/href.ts";
import { readSource } from "#plate/document/read.ts";
import {
  attributePath,
  mathmlNamespace,
  qtiNamespace,
  ssmlNamespace,
  walk,
  xincludeNamespace,
  xmlNamespace,
} from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceDocument,
  SourceElement,
  Visit,
} from "#plate/document/source.ts";
import { collapseXmlSpace, xmlWhitespaceRun, xsBooleanOf } from "#plate/model/attributes.ts";
import {
  expressionKinds,
  floatOrRefOf,
  integerOrRefOf,
  singleOf,
  stringOrRefOf,
} from "#plate/model/expression.ts";
import type {
  ExpressionKind,
  ExpressionType,
  LiteralOrRef,
  ReferenceEntry,
} from "#plate/model/expression.ts";
import { kindRules } from "#plate/model/expressions/read.ts";
import { itemRefsIn, occurrenceOf } from "#plate/model/item-refs.ts";
import { withLtiLinks, withUnheldReads } from "#plate/model/test.ts";
import type { LtiLink, UnheldRead } from "#plate/model/test.ts";
import { isLanguageTag, isNcName, trimXmlSpace } from "#plate/model/values.ts";
import { readManifest, resourceLom } from "#plate/package/manifest.ts";
import type { LomGeneral, LomValues, Manifest, ManifestResource } from "#plate/package/manifest.ts";
import { checkFiles, fileLocation, manifestFile, packageFiles } from "#plate/package/store.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { Location, RefusalRule } from "#plate/validate/refusal.ts";
import {
  declarationType,
  declarationsOf,
  mappingRequirement,
  processingRefusals,
} from "#plate/validate/rules.ts";
import type { CollectedTyper, PrefixedTyper } from "#plate/validate/rules.ts";
import { judgedInSpan } from "#plate/validate/open.ts";
import { tables } from "#plate/validate/tables.ts";
import { acceptMarkedTest, acceptedItem, check } from "#plate/validate/verdict.ts";
import type { Accepted, AcceptedStimulus, AcceptedTest, Verdict } from "#plate/validate/verdict.ts";
import { ltiLinkTypes, resourceRoots, resourceTypes } from "#plate/vocabulary.ts";
import type { CpVersion } from "#plate/vocabulary.ts";

/**
 * One item ref of a test, as {@link itemRefs} lists it: its identifier and its `href` as the test
 * model reads them.
 */
export interface ItemRefEntry {
  /**
   * The `href` with its outer whitespace removed and each inner run of it one space, as an
   * `anyURI` reads.
   */
  readonly href: string;
  readonly identifier: string;
}

/**
 * One test of an accepted package, with each of its item refs resolved to the item it names.
 */
export interface PackageTest {
  /**
   * The item of each of its item refs, keyed by the item ref's identifier, in document order: what
   * `startTest` takes as its items. Each item's `document` is its location in the package,
   * `<package location>/<path>`, which is the location `startTest` resolves the ref's `href` to,
   * by one rule on both sides: against the test's location (RFC 3986, section 5.2), each path
   * segment's percent escapes decoded, a malformed escape left as written, then its dot segments
   * removed, and its query and fragment set aside. `openPackage` resolves an item ref through the
   * `xml:base` in scope (reading 103), but a test `check` accepts holds none above an item ref, as
   * no test element declares `xml:base` (reading 90), so for an accepted test the base is the
   * test's location on both sides.
   */
  readonly items: ReadonlyMap<string, Accepted>;
  /**
   * The test, as its document's own verdict accepts it, or, when one of its item refs names an LTI
   * link or its processing reads, through an item ref, an item's context variable or any variable
   * of an LTI link, with each such item ref marked `lti-link` at it and left out, then that
   * processing marked: the outcome processing `marked` and each template default that reads one
   * left out, each read `variable:<name>` at the processing element, after the document's own
   * marks. The test document is judged without its items, so its own verdict cannot carry those
   * marks, and keeps its own.
   */
  readonly test: AcceptedTest;
}

/**
 * What an accepted package holds, which only {@link openPackage} and {@link acceptPackageForTest}
 * brand.
 *
 * Every document is keyed by its location, the package's location, a `/` and the document's path
 * from the package's root, which is also the location its verdict and its accepted form carry as
 * `document`. A path is a file's real name, its percent escapes decoded.
 */
export interface PackageContents {
  /**
   * The files a host may serve from the package, by their paths from its root: every file the
   * manifest lists by a path inside the package, except what each resource of a QTI type (an item,
   * a test, a section, a stimulus, outcome declarations, response processing, a response-processing
   * template and a fragment) withholds. Such a resource whose `href` names a file inside the
   * package withholds that file, its document; one without an `href` withholds every file it lists,
   * since nothing tells which of them is its document. One whose `href` leads outside the package
   * is refused (`package-path-outside`, `check: "document-entry"`, reading 102), so no accepted
   * package holds it.
   * The manifest is here only when a resource lists it.
   *
   * A QTI document holds what a candidate must not read, an item's correct responses and mappings
   * and the base values of response processing among them, whatever its file is named, so it is
   * left out by the resource that names it, not by its extension; a host reads those documents
   * through the package and serves only what `render` writes. A QTI document listed only by a
   * resource of another type, or as a further file of a QTI resource whose `href` names a file
   * inside the package, stays: no resource names it as a QTI document, and plate reads no other
   * file to find one. What stays is otherwise what an item embeds, its images, media, stylesheets
   * and package documents, which a host serves as live documents (from another origin or under the
   * CSP `sandbox` directive).
   */
  readonly files: ReadonlySet<string>;
  /**
   * Every item resource's item, each deliverable alone as an item outside a package is, a test's
   * items among them.
   */
  readonly items: ReadonlyMap<string, Accepted>;
  /**
   * The package's location, as the host named it.
   */
  readonly location: string;
  /**
   * Every stimulus resource's stimulus, each valid and delivered alone by no stage before M3.
   */
  readonly stimuli: ReadonlyMap<string, AcceptedStimulus>;
  /**
   * Every test resource's test, with its items.
   */
  readonly tests: ReadonlyMap<string, PackageTest>;
  /**
   * The content packaging profile the manifest's `schemaversion` names.
   */
  readonly version: CpVersion;
}

/**
 * A package {@link openPackage} accepted: the only way a host reaches a package's tests with their
 * items.
 *
 * The brand exists only in the type, as `Accepted`'s does: {@link openPackage} is its constructor,
 * and {@link acceptPackageForTest} the one named seam for tests.
 */
export type AcceptedPackage = Brand.Branded<PackageContents, "AcceptedPackage">;

/**
 * The brand's constructor, kept to this module.
 */
const acceptPackage = Brand.nominal<AcceptedPackage>();

/**
 * One resource of a judged package, in the manifest's order, with the verdict on its document.
 */
export interface PackageResource {
  readonly identifier: string;
  /**
   * The path of the file its `href` names, none for a resource with no `href` or one whose `href`
   * leads outside the package: an external link of a resource that is no document's, and refused
   * for a document resource (`package-path-outside`, `check: "document-entry"`, reading 102).
   */
  readonly path: Option.Option<string>;
  /**
   * The type the manifest declares, as written.
   */
  readonly type: string;
  /**
   * The verdict on its document, which `openPackage` gives for an item, test, section or stimulus
   * resource whose document the package holds and reads as that type (reading 162); none
   * otherwise.
   */
  readonly verdict: Option.Option<Verdict>;
}

/**
 * The verdict on a package as a whole, by `verdict`.
 *
 * - `refused`: the manifest is refused, a file rule fails, a package rule fails or a document is
 *   refused. `refusals` holds every refusal that refuses it: the package's own, then each refused
 *   document's, in the manifest's order, each document once.
 * - `unchecked`: nothing is refused and some document is unchecked.
 * - `accepted-with-unsupported`: nothing is refused or unchecked and some document is accepted with
 *   unsupported features. A package carries no mark of its own in M2.
 * - `accepted`: every document is accepted.
 *
 * `resources` lists every resource with its document's verdict beneath the package's; it is empty
 * when the manifest is not read. `location` is the package's location.
 */
export type PackageVerdict =
  | {
      readonly location: string;
      readonly refusals: Arr.NonEmptyReadonlyArray<Refusal>;
      readonly resources: readonly PackageResource[];
      readonly verdict: "refused";
    }
  | {
      readonly location: string;
      readonly resources: readonly PackageResource[];
      readonly verdict: "unchecked";
    }
  | {
      readonly accepted: AcceptedPackage;
      readonly location: string;
      readonly resources: readonly PackageResource[];
      readonly verdict: "accepted" | "accepted-with-unsupported";
    };

/**
 * One document of the package, read once, as one type, with the verdict on it when that type is one
 * plate judges.
 */
interface Document {
  /**
   * Its source, or the shared reader's refusal of its bytes.
   */
  readonly source: Result.Result<SourceDocument, Refusal>;
  /**
   * The document type it is read as, of those its resources name it under ({@link readAs}).
   */
  readonly type: string;
  readonly verdict: Option.Option<Verdict>;
}

/**
 * The resource types whose documents plate judges: an item, a test, a section and a stimulus.
 */
const judgedTypes: ReadonlySet<string> = new Set([
  "imsqti_item_xmlv3p0",
  "imsqti_section_xmlv3p0",
  "imsqti_stimulus_xmlv3p0",
  "imsqti_test_xmlv3p0",
]);

/**
 * The QTI resource types, the eight `imsqti_*` types of the profile's `type` enumeration: what a
 * resource of one of these types withholds ({@link withheldFiles}) never reaches `files`.
 */
const qtiTypes: ReadonlySet<string> = new Set(
  Object.values(resourceTypes).flatMap((types) =>
    types.filter((type) => type.startsWith("imsqti_")),
  ),
);

/**
 * The root each QTI resource type with a fixed root names, by type.
 */
const rootOfType: ReadonlyMap<string, string> = new Map<string, string>(resourceRoots);

/**
 * LOM's namespace, the namespace of the root `lom` of a LOM metadata document.
 */
const lomNamespace = "http://ltsc.ieee.org/xsd/LOM";

/**
 * QTI 3's usage-data namespace, the namespace of the root `usageData` of a usage-data document
 * (`usagedata/imsqti_usagedatav3p0_v1p0.xsd`; reading 89).
 */
const usageDataNamespace = "http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0";

/**
 * The QTI roots no XInclude stands for: an item, a test, a stimulus, an outcome declaration and
 * response processing, each a root only of its own document type.
 */
const unincludedRoots: ReadonlySet<string> = new Set([
  "qti-assessment-item",
  "qti-assessment-stimulus",
  "qti-assessment-test",
  "qti-outcome-declaration",
  "qti-response-processing",
]);

/**
 * The ten document types, whose resource's `href` names the one document of that path, read as one
 * type (readings 93 and 146), each with whether a root bears it out (reading 162): the root of a
 * QTI type with a fixed root (`resourceRoots`), LOM's `lom` for LOM metadata, QTI 3's `usageData`
 * for usage data, and, for an included fragment, any element an include stands for (reading 114).
 *
 * Plate holds no table of what an include stands for, so it reads a fragment's root as borne out by
 * any element in QTI's namespace but the roots no include stands for ({@link unincludedRoots}); an
 * include in a section may stand for a section. That decides a type only for a path two types
 * name, which is refused either way, so the choice moves no verdict, only which resource the
 * refusal is at (rule `db2ef322`: a limit, recorded here).
 */
const documentTypes: ReadonlyMap<string, (root: SourceElement) => boolean> = new Map<
  string,
  (root: SourceElement) => boolean
>([
  ...resourceRoots.map(
    ([type, local]) =>
      [
        type,
        (root: SourceElement) => root.namespace === qtiNamespace && root.local === local,
      ] as const,
  ),
  [
    "imsqti_fragment_xmlv3p0",
    (root) => root.namespace === qtiNamespace && !unincludedRoots.has(root.local),
  ],
  [
    "qtiusagedata/xml",
    (root) => root.namespace === usageDataNamespace && root.local === "usageData",
  ],
  ["resourcemetadata/xml", (root) => root.namespace === lomNamespace && root.local === "lom"],
]);

/**
 * The namespaces of QTI 2's published XSDs, each under `http://www.imsglobal.org/xsd/` (reading
 * 89): a root in one of them is a QTI 2 document, which no QTI 3 schema reads.
 */
const qti2Namespaces: ReadonlySet<string> = new Set(
  [
    "imsqti_metadata_v2p1",
    "imsqti_metadata_v2p2",
    "imsqti_result_v2p1",
    "imsqti_result_v2p2",
    "imsqti_usagedata_v2p1",
    "imsqti_usagedata_v2p2",
    "imsqti_v2p0",
    "imsqti_v2p1",
    "imsqti_v2p2",
  ].map((name) => `http://www.imsglobal.org/xsd/${name}`),
);

/**
 * The resource types whose document reading 62 ("an item's or test's identifier and title are
 * those its package's LOM metadata gives it") and reading 134 tie to the resource's LOM metadata:
 * an item and a test.
 */
const lomBoundTypes: ReadonlySet<string> = new Set(["imsqti_item_xmlv3p0", "imsqti_test_xmlv3p0"]);

/**
 * The roots of the documents reading 62 ("an item's or test's identifier and title are those its
 * package's LOM metadata gives it") ties to a resource's LOM metadata: the roots of
 * {@link lomBoundTypes}, an item's and a test's.
 */
const lomBoundRoots: ReadonlySet<string> = new Set(
  resourceRoots.flatMap(([type, root]) => (lomBoundTypes.has(type) ? [root] : [])),
);

/**
 * The kind of variable a variable stands as, the declaration kind of its declaration or, for a
 * built-in, the one QTI gives it: what a reference judged by kind (reading 111, "a processing
 * element's `identifier` names a variable of the kind the element reads or sets") reads.
 */
type VariableKind = "context" | "outcome" | "response" | "template";

/**
 * A built-in variable: the kind it stands as and its type.
 */
interface BuiltIn {
  readonly kind: VariableKind;
  readonly type: ExpressionType;
}

/**
 * The variables every item has besides those it declares, which a test reads through an item ref
 * (reading 106, "a prefixed reference reaches every built-in variable its item ref's item holds,
 * `QTI_CONTEXT` among them"), each with the kind it stands as (reading 111) and its type, as the
 * qti package's `BuiltInVariable` holds them under an item's root
 * (`packages/pantry/src/grammar/install.ts`, its rows `builtIns` in
 * `packages/pantry/src/grammar/references.ts`): the responses `numAttempts`, a single integer, and
 * `duration`, a single float, seconds (reading 29), the outcome `completionStatus`, a single
 * identifier, and the context variable `QTI_CONTEXT`, a record.
 */
const itemBuiltIns: ReadonlyMap<string, BuiltIn> = new Map<string, BuiltIn>([
  ["completionStatus", { kind: "outcome", type: singleOf("identifier") }],
  ["duration", { kind: "response", type: singleOf("float") }],
  ["numAttempts", { kind: "response", type: singleOf("integer") }],
  ["QTI_CONTEXT", { kind: "context", type: { baseType: "unknown", cardinality: "record" } }],
]);

/**
 * The built-in session variables, the built-ins of {@link itemBuiltIns} but `QTI_CONTEXT`, whose
 * identifiers "are reserved. They are completionStatus, numAttempts and duration" (reading 97,
 * information model section 4.5.1), as the qti package's `sessionVariables` lists them
 * (`packages/pantry/src/qti/tests.ts`). A variable mapping's target under an item ref that names an
 * LTI link may name none of them ({@link judgeMappings}).
 */
const sessionVariables: ReadonlySet<string> = new Set([
  "completionStatus",
  "duration",
  "numAttempts",
]);

/**
 * A part's or a section's `duration`: a response, a single duration, where an item's is a float
 * (`builtIns` in `packages/pantry/src/grammar/references.ts`, which gives a test's, a part's and a
 * section's `duration` the kind of a response declaration).
 */
const scopeDuration: BuiltIn = { kind: "response", type: singleOf("duration") };

/**
 * The type of a name no reading resolves, or two readings resolve: unknown, which satisfies every
 * rule, so such a name earns its reading's refusal alone ({@link judgeReference}).
 */
const unknownType: ExpressionType = { baseType: "unknown", cardinality: "unknown" };

/**
 * The kinds of variable a reference attribute may name through an item ref: a template variable
 * and an outcome variable (P24), a built-in by the kind it stands as.
 */
const namableKinds: ReadonlySet<VariableKind> = new Set(["outcome", "template"]);

/**
 * The declarations of an item's variables, by local name in QTI's namespace, each with the kind
 * of variable it declares.
 */
const itemDeclarations: ReadonlyMap<string, VariableKind> = new Map<string, VariableKind>([
  ["qti-context-declaration", "context"],
  ["qti-outcome-declaration", "outcome"],
  ["qti-response-declaration", "response"],
  ["qti-template-declaration", "template"],
]);

/**
 * The expressions whose `identifier` a test may prefix with an item ref, a part or a section, by
 * local name in QTI's namespace: a variable's value, its default, a response's correct response,
 * and a response mapped through its mapping or its area mapping. The outcome rules whose
 * `identifier` a test writes dotted are {@link targetElements}, which no prefix resolves.
 */
const referenceElements: ReadonlySet<string> = new Set([
  "qti-correct",
  "qti-default",
  "qti-map-response",
  "qti-map-response-point",
  "qti-variable",
]);

/**
 * The outcome rules of a test, a set and a lookup of an outcome's value, by local name in QTI's
 * namespace, whose `identifier` names the variable they set: a variable of the test's own document,
 * so of a dotted `identifier` only the unsplit reading resolves (reading 112, "a test's setter sets
 * a variable of its own document, so a prefixed reading never resolves it"), as the qti package's
 * `resolves` gives a setter's reading (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`). A test's processing holds no other setter.
 */
const targetElements: ReadonlySet<string> = new Set([
  "qti-lookup-outcome-value",
  "qti-set-outcome-value",
]);

/**
 * The expressions that map a response, by local name in QTI's namespace.
 */
const mappingExpressions: ReadonlySet<string> = new Set([
  "qti-map-response",
  "qti-map-response-point",
]);

/**
 * The expressions whose `identifier` names a response, by local name in QTI's namespace: its
 * correct response, which "looks up the declaration of a response variable" (`info.txt:9302`), and
 * each mapping of it ({@link mappingExpressions}).
 */
const responseExpressions: ReadonlySet<string> = new Set(["qti-correct", ...mappingExpressions]);

/**
 * The child of an item ref that gives one of its item's template variables a value before its
 * template processing, by local name in QTI's namespace.
 */
const templateDefaultElements: ReadonlySet<string> = new Set(["qti-template-default"]);

/**
 * A test's outcome processing, by local name in QTI's namespace.
 */
const processingElements: ReadonlySet<string> = new Set(["qti-outcome-processing"]);

/**
 * The item ref, the one element of a test that references an item document, by local name in
 * QTI's namespace.
 */
const itemRefElements: ReadonlySet<string> = new Set(["qti-assessment-item-ref"]);

/**
 * The section ref, the one element of a test or a section document that references a section
 * document, by local name in QTI's namespace.
 */
const sectionRefElements: ReadonlySet<string> = new Set(["qti-assessment-section-ref"]);

/**
 * The elements of a test whose identifier names a scope with a `duration`: a part and a section.
 */
const durationScopes: ReadonlySet<string> = new Set(["qti-assessment-section", "qti-test-part"]);

/**
 * A section, by local name in QTI's namespace, the one element of a test whose `qti-selection`
 * may let its item refs be instantiated more than once.
 */
const sectionElements: ReadonlySet<string> = new Set(["qti-assessment-section"]);

/**
 * A section's selection, by local name in QTI's namespace.
 */
const selectionElements: ReadonlySet<string> = new Set(["qti-selection"]);

/**
 * The variables a test's processing holds besides those it declares, each with the kind it stands
 * as and its type: `QTI_CONTEXT`, a context variable and a record, `completionStatus`, an outcome
 * and a single identifier, and `duration` and `numAttempts`, responses, a single duration and a
 * single integer. The qti package now gives a test only `duration` and `QTI_CONTEXT` (`builtIns`
 * in `packages/pantry/src/grammar/references.ts`); plate keeps a test's own `numAttempts` and
 * `completionStatus` where the test declares neither, accepted and marked, as ruled (B4), an
 * agreement difference (G-R3 184, pending). A test may declare either (reading 168, "A test may
 * declare a variable named `numAttempts` or `completionStatus`; in a test only `duration` is
 * reserved"), and its processing then reads the declared variable, not this built-in.
 */
const testBuiltIns: ReadonlyMap<string, BuiltIn> = new Map<string, BuiltIn>([
  ["QTI_CONTEXT", { kind: "context", type: { baseType: "unknown", cardinality: "record" } }],
  ["completionStatus", { kind: "outcome", type: singleOf("identifier") }],
  ["duration", scopeDuration],
  ["numAttempts", { kind: "response", type: singleOf("integer") }],
]);

/**
 * The declarations of a test's variables, by local name in QTI's namespace: an outcome variable
 * and a context variable.
 */
const testDeclarations: ReadonlySet<string> = new Set([
  "qti-context-declaration",
  "qti-outcome-declaration",
]);

/**
 * The child of an item ref that names one of its item's variables by another name the test reads
 * it by, by local name in QTI's namespace.
 */
const mappingElements: ReadonlySet<string> = new Set(["qti-variable-mapping"]);

/**
 * A test part, by local name in QTI's namespace: the element a test's sections and item refs lie
 * in, and the only kind a test part's branch rule may name (reading 87).
 */
const partElements: ReadonlySet<string> = new Set(["qti-test-part"]);

/**
 * The elements of a test or section document a branch rule's `target` may name, by local name in
 * QTI's namespace: a test part, a section, a section ref and an item ref (reading 87, "a target is
 * one of the three reserved values ... or the identifier of a test part, section, section ref or
 * item ref of the assembled test").
 */
const branchNameElements: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-assessment-section",
  "qti-assessment-section-ref",
  "qti-test-part",
]);

/**
 * The elements a branch rule may sit on, its owner, by local name in QTI's namespace: a test part,
 * a section and an item ref, as the ASI XSD places `qti-branch-rule`.
 */
const branchOwnerElements: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-assessment-section",
  "qti-test-part",
]);

/**
 * A branch rule, by local name in QTI's namespace.
 */
const branchRuleElements: ReadonlySet<string> = new Set(["qti-branch-rule"]);

/**
 * A section's ordering, by local name in QTI's namespace.
 */
const orderingElements: ReadonlySet<string> = new Set(["qti-ordering"]);

/**
 * The reserved targets every branch rule may name (reading 87; information model section
 * 5.23.1).
 */
const branchExits: ReadonlySet<string> = new Set(["EXIT_SECTION", "EXIT_TEST", "EXIT_TESTPART"]);

/**
 * Each expression kind, by its element's local name in QTI's namespace.
 */
const kindsByElement: ReadonlyMap<string, ExpressionKind> = new Map(
  expressionKinds.map((kind) => [`qti-${kind}`, kind] as const),
);

/**
 * The classifier of each base type a reference facet entry names, the one the item model's reader
 * and the validator use (`#plate/model/expression.ts`): each classifies one value of a reference
 * attribute as the literal or the reference it holds. Only the string classifier reads the names
 * it is given: a `pattern` is a reference only as a braced name of a variable held (ruling R1).
 */
const classifiers = {
  float: floatOrRefOf,
  integer: integerOrRefOf,
  string: stringOrRefOf,
} as const satisfies Record<
  ReferenceEntry["baseType"],
  (written: string, held: ReadonlySet<string>) => LiteralOrRef<unknown>
>;

/**
 * Construct a refusal the package reader gives.
 *
 * @param document The location of the document it refuses.
 * @param rule The rule it breaks.
 * @param path The path in that document of the element or attribute at issue.
 * @param detail The facts the verdict's wording reads.
 * @returns The refusal.
 */
const refuse = (
  document: string,
  rule: RefusalRule,
  path: string,
  detail: Readonly<Record<string, string>>,
): Refusal => {
  const location: Location = { kind: "path", path };

  return new Refusal({
    detail,
    document,
    location,
    readerRule: Option.none(),
    rule,
    suggestion: Option.none(),
  });
};

/**
 * Give an element's attribute in no namespace, as written.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @returns Its value, none when the element has no such attribute.
 */
const attributeOf = (element: SourceElement, local: string): Option.Option<string> =>
  Option.fromUndefinedOr(
    element.attributes.find((attribute) => attribute.namespace === "" && attribute.local === local)
      ?.value,
  );

/**
 * Give an element's identifier, its outer XML whitespace removed, as an NCName reads.
 *
 * @param element The element.
 * @returns The identifier, none when it has none.
 */
const identifierOf = (element: SourceElement): Option.Option<string> =>
  attributeOf(element, "identifier").pipe(Option.map(trimXmlSpace));

/**
 * Report whether an element is the QTI element with a local name in a set.
 *
 * @param element The element.
 * @param locals The local names.
 * @returns Whether it is in QTI's namespace and its local name is one of them.
 */
const isQti = (element: SourceElement, locals: ReadonlySet<string>): boolean =>
  element.namespace === qtiNamespace && locals.has(element.local);

/**
 * Name a document's root as a refusal's detail names it: its local name in QTI's namespace,
 * `{<namespace>}<local>` otherwise, as a path step spells it.
 *
 * @param root The root.
 * @returns Its name.
 */
const rootName = (root: SourceElement): string =>
  root.namespace === qtiNamespace ? root.local : `{${root.namespace}}${root.local}`;

/**
 * Give the path of the file a resource's `href` names inside the package.
 *
 * @param resource The resource.
 * @returns The path, none for no `href` or one that leads outside the package, which the manifest's
 *   own rules refuse of a document resource (`document-entry`, reading 102).
 */
const documentPath = (resource: ManifestResource): Option.Option<string> =>
  resource.href.pipe(Option.flatMap((href) => href.path));

/**
 * Give the paths of the files a resource of a QTI type withholds from `files`: the document its
 * `href` names inside the package, or, when it has no `href`, every file it lists, since nothing
 * tells which of them is its document. One whose `href` leads outside the package withholds every
 * file it lists too, though the manifest's own rules refuse it (`document-entry`, reading 102).
 *
 * @param resource The resource, of a QTI type.
 * @returns The withheld paths.
 */
const withheldFiles = (resource: ManifestResource): readonly string[] =>
  Option.match(documentPath(resource), {
    onNone: () => resource.files.flatMap((file) => Option.toArray(file.path)),
    onSome: (path) => [path],
  });

/**
 * A base a document's references resolve against: the directory a reference's path is relative to,
 * shared by reference with every element in the base's scope, or none for a base outside the
 * package, against which every relative reference stays outside it.
 */
type Base = Option.Option<Directory>;

/**
 * Resolve a reference a document makes against its base through {@link resolveIn}, by the rule the
 * manifest resolves an `href` by and `startTest` an item ref's (reading 102), with work that grows
 * with the reference's length, not the base's depth.
 *
 * @param base The base in scope where the reference is written ({@link basesOf}).
 * @param reference The reference, read by its attribute's whitespace class.
 * @returns The path it names inside the package; none for an absolute URI, a path from a host's
 *   root, one whose `..` climbs above the package's root, and any reference under a base outside
 *   the package.
 */
const locate = (base: Base, reference: string): Option.Option<Resolved> =>
  schemePrefix.test(reference)
    ? Option.none()
    : base.pipe(Option.flatMap((directory) => resolveIn(directory, reference)));

/**
 * Give an element's `xml:base`, as written.
 *
 * @param element The element.
 * @returns Its `xml:base`, none when it has none.
 */
const xmlBaseOf = (element: SourceElement): Option.Option<string> =>
  Option.fromUndefinedOr(
    element.attributes.find(
      (attribute) => attribute.namespace === xmlNamespace && attribute.local === "base",
    )?.value,
  );

/**
 * Give the base each element of a document resolves its references against (reading 103, "an
 * `xml:base` is a base, resolved and never a file reference"): the innermost `xml:base` in scope,
 * the element's own included, each resolved against the base above it, or else the document's own
 * path.
 *
 * An `xml:base` is an `xs:anyURI`, read collapsed. One whose path is empty, a query or a fragment
 * alone among them, resolves to the base above it (RFC 3986, section 5.2.2). One that is an
 * absolute URI, starts with `/` or climbs above the package's root leaves the package, so every
 * relative reference in its scope does too (reading 102). Each `xml:base` is resolved once, against
 * the directory above it, with work that grows with its own length, and its directory is shared by
 * reference with every element in its scope, so a deep base costs its depth once, not once for
 * each element or reference under it.
 *
 * @param visits The visits of the document's elements, in document order, each parent before its
 *   children.
 * @param path The document's path from the package's root.
 * @returns Each element's base.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.1
 */
const basesOf = (visits: readonly Visit[], path: string): ReadonlyMap<SourceElement, Base> => {
  const own: Base = Option.some(directoryOf(path));
  const bases = new Map<SourceElement, Base>();
  for (const { element, parent } of visits) {
    const above = Option.match(parent, {
      onNone: () => own,
      onSome: (holder) => bases.get(holder) ?? own,
    });
    const written = Option.map(xmlBaseOf(element), collapseXmlSpace);
    bases.set(
      element,
      Option.match(written, {
        onNone: () => above,
        onSome: (value) =>
          withoutQuery(value) === ""
            ? above
            : Option.map(locate(above, value), (resolved) => resolved.directory),
      }),
    );
  }

  return bases;
};

/**
 * How a file reference's value is read before it is resolved, by its attribute's type (reading
 * 102): an `xs:anyURI` collapses (`collapse`); HTML's `URLDType`, an `xs:normalizedString`, turns
 * each tab, line feed and carriage return into a space (`replace`); an `xs:string`, `object@data`,
 * keeps them (`preserve`). Each then sets aside the whitespace around it.
 */
type ReferenceSpace = "collapse" | "preserve" | "replace";

/**
 * One attribute that names a file of the package, as reading 103's census lists it: its local name,
 * how its value is read, and whether its value is HTML's list of image candidate strings, each
 * candidate's URL one reference.
 */
interface FileReference {
  readonly local: string;
  readonly space: ReferenceSpace;
  readonly srcset: boolean;
}

/**
 * Name an attribute of the census whose value is one reference.
 *
 * @param local The attribute's local name.
 * @param space How its value is read.
 * @returns The census entry.
 */
const referenceAttribute = (local: string, space: ReferenceSpace = "collapse"): FileReference => ({
  local,
  space,
  srcset: false,
});

/**
 * The census's attributes on QTI's elements, its HTML subset's and its own, by local name (reading
 * 103): HTML's hyperlink, quotation sources and URL attributes, `source@srcset` among them; the
 * `href` of a stylesheet and of the six refs; a module configuration; a response processing
 * template's location; and an outcome's long interpretation. The types are the ASI XSD's:
 * `object@data` is an `xs:string`, `audio`, `video`, `source` and `track`'s URLs a `URLDType`, the
 * rest an `xs:anyURI`.
 */
const qtiReferences: ReadonlyMap<string, readonly FileReference[]> = new Map([
  ["a", [referenceAttribute("href")]],
  ["audio", [referenceAttribute("src", "replace")]],
  ["blockquote", [referenceAttribute("cite")]],
  ["img", [referenceAttribute("src"), referenceAttribute("longdesc")]],
  ["object", [referenceAttribute("data", "preserve")]],
  ["q", [referenceAttribute("cite")]],
  ["qti-adaptive-engine-ref", [referenceAttribute("href")]],
  ["qti-adaptive-settings-ref", [referenceAttribute("href")]],
  ["qti-assessment-item-ref", [referenceAttribute("href")]],
  ["qti-assessment-section-ref", [referenceAttribute("href")]],
  ["qti-assessment-stimulus-ref", [referenceAttribute("href")]],
  [
    "qti-interaction-modules",
    [referenceAttribute("primary-configuration"), referenceAttribute("secondary-configuration")],
  ],
  ["qti-metadata-ref", [referenceAttribute("href")]],
  ["qti-outcome-declaration", [referenceAttribute("long-interpretation")]],
  ["qti-response-processing", [referenceAttribute("template-location")]],
  ["qti-stylesheet", [referenceAttribute("href")]],
  ["qti-usagedata-ref", [referenceAttribute("href")]],
  [
    "source",
    [
      referenceAttribute("src", "replace"),
      { local: "srcset", space: "replace", srcset: true } satisfies FileReference,
    ],
  ],
  ["track", [referenceAttribute("src", "replace")]],
  ["video", [referenceAttribute("src", "replace"), referenceAttribute("poster", "replace")]],
]);

/**
 * The census's attributes of MathML's elements besides the `href` every one of them may carry, by
 * local name (reading 103; MathML 3, sections 2.1.6 and 2.2.1).
 */
const mathmlReferences: ReadonlyMap<string, readonly FileReference[]> = new Map([
  ["annotation", [referenceAttribute("src")]],
  ["annotation-xml", [referenceAttribute("src")]],
  ["math", [referenceAttribute("altimg"), referenceAttribute("cdgroup")]],
  ["mglyph", [referenceAttribute("src")]],
  ["share", [referenceAttribute("src")]],
]);

/**
 * The census's attributes of SSML's elements, by local name (reading 103; SSML 1.1).
 */
const ssmlReferences: ReadonlyMap<string, readonly FileReference[]> = new Map([
  ["audio", [referenceAttribute("src")]],
  ["lexicon", [referenceAttribute("uri")]],
]);

/**
 * Give the attributes of reading 103's census an element may carry: by its namespace and local
 * name, `href` on every MathML element and on an XInclude `include`.
 *
 * @param element The element.
 * @returns The attributes, none for an element the census does not name.
 */
const censusOf = (element: SourceElement): readonly FileReference[] => {
  switch (element.namespace) {
    case qtiNamespace: {
      return qtiReferences.get(element.local) ?? [];
    }
    case mathmlNamespace: {
      return [referenceAttribute("href"), ...(mathmlReferences.get(element.local) ?? [])];
    }
    case ssmlNamespace: {
      return ssmlReferences.get(element.local) ?? [];
    }
    case xincludeNamespace: {
      return element.local === "include" ? [referenceAttribute("href")] : [];
    }
    default: {
      return [];
    }
  }
};

/**
 * One element whose text names a file of the package (R9-b, "Card files and resource icons are
 * file references"): how its text is read, by its type, and the line of QTI's information model
 * whose sentence settles it, which its refusal cites as `source`.
 */
interface TextReference {
  readonly source: string;
  readonly space: ReferenceSpace;
}

/**
 * The QTI elements whose `qti-file-href` names a file of the package: a card and a card entry.
 */
const cardHolders: ReadonlySet<string> = new Set(["qti-card", "qti-card-entry"]);

/**
 * Give the census entry of an element whose text names a file of the package, read as reading
 * 102 reads an `href` (R9-b, "Card files and resource icons are file references").
 *
 * The entries are a card's or a card entry's `qti-file-href`, a `FileHrefCardDType`, whose content
 * is an `xs:anyURI` (section 6.6, CardSelection, "these files MUST be contained in the
 * corresponding QTI content package", `info.txt:21151`), and every `qti-resource-icon`, a
 * `URLDType`, an `xs:normalizedString` (section 5.80.4, "This file MUST be contained within the
 * correponding QTI content package", `info.txt:33266`). The `qti-file-href` of a calculator's
 * `qti-calculator-info` or of a `qti-digital-material`, an `ItemFileInfoDType`, is left out, as
 * R9-b leaves it out.
 *
 * @param element The element.
 * @param parent Its parent, none for a root.
 * @returns The census entry, none for an element whose text the census does not read.
 */
const textCensusOf = (
  element: SourceElement,
  parent: Option.Option<SourceElement>,
): Option.Option<TextReference> => {
  if (element.namespace !== qtiNamespace) {
    return Option.none();
  }

  switch (element.local) {
    case "qti-file-href": {
      return Option.exists(parent, (holder) => isQti(holder, cardHolders))
        ? Option.some({ source: "info.txt:21151", space: "collapse" })
        : Option.none();
    }
    case "qti-resource-icon": {
      return Option.some({ source: "info.txt:33266", space: "replace" });
    }
    default: {
      return Option.none();
    }
  }
};

/**
 * Give an element's simple content: its text children joined.
 *
 * @param element The element.
 * @returns Its text; none when it holds an unexpanded entity reference, whose value is unknown, or
 *   an element, which a simple type does not allow and the document's own verdict refuses.
 */
const simpleTextOf = (element: SourceElement): Option.Option<string> => {
  let text = "";
  for (const child of element.children) {
    if (child.kind !== "text") {
      return Option.none();
    }

    text += child.text;
  }

  return Option.some(text);
};

/**
 * A carriage return, a line feed or a tab, each of which an `xs:normalizedString` reads as a space.
 */
const replacedWhitespace = /[\t\n\r]/gu;

/**
 * Read a file reference's value by its whitespace class, before it is resolved (reading 102).
 *
 * @param space How the value is read.
 * @param value The value, as written.
 * @returns The value as read, the whitespace around it set aside.
 */
const readReference = (space: ReferenceSpace, value: string): string =>
  space === "collapse"
    ? collapseXmlSpace(value)
    : trimXmlSpace(space === "replace" ? value.replaceAll(replacedWhitespace, " ") : value);

/**
 * Give the references one census attribute's value makes, each read by the attribute's whitespace
 * class (reading 102).
 *
 * A `srcset` is split at its commas into image candidates, and each candidate's URL is the text
 * before its first whitespace. That is the stated limit of this reading of HTML's parsing
 * algorithm, which lets a URL hold a comma not followed by whitespace; no official package has
 * a `srcset` of more than one candidate (rule `db2ef322`, recorded here).
 *
 * @param reference The census attribute.
 * @param value Its value, as written.
 * @returns The references, none empty.
 */
const referencesIn = (reference: FileReference, value: string): readonly string[] => {
  const read = readReference(reference.space, value);

  return reference.srcset
    ? read.split(",").flatMap((candidate) => {
        const [url = ""] = trimXmlSpace(candidate).split(xmlWhitespaceRun);

        return url === "" ? [] : [url];
      })
    : [read];
};

/**
 * The most characters a fact of a refusal's detail carries ({@link boundedFact}).
 */
const factLimit = 1024;

/**
 * How many of its first characters a fact longer than {@link factLimit} keeps.
 */
const factHead = 512;

/**
 * How many of its last characters a fact longer than {@link factLimit} keeps, so with the `…`
 * between them it is {@link factLimit} long.
 */
const factTail = 511;

/**
 * Bound a fact a refusal's detail carries: one longer than {@link factLimit} characters keeps its
 * first {@link factHead} and its last {@link factTail} characters around one `…` (U+2026), and a
 * shorter one is unchanged.
 *
 * A hostile package can make a fact as long as one of its documents for each of thousands of
 * refusals, a path resolved through a deep `xml:base` for every reference under it, so the details
 * would total more characters than a host can serialise into one string. No official package's
 * refusal carries a fact that long, so no wording any of them is given changes.
 *
 * @param fact The fact.
 * @returns The fact, bounded.
 */
const boundedFact = (fact: string): string =>
  fact.length <= factLimit ? fact : `${fact.slice(0, factHead)}…${fact.slice(-factTail)}`;

/**
 * Join some texts with a separator into a fact bounded as {@link boundedFact} bounds one, copying
 * only the characters the bounded fact keeps rather than writing the whole join out first.
 *
 * An `inclusion-cycle` refusal's chain names every document from the test down to the one whose
 * section ref returns, so a hostile package of long paths, many refs back and a long chain would
 * write out text that grows as the square of its documents for each such ref, only to bound it.
 *
 * @param texts The texts, in order.
 * @param separator What goes between each two of them.
 * @returns `boundedFact(texts.join(separator))`.
 */
const boundedJoin = (texts: readonly string[], separator: string): string => {
  const pieces = texts.flatMap((text, index) => (index === 0 ? [text] : [separator, text]));
  let length = 0;
  for (const piece of pieces) {
    length += piece.length;
  }

  if (length <= factLimit) {
    return pieces.join("");
  }

  let head = "";
  for (const piece of pieces) {
    if (head.length >= factHead) {
      break;
    }

    head += piece.slice(0, factHead - head.length);
  }

  let tail = "";
  for (const piece of pieces.toReversed()) {
    if (tail.length >= factTail) {
      break;
    }

    tail = `${piece.slice(Math.max(0, piece.length - (factTail - tail.length)))}${tail}`;
  }

  return `${head}…${tail}`;
};

/**
 * A directory of some paths inside a package, the files a package holds or lists, or the documents
 * a ref may name: the names of its files, each with its path as given, and of the directories in it
 * by name, each a folder of its own.
 */
interface Folder {
  readonly files: Map<string, string>;
  readonly folders: Map<string, Folder>;
}

/**
 * Give the folders of a set of paths inside a package, each path split at `/` into the folders that
 * hold it and its file's name. A resolved path's segments never hold a `/` (an escaped one stays
 * escaped, by `decodeSegment` in `src/document/href.ts`), so a path is in the set exactly when its
 * directory's folder holds its name, and the folder gives that path as the set gave it, which is
 * the text `pathOf` writes for it.
 *
 * @param paths The paths, `/` separating each one's segments.
 * @returns The package root's folder.
 */
const foldersOf = (paths: Iterable<string>): Folder => {
  const root: Folder = { files: new Map(), folders: new Map() };
  for (const path of paths) {
    const segments = path.split("/");
    let folder = root;
    for (const name of segments.slice(0, -1)) {
      const known = folder.folders.get(name);
      const next = known ?? {
        files: new Map<string, string>(),
        folders: new Map<string, Folder>(),
      };
      if (known === undefined) {
        folder.folders.set(name, next);
      }

      folder = next;
    }

    folder.files.set(segments.at(-1) ?? "", path);
  }

  return root;
};

/**
 * What a reference's check needs of the directory its path resolves into, each fact found from its
 * parent's: the folder of the paths it is looked for among under it, the package's files for a
 * file reference and the documents a ref may name for a ref, and the start and length of the text
 * a name in it follows, its path and a `/`.
 */
interface DirectoryFacts {
  /**
   * The folder of the paths under the directory, none when there are none.
   */
  readonly folder: Option.Option<Folder>;
  /**
   * The first {@link factHead} characters of the directory's path and a `/`, all of them when they
   * are fewer; empty at the package's root.
   */
  readonly head: string;
  /**
   * The length of the directory's path and a `/`, 0 at the package's root.
   */
  readonly length: number;
}

/**
 * Give each directory's facts ({@link DirectoryFacts}), found from its parent's on the first call
 * for it and kept by the directory for every later one. A directory many references resolve into,
 * a deep `xml:base`'s, is climbed once, so whether a held file, or a document a ref may name, lies
 * under it is decided once, not once for each reference.
 *
 * @param files The package root's folder of the paths looked for ({@link foldersOf}).
 * @returns The facts of a directory.
 */
const directoryFacts = (files: Folder): ((directory: Directory) => DirectoryFacts) => {
  const kept = new Map<Directory, DirectoryFacts>();
  const atRoot: DirectoryFacts = { folder: Option.some(files), head: "", length: 0 };

  return (directory) => {
    const unknown: Directory[] = [];
    let place = directory;
    while (Option.isSome(place.parent) && !kept.has(place)) {
      unknown.push(place);
      place = place.parent.value;
    }

    let facts = kept.get(place) ?? atRoot;
    for (const child of unknown.toReversed()) {
      facts = {
        folder: facts.folder.pipe(
          Option.flatMap((folder) => Option.fromUndefinedOr(folder.folders.get(child.name))),
        ),
        head:
          facts.head.length >= factHead
            ? facts.head
            : `${facts.head}${child.name.slice(0, factHead)}/`.slice(0, factHead),
        length: facts.length + child.name.length + 1,
      };
      kept.set(child, facts);
    }

    return facts;
  };
};

/**
 * Give the text of a path a file reference names, bounded as {@link boundedFact} bounds a fact,
 * without writing out a longer path: its first characters come from its directory's facts and its
 * last from the names nearest its end, so a path under a deep `xml:base` costs the bound, not its
 * depth.
 *
 * @param resolved The path inside the package.
 * @param facts Its directory's facts ({@link directoryFacts}).
 * @returns `boundedFact(pathOf(resolved))`.
 */
const boundedPath = (resolved: Resolved, facts: DirectoryFacts): string => {
  if (facts.length + resolved.name.length <= factLimit) {
    return boundedFact(pathOf(resolved));
  }

  const head =
    facts.head.length >= factHead
      ? facts.head
      : `${facts.head}${resolved.name.slice(0, factHead - facts.head.length)}`;
  const last = resolved.name.slice(-factTail);
  const pieces = [last];
  let { length } = last;
  for (
    let place = resolved.directory;
    length < factTail && Option.isSome(place.parent);
    place = place.parent.value
  ) {
    const piece = place.name.slice(-factTail);
    pieces.push(piece);
    length += piece.length + 1;
  }

  return `${head}…${pieces.toReversed().join("/").slice(-factTail)}`;
};

/**
 * Check each file reference of each document the package judges (E18, reading 103, "a document's
 * file references are the attributes its vocabularies define as the location of a file, and each
 * one that resolves within the package names a file the manifest describes; an xml:base is a
 * base"), in the order the manifest first names each document and then in document order.
 *
 * Each attribute {@link censusOf} names is read ({@link referencesIn}) and resolved through the
 * `xml:base` in scope ({@link basesOf}). One whose path is empty names its own document, and one
 * that resolves outside the package names an external file, so neither is looked for. One that
 * resolves to a path inside it that the package neither holds nor lists is `package-file-missing`
 * with `check: "reference"` at the attribute, its detail the referring `document`'s path, the
 * `attribute`, the `path` and the `reading`. A path the manifest lists that the package does not
 * hold is `package-file-missing` at its listing already (`checkFiles`), so it is not given again.
 * The `path` is bounded ({@link boundedPath}): one longer than 1,024 characters keeps its first 512
 * and its last 511 around a `…`.
 *
 * Each reference resolves against its base's directory, shared by reference ({@link basesOf}), and
 * is looked for in the folders of the files the package holds or lists ({@link foldersOf}) from its
 * directory's folder, which is found once for each directory ({@link directoryFacts}). So the work
 * grows with the references' own lengths and the bases' depths, not with their product.
 *
 * The text of each element {@link textCensusOf} names, a card's or card entry's `qti-file-href`
 * and a `qti-resource-icon`, is one reference too (R9-b, "Card files and resource icons are file
 * references"), read by its type's whitespace class ({@link readReference}) and resolved through
 * the base in scope for that element exactly as an attribute's. Its refusal is at the element, its
 * detail the `element` in place of the `attribute` and the information model's line as `source`
 * in place of the `reading`. A text holding an unexpanded entity reference is not read
 * ({@link simpleTextOf}).
 *
 * Only a written attribute is read: `qti-interaction-modules@primary-configuration`'s schema
 * default, `modules/module_resolution.js`, names no file a document wrote, and is not looked for
 * (rule `db2ef322`, a limit recorded here; no official package leaves it unwritten without the
 * file). A document the reader cannot read is its own verdict's.
 *
 * @param documents The package's documents.
 * @param held The paths of the files the package holds, in normal form.
 * @param listed The paths of the files the manifest lists.
 * @returns The refusals.
 */
const checkReferences = (
  documents: ReadonlyMap<string, Document>,
  held: ReadonlySet<string>,
  listed: ReadonlySet<string>,
): readonly Refusal[] => {
  const factsOf = directoryFacts(foldersOf([...held, ...listed]));

  return [...documents].flatMap(([path, { source, type }]) => {
    if (!judgedTypes.has(type) || Result.isFailure(source)) {
      return [];
    }

    const visits = [...walk(source.success)];
    const bases = basesOf(visits, path);

    return visits.flatMap(({ element, parent, path: at }) => {
      /**
       * Give the path a reference written on the element names when the package neither holds nor
       * lists it.
       *
       * @param written The reference, as read.
       * @returns The path, bounded ({@link boundedPath}); none for one that names its own
       *   document, an external file, or a file the package holds or lists.
       */
      const missing = (written: string): Option.Option<string> =>
        withoutQuery(written) === ""
          ? Option.none()
          : locate(bases.get(element) ?? Option.none(), written).pipe(
              Option.flatMap((resolved) => {
                const facts = factsOf(resolved.directory);

                return Option.exists(facts.folder, (folder) => folder.files.has(resolved.name))
                  ? Option.none()
                  : Option.some(boundedPath(resolved, facts));
              }),
            );

      return [
        ...censusOf(element).flatMap((reference) =>
          Option.toArray(attributeOf(element, reference.local)).flatMap((value) =>
            referencesIn(reference, value).flatMap((written) =>
              Option.toArray(missing(written)).map((named) =>
                refuse(
                  source.success.location,
                  "package-file-missing",
                  attributePath(at, { local: reference.local, namespace: "" }),
                  {
                    attribute: reference.local,
                    check: "reference",
                    document: path,
                    path: named,
                    reading: "103",
                  },
                ),
              ),
            ),
          ),
        ),
        ...Option.toArray(textCensusOf(element, parent)).flatMap(({ source: line, space }) =>
          Option.toArray(simpleTextOf(element)).flatMap((text) =>
            Option.toArray(missing(readReference(space, text))).map((named) =>
              refuse(source.success.location, "package-file-missing", at, {
                check: "reference",
                document: path,
                element: element.local,
                path: named,
                source: line,
              }),
            ),
          ),
        ),
      ];
    });
  });
};

/**
 * Give the verdict on a document of the package from its reading: the reader's refusal as a
 * refused verdict of kind `none`, or `check`'s verdict against the committed tables under the
 * package's QTI version, which `open` cannot know of a document alone.
 *
 * @param location The document's location.
 * @param source Its reading.
 * @param version The package's version, as its manifest states it.
 * @returns The verdict on it.
 */
const judge = (
  location: string,
  source: Result.Result<SourceDocument, Refusal>,
  version: CpVersion,
): Verdict =>
  Result.isFailure(source)
    ? { document: location, kind: "none", refusals: [source.failure], verdict: "refused" }
    : check(source.success, tables, Option.some(version));

/**
 * Give the document types the manifest's resources name each path under, each type once, in the
 * manifest's order: every path a resource of a document type names but the manifest's, which is no
 * resource's document (reading 146).
 *
 * @param manifest The manifest.
 * @returns The types, keyed by path, in the order the manifest first names each path.
 */
const namingTypes = (manifest: Manifest): ReadonlyMap<string, readonly string[]> => {
  const named = new Map<string, string[]>();
  for (const resource of manifest.resources) {
    for (const path of Option.toArray(documentPath(resource))) {
      if (documentTypes.has(resource.type) && path !== manifestFile) {
        const types = named.get(path) ?? [];
        named.set(path, types.includes(resource.type) ? types : [...types, resource.type]);
      }
    }
  }

  return named;
};

/**
 * Give the type the document at a path is read as, of the types its resources name it under
 * (reading 162, "a path two document types name is the document its root bears out"): the first, in
 * the manifest's order, whose root its root is ({@link documentTypes}), and the first of all where
 * none is, or where the reader cannot read it.
 *
 * @param types The types, in the manifest's order, at least one.
 * @param source The document's reading, none when the package holds no file there.
 * @returns The type.
 */
const readAs = (
  types: Arr.NonEmptyReadonlyArray<string>,
  source: Option.Option<Result.Result<SourceDocument, Refusal>>,
): string => {
  const root = Option.getOrUndefined(source.pipe(Option.flatMap(Result.getSuccess)))?.root;

  return (
    types.find((type) => root !== undefined && (documentTypes.get(type)?.(root) ?? false)) ??
    types[0]
  );
};

/**
 * Read each document the manifest's document resources name, once, as the type {@link readAs}
 * gives it, and judge each one read as a type plate judges, under the version the manifest states,
 * each judgement under its own `plate.check` span. The manifest is never read here (reading 146).
 *
 * @param manifest The manifest.
 * @param files The package's files, keyed by normal form.
 * @param location The package's location.
 * @returns Each document the package holds, keyed by path, in the order the manifest first names
 *   it.
 */
const readDocuments = Effect.fnUntraced(function* readDocuments(
  manifest: Manifest,
  files: ReadonlyMap<string, Uint8Array>,
  location: string,
): Effect.fn.Return<ReadonlyMap<string, Document>> {
  const documents = new Map<string, Document>();
  for (const [path, [first, ...others]] of namingTypes(manifest)) {
    const bytes = files.get(path);
    if (bytes !== undefined && first !== undefined) {
      const documentLocation = fileLocation(location, path);
      const source = yield* Effect.result(readSource(documentLocation, bytes));
      const type = readAs([first, ...others], Option.some(source));
      documents.set(path, {
        source,
        type,
        verdict: judgedTypes.has(type)
          ? Option.some(
              yield* judgedInSpan(documentLocation, () =>
                judge(documentLocation, source, manifest.version),
              ),
            )
          : Option.none(),
      });
    }
  }

  return documents;
});

/**
 * Compare each document resource's declared type with its document (T-h; readings 89, 146 and
 * 162), in the manifest's order:
 *
 * - One whose `href` names `imsmanifest.xml` is `resource-type-mismatch` with `check:
 *   "manifest-document"`, the `path`, its `type` and `reading: "146"`: the manifest is the
 *   package's one document at that path, and no resource's.
 * - One whose path's document is read as another type ({@link readAs}) is `resource-type-mismatch`
 *   with `check: "path-type"`, the `path`, its `type` and `reading: "162"`: a path is one document,
 *   of one type. The type a missing document is read as is the first its resources name.
 * - One of a type `resourceRoots` pairs with a root, read as that type, whose document the package
 *   holds and the reader read, is `resource-type-mismatch` when the document's root is another: the
 *   detail names the declared `type`, the document's `path`, the `root` found and, when exactly one
 *   type names that root, that type as `expected`. So a path two types name breaks it only where
 *   its root bears out neither.
 * - A fragment, LOM metadata or usage-data document, read for its root alone, whose root is in a
 *   namespace of QTI 2 is `not-qti-root` at that document, given once for it, its detail the root's
 *   `element` and `namespace`, as `check` gives one, and `reading: "89"`. Plate reads nothing else
 *   of those documents.
 *
 * A document the reader cannot read has no root to compare: a judged document's own verdict refuses
 * it, and one of the other types is passed over, as plate does not judge those documents.
 *
 * @param manifest The manifest.
 * @param documents The package's documents.
 * @param manifestLocation The manifest's location, which each refusal of a resource carries.
 * @returns The refusals, in the manifest's order.
 */
const checkRoots = (
  manifest: Manifest,
  documents: ReadonlyMap<string, Document>,
  manifestLocation: string,
): readonly Refusal[] => {
  const named = namingTypes(manifest);
  const rooted = new Set<string>();

  return manifest.resources.flatMap((resource): readonly Refusal[] => {
    const path = Option.getOrUndefined(documentPath(resource));
    if (path === undefined || !documentTypes.has(resource.type)) {
      return [];
    }

    if (path === manifestFile) {
      return [
        refuse(manifestLocation, "resource-type-mismatch", resource.location, {
          check: "manifest-document",
          path,
          reading: "146",
          type: resource.type,
        }),
      ];
    }

    const document = documents.get(path);
    const [first = resource.type, ...others] = named.get(path) ?? [];
    if ((document?.type ?? readAs([first, ...others], Option.none())) !== resource.type) {
      return [
        refuse(manifestLocation, "resource-type-mismatch", resource.location, {
          check: "path-type",
          path,
          reading: "162",
          type: resource.type,
        }),
      ];
    }

    const source = document?.source;
    if (source === undefined || Result.isFailure(source)) {
      return [];
    }

    const { location: documentLocation, root } = source.success;
    const expected = rootOfType.get(resource.type);
    if (expected === undefined) {
      if (rooted.has(path) || !qti2Namespaces.has(root.namespace)) {
        return [];
      }

      rooted.add(path);

      return [
        refuse(documentLocation, "not-qti-root", `{${root.namespace}}${root.local}`, {
          element: root.local,
          namespace: root.namespace,
          reading: "89",
        }),
      ];
    }

    if (root.namespace === qtiNamespace && root.local === expected) {
      return [];
    }

    const found = rootName(root);
    const facts = { path, root: found, type: resource.type };
    const [only, ...more] = resourceRoots
      .filter(([, rootNamed]) => rootNamed === found)
      .map(([type]) => type);

    return [
      refuse(
        manifestLocation,
        "resource-type-mismatch",
        resource.location,
        only === undefined || more.length > 0 ? facts : { expected: only, ...facts },
      ),
    ];
  });
};

/**
 * The reading the identifier and title rules cite: reading 62, "an item's or test's identifier and
 * title are those its package's LOM metadata gives it", or, for a root that writes no `identifier`
 * or `title` beside a record that gives one, reading 148, "an assessment item or test that writes
 * no `identifier` or no `title` has none for its LOM record to match".
 */
const lomReading = { unwritten: "148", written: "62" } as const;

/**
 * The XML line-break and tab characters, each of which an `xs:normalizedString` reads as a space.
 */
const normalizedBreak = /[\t\n\r]/gu;

/**
 * Read a value as an `xs:normalizedString`, the value space of a title: each tab, line feed and
 * carriage return a space, and nothing else changed, so spaces stay as written (reading 62, "a
 * tab, line feed or carriage return on either side reads as a space and nothing else changes").
 *
 * @param value The value as written.
 * @returns The value, normalized.
 */
const normalizedString = (value: string): string => value.replaceAll(normalizedBreak, " ");

/**
 * An ASCII capital letter, the one kind of character a language tag's comparison folds.
 */
const asciiCapital = /[A-Z]/gu;

/**
 * Fold a language tag's ASCII capitals to small letters, as tags are compared: RFC 5646 says
 * "language tags and their subtags ... are to be treated as case insensitive" (section 2.1.1). No
 * other character changes, so a tag padded with spaces stays padded and matches no tag.
 *
 * @param tag The tag.
 * @returns The tag, folded.
 */
const foldedTag = (tag: string): string =>
  tag.replaceAll(asciiCapital, (capital) => capital.toLowerCase());

/**
 * Give the `xml:lang` an element writes, as written.
 *
 * @param element The element.
 * @returns The attribute's value, none when the element writes none.
 */
const xmlLangOf = (element: SourceElement): Option.Option<string> =>
  Option.fromUndefinedOr(
    element.attributes.find(
      (attribute) => attribute.namespace === xmlNamespace && attribute.local === "lang",
    )?.value,
  );

/**
 * Give the language a document's root states for its title: its `xml:lang` collapsed, as an
 * `xs:language` is, when that is a well-formed BCP 47 tag, and none otherwise.
 *
 * A root that writes no `xml:lang` states none, and so does one whose form lies outside its value
 * domain, the empty form, one of whitespace alone and an ill-formed tag such as `en_GB` alike
 * (reading 151, "an item's `xml:lang` outside its value domain states no language, so `lom-title`
 * judges the record's title without one"). AL1 refuses such a form under its own rule.
 *
 * @param root The document's root.
 * @returns The language, collapsed and as written otherwise, none when the root states none.
 */
const titleLanguage = (root: SourceElement): Option.Option<string> =>
  xmlLangOf(root).pipe(Option.map(collapseXmlSpace), Option.filter(isLanguageTag));

/**
 * Report whether a LOM title string is one in its document's language: reading 62 reads it as "a
 * string whose `language` is the root's `xml:lang`, compared as a language tag without regard to
 * case, or a string with no `language`; and any string where the root states no `xml:lang`". An
 * empty `language` states none, as an empty `xml:lang` does (XML 1.0, section 2.12).
 *
 * @param language The string's `language`, as written, none when it writes none.
 * @param stated The language the root states ({@link titleLanguage}).
 * @returns Whether the string is in the document's language.
 */
const inDocumentLanguage = (
  language: Option.Option<string>,
  stated: Option.Option<string>,
): boolean =>
  Option.isNone(stated) ||
  Option.match(language, {
    onNone: () => true,
    onSome: (written) => written === "" || foldedTag(written) === foldedTag(stated.value),
  });

/**
 * The element that holds a document's catalogs, by local name in QTI's namespace: dormant content
 * outside the body (section 5.28, "A container of content or resource references that is outside
 * the content body node"), whose languages {@link languageForms} does not read.
 */
const catalogInfoElements: ReadonlySet<string> = new Set(["qti-catalog-info"]);

/**
 * Give the languages a document's elements state, in document order: each `xml:lang` collapsed, as
 * an `xs:language` is, once for each language, compared as a tag ({@link foldedTag}), with the
 * first form that states it. None that collapses to nothing is given, since an empty `xml:lang`
 * states no language (XML 1.0, section 2.12) and one of whitespace alone is refused by AL1 before
 * reading 134 reads it.
 *
 * A `qti-catalog-info` and everything under it are passed over (R9-c, "R26 counts the metadata
 * binding's elements, and catalog content is not among them", which reading 134 is read with): a
 * catalog is dormant content outside the body, so the `xml:lang` of a `qti-card`, a
 * `qti-card-entry`, a `qti-html-content` and everything they hold asks for no listing.
 *
 * The forms are the document's own: an XInclude `include` is not performed, so a fragment it would
 * splice in is not read, and its `xml:lang` forms ask for no listing. A document holding one is
 * `unchecked` (E23), and this is the limit that leaves.
 *
 * The walk keeps its own stack, as {@link walk} does, so a deeply nested document cannot exhaust
 * the call stack.
 *
 * @param source The document.
 * @returns The forms, collapsed.
 */
const languageForms = (source: SourceDocument): readonly string[] => {
  const forms = new Map<string, string>();
  const pending: SourceElement[] = [source.root];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    if (isQti(element, catalogInfoElements)) {
      continue;
    }

    const form = Option.getOrElse(Option.map(xmlLangOf(element), collapseXmlSpace), () => "");
    if (form !== "" && !forms.has(foldedTag(form))) {
      forms.set(foldedTag(form), form);
    }

    for (const child of element.children.toReversed()) {
      if (child.kind === "element") {
        pending.push(child);
      }
    }
  }

  return [...forms.values()];
};

/**
 * What an item's or test's document gives the LOM records that describe it: the languages its
 * elements state ({@link languageForms}), and its root's `identifier` and `title`, as written, and
 * the language its root states for that title ({@link titleLanguage}).
 */
interface Described {
  readonly forms: readonly string[];
  readonly identifier: Option.Option<string>;
  readonly stated: Option.Option<string>;
  readonly title: Option.Option<string>;
}

/**
 * Compare each item and test resource's own LOM metadata with its document (reading 62, "an item's
 * or test's identifier and title are those its package's LOM metadata gives it", with readings 134
 * and 148), every item and test resource that names a path, whatever type its document is read as
 * (reading 162, "the records of each item or test resource that names the path still describe the
 * document").
 *
 * Each `general` of the resource's LOM is judged three ways, in this order:
 *
 * - One that gives identifier entries must give one equal to the document's `identifier`, both
 *   collapsed, as an identifier's value is, or the resource is `lom-identifier` at the `general`'s
 *   first `identifier`;
 * - One that gives title strings must give one in the document's language
 *   ({@link inDocumentLanguage}) equal to its `title`, both read as an `xs:normalizedString`
 *   ({@link normalizedString}), so spaces stay and a tab or line break reads as a space, or it is
 *   `lom-title` at its first `title`;
 * - It must list, among its `language` elements, each language the document's elements state
 *   ({@link languageForms}), the `xml:lang` collapsed and the listed language as written, each
 *   folded ({@link foldedTag}), or it is `document-lang` at the `general` for each language it does
 *   not list (reading 134, "an item's or a test's languages are listed by its records' general
 *   categories, compared as language tags"), the detail naming the `document`'s path, the
 *   `language` and the languages it `listed`, space-separated, as written.
 *
 * A mismatch's detail names the `resource`, the document's `path`, its `identifier` or `title`, the
 * first LOM value as `metadata` (of a title, the first string in the document's language, or the
 * first string when none is), how many other values there are as `others` when there are any, the
 * language the root states as `language` when it states one (of a title), and the `reading`. Each
 * value is given collapsed, as an identifier's is, whichever way it is compared, so a refusal's
 * facts do not depend on the comparison; a title that differs from its string only in spacing so
 * shows the two alike, and the sentence's `xs:normalizedString` says why they differ.
 *
 * A root that writes no `identifier` or no `title` has none for a record to match, the empty one
 * included (reading 148, "an assessment item or test that writes no `identifier` or no `title` has
 * none for its LOM record to match"), so a `general` that gives entries or strings for it makes the
 * resource
 * `lom-identifier` or `lom-title` with `check: "unwritten"` at the document's root, its detail the
 * `attribute`, the `resource`, the document's `path` and the `reading`; the manifest's walk admits
 * one `lom` in a resource's `metadata` and one `general` in a `lom`, so each is given once. A
 * `general` that gives none is outside each rule, and so is a document the reader cannot read and
 * one whose root is no item's or test's ({@link lomBoundRoots}; `checkRoots` refuses a resource
 * whose type it does not bear out).
 *
 * What a `general` is compared with is read of a document once ({@link Described}), when the first
 * `general` of a resource naming it is judged, and kept by its path for every other resource that
 * names it; a resource with no `general` reads none. So a package of many resources naming one
 * large document walks that document's elements once and reads its root's attributes once, not once
 * for each resource, and its cost grows with the resources plus the elements and attributes rather
 * than with their product.
 *
 * @param manifest The manifest.
 * @param lom Each resource's LOM generals, keyed by its location.
 * @param documents The package's documents.
 * @param manifestLocation The manifest's location, which each refusal of a `general` carries.
 * @returns The refusals, in the manifest's order, each `general`'s identifier, then its title, then
 *   its languages.
 */
const checkLom = (
  manifest: Manifest,
  lom: ReadonlyMap<string, readonly LomGeneral[]>,
  documents: ReadonlyMap<string, Document>,
  manifestLocation: string,
): readonly Refusal[] => {
  const describedByPath = new Map<string, Described>();

  /**
   * Give what a document's LOM records are compared with ({@link Described}), read on the first
   * call for its path and kept for every later one.
   *
   * @param path The document's path, which keys what is kept.
   * @param document The document at that path.
   * @returns What it gives.
   */
  const describedAt = (path: string, document: SourceDocument): Described => {
    const kept = describedByPath.get(path);
    if (kept !== undefined) {
      return kept;
    }

    const { root } = document;
    const described: Described = {
      forms: languageForms(document),
      identifier: attributeOf(root, "identifier"),
      stated: titleLanguage(root),
      title: attributeOf(root, "title"),
    };
    describedByPath.set(path, described);

    return described;
  };

  return manifest.resources.flatMap((resource) => {
    const generals = lom.get(resource.location) ?? [];
    const path = Option.getOrUndefined(documentPath(resource));
    const source = path === undefined ? undefined : documents.get(path)?.source;
    if (
      generals.length === 0 ||
      !lomBoundTypes.has(resource.type) ||
      path === undefined ||
      source === undefined ||
      Result.isFailure(source)
    ) {
      return [];
    }

    const { root } = source.success;
    if (root.namespace !== qtiNamespace || !lomBoundRoots.has(root.local)) {
      return [];
    }

    const described = describedAt(path, source.success);
    const { stated } = described;

    /**
     * Refuse the values one LOM `general` gives for an attribute when none equals the document's.
     *
     * @param rule The rule a mismatch breaks.
     * @param attribute The document's attribute the values describe.
     * @param given The values the `general` gives, none when it gives none.
     * @param read How a value and the attribute are compared: collapsed or normalized.
     * @param candidates Which values may name the document, the title strings in its language.
     * @returns The refusal, or none when a value matches or the `general` gives none.
     */
    const compare = (
      rule: "lom-identifier" | "lom-title",
      attribute: "identifier" | "title",
      given: Option.Option<LomValues>,
      read: (value: string) => string,
      candidates: (values: LomValues) => readonly string[],
    ): readonly Refusal[] => {
      const values = Option.getOrUndefined(given);
      if (values === undefined) {
        return [];
      }

      const written = Option.getOrUndefined(described[attribute]);
      if (written === undefined) {
        return [
          refuse(source.success.location, rule, root.local, {
            attribute,
            check: "unwritten",
            path,
            reading: lomReading.unwritten,
            resource: resource.identifier,
          }),
        ];
      }

      const named = candidates(values);
      if (named.some((value) => read(value) === read(written))) {
        return [];
      }

      const stating = Option.match(attribute === "title" ? stated : Option.none<string>(), {
        onNone: () => ({}),
        onSome: (language) => ({ language }),
      });
      const facts = {
        ...stating,
        [attribute]: collapseXmlSpace(written),
        metadata: collapseXmlSpace(named[0] ?? values.values[0]),
        path,
        reading: lomReading.written,
        resource: resource.identifier,
      };
      const others = values.values.length - 1;

      return [
        refuse(
          manifestLocation,
          rule,
          values.location,
          others > 0 ? { ...facts, others: others.toString() } : facts,
        ),
      ];
    };

    return generals.flatMap((general) => {
      const listed = new Set(general.languages.map(foldedTag));

      return [
        ...compare(
          "lom-identifier",
          "identifier",
          general.identifier,
          collapseXmlSpace,
          (values) => [...values.values],
        ),
        ...compare("lom-title", "title", general.title, normalizedString, (values) =>
          values.values.filter((_, index) =>
            inDocumentLanguage(values.languages[index] ?? Option.none(), stated),
          ),
        ),
        ...described.forms
          .filter((form) => !listed.has(foldedTag(form)))
          .map((form) =>
            refuse(manifestLocation, "document-lang", general.location, {
              document: path,
              language: form,
              listed: general.languages.join(" "),
              reading: "134",
            }),
          ),
      ];
    });
  });
};

/**
 * What a reading of a dotted reference may name through an item ref, read from its item's
 * document.
 */
interface ItemVariables {
  /**
   * The variables the item declares, each identifier with its declaration: a response, an outcome,
   * a template or a context declaration. Of two that share an identifier the last is kept, as the
   * rules keep it (`declarationsOf`); the item's own verdict refuses the pair.
   */
  readonly declarations: ReadonlyMap<string, SourceElement>;
}

/**
 * What a reading of a dotted reference may name through a resolved item ref: its item's variables,
 * or none declared for an LTI link, whose reports the package declares nothing of
 * ({@link targetVariables}).
 */
interface TargetVariables extends ItemVariables {
  /**
   * Whether the item ref names an LTI link rather than an item: a name a reading reads through it
   * that no built-in gives is accepted unchecked (reading 106), and so are its variable mappings'
   * sources (reading 110), their targets judged only against one another and the session variables
   * (reading 97).
   */
  readonly link: boolean;
}

/**
 * Report whether an item declares a variable by a declaration of one kind.
 *
 * @param variables The item's variables.
 * @param identifier The variable's identifier.
 * @param local The declaration's local name, such as `qti-outcome-declaration`.
 * @returns Whether the item's declaration of that identifier is one of that kind.
 */
const declaresAs = (variables: ItemVariables, identifier: string, local: string): boolean =>
  variables.declarations.get(identifier)?.local === local;

/**
 * Read what a reading of a dotted reference may name through an item ref from its item's document:
 * the variables it declares. Its `time-dependent` is not read: an item's `duration` may be read
 * whether or not the item is time dependent (reading 150).
 *
 * @param document The item's document.
 * @returns Its variables, none when the document is unread or its root is not an item.
 */
const variablesOf = (document: Document | undefined): Option.Option<ItemVariables> => {
  if (document === undefined || Result.isFailure(document.source)) {
    return Option.none();
  }

  const source = document.source.success;
  const { root } = source;
  if (root.namespace !== qtiNamespace || root.local !== "qti-assessment-item") {
    return Option.none();
  }

  return Option.some({
    declarations: new Map(
      [...itemDeclarations.keys()].flatMap((local) => [...declarationsOf(source, local)]),
    ),
  });
};

/**
 * What a reading of a dotted reference may name through one resolved item ref: its item's
 * variables, whether it names an LTI link, and the targets of the item ref's variable mappings
 * whose source the item declares, as pantry's reach holds them (the relations `VariableLookup` and
 * `MappingLookup` in `packages/pantry/src/qti/expressions.ts`).
 */
interface ItemRefVariables extends TargetVariables {
  /**
   * Each mapping target, with the declaration of the source it reads.
   */
  readonly mapped: ReadonlyMap<string, SourceElement>;
}

/**
 * How a placement reads the placements of another document (reading 86, "a reference that names an
 * item ref or a section through such a document, or one of their variables, resolves once for each
 * placement"): from inside the one placement of it that holds the reading's placement, with whether
 * a selection with replacement lies above that one, or from outside it, reading every placement.
 */
type DocumentView =
  | { readonly from: "inside"; readonly replaced: boolean }
  | { readonly from: "outside" };

/**
 * Name a view in one letter, for {@link viewsKey}: `o` from outside, `i` from inside a placement
 * no selection with replacement lies above, `r` from inside one that one does.
 *
 * @param view The view.
 * @returns Its letter.
 */
const viewLetter = (view: DocumentView): string => {
  if (view.from === "outside") {
    return "o";
  }

  return view.replaced ? "r" : "i";
};

/**
 * Key the views some documents take from a placement, one list for each document, in the order
 * the documents are listed.
 *
 * @param views Each document's views.
 * @returns The key.
 */
const viewsKey = (views: readonly (readonly DocumentView[])[]): string =>
  JSON.stringify(views.map((list) => list.map((view) => viewLetter(view)).join("")));

/**
 * What a section document's dotted references and typed processing give from one placement of it
 * under a test (`judgeTest`): the references' refusals, and those of its expressions that only the
 * test's scope and typed reach give.
 */
interface SectionJudgement {
  readonly processing: readonly Refusal[];
  readonly references: readonly Refusal[];
}

/**
 * The judgements of a section document from its placements of one replacement that read the same
 * other documents, in the order first read, each judgement by the views those documents took from
 * the placement it was judged from ({@link viewsKey}).
 */
interface ViewedJudgements {
  readonly byViews: Map<string, SectionJudgement>;
  readonly read: readonly string[];
}

/**
 * What a test's dotted references resolve against, its reach, from where a reference stands: the
 * variables of each resolved item ref, the identifiers of the parts and sections of the test and of
 * each section document it places through its section refs, as if each section document were
 * inline, the test's own variables, and the placements a reading through each item ref, part or
 * section reads from there.
 */
interface ReferenceScope {
  readonly durations: ReadonlySet<string>;
  readonly items: ReadonlyMap<string, ItemRefVariables>;
  /**
   * The placements a reading through an item ref, part or section of the reach reads from where the
   * reference stands, each with whether a selection with replacement can repeat the item ref there:
   * the placement being judged, when the element is the reference's own document's; the one
   * placement of the element's document that holds it, read from inside ({@link DocumentView});
   * and otherwise every placement of the element's document, counted up to 2 for each answer
   * (reading 86, "a reference that names an item ref or a section through such a document, or one
   * of their variables, resolves once for each placement"). A numbered reading counts only through
   * a placement that can repeat its item ref (reading 88).
   */
  readonly placements: (identifier: string) => readonly boolean[];
  /**
   * The test's own variables by their whole identifier, each a declaration of the test or one of
   * its built-ins: what the unsplit reading of a reference reads (reading 48, "the unsplit reading
   * counts among them").
   */
  readonly whole: ReadonlyMap<string, ReadVariable>;
}

/**
 * The variable one resolving reading of a dotted reference reads, as pantry's relation `Reading`
 * gives it (`packages/pantry/src/qti/expressions.ts`).
 */
interface ReadVariable {
  /**
   * The declaration the reading names directly: a variable its item declares, or, for the unsplit
   * reading, one the test declares; none for a mapping target, a built-in and a name read through
   * an LTI link.
   */
  readonly declaration: Option.Option<SourceElement>;
  /**
   * The kind of variable it stands as (reading 111): a declared variable's its declaration's, a
   * mapping target's an outcome, as pantry reads one, a built-in's the kind QTI gives it, and a
   * name's read through an LTI link an outcome, as pantry reads a name that resolves to nothing it
   * holds.
   */
  readonly kind: VariableKind;
  /**
   * Its type: a mapping target's is its source's, a declared variable's its declaration's, a
   * built-in's its built-in type; unknown where the declaration's type is not judged, and for a
   * name read through an LTI link.
   */
  readonly type: ExpressionType;
  /**
   * Whether it is a name no built-in gives read through an item ref that names an LTI link, which
   * no kind or type rule judges: the package declares nothing a link reports, so such a reference
   * is accepted unchecked, a recorded limit (reading 106, "an item ref that names an LTI link has
   * no item whose declarations a prefix reads, so a prefixed reference through it is accepted
   * unchecked, a recorded limit"; reading 166, "a name read through an LTI link (reading 110)" is
   * accepted).
   */
  readonly unchecked: boolean;
}

/**
 * One reading of a dotted reference that resolves (reading 48, "a dotted reference is accepted when
 * exactly one reading names a real item ref, test part or section and its variable"): its form,
 * the item ref, part or section its prefix names, the rest, as written, and the variable it reads.
 * The `unsplit` reading reads the test's own variable of the whole reference, its prefix empty and
 * its rest the reference; a `split` reading splits at one dot; a `numbered` one reads an instance
 * of its item ref's item, its rest `N.VAR` (reading 88). A split or numbered reading reads one
 * placement of its prefix's element ({@link ReferenceScope}), so an element of a section document
 * placed twice gives it twice.
 */
interface Reading {
  readonly form: "numbered" | "split" | "unsplit";
  readonly prefix: string;
  /**
   * Whether a selection with replacement can repeat its item ref in the placement it reads, through
   * which alone a numbered reading counts (reading 88); false for any other reading.
   */
  readonly repeatable: boolean;
  readonly rest: string;
  readonly variable: ReadVariable;
}

/**
 * Give the kind of variable a declaration declares, by its local name ({@link itemDeclarations}).
 * Every declaration this module reads, an item's four and a test's two, has one; anything else
 * would read as an outcome.
 *
 * @param declaration The declaration.
 * @returns Its kind.
 */
const kindOf = (declaration: SourceElement): VariableKind =>
  itemDeclarations.get(declaration.local) ?? "outcome";

/**
 * Give the variable a built-in reads as.
 *
 * @param builtIn The built-in.
 * @returns The variable, which no declaration names.
 */
const builtInVariable = ({ kind, type }: BuiltIn): ReadVariable => ({
  declaration: Option.none(),
  kind,
  type,
  unchecked: false,
});

/**
 * The variable a name no built-in gives reads through an item ref that names an LTI link, accepted
 * unchecked (reading 106, "an item ref that names an LTI link has no item whose declarations a
 * prefix reads, so a prefixed reference through it is accepted unchecked, a recorded limit"): no
 * declaration, an outcome, as pantry reads a name that resolves to nothing it holds (the relation
 * `Reading` in `packages/pantry/src/qti/expressions.ts`), and of unknown type, which satisfies
 * every type rule. No kind rule judges it ({@link judgeReference}).
 */
const linkVariable: ReadVariable = {
  declaration: Option.none(),
  kind: "outcome",
  type: unknownType,
  unchecked: true,
};

/**
 * Give the type a declaration declares, unknown when it is not judged (the item's own verdict's
 * refusal).
 *
 * @param declaration The declaration.
 * @returns Its type.
 */
const declaredType = (declaration: SourceElement): ExpressionType =>
  Option.getOrElse(declarationType(declaration), () => unknownType);

/**
 * Resolve the variable one split or numbered reading of a dotted reference names (reading 48, "a
 * dotted reference is accepted when exactly one reading names a real item ref, test part or section
 * and its variable"), in pantry's order (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`, its source mapped, declared or built in).
 *
 * After an item ref, the rest names, directly or in the numbered form `N.VAR`
 * ({@link occurrenceOf}), a target of the item ref's variable mappings, else a variable its item
 * declares, else one of the built-ins every item has, `QTI_CONTEXT` among them (reading 106, "a
 * prefixed reference reaches every built-in variable its item ref's item holds, `QTI_CONTEXT`
 * among them"), else, through an item ref that names an LTI link, whatever the rest names, as
 * {@link linkVariable} (reading 106, "an item ref that names an LTI link has no item whose
 * declarations a prefix reads, so a prefixed reference through it is accepted unchecked, a recorded
 * limit"); its numbered form counts as a numbered reading through an item does (reading 88). After
 * a part or a section, the rest is its `duration`, a built-in.
 *
 * @param scope What the test's references resolve against.
 * @param prefix The part before the dot the reading splits at.
 * @param rest The part after it.
 * @returns The reading's form and the variable it reads, none when it does not resolve.
 */
const variableOf = (
  scope: ReferenceScope,
  prefix: string,
  rest: string,
): Option.Option<readonly [form: Reading["form"], variable: ReadVariable]> => {
  const item = scope.items.get(prefix);
  if (item === undefined) {
    return scope.durations.has(prefix) && rest === "duration"
      ? Option.some(["split", builtInVariable(scopeDuration)])
      : Option.none();
  }

  const { variable } = occurrenceOf(rest);
  const form = variable === rest ? "split" : "numbered";
  const source = item.mapped.get(variable);
  if (source !== undefined) {
    return Option.some([
      form,
      { declaration: Option.none(), kind: "outcome", type: declaredType(source), unchecked: false },
    ]);
  }

  const declaration = item.declarations.get(variable);
  if (declaration !== undefined) {
    return Option.some([
      form,
      {
        declaration: Option.some(declaration),
        kind: kindOf(declaration),
        type: declaredType(declaration),
        unchecked: false,
      },
    ]);
  }

  const builtIn = itemBuiltIns.get(variable);
  if (builtIn !== undefined) {
    return Option.some([form, builtInVariable(builtIn)]);
  }

  return item.link ? Option.some([form, linkVariable]) : Option.none();
};

/**
 * Give every reading of a reference that resolves, whether or not it counts: the unsplit reading,
 * when the test declares or holds the whole reference, then, for each dot the reference may split
 * at, from the first dot, one for each placement of the element its prefix names that the reference
 * reads from where it stands ({@link ReferenceScope}). A numbered reading resolves here whether or
 * not a selection with replacement can repeat its item ref in its placement; {@link isCounted}
 * decides whether it counts.
 *
 * @param scope What the test's references resolve against.
 * @param reference The reference.
 * @returns Each resolving reading.
 */
const resolvingReadings = (scope: ReferenceScope, reference: string): readonly Reading[] => {
  const readings: Reading[] = Option.toArray(
    Option.map(Option.fromUndefinedOr(scope.whole.get(reference)), (variable): Reading => ({
      form: "unsplit",
      prefix: "",
      repeatable: false,
      rest: reference,
      variable,
    })),
  );
  for (let dot = reference.indexOf("."); dot !== -1; dot = reference.indexOf(".", dot + 1)) {
    const prefix = reference.slice(0, dot);
    const rest = reference.slice(dot + 1);
    for (const [form, variable] of Option.toArray(variableOf(scope, prefix, rest))) {
      readings.push(
        ...scope
          .placements(prefix)
          .map((repeatable): Reading => ({ form, prefix, repeatable, rest, variable })),
      );
    }
  }

  return readings;
};

/**
 * Report whether a resolving reading counts under reading 48 ("a dotted reference is accepted when
 * exactly one reading names a real item ref, test part or section and its variable"): every one
 * but a numbered reading whose item ref no selection with replacement can repeat in the placement
 * it reads (reading 88, "a numbered reference such as `Q01.2.SCORE` names an instance of an item
 * ref that a selection with replacement can repeat, and nothing else").
 *
 * @param reading The reading.
 * @returns Whether it counts.
 */
const isCounted = (reading: Reading): boolean => reading.form !== "numbered" || reading.repeatable;

/**
 * Count the readings of one form through some placements that count ({@link isCounted}).
 *
 * @param form The readings' form.
 * @param placed Whether a selection with replacement can repeat the item ref in each placement.
 * @returns How many count.
 */
const countedOf = (form: Reading["form"], placed: readonly boolean[]): number =>
  placed.filter((repeatable) => form !== "numbered" || repeatable).length;

/**
 * Give every reading of a reference that resolves and counts ({@link isCounted}): the unsplit
 * reading, then those for each dot it may split at, from the first dot.
 *
 * @param scope What the test's references resolve against.
 * @param reference The reference.
 * @returns Each resolving reading that counts.
 */
const readingsOf = (scope: ReferenceScope, reference: string): readonly Reading[] =>
  resolvingReadings(scope, reference).filter((reading) => isCounted(reading));

/**
 * Give the type of the variable a `qti-test-variables` reads by a name through one item ref, as
 * the engine resolves it (`itemName` in `#plate/engine/scope.ts`): a target of the item ref's
 * variable mappings names its source's declaration, else the item's own declaration of the name,
 * else one of the built-ins every item has. An item's context variable, declared or the built-in
 * `QTI_CONTEXT`, is passed over, since the engine holds none and so never collects one.
 *
 * @param item What the name may name through the item ref.
 * @param name The `variable-identifier`.
 * @returns The variable's type, unknown where its declaration is not judged; none when the name
 *   names nothing of the item.
 */
const collectedDeclaration = (
  item: ItemRefVariables,
  name: string,
): Option.Option<ExpressionType> => {
  const source = item.mapped.get(name);
  if (source !== undefined) {
    return Option.some(declaredType(source));
  }

  const declaration = item.declarations.get(name);

  return declaration === undefined || declaresAs(item, name, "qti-context-declaration")
    ? Option.fromUndefinedOr(itemBuiltIns.get(name)).pipe(
        Option.filter(({ kind }) => kind !== "context"),
        Option.map(({ type }) => type),
      )
    : Option.some(declaredType(declaration));
};

/**
 * Give the base type an unweighted `qti-test-variables` with no `base-type` collects of a variable,
 * from its declarations in every item of the test's reach, whatever the kind's filters (G-R3 199):
 * `float` when one of them declares it a single float, else `integer`, none declaring it included,
 * as the engine decides it (`collectedBaseType` in `#plate/engine/expressions/test.ts`). A
 * declaration of another base type, or of another cardinality, is not matched. A declaration whose
 * type is not judged, the item's own verdict's refusal, makes it `unknown`.
 *
 * @param items What a name may name through each resolved item ref.
 * @param name The `variable-identifier`.
 * @returns The base type.
 */
const collectedBaseType = (
  items: ReadonlyMap<string, ItemRefVariables>,
  name: string,
): ReturnType<CollectedTyper> => {
  const matched = [...items.values()]
    .flatMap((item) => Option.toArray(collectedDeclaration(item, name)))
    .filter(({ cardinality }) => cardinality === "single" || cardinality === "unknown");
  if (
    matched.some(({ baseType, cardinality }) => baseType === "unknown" || cardinality === "unknown")
  ) {
    return "unknown";
  }

  return matched.some(({ baseType }) => baseType === "float") ? "float" : "integer";
};

/**
 * Give the variable mappings an item ref holds, each its `source-identifier` and its
 * `target-identifier`, in document order. One that lacks either names nothing here, and is its
 * test's own verdict's refusal.
 *
 * @param itemRef The item ref.
 * @returns Each mapping's source and target.
 */
const mappingsOf = (
  itemRef: SourceElement,
): readonly (readonly [source: string, target: string])[] =>
  itemRef.children.flatMap((child) =>
    child.kind === "element" && isQti(child, mappingElements)
      ? Option.toArray(
          Option.all([
            attributeOf(child, "source-identifier"),
            attributeOf(child, "target-identifier"),
          ]).pipe(Option.map(([from, to]) => [trimXmlSpace(from), trimXmlSpace(to)] as const)),
        )
      : [],
  );

/**
 * One attribute of an element of a test that names a variable, with the name.
 */
interface NamedReference {
  readonly attribute: SourceAttribute;
  /**
   * The base type a reference attribute's facet entry names, which the variable must have (P24);
   * none for an `identifier`, which names a variable of any type.
   */
  readonly baseType: Option.Option<ReferenceEntry["baseType"]>;
  readonly identifier: string;
}

/**
 * Give each variable an element of a test names, in the element's attribute order: the `identifier`
 * of a `qti-variable`, `qti-correct`, `qti-default`, `qti-map-response` or `qti-map-response-point`
 * ({@link referenceElements}), the `identifier` a `qti-set-outcome-value` or
 * `qti-lookup-outcome-value` sets ({@link targetElements}), and each value of a reference attribute
 * its expression kind's reference facet checks, as pantry derives them from the XSD's unions with
 * an NCName member (`referenceMembers` in `packages/pantry/src/grammar/references.ts`: `figures`,
 * `max`, `min`, `n`, `number-repeats`, `pattern` and `step`), with the base type its entry names.
 *
 * A literal names no variable, and a `pattern` names one only as a braced name of a variable the
 * test holds (ruling R1). A name that is no NCName is the structure check's refusal, so it is
 * passed over.
 *
 * @param element The element.
 * @param held Whether the test holds a variable by a name: declares it whole, holds it as a
 *   built-in, or resolves it by a reading.
 * @returns The variables it names.
 */
const referencesOf = (
  element: SourceElement,
  held: (name: string) => boolean,
): readonly NamedReference[] => {
  if (element.namespace !== qtiNamespace) {
    return [];
  }

  const kind = kindsByElement.get(element.local);
  const entries = kind === undefined ? [] : kindRules[kind].references;

  return element.attributes.flatMap((attribute) => {
    if (attribute.namespace !== "") {
      return [];
    }

    if (
      attribute.local === "identifier" &&
      (referenceElements.has(element.local) || targetElements.has(element.local))
    ) {
      const identifier = trimXmlSpace(attribute.value);

      return isNcName(identifier) ? [{ attribute, baseType: Option.none(), identifier }] : [];
    }

    const entry = entries.find((one) => one.checked && one.attribute === attribute.local);
    if (entry === undefined) {
      return [];
    }

    const values = entry.list
      ? attribute.value.split(xmlWhitespaceRun).filter((token) => token !== "")
      : [attribute.value];

    return values.flatMap((value) => {
      const classified = classifiers[entry.baseType](
        value,
        new Set([value.slice(1, -1)].filter(held)),
      );

      return classified._tag === "ref" && isNcName(classified.identifier)
        ? [{ attribute, baseType: Option.some(entry.baseType), identifier: classified.identifier }]
        : [];
    });
  });
};

/**
 * Judge one dotted reference of a test by reading 48 ("a dotted reference is accepted when exactly
 * one reading names a real item ref, test part or section and its variable"), as the qti package
 * judges a test-level reference over its readings (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`, judged by its `Prefixed_reference` and
 * `Variable_declared` laws, refused `prefixed-ref`).
 *
 * The readings that count are the unsplit reading, the test's own variable of the whole reference,
 * declared or built in (reading 48, "the unsplit reading counts among them"), each split reading,
 * and each numbered reading whose item ref a selection with replacement can repeat in its placement
 * (reading 88, {@link isCounted}), a split or numbered one once for each placement it reads
 * ({@link ReferenceScope}). A rule's target ({@link targetElements}) is judged by its unsplit
 * reading alone (reading 112, "a test's setter sets a variable of its own document, so a prefixed
 * reading never resolves it"): one the test does not hold whole is `undeclared-variable` with
 * `check: "setter"`, the `reference` and the `reading`, whatever its split readings resolve, and
 * what one the test holds sets is the rules' to judge. Of any other reference:
 *
 * - One no reading counts for is `undeclared-variable` with `check: "numbered"`, the `reference`, the
 *   `itemRef` of its first numbered reading and the `reading`, when a numbered reading would
 *   resolve it were its item ref repeatable, and otherwise with `check: "reading"` and the
 *   `reading`, pantry's `prefixed-ref` with no reading.
 * - One two readings count for is `ambiguous-reference`, its detail the `reference` and its first two
 *   counting readings, prefix and variable each, the unsplit reading's prefix empty, pantry's
 *   `prefixed-ref` with its readings, and the `reading` that settles it: 86 where the two are one
 *   reading through two placements of a section document, read from outside it (reading 86, "a
 *   section document a test places twice is written once"), and 48 otherwise.
 * - One whose one counting reading is the unsplit one names the test's own variable, which the rules
 *   judge (`#plate/validate/rules.ts`), so it earns nothing here.
 * - One whose one counting reading reads, through an item ref that names an LTI link, a name no
 *   built-in gives ({@link linkVariable}) is accepted unchecked, a recorded limit (reading 106, "an
 *   item ref that names an LTI link has no item whose declarations a prefix reads, so a prefixed
 *   reference through it is accepted unchecked, a recorded limit"), so it earns nothing here
 *   either: the package declares nothing a link reports to judge it against.
 *
 * An expression's reference whose one reading reads the built-in `duration` of an item is never
 * refused for the item's `time-dependent` (reading 150, "an item's built-in `duration` may be read
 * whether or not the item is time dependent"). Each refusal is at the attribute; an
 * `undeclared-variable` names the `element`, the `identifier` as written and, for an attribute
 * other than `identifier`, the `attribute`.
 *
 * An expression's reference whose one counting reading is split or numbered is judged by the kind
 * of variable it reads (reading 111, "a processing element's `identifier` names a variable of the
 * kind the element reads or sets"), a built-in by the kind it stands as, at the element, as the
 * rules judge a name the test declares:
 *
 * - In a reference attribute, a variable that is not a template or outcome variable (a response, a
 *   context variable, or a built-in response or context variable) is `expression-type` with `check:
 *   "reference"`, its detail the rules' P24 detail, as pantry's `Reference_type` law judges a
 *   resolved reading. One of another type is the rules' own P24, which they judge through the typed
 *   reach.
 * - In a `qti-correct`, a variable that is not a response (an outcome, a template or context
 *   variable, a mapping target, which reads an outcome, or the built-in `completionStatus` or
 *   `QTI_CONTEXT`) is `undeclared-variable` at the attribute with `expected: "response"`, the
 *   detail the rules give an item's expression of a name that is no response, with the `prefix` the
 *   reading reads through: a `qti-correct` "looks up the declaration of a response variable"
 *   (`info.txt:9302`). An item's `numAttempts` and `duration`, and a part's or a section's
 *   `duration`, are responses, so a `qti-correct` of one is accepted.
 * - In a `qti-map-response` or `qti-map-response-point`, a variable that is not a response its item
 *   declares, a built-in response included, since no declaration gives it a mapping, is
 *   `undeclared-variable` likewise: each mapping "looks up the value of a response variable"
 *   (`:9306`, `:9314`) and "transforms it using the associated mapping, which must have been
 *   declared" (`:9306`). The `prefix` is what tells the wording a read through an item ref, part or
 *   section from a dotted name a document declares whole, which the rules refuse with no `prefix`.
 *   Main and pantry refuse it too (reading 166, "A test's prefixed `qti-map-response` names a
 *   response variable whose declaration holds a `qti-mapping`, and a test's prefixed `qti-correct`
 *   names a response variable"; pantry's `Variable kind` and `Mapped response` laws,
 *   `packages/pantry/src/qti/expressions.ts`).
 * - In a `qti-map-response` or `qti-map-response-point`, a response its item declares without the
 *   mapping or the area mapping the expression needs is `template-requirements`, as an item's
 *   inline expression is, the `identifier` as written, with the `prefix` the reading reads through:
 *   the information model's "transforms it using the associated mapping, which must have been
 *   declared" (`info.txt:9306`). The `prefix` is what tells the wording that the response is one
 *   the item that item ref names declares, to be given its mapping there, and not a dotted name to
 *   declare. Main and pantry refuse it too (reading 166, "A test's prefixed `qti-map-response`
 *   names a response variable whose declaration holds a `qti-mapping`"; pantry's `Mapped response`
 *   law, `packages/pantry/src/qti/expressions.ts`).
 *
 * @param document The test's location.
 * @param visit The element's visit.
 * @param reference The attribute and the name it holds.
 * @param scope What the test's references resolve against.
 * @returns The refusals, none when exactly one reading counts for it and what that one reads may be
 *   read there.
 */
const judgeReference = (
  document: string,
  visit: Visit,
  reference: NamedReference,
  scope: ReferenceScope,
): readonly Refusal[] => {
  const { attribute, identifier } = reference;
  const path = attributePath(visit.path, attribute);
  const element = visit.element.local;
  const byIdentifier = attribute.local === "identifier";
  const named = byIdentifier
    ? { element, identifier }
    : { attribute: attribute.local, element, identifier };
  if (byIdentifier && isQti(visit.element, targetElements)) {
    return scope.whole.has(identifier)
      ? []
      : [
          refuse(document, "undeclared-variable", path, {
            ...named,
            check: "setter",
            reading: "112",
            reference: identifier,
          }),
        ];
  }

  const resolving = resolvingReadings(scope, identifier);
  const [first, second] = resolving.filter((reading) => isCounted(reading));
  if (first === undefined) {
    const numbered = resolving.find((reading) => reading.form === "numbered");

    return [
      numbered === undefined
        ? refuse(document, "undeclared-variable", path, {
            ...named,
            check: "reading",
            reading: "48",
          })
        : refuse(document, "undeclared-variable", path, {
            ...named,
            check: "numbered",
            itemRef: numbered.prefix,
            reading: "88",
            reference: identifier,
          }),
    ];
  }

  if (second !== undefined) {
    return [
      refuse(document, "ambiguous-reference", path, {
        firstPrefix: first.prefix,
        firstVariable: first.rest,
        reading: first.prefix === second.prefix && first.rest === second.rest ? "86" : "48",
        reference: identifier,
        secondPrefix: second.prefix,
        secondVariable: second.rest,
      }),
    ];
  }

  if (first.form === "unsplit" || first.variable.unchecked) {
    return [];
  }

  const { variable } = first;
  const isMapping = byIdentifier && isQti(visit.element, mappingExpressions);
  const response = variable.kind === "response";
  const readsResponse = isMapping ? response && Option.isSome(variable.declaration) : response;

  return [
    ...(byIdentifier && isQti(visit.element, responseExpressions) && !readsResponse
      ? [
          refuse(document, "undeclared-variable", path, {
            ...named,
            expected: "response",
            prefix: first.prefix,
          }),
        ]
      : []),
    ...(namableKinds.has(variable.kind)
      ? []
      : reference.baseType.pipe(
          Option.map((expectedBaseType) =>
            refuse(document, "expression-type", visit.path, {
              attribute: attribute.local,
              check: "reference",
              element,
              expectedBaseType,
              identifier,
            }),
          ),
          Option.toArray,
        )),
    ...variable.declaration.pipe(
      Option.filter(() => isMapping && response),
      Option.flatMap((declaration) => mappingRequirement(element, identifier, declaration)),
      Option.map((detail) =>
        refuse(document, "template-requirements", visit.path, { ...detail, prefix: first.prefix }),
      ),
      Option.toArray,
    ),
  ];
};

/**
 * Judge the variable mappings of the item refs of a test or of a section document a test reaches,
 * as pantry judges a `VariableMapping` (the `Variable mapping target` and `Variable mapping source`
 * laws in `packages/pantry/src/qti/tests.ts` and `packages/pantry/src/qti/expressions.ts`), each in
 * document order.
 *
 * A mapping's `source-identifier` that names no outcome variable the item ref's item declares, a
 * name it does not declare or one it declares as another kind of variable, is
 * `undeclared-variable` at that attribute, its detail the `element`, the `attribute`, the
 * `identifier` and `expected: "outcome"`, pantry's `variable-mapping-source`. It is judged only
 * through an item ref whose item the package holds and the reader read, as pantry contains a
 * mapping's source in the declarations of the item its item ref resolves to. A second mapping of
 * one item ref with the same `target-identifier` is `duplicate-identifier` at that attribute, its
 * detail the `identifier`, the key of a mapping by its item ref and its target. So is a target that
 * names another variable its item holds (reading 97, "a variable mapping's target names no other
 * variable its item ref's item holds"): one the item declares, other than the mapping's own source,
 * or one of the built-ins every item has, `QTI_CONTEXT` among them, its detail the `identifier` and
 * `reading: "97"`, judged only through an item ref whose item the reader read or that names an LTI
 * link (below); both are pantry's `Variable_mapping_target`. A target that is its own source maps
 * nothing away, and is accepted. A value that is no NCName is the structure check's refusal, so it
 * is passed over.
 *
 * Under an item ref that names an LTI link a mapping's target is judged too, as pantry's `Variable
 * mapping target` law (`packages/pantry/src/qti/tests.ts`) keys every `VariableMapping` by its item
 * ref and its target and holds the target outside the session variables, a link's mapping included:
 * a second mapping of that item ref with the same target is `duplicate-identifier`, its detail the
 * `identifier`, and a target that names a built-in session variable ({@link sessionVariables}),
 * `completionStatus`, `numAttempts` or `duration`, is `duplicate-identifier` with `reading: "97"`
 * (reading 97, "one another mapping of the same item ref names; or a built-in session variable.
 * Each is refused"), unless it is the mapping's own source, as under an item. Its source stays
 * unchecked, and so does a target that names `QTI_CONTEXT` or any other variable the link may
 * report (reading 110, "a mapping's source under such an item ref names a variable nothing in the
 * package lists"): the package declares nothing a link reports, so there is no declaration to check
 * a source against and no item variable a target could take the name of. A source that listed the
 * outcomes a link reports would lift the limit; only pantry's `Variable mapping source` law exempts
 * a link.
 *
 * @param document The document's location.
 * @param visits The visits of the document's elements, in document order.
 * @param variablesFor The variables of the item an item ref resolves to, or that it names an LTI
 *   link, none when it resolves to no item the reader read.
 * @returns The refusals, in document order.
 */
const judgeMappings = (
  document: string,
  visits: readonly Visit[],
  variablesFor: (itemRef: SourceElement) => Option.Option<TargetVariables>,
): readonly Refusal[] => {
  const targets = new Map<SourceElement, Set<string>>();
  const refusals: Refusal[] = [];
  for (const { element, parent, path } of visits) {
    const itemRef = parent.pipe(
      Option.filter((one) => isQti(one, itemRefElements)),
      Option.getOrUndefined,
    );
    if (itemRef !== undefined && isQti(element, mappingElements)) {
      const variables = variablesFor(itemRef);
      const linked = Option.exists(variables, ({ link }) => link);
      /**
       * Give the variable an attribute of the mapping names.
       *
       * @param local The attribute's local name.
       * @returns Its value with its outer XML whitespace removed, none when the mapping has no
       *   such attribute or its value is no NCName.
       */
      const named = (local: string): Option.Option<string> =>
        attributeOf(element, local).pipe(Option.map(trimXmlSpace), Option.filter(isNcName));
      /**
       * Give the path of an attribute of the mapping, where a refusal of it is located.
       *
       * @param local The attribute's local name.
       * @returns Its path.
       */
      const at = (local: string): string => attributePath(path, { local, namespace: "" });
      for (const source of Option.toArray(named("source-identifier"))) {
        if (
          !linked &&
          Option.exists(
            variables,
            (declared) => !declaresAs(declared, source, "qti-outcome-declaration"),
          )
        ) {
          refusals.push(
            refuse(document, "undeclared-variable", at("source-identifier"), {
              attribute: "source-identifier",
              element: element.local,
              expected: "outcome",
              identifier: source,
            }),
          );
        }
      }

      for (const target of Option.toArray(named("target-identifier"))) {
        const seen = targets.get(itemRef) ?? new Set<string>();
        if (seen.has(target)) {
          refusals.push(
            refuse(document, "duplicate-identifier", at("target-identifier"), {
              identifier: target,
            }),
          );
        } else if (
          !Option.contains(named("source-identifier"), target) &&
          Option.exists(variables, (held) =>
            held.link
              ? sessionVariables.has(target)
              : held.declarations.has(target) || itemBuiltIns.has(target),
          )
        ) {
          refusals.push(
            refuse(document, "duplicate-identifier", at("target-identifier"), {
              identifier: target,
              reading: "97",
            }),
          );
        }

        seen.add(target);
        targets.set(itemRef, seen);
      }
    }
  }

  return refusals;
};

/**
 * What judging the template defaults of a document's item refs gives: their refusals, and the type
 * of the template variable each other one sets.
 */
interface TemplateDefaults {
  readonly refusals: readonly Refusal[];
  /**
   * Each template default whose target its item declares as a template variable of a judged type,
   * with that type.
   */
  readonly targets: ReadonlyMap<SourceElement, ExpressionType>;
}

/**
 * Judge the template defaults of the item refs of a test or of a section document a test reaches,
 * as pantry judges a `TemplateDefault` (the `Template default target` law in
 * `packages/pantry/src/qti/expressions.ts`), each in document order, and type the template variable
 * each sets, as pantry's `TemplateDefaultTarget` does (the `Template default type` law in
 * `packages/pantry/src/qti/expressions.ts`).
 *
 * A default's `template-identifier` that names no template variable the item ref's item declares, a
 * name it does not declare or one it declares as another kind of variable, is
 * `undeclared-variable` at that attribute, its detail the `element`, the `attribute`, the
 * `identifier` and `expected: "template"`, pantry's `template-default-target`. It is judged only
 * through an item ref whose item the package holds and the reader read, or one that names an LTI
 * link, under which every default is refused (reading 110, "under an item ref that names an LTI
 * link a variable mapping is accepted unchecked, a recorded limit, and a template default is
 * refused"): a link is no QTI item and has no template variables to override, whatever outcomes it
 * reports. A value that is no NCName, or a default without the attribute, is the structure check's
 * refusal, so it is passed over.
 *
 * @param document The document's location.
 * @param visits The visits of the document's elements, in document order.
 * @param variablesFor The variables of the item an item ref resolves to, none when it resolves to
 *   no item the reader read.
 * @returns The refusals, in document order, and each typed target.
 */
const judgeTemplateDefaults = (
  document: string,
  visits: readonly Visit[],
  variablesFor: (itemRef: SourceElement) => Option.Option<ItemVariables>,
): TemplateDefaults => {
  const refusals: Refusal[] = [];
  const targets = new Map<SourceElement, ExpressionType>();
  for (const { element, parent, path } of visits) {
    const itemRef = parent.pipe(
      Option.filter((one) => isQti(one, itemRefElements)),
      Option.getOrUndefined,
    );
    if (itemRef !== undefined && isQti(element, templateDefaultElements)) {
      const variables = variablesFor(itemRef);
      const target = attributeOf(element, "template-identifier").pipe(
        Option.map(trimXmlSpace),
        Option.filter(isNcName),
      );
      if (Option.isSome(variables) && Option.isSome(target)) {
        const declaration = variables.value.declarations.get(target.value);
        if (declaration?.local === "qti-template-declaration") {
          for (const type of Option.toArray(declarationType(declaration))) {
            targets.set(element, type);
          }
        } else {
          refusals.push(
            refuse(
              document,
              "undeclared-variable",
              attributePath(path, { local: "template-identifier", namespace: "" }),
              {
                attribute: "template-identifier",
                element: element.local,
                expected: "template",
                identifier: target.value,
              },
            ),
          );
        }
      }
    }
  }

  return { refusals, targets };
};

/**
 * Give a refusal's facts as one string, its document, rule, location and detail, the detail's facts
 * in key order, so two refusals with the same facts give the same string.
 *
 * The document is a fact because a location is a path within a document: two section documents
 * that two tests reach may hold the same error at the same path, and each is refused.
 *
 * @param refusal The refusal.
 * @returns Its facts.
 */
const factsOf = (refusal: Refusal): string =>
  JSON.stringify([
    refusal.document,
    refusal.rule,
    refusal.location,
    Object.entries(refusal.detail).toSorted(([one], [other]) => (one < other ? -1 : 1)),
  ]);

/**
 * The refusals given so far, counted by their facts ({@link factsOf}) as each is given, so a loop
 * that gives more at each step judges each step against the count it keeps rather than one counted
 * again over every refusal given so far, and computes each refusal's facts once.
 */
interface HeldRefusals {
  /**
   * Give the refusals of a list that the ones held do not already hold, each held one passing over
   * one refusal with its facts once within the list, as {@link notHeld} gives them, and hold them
   * from then on.
   *
   * @param refusals The refusals.
   * @returns The refusals not held, in order.
   */
  readonly keep: (refusals: readonly Refusal[]) => readonly Refusal[];
}

/**
 * Hold some refusals, counted by their facts, for a loop to give more against
 * ({@link HeldRefusals}).
 *
 * @param held The refusals already given.
 * @returns What holds them.
 */
const holding = (held: readonly Refusal[]): HeldRefusals => {
  const counts = new Map<string, number>();
  /**
   * Count one more refusal with some facts as held.
   *
   * @param facts The refusal's facts.
   */
  const hold = (facts: string): void => {
    counts.set(facts, (counts.get(facts) ?? 0) + 1);
  };
  for (const refusal of held) {
    hold(factsOf(refusal));
  }

  return {
    keep: (refusals) => {
      // How many of the held refusals with each facts this list has passed over so far.
      const passed = new Map<string, number>();
      const kept: { readonly facts: string; readonly refusal: Refusal }[] = [];
      for (const refusal of refusals) {
        const facts = factsOf(refusal);
        const used = passed.get(facts) ?? 0;
        if ((counts.get(facts) ?? 0) > used) {
          passed.set(facts, used + 1);
        } else {
          kept.push({ facts, refusal });
        }
      }

      for (const { facts } of kept) {
        hold(facts);
      }

      return kept.map(({ refusal }) => refusal);
    },
  };
};

/**
 * Give the refusals of one list that another does not already hold, each held one passing over one
 * refusal with its facts ({@link factsOf}).
 *
 * A loop that gives refusals against every one given so far keeps one {@link holding} across its
 * steps instead, so it does not count them all again at each.
 *
 * @param refusals The refusals.
 * @param held The refusals already given.
 * @returns The refusals not held, in order.
 */
const notHeld = (refusals: readonly Refusal[], held: readonly Refusal[]): readonly Refusal[] =>
  holding(held).keep(refusals);

/**
 * Give the refusals several ways of judging one thing give, each refusal once, in the order the
 * ways first give it.
 *
 * @param ways What each way gives.
 * @returns The refusals.
 */
const unionOf = (ways: readonly (readonly Refusal[])[]): readonly Refusal[] => {
  const union = holding([]);

  return ways.flatMap((way) => union.keep(way));
};

/**
 * One place a dotted name may be read at ({@link waysThrough}): its unsplit reading, or one dot it
 * may split at that resolves, with how many of its readings count there (reading 48) under each
 * view of the one document whose view decides that.
 */
interface ReadingSlot {
  /**
   * How many readings count there under each view of its document, in the views' order.
   */
  readonly counts: readonly number[];
  /**
   * The index of that document.
   */
  readonly document: number;
}

/**
 * The views each document a name is read through may still take under some conditions, and how
 * many documents have none left.
 */
interface Narrowing {
  readonly allowed: (readonly boolean[])[];
  closed: number;
}

/**
 * Copy a narrowing, so narrowing the copy leaves it as it is: each document's views are replaced
 * when narrowed, never changed in place.
 *
 * @param narrowing The narrowing.
 * @returns The copy.
 */
const copiedNarrowing = ({ allowed, closed }: Narrowing): Narrowing => ({
  allowed: [...allowed],
  closed,
});

/**
 * Narrow the views of a slot's document to those under which the slot's count keeps a condition, in
 * place, counting the document closed when it loses its last view.
 *
 * @param narrowing The narrowing.
 * @param slot The slot.
 * @param keep The condition on the slot's count.
 */
const narrowTo = (
  narrowing: Narrowing,
  { counts, document }: ReadingSlot,
  keep: (count: number) => boolean,
): void => {
  const views = narrowing.allowed[document] ?? [];
  const kept = views.map((open, view) => open && keep(counts[view] ?? 0));
  if (views.includes(true) && !kept.includes(true)) {
    narrowing.closed += 1;
  }

  narrowing.allowed[document] = kept;
};

/**
 * Give the first way a narrowing keeps: each document's first view left, -1 for a closed one.
 *
 * @param narrowing The narrowing.
 * @returns The way.
 */
const firstWayOf = ({ allowed }: Narrowing): number[] =>
  allowed.map((views) => views.indexOf(true));

/**
 * Give, for each answer the readings of a name may give, the first way of reading it that gives
 * that answer: the view each document it reads through takes, by index.
 *
 * A way takes one view of each document, the views of different documents chosen apart, and every
 * slot of one document read under that document's view. Under a way, each slot counts some
 * readings, and the answer is decided by the first two that count, in the slots' order: none
 * counts; one slot counts one alone; one slot counts two; or one slot counts one and a later slot
 * the next. So the ways are not enumerated, which would take a number of ways exponential in the
 * documents. For each answer the slots narrow each document's views to those under which every
 * slot of it gives that answer's count, none, one, at least one, two or more, or any after the
 * answer's last slot; the answer is given by some way when every document keeps a view, and the
 * first way that gives it takes each document's first view kept. Ways are ordered as a list of
 * every way would list them, by the first document's view first, so the result lists each answer's
 * first way in the order such a list first meets the answer. The work is, for each slot, linear in
 * the slots and the documents, and, for each answer found, linear in the documents.
 *
 * @param sizes How many views each document has.
 * @param slots The slots, in the order of the readings they give.
 * @returns The first way of each answer, in that order; none when a document has no view.
 */
const waysThrough = (
  sizes: readonly number[],
  slots: readonly ReadingSlot[],
): readonly (readonly number[])[] => {
  const opened = (): Narrowing => ({
    allowed: sizes.map((size) => Array.from({ length: size }, () => true)),
    closed: sizes.filter((size) => size === 0).length,
  });
  const ways: (readonly number[])[] = [];

  // No reading counts.
  const quiet = opened();
  for (const slot of slots) {
    narrowTo(quiet, slot, (count) => count === 0);
  }

  if (quiet.closed === 0) {
    ways.push(firstWayOf(quiet));
  }

  // One slot counts one reading, alone.
  for (const [index, slot] of slots.entries()) {
    const own = quiet.allowed[slot.document] ?? [];
    if (quiet.closed - (own.includes(true) ? 0 : 1) === 0) {
      const alone = opened();
      for (const [other, them] of slots.entries()) {
        if (them.document === slot.document) {
          narrowTo(alone, them, other === index ? (count) => count === 1 : (count) => count === 0);
        }
      }

      const view = (alone.allowed[slot.document] ?? []).indexOf(true);
      if (view !== -1) {
        const way = firstWayOf(quiet);
        way[slot.document] = view;
        ways.push(way);
      }
    }
  }

  // Two readings count: the first slot that counts two, or counts one and a later slot the next.
  const before = opened();
  for (const [index, slot] of slots.entries()) {
    if (before.closed > 0) {
      break;
    }

    const twice = copiedNarrowing(before);
    narrowTo(twice, slot, (count) => count >= 2);
    if (twice.closed === 0) {
      ways.push(firstWayOf(twice));
    }

    const between = copiedNarrowing(before);
    narrowTo(between, slot, (count) => count === 1);
    for (const later of slots.slice(index + 1)) {
      if (between.closed > 0) {
        break;
      }

      const view = (between.allowed[later.document] ?? []).findIndex(
        (open, at) => open && (later.counts[at] ?? 0) >= 1,
      );
      if (view !== -1) {
        const way = firstWayOf(between);
        way[later.document] = view;
        ways.push(way);
      }

      narrowTo(between, later, (count) => count === 0);
    }

    narrowTo(before, slot, (count) => count === 0);
  }

  return ways.toSorted((one, other) => {
    for (const [document, view] of one.entries()) {
      const order = view - (other[document] ?? 0);
      if (order !== 0) {
        return order;
      }
    }

    return 0;
  });
};

/**
 * What a ref's `href` may resolve to: the documents of the resources the manifest lists that an
 * item ref or a section ref may name, each found from the directory a resolved `href` names
 * without the path being written out.
 */
interface RefTargets {
  /**
   * The facts of a directory ({@link directoryFacts}) over the paths of the documents {@link kinds}
   * keys and of every section resource's document, whose folder gives a path a ref resolves to as
   * the manifest names it, so a ref under a deep `xml:base` costs its own length, not the base's.
   */
  readonly factsOf: (directory: Directory) => DirectoryFacts;
  /**
   * What an item ref's `href` may resolve to, keyed by the path of the document a resource the
   * manifest lists names: an item resource's, `item`, or an LTI link resource's, `lti-link`
   * ({@link ltiLinkTypes}), which an item ref may name in place of an item (reading 110). A path
   * both name is an item's.
   */
  readonly kinds: ReadonlyMap<string, "item" | "lti-link">;
}

/**
 * One item ref of a test or a section document whose `href` resolves to an item resource or an LTI
 * link resource the manifest lists, whether or not it writes an identifier: the item ref, its
 * item's or its link's path, and which of the two it names.
 */
interface ItemRefTarget {
  readonly element: SourceElement;
  /**
   * Whether it names an LTI link rather than an item: the package declares nothing a link reports,
   * so a name read through it that no built-in gives is accepted unchecked (reading 106) and so are
   * its variable mappings' sources, their targets judged only against one another and the session
   * variables (reading 97), while its template defaults name no template variable (reading 110).
   */
  readonly link: boolean;
  readonly path: string;
}

/**
 * One item ref of a test or a section document whose identifier names something, an NCName
 * (reading 152), and that resolves to an item resource or an LTI link resource the manifest lists:
 * its identifier, and whether a selection with replacement in its own document can repeat it.
 */
interface ResolvedItemRef extends ItemRefTarget {
  readonly identifier: string;
  /**
   * Whether it lies under a section of its own document whose `qti-selection` has
   * `with-replacement` true ({@link replacingSections}).
   */
  readonly replaced: boolean;
}

/**
 * One section ref of a test or a section document whose `href` names a path inside the package:
 * the section ref, its `href` collapsed as written, the path of the element, the path its `href`
 * resolves to, and whether a selection with replacement in its own document can repeat what it
 * places.
 */
interface SectionPlacement {
  readonly element: SourceElement;
  readonly href: string;
  /**
   * The section ref's own path in its document, where a refusal of it is located.
   */
  readonly at: string;
  /**
   * The path its `href` names, as the manifest names it.
   */
  readonly path: string;
  /**
   * Whether the section ref lies under a section of its own document whose `qti-selection` has
   * `with-replacement` true ({@link replacingSections}).
   */
  readonly replaced: boolean;
}

/**
 * One part's, section's or item ref's `identifier` in a test or section document, which must be
 * unique within the test that reaches the document (`info.txt:10759`).
 */
interface StructureIdentifier {
  /**
   * The document's location, where a refusal of the identifier is.
   */
  readonly document: string;
  readonly element: SourceElement;
  readonly identifier: string;
  /**
   * The path of the element's `identifier` attribute, where a refusal of it is located.
   */
  readonly path: string;
  /**
   * Whether the element is a part or a section, a scope with a `duration`, rather than an item ref.
   */
  readonly scope: boolean;
}

/**
 * What a test's reach is built from in one test or section document, read from its elements in
 * document order.
 */
interface DocumentStructure {
  /**
   * The identifier of each of its parts, sections and item refs that names something, an NCName
   * (reading 152), in document order, an item ref's whether it resolves or not.
   */
  readonly identifiers: readonly StructureIdentifier[];
  /**
   * Each item ref whose identifier is an NCName and that resolves, against the document's path, to
   * an item resource or an LTI link resource.
   */
  readonly itemRefs: readonly ResolvedItemRef[];
  /**
   * Each item ref whose identifier is an NCName and that resolves to an LTI link resource, with its
   * own path in the document, in document order: what a package marks and leaves out of the test
   * it delivers (reading 110).
   */
  readonly links: readonly LtiLink[];
  /**
   * Each of its section refs whose `href` names the document of a resource an item ref or a section
   * ref may name ({@link RefTargets}), in document order. One that names any other path inside the
   * package places nothing, since only a section resource's document is placed
   * ({@link sectionDocumentAt}), so it is not listed.
   */
  readonly sectionRefs: readonly SectionPlacement[];
  /**
   * Each item ref that resolves to an item resource or an LTI link resource, whether or not it
   * writes an identifier, in document order: what its variable mappings and template defaults are
   * judged against (reading 155).
   */
  readonly targets: readonly ItemRefTarget[];
  /**
   * Each item ref that resolves to neither an item resource nor an LTI link resource,
   * `item-ref-unresolved` at the item ref, and each section ref whose `href` names no path inside
   * the package, `package-path-outside` with `check: "remote-section"` at the section ref (reading
   * 170), in document order.
   */
  readonly unresolved: readonly Refusal[];
  /**
   * The visits of its elements, in document order, which its references, variable mappings and
   * template defaults are judged over.
   */
  readonly visits: readonly Visit[];
}

/**
 * Report whether an element is a section whose `qti-selection` has `with-replacement` true, as
 * `xs:boolean` reads it, which lets each item ref beneath it be instantiated more than once
 * (reading 88).
 *
 * @param element The element.
 * @returns Whether it is.
 */
const replacesItems = (element: SourceElement): boolean =>
  isQti(element, sectionElements) &&
  element.children.some(
    (child) =>
      child.kind === "element" &&
      isQti(child, selectionElements) &&
      Option.exists(Option.flatMap(attributeOf(child, "with-replacement"), xsBooleanOf), Boolean),
  );

/**
 * Give the elements of a document that lie under a section whose `qti-selection` has
 * `with-replacement` true ({@link replacesItems}), each such section included.
 *
 * @param visits The visits of the document's elements, in document order, each parent before its
 *   children.
 * @returns The elements.
 */
const replacingSections = (visits: readonly Visit[]): ReadonlySet<SourceElement> => {
  const replacing = new Set<SourceElement>();
  for (const { element, parent } of visits) {
    if (Option.exists(parent, (above) => replacing.has(above)) || replacesItems(element)) {
      replacing.add(element);
    }
  }

  return replacing;
};

/**
 * Read what a test's reach is built from in one test or section document: its parts', sections' and
 * item refs' identifiers, each with the path of its `identifier` attribute, its item refs, each
 * resolved against the document's path to an item resource the manifest lists, or to an LTI link
 * resource, which an item ref may name in place of an item (reading 110, "an item ref may name an
 * LTI link instead of an item"), and its section refs, each with the path it names, each item ref
 * and section ref with whether a selection with replacement in the document lies above it ({@link
 * replacingSections}).
 *
 * An item ref that resolves to no listed item resource and no listed LTI link resource is
 * `item-ref-unresolved` at the item ref, its detail the `identifier`, the `href` and, when the
 * `href` names a path inside the package, that `path`, bounded ({@link boundedPath}): one longer
 * than 1,024 characters keeps its first 512 and its last 511 around a `…`. A part, section or item
 * ref whose identifier is no NCName names nothing (reading 152 as amended, "Any other value names
 * nothing: no row holds it as a name"), so it holds no place in the document's identifiers, no
 * repeat of it is judged and no reading resolves through it; its value domain, its document's own
 * `attribute-type`, refuses it alone. An item ref that writes no identifier names nothing too; its
 * missing identifier is the test's own verdict's (reading 147). Either item ref is otherwise judged
 * like any other (reading 155, "the laws over what an item ref names judge every
 * item ref, whether or not it ... write[s] an identifier"): one that resolves to neither is
 * `item-ref-unresolved`, its detail the `identifier` as written for one that writes one, else
 * `check: "unwritten"`, the missing `attribute`, the `href`, the `path` when there is one, and
 * `reading: "155"`, and one that resolves has its variable mappings and template defaults judged
 * (`targets`). An item ref that writes no `href` names nothing, and is the
 * test's own verdict's (reading 155). Each `href` is collapsed and resolved by {@link locate}
 * against the `xml:base` in scope, or else the document's path ({@link basesOf}, reading 103), so
 * one under an `xml:base` outside the package names no path inside it. The path it names is looked
 * for among the documents a ref may name from its directory's folder ({@link RefTargets}), never
 * written out whole, so a document whose refs sit under a deep `xml:base` costs the base's depth
 * once, not once for each ref.
 *
 * A section ref whose `href` names no path inside the package, an absolute URI, a path from a
 * host's root, a `..` that climbs above the package's root, or any `href` under an `xml:base`
 * outside the package, places nothing and is `package-path-outside` with `check:
 * "remote-section"` at the section ref, its detail the `href` and `reading: "170"` (reading 170, "A
 * section ref whose href is external is refused under the stated limit 'Remote section ref'"). No
 * rule of QTI bans one: a section ref is a facade for the section it names, and that section is the
 * test's content, but plate assembles a test from its package's documents alone and never fetches
 * one, so there is nothing to judge. A fetch of the section at import would lift the limit.
 *
 * @param source The document's source.
 * @param base The document's path, which its `href`s resolve against where no `xml:base` is in
 *   scope.
 * @param refTargets What a ref may resolve to: the documents of every item resource, LTI link
 *   resource and section resource.
 * @returns What it holds.
 */
const structureIn = (
  source: SourceDocument,
  base: string,
  refTargets: RefTargets,
): DocumentStructure => {
  const visits = [...walk(source)];
  const bases = basesOf(visits, base);
  const replacing = replacingSections(visits);
  const identifiers: StructureIdentifier[] = [];
  const itemRefs: ResolvedItemRef[] = [];
  const links: LtiLink[] = [];
  const sectionRefs: SectionPlacement[] = [];
  const targets: ItemRefTarget[] = [];
  const unresolved: Refusal[] = [];
  /**
   * Find the document a ref's `href` names among those a ref may name ({@link RefTargets}),
   * through its directory's folder.
   *
   * @param resolved The path the `href` names inside the package.
   * @returns Its directory's facts, and the document's path as the manifest names it, none when
   *   the path names no such document.
   */
  const listedAt = (resolved: Resolved) => {
    const facts = refTargets.factsOf(resolved.directory);

    return {
      facts,
      listed: facts.folder.pipe(
        Option.flatMap((folder) => Option.fromUndefinedOr(folder.files.get(resolved.name))),
      ),
    };
  };
  for (const { element, path } of visits) {
    const writtenIdentifier = identifierOf(element);
    const identifier = Option.getOrUndefined(writtenIdentifier.pipe(Option.filter(isNcName)));
    const href = Option.getOrUndefined(attributeOf(element, "href"));
    const scope = isQti(element, durationScopes);
    if (identifier !== undefined && (scope || isQti(element, itemRefElements))) {
      identifiers.push({
        document: source.location,
        element,
        identifier,
        path: attributePath(path, { local: "identifier", namespace: "" }),
        scope,
      });
    }

    if (href !== undefined && isQti(element, sectionRefElements)) {
      const written = collapseXmlSpace(href);
      const resolved = locate(bases.get(element) ?? Option.none(), written);
      if (Option.isSome(resolved)) {
        for (const listed of Option.toArray(listedAt(resolved.value).listed)) {
          sectionRefs.push({
            at: path,
            element,
            href: written,
            path: listed,
            replaced: replacing.has(element),
          });
        }
      } else {
        unresolved.push(
          refuse(source.location, "package-path-outside", path, {
            check: "remote-section",
            href: written,
            reading: "170",
          }),
        );
      }
    } else if (href !== undefined && isQti(element, itemRefElements)) {
      const written = collapseXmlSpace(href);
      const found = Option.map(locate(bases.get(element) ?? Option.none(), written), (inside) => ({
        inside,
        ...listedAt(inside),
      }));
      const named = Option.getOrUndefined(found.pipe(Option.flatMap(({ listed }) => listed)));
      const kind = named === undefined ? undefined : refTargets.kinds.get(named);
      if (named !== undefined && kind !== undefined) {
        const link = kind === "lti-link";
        targets.push({ element, link, path: named });
        if (identifier !== undefined) {
          itemRefs.push({
            element,
            identifier,
            link,
            path: named,
            replaced: replacing.has(element),
          });
          if (link) {
            links.push({ identifier, path });
          }
        }
      } else {
        const at = Option.match(found, {
          onNone: () => ({}),
          onSome: ({ facts, inside }) => ({ path: boundedPath(inside, facts) }),
        });
        unresolved.push(
          refuse(
            source.location,
            "item-ref-unresolved",
            path,
            Option.match(writtenIdentifier, {
              onNone: () => ({
                ...at,
                attribute: "identifier",
                check: "unwritten",
                href: written,
                reading: "155",
              }),
              onSome: (value) => ({ ...at, href: written, identifier: value }),
            }),
          ),
        );
      }
    }
  }

  return { identifiers, itemRefs, links, sectionRefs, targets, unresolved, visits };
};

/**
 * The scope a section gives what lies under it, as pantry reads a `Section` for reading 87
 * (`testDocumentOf` in `packages/pantry/src/test/oracle-laws/assembly.ts`): its test part, none
 * when its document holds none above it; whether its children's order is drawn at delivery
 * (`mixes`): it shuffles, or it is invisible with `keep-together` false and its parent's order is
 * drawn, so its children are mixed into its parent's; and whether that looseness reaches its
 * document's root (`looseChain`), so the order of the section ref that places the document draws
 * it.
 */
interface OrderScope {
  readonly looseChain: boolean;
  readonly mixes: boolean;
  readonly part: Option.Option<SourceElement>;
}

/**
 * One element of a test or section document a branch rule may name ({@link branchNameElements})
 * whose identifier is an NCName (reading 152), with its place in its document: its pre-order
 * interval among the document's elements, its parent, and the scope it lies in.
 */
interface BranchName extends OrderScope {
  readonly element: SourceElement;
  /**
   * One past the pre-order index of its last descendant.
   */
  readonly end: number;
  readonly identifier: string;
  readonly parent: Option.Option<SourceElement>;
  /**
   * Whether it lies under a section of its document whose `qti-selection` has `with-replacement`
   * true ({@link replacingSections}).
   */
  readonly replaced: boolean;
  /**
   * Its pre-order index among its document's elements.
   */
  readonly start: number;
}

/**
 * One section ref of a test or section document, a site where a section document is placed, with
 * its pre-order index and the scope of the parent it is placed in.
 */
interface BranchSite {
  readonly parentLooseChain: boolean;
  readonly parentMixes: boolean;
  readonly part: Option.Option<SourceElement>;
  readonly start: number;
}

/**
 * One branch rule of a test or section document whose `target` names no reserved exit: the rule,
 * its owner, the target with its outer whitespace removed, and the path of the `target` attribute,
 * where a refusal of it is located.
 */
interface BranchRule {
  readonly at: string;
  readonly owner: SourceElement;
  readonly target: string;
}

/**
 * What reading 87 reads of one test or section document: its names, by element and, the first in
 * document order, by identifier; its branch rules; and its sites.
 */
interface DocumentLayout {
  readonly byIdentifier: ReadonlyMap<string, BranchName>;
  readonly names: ReadonlyMap<SourceElement, BranchName>;
  readonly rules: readonly BranchRule[];
  readonly sites: ReadonlyMap<SourceElement, BranchSite>;
}

/**
 * Read an `xs:boolean` attribute of an element, as `xs:boolean` reads it.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @param otherwise The value when it is unwritten or not an `xs:boolean`.
 * @returns Its value.
 */
const flagOf = (element: SourceElement, local: string, otherwise: boolean): boolean =>
  Option.getOrElse(Option.flatMap(attributeOf(element, local), xsBooleanOf), () => otherwise);

/**
 * Report whether a section shuffles its children: its `qti-ordering` has `shuffle` true.
 *
 * @param section The section.
 * @returns Whether it does.
 */
const shufflesChildren = (section: SourceElement): boolean =>
  section.children.some(
    (child) =>
      child.kind === "element" && isQti(child, orderingElements) && flagOf(child, "shuffle", false),
  );

/**
 * Give the end of each element's pre-order interval among a document's elements: one past the
 * index of its last descendant.
 *
 * @param visits The visits of the document's elements, in document order.
 * @returns Each element's end.
 */
const endsOf = (visits: readonly Visit[]): ReadonlyMap<SourceElement, number> => {
  const ends = new Map<SourceElement, number>();
  for (const [offset, { element, parent }] of visits.toReversed().entries()) {
    const end = ends.get(element) ?? visits.length - offset;
    ends.set(element, end);
    for (const above of Option.toArray(parent)) {
      ends.set(above, Math.max(ends.get(above) ?? 0, end));
    }
  }

  return ends;
};

/**
 * Give each section's scope ({@link OrderScope}), from the section above it: under a test part,
 * the part, with no looseness reaching up; at a section document's root, no part, its looseness
 * reaching the root. A section is loose when it is invisible (`visible`, false when unwritten) and
 * does not keep together (`keep-together`, true when unwritten).
 *
 * @param visits The visits of the document's elements, in document order, each parent before its
 *   children.
 * @returns Each section's scope.
 */
const orderScopesOf = (visits: readonly Visit[]): ReadonlyMap<SourceElement, OrderScope> => {
  const sections = new Map<SourceElement, OrderScope>();
  for (const { element, parent } of visits) {
    if (isQti(element, sectionElements)) {
      const underPart = parent.pipe(Option.filter((one) => isQti(one, partElements)));
      const scope = parent.pipe(
        Option.flatMap((one) => Option.fromUndefinedOr(sections.get(one))),
        Option.getOrElse((): OrderScope => ({
          looseChain: Option.isNone(underPart),
          mixes: false,
          part: underPart,
        })),
      );
      const loose = !flagOf(element, "visible", false) && !flagOf(element, "keep-together", true);
      sections.set(element, {
        looseChain: loose && scope.looseChain,
        mixes: shufflesChildren(element) || (loose && scope.mixes),
        part: scope.part,
      });
    }
  }

  return sections;
};

/**
 * Read a branch rule that names a target: one on a test part, a section or an item ref, the owners
 * the ASI XSD places it on, whose `target` is no reserved exit ({@link branchExits}). One with no
 * `target` is the document's own verdict's.
 *
 * @param visit The element's visit.
 * @returns The rule, none for any other element.
 */
const branchRuleOf = ({ element, parent, path }: Visit): Option.Option<BranchRule> =>
  Option.all([
    parent.pipe(Option.filter((owner) => isQti(owner, branchOwnerElements))),
    attributeOf(element, "target").pipe(
      Option.map(trimXmlSpace),
      Option.filter((target) => !branchExits.has(target)),
    ),
  ]).pipe(
    Option.filter(() => isQti(element, branchRuleElements)),
    Option.map(([owner, target]) => ({
      at: attributePath(path, { local: "target", namespace: "" }),
      owner,
      target,
    })),
  );

/**
 * Read what reading 87 reads of one test or section document, as pantry's law oracle reads a test
 * document (`testDocumentOf` in `packages/pantry/src/test/oracle-laws/assembly.ts`): each name, an
 * identifier that is an NCName (reading 152 as amended: any other names nothing), with its
 * section's scope ({@link orderScopesOf}) or, for an element that is not a section, its
 * parent's, no order of its own drawn, a test part its own part; each section ref, a site in its
 * parent's scope; and each branch rule that names a target ({@link branchRuleOf}).
 *
 * It reads every element, where reading 87's rule for a document judged alone (`branchContext` in
 * `#plate/validate/test-rules.ts`, E8a) reads only the elements the structural walk judges. The two
 * differ only for an identified element in content the walk passes over, which no part, section or
 * item ref the test delivers is: E8a's reading is the right one, so a target that names such an
 * element names nothing of the test, while this walk resolves it. Moving this walk onto the judged
 * elements would change what it refuses there, so it is a follow-up, not made here.
 *
 * @param visits The visits of the document's elements, in document order.
 * @returns What reading 87 reads of it.
 */
const layoutOf = (visits: readonly Visit[]): DocumentLayout => {
  const ends = endsOf(visits);
  const replacing = replacingSections(visits);
  const sections = orderScopesOf(visits);
  /**
   * Give the scope a parent gives what lies under it: a section's own, or, under any other parent,
   * no drawn order, and the parent as the part when it is one.
   *
   * @param parent The parent.
   * @returns The scope.
   */
  const scopeUnder = (parent: Option.Option<SourceElement>): OrderScope =>
    Option.match(parent, {
      onNone: () => ({ looseChain: false, mixes: false, part: Option.none() }),
      onSome: (above) =>
        sections.get(above) ?? {
          looseChain: false,
          mixes: false,
          part: isQti(above, partElements) ? Option.some(above) : Option.none(),
        },
    });
  const byIdentifier = new Map<string, BranchName>();
  const names = new Map<SourceElement, BranchName>();
  const sites = new Map<SourceElement, BranchSite>();
  for (const [start, { element, parent }] of visits.entries()) {
    const identifier = Option.getOrUndefined(identifierOf(element).pipe(Option.filter(isNcName)));
    if (identifier !== undefined && isQti(element, branchNameElements)) {
      const name: BranchName = {
        element,
        end: ends.get(element) ?? start + 1,
        identifier,
        parent,
        replaced: replacing.has(element),
        start,
        ...(sections.get(element) ?? {
          looseChain: false,
          mixes: false,
          part: isQti(element, partElements) ? Option.some(element) : scopeUnder(parent).part,
        }),
      };
      names.set(element, name);
      if (!byIdentifier.has(identifier)) {
        byIdentifier.set(identifier, name);
      }
    }

    if (isQti(element, sectionRefElements)) {
      const scope = scopeUnder(parent);
      sites.set(element, {
        parentLooseChain: scope.looseChain,
        parentMixes: scope.mixes,
        part: scope.part,
        start,
      });
    }
  }

  return {
    byIdentifier,
    names,
    rules: visits.flatMap((visit) => Option.toArray(branchRuleOf(visit))),
    sites,
  };
};

/**
 * One section document a test reaches through a section ref, with what it holds.
 */
interface ReachedSection {
  readonly path: string;
  readonly source: SourceDocument;
  readonly structure: DocumentStructure;
}

/**
 * What a placement of a document in a test's assembled test is placed under, the few facts its
 * judgement reads: its test part, none for the test; whether a section whose `qti-selection` has
 * `with-replacement` true lies above it, anywhere above it in the assembled test, so a selection
 * with replacement can repeat each item ref it holds (reading 88); and whether the order of the
 * section that places it is drawn at delivery, so its loose content is mixed into that order
 * ({@link OrderScope}).
 */
interface PlacementContext {
  readonly mixes: boolean;
  readonly part: Option.Option<SourceElement>;
  readonly replaced: boolean;
}

/**
 * The placements of one test or section document in a test's assembled test under one
 * {@link PlacementContext}, as pantry's `Instance` is one placement
 * (`packages/pantry/src/qti/tests.ts`): the test document itself, or a section document the section
 * refs place. Every placement of a document under one context is judged alike, so it stands for
 * them all, and the assembly counts how many it stands for.
 */
interface Placement extends PlacementContext, ReachedSection {
  readonly layout: DocumentLayout;
}

/**
 * One section ref of a placement that places a section document, with the placement it places.
 */
interface PlacedBy {
  readonly placement: Placement;
  readonly site: SectionPlacement;
}

/**
 * What placing a test's section documents gives ({@link assemble}).
 */
interface Assembly {
  /**
   * Each placement's section refs that place a document, in document order, with the placement
   * each places.
   */
  readonly children: ReadonlyMap<Placement, readonly PlacedBy[]>;
  /**
   * How many times the assembled test places each placement's document under its context, counted
   * up to 2: once, or more than once.
   */
  readonly counts: ReadonlyMap<Placement, number>;
  /**
   * The `inclusion-cycle` refusal of each section ref the walk finds returning to a document on its
   * chain.
   */
  readonly cycles: readonly Refusal[];
  /**
   * What the package's tests have placed, this test's assembly with every one assembled before it
   * ({@link AssemblyBudget}).
   */
  readonly placed: Placed;
  /**
   * Each placement, the test's first, in the order the walk first meets each.
   */
  readonly placements: readonly Placement[];
}

/**
 * How many placements of section documents a package's assembled tests may hold, across all of its
 * tests, before plate refuses the package `assembly-limit`: a placement is one section document
 * under one test and one {@link PlacementContext}, and the test's own document is not one.
 *
 * It is plate's own stated limit, no rule of QTI, as the reader's limit of 256 nested elements is
 * (rule `db2ef322`). A section document is judged once for each test and context that places it
 * (reading 5, its references "resolve once for each test that includes the section"; reading 145, a
 * fragment it splices "is judged in the test that places it, once per placement"), and its views
 * and branch rules are read over the placements above it (readings 86 and 87), so the work of
 * judging a package's tests follows its assembled tests, which its tests, its test parts, the
 * contexts each places a document under and a chain of documents multiply past the package's own
 * size. Within the limit each such shape measured opens in under 2 s of thread CPU. No placement
 * for each test part, and a section document judged once across tests whose reaches agree, would
 * lift it.
 */
const assemblyPlacementLimit = 2048;

/**
 * How many bytes of section documents a package's assembled tests may place, across all of its
 * tests, before plate refuses the package `assembly-limit`, 4 MiB: each placement
 * ({@link assemblyPlacementLimit}) counts its document's size in the package once. A few placements
 * of one large section document cost what that many documents would, since each is judged again,
 * so a count of placements alone does not bound the work.
 */
const assemblyByteLimit = 4 * 1024 * 1024;

/**
 * What a package's assembled tests have placed so far, counted across its tests toward the
 * assembly limit ({@link assemblyPlacementLimit}, {@link assemblyByteLimit}).
 */
interface Placed {
  /**
   * The bytes of the section documents placed, each counted once for each placement.
   */
  readonly bytes: number;
  /**
   * The placements of section documents, the tests' own placements not counted.
   */
  readonly placements: number;
}

/**
 * What a test's assembly counts toward the package's assembly limit.
 */
interface AssemblyBudget {
  /**
   * The package's location, which an `assembly-limit` refusal carries as its document.
   */
  readonly location: string;
  /**
   * What the tests assembled before this one placed.
   */
  readonly placed: Placed;
  /**
   * Give the size in bytes of the package's file at a path.
   */
  readonly sizeOf: (path: string) => number;
}

/**
 * Construct the `assembly-limit` refusal of a package: its detail names the `bound` passed, its
 * `limit` and the count `reached`, and it refuses the whole package, at the package's location.
 *
 * @param location The package's location.
 * @param bound The bound passed.
 * @param limit The bound's limit.
 * @param reached The count that passed it.
 * @returns The refusal.
 */
const assemblyLimit = (
  location: string,
  bound: "bytes" | "placements",
  limit: number,
  reached: number,
): Refusal =>
  new Refusal({
    detail: { bound, limit: String(limit), reached: String(reached) },
    document: location,
    location: { kind: "document" },
    readerRule: Option.none(),
    rule: "assembly-limit",
    suggestion: Option.none(),
  });

/**
 * Give what a package's tests place once a test's assembly places one more section document, or
 * the `assembly-limit` refusal when that passes a bound ({@link assemblyLimit}): the placements
 * first, then the bytes, so a placement that passes both names the placements.
 *
 * @param budget What the assembly counts toward.
 * @param placed What the package's tests placed before this placement.
 * @param path The path of the section document placed.
 * @returns What they place with it, or the refusal.
 */
const placeOne = (
  budget: AssemblyBudget,
  placed: Placed,
  path: string,
): Result.Result<Placed, Refusal> => {
  const next = { bytes: placed.bytes + budget.sizeOf(path), placements: placed.placements + 1 };
  if (next.placements > assemblyPlacementLimit) {
    return Result.fail(
      assemblyLimit(budget.location, "placements", assemblyPlacementLimit, next.placements),
    );
  }

  return next.bytes > assemblyByteLimit
    ? Result.fail(assemblyLimit(budget.location, "bytes", assemblyByteLimit, next.bytes))
    : Result.succeed(next);
};

/**
 * Give the section document at a path, when a section resource names it and the reader read it
 * with the root `qti-assessment-section`.
 *
 * @param path The document's path.
 * @param sectionPaths The path of every section resource's document.
 * @param documents The package's documents.
 * @returns Its source, none otherwise.
 */
const sectionDocumentAt = (
  path: string,
  sectionPaths: ReadonlySet<string>,
  documents: ReadonlyMap<string, Document>,
): Option.Option<SourceDocument> => {
  const source = sectionPaths.has(path) ? documents.get(path)?.source : undefined;

  return source !== undefined &&
    Result.isSuccess(source) &&
    source.success.root.namespace === qtiNamespace &&
    source.success.root.local === "qti-assessment-section"
    ? Option.some(source.success)
    : Option.none();
};

/**
 * Give the context a section ref of a placement places its document under: its test part, the
 * section ref's own where it lies under a test part, else the placement's; whether a selection with
 * replacement lies above it, in its own document or above the placement; and whether its order is
 * drawn, as reading 87 reads a site (`placedName` in
 * `packages/pantry/src/test/oracle-laws/assembly.ts`).
 *
 * @param placement The placement whose document holds the section ref.
 * @param site The section ref.
 * @returns The context of what it places.
 */
const contextUnder = (placement: Placement, site: SectionPlacement): PlacementContext => {
  const scope = placement.layout.sites.get(site.element);

  return {
    mixes: (scope?.parentMixes ?? false) || ((scope?.parentLooseChain ?? false) && placement.mixes),
    part: Option.orElse(scope?.part ?? Option.none(), () => placement.part),
    replaced: site.replaced || placement.replaced,
  };
};

/**
 * What a section document gives each placement of it: its source, its structure and its layout.
 */
type SectionReader = (
  path: string,
) => Option.Option<Omit<Placement, keyof PlacementContext | "path">>;

/**
 * Give what reads the section document at a path once for a package, with what it holds, for every
 * test's assembly ({@link assemble}): its source, its structure ({@link structureIn}) and its
 * layout ({@link layoutOf}), each a function of the document, its path and the package alone, so
 * every test that places the document shares them, and a document many tests place is read once.
 *
 * @param sectionPaths The path of every section resource's document.
 * @param refTargets What a ref may resolve to: the documents of every item resource, LTI link
 *   resource and section resource.
 * @param documents The package's documents.
 * @returns The reader, which gives none where no section document is.
 */
const sectionReader = (
  sectionPaths: ReadonlySet<string>,
  refTargets: RefTargets,
  documents: ReadonlyMap<string, Document>,
): SectionReader => {
  const read = new Map<string, Option.Option<Omit<Placement, keyof PlacementContext | "path">>>();

  return (path) => {
    const known = read.get(path);
    if (known !== undefined) {
      return known;
    }

    const found = Option.map(sectionDocumentAt(path, sectionPaths, documents), (source) => {
      const structure = structureIn(source, path, refTargets);

      return { layout: layoutOf(structure.visits), source, structure };
    });
    read.set(path, found);

    return found;
  };
};

/**
 * Count how many times the assembled test places each placement, up to 2, from the test's one:
 * each placement's count is the sum, over the section refs that place it, of the count of the
 * placement that holds the section ref, so the work is one pass over the section refs however many
 * times a chain of documents multiplies the placements.
 *
 * @param test The test's placement.
 * @param children Each placement's section refs, with what each places.
 * @param finished The placements in the order the walk finished each, each after every placement
 *   it places.
 * @returns Each placement's count.
 */
const countsOf = (
  test: Placement,
  children: ReadonlyMap<Placement, readonly PlacedBy[]>,
  finished: readonly Placement[],
): ReadonlyMap<Placement, number> => {
  const counts = new Map<Placement, number>([[test, 1]]);
  for (const placement of finished.toReversed()) {
    const count = counts.get(placement) ?? 0;
    for (const child of children.get(placement) ?? []) {
      counts.set(child.placement, Math.min(2, (counts.get(child.placement) ?? 0) + count));
    }
  }

  return counts;
};

/**
 * Place a test's section documents, as the qti package's assembled test places them (its `Instance`
 * tree, `packages/pantry/src/qti/tests.ts`): a section ref "functions as a facade for the
 * qti-assessment-section to which it refers", so the test places the section document each of its
 * section refs names ({@link sectionDocumentAt}), and, before the ref after it, the ones that
 * document's own section refs name, depth first in document order. A ref whose `href` names no
 * section document the reader read places nothing. Each section ref places its document once, so
 * two refs to one document place it twice (reading 86, "a section document a test places twice is
 * written once").
 *
 * The walk keeps one {@link Placement} for each document under each {@link PlacementContext} it
 * meets, and walks a placement's section refs only the first time it meets it: a later section ref
 * to the same document under the same context places it again, which {@link countsOf} counts up to
 * 2, but adds nothing new to judge. So the walk's work is bounded by the documents, their section
 * refs and the few contexts each may be placed under, however many placements a chain of documents
 * that each place the next twice multiplies. The walk keeps the placements
 * still open in a list of its own rather than on the call stack, so no length of a chain of refs
 * overflows the stack either.
 *
 * A ref to a document already on the walk's chain, the documents from the test down to the
 * placement that holds it, would merge that document into itself without end, which no aggregated
 * document is (reading 85, "an inclusion never reaches itself"): it is `inclusion-cycle` at the
 * section ref, its detail the section ref's `identifier` when it writes one, its `href` as written,
 * the `chain` of document paths from the test through the repeated one, space-separated and bounded
 * as any fact is ({@link boundedJoin}), and `reading: "85"`, given once for each section ref of the
 * test the walk finds so, and it places nothing, as pantry's law "Inclusion cycle" refuses it
 * alone. The walk finds every loop the test reaches at one section ref at least; a ref that closes
 * a loop only on a chain the walk does not take, since it walks each placement once, is not refused
 * again: whether some chain of documents through a given one leads to a ref is not decidable in
 * polynomial time in general, so plate refuses the loop at the refs its own walk meets. An
 * `xi:include` is never fetched here (S-6), so a loop through includes is not seen, a recorded
 * limit (rule `db2ef322`).
 *
 * Each new placement counts toward the package's assembly limit, across its tests
 * ({@link placeOne}): the walk stops at the first placement that passes a bound and gives the
 * `assembly-limit` refusal, so refusing costs what reaching the bound does. Within the limit the
 * count changes nothing the walk does.
 *
 * @param test The test's own placement.
 * @param readAt What gives the section document at a path ({@link sectionReader}).
 * @param budget What the package's tests assembled before this one placed, and how to count.
 * @returns The placements, the cycles' refusals, how the placements place one another and what
 *   the tests have placed with them, or the `assembly-limit` refusal.
 */
const assemble = (
  test: Placement,
  readAt: SectionReader,
  budget: AssemblyBudget,
): Result.Result<Assembly, Refusal> => {
  const parts = new Map<SourceElement, number>();
  /**
   * Key a document's placement under a context.
   *
   * @param path The document's path.
   * @param context The context.
   * @returns The key.
   */
  const keyOf = (path: string, { mixes, part, replaced }: PlacementContext): string => {
    const partKey = Option.match(part, {
      onNone: () => -1,
      onSome: (element) => {
        const known = parts.get(element) ?? parts.size;
        parts.set(element, known);

        return known;
      },
    });

    return JSON.stringify([path, partKey, mixes, replaced]);
  };

  const placements: Placement[] = [test];
  const byKey = new Map<string, Placement>([[keyOf(test.path, test), test]]);
  const children = new Map<Placement, PlacedBy[]>();
  const finished: Placement[] = [];
  const cycles: Refusal[] = [];
  const refused = new Set<SourceElement>();
  // Each open placement with the index of its next section ref, the innermost last; their
  // documents are the chain.
  const open: { readonly placement: Placement; next: number }[] = [{ next: 0, placement: test }];
  const onChain = new Set<string>([test.path]);
  let total = budget.placed;
  for (let frame = open.at(-1); frame !== undefined; frame = open.at(-1)) {
    const { placement } = frame;
    const site = placement.structure.sectionRefs.at(frame.next);
    frame.next += 1;
    const found = site === undefined ? Option.none() : readAt(site.path);
    if (site === undefined) {
      open.pop();
      onChain.delete(placement.path);
      finished.push(placement);
    } else if (Option.isSome(found) && onChain.has(site.path)) {
      if (!refused.has(site.element)) {
        refused.add(site.element);
        cycles.push(
          refuse(placement.source.location, "inclusion-cycle", site.at, {
            chain: boundedJoin([...open.map((one) => one.placement.path), site.path], " "),
            href: site.href,
            ...Option.match(identifierOf(site.element), {
              onNone: () => ({}),
              onSome: (identifier) => ({ identifier }),
            }),
            reading: "85",
          }),
        );
      }
    } else if (Option.isSome(found)) {
      const context = contextUnder(placement, site);
      const key = keyOf(site.path, context);
      const known = byKey.get(key);
      const child = known ?? { ...found.value, ...context, path: site.path };
      const placed = children.get(placement) ?? [];
      placed.push({ placement: child, site });
      children.set(placement, placed);
      if (known === undefined) {
        const counted = placeOne(budget, total, site.path);
        if (Result.isFailure(counted)) {
          return Result.fail(counted.failure);
        }

        total = counted.success;
        byKey.set(key, child);
        placements.push(child);
        onChain.add(site.path);
        open.push({ next: 0, placement: child });
      }
    }
  }

  return Result.succeed({
    children,
    counts: countsOf(test, children, finished),
    cycles,
    placed: total,
    placements,
  });
};

/**
 * Give the variables of what a resolved item ref names: its item's, read from the item's document,
 * or, for an LTI link, none declared, with the link said: the package declares nothing a link
 * reports, so a name read through it that no built-in gives is accepted unchecked (reading 106) and
 * so are its variable mappings' sources, their targets judged only against one another and the
 * session variables (reading 97), while each of its template defaults is refused (reading 110,
 * "under an item ref that names an LTI link a variable mapping is accepted unchecked, a recorded
 * limit, and a template default is refused").
 *
 * @param target The resolved item ref.
 * @param documents The package's documents.
 * @returns Its variables, none when it names an item the reader did not read.
 */
const targetVariables = (
  target: ItemRefTarget,
  documents: ReadonlyMap<string, Document>,
): Option.Option<TargetVariables> =>
  target.link
    ? Option.some({ declarations: new Map(), link: true })
    : Option.map(variablesOf(documents.get(target.path)), (variables) => ({
        ...variables,
        link: false,
      }));

/**
 * Give the variables of what each of some resolved item refs names ({@link targetVariables}).
 *
 * @param itemRefs The resolved item refs.
 * @param documents The package's documents.
 * @returns What gives an item ref's item's variables, none declared for one that names an LTI
 *   link, which it says, and none for an item ref not among them or one whose item the reader did
 *   not read.
 */
const variablesThrough = (
  itemRefs: readonly ItemRefTarget[],
  documents: ReadonlyMap<string, Document>,
): ((itemRef: SourceElement) => Option.Option<TargetVariables>) => {
  const targets = new Map(itemRefs.map((itemRef) => [itemRef.element, itemRef] as const));

  return (itemRef) =>
    Option.flatMap(Option.fromUndefinedOr(targets.get(itemRef)), (target) =>
      targetVariables(target, documents),
    );
};

/**
 * Find each part, section and item ref identifier that a test's reach gives again, walking the
 * test's own document, then each section document it reaches, in the order it reaches them, each in
 * its document order.
 *
 * The identifier of a section or item reference "must be unique within the test and must not be the
 * identifier of any testPart" (`info.txt:10759`), and a section ref reads as if its section
 * document were inline. Pantry keys each structure identifier within its document (the `Structure
 * identifier` law, refused `structure-identifier`) and across the assembled test (the `Test name
 * key` law, refused `test-name-key`), both in `packages/pantry/src/qti/tests.ts`. The first
 * occurrence wins: a later one that a document reached before already gave is
 * `duplicate-identifier` at its `identifier` attribute, its detail the `identifier`, as the test
 * rules give one within a document. One a document gives twice is its own verdict's
 * (`duplicateIdentifier` in `#plate/validate/test-rules.ts`), so only a document's first occurrence
 * of an identifier is judged here, and a refusal is never given twice. An identifier that is no
 * NCName names nothing (reading 152 as amended) and is not among a document's identifiers
 * ({@link structureIn}), so no repeat of it is judged: its value domain refuses it alone.
 *
 * @param test What the test's own document holds.
 * @param reached The section documents it reaches, in the order the walk reaches them.
 * @returns Each later occurrence's element, with its refusal, at the section document that gives
 *   it.
 */
const repeatsIn = (
  test: DocumentStructure,
  reached: readonly ReachedSection[],
): ReadonlyMap<SourceElement, Refusal> => {
  const met = new Set<string>();
  const repeats = new Map<SourceElement, Refusal>();
  for (const { identifiers } of [test, ...reached.map((section) => section.structure)]) {
    const own = new Set<string>();
    for (const { document, element, identifier, path } of identifiers) {
      if (met.has(identifier) && !own.has(identifier)) {
        repeats.set(element, refuse(document, "duplicate-identifier", path, { identifier }));
      }

      own.add(identifier);
    }

    for (const identifier of own) {
      met.add(identifier);
    }
  }

  return repeats;
};

/**
 * Give each read through an item ref in a test document's processing of a variable the engine holds
 * no value of: an expression whose `identifier` a test may prefix ({@link referenceElements}) that
 * lies in the test's `qti-outcome-processing` or in a `qti-template-default` of one of its item
 * refs, whose `identifier` is a name the predicate takes. The test model, built from the document
 * alone, holds such a read and would run it; the engine holds no value of it: the item marks a
 * declared context variable, the engine holds no item's `QTI_CONTEXT`, and a session delivers no
 * LTI link. A `qti-correct`, a `qti-map-response` or a `qti-map-response-point` is found as a
 * `qti-variable` or a `qti-default` is, since a name read through an LTI link is accepted whatever
 * reads it (reading 166, "a name read through an LTI link (reading 110)" is accepted), and the
 * processing or the template default would run it on nothing; the test model leaves a template
 * default out for each of the five (`withUnheldReads` in `#plate/model/test.ts`). A context
 * variable meets none of those three on a checked package: each reads a response alone
 * ({@link judgeReference}).
 *
 * @param source The test's source.
 * @param visits The visits of its elements, in document order.
 * @param isUnheld Whether a name reads, through an item ref, a variable the engine holds no value
 *   of.
 * @returns The reads, in document order, each with the item ref and the path of the processing
 *   element it lies in.
 */
const unheldReadsIn = (
  source: SourceDocument,
  visits: readonly Visit[],
  isUnheld: (name: string) => boolean,
): readonly UnheldRead[] => {
  const places = new Map<SourceElement, (name: string) => UnheldRead>();
  const reads: UnheldRead[] = [];
  for (const { element, parent, path } of visits) {
    const above = Option.getOrUndefined(parent);
    const itemRef =
      above !== undefined && isQti(above, itemRefElements) ? identifierOf(above) : Option.none();
    const inherited = above === undefined ? undefined : places.get(above);
    if (above === source.root && isQti(element, processingElements)) {
      places.set(element, (name) => ({ kind: "outcome-processing", name, path }));
    } else if (Option.isSome(itemRef) && isQti(element, templateDefaultElements)) {
      places.set(element, (name) => ({
        itemRef: itemRef.value,
        kind: "template-default",
        name,
        path,
      }));
    } else if (inherited !== undefined) {
      places.set(element, inherited);

      const read = Option.getOrUndefined(Option.map(identifierOf(element), inherited));
      if (read !== undefined && isQti(element, referenceElements) && isUnheld(read.name)) {
        reads.push(read);
      }
    }
  }

  return reads;
};

/**
 * One name a branch rule's target may resolve to, with the path of the document that writes it.
 */
interface WrittenName {
  readonly name: BranchName;
  readonly path: string;
}

/**
 * Report whether a name's pre-order interval in its document holds a point of that document.
 *
 * @param name The name.
 * @param point The point, a pre-order index.
 * @returns Whether `start ≤ point < end`.
 */
const holdsPoint = (name: BranchName, point: number): boolean =>
  name.start <= point && point < name.end;

/**
 * A branch rule's target as one placement of the rule reads it: the target, the context of the
 * placement that holds it and that placement's document's layout, the rule's owner, the rule's test
 * part, and, when the target lies in a document above the rule's, the point in that document the
 * rule's placement descends through.
 */
interface TargetView {
  readonly holder: PlacementContext;
  readonly layout: DocumentLayout;
  readonly owner: BranchName;
  readonly ownerPart: SourceElement | undefined;
  /**
   * None when the target lies in the rule's own placement; otherwise the pre-order index, in the
   * holder's document, of the section ref through which the rule's placement descends.
   */
  readonly point: Option.Option<number>;
  readonly target: BranchName;
}

/**
 * Report whether a target lies after its rule's source, as pantry's law "Branch forward" reads it:
 * in the rule's own placement, at or after the owner's end; in a document above, after the section
 * ref the rule's placement descends through. A target before it is still accepted when the rule is
 * no test part's, the two do not nest, and the nearest name above the target that holds the source
 * draws its children's order at delivery (it shuffles, or a loose section mixes its children into
 * one that does, {@link OrderScope}), the target under a child of it that does not hold the
 * source: "their order is drawn at delivery and is not judged here, in either direction" (reading
 * 87). A `fixed` choice, which holds some orders under a shuffle, is not read, so a pair it would
 * hold backward is accepted, a recorded limit, as reading 87 records it.
 *
 * @param rule The rule.
 * @param view Its target, as the rule's placement reads it.
 * @returns Whether the target lies after the source, or their order is drawn.
 */
const isForward = (
  rule: BranchRule,
  { holder, layout, owner, point: through, target }: TargetView,
): boolean => {
  const same = Option.isNone(through);
  const point = Option.getOrElse(through, () => owner.start);
  if (same ? target.start >= owner.end : target.start > point) {
    return true;
  }

  const nested =
    holdsPoint(target, point) || (same && owner.start <= target.start && target.start < owner.end);
  /**
   * Give the name that is a name's parent in the target's document.
   *
   * @param name The name.
   * @returns Its parent's name, undefined when its parent is no name.
   */
  const above = (name: BranchName): BranchName | undefined =>
    name.parent.pipe(
      Option.flatMap((parent) => Option.fromUndefinedOr(layout.names.get(parent))),
      Option.getOrUndefined,
    );
  let branch = target;
  let common = above(branch);
  while (common !== undefined && !holdsPoint(common, point)) {
    branch = common;
    common = above(branch);
  }

  return (
    !isQti(rule.owner, partElements) &&
    !nested &&
    common !== undefined &&
    !holdsPoint(branch, point) &&
    (common.mixes || (common.looseChain && holder.mixes))
  );
};

/**
 * Give why reading 87 refuses a resolved target, as pantry's laws "Branch target" and "Branch
 * forward" judge it, in this order, one fault, one reason: on a test part, the target is a test
 * part, and on an item ref or a section, an item ref, section or section ref of the same test part,
 * else `outside-part`; it is no item ref under a section whose `qti-selection` has
 * `with-replacement` true, anywhere above it in the assembled test, else `repeatable`; it is not
 * the rule's own owner, else `self`; and it lies after the source ({@link isForward}), else
 * `backward`.
 *
 * @param rule The rule.
 * @param view Its target, as the rule's placement reads it.
 * @returns The reason, none when the target holds.
 */
const viewFault = (rule: BranchRule, view: TargetView): Option.Option<string> => {
  const { holder, ownerPart, point, target } = view;
  const ownsPart = isQti(rule.owner, partElements);
  const isPart = isQti(target.element, partElements);
  const targetPart = Option.getOrUndefined(Option.orElse(target.part, () => holder.part));
  if (ownsPart ? !isPart : isPart || ownerPart !== targetPart) {
    return Option.some("outside-part");
  }

  if (isQti(target.element, itemRefElements) && (target.replaced || holder.replaced)) {
    return Option.some("repeatable");
  }

  if (Option.isNone(point) && target.element === rule.owner) {
    return Option.some("self");
  }

  return isForward(rule, view) ? Option.none() : Option.some("backward");
};

/**
 * How the placements of a test's assembly place one another, which the branch rules read: the
 * test's placement, each placement's section refs with what each places, each placement's
 * placements above it, one step up, and each document's placements, by path.
 */
interface PlacementGraph {
  readonly children: ReadonlyMap<Placement, readonly PlacedBy[]>;
  readonly counts: ReadonlyMap<Placement, number>;
  readonly parents: ReadonlyMap<Placement, readonly Placement[]>;
  /**
   * Each document's placements, by path, in the order the walk places them.
   */
  readonly placedAt: ReadonlyMap<string, readonly Placement[]>;
  readonly placements: readonly Placement[];
  readonly test: Placement;
}

/**
 * Give the placements from which some of a set of placements can be reached, each of the set
 * included.
 *
 * @param graph The assembly's placements.
 * @param targets The set.
 * @returns The placements that reach it.
 */
const reachingAny = (
  graph: PlacementGraph,
  targets: readonly Placement[],
): ReadonlySet<Placement> => {
  const reaching = new Set<Placement>(targets);
  const pending = [...targets];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const parent of graph.parents.get(next) ?? []) {
      if (!reaching.has(parent)) {
        reaching.add(parent);
        pending.push(parent);
      }
    }
  }

  return reaching;
};

/**
 * Which placements of a test's assembly lie on every way down from the test to which
 * ({@link dominanceOf}).
 */
interface Dominance {
  /**
   * Give the deepest placement that lies on every way down to each of two.
   *
   * @param one A placement.
   * @param other Another.
   * @returns The deepest placement on every way down to both, either of them included.
   */
  readonly deepestCommon: (one: Placement, other: Placement) => Placement;
  /**
   * Report whether one placement lies on every way down from the test to another.
   *
   * @param above The one.
   * @param below The other.
   * @returns Whether `above` lies on every way down to `below`, `below` itself included.
   */
  readonly dominates: (above: Placement, below: Placement) => boolean;
}

/**
 * Give which placements of a test's assembly lie on every way down from the test to which. The
 * placements form no cycle ({@link assemble}), so they are met in an order that puts each after
 * every placement one step above it, and the nearest placement on every way down to a placement is
 * the deepest one on every way down to each placement one step above it. Each placement keeps the
 * placements 1, 2, 4 and so on steps up that chain, so the deepest common one of two placements,
 * and whether one lies on the chain of another, takes a step for each doubling of the chain's
 * length rather than one for each placement on it: the whole costs a few such steps for each
 * section ref that places a placement, however long a chain of documents is.
 *
 * @param graph The assembly's placements.
 * @returns Which placements lie on every way down to which.
 */
const dominanceOf = (graph: PlacementGraph): Dominance => {
  const depths = new Map<Placement, number>([[graph.test, 0]]);
  // Each placement's chain, the placements 1, 2, 4 and so on steps up it, none past the test.
  const chains = new Map<Placement, readonly Placement[]>([[graph.test, []]]);
  /**
   * Give how many steps a placement's chain takes up to the test.
   *
   * @param placement The placement.
   * @returns The steps.
   */
  const depthOf = (placement: Placement): number => depths.get(placement) ?? 0;
  /**
   * Give the placement 2 to the power of a level steps up a placement's chain.
   *
   * @param placement The placement.
   * @param level The level.
   * @returns The placement there, the test when the chain is shorter.
   */
  const upOf = (placement: Placement, level: number): Placement =>
    chains.get(placement)?.[level] ?? graph.test;
  /**
   * Give the placement some steps up a placement's chain.
   *
   * @param placement The placement.
   * @param steps The steps, at most its chain's.
   * @returns The placement there.
   */
  const lift = (placement: Placement, steps: number): Placement => {
    let lifted = placement;
    for (let left = steps, level = 0; left > 0; left = Math.floor(left / 2), level += 1) {
      if (left % 2 === 1) {
        lifted = upOf(lifted, level);
      }
    }

    return lifted;
  };
  /**
   * Give the deepest placement on the chains of two placements.
   *
   * @param one A placement.
   * @param other Another.
   * @returns The deepest placement on both chains, each placement's chain including itself.
   */
  const deepestCommon = (one: Placement, other: Placement): Placement => {
    let lower = lift(one, Math.max(0, depthOf(one) - depthOf(other)));
    let upper = lift(other, Math.max(0, depthOf(other) - depthOf(one)));
    for (let level = (chains.get(lower)?.length ?? 0) - 1; level >= 0; level -= 1) {
      const lowerUp = upOf(lower, level);
      const upperUp = upOf(upper, level);
      if (lowerUp !== upperUp) {
        lower = lowerUp;
        upper = upperUp;
      }
    }

    return lower === upper ? lower : upOf(lower, 0);
  };

  const waiting = new Map<Placement, number>();
  for (const [placement, above] of graph.parents) {
    waiting.set(placement, above.length);
  }

  const met = [graph.test];
  for (const placement of met) {
    for (const { placement: below } of graph.children.get(placement) ?? []) {
      const left = (waiting.get(below) ?? 1) - 1;
      waiting.set(below, left);
      if (left === 0) {
        const [first = graph.test, ...rest] = graph.parents.get(below) ?? [];
        let nearest = first;
        for (const parent of rest) {
          nearest = deepestCommon(nearest, parent);
        }

        const depth = depthOf(nearest) + 1;
        const chain = [nearest];
        for (let level = 1; 2 ** level <= depth; level += 1) {
          chain.push(upOf(chain.at(-1) ?? graph.test, level - 1));
        }

        depths.set(below, depth);
        chains.set(below, chain);
        met.push(below);
      }
    }
  }

  return {
    deepestCommon,
    dominates: (above, below) =>
      depthOf(above) <= depthOf(below) && lift(below, depthOf(below) - depthOf(above)) === above,
  };
};

/**
 * Report whether a placement can be reached from a placement on every way down to it through
 * placements outside a set, walking up from it, one way at a time, through the placements one step
 * above each, each placement met once. A placement above it that `from` does not lie on every way
 * down to lies above `from` too, and every way up to it passes `from`, so the walk, which ends at
 * `from`, reads only placements `from` lies above: it reads no more placements than lie above the
 * placement and below `from`, and keeps nothing once it settles.
 *
 * @param graph The assembly's placements.
 * @param below The placement.
 * @param from A placement on every way down to it, not in the set.
 * @param avoided The set.
 * @returns Whether a way up from `below` through placements outside the set reaches `from`.
 */
const reachesAbove = (
  graph: PlacementGraph,
  below: Placement,
  from: Placement,
  avoided: ReadonlySet<Placement>,
): boolean => {
  const met = new Set<Placement>([below]);
  // The walk's way up, each placement with the index of the next placement above it to read.
  const way: { readonly placement: Placement; next: number }[] = [{ next: 0, placement: below }];
  for (let step = way.at(-1); step !== undefined; step = way.at(-1)) {
    if (step.placement === from) {
      return true;
    }

    const parent = graph.parents.get(step.placement)?.[step.next];
    step.next += 1;
    if (parent === undefined) {
      way.pop();
    } else if (!avoided.has(parent) && !met.has(parent)) {
      met.add(parent);
      way.push({ next: 0, placement: parent });
    }
  }

  return false;
};

/**
 * Report whether the test reaches a placement through none of some placements that lie above it,
 * as a placement reads another document from outside it (reading 86). It does not when one of them
 * lies on every way down to it ({@link dominanceOf}), as the placement itself and the test's own
 * placement do. Otherwise it does when there is only one, and, with more, when a way up from the
 * placement through none of them reaches the deepest placement on every way down to it and to each
 * of them, which the test reaches through none of them, since none lies above that one
 * ({@link reachesAbove}). That walk reads only placements above the placement and below that one,
 * and keeps nothing once it settles, so it needs no walk of every placement: it reads no more
 * placements than lie above the placement.
 *
 * @param graph The assembly's placements.
 * @param dominance Which placements lie on every way down to which.
 * @param placement The placement.
 * @param lying The placements avoided, every one the placement or above it.
 * @returns Whether the test reaches the placement through none of them.
 */
const reachedAround = (
  graph: PlacementGraph,
  { deepestCommon, dominates }: Dominance,
  placement: Placement,
  lying: readonly Placement[],
): boolean => {
  if (lying.some((one) => dominates(one, placement))) {
    return false;
  }

  if (lying.length <= 1) {
    return true;
  }

  let from = placement;
  for (const one of lying) {
    from = deepestCommon(from, one);
  }

  return reachesAbove(graph, placement, from, new Set(lying));
};

/**
 * Where a branch rule's target is written across a test's reach, read once for the reach and the
 * target ({@link BranchIndex}): each document that writes it, by path, with the name it writes;
 * the placements of those documents, in the order the walk places them; and whether the test
 * places them more than once, so two placements supply it.
 */
interface TargetWriters {
  readonly byPath: ReadonlyMap<string, BranchName>;
  readonly suppliedTwice: boolean;
  readonly writers: readonly Placement[];
}

/**
 * One section ref of a placement that writes a branch rule's target, through which a placement of
 * the rule's document descends: the placement that writes it, the target as that placement holds
 * it, the placement the ref places, and the ref's pre-order index in the writer's document, none
 * when its document has no site for it.
 */
interface WriterView {
  readonly holder: Placement;
  readonly placed: Placement;
  readonly point: Option.Option<number>;
  readonly target: BranchName;
}

/**
 * What the branch rules of one document read of a target that other documents write, read once
 * for the document and the target ({@link BranchIndex}): whether the test reaches a placement of
 * the document through no placement of a writer, `unknown`, or `ambiguous` when the writers are
 * placed more than once, and each section ref of a writer through which a placement of the
 * document descends, in the order of the writers' placements.
 */
interface TargetAcross {
  /**
   * The reasons found for the document's rules, by whether a rule's owner is a test part and by
   * its owner's test part, which are all of a rule that a view through a section ref reads
   * ({@link acrossFaults}); none when a view's section ref has no site, which reads the owner's
   * own place.
   */
  readonly faults: Option.Option<Map<boolean, Map<SourceElement | undefined, readonly string[]>>>;
  readonly unresolved: Option.Option<string>;
  readonly views: readonly WriterView[];
}

/**
 * What the branch rules of a test's reach read of its placements, each part indexed once for the
 * reach rather than again for each rule ({@link branchIndex}).
 */
interface BranchIndex {
  /**
   * Give what one document's branch rules read of a target that other documents write.
   *
   * @param path The rule's document's path.
   * @param identifier The target.
   * @returns What they read of it.
   */
  readonly across: (path: string, identifier: string) => TargetAcross;
  /**
   * Give where a target is written across the reach.
   *
   * @param identifier The target.
   * @returns Its writers.
   */
  readonly writersOf: (identifier: string) => TargetWriters;
}

/**
 * Index what a test's branch rules read of its placements, each part computed once, when a rule
 * first reads it: each target's writers by path, from the placements indexed by path; the
 * placements from which a document's placements can be reached ({@link reachingAny}), once for
 * each document; and what a document's rules read of a target written elsewhere, once for each
 * document and target, from those of its writers that reach it, its holders. Whether the test
 * reaches a placement of the document through no writer needs no walk of the placements when it
 * has no holder, or one, which reaches it so unless it lies on every way down to it
 * ({@link dominanceOf}, built once, when first needed); only two or more holders that may lie
 * above one placement, none of which alone lies so, walk up from it ({@link reachedAround}),
 * reading no placement outside its ancestry, once for each placement and set of holders above it,
 * however many targets they write. So the rules cost each one its own judgement, not a scan of
 * every placement and every writer, and nothing is kept for a target but what its rules read:
 * rules whose target many documents write cost no more than one written once, rules whose distinct
 * targets each document writes its own of no more than rules to one target, and rules whose
 * distinct targets the same placements write no more than one walk for them all.
 *
 * @param graph The assembly's placements.
 * @param names Each name of the reach by identifier, each document that writes it in the order the
 *   walk reaches them.
 * @returns The index.
 */
const branchIndex = (
  graph: PlacementGraph,
  names: ReadonlyMap<string, readonly WrittenName[]>,
): BranchIndex => {
  const order = new Map(graph.placements.map((placement, index) => [placement, index] as const));
  /**
   * Order two placements as the walk places them.
   *
   * @param one A placement.
   * @param other Another.
   * @returns Negative when `one` is placed first.
   */
  const placedFirst = (one: Placement, other: Placement): number =>
    (order.get(one) ?? 0) - (order.get(other) ?? 0);
  const targets = new Map<string, TargetWriters>();
  // Whether the test reaches a placement of a rule's document through none of two or more holders
  // that may lie above it, none of which alone lies on every way down to it, by the placement and
  // those holders' places in the walk's order, so the targets the same placements write share one
  // walk ({@link reachedAround}).
  const around = new Map<Placement, Map<string, boolean>>();
  let dominance: Dominance | undefined;
  let partitioned: boolean | undefined;
  const reachers = new Map<string, ReadonlySet<Placement>>();
  const acrosses = new Map<string, Map<string, TargetAcross>>();
  /**
   * Give where a target is written across the reach, indexed when first asked.
   *
   * @param identifier The target.
   * @returns Its writers.
   */
  const writersOf = (identifier: string): TargetWriters => {
    const known = targets.get(identifier);
    if (known !== undefined) {
      return known;
    }

    const byPath = new Map<string, BranchName>();
    for (const { name, path } of names.get(identifier) ?? []) {
      if (!byPath.has(path)) {
        byPath.set(path, name);
      }
    }

    const writers = [...byPath.keys()]
      .flatMap((path) => graph.placedAt.get(path) ?? [])
      .toSorted(placedFirst);
    let supplied = 0;
    for (const writer of writers) {
      supplied += graph.counts.get(writer) ?? 0;
    }

    const found = { byPath, suppliedTwice: supplied > 1, writers };
    targets.set(identifier, found);

    return found;
  };
  /**
   * Report whether the test reaches some placement of a document through no placement that writes
   * a target. Only the writers' placements that reach one of the document's, its holders, lie on a
   * way down to one, and of those only the ones that may lie above that one: a placement's
   * replacement holds for every placement below it ({@link contextUnder}), and, when no section
   * document places what it places under a test part of its own, a placement under a test part is
   * placed only by the test and placements under that part. With none above it, the test reaches
   * it; with one, unless that one lies on every way down to it ({@link dominanceOf}); with more,
   * unless one of them alone lies so, when a way up from it through no writer reaches the deepest
   * placement on every way down to it and to each of them, which the test reaches through no
   * writer since none lies above that one ({@link reachedAround}). That walk reads only the
   * placements above it and below that one, and runs once for the placement and the holders that
   * may lie above it, whatever the target: the writers that lie on no way down to it change
   * nothing.
   *
   * @param ruled The document's placements, none of which writes the target.
   * @param holders The target's writers' placements that reach one of the document's.
   * @returns Whether the test reaches one of the document's placements through no writer.
   */
  const reachedOutside = (ruled: readonly Placement[], holders: readonly Placement[]): boolean => {
    if (holders.length === 0) {
      return ruled.length > 0;
    }

    const known = dominance ?? dominanceOf(graph);
    dominance = known;
    const { dominates } = known;
    const byPart =
      partitioned ??
      [...graph.placedAt.values()].every(
        ([first]) =>
          first === undefined ||
          first === graph.test ||
          [...first.layout.sites.values()].every((site) => Option.isNone(site.part)),
      );
    partitioned = byPart;
    /**
     * Give the test part a placement lies under, as far as it tells which placements lie above it.
     *
     * @param placement The placement.
     * @returns Its test part, undefined for the test, or for every placement when a section
     *   document places under a test part of its own.
     */
    const partOf = (placement: Placement): SourceElement | undefined =>
      byPart ? Option.getOrUndefined(placement.part) : undefined;
    const groups = new Map<SourceElement | undefined, Placement[]>();
    for (const holder of holders) {
      const group = groups.get(partOf(holder)) ?? [];
      group.push(holder);
      groups.set(partOf(holder), group);
    }

    return ruled.some((placement) => {
      const part = partOf(placement);
      const above = [
        ...(groups.get(partOf(graph.test)) ?? []),
        ...(part === partOf(graph.test) ? [] : (groups.get(part) ?? [])),
      ].filter((holder) => placement.replaced || !holder.replaced);
      if (above.some((holder) => dominates(holder, placement))) {
        return false;
      }

      if (above.length <= 1) {
        return true;
      }

      const key = above
        .map((holder) => order.get(holder) ?? 0)
        .toSorted((one, other) => one - other)
        .join(" ");
      const byHolders = around.get(placement) ?? new Map<string, boolean>();
      around.set(placement, byHolders);

      const reached = byHolders.get(key) ?? reachedAround(graph, known, placement, above);
      byHolders.set(key, reached);

      return reached;
    });
  };
  /**
   * Give what one document's branch rules read of a target that other documents write, read when
   * first asked.
   *
   * @param path The rule's document's path.
   * @param identifier The target.
   * @returns What they read of it.
   */
  const across = (path: string, identifier: string): TargetAcross => {
    const byTarget = acrosses.get(path) ?? new Map<string, TargetAcross>();
    acrosses.set(path, byTarget);

    const known = byTarget.get(identifier);
    if (known !== undefined) {
      return known;
    }

    const { byPath, suppliedTwice, writers } = writersOf(identifier);
    const ruled = graph.placedAt.get(path) ?? [];
    const reaching = reachers.get(path) ?? reachingAny(graph, ruled);
    reachers.set(path, reaching);

    // A writer one of whose section refs places a placement that reaches the document reaches it
    // too, so only the writers among the placements that reach it are read, from the smaller side.
    const holders =
      reaching.size < writers.length
        ? [...reaching].filter((one) => byPath.has(one.path)).toSorted(placedFirst)
        : writers.filter((one) => reaching.has(one));
    const views: WriterView[] = [];
    for (const holder of holders) {
      const target = byPath.get(holder.path);
      for (const { placement, site } of graph.children.get(holder) ?? []) {
        if (target !== undefined && reaching.has(placement)) {
          views.push({
            holder,
            placed: placement,
            point: Option.fromUndefinedOr(holder.layout.sites.get(site.element)?.start),
            target,
          });
        }
      }
    }

    const found: TargetAcross = {
      faults: views.every((view) => Option.isSome(view.point))
        ? Option.some(new Map())
        : Option.none(),
      unresolved: reachedOutside(ruled, holders)
        ? Option.some(suppliedTwice ? "ambiguous" : "unknown")
        : Option.none(),
      views,
    };
    byTarget.set(identifier, found);

    return found;
  };

  return { across, writersOf };
};

/**
 * Give the reasons reading 87 refuses a branch rule of a document for, over every placement of the
 * document, when its target lies in no placement of the rule's own document: from outside a section
 * document a ref places, no target lies inside it, since branch rules "treat referred sections as
 * leaf nodes" (section 7.5), so the target resolves only in a placement above the rule's.
 *
 * - Where the test reaches a placement of the rule's document through no placement of a document that
 *   writes the target, the target is `unknown`, or `ambiguous` when the documents that write it are
 *   placed more than once, so two placements supply it (reading 87, "one that two placements of a
 *   section document supply twice ... is refused as ambiguous", which it states "applies only to a
 *   rule outside the section document").
 * - Where a placement of a document that writes it lies above, the target is judged as that placement
 *   holds it, from the section ref through which the rule's placement descends
 *   ({@link viewFault}).
 *
 * What the document reads of the target is indexed once for the document and the target
 * ({@link BranchIndex}), so each rule judges only the section refs through which its document's
 * placements descend from a writer. Through a section ref, a view reads of the rule only whether
 * its owner is a test part and the owner's test part, so the reasons are found once for each of
 * those and given again to every other rule of the document that shares them: rules to a target
 * that many documents above them write cost each one its share, not a judgement of every writer.
 *
 * @param rule The rule.
 * @param owner The rule's owner.
 * @param across What the rule's document reads of the target.
 * @returns The reasons, each once, in the order found.
 */
const acrossFaults = (
  rule: BranchRule,
  owner: BranchName,
  { faults, unresolved, views }: TargetAcross,
): readonly string[] => {
  const ownsPart = isQti(rule.owner, partElements);
  const ownerPart = Option.getOrUndefined(owner.part);
  const byPart = faults.pipe(
    Option.map((known) => {
      const found = known.get(ownsPart) ?? new Map<SourceElement | undefined, readonly string[]>();
      known.set(ownsPart, found);

      return found;
    }),
  );
  const shared = byPart.pipe(
    Option.flatMap((known) => Option.fromUndefinedOr(known.get(ownerPart))),
    Option.getOrUndefined,
  );
  if (shared !== undefined) {
    return shared;
  }

  const reasons = new Set<string>(Option.toArray(unresolved));
  for (const { holder, placed, point, target } of views) {
    for (const reason of Option.toArray(
      viewFault(rule, {
        holder,
        layout: holder.layout,
        owner,
        ownerPart: Option.getOrUndefined(Option.orElse(owner.part, () => placed.part)),
        point,
        target,
      }),
    )) {
      reasons.add(reason);
    }
  }

  const found = [...reasons];
  for (const known of Option.toArray(byPart)) {
    known.set(ownerPart, found);
  }

  return found;
};

/**
 * Judge the branch rules of one placement over the assembled test (reading 87), as the qti package
 * judges each instance's rules: each target that does not hold is `branch-target` at its `target`,
 * its detail the `target`, the `reason` and `reading: "87"`.
 *
 * A target its own document writes resolves in the rule's own placement, judged under this
 * placement's context ({@link viewFault}). Any other target resolves in a placement above, or
 * nowhere, and is judged once for the document over all its placements, at its first placement
 * ({@link acrossFaults}). A rule whose owner writes no identifier, or one that names nothing
 * (reading 152 as amended: it is no NCName), resolves from no source, and is `unknown` beside the
 * owner's own refusal (reading 147). A target that is no NCName resolves to no name ({@link
 * layoutOf}), so it is judged as a target no document writes.
 *
 * @param index What the test's branch rules read of its placements.
 * @param here The placement judged.
 * @param first Whether it is its document's first placement.
 * @returns The refusals, in document order.
 */
const judgeBranches = (index: BranchIndex, here: Placement, first: boolean): readonly Refusal[] =>
  here.layout.rules.flatMap((rule) => {
    const owner = here.layout.names.get(rule.owner);
    const own = index.writersOf(rule.target).byPath.get(here.path);
    /**
     * Give the reasons the rule is refused for here.
     *
     * @returns The reasons.
     */
    const reasons = (): readonly string[] => {
      if (owner === undefined) {
        return first ? ["unknown"] : [];
      }

      if (own !== undefined) {
        return Option.toArray(
          viewFault(rule, {
            holder: here,
            layout: here.layout,
            owner,
            ownerPart: Option.getOrUndefined(Option.orElse(owner.part, () => here.part)),
            point: Option.none(),
            target: own,
          }),
        );
      }

      return first ? acrossFaults(rule, owner, index.across(here.path, rule.target)) : [];
    };

    return reasons().map((reason) =>
      refuse(here.source.location, "branch-target", rule.at, {
        reading: "87",
        reason,
        target: rule.target,
      }),
    );
  });

/**
 * Give the refusals of the verdict on the document at a path: what its own check already gives,
 * which a package-level judgement of it does not give again.
 *
 * @param documents The package's documents.
 * @param path The document's path.
 * @returns The refusals, none when it is not refused or no verdict is on it.
 */
const ownRefusals = (documents: ReadonlyMap<string, Document>, path: string): readonly Refusal[] =>
  Option.match(
    Option.flatMap(Option.fromUndefinedOr(documents.get(path)), (document) => document.verdict),
    {
      onNone: () => [],
      onSome: (verdict) => (verdict.verdict === "refused" ? verdict.refusals : []),
    },
  );

/**
 * Where one item ref, part or section identifier of a test's reach is written: its document's
 * path, and, for an item ref, whether a selection with replacement in that document can repeat it.
 */
interface WrittenAt {
  readonly document: string;
  readonly replaced: boolean;
}

/**
 * What a test's placements give its references and branch rules ({@link reachOf}).
 */
interface Reach {
  /**
   * Each part and section identifier of the reach, whose `duration` a reading may read.
   */
  readonly durations: ReadonlySet<string>;
  /**
   * The placements of each document, by path, as a reading through one of its elements from
   * outside it reads them: whether a selection with replacement lies above each, true and false
   * each given as often as the assembled test places the document so, counted up to 2.
   */
  readonly flags: ReadonlyMap<string, readonly boolean[]>;
  /**
   * Each item ref of the reach, by identifier: the test's own, then each reached section
   * document's that no document before it gave.
   */
  readonly itemRefs: ReadonlyMap<string, ResolvedItemRef>;
  readonly names: ReadonlyMap<string, readonly WrittenName[]>;
  /**
   * Each document's placements, by path, in the order the walk places them.
   */
  readonly placedAt: ReadonlyMap<string, readonly Placement[]>;
  /**
   * Each section document the test places, at its first placement, in the order the walk places
   * them.
   */
  readonly reached: readonly Placement[];
  readonly repeats: ReadonlyMap<SourceElement, Refusal>;
  readonly written: ReadonlyMap<string, WrittenAt>;
}

/**
 * Gather what a test's placements give its references and branch rules: each document's placements,
 * by path; the section documents placed, each once; the identifiers a document gives again across
 * the reach ({@link repeatsIn}), which are left out of it, so the first wins; each item ref, part
 * and section identifier, where it is written; each document's placements as a reading from outside
 * it reads them; and each name a branch rule may name, with each document that writes it.
 *
 * @param test The test's own placement.
 * @param assembly The test's assembly.
 * @returns What they give.
 */
const reachOf = (test: Placement, { counts, placements }: Assembly): Reach => {
  const placedAt = new Map<string, Placement[]>();
  for (const placement of placements) {
    const placed = placedAt.get(placement.path) ?? [];
    placed.push(placement);
    placedAt.set(placement.path, placed);
  }

  const flags = new Map(
    [...placedAt].map(([path, placed]) => {
      const counted = [true, false].flatMap((replaced) => {
        let count = 0;
        for (const placement of placed) {
          if (placement.replaced === replaced) {
            count += counts.get(placement) ?? 0;
          }
        }

        return Array.from({ length: Math.min(2, count) }, () => replaced);
      });

      return [path, counted] as const;
    }),
  );
  const reached = [...placedAt.values()].flatMap(([first]) =>
    first === undefined || first === test ? [] : [first],
  );
  const repeats = repeatsIn(test.structure, reached);
  const itemRefs = new Map(
    test.structure.itemRefs.map((itemRef) => [itemRef.identifier, itemRef] as const),
  );
  const written = new Map<string, WrittenAt>(
    test.structure.itemRefs.map(
      ({ identifier, replaced }) => [identifier, { document: test.path, replaced }] as const,
    ),
  );
  for (const { path, structure } of reached) {
    for (const itemRef of structure.itemRefs) {
      if (!repeats.has(itemRef.element) && !itemRefs.has(itemRef.identifier)) {
        itemRefs.set(itemRef.identifier, itemRef);
        written.set(itemRef.identifier, { document: path, replaced: itemRef.replaced });
      }
    }
  }

  const durations = new Set<string>();
  const names = new Map<string, WrittenName[]>();
  for (const { layout, path, structure } of [test, ...reached]) {
    for (const { element, identifier, scope } of structure.identifiers) {
      if (scope && !repeats.has(element)) {
        durations.add(identifier);
        if (!written.has(identifier)) {
          written.set(identifier, { document: path, replaced: false });
        }
      }
    }

    for (const [identifier, name] of layout.byIdentifier) {
      const writing = names.get(identifier) ?? [];
      writing.push({ name, path });
      names.set(identifier, writing);
    }
  }

  return { durations, flags, itemRefs, names, placedAt, reached, repeats, written };
};

/**
 * Give what a reading may name through each item ref of a test's reach: its item's variables, none
 * declared for an LTI link, which it says ({@link targetVariables}), and the targets of its
 * variable mappings whose source the item declares.
 *
 * @param itemRefs Each item ref of the reach, by identifier.
 * @param documents The package's documents.
 * @returns What each names, by identifier, none for an item ref whose item the reader did not read.
 */
const itemsOf = (
  itemRefs: ReadonlyMap<string, ResolvedItemRef>,
  documents: ReadonlyMap<string, Document>,
): ReadonlyMap<string, ItemRefVariables> => {
  const items = new Map<string, ItemRefVariables>();
  for (const [identifier, itemRef] of itemRefs) {
    for (const variables of Option.toArray(targetVariables(itemRef, documents))) {
      items.set(identifier, {
        ...variables,
        mapped: new Map(
          mappingsOf(itemRef.element).flatMap(([from, to]) =>
            Option.toArray(
              Option.map(
                Option.fromUndefinedOr(variables.declarations.get(from)),
                (declaration) => [to, declaration] as const,
              ),
            ),
          ),
        ),
      });
    }
  }

  return items;
};

/**
 * Give a test's own variables by their whole identifier: its built-ins, then each outcome or
 * context variable it declares, what the unsplit reading of a reference reads.
 *
 * @param source The test's source.
 * @returns Its variables.
 */
const wholeOf = (source: SourceDocument): ReadonlyMap<string, ReadVariable> =>
  new Map<string, ReadVariable>([
    ...[...testBuiltIns].map(([name, builtIn]) => [name, builtInVariable(builtIn)] as const),
    ...source.root.children.flatMap((child) =>
      child.kind === "element" && isQti(child, testDeclarations)
        ? Option.toArray(
            Option.map(
              identifierOf(child),
              (identifier) =>
                [
                  identifier,
                  {
                    declaration: Option.some(child),
                    kind: kindOf(child),
                    type: declaredType(child),
                    unchecked: false,
                  },
                ] as const,
            ),
          )
        : [],
    ),
  ]);

/**
 * What judging one test gives: each of its own item refs' item path, keyed by the item ref's
 * identifier, in document order, an item ref that names an LTI link left out; its own item refs
 * that name an LTI link; the section documents it reaches; the test's refusals: the item refs',
 * their variable mappings', their template defaults', the references', those of the test's
 * processing that only its typed reach gives, then its branch rules', each in document order; the
 * reads through its item refs in the test document's processing of a variable the engine holds no
 * value of; and the refusals of the section documents it reaches, judged under it.
 */
interface TestJudgement {
  /**
   * Each of the test document's own item refs that names an LTI link, which the delivered test
   * marks and leaves out (reading 110).
   */
  readonly links: readonly LtiLink[];
  readonly reached: readonly ReachedSection[];
  /**
   * Each read through an item ref in the test document's outcome processing or in a template
   * default of one of its item refs of a variable the engine holds no value of, an item's context
   * variable or any variable of an LTI link ({@link unheldReadsIn}), which the delivered test
   * marks.
   */
  readonly reads: readonly UnheldRead[];
  readonly refs: ReadonlyMap<string, string>;
  readonly refusals: readonly Refusal[];
  /**
   * The refusals of the section documents the test places, judged under the test: each section ref
   * that returns to a document on its chain, then, for each placement in the order the walk places
   * them, the identifiers its document gives again across the test's reach, at its first placement,
   * its references', those of its expressions that only the test's scope and typed reach give, and
   * its branch rules', each at the section document, in its document order, each given once
   * however many placements give it.
   */
  readonly sections: readonly Refusal[];
}

/**
 * Judge one test document of the package: each item ref resolved against the test's path to an item
 * resource or an LTI link resource the manifest lists ({@link structureIn}), its variable mappings
 * by {@link judgeMappings}
 * and its template defaults by {@link judgeTemplateDefaults}, each dotted reference by reading 48
 * ("a dotted reference is accepted when exactly one reading names a real item ref, test part or
 * section and its variable"), then the test's processing through its typed reach, then its branch
 * rules over the assembled test (reading 87, {@link judgeBranches}).
 *
 * The test's reach is its own parts, sections and item refs and those of each section document it
 * places through its section refs ({@link assemble}), each item ref of a section document resolved
 * against that document's path. A part, section or item ref identifier is given once across the
 * reach: one a section document gives again after the test or a document reached before gave it is
 * `duplicate-identifier` at that document and left out of the reach, so the first wins
 * ({@link repeatsIn}; pantry's `structure-identifier`), so a later item ref never shadows a part's
 * or a section's `duration`; a section document placed twice gives its identifiers once (reading
 * 86). The test's dotted references resolve through the rest and through the test's own variables:
 * a name the test declares whole, as an outcome or context variable (reading 37 lets an identifier
 * hold `.`), or holds as a built-in, is its unsplit reading, which counts beside every other
 * (reading 48, "the unsplit reading counts among them"). A reading through an item ref, part or
 * section reads one placement of its document: from inside that document, the placement being
 * judged; from inside a placement of it that holds the placement being judged, that one; and from
 * outside it, each placement, so a reference from outside a section document placed twice reads it
 * twice and is `ambiguous-reference` (reading 86; pantry refuses a reading through a name two
 * placements give wherever the reference stands, `Prefixed_reference`, an agreement difference).
 * Which of these a placement reads from is read from the placements above it (`viewsAt` within
 * it), and a placement that stands for several chains of documents is judged each way they give,
 * once for each answer those ways give (`waysOf`), never once for each way, so a name read through
 * many documents costs what its readings do. Another document's placements are counted up to 2,
 * once or more than once, which is all reading 48 asks of them. An item ref a selection with
 * replacement can repeat in that placement, in its own document or above the section ref that
 * places it, is repeatable there, and only through one does a numbered reading count (reading 88).
 * A name with no `.` is the test's own check's; every other is judged by {@link judgeReference}. An
 * item ref resolves a reading only through an item whose document the package holds and the reader
 * read, so a reference through any other names nothing, as pantry's reach holds no such item ref.
 * Only the test's own item refs are its items (`refs`): a session delivers no section document's
 * item, and the test model marks a processing that reads through one.
 *
 * The test's expressions are then judged by the item's processing rules (`processingRefusals` in
 * `#plate/validate/rules.ts`: P20 to P24), with each prefixed read typed by the variable its one
 * counting reading reads, as pantry's `typePrefixed` types it, and a name no reading or two
 * readings count for typed unknown, so it keeps its reading's refusal alone; with each unweighted
 * `qti-test-variables` with no `base-type` typed from the declarations of the reach's items
 * ({@link collectedBaseType}; G-R3 199); and with each template default judged against the
 * template variable it sets. Only what that typed run adds is reported (Admission A5): the same
 * rules over the test alone, every prefixed read unknown, are the test document's own verdict's,
 * and a refusal the references already gave is not given again. A reached section document's item
 * refs are judged once for the package ({@link judgeReached}).
 *
 * Each placement of a section document, one for each context the test places it under
 * ({@link assemble}), is then judged under the test, as the qti package places a test or section
 * document once per instance of every test that places it (its law
 * `Prefixed_reference` and its `Instance` tree, `packages/pantry/src/qti/expressions.ts` and
 * `packages/pantry/src/qti/tests.ts`), since its references "resolve once for each test that
 * includes the section, not once for the section on its own" (reading 5) and a fragment a section
 * document places "is judged in the test that places it, once per placement" (reading 145): its
 * dotted references by {@link judgeReference} against the test's reach from that placement, the
 * test's own variables among their readings, its expressions by the item's processing rules under
 * the test's processing scope, its declarations and built-ins, with the test's typed reach from
 * that placement, its collections typed from the reach's items, and each of the section document's
 * template defaults judged against the template variable it sets, and its branch rules over the
 * assembled test. Each refusal is at the section document, and given once however many placements
 * give it. As for the test, only what that run adds is reported: the same rules over the section
 * alone, every name unknown, are the section document's own verdict's, and so are the branch
 * refusals its own check already gives. Its references and expressions read a placement only
 * through its document, its replacement and the views it takes of the other documents they read,
 * so they are judged once for each of those, not once for each placement: a document many parts
 * place is judged once for them all unless the documents above it differ; only its branch rules,
 * which read the placement's part, are judged for each placement.
 *
 * An item ref that names an LTI link resource in place of an item (reading 110, "an item ref may
 * name an LTI link instead of an item") resolves, and the package declares nothing a link reports:
 * a reading through it names a built-in every item has as that built-in, and any other name
 * unchecked, which no kind or type rule judges (reading 106, "an item ref that names an LTI link
 * has no item whose declarations a prefix reads, so a prefixed reference through it is accepted
 * unchecked, a recorded limit"); its variable mappings' sources are judged by no rule, their
 * targets only against one another and the session variables (reading 97), and each of its
 * template defaults is `undeclared-variable` (reading 110, "under an item ref that names an LTI
 * link a variable mapping is accepted unchecked, a recorded limit, and a template default is
 * refused"). A source that listed the outcomes a link reports would lift the limit. The test
 * document's own item refs that name one are its `links`, which the delivered test marks `lti-link`
 * and leaves out, and none of them is among its `refs`: plate launches no LTI link, so a session
 * delivers the test without it.
 *
 * Last, it finds each read in the test document's processing, its outcome processing and its item
 * refs' template defaults, through an item ref of a variable the engine holds no value of
 * ({@link unheldReadsIn}): a name the test does not hold whole whose one counting reading reads a
 * variable the item declares in a `qti-context-declaration`, directly or in the numbered form, the
 * built-in `QTI_CONTEXT` (reading 106, "a prefixed reference reaches every built-in variable its
 * item ref's item holds, `QTI_CONTEXT` among them"), or any variable through an item ref that names
 * an LTI link, which no session delivers, or any variable through an item ref, part or section a
 * reached section document writes, whose items no session delivers. The engine holds no value of
 * any of them, so the delivered test marks the processing that reads it, where the test model,
 * which reads no item, would hold it. A read in a reached section document is left alone: a
 * session delivers none of its items.
 *
 * @param assembled The test, as its own placement, and its assembly ({@link assembleTests}).
 * @param documents The package's documents.
 * @returns Its own item refs' item paths, its own item refs that name an LTI link, the section
 *   documents it reaches, its refusals and theirs under it, and its reads through an item ref that
 *   the engine holds no value of.
 */
const judgeTest = (
  { assembly, test }: AssembledTest,
  documents: ReadonlyMap<string, Document>,
): TestJudgement => {
  const { path: testPath, source, structure: own } = test;
  const { children, counts, cycles, placements } = assembly;
  const { durations, flags, itemRefs, names, placedAt, reached, repeats, written } = reachOf(
    test,
    assembly,
  );
  const parents = new Map<Placement, Placement[]>();
  for (const [parent, placed] of children) {
    for (const { placement } of placed) {
      const above = parents.get(placement) ?? [];
      above.push(parent);
      parents.set(placement, above);
    }
  }

  const graph: PlacementGraph = { children, counts, parents, placedAt, placements, test };
  const branching = branchIndex(graph, names);
  const items = itemsOf(itemRefs, documents);
  const variablesFor = variablesThrough(own.targets, documents);
  const mappingRefusals = judgeMappings(source.location, own.visits, variablesFor);
  const defaults = judgeTemplateDefaults(source.location, own.visits, variablesFor);
  const whole = wholeOf(source);
  const reachers = new Map<Placement, ReadonlySet<Placement>>();
  // Each placement's views of each other document it reads ({@link viewsAt}), by path.
  const viewsBy = new Map<Placement, Map<string, readonly DocumentView[]>>();
  // Which placements lie on every way down to which, built when a view first needs it.
  let dominance: Dominance | undefined;
  // The placement being judged, the test's first, and the view each reading takes of each document
  // it reads for one way that placement may read them ({@link waysOf}): the scope reads both, so it
  // is read only while that placement is judged.
  let here = test;
  let chosen: ReadonlyMap<string, DocumentView> = new Map();
  // While a section document's references and processing are judged from a placement, the views
  // each other document took ({@link viewsAt}), by path, in the order first taken; else none.
  let taken: Map<string, readonly DocumentView[]> | undefined;
  /**
   * Give the views the placement being judged takes of another document's placements
   * ({@link viewsAt}), from the placements above it.
   *
   * @param path The document's path.
   * @param above The placements above the placement being judged, it included.
   * @returns The views, at least one.
   */
  const viewsFrom = (path: string, above: ReadonlySet<Placement>): readonly DocumentView[] => {
    const there = placedAt.get(path) ?? [];
    // The document's placements above this one, read from the smaller side.
    const lying =
      above.size < there.length
        ? [...above].filter((one) => one.path === path)
        : there.filter((one) => above.has(one));
    let outside = lying.length === 0;
    if (!outside) {
      const known = dominance ?? dominanceOf(graph);
      dominance = known;
      outside = reachedAround(graph, known, here, lying);
    }

    return [
      ...(outside ? [{ from: "outside" } as const] : []),
      ...[false, true]
        .filter((replaced) => lying.some((one) => one.replaced === replaced))
        .map((replaced) => ({ from: "inside", replaced }) as const),
    ];
  };
  /**
   * Give the ways the placement being judged may read the placements of another document (reading
   * 86): from inside each placement of it that lies above this one, by its replacement, and from
   * outside it when the test reaches this placement through no placement of it. Once loops are
   * refused the placements form no cycle, so both read only the placements above this one
   * ({@link reachingAny}, once for each placement), the document's among them: the test reaches
   * this one through none of those unless they lie across every way down to it, which they alone
   * decide ({@link reachedAround}), with no walk of every placement for each document read. Each
   * placement's views of a document are found once.
   *
   * @param path The document's path.
   * @returns The views, at least one.
   */
  const viewsAt = (path: string): readonly DocumentView[] => {
    const above = reachers.get(here) ?? reachingAny(graph, [here]);
    reachers.set(here, above);

    const byPath = viewsBy.get(here) ?? new Map<string, readonly DocumentView[]>();
    viewsBy.set(here, byPath);

    const views = byPath.get(path) ?? viewsFrom(path, above);
    byPath.set(path, views);
    taken?.set(path, views);

    return views;
  };
  /**
   * Give the placements a reading through an item ref, part or section of another document reads
   * under one view of that document ({@link ReferenceScope}): the one it is read from inside, or,
   * from outside it, every placement of it, counted up to 2, each with whether a selection with
   * replacement can repeat the item ref there.
   *
   * @param at Where the element is written.
   * @param view The view of its document.
   * @returns Whether each placement read can repeat it.
   */
  const placementsUnder = (at: WrittenAt, view: DocumentView): readonly boolean[] =>
    (view.from === "inside" ? [view.replaced] : (flags.get(at.document) ?? [])).map(
      (replaced) => at.replaced || replaced,
    );
  const scope: ReferenceScope = {
    durations,
    items,
    placements: (identifier) => {
      const at = written.get(identifier);
      if (at === undefined) {
        return [];
      }

      if (at.document === here.path) {
        return [here.replaced || at.replaced];
      }

      return placementsUnder(
        at,
        chosen.get(at.document) ?? viewsAt(at.document)[0] ?? { from: "outside" },
      );
    },
    whole,
  };
  /**
   * Give one way the placement being judged may read a name for each answer its readings may give
   * ({@link waysThrough}), each the first such way, in the order a list of every way meets each
   * answer first: one view ({@link viewsAt}) of each document other than its own that a dot of the
   * name splits it at an element of, the documents in the order the name's dots first reach them.
   * A placement's ways are the union of those of the chains of documents it stands for, so a name
   * whose readings read one document, as one almost always does, is judged by exactly the readings
   * each such chain gives it. Every way that gives an answer gives the same readings' prefixes and
   * variables, so each consumer reads the same of one as of all; and the ways are found without
   * being listed, so a name read through many documents costs no more than its readings do.
   *
   * @param name The name.
   * @returns The ways, each the view each document takes, at least one unless a document has no
   *   view.
   */
  const waysOf = (name: string): readonly ReadonlyMap<string, DocumentView>[] => {
    const paths: string[] = [];
    const views: (readonly DocumentView[])[] = [];
    const indices = new Map<string, number>();
    /**
     * Give the index of a document a dot reaches, met now or before.
     *
     * @param path The document's path.
     * @returns Its index.
     */
    const documentIndex = (path: string): number => {
      const known = indices.get(path);
      if (known !== undefined) {
        return known;
      }

      indices.set(path, paths.length);
      paths.push(path);
      views.push(viewsAt(path));

      return paths.length - 1;
    };
    // A slot of the placement's own document, or the unsplit reading, reads no other document, so
    // its document is the last, of one view, which no way names.
    const fixed = -1;
    const slots: ReadingSlot[] = whole.has(name) ? [{ counts: [1], document: fixed }] : [];
    for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
      const prefix = name.slice(0, dot);
      const at = written.get(prefix);
      if (at !== undefined) {
        const document = at.document === here.path ? fixed : documentIndex(at.document);
        for (const [form] of Option.toArray(variableOf(scope, prefix, name.slice(dot + 1)))) {
          slots.push({
            counts:
              document === fixed
                ? [countedOf(form, [here.replaced || at.replaced])]
                : (views[document] ?? []).map((view) => countedOf(form, placementsUnder(at, view))),
            document,
          });
        }
      }
    }

    return waysThrough(
      [...views.map((viewed) => viewed.length), 1],
      slots.map((slot) => (slot.document === fixed ? { ...slot, document: paths.length } : slot)),
    ).map(
      (way) =>
        new Map(
          paths.map(
            (path, index) =>
              [path, views[index]?.[way[index] ?? 0] ?? ({ from: "outside" } as const)] as const,
          ),
        ),
    );
  };
  /**
   * Read a name each way the placement being judged may read it ({@link waysOf}).
   *
   * @param name The name.
   * @param read What to read of it, under one way.
   * @returns What each way gives.
   */
  const eachWay = <A>(name: string, read: () => A): readonly A[] =>
    waysOf(name).map((way) => {
      chosen = way;
      const result = read();
      chosen = new Map();

      return result;
    });
  /**
   * Report whether the test holds a variable by a name, as it must for a `pattern`'s braced name to
   * reference it (ruling R1).
   *
   * @param name The name.
   * @returns Whether the test declares it whole, holds it as a built-in, or resolves it by a
   *   reading, some way the placement being judged may read it.
   */
  const held = (name: string): boolean =>
    whole.has(name) || eachWay(name, () => readingsOf(scope, name).length > 0).includes(true);

  /**
   * Judge each dotted reference of a test or section document's elements by reading 48 ("a dotted
   * reference is accepted when exactly one reading names a real item ref, test part or section and
   * its variable") against the test's reach from the placement being judged, the test's own
   * variables included.
   *
   * @param document The document's location.
   * @param visits The visits of its elements, in document order.
   * @returns The refusals, in document order.
   */
  const judgeReferences = (document: string, visits: readonly Visit[]): readonly Refusal[] =>
    visits.flatMap((visit) =>
      referencesOf(visit.element, held).flatMap((reference) =>
        reference.identifier.includes(".")
          ? unionOf(
              eachWay(reference.identifier, () =>
                judgeReference(document, visit, reference, scope),
              ),
            )
          : [],
      ),
    );
  const references = judgeReferences(source.location, own.visits);

  /**
   * Type a prefixed read by the variable its one resolving reading reads, from the placement being
   * judged.
   *
   * @param name The prefixed read.
   * @returns Its type, unknown when no reading or two readings resolve it.
   */
  const typed: PrefixedTyper = (name) =>
    eachWay(name, () => readingsOf(scope, name)).find((readings) => readings.length === 1)?.[0]
      ?.variable.type ?? unknownType;
  /**
   * Type what an unweighted `qti-test-variables` with no `base-type` collects, from the reach's
   * items (G-R3 199).
   *
   * @param name The `variable-identifier`.
   * @returns The base type.
   */
  const collected: CollectedTyper = (name) => collectedBaseType(items, name);
  const processing = notHeld(
    processingRefusals(
      source,
      tables,
      typed,
      (templateDefault) => Option.fromUndefinedOr(defaults.targets.get(templateDefault)),
      Option.none(),
      collected,
    ),
    [...processingRefusals(source, tables, () => unknownType), ...references],
  );
  const branches = notHeld(judgeBranches(branching, test, true), ownRefusals(documents, testPath));

  /**
   * Report whether a name the test's processing reads names, through an item ref, part or section,
   * a variable the engine holds no value of: the test does not hold it whole, and its one counting
   * reading reads a context variable, one its item declares in a `qti-context-declaration` or the
   * built-in `QTI_CONTEXT` (reading 106), reads through an item ref that names an LTI link, whose
   * variables no session holds, or reads through a prefix a section document writes, whose items
   * no session delivers.
   *
   * The test model reads no item, so it holds a name whose reading through the test's own part,
   * section or item ref counts in the test document alone (`isPrefixedHeld` in
   * `#plate/model/test.ts`): `a.2.SCORE` through an own `a` a selection with replacement can
   * repeat, or `x.y.SCORE` through an own `x.y`. Where that ref's item declares no such variable,
   * the package counts only the section document's `a.2` or `x`, so the engine would find no
   * reading of it. A name the test model already marks, as it marks `I1.SCORE` through a section
   * document's `I1`, is marked once ({@link withUnheldReads}).
   *
   * @param name The name.
   * @returns Whether it does.
   */
  const isUnheld = (name: string): boolean => {
    if (whole.has(name)) {
      return false;
    }

    return eachWay(name, () => {
      const [only, ...others] = readingsOf(scope, name);

      return (
        only !== undefined &&
        others.length === 0 &&
        (only.variable.kind === "context" ||
          itemRefs.get(only.prefix)?.link === true ||
          (written.get(only.prefix)?.document ?? testPath) !== testPath)
      );
    }).includes(true);
  };
  const reads = unheldReadsIn(source, own.visits, isUnheld);

  // What each section document gives the same in every placement: the targets of its template
  // defaults, and its processing's refusals alone.
  const once = new Map<
    string,
    {
      readonly alone: readonly Refusal[];
      readonly targets: ReadonlyMap<SourceElement, ExpressionType>;
    }
  >();
  // Each section document's references and typed processing judged from a placement, by the
  // document's path and the placement's replacement, then by the other documents those judgements
  // read, then by the views each of those documents took (see `judgedFrom`).
  const judged = new Map<string, Map<string, ViewedJudgements>>();
  /**
   * Judge a section document's dotted references by reading 48 and its expressions by the item's
   * processing rules under the test's scope and typed reach, from the placement being judged, or
   * give what an earlier placement of the document gave when the two read alike.
   *
   * Those judgements read the placement only through its document, its replacement and the view
   * ({@link viewsAt}) each other document a reference reads through takes from it: its part and
   * whether its order is drawn are read by the branch rules alone, and the documents above it only
   * through those views. So each is judged once for each document, replacement and set of views,
   * not once for each placement: several parts that place one document, each through its own
   * section ref, give it one placement for each part, and each reads it alike unless the documents
   * above it differ, as when one part places it through a document placed twice and another places
   * it directly (reading 86). The views a judgement took are recorded as it runs, so a later
   * placement reuses it only when every one of those documents takes the same views from it, and
   * the judgement, a function of the document, the replacement and those views, would give the
   * same.
   *
   * @param placement The placement being judged.
   * @param judgeAll The judgements, from the placement being judged.
   * @returns What the document's references and typed processing give from it.
   */
  const judgedFrom = (placement: Placement, judgeAll: () => SectionJudgement): SectionJudgement => {
    const key = JSON.stringify([placement.path, placement.replaced]);
    const byRead = judged.get(key) ?? new Map<string, ViewedJudgements>();
    judged.set(key, byRead);
    for (const { byViews, read } of byRead.values()) {
      const earlier = byViews.get(viewsKey(read.map((path) => viewsAt(path))));
      if (earlier !== undefined) {
        return earlier;
      }
    }

    taken = new Map();
    const judgement = judgeAll();
    const read = [...taken];
    taken = undefined;
    const readKey = JSON.stringify(read.map(([path]) => path));
    const group = byRead.get(readKey) ?? {
      byViews: new Map<string, SectionJudgement>(),
      read: read.map(([path]) => path),
    };
    group.byViews.set(viewsKey(read.map(([, views]) => views)), judgement);
    byRead.set(readKey, group);

    return judgement;
  };
  /**
   * Judge one placement of a section document under the test, the placement being judged: at its
   * document's first placement, the identifiers it gives again across the reach; its references',
   * those of its expressions that only the test's scope and typed reach give ({@link judgedFrom}),
   * and its branch rules', beyond those its own verdict already gives.
   *
   * @param placement The placement.
   * @returns The refusals, at the section document, in its document order.
   */
  const judgePlacement = (placement: Placement): readonly Refusal[] => {
    const { path, source: section, structure } = placement;
    const known = once.get(path);
    const { alone, targets } = known ?? {
      alone: processingRefusals(section, tables, () => unknownType),
      targets: judgeTemplateDefaults(
        section.location,
        structure.visits,
        variablesThrough(structure.targets, documents),
      ).targets,
    };
    once.set(path, { alone, targets });

    const { processing: sectionProcessing, references: sectionReferences } = judgedFrom(
      placement,
      () => {
        const read = judgeReferences(section.location, structure.visits);

        return {
          processing: notHeld(
            processingRefusals(
              section,
              tables,
              typed,
              (templateDefault) => Option.fromUndefinedOr(targets.get(templateDefault)),
              Option.some(source),
              collected,
            ),
            [...alone, ...read],
          ),
          references: read,
        };
      },
    );

    return [
      ...(known === undefined
        ? structure.identifiers.flatMap(({ element }) =>
            Option.toArray(Option.fromUndefinedOr(repeats.get(element))),
          )
        : []),
      ...sectionReferences,
      ...sectionProcessing,
      ...notHeld(
        judgeBranches(branching, placement, known === undefined),
        ownRefusals(documents, path),
      ),
    ];
  };
  // Each placement's refusals beyond those given so far, counted once across the placements.
  const sections: Refusal[] = [...cycles];
  const given = holding(cycles);
  for (const placement of placements.slice(1)) {
    here = placement;
    sections.push(...given.keep(judgePlacement(placement)));
  }

  return {
    links: own.links,
    reached,
    reads,
    refs: new Map(
      own.itemRefs.flatMap(({ identifier, link, path }) =>
        link ? [] : [[identifier, path] as const],
      ),
    ),
    refusals: [
      ...own.unresolved,
      ...mappingRefusals,
      ...defaults.refusals,
      ...references,
      ...processing,
      ...branches,
    ],
    sections,
  };
};

/**
 * Judge the item refs and section refs of a section document the manifest lists, once for the
 * package, whether a test reaches it or not and however many placements and tests reach it: each
 * item ref that names neither an item nor an LTI link is `item-ref-unresolved` and each section ref
 * that names no path inside the package is `package-path-outside` with `check: "remote-section"`
 * (reading 170), as the test's own are ({@link structureIn}); then their variable mappings by
 * {@link judgeMappings} and their template defaults by {@link judgeTemplateDefaults}, against the
 * item each resolves to from the section document's path, each refusal at the section document, as
 * pantry contains a mapping's source and a default's target in its item ref's item's declarations
 * (the `Template default target` and `Variable mapping source` laws in
 * `packages/pantry/src/qti/expressions.ts`). Pantry's rows are per node of every document it
 * imports, placed or not (its `Remote section ref` law and `Site` relation,
 * `packages/pantry/src/qti/tests.ts`), so a section document no test reaches is judged here alike.
 * What reads its expressions under a test's scope is the reaching test's alone ({@link judgeTest}),
 * so for a section document no test reaches only its own verdict judges them.
 *
 * @param section The section document, with what it holds, read from its own path.
 * @param documents The package's documents.
 * @returns The refusals: the unresolved refs', the mappings', then the template defaults', each in
 *   document order.
 */
const judgeReached = (
  section: ReachedSection,
  documents: ReadonlyMap<string, Document>,
): readonly Refusal[] => {
  const { location } = section.source;
  const { targets, unresolved, visits } = section.structure;
  const variablesFor = variablesThrough(targets, documents);

  return [
    ...unresolved,
    ...judgeMappings(location, visits, variablesFor),
    ...judgeTemplateDefaults(location, visits, variablesFor).refusals,
  ];
};

/**
 * Give the paths of the documents the manifest's resources of one type name, each once, in the
 * manifest's order.
 *
 * @param manifest The manifest.
 * @param type The resource type.
 * @returns The paths.
 */
const pathsOfType = (manifest: Manifest, type: string): readonly string[] => [
  ...new Set(
    manifest.resources
      .filter((resource) => resource.type === type)
      .flatMap((resource) => Option.toArray(documentPath(resource))),
  ),
];

/**
 * Give the verdict on the document at a path, none when the package holds none there or does not
 * read it as a type plate judges ({@link readAs}).
 *
 * @param documents The package's documents.
 * @param path The document's path.
 * @returns Its verdict.
 */
const verdictAt = (
  documents: ReadonlyMap<string, Document>,
  path: string,
): Option.Option<Verdict> =>
  Option.fromUndefinedOr(documents.get(path)).pipe(Option.flatMap((document) => document.verdict));

/**
 * Give the accepted test of a verdict that accepts a test.
 *
 * @param verdict The verdict.
 * @returns The test, none for any other verdict.
 */
const acceptedTest = (verdict: Verdict): Option.Option<AcceptedTest> =>
  (verdict.verdict === "accepted" || verdict.verdict === "accepted-with-unsupported") &&
  verdict.kind === "test"
    ? Option.some(verdict.accepted)
    : Option.none();

/**
 * Give the accepted stimulus of a verdict that accepts a stimulus.
 *
 * @param verdict The verdict.
 * @returns The stimulus, none for any other verdict.
 */
const acceptedStimulus = (verdict: Verdict): Option.Option<AcceptedStimulus> =>
  (verdict.verdict === "accepted" || verdict.verdict === "accepted-with-unsupported") &&
  verdict.kind === "stimulus"
    ? Option.some(verdict.accepted)
    : Option.none();

/**
 * Key what each of some paths finds by its document's location, passing over a path that finds
 * nothing, and keeping the first of two that find one document.
 *
 * @param paths The paths, in order.
 * @param find What a path finds.
 * @param documentOf The location of what was found.
 * @returns What each path found, keyed by its location, in the paths' order.
 */
const byDocument = <A>(
  paths: readonly string[],
  find: (path: string) => Option.Option<A>,
  documentOf: (found: A) => string,
): ReadonlyMap<string, A> => {
  const found = new Map<string, A>();
  for (const value of paths.flatMap((path) => Option.toArray(find(path)))) {
    if (!found.has(documentOf(value))) {
      found.set(documentOf(value), value);
    }
  }

  return found;
};

/**
 * Build the contents of an accepted package from its judged documents.
 *
 * Each test is delivered as its document's own verdict accepted it, unless one of its item refs
 * names an LTI link or its processing reads, through an item ref, a variable the engine holds no
 * value of. Each such item ref is then marked `lti-link` and left out, with each expression of its
 * outcome processing that counts over the test's items marked and that processing `marked`
 * (`withLtiLinks` in `#plate/model/test.ts`, read from the test's document, which every judged
 * document holds), and each such processing marked (`withUnheldReads`), the outcome processing
 * `marked` and each template default that reads one left out.
 *
 * @param manifest The manifest.
 * @param documents The package's documents, every judged one accepted.
 * @param tests What judging each test gave, its item paths, by item ref identifier, its item refs
 *   that name an LTI link, and its reads of a variable the engine holds no value of, keyed by the
 *   test's path.
 * @param location The package's location.
 * @returns The contents.
 */
const contentsOf = (
  manifest: Manifest,
  documents: ReadonlyMap<string, Document>,
  tests: ReadonlyMap<string, Pick<TestJudgement, "links" | "reads" | "refs">>,
  location: string,
): PackageContents => {
  /**
   * Give the accepted item of the document at a path.
   *
   * @param path The document's path.
   * @returns Its item, none when no accepted item document is there.
   */
  const itemAt = (path: string): Option.Option<Accepted> =>
    verdictAt(documents, path).pipe(Option.flatMap(acceptedItem));

  const withheld = new Set(
    manifest.resources.flatMap((resource) =>
      qtiTypes.has(resource.type) ? withheldFiles(resource) : [],
    ),
  );

  return {
    files: new Set(
      manifest.resources.flatMap((resource) =>
        resource.files.flatMap((file) =>
          Option.toArray(file.path).filter((path) => !withheld.has(path)),
        ),
      ),
    ),
    items: byDocument(
      pathsOfType(manifest, "imsqti_item_xmlv3p0"),
      itemAt,
      (item) => item.document,
    ),
    location,
    stimuli: byDocument(
      pathsOfType(manifest, "imsqti_stimulus_xmlv3p0"),
      (path) => verdictAt(documents, path).pipe(Option.flatMap(acceptedStimulus)),
      (stimulus) => stimulus.document,
    ),
    tests: byDocument(
      pathsOfType(manifest, "imsqti_test_xmlv3p0"),
      (path) =>
        Option.all([
          verdictAt(documents, path).pipe(Option.flatMap(acceptedTest)),
          Option.fromUndefinedOr(documents.get(path)).pipe(
            Option.flatMap((document) => Result.getSuccess(document.source)),
          ),
        ]).pipe(
          Option.map(([test, source]): PackageTest => {
            const links = tests.get(path)?.links ?? [];
            const reads = tests.get(path)?.reads ?? [];

            return {
              items: new Map(
                [...(tests.get(path)?.refs ?? new Map<string, string>())].flatMap(
                  ([identifier, itemPath]) =>
                    Option.toArray(
                      itemAt(itemPath).pipe(Option.map((item) => [identifier, item] as const)),
                    ),
                ),
              ),
              test:
                links.length === 0 && reads.length === 0
                  ? test
                  : acceptMarkedTest(
                      test,
                      withUnheldReads(withLtiLinks(test.test, links, source), reads),
                    ),
            };
          }),
        ),
      (entry) => entry.test.document,
    ),
    version: manifest.version,
  };
};

/**
 * One test document of a package with its assembled test ({@link assemble}).
 */
interface AssembledTest {
  readonly assembly: Assembly;
  /**
   * The test document's own placement, under no part.
   */
  readonly test: Placement;
}

/**
 * Assemble each test document of a package, in the manifest's order, before any is judged, with one
 * count across them toward the package's assembly limit ({@link assemblyPlacementLimit},
 * {@link assemblyByteLimit}): the first test whose assembly passes a bound stops the count, and the
 * package is refused with that one `assembly-limit` refusal, whichever test passed it, so whether
 * it is refused never depends on the manifest's order. No test is judged then, and refusing costs
 * what reaching the bound does. A section document's size is its file's, in bytes, and the tests
 * share one reading of each section document ({@link sectionReader}).
 *
 * @param manifest The manifest.
 * @param documents The package's documents.
 * @param refTargets What a ref may resolve to.
 * @param sectionPaths The path of every section resource's document.
 * @param held The package's files, keyed by normal form.
 * @param location The package's location.
 * @returns Each test document, by path, with its assembly, or the `assembly-limit` refusal.
 */
const assembleTests = (
  manifest: Manifest,
  documents: ReadonlyMap<string, Document>,
  refTargets: RefTargets,
  sectionPaths: ReadonlySet<string>,
  held: ReadonlyMap<string, Uint8Array>,
  location: string,
): Result.Result<ReadonlyMap<string, AssembledTest>, Refusal> => {
  const tests = new Map<string, AssembledTest>();
  const readAt = sectionReader(sectionPaths, refTargets, documents);
  // A section document the walk places is one the reader read, so the package holds its file.
  const sizeOf = (path: string): number => held.get(path)?.byteLength ?? 0;
  let placed: Placed = { bytes: 0, placements: 0 };
  for (const path of pathsOfType(manifest, "imsqti_test_xmlv3p0")) {
    const source = documents.get(path)?.source;
    if (
      source !== undefined &&
      Result.isSuccess(source) &&
      source.success.root.namespace === qtiNamespace &&
      source.success.root.local === "qti-assessment-test"
    ) {
      const structure = structureIn(source.success, path, refTargets);
      const test: Placement = {
        layout: layoutOf(structure.visits),
        mixes: false,
        part: Option.none(),
        path,
        replaced: false,
        source: source.success,
        structure,
      };
      const assembly = assemble(test, readAt, { location, placed, sizeOf });
      if (Result.isFailure(assembly)) {
        return Result.fail(assembly.failure);
      }

      ({ placed } = assembly.success);
      tests.set(path, { assembly: assembly.success, test });
    }
  }

  return Result.succeed(tests);
};

/**
 * Judge a package whose manifest is read: the file rules, the documents, the roots, the LOM
 * metadata, the tests and the section documents they reach, the refs of every section document
 * the manifest lists ({@link judgeReached}), then the verdict over them. Every test is assembled
 * before any is judged ({@link assembleTests}); past the assembly limit no test and no section
 * document is judged, and the one `assembly-limit` refusal stands in place of their refusals,
 * beside every other rule's.
 *
 * @param manifest The manifest.
 * @param lom Each resource's LOM generals, keyed by its location.
 * @param files The package's files, as the host gave them.
 * @param held The package's files, keyed by normal form.
 * @param location The package's location.
 * @returns The package's verdict.
 */
const judgeContents = Effect.fnUntraced(function* judgeContents(
  manifest: Manifest,
  lom: ReadonlyMap<string, readonly LomGeneral[]>,
  files: ReadonlyMap<string, Uint8Array>,
  held: ReadonlyMap<string, Uint8Array>,
  location: string,
): Effect.fn.Return<PackageVerdict> {
  const fileRules = checkFiles(manifest, files, location);
  const documents = yield* readDocuments(manifest, held, location);
  const kinds = new Map([
    ...ltiLinkTypes.flatMap((type) =>
      pathsOfType(manifest, type).map((path) => [path, "lti-link"] as const),
    ),
    ...pathsOfType(manifest, "imsqti_item_xmlv3p0").map((path) => [path, "item"] as const),
  ]);
  const sectionPaths = new Set(pathsOfType(manifest, "imsqti_section_xmlv3p0"));
  const refTargets: RefTargets = {
    factsOf: directoryFacts(foldersOf([...kinds.keys(), ...sectionPaths])),
    kinds,
  };
  const tests = new Map<string, Pick<TestJudgement, "links" | "reads" | "refs">>();
  const assembled = assembleTests(manifest, documents, refTargets, sectionPaths, held, location);
  const testRefusals: Refusal[] = [];
  // Each test's section refusals beyond those an earlier test gave, counted once across the tests.
  const underTests: Refusal[] = [];
  const heldUnderTests = holding([]);
  const reached = new Map<string, ReachedSection>();
  for (const [path, test] of Result.getOrElse(assembled, () => new Map<string, AssembledTest>())) {
    const judged = judgeTest(test, documents);
    tests.set(path, judged);
    testRefusals.push(...judged.refusals);
    underTests.push(...heldUnderTests.keep(judged.sections));
    for (const section of judged.reached) {
      if (!reached.has(section.path)) {
        reached.set(section.path, section);
      }
    }
  }

  // A section document the manifest lists and no test reaches is judged as a reached one is,
  // after them, in the manifest's order. Past the assembly limit no test is judged, and neither is
  // any section document.
  const unreached = Result.isFailure(assembled)
    ? []
    : [...sectionPaths].flatMap((path): ReachedSection[] =>
        reached.has(path)
          ? []
          : Option.toArray(
              Option.map(sectionDocumentAt(path, sectionPaths, documents), (source) => ({
                path,
                source,
                structure: structureIn(source, path, refTargets),
              })),
            ),
      );
  const sectionRefusals = [...reached.values(), ...unreached].flatMap((section) =>
    judgeReached(section, documents),
  );

  const verdicts = [...documents.values()].flatMap((document) => Option.toArray(document.verdict));
  const resources = manifest.resources.map((resource): PackageResource => {
    const path = documentPath(resource);

    return {
      identifier: resource.identifier,
      path,
      type: resource.type,
      verdict: path.pipe(
        Option.filter((value) => documents.get(value)?.type === resource.type),
        Option.flatMap((value) => verdictAt(documents, value)),
      ),
    };
  });
  const [first, ...rest] = [
    ...(Result.isFailure(fileRules) ? fileRules.failure : []),
    ...checkRoots(manifest, documents, fileLocation(location, manifestFile)),
    ...checkLom(manifest, lom, documents, fileLocation(location, manifestFile)),
    ...(Result.isFailure(assembled) ? [assembled.failure] : []),
    ...testRefusals,
    ...sectionRefusals,
    ...underTests,
    ...checkReferences(
      documents,
      new Set(held.keys()),
      new Set(
        manifest.resources.flatMap((resource) =>
          resource.files.flatMap((file) => Option.toArray(file.path)),
        ),
      ),
    ),
    ...verdicts.flatMap((verdict) => (verdict.verdict === "refused" ? verdict.refusals : [])),
  ];
  if (first !== undefined) {
    return { location, refusals: [first, ...rest], resources, verdict: "refused" };
  }

  if (verdicts.some((verdict) => verdict.verdict === "unchecked")) {
    return { location, resources, verdict: "unchecked" };
  }

  return {
    accepted: acceptPackage(contentsOf(manifest, documents, tests, location)),
    location,
    resources,
    verdict:
      verdicts.some((verdict) => verdict.verdict === "accepted-with-unsupported") ||
      [...tests.values()].some((judged) => judged.links.length > 0 || judged.reads.length > 0)
        ? "accepted-with-unsupported"
        : "accepted",
  };
});

/**
 * The verdict on a package whose reading ends before its documents: refused, with no resources.
 *
 * @param location The package's location.
 * @param refusals Why it ends.
 * @returns The verdict.
 */
const refusedUnread = (
  location: string,
  refusals: Arr.NonEmptyReadonlyArray<Refusal>,
): PackageVerdict => ({ location, refusals, resources: [], verdict: "refused" });

/**
 * Read a package's manifest, then judge the package.
 *
 * @param location The package's location.
 * @param files The package's files, as the host gave them.
 * @returns The package's verdict.
 */
const readPackage = Effect.fnUntraced(function* readPackage(
  location: string,
  files: ReadonlyMap<string, Uint8Array>,
): Effect.fn.Return<PackageVerdict> {
  const held = packageFiles(files, location);
  if (Result.isFailure(held)) {
    return refusedUnread(location, held.failure);
  }

  // `packageFiles` refuses a package without its manifest, so the empty fallback is never read.
  const bytes = held.success.get(manifestFile) ?? new Uint8Array();
  const source = yield* Effect.result(readSource(fileLocation(location, manifestFile), bytes));
  if (Result.isFailure(source)) {
    return refusedUnread(location, [source.failure]);
  }

  const manifest = readManifest(source.success);
  if (Result.isFailure(manifest)) {
    return refusedUnread(location, manifest.failure);
  }

  return yield* judgeContents(
    manifest.success,
    resourceLom(source.success),
    files,
    held.success,
    location,
  );
});

/**
 * Open a package: read its manifest, then judge its files, its documents and its tests, into one
 * verdict over the whole package.
 *
 * It never fails, because a refusal is a verdict. A key that leaves the package's root, a package
 * without `imsmanifest.xml` at its root, a manifest the reader cannot read and a manifest
 * `readManifest` refuses each end the reading with those refusals and no resources. Otherwise every
 * rule runs and every refusal is reported, but where the package's tests assemble past plate's
 * stated limit, 2,048 placements of section documents or 4 MiB of them placed, across all of its
 * tests: then no test and no section document is judged, and one `assembly-limit` refusal stands
 * for them. Nothing but its two inputs decides the result.
 *
 * @param location The package's location as the host named it. Each file's location is it, then
 *   `/`, then the file's path, which each document's verdict and each refusal of a file carry.
 * @param files The package's files keyed by their paths from its root, as the host unzipped them.
 * @returns The verdict on the package.
 */
export const openPackage = Effect.fn("plate.openPackage")(function* openPackage(
  location: string,
  files: ReadonlyMap<string, Uint8Array>,
): Effect.fn.Return<PackageVerdict> {
  yield* Effect.annotateCurrentSpan("package.location", location);

  const verdict = yield* readPackage(location, files);

  yield* Effect.annotateCurrentSpan("package.verdict", verdict.verdict);

  return verdict;
});

/**
 * List a test's item refs in document order, each with its identifier and its `href`, the item refs
 * a session over the test delivers.
 *
 * @param test The accepted test.
 * @returns Its item refs, every part's and section's, in document order.
 */
export const itemRefs = (test: AcceptedTest): readonly ItemRefEntry[] =>
  test.test.parts.flatMap((part) =>
    itemRefsIn(part.children).map(({ href, identifier }) => ({ href, identifier })),
  );

/**
 * Brand a package's contents as accepted, the one named seam through which a test builds an
 * {@link AcceptedPackage} without {@link openPackage}. No production code calls it.
 *
 * @param contents What the package holds.
 * @returns The accepted package.
 */
export const acceptPackageForTest = (contents: PackageContents): AcceptedPackage =>
  acceptPackage(contents);
