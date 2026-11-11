/**
 * The closed value sets: the QTI vocabulary plate models, renders and reads, and the test,
 * package and session vocabulary M2's validators and engine read, as data.
 *
 * Every set is closed: a value outside it is unsupported or invalid, never guessed at. The model
 * builder, the verdict and the emitter read these lists, so what plate renders is decided once.
 *
 * The emitter consults no vocabulary class: what an element does comes from its QTI name,
 * attributes and binding alone. {@link styledClasses} lists the classes `styles.css` presents, and
 * {@link behaviourClasses} those whose meaning needs script, which M1 styles none of.
 *
 * @module
 */
import { Array as Arr, Option } from "effect";
import { controlCap } from "#plate/control-cap.ts";
import { collapseXmlSpace } from "#plate/model/attributes.ts";

/**
 * The eleven QTI base types, as the `base-type` attribute spells them.
 *
 * The value model holds ten of them; a declaration of `file` is a mark (see {@link renders}).
 */
export const baseTypes = [
  "identifier",
  "boolean",
  "integer",
  "float",
  "string",
  "point",
  "pair",
  "directedPair",
  "duration",
  "file",
  "uri",
] as const;

/**
 * A QTI base type.
 */
export type BaseType = (typeof baseTypes)[number];

/**
 * The four QTI cardinalities, as the `cardinality` attribute spells them.
 */
export const cardinalities = ["single", "multiple", "ordered", "record"] as const;

/**
 * A QTI cardinality.
 */
export type Cardinality = (typeof cardinalities)[number];

/**
 * The five shapes of a `qti-area-map-entry`, as its `shape` attribute spells them.
 */
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure.
export const areaShapes = ["circle", "default", "ellipse", "poly", "rect"] as const;

/**
 * The shape of an area a point response is mapped by.
 */
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure.
export type AreaShape = (typeof areaShapes)[number];

/**
 * The QTI names of the four interactions plate renders: Choice (Q-2), Text Entry (Q-20), Extended
 * Text (Q-5) and Inline Choice (Q-12).
 */
export const interactionNames = [
  "qti-choice-interaction",
  "qti-text-entry-interaction",
  "qti-extended-text-interaction",
  "qti-inline-choice-interaction",
] as const;

/**
 * An interaction plate renders, by its QTI name.
 */
export type InteractionName = (typeof interactionNames)[number];

/**
 * The text interactions, Text Entry and Extended Text, which share their bindings and most of
 * their unsupported features.
 */
const textInteractions = ["qti-text-entry-interaction", "qti-extended-text-interaction"] as const;

/**
 * The elements a native `option` can stand for by their text alone (spec §4.6): an Inline Choice
 * whose choices hold only text and these, in the QTI namespace, renders as a `select`. Any other
 * element, such as an `img`, a `br`, a `sub` or MathML, or an entity reference, is content an
 * `option`, which holds only text, cannot show.
 */
const textSafeElements = [
  "span",
  "em",
  "strong",
  "b",
  "i",
  "code",
  "kbd",
  "samp",
  "var",
  "small",
  "big",
  "tt",
  "cite",
  "dfn",
  "abbr",
  "acronym",
  "bdi",
] as const;

/**
 * The declarations whose `base-type` and `cardinality` the model reads: the response, outcome and
 * template declarations.
 */
const declarations = [
  "qti-response-declaration",
  "qti-outcome-declaration",
  "qti-template-declaration",
] as const;

/**
 * The response rules of the engine: `qti-response-condition` with its three branches,
 * `qti-set-outcome-value`, `qti-lookup-outcome-value`, `qti-exit-response`, and
 * `qti-response-processing-fragment`, whose rules run in its place. The expression kinds the engine
 * runs are not listed here: it runs each of the 64 (`expressionKinds` in
 * `#plate/model/expression.ts`), which the item model reads through the registry
 * (`#plate/model/expressions/read.ts`).
 *
 * An inline `qti-response-processing` that uses only these rules and expression kinds becomes a
 * rule tree; one that uses any other element is a mark keyed by that element's name, and one that
 * holds an XInclude `include` is the mark `xi:include`, since it is never fetched.
 */
const engine = [
  "qti-response-condition",
  "qti-response-if",
  "qti-response-else-if",
  "qti-response-else",
  "qti-set-outcome-value",
  "qti-lookup-outcome-value",
  "qti-exit-response",
  "qti-response-processing-fragment",
] as const;

/**
 * The template rules: the six rule elements a `qti-template-processing`, a `qti-template-if`, a
 * `qti-template-else-if` and a `qti-template-else` hold (`qti-set-template-value`,
 * `qti-set-correct-response`, `qti-set-default-value`, `qti-template-condition`,
 * `qti-template-constraint` and `qti-exit-template`), and the three parts of a
 * `qti-template-condition`. The expression kinds they hold are every one the registry reads, as for
 * {@link engine}.
 *
 * The item model reads template processing through these (`templateRules` in
 * `#plate/model/template.ts`): template processing that holds any other element is none, and that
 * element is a mark keyed by its name. This is the one list of these names.
 */
const templateRules = [
  "qti-set-template-value",
  "qti-set-correct-response",
  "qti-set-default-value",
  "qti-template-condition",
  "qti-template-if",
  "qti-template-else-if",
  "qti-template-else",
  "qti-template-constraint",
  "qti-exit-template",
] as const;

/**
 * The rule on the declarations an interaction renders with: the response declaration it binds must
 * have one of `baseTypes` and one of `cardinalities`. The form encoding's public `Binding` is
 * another thing: how one response travels through the form.
 */
export interface BindingRule {
  readonly baseTypes: readonly BaseType[];
  readonly cardinalities: readonly Cardinality[];
}

/**
 * Extended Text's binding, which also limits the `format` it renders with: one of `formats`, or
 * none, which means `plain`.
 */
export interface FormattedBindingRule extends BindingRule {
  readonly formats: readonly string[];
}

/**
 * What makes an element carry an unsupported feature.
 *
 * - `element`: the element itself is present.
 * - `attribute`: the element carries the attribute `name`, with any value. A name in the XML
 *   namespace is spelled with its reserved prefix, `xml:base`.
 * - `attribute-value`: the element's attribute `name` has the value `value`.
 * - `attribute-true`: the element's `xs:boolean` attribute `name` is true: `true` or `1` once its
 *   outer whitespace goes, as XSD reads it (reading Q8).
 * - `integer-above`: the element's attribute `name`, its outer whitespace gone, reads as an integer
 *   greater than `limit`. A value that is not an integer never is.
 * - `not-text-safe`: some descendant of one of the element's `qti-inline-choice` children is neither
 *   text nor a QTI-namespace element named in `elements`; an entity reference is neither. A native
 *   `option` holds only text, so it cannot show that choice.
 * - `refused-pattern`: the element carries the attribute `name`, and the translator refuses its value
 *   as an XML Schema regular expression (`translate` in `#plate/model/regex.ts`), so the pattern
 *   cannot be checked.
 * - `template`: the element's `template` URI resolves to this built-in ({@link templateName}).
 * - `untyped`: the declaration carries no `base-type` and its cardinality is not `record`, the one
 *   cardinality that has none.
 */
export type Condition =
  | { readonly kind: "element" }
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "attribute-value"; readonly name: string; readonly value: string }
  | { readonly kind: "attribute-true"; readonly name: string }
  | { readonly kind: "integer-above"; readonly limit: bigint; readonly name: string }
  | { readonly elements: readonly string[]; readonly kind: "not-text-safe" }
  | { readonly kind: "refused-pattern"; readonly name: string }
  | { readonly kind: "template"; readonly name: TemplateName }
  | { readonly kind: "untyped" };

/**
 * The rule that finds a feature plate does not render: the key the verdict and its notice name
 * the feature by, the elements that can carry it, and the condition under which one does.
 *
 * `on` names the elements that can carry it by their QTI local name, or is `body` for every element
 * in the item body.
 */
export interface FeatureRule {
  readonly feature: string;
  readonly on: "body" | readonly string[];
  readonly when: Condition;
}

/**
 * The "renders" set, which the model builder, the verdict and the emitter read.
 */
export interface Renders {
  /**
   * The interactions plate renders, each with the binding it renders with. A Text Entry or an
   * Extended Text also renders bound to a record response the item model holds, as the string
   * control, since a record has no base type of its own: the text typed gives its fields.
   */
  readonly bindings: {
    readonly "qti-choice-interaction": BindingRule;
    readonly "qti-extended-text-interaction": FormattedBindingRule;
    readonly "qti-inline-choice-interaction": BindingRule;
    readonly "qti-text-entry-interaction": BindingRule;
  };
  /**
   * The features shown as a notice in place of an interaction's Controls. The interaction is still
   * built, every field held, and its Prompt renders; only its Controls give way to the notice, and
   * the verdict lists the feature as one shown as a notice.
   */
  readonly controlNotices: readonly FeatureRule[];
  /**
   * The `qti-*` elements plate renders or reads. They include the engine's response rules, the
   * template declarations, the template processing and its template rules, and
   * `qti-printed-variable`, `qti-template-block` (whose content is its `qti-content-body`'s) and
   * `qti-template-inline`, which the item model holds as body nodes. The item model also reads the
   * element of each of the 64 expression kinds (`expressionKinds` in `#plate/model/expression.ts`).
   * Every element in the QTI namespace without the `qti-` prefix is HTML and renders as itself.
   */
  readonly elements: readonly string[];
  /**
   * The response rules the engine runs. The expression kinds it runs are every one the item model
   * reads.
   */
  readonly engine: readonly string[];
  /**
   * The features recorded on the verdict with no body notice. A declaration the model does not hold
   * carries one: its base type (`file`, or `base-type=""` when it has none) or
   * `cardinality="record"`, which an outcome or template declaration of that cardinality carries,
   * and a record response declaration only when the item model marks it, for a `file` base type of
   * its own or of a field, since the model holds every other. Beyond these, a `qti-*` element
   * outside the item body and outside `elements` is a mark keyed by its own name, response
   * processing by a template URI outside the built-ins is a mark keyed `template="<uri>"`, inline
   * response processing with an element outside `engine` and the expression kinds is a mark keyed
   * by that element's name (an XInclude `include` there is keyed `xi:include`), the text family's
   * reader marks a `qti-pattern-match` literal it cannot compile `pattern`, a `qti-inside`
   * coordinate written with `%` `area-coords-percent`, and every `qti-custom-operator` by its own
   * name, and the template processing reader marks a `qti-set-correct-response` or
   * `qti-set-default-value` that sets a record response `record-set`.
   */
  readonly marks: readonly FeatureRule[];
  /**
   * The features shown as a notice in place of their interaction. Beyond these, a `qti-*` element
   * in the item body outside `elements` is a notice keyed by its own name, which covers the custom
   * interactions (Q-31, Q-32): accepted, not launched.
   */
  readonly notices: readonly FeatureRule[];
  /**
   * The template rules the item model reads template processing through. The expression kinds
   * they hold are every one the item model reads, as for `engine`.
   */
  readonly templateRules: readonly string[];
}

/**
 * What plate renders, reads, shows a notice for and marks, as data.
 *
 * The emitter and the model builder read the same lists, so an element is rendered exactly when
 * the verdict does not name it unsupported.
 */
export const renders = {
  bindings: {
    "qti-choice-interaction": {
      baseTypes: ["identifier"],
      cardinalities: ["single", "multiple"],
    },
    "qti-extended-text-interaction": {
      baseTypes: ["string", "integer", "float"],
      cardinalities: ["single", "multiple", "ordered"],
      formats: ["plain", "preformatted", "xhtml"],
    },
    "qti-inline-choice-interaction": {
      baseTypes: ["identifier"],
      cardinalities: ["single"],
    },
    "qti-text-entry-interaction": {
      baseTypes: ["string", "integer", "float"],
      cardinalities: ["single"],
    },
  },
  controlNotices: [controlCap],
  elements: [
    "qti-assessment-item",
    "qti-response-declaration",
    "qti-outcome-declaration",
    "qti-correct-response",
    "qti-default-value",
    "qti-value",
    "qti-mapping",
    "qti-map-entry",
    "qti-area-mapping",
    "qti-area-map-entry",
    "qti-match-table",
    "qti-match-table-entry",
    "qti-interpolation-table",
    "qti-interpolation-table-entry",
    "qti-item-body",
    "qti-response-processing",
    ...interactionNames,
    "qti-prompt",
    "qti-simple-choice",
    "qti-inline-choice",
    "qti-label",
    "qti-printed-variable",
    "qti-template-block",
    "qti-content-body",
    "qti-template-inline",
    ...engine,
    "qti-template-declaration",
    "qti-template-processing",
    ...templateRules,
  ],
  engine,
  marks: [
    {
      feature: "string-identifier",
      on: textInteractions,
      when: { kind: "attribute", name: "string-identifier" },
    },
    {
      feature: 'adaptive="true"',
      on: ["qti-assessment-item"],
      when: { kind: "attribute-true", name: "adaptive" },
    },
    {
      feature: 'base-type="file"',
      on: declarations,
      when: { kind: "attribute-value", name: "base-type", value: "file" },
    },
    // A record response declaration is the item model's to mark, since this condition cannot see a
    // field's base type: it holds one in `Item.records` with no mark, and marks one itself
    // (`buildItem`) when its own base type, or a field's, is `file`. A test's outcome declarations
    // take this rule too.
    {
      feature: 'cardinality="record"',
      on: ["qti-outcome-declaration", "qti-template-declaration"],
      when: { kind: "attribute-value", name: "cardinality", value: "record" },
    },
    // A declaration with no base type is keyed `base-type=""`, as an interaction bound to one is.
    { feature: 'base-type=""', on: declarations, when: { kind: "untyped" } },
    { feature: "xml:base", on: "body", when: { kind: "attribute", name: "xml:base" } },
    {
      feature: "data-catalog-idref",
      on: "body",
      when: { kind: "attribute", name: "data-catalog-idref" },
    },
    {
      feature: "data-qti-suppress-tts",
      on: "body",
      when: { kind: "attribute", name: "data-qti-suppress-tts" },
    },
    { feature: "data-ssml", on: "body", when: { kind: "attribute", name: "data-ssml" } },
  ],
  notices: [
    // A pattern the translator takes is checked. One it refuses keeps this notice and the item stays
    // accepted: the schema types pattern-mask as xs:string, so such a pattern is unsupported, not
    // invalid.
    {
      feature: "pattern-mask",
      on: textInteractions,
      when: { kind: "refused-pattern", name: "pattern-mask" },
    },
    // An Inline Choice with a choice a native option cannot show is shown whole as this notice
    // (I8); nothing is refused for it.
    {
      feature: "qti-inline-choice-interaction",
      on: ["qti-inline-choice-interaction"],
      when: { elements: textSafeElements, kind: "not-text-safe" },
    },
  ],
  templateRules,
} as const satisfies Renders;

/**
 * The vocabulary attributes that carry an author's replacement for a validation message.
 */
export const messageAttributes = [
  "data-max-selections-message",
  "data-min-selections-message",
  "data-patternmask-message",
] as const;

/**
 * The two URI prefixes of QTI 3's response-processing templates (reading 9.23's shared part).
 *
 * A built-in template is either prefix followed by its name, with or without `.xml`.
 */
export const templatePrefixes = [
  "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/",
  "https://www.imsglobal.org/question/qti_v3p0/rptemplates/",
] as const;

/**
 * The response-processing templates the renderer recognises by name (reading 9.23 at head-cto's
 * pick B, reading 51), each of which runs as the rule tree its file gives: the three canonical
 * templates `match_correct`, `map_response` and `map_response_point`, and the Common Cartridge
 * templates `CC2_match` (the rules of `match_correct`), `CC2_match_basic` and `CC2_map_response`.
 * A name is the URI's final path segment, with or without `.xml`, under either of
 * {@link templatePrefixes}, as {@link templateName} resolves it.
 */
export const templateNames = [
  "match_correct",
  "map_response",
  "map_response_point",
  "CC2_match",
  "CC2_match_basic",
  "CC2_map_response",
] as const;

/**
 * A response-processing template the renderer recognises.
 */
export type TemplateName = (typeof templateNames)[number];

/**
 * Resolve a `template` URI to the built-in it names.
 *
 * The XSD types `template` as `xs:anyURI`, whose whitespace facet is `collapse`, so the URI is
 * collapsed before it is matched: the XML whitespace at either end is removed and each inner run
 * becomes one space. A padded built-in URI names its template; a URI with whitespace inside it
 * names none.
 *
 * @param uri The `template` attribute's value, as written.
 * @returns The built-in's name when the collapsed `uri` is one of {@link templatePrefixes} followed
 *   by it, with or without `.xml`; none for any other URI.
 */
export const templateName = (uri: string): Option.Option<TemplateName> => {
  const collapsed = collapseXmlSpace(uri);

  return Arr.findFirst(templatePrefixes, (prefix) => collapsed.startsWith(prefix)).pipe(
    Option.map((prefix) => collapsed.slice(prefix.length)),
    Option.flatMap((rest) =>
      Arr.findFirst(templateNames, (name) => rest === name || rest === `${name}.xml`),
    ),
  );
};

/**
 * The owners of the QTI shared vocabulary classes plate knows (I-19): the four interactions it
 * renders, and the item body, which carries the general utility classes.
 */
export type ClassOwner =
  | "choice-interaction"
  | "text-entry-interaction"
  | "extended-text-interaction"
  | "inline-choice-interaction"
  | "body";

/**
 * The two vertical-writing classes, which each interaction owner holds (`vocab.txt:4802-4840` for
 * Choice, `:4961` for Text Entry, `:5171` for Extended Text, `:5818-5822` for Inline Choice, whose
 * section names only `-rl` and which holds `-lr` as every interaction owner does).
 */
const writingClasses = [
  "qti-writing-orientation-vertical-rl",
  "qti-writing-orientation-vertical-lr",
] as const;

/**
 * The vocabulary classes plate's stylesheet gives a presentation, by owner.
 *
 * The inventory is closed: a `qti-*` class outside it has no rule. It holds no alias for the
 * corpus misspelling `qti-label-suffix-period`, and not `qti-keyword-emphasis` (M4). The rest of
 * the vocabulary's utility classes and its layout grid are M3's.
 */
export const styledClasses: Readonly<Record<ClassOwner, readonly string[]>> = {
  /**
   * The general utility classes on the item body: `vocab.txt:441` (`qti-visually-hidden`), `:559`
   * (`qti-underline`), `:578` (`qti-italic`), `:1010` (`qti-hidden`) and `:1061` (`qti-bordered`,
   * `qti-well`).
   */
  body: [
    "qti-hidden",
    "qti-visually-hidden",
    "qti-underline",
    "qti-italic",
    "qti-bordered",
    "qti-well",
  ],
  /**
   * Choice's labels, suffixes, orientation, stacking, hidden controls and vertical writing: the
   * summary table, `vocab.txt:4026-4063`, and sections 1.2.1.1 to 1.2.1.9, `:4329-4840`, which add
   * `qti-labels-cjk-ideographic` and the writing classes.
   */
  "choice-interaction": [
    "qti-labels-none",
    "qti-labels-decimal",
    "qti-labels-lower-alpha",
    "qti-labels-upper-alpha",
    "qti-labels-cjk-ideographic",
    "qti-labels-suffix-none",
    "qti-labels-suffix-period",
    "qti-labels-suffix-parenthesis",
    "qti-orientation-horizontal",
    "qti-orientation-vertical",
    "qti-choices-stacking-1",
    "qti-choices-stacking-2",
    "qti-choices-stacking-3",
    "qti-choices-stacking-4",
    "qti-choices-stacking-5",
    "qti-input-control-hidden",
    ...writingClasses,
  ],
  /**
   * Extended Text's heights and vertical writing: the summary table, `vocab.txt:4095-4110`, with
   * section 1.2.3.1, `:4997`, and section 1.2.3.4, `:5171`.
   */
  "extended-text-interaction": [
    "qti-height-lines-3",
    "qti-height-lines-6",
    "qti-height-lines-15",
    ...writingClasses,
  ],
  /**
   * Inline Choice's selection widths and vertical writing: the summary table,
   * `vocab.txt:4110-4141`, with section 1.2.7.1, `:5711`, and section 1.2.7.3, `:5818`. Each
   * width's number is its class name's; section 1.2.7.1's line for `qti-input-width-35` says 40
   * characters, a typo.
   */
  "inline-choice-interaction": [
    "qti-input-width-1",
    "qti-input-width-2",
    "qti-input-width-3",
    "qti-input-width-4",
    "qti-input-width-6",
    "qti-input-width-10",
    "qti-input-width-15",
    "qti-input-width-20",
    "qti-input-width-25",
    "qti-input-width-30",
    "qti-input-width-35",
    "qti-input-width-40",
    "qti-input-width-45",
    "qti-input-width-50",
    "qti-input-width-72",
    ...writingClasses,
  ],
  /**
   * Text Entry's input widths and vertical writing: the summary table, `vocab.txt:4063-4095`, with
   * section 1.2.2.1, `:4847`, and section 1.2.2.3, `:4961`.
   */
  "text-entry-interaction": [
    "qti-input-width-1",
    "qti-input-width-2",
    "qti-input-width-3",
    "qti-input-width-4",
    "qti-input-width-6",
    "qti-input-width-10",
    "qti-input-width-15",
    "qti-input-width-20",
    "qti-input-width-25",
    "qti-input-width-30",
    "qti-input-width-35",
    "qti-input-width-40",
    "qti-input-width-45",
    "qti-input-width-50",
    "qti-input-width-72",
    ...writingClasses,
  ],
};

/**
 * The vocabulary classes whose meaning needs script, by owner: M1 recognises them and styles none
 * of them; their runtime is M3's.
 */
export const behaviourClasses: Readonly<Record<ClassOwner, readonly string[]>> = {
  /**
   * None: the body's utility classes M1 knows are all presentational.
   */
  body: [],
  /**
   * None: Choice's vocabulary is all presentational.
   */
  "choice-interaction": [],
  /**
   * The character counters, which count the response's characters live: `vocab.txt:5082`, section
   * 1.2.3.2.
   */
  "extended-text-interaction": ["qti-counter-up", "qti-counter-down"],
  /**
   * None: Inline Choice's vocabulary is all presentational.
   */
  "inline-choice-interaction": [],
  /**
   * None: Text Entry's vocabulary is all presentational.
   */
  "text-entry-interaction": [],
};

/**
 * The two navigation modes of a test part, as its `navigation-mode` attribute spells them.
 */
export const navigationModes = ["linear", "nonlinear"] as const;

/**
 * A test part's navigation mode.
 */
export type NavigationMode = (typeof navigationModes)[number];

/**
 * The two submission modes of a test part, as its `submission-mode` attribute spells them.
 */
export const submissionModes = ["individual", "simultaneous"] as const;

/**
 * A test part's submission mode.
 */
export type SubmissionMode = (typeof submissionModes)[number];

/**
 * The two versions of QTI 3's Content Packaging 1.2 profile a manifest may name in its
 * `schemaversion`: 3.0.0 (`imsqtiv3p0_imscpv1p2_v1p0.xsd`) and 3.0.1
 * (`imsqtiv3p0p1_imscpv1p2_v1p0.xsd`). A manifest is read against the profile it names; any other
 * version is the refusal `package-profile`.
 */
export const cpVersions = ["3.0.0", "3.0.1"] as const;

/**
 * A Content Packaging profile version a manifest may name.
 */
export type CpVersion = (typeof cpVersions)[number];

/**
 * The namespace of a QTI 3.0 package's manifest, under both content packaging profiles. A root in
 * any other namespace, such as the plain IMS CP namespace of a QTI 2 package, is
 * `not-qti3-package`.
 */
export const manifestNamespace = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";

/**
 * The resource types each profile version admits on a manifest's `resource`, as its XSD's `type`
 * enumeration spells them, in its order (`imsqtiv3p0_imscpv1p2_v1p0.xsd:397-415`,
 * `imsqtiv3p0p1_imscpv1p2_v1p0.xsd:350-369`).
 *
 * Both versions list the same eight QTI types (`imsqti_*`) and the same packaging types, `pls`,
 * `css2`, `css3` and `extension` among them. They differ in LTI: 3.0.0 lists
 * `imsbasiclti_xmlv1p3`, and 3.0.1 lists `imslti_xmlv1p1` and `imsltia_xmlv1p0` in its place. The
 * test holds each list equal to the enumeration in the committed package tables.
 */
export const resourceTypes = {
  "3.0.0": [
    "imsqti_test_xmlv3p0",
    "imsqti_section_xmlv3p0",
    "imsqti_item_xmlv3p0",
    "imsqti_resprocessing_xmlv3p0",
    "imsqti_outcomes_xmlv3p0",
    "imsqti_stimulus_xmlv3p0",
    "imsqti_fragment_xmlv3p0",
    "imsqti_rptemplate_xmlv3p0",
    "associatedcontent/learning-application-resource",
    "webcontent",
    "imsbasiclti_xmlv1p3",
    "controlfile",
    "resourcemetadata/xml",
    "resourceextmetadata/xml",
    "qtiusagedata/xml",
    "pls",
    "css2",
    "css3",
    "extension",
  ],
  "3.0.1": [
    "imsqti_test_xmlv3p0",
    "imsqti_section_xmlv3p0",
    "imsqti_item_xmlv3p0",
    "imsqti_resprocessing_xmlv3p0",
    "imsqti_outcomes_xmlv3p0",
    "imsqti_stimulus_xmlv3p0",
    "imsqti_fragment_xmlv3p0",
    "imsqti_rptemplate_xmlv3p0",
    "associatedcontent/learning-application-resource",
    "webcontent",
    "imslti_xmlv1p1",
    "imsltia_xmlv1p0",
    "controlfile",
    "resourcemetadata/xml",
    "resourceextmetadata/xml",
    "qtiusagedata/xml",
    "pls",
    "css2",
    "css3",
    "extension",
  ],
} as const satisfies Readonly<Record<CpVersion, readonly string[]>>;

/**
 * A resource type some profile version admits.
 */
export type ResourceType = (typeof resourceTypes)[CpVersion][number];

/**
 * The resource types of an LTI link, which an item ref may name in place of an item (reading 110,
 * "under an item ref that names an LTI link a variable mapping is accepted unchecked, a recorded
 * limit, and a template default is refused", and a prefixed reference through it is accepted
 * unchecked too, reading 106; the implementation guide's section 6.2.9,
 * informative): the LTI types of both profiles, 3.0.0's `imsbasiclti_xmlv1p3` and 3.0.1's
 * `imslti_xmlv1p1` and `imsltia_xmlv1p0`, as pantry's `linkResourceTypes` reads them from its
 * roster (`packages/pantry/src/qti/tests.ts`). Whether a manifest's profile admits the type is the
 * manifest's own rule.
 */
export const ltiLinkTypes = [
  "imsbasiclti_xmlv1p3",
  "imslti_xmlv1p1",
  "imsltia_xmlv1p0",
] as const satisfies readonly ResourceType[];

/**
 * The QTI resource types whose document has a fixed root, each paired with that root's QTI name:
 * a resource of one of these types whose document has another root is the refusal
 * `resource-type-mismatch`.
 *
 * Two types share a root: a response-processing template and response processing are both a
 * `qti-response-processing`. `imsqti_fragment_xmlv3p0` has no pair, so a fragment's root is not
 * checked.
 */
export const resourceRoots = [
  ["imsqti_item_xmlv3p0", "qti-assessment-item"],
  ["imsqti_test_xmlv3p0", "qti-assessment-test"],
  ["imsqti_section_xmlv3p0", "qti-assessment-section"],
  ["imsqti_stimulus_xmlv3p0", "qti-assessment-stimulus"],
  ["imsqti_outcomes_xmlv3p0", "qti-outcome-declaration"],
  ["imsqti_rptemplate_xmlv3p0", "qti-response-processing"],
  ["imsqti_resprocessing_xmlv3p0", "qti-response-processing"],
] as const satisfies readonly (readonly [ResourceType, string])[];

/**
 * The XSD defaults of the six boolean attributes of `qti-item-session-control`, re-exported from
 * the module that owns them so a browser module can read them without loading these tables.
 */
export { sessionControlDefaults } from "#plate/session/control-defaults.ts";

/**
 * The views an outcome is reported to, the XSD's `ViewEnumDType`: an outcome declaration's `view`
 * lists some of them, and the results report writes them back.
 */
export const outcomeViews = [
  "author",
  "candidate",
  "proctor",
  "scorer",
  "testConstructor",
  "tutor",
] as const;

/**
 * One of {@link outcomeViews}.
 */
export type OutcomeView = (typeof outcomeViews)[number];

/**
 * The item session statuses M2's engine gives an item, as Results Reporting's `sessionStatus`
 * spells them (`rr-bind.txt:4069-4079`): `initial` before its first attempt, `pendingSubmission`
 * while an attempt has started and its responses are unprocessed, and `final` once a submission
 * closes it.
 *
 * Results Reporting's other two, `pendingResponseProcessing` and `pendingExternalScoring`, are
 * outside the set: M2's engine gives neither.
 */
export const sessionStatuses = ["initial", "pendingSubmission", "final"] as const;

/**
 * An item session status.
 */
export type SessionStatus = (typeof sessionStatuses)[number];

/**
 * The candidate's levels of interaction with an item, as Results Reporting's `answeredStatus`
 * spells them (`rr-bind.txt:2951-2960`): never presented, presented and skipped, responded and
 * invalid, and responded and valid.
 */
export const answeredStatuses = ["notpresented", "presented", "attempted", "answered"] as const;

/**
 * An item's answered status.
 */
export type AnsweredStatus = (typeof answeredStatuses)[number];

/**
 * The keys of the test features M2 accepts and does not deliver: each is a mark on the
 * verdict at its path, never a notice, and the delivered sequence ignores it.
 *
 * An element feature is keyed by its QTI name. `qti-adaptive-selection` is selection, which M3
 * delivers. `xi:include` is XInclude's `include`, which is never fetched (S-6): a test holding one
 * is left unchecked (E23) and never built, so no accepted test carries this key, which stays as
 * spec §4.6 lists it. `allow-comment="true"` is a session control that
 * asks for a comment box; `max-attempts:negative` is a negative `max-attempts`, delivered as no
 * limit; `root:<name>` is a section or a stimulus given as a document's root, which is not
 * delivered alone; `lti-link` is an item ref that names an LTI link in place of an item (reading
 * 110), which plate does not launch: only a package sees what an item ref names, so `openPackage`
 * marks it and leaves it out of the test it delivers (`withLtiLinks` in `#plate/model/test.ts`).
 * A test's outcome processing, an item reference's `qti-weight`, its
 * `qti-variable-mapping` and its `qti-template-default` are read into the test model, so none of
 * them is a mark here: outcome processing or a template default the engine cannot run is marked by
 * what it cannot run (`buildTest` in `#plate/model/test.ts`).
 */
export const testMarks = [
  "qti-selection",
  "qti-adaptive-selection",
  "qti-ordering",
  "qti-time-limits",
  "qti-pre-condition",
  "qti-branch-rule",
  "qti-rubric-block",
  "qti-test-feedback",
  "qti-assessment-section-ref",
  "qti-stylesheet",
  "qti-context-declaration",
  "xi:include",
  'allow-comment="true"',
  "max-attempts:negative",
  "root:qti-assessment-section",
  "root:qti-assessment-stimulus",
  "lti-link",
] as const;

/**
 * The key of a test feature M2 marks.
 */
export type TestMark = (typeof testMarks)[number];
