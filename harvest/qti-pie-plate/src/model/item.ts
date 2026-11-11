/**
 * The item model: what plate reads from a valid `qti-assessment-item`, typed, with every feature
 * it does not render named as a notice or a mark.
 *
 * {@link buildItem} reads the declarations, the template processing (through
 * `#plate/model/template.ts`), the body and the response processing into one {@link Item}. The
 * vocabulary module's `renders` decides what is modelled and what is unsupported, so the verdict,
 * the payload and the emitter meet the same decision. A typed value outside its lexical space is
 * the content refusal `value-type`, so a caller that builds an item stays total.
 *
 * @module
 */
import { Array as Arr, Option, Result, pipe } from "effect";
import { attributePath, walk, xincludeNamespace } from "#plate/document/source.ts";
import type { SourceChild, SourceDocument, SourceElement } from "#plate/document/source.ts";
import {
  attributeName,
  attributeOf,
  childrenNamed,
  collapseXmlSpace,
  coordsOf,
  countAttribute,
  doubleAttribute,
  elementsOf,
  enumerated,
  floatAttribute,
  floatOf,
  greatestInt,
  identifierAttribute,
  identifierOf,
  integerOf,
  isQti,
  leastInt,
  listed,
  nameOf,
  pathOf,
  refusal,
  requiredAttribute,
  requiredValue,
  textOf,
  typed,
  valueOf,
  xmlWhitespaceRun,
  xsBoolean,
  xsBooleanOf,
  xsInt,
} from "#plate/model/attributes.ts";
import type { AttributeRefusal, ModelWalk } from "#plate/model/attributes.ts";
import type {
  Branch,
  DeclarationFacet,
  Expression,
  ExpressionKind,
  ExpressionType,
  IntegerOrRef,
  KindRule,
  ResultAttributes,
  Rule,
  TemplateRule,
} from "#plate/model/expression.ts";
import { expressionKinds, integerOrRefOf } from "#plate/model/expression.ts";
import { kindRules, readExpression } from "#plate/model/expressions/read.ts";
import type { ExpressionReading } from "#plate/model/expressions/read.ts";
import { translate } from "#plate/model/regex.ts";
import { templateRules } from "#plate/model/template.ts";
import { isModelled, parseElementText, parseLexical, trimXmlSpace } from "#plate/model/values.ts";
import type {
  ModelledBaseType,
  RecordField,
  RecordValue,
  Single,
  Value,
} from "#plate/model/values.ts";
import type { Refusal } from "#plate/validate/refusal.ts";
import {
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure.
  areaShapes,
  baseTypes,
  cardinalities,
  interactionNames,
  outcomeViews,
  renders,
  templateName,
} from "#plate/vocabulary.ts";
import type {
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure.
  AreaShape,
  BaseType,
  Cardinality,
  Condition,
  FeatureRule,
  InteractionName,
  OutcomeView,
  TemplateName,
} from "#plate/vocabulary.ts";

export type { Branch, Expression, Rule } from "#plate/model/expression.ts";

/**
 * A feature the item holds and plate does not render, where it is, and how it is shown: a
 * `notice` in the body in place of its part, or a `mark` on the verdict only.
 */
export interface UnsupportedFeature {
  /**
   * The feature's key, as the verdict and its notice name it: an element name, an attribute name,
   * or `name="value"`.
   */
  readonly feature: string;
  /**
   * The element path of the element that carries it.
   */
  readonly path: string;
  readonly shown: "mark" | "notice";
}

/**
 * One `qti-map-entry`: the key in its response's base type, the value it maps to, and whether a
 * string key compares case-sensitively (`case-sensitive`, false by default).
 */
export interface MapEntry {
  readonly caseSensitive: boolean;
  readonly key: Single;
  readonly value: number;
}

/**
 * A response's `qti-mapping`, in document order.
 */
export interface Mapping {
  /**
   * The value of a response value no entry maps; 0 when `default-value` is absent.
   */
  readonly defaultValue: number;
  readonly entries: readonly MapEntry[];
  readonly lowerBound: Option.Option<number>;
  readonly upperBound: Option.Option<number>;
}

/**
 * One `qti-area-map-entry`: an area of the coordinate space and the value a point inside it maps
 * to.
 */
export interface AreaMapEntry {
  /**
   * The `coords`, in written order. A coordinate written with `%` holds its number without the
   * sign; the mapping's `percent` records that one was.
   */
  readonly coords: readonly number[];
  readonly mappedValue: number;
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure.
  readonly shape: AreaShape;
}

/**
 * A point response's `qti-area-mapping`, its entries in document order.
 */
export interface AreaMapping {
  /**
   * The value of a point no area maps; 0 when `default-value` is absent.
   */
  readonly defaultValue: number;
  readonly entries: readonly AreaMapEntry[];
  readonly lowerBound: Option.Option<number>;
  /**
   * Whether any coordinate of any entry is written with `%`. What a percentage means in scoring is
   * open (9.15) and the corpus has none, so response processing that reads such a mapping is marked
   * `area-coords-percent` and does not run.
   */
  readonly percent: boolean;
  readonly upperBound: Option.Option<number>;
}

/**
 * A `qti-response-declaration` of a modelled base type and cardinality (I-1).
 */
export interface ResponseDeclaration {
  /**
   * The `qti-area-mapping` of a `point` declaration, when it has one; none for every other base
   * type.
   */
  readonly areaMapping: Option.Option<AreaMapping>;
  readonly baseType: ModelledBaseType;
  readonly cardinality: Value["cardinality"];
  /**
   * The `qti-correct-response`, when the declaration has one.
   */
  readonly correct: Option.Option<Value>;
  /**
   * The `qti-default-value`, when the declaration has one.
   */
  readonly defaultValue: Option.Option<Value>;
  readonly identifier: string;
  readonly mapping: Option.Option<Mapping>;
}

/**
 * One `qti-match-table-entry`: the integer a lookup matches and the value it then gives.
 */
export interface MatchTableEntry {
  /**
   * `source-value`, an `xs:int`, held exact as every integer is (reading 45).
   */
  readonly sourceValue: bigint;
  /**
   * `target-value`, a value of the outcome's base type (reading 8), read exactly as written
   * (reading 7).
   */
  readonly targetValue: Single;
}

/**
 * An outcome's `qti-match-table`, its entries in document order.
 */
export interface MatchTable {
  /**
   * `default-value`, a value of the outcome's base type read exactly as written (reading 7), when
   * the table has one.
   */
  readonly defaultValue: Option.Option<Single>;
  readonly entries: readonly MatchTableEntry[];
  readonly kind: "match";
}

/**
 * One `qti-interpolation-table-entry`: the least number a lookup maps to its value.
 */
export interface InterpolationTableEntry {
  /**
   * `include-boundary`, an `xs:boolean` that is true when absent: whether a number equal to
   * `sourceValue` maps to this entry.
   */
  readonly includeBoundary: boolean;
  /**
   * `source-value`, a float read exactly as written (reading 7).
   */
  readonly sourceValue: number;
  /**
   * `target-value`, a value of the outcome's base type read exactly as written (reading 7).
   */
  readonly targetValue: Single;
}

/**
 * An outcome's `qti-interpolation-table`, its entries in document order.
 */
export interface InterpolationTable {
  /**
   * `default-value`, a value of the outcome's base type read exactly as written (reading 7), when
   * the table has one.
   */
  readonly defaultValue: Option.Option<Single>;
  readonly entries: readonly InterpolationTableEntry[];
  readonly kind: "interpolation";
}

/**
 * The table a `qti-lookup-outcome-value` maps its value through: the outcome's match table or its
 * interpolation table.
 */
export type LookupTable = InterpolationTable | MatchTable;

/**
 * A `qti-outcome-declaration` of a modelled base type and cardinality (I-2).
 *
 * Its last six fields are the attributes Results Reporting mirrors on an `outcomeVariable`, each
 * read as the XSD types it and none when the declaration does not carry it. No XSD default is
 * filled in, so an absent `normal-minimum` is none, not 0. Nothing renders them.
 */
export interface OutcomeDeclaration {
  readonly baseType: ModelledBaseType;
  readonly cardinality: Value["cardinality"];
  /**
   * The `qti-default-value`, when the declaration has one.
   */
  readonly defaultValue: Option.Option<Value>;
  readonly identifier: string;
  /**
   * `interpretation`, an `xs:string`, as written.
   */
  readonly interpretation: Option.Option<string>;
  /**
   * `long-interpretation`, an `xs:anyURI`, with its whitespace collapsed. It is only ever copied
   * into a result, never rendered or fetched, so it does not pass through `#plate/model/url.ts`.
   */
  readonly longInterpretation: Option.Option<string>;
  /**
   * The `qti-match-table` or `qti-interpolation-table`, when the declaration has one.
   */
  readonly lookupTable: Option.Option<LookupTable>;
  /**
   * `mastery-value`, an `xs:double`.
   */
  readonly masteryValue: Option.Option<number>;
  /**
   * `normal-maximum`, an `xs:double`. The structural check holds it above 0 (reading 16).
   */
  readonly normalMaximum: Option.Option<number>;
  /**
   * `normal-minimum`, an `xs:double`.
   */
  readonly normalMinimum: Option.Option<number>;
  /**
   * `view`, a list of {@link outcomeViews} in the order written. The structural check holds it to
   * at least one view (reading 17).
   */
  readonly view: Option.Option<readonly OutcomeView[]>;
}

/**
 * The six reporting attributes of an {@link OutcomeDeclaration}.
 */
export type OutcomeReporting = Pick<
  OutcomeDeclaration,
  | "interpretation"
  | "longInterpretation"
  | "masteryValue"
  | "normalMaximum"
  | "normalMinimum"
  | "view"
>;

/**
 * A `qti-template-declaration` of a modelled base type and cardinality: a template variable, which
 * only template processing sets, and which the item body and response processing may read (the
 * information model's TemplateDeclaration, `info.txt:45765`).
 */
export interface TemplateDeclaration {
  readonly baseType: ModelledBaseType;
  readonly cardinality: Value["cardinality"];
  /**
   * The `qti-default-value`, when the declaration has one.
   */
  readonly defaultValue: Option.Option<Value>;
  readonly identifier: string;
  /**
   * `math-variable`, an `xs:boolean`, false when absent: whether the variable's value stands in
   * for a MathML `mi` or `ci` that matches its identifier.
   */
  readonly mathVariable: boolean;
  /**
   * `param-variable`, an `xs:boolean`, false when absent: whether the variable's value stands in
   * for an object parameter's value that matches its identifier.
   */
  readonly paramVariable: boolean;
}

/**
 * An attribute of a body element as written, `xml:lang` under the name `xml:lang`.
 */
export interface BodyAttribute {
  readonly name: string;
  readonly value: string;
}

/**
 * An HTML element of the QTI namespace in the item body (I-8), with its attributes as written but
 * for the ones marked unsupported.
 */
export interface BodyElement {
  readonly attributes: readonly BodyAttribute[];
  readonly children: readonly BodyNode[];
  readonly kind: "element";
  readonly path: string;
  readonly tag: string;
}

/**
 * A run of text in the item body, whitespace included.
 */
export interface BodyText {
  readonly kind: "text";
  readonly text: string;
}

/**
 * How a template variable controls the visibility of a choice, a template block or a template
 * inline: its `template-identifier` and its `show-hide` (the information model's SimpleChoice,
 * `info.txt:42441-42494`, InlineChoice, `info.txt:31948-32001`, TemplateBlock, `info.txt:44963`,
 * and TemplateInline, `info.txt:46250`).
 */
export interface TemplateVisibility {
  /**
   * `show-hide`, `show` when absent. `show` hides the part unless the template variable matches,
   * or contains, the part's identifier; `hide` shows it unless the variable does.
   */
  readonly showHide: "hide" | "show";
  /**
   * `template-identifier`: the template variable, of base type identifier and single or multiple
   * cardinality, whose value controls the part's visibility.
   */
  readonly templateIdentifier: string;
}

/**
 * A `qti-simple-choice` of a Choice, or a `qti-inline-choice` of an Inline Choice, which carries
 * the same fields: its identifier, its content, whether it is fixed, and its template visibility.
 */
export interface SimpleChoice {
  readonly content: readonly BodyNode[];
  /**
   * `fixed`, an `xs:boolean`, false when absent: a fixed choice keeps its document position when
   * its interaction is shuffled.
   */
  readonly fixed: boolean;
  readonly identifier: string;
  /**
   * The choice's `template-identifier` and `show-hide`, none when it has no `template-identifier`:
   * a choice with none is always shown.
   */
  readonly templateVisibility: Option.Option<TemplateVisibility>;
}

/**
 * A `qti-choice-interaction` (Q-2), bound to an identifier response of single or multiple
 * cardinality. The model keeps its choices in document order whatever `shuffle` says; the payload
 * presents a shuffled Choice's choices in the seeded order, each fixed choice at its own place.
 */
export interface ChoiceInteraction {
  /**
   * The author's `aria-label`, which names the group when there is no Prompt.
   */
  readonly ariaLabel: Option.Option<string>;
  /**
   * The author's `aria-labelledby`, an IDREFS value as written, which names the group when there is
   * no Prompt.
   */
  readonly ariaLabelledby: Option.Option<string>;
  readonly cardinality: "multiple" | "single";
  readonly choices: readonly SimpleChoice[];
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  readonly kind: "choice";
  /**
   * `max-choices`, 1 when absent: a count, 0 to 2^63-1, held exactly (reading 46).
   */
  readonly maxChoices: bigint;
  /**
   * The author's replacements for the too-many and too-few messages,
   * `data-max-selections-message` and `data-min-selections-message`.
   */
  readonly messages: { readonly max: Option.Option<string>; readonly min: Option.Option<string> };
  /**
   * `min-choices`, 0 when absent: a count, 0 to 2^63-1, held exactly (reading 46).
   */
  readonly minChoices: bigint;
  readonly orientation: Option.Option<string>;
  readonly path: string;
  readonly prompt: Option.Option<readonly BodyNode[]>;
  /**
   * The identifier of the response it binds, `response-identifier`.
   */
  readonly response: string;
  readonly shuffle: boolean;
}

/**
 * A `qti-inline-choice-interaction` (Q-12), bound to an identifier response of single
 * cardinality, which stands inside the author's sentence. The model keeps its choices in document
 * order whatever `shuffle` says; the payload presents a shuffled Inline Choice's choices in the
 * seeded order, each fixed choice at its own place, as a Choice's.
 */
export interface InlineChoiceInteraction {
  /**
   * The author's `aria-label`, which names the Control when no Label gives a name.
   */
  readonly ariaLabel: Option.Option<string>;
  /**
   * The author's `aria-labelledby`, an IDREFS value as written, which names the Control when no
   * Label gives a name.
   */
  readonly ariaLabelledby: Option.Option<string>;
  /**
   * Each `qti-inline-choice` in document order, which has a `qti-simple-choice`'s identifier,
   * content and `fixed`; the identifiers are unique within the interaction (info model 5.73.1).
   */
  readonly choices: readonly SimpleChoice[];
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  readonly kind: "inline-choice";
  /**
   * The content of the interaction's first `qti-label`, none when it has none.
   */
  readonly label: Option.Option<readonly BodyNode[]>;
  /**
   * The author's replacement for the too-few message, `data-min-selections-message`.
   */
  readonly messages: { readonly min: Option.Option<string> };
  /**
   * `min-choices`, 0 when absent: a count, 0 to 2^63-1, held exactly (reading 46). One above 1 is
   * kept as written, so under `validateResponses` no response of a single binding meets it.
   */
  readonly minChoices: bigint;
  readonly path: string;
  /**
   * The author's `data-prompt`, the text of the option that stands for no answer.
   */
  readonly placeholder: Option.Option<string>;
  /**
   * `required`, an `xs:boolean`, false when absent: under `validateResponses`, a NULL response is
   * refused even when `min-choices` is 0.
   */
  readonly required: boolean;
  /**
   * The identifier of the response it binds, `response-identifier`.
   */
  readonly response: string;
  /**
   * `shuffle`, an `xs:boolean`, false when absent.
   */
  readonly shuffle: boolean;
}

/**
 * A `qti-text-entry-interaction` (Q-20), bound to a single `string`, `integer` or `float` response,
 * or to a record response.
 */
export interface TextEntryInteraction {
  readonly ariaLabel: Option.Option<string>;
  readonly ariaLabelledby: Option.Option<string>;
  /**
   * The number base of an integer response, `base`, an `xs:int`, 10 when absent.
   */
  readonly base: number;
  /**
   * The bound response's base type; `string` for a record response, which has none of its own.
   */
  readonly baseType: "float" | "integer" | "string";
  /**
   * The bound response's cardinality: `single`, or `record` for a record response, whose fields
   * the typed text gives.
   */
  readonly cardinality: "record" | "single";
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  /**
   * `expected-length`: a count, held exactly, with no upper bound.
   */
  readonly expectedLength: Option.Option<bigint>;
  readonly kind: "text-entry";
  readonly path: string;
  /**
   * `pattern-mask`, as written: an XML Schema regular expression the response must match, which
   * the translator takes. An interaction whose pattern the translator refuses is not built; it is
   * the notice `pattern-mask`.
   */
  readonly patternMask: Option.Option<string>;
  /**
   * The author's replacement for the pattern-mask message, `data-patternmask-message`.
   */
  readonly patternMaskMessage: Option.Option<string>;
  /**
   * `placeholder-text`.
   */
  readonly placeholder: Option.Option<string>;
  /**
   * The identifier of the response it binds, `response-identifier`.
   */
  readonly response: string;
}

/**
 * A `qti-extended-text-interaction` (Q-5): a Text Entry's fields, its prompt, `expected-lines`, a
 * `format` of `plain` (the default), `preformatted` or `xhtml`, and its binding's cardinality with
 * `max-strings` and `min-strings`.
 */
export interface ExtendedTextInteraction extends Omit<
  TextEntryInteraction,
  "cardinality" | "kind"
> {
  /**
   * The bound response's cardinality: `single`; a container, `multiple` or `ordered`, whose
   * strings each take a Control of their own; or `record` for a record response, whose fields the
   * typed text gives.
   */
  readonly cardinality: "multiple" | "ordered" | "record" | "single";
  /**
   * `expected-lines`: a count, held exactly, with no upper bound.
   */
  readonly expectedLines: Option.Option<bigint>;
  readonly format: "plain" | "preformatted" | "xhtml";
  readonly kind: "extended-text";
  /**
   * `max-strings`: a count, held exactly, with no upper bound (reading 46 does not list it). `0`
   * restricts nothing, as `max-choices` reads it (reading 53).
   */
  readonly maxStrings: Option.Option<bigint>;
  /**
   * `min-strings`, 0 when absent: a count, held exactly, with no upper bound. One above 100 shows
   * the notice `min-strings>100` in place of the Controls (Q23).
   */
  readonly minStrings: bigint;
  readonly prompt: Option.Option<readonly BodyNode[]>;
}

/**
 * A `qti-printed-variable` (the information model's PrintedVariable): the place in the body where
 * the value of an outcome or a template variable is written as text, with the attributes that say
 * how. The validator has judged what it names (`printed-variable-ref`) and its `format` (R38).
 *
 * The model holds it whatever the variable's value, which comes from an attempt's record, so
 * `redactItem` in `#plate/payload.ts` decides what the page sees in its place. Its `format`,
 * `field`, `delimiter` and `mapping-indicator` are `xs:normalizedString`s, held as XSD reads them:
 * each tab and line break a space, nothing trimmed.
 */
export interface PrintedVariable {
  /**
   * `base`, 10 when absent: the number base the `i` conversion writes an integer in, as a literal
   * or as the name of the single integer outcome or template variable that holds it (the XSD's
   * union of `xs:integer` and a variable's name).
   */
  readonly base: IntegerOrRef;
  /**
   * `delimiter`, `;` when absent: what separates the values of a container.
   */
  readonly delimiter: string;
  /**
   * `field`, none when absent: the field of a record value to write.
   */
  readonly field: Option.Option<string>;
  /**
   * `format`, none when absent: one printf conversion, which R38 has judged; with none, the value
   * is written in its default form.
   */
  readonly format: Option.Option<string>;
  /**
   * `identifier`: the outcome or template variable whose value is written.
   */
  readonly identifier: string;
  /**
   * `index`, none when absent: which value of a container to write, counted from 1, as a literal or
   * as the name of the single integer outcome or template variable that holds it.
   */
  readonly index: Option.Option<IntegerOrRef>;
  readonly kind: "printed-variable";
  /**
   * `mapping-indicator`, `=` when absent: what separates a record field's name from its value.
   */
  readonly mappingIndicator: string;
  readonly path: string;
  /**
   * `power-form`, an `xs:boolean`, false when absent: whether a float written with no `format`
   * shows its exponent as a power of ten.
   */
  readonly powerForm: boolean;
}

/**
 * A `qti-template-block` (`kind` `template-block`) or a `qti-template-inline` (`template-inline`),
 * the information model's TemplateBlock and TemplateInline (`info.txt:44963`, `:46250`): content
 * shown or hidden by a template value, as a choice with a template visibility is.
 *
 * The model holds it whatever the variable's value, which comes from an attempt's record, so
 * `redactItem` in `#plate/payload.ts` decides what the page sees in its place: its content where
 * the value shows it, nothing where it hides it. A redacted body holds none.
 */
export interface TemplateContent {
  /**
   * The content, read as any body content is.
   */
  readonly content: readonly BodyNode[];
  /**
   * `identifier`: the identifier the template variable's value is matched against.
   */
  readonly identifier: string;
  readonly kind: "template-block" | "template-inline";
  readonly path: string;
  /**
   * The responses its content binds: the `response-identifier` of every QTI element in its source
   * content that carries one (every interaction does), each read as `identifierOf` reads it,
   * whether the element is read as an interaction or replaced by a notice, nested template content
   * included, each once, in document order. A notice drops its subtree, so `content` alone cannot
   * tell which responses an unsupported interaction binds; this tells what hiding the content
   * withholds, a notice's interaction included.
   */
  readonly responses: readonly string[];
  /**
   * Its `template-identifier` and `show-hide`.
   */
  readonly templateVisibility: TemplateVisibility;
}

/**
 * A body part plate does not render, shown as a notice in its place; its subtree is dropped.
 */
export interface Unsupported {
  /**
   * The feature's key, as {@link UnsupportedFeature.feature} names it.
   */
  readonly feature: string;
  readonly kind: "unsupported";
  readonly path: string;
}

/**
 * An interaction of the item model, the four plate renders: Choice, Extended Text, Inline Choice
 * and Text Entry.
 */
export type Interaction =
  | ChoiceInteraction
  | ExtendedTextInteraction
  | InlineChoiceInteraction
  | TextEntryInteraction;

/**
 * A node of the item body: an element, a text, one of the four interactions, a printed variable,
 * a template block or inline, or a notice.
 */
export type BodyNode =
  | BodyElement
  | BodyText
  | ChoiceInteraction
  | InlineChoiceInteraction
  | TextEntryInteraction
  | ExtendedTextInteraction
  | PrintedVariable
  | TemplateContent
  | Unsupported;

/**
 * A `qti-response-declaration` of cardinality `record` the item model holds: its identifier, and
 * the record its `qti-correct-response` and its `qti-default-value` write, each none when the
 * declaration has none.
 */
export interface RecordDeclaration {
  readonly correct: Option.Option<RecordValue>;
  readonly defaultValue: Option.Option<RecordValue>;
  readonly identifier: string;
}

/**
 * The identifier, and the base type and cardinality as written, of an {@link UnheldDeclaration}.
 */
interface UnheldType {
  readonly baseType: Option.Option<BaseType>;
  readonly cardinality: Cardinality;
  readonly identifier: string;
}

/**
 * A response, outcome or template declaration of a type the value model holds no value of: base
 * type `file`, an outcome or template declaration of cardinality `record`, or a record response
 * declaration with a field of base type `file`; the model holds every other record response in
 * {@link Item.records}. A record's `base-type` is optional, so it is none when the declaration
 * writes none. `kind` names the declaration; a response's `declaresCorrect` is whether it holds a
 * `qti-correct-response`, which a test's `qti-number-correct` and `qti-number-incorrect` read,
 * since they consider only an item whose every response declares one. An outcome or template
 * declaration has no correct response.
 */
export type UnheldDeclaration = UnheldType &
  (
    | { readonly declaresCorrect: boolean; readonly kind: "response" }
    | { readonly kind: "outcome" | "template" }
  );

/**
 * A valid `qti-assessment-item` as plate models it.
 *
 * `responses`, `outcomes` and `templates` hold the declarations of modelled base types and
 * cardinalities, in document order, and `records` the record response declarations; every other
 * declaration is a mark, and `unheld` holds those by identifier ({@link UnheldDeclaration}).
 * `processing` is none when the item has no response processing, or when plate cannot run it,
 * which `unsupported` then marks. Plate cannot run it beside a `qti-template-processing` that does
 * not run (`templateProcessing` none, an element in it marked), which may set a value response
 * processing reads, such as a correct response. `unsupported` lists every feature not rendered, in
 * document order, each once per feature and path.
 */
export interface Item {
  readonly body: readonly BodyNode[];
  /**
   * The document's location as the host named it.
   */
  readonly document: string;
  readonly identifier: string;
  /**
   * The root's `xml:lang`.
   */
  readonly lang: Option.Option<string>;
  readonly outcomes: ReadonlyMap<string, OutcomeDeclaration>;
  readonly processing: Option.Option<readonly Rule[]>;
  /**
   * The response declarations of cardinality `record` the item holds a value of, keyed by
   * identifier. Absent when it holds none, as `unheld` is, so an item built by hand may leave it
   * out.
   */
  readonly records?: ReadonlyMap<string, RecordDeclaration>;
  readonly responses: ReadonlyMap<string, ResponseDeclaration>;
  /**
   * The template processing's rules in document order: none when the item has no
   * `qti-template-processing`, or when it holds anything the engine does not run, which
   * `unsupported` then marks; so template processing runs exactly when this is some.
   */
  readonly templateProcessing: Option.Option<readonly TemplateRule[]>;
  /**
   * The item's template variables, keyed by identifier.
   */
  readonly templates: ReadonlyMap<string, TemplateDeclaration>;
  readonly title: string;
  /**
   * The declarations the model holds no value of, keyed by identifier: those of base type `file`,
   * the outcome and template declarations of cardinality `record`, and a record response
   * declaration with a field of base type `file`. A test's processing reads each through an item
   * ref as NULL of its declared type. Absent when the item makes no such declaration, so
   * `buildItem` gives it only when the item makes one, and an item built by hand may leave it out.
   */
  readonly unheld?: ReadonlyMap<string, UnheldDeclaration>;
  readonly unsupported: readonly UnsupportedFeature[];
}

/**
 * What one item build reads and collects: the walk, the response declarations, the names of the
 * variables the item holds, and the unsupported features found so far, in document order.
 */
interface Build extends ModelWalk {
  /**
   * The root's response declarations, keyed by their identifier as `identifierOf` reads it; the
   * last one when two share an identifier. Built once, so binding an interaction does not rescan
   * the root.
   */
  readonly declarations: ReadonlyMap<string, SourceElement>;
  /**
   * The names of the variables the item holds: every declaration's identifier and the built-in
   * variables ({@link declaredNames}). A reader splits a string attribute's literal from a
   * reference against them, and the walks judge an unchecked reference by them.
   */
  readonly names: ReadonlySet<string>;
  /**
   * The paths each feature in `unsupported` was recorded at, keyed by the feature, so
   * {@link record} finds a repeat without scanning the features recorded so far.
   */
  readonly recorded: Map<string, Set<string>>;
  /**
   * The record responses the model holds, keyed by identifier, filled as their declarations are
   * read. The declarations precede the item body, so a text interaction bound to one finds it here.
   */
  readonly records: Map<string, RecordDeclaration>;
  readonly unsupported: UnsupportedFeature[];
}

/**
 * The `qti-*` elements the model reads or renders: those `renders` lists, the engine's response
 * rules and the template rules among them, and the element of each of the 64 expression kinds,
 * every one of which the registry reads.
 */
const readElements: ReadonlySet<string> = new Set([
  ...renders.elements,
  ...expressionKinds.map((kind) => `qti-${kind}`),
]);

/**
 * The features marked on the verdict.
 */
const marks: readonly FeatureRule[] = renders.marks;

/**
 * The features shown as a notice in place of their interaction.
 */
const notices: readonly FeatureRule[] = renders.notices;

/**
 * The features shown as a notice in place of an interaction's Controls, the interaction still
 * built.
 */
const controlNotices: readonly FeatureRule[] = renders.controlNotices;

/**
 * The attributes a body element loses because a mark names them, such as `xml:base`.
 */
const markedAttributes: ReadonlySet<string> = new Set(
  marks.flatMap((mark) =>
    mark.on === "body" && mark.when.kind === "attribute" ? [mark.when.name] : [],
  ),
);

/**
 * Record an unsupported feature, once per feature and path, in constant time.
 *
 * @param build The build that collects it.
 * @param entry The feature, its path and how it is shown.
 */
const record = (build: Build, entry: UnsupportedFeature): void => {
  const paths = build.recorded.get(entry.feature) ?? new Set<string>();
  if (!paths.has(entry.path)) {
    paths.add(entry.path);
    build.recorded.set(entry.feature, paths);
    build.unsupported.push(entry);
  }
};

/**
 * Find the response declaration an element binds through `response-identifier`; the last one when
 * two share the identifier. Both sides are compared as `identifierOf` reads them.
 *
 * @param build The build.
 * @param element An interaction.
 * @returns The declaration, or none when the element binds none or no declaration has its
 *   identifier.
 */
const boundDeclaration = (build: Build, element: SourceElement): Option.Option<SourceElement> =>
  Option.flatMap(Option.map(valueOf(element, "response-identifier"), identifierOf), (response) =>
    Option.fromUndefinedOr(build.declarations.get(response)),
  );

/**
 * Report whether some nodes hold only text and the named elements, all the way down: what a native
 * `option`, which holds only text, can show.
 *
 * @param nodes The nodes, such as a `qti-inline-choice`'s children.
 * @param elements The local names of the QTI-namespace elements allowed among them.
 * @returns Whether every descendant is text or such an element. An entity reference, or an element
 *   of another namespace, is neither.
 */
const textSafe = (nodes: readonly SourceChild[], elements: readonly string[]): boolean =>
  nodes.every(
    (node) =>
      node.kind === "text" ||
      (node.kind === "element" &&
        elements.includes(nameOf(node)) &&
        textSafe(node.children, elements)),
  );

/**
 * Report whether a `renders` condition holds on an element.
 *
 * @param build The build.
 * @param condition The condition.
 * @param element The element.
 * @returns Whether the element carries the feature.
 */
const holds = (build: Build, condition: Condition, element: SourceElement): boolean => {
  if (condition.kind === "element") {
    return true;
  }

  if (condition.kind === "attribute") {
    return Option.isSome(attributeOf(element, condition.name));
  }

  if (condition.kind === "attribute-value") {
    return Option.getOrUndefined(valueOf(element, condition.name)) === condition.value;
  }

  if (condition.kind === "attribute-true") {
    return Option.getOrElse(
      Option.flatMap(valueOf(element, condition.name), xsBooleanOf),
      () => false,
    );
  }

  if (condition.kind === "untyped") {
    return (
      Option.isNone(attributeOf(element, "base-type")) &&
      Option.getOrUndefined(valueOf(element, "cardinality")) !== "record"
    );
  }

  if (condition.kind === "refused-pattern") {
    return Option.exists(valueOf(element, condition.name), (pattern) =>
      Result.isFailure(translate(pattern)),
    );
  }

  if (condition.kind === "integer-above") {
    return Option.exists(valueOf(element, condition.name), (written) =>
      Option.exists(
        Result.getSuccess(parseLexical("integer", trimXmlSpace(written))),
        (single) => integerOf(build, single) > condition.limit,
      ),
    );
  }

  if (condition.kind === "not-text-safe") {
    return childrenNamed(element, "qti-inline-choice").some(
      (choice) => !textSafe(choice.children, condition.elements),
    );
  }

  return (
    Option.getOrUndefined(Option.flatMap(valueOf(element, "template"), templateName)) ===
    condition.name
  );
};

/**
 * Report whether a feature can sit on an element.
 *
 * @param feature The feature.
 * @param element A QTI-namespace element.
 * @param inBody Whether the element is rendered in the item body.
 * @returns Whether the feature's `on` names the element.
 */
const sitsOn = (feature: FeatureRule, element: SourceElement, inBody: boolean): boolean =>
  feature.on === "body" ? inBody : feature.on.includes(element.local);

/**
 * Record the marks an element carries.
 *
 * @param build The build.
 * @param element A QTI-namespace element the model reads.
 * @param inBody Whether the element is rendered in the item body.
 */
const markElement = (build: Build, element: SourceElement, inBody: boolean): void => {
  for (const mark of marks) {
    if (sitsOn(mark, element, inBody) && holds(build, mark.when, element)) {
      record(build, { feature: mark.feature, path: pathOf(build, element), shown: "mark" });
    }
  }
};

/**
 * Record each `qti-*` element below an element that the model does not read, as a mark keyed by
 * its name. A marked element's own subtree is not searched.
 *
 * @param build The build.
 * @param element An element outside the body that the model reads, such as a declaration.
 */
const markUnreadWithin = (build: Build, element: SourceElement): void => {
  for (const child of elementsOf(element)) {
    if (isQti(child) && child.local.startsWith("qti-") && !readElements.has(child.local)) {
      record(build, { feature: child.local, path: pathOf(build, child), shown: "mark" });
    } else {
      markUnreadWithin(build, child);
    }
  }
};

/**
 * Read a container of `qti-value` children, such as `qti-correct-response`, as one value.
 *
 * @param build The build.
 * @param container The container.
 * @param baseType The declaration's base type.
 * @param cardinality The declaration's cardinality.
 * @returns The value, an empty string being NULL, or the refusal `value-type` at the first
 *   `qti-value` outside the base type's lexical space.
 */
const valueIn = (
  build: ModelWalk,
  container: SourceElement,
  baseType: ModelledBaseType,
  cardinality: Value["cardinality"],
): Result.Result<Value, Refusal> =>
  Result.gen(function* readValueIn() {
    const parsed: Option.Option<Single>[] = [];
    for (const value of childrenNamed(container, "qti-value")) {
      parsed.push(
        yield* typed(build, pathOf(build, value), parseElementText(baseType, textOf(value))),
      );
    }

    return { baseType, cardinality, values: parsed.flatMap(Option.toArray) };
  });

/**
 * Read a declaration's optional value container.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @param local The container's name, `qti-correct-response` or `qti-default-value`.
 * @param declared The declaration's base type and cardinality.
 * @returns The value, none when the declaration has no such container, or the refusal
 * `value-type`.
 */
const optionalValue = (
  build: ModelWalk,
  declaration: SourceElement,
  local: string,
  declared: Declared,
): Result.Result<Option.Option<Value>, Refusal> =>
  Result.transposeOption(
    Option.map(Arr.head(childrenNamed(declaration, local)), (container) =>
      valueIn(build, container, declared.baseType, declared.cardinality),
    ),
  );

/**
 * The identifier, base type and cardinality of a declaration the model holds.
 */
interface Declared {
  readonly baseType: ModelledBaseType;
  readonly cardinality: Value["cardinality"];
  readonly identifier: string;
}

/**
 * A declaration's identifier, and its base type and cardinality as written, each none when absent.
 */
interface WrittenType {
  readonly baseType: Option.Option<BaseType>;
  readonly cardinality: Option.Option<Cardinality>;
  readonly identifier: string;
}

/**
 * Read a declaration's identifier, base type and cardinality as written.
 *
 * @param build The build.
 * @param declaration A response, outcome or template declaration.
 * @returns Them, or a refusal when `identifier` or `cardinality` is missing or a value is outside
 *   its list.
 */
const writtenType = (
  build: ModelWalk,
  declaration: SourceElement,
): Result.Result<WrittenType, Refusal> =>
  Result.gen(function* readWrittenType() {
    const identifier = yield* identifierAttribute(build, declaration, "identifier");
    yield* requiredAttribute(build, declaration, "cardinality");

    const cardinality = yield* enumerated(build, declaration, "cardinality", cardinalities);
    const baseType = yield* enumerated(build, declaration, "base-type", baseTypes);

    return { baseType, cardinality, identifier };
  });

/**
 * Read a declaration's identifier, base type and cardinality.
 *
 * @param build The build.
 * @param declaration A response, outcome or template declaration.
 * @returns Them, none when the base type is absent or not modelled or the cardinality is
 *   `record`, or a refusal when `identifier` or `cardinality` is missing or a value is outside its
 *   list.
 */
const declared = (
  build: ModelWalk,
  declaration: SourceElement,
): Result.Result<Option.Option<Declared>, Refusal> =>
  Result.map(writtenType(build, declaration), ({ baseType, cardinality, identifier }) =>
    Option.flatMap(Option.all({ baseType, cardinality }), (read) =>
      read.cardinality !== "record" && isModelled(read.baseType)
        ? Option.some({ baseType: read.baseType, cardinality: read.cardinality, identifier })
        : Option.none(),
    ),
  );

/**
 * Read a declaration the model holds no value of because of its type: one of base type `file`,
 * or of cardinality `record`, whose `base-type` is optional. `buildItem` reads a record response
 * declaration here only when it does not hold it in `records` ({@link recordResponse}).
 *
 * @param build The build.
 * @param declaration A response, outcome or template declaration.
 * @param kind Which of the three it is.
 * @returns Its kind, identifier, base type and cardinality, and for a response whether it holds a
 *   `qti-correct-response`; none when its type is neither; or a refusal when `identifier` or
 *   `cardinality` is missing or a value is outside its list.
 */
const unheldDeclaration = (
  build: ModelWalk,
  declaration: SourceElement,
  kind: UnheldDeclaration["kind"],
): Result.Result<Option.Option<UnheldDeclaration>, Refusal> =>
  Result.map(writtenType(build, declaration), ({ baseType, cardinality, identifier }) =>
    cardinality.pipe(
      Option.filter(
        (read) => read === "record" || Option.exists(baseType, (type) => type === "file"),
      ),
      Option.map((read): UnheldDeclaration => {
        const type = { baseType, cardinality: read, identifier };

        return kind === "response"
          ? {
              ...type,
              declaresCorrect: childrenNamed(declaration, "qti-correct-response").length > 0,
              kind,
            }
          : { ...type, kind };
      }),
    ),
  );

/**
 * Read a `qti-mapping` under its response's base type.
 *
 * @param build The build.
 * @param mapping The mapping element.
 * @param baseType The response's base type, which each `map-key` is read in, exactly as written.
 * @returns The mapping, or the refusal `value-type` at the first value outside its lexical space.
 */
const mappingOf = (
  build: Build,
  mapping: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<Mapping, Refusal> =>
  Result.gen(function* readMapping() {
    const defaultValue = yield* floatAttribute(build, mapping, "default-value");
    const lowerBound = yield* floatAttribute(build, mapping, "lower-bound");
    const upperBound = yield* floatAttribute(build, mapping, "upper-bound");
    const entries: MapEntry[] = [];
    for (const entry of childrenNamed(mapping, "qti-map-entry")) {
      entries.push(
        yield* Result.gen(function* mapEntry() {
          const key = yield* requiredAttribute(build, entry, "map-key");
          const value = yield* requiredAttribute(build, entry, "mapped-value");
          const path = pathOf(build, entry);

          return {
            caseSensitive: yield* xsBoolean(build, entry, "case-sensitive", false),
            key: yield* typed(build, attributePath(path, key), parseLexical(baseType, key.value)),
            value: floatOf(
              build,
              yield* typed(build, attributePath(path, value), parseLexical("float", value.value)),
            ),
          };
        }),
      );
    }

    return {
      defaultValue: Option.getOrElse(defaultValue, () => 0),
      entries,
      lowerBound,
      upperBound,
    };
  });

/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure. */
/**
 * Read a `qti-area-map-entry`.
 *
 * @param build The build.
 * @param entry The entry.
 * @returns The entry and whether a coordinate of it is written with `%`, or the refusal at its
 *   first attribute outside its type.
 */
const areaEntryOf = (
  build: Build,
  entry: SourceElement,
): Result.Result<{ readonly entry: AreaMapEntry; readonly percent: boolean }, Refusal> =>
  Result.gen(function* readAreaEntry() {
    const shape = yield* Result.flatMap(requiredAttribute(build, entry, "shape"), (attribute) =>
      listed(build, entry, "shape", attribute, areaShapes),
    );
    const coords = yield* coordsOf(build, entry);
    const value = yield* requiredAttribute(build, entry, "mapped-value");
    const path = attributePath(pathOf(build, entry), value);

    return {
      entry: {
        coords: coords.map(([number]) => number),
        mappedValue: floatOf(build, yield* typed(build, path, parseLexical("float", value.value))),
        shape,
      },
      percent: coords.some(([, percent]) => percent),
    };
  });
/* oxlint-enable anti-slop/no-shape-in-symbol-names */

/**
 * Read a point response's `qti-area-mapping`.
 *
 * @param build The build.
 * @param mapping The mapping element.
 * @returns The mapping, or the refusal at the first attribute outside its type.
 */
const areaMappingOf = (build: Build, mapping: SourceElement): Result.Result<AreaMapping, Refusal> =>
  Result.gen(function* readAreaMapping() {
    const defaultValue = yield* floatAttribute(build, mapping, "default-value");
    const lowerBound = yield* floatAttribute(build, mapping, "lower-bound");
    const upperBound = yield* floatAttribute(build, mapping, "upper-bound");
    const read: { readonly entry: AreaMapEntry; readonly percent: boolean }[] = [];
    for (const entry of childrenNamed(mapping, "qti-area-map-entry")) {
      read.push(yield* areaEntryOf(build, entry));
    }

    return {
      defaultValue: Option.getOrElse(defaultValue, () => 0),
      entries: read.map(({ entry }) => entry),
      lowerBound,
      percent: read.some(({ percent }) => percent),
      upperBound,
    };
  });

/**
 * The key of the mark a record response declaration of base type `file`, or with a field of it,
 * carries: the one `renders` gives an outcome or template declaration of cardinality `record`.
 */
const recordMark = 'cardinality="record"';

/**
 * A field one `qti-value` of a record declaration's value writes: its identifier and its value,
 * none when the value is NULL; or `file`, a field of base type `file`, which the value model holds
 * no value of.
 */
type WrittenField =
  | { readonly identifier: string; readonly kind: "field"; readonly value: Option.Option<Single> }
  | { readonly kind: "file" };

/**
 * Read the field a `qti-value` of a record declaration's value writes: the one its
 * `field-identifier` names, as `identifierOf` reads it, of the `base-type` it writes, its value its
 * text as `parseElementText` reads that base type (reading 7).
 *
 * @param build The build.
 * @param value The `qti-value`.
 * @returns The field, `file` when its base type is `file`; or the refusal `missing-attribute` when
 *   it lacks `field-identifier` or `base-type`, `attribute-type` when its base type is outside the
 *   list, or `value-type` when its text is outside its base type's lexical space.
 */
const writtenField = (
  build: ModelWalk,
  value: SourceElement,
): Result.Result<WrittenField, Refusal> =>
  Result.gen(function* readWrittenField() {
    const identifier = yield* identifierAttribute(build, value, "field-identifier");
    const baseType = yield* Result.flatMap(
      requiredAttribute(build, value, "base-type"),
      (attribute) => listed(build, value, "base-type", attribute, baseTypes),
    );
    if (!isModelled(baseType)) {
      const file: WrittenField = { kind: "file" };

      return file;
    }

    const single = yield* typed(
      build,
      pathOf(build, value),
      parseElementText(baseType, textOf(value)),
    );
    const field: WrittenField = { identifier, kind: "field", value: single };

    return field;
  });

/**
 * Read the fields a record declaration's `qti-correct-response` or `qti-default-value` writes, one
 * per `qti-value`, in document order.
 *
 * @param build The build.
 * @param declaration The record declaration.
 * @param local The container's name, `qti-correct-response` or `qti-default-value`.
 * @returns The fields, none when the declaration has no such container, or the refusal
 *   {@link writtenField} gives.
 */
const writtenFields = (
  build: ModelWalk,
  declaration: SourceElement,
  local: string,
): Result.Result<Option.Option<readonly WrittenField[]>, Refusal> =>
  Result.transposeOption(
    Option.map(Arr.head(childrenNamed(declaration, local)), (container) =>
      Result.gen(function* readWrittenFields() {
        const fields: WrittenField[] = [];
        for (const value of childrenNamed(container, "qti-value")) {
          fields.push(yield* writtenField(build, value));
        }

        return fields;
      }),
    ),
  );

/**
 * Construct the record some written fields give. A NULL field is no field, so fields that are all
 * NULL give the NULL record, and of the fields that name one identifier the first written is kept
 * (G-R4, pending: each identifier once, the first written kept).
 *
 * @param fields The fields, in document order, none of base type `file`.
 * @returns The record.
 */
const recordOf = (fields: readonly WrittenField[]): RecordValue => {
  const named = new Set<string>();
  const kept: RecordField[] = [];
  for (const field of fields) {
    if (field.kind === "field" && Option.isSome(field.value) && !named.has(field.identifier)) {
      named.add(field.identifier);
      kept.push({ identifier: field.identifier, value: field.value.value });
    }
  }

  return { cardinality: "record", fields: kept };
};

/**
 * What the model reads of a `qti-response-declaration`: a record response it holds; `file`, a
 * record response of base type `file` or with a field of it, which it holds no value of; or
 * `other`, a declaration of another cardinality.
 */
type RecordResponse =
  | { readonly declaration: RecordDeclaration; readonly kind: "held" }
  | { readonly kind: "file" | "other" };

/**
 * Read a `qti-response-declaration` of cardinality `record`, whatever interaction binds it: its
 * `qti-correct-response` and its `qti-default-value` each give the record its fields write
 * ({@link recordOf}). The declaration's own `base-type` types none of them (G-R4, pending), but one
 * of `file` keeps the declaration unheld, as a field of `file` does, since the verdict marks it
 * `base-type="file"`, so the model holds no record of it either.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @returns The record response, `held` or `file`, or `other` when its cardinality is not `record`;
 *   or a refusal when `identifier` or `cardinality` is missing, a value is outside its list, or a
 *   field is refused ({@link writtenField}).
 */
const recordResponse = (
  build: ModelWalk,
  declaration: SourceElement,
): Result.Result<RecordResponse, Refusal> =>
  Result.gen(function* readRecordResponse() {
    const { baseType, cardinality, identifier } = yield* writtenType(build, declaration);
    if (!Option.exists(cardinality, (read) => read === "record")) {
      const other: RecordResponse = { kind: "other" };

      return other;
    }

    const correct = yield* writtenFields(build, declaration, "qti-correct-response");
    const defaultValue = yield* writtenFields(build, declaration, "qti-default-value");
    const fields = [correct, defaultValue].flatMap((written) =>
      Option.getOrElse(written, () => []),
    );
    if (
      Option.exists(baseType, (type) => type === "file") ||
      fields.some((field) => field.kind === "file")
    ) {
      const file: RecordResponse = { kind: "file" };

      return file;
    }

    const held: RecordResponse = {
      declaration: {
        correct: correct.pipe(Option.map(recordOf)),
        defaultValue: defaultValue.pipe(Option.map(recordOf)),
        identifier,
      },
      kind: "held",
    };

    return held;
  });

/**
 * Read a `qti-response-declaration`.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @returns The model, none when its base type or cardinality is not modelled, or a refusal.
 */
const responseDeclaration = (
  build: Build,
  declaration: SourceElement,
): Result.Result<Option.Option<ResponseDeclaration>, Refusal> =>
  Result.gen(function* readResponseDeclaration() {
    const read = yield* declared(build, declaration);
    if (Option.isNone(read)) {
      return Option.none();
    }

    const correct = yield* optionalValue(build, declaration, "qti-correct-response", read.value);
    const defaultValue = yield* optionalValue(build, declaration, "qti-default-value", read.value);
    const mapping = yield* Result.transposeOption(
      Option.map(Arr.head(childrenNamed(declaration, "qti-mapping")), (element) =>
        mappingOf(build, element, read.value.baseType),
      ),
    );
    const areaMapping = yield* Result.transposeOption(
      pipe(
        Arr.head(childrenNamed(declaration, "qti-area-mapping")),
        Option.filter(() => read.value.baseType === "point"),
        Option.map((element) => areaMappingOf(build, element)),
      ),
    );

    return Option.some({ ...read.value, areaMapping, correct, defaultValue, mapping });
  });

/**
 * Read an outcome declaration's `view`, an XSD list of {@link outcomeViews}: its tokens are the
 * runs between XML whitespace.
 *
 * @param declaration The declaration.
 * @param refuse The reader's refusal of an attribute.
 * @returns The views in the order written, none when absent, or the refusal `attribute-type` at
 *   the attribute when a token is not a view.
 */
const viewAttribute = (
  declaration: SourceElement,
  refuse: AttributeRefusal,
): Result.Result<Option.Option<readonly OutcomeView[]>, Refusal> =>
  Result.transposeOption(
    Option.map(attributeOf(declaration, "view"), (attribute) =>
      Result.gen(function* readViews() {
        const views: OutcomeView[] = [];
        for (const token of attribute.value.split(xmlWhitespaceRun).filter((each) => each !== "")) {
          views.push(
            yield* Option.match(
              Arr.findFirst(outcomeViews, (view) => view === token),
              {
                onNone: () =>
                  Result.fail(
                    refuse(attribute, "attribute-type", {
                      attribute: "view",
                      value: attribute.value,
                    }),
                  ),
                onSome: (view) => Result.succeed(view),
              },
            ),
          );
        }

        return views;
      }),
    ),
  );

/**
 * Read the six attributes of a `qti-outcome-declaration` that Results Reporting mirrors on an
 * `outcomeVariable`, each as the XSD types it.
 *
 * @param build The build, `buildItem`'s or `buildTest`'s, which a defect names.
 * @param declaration The declaration.
 * @param refuse The reader's refusal of an attribute, at that attribute's path in its document.
 * @returns The six, each none when absent, or the refusal `value-type` at a double outside
 *   `xs:double`'s lexical space or `attribute-type` at a `view` naming something other than a view.
 */
const outcomeReporting = (
  build: ModelWalk,
  declaration: SourceElement,
  refuse: AttributeRefusal,
): Result.Result<OutcomeReporting, Refusal> =>
  Result.gen(function* readOutcomeReporting() {
    const view = yield* viewAttribute(declaration, refuse);
    const normalMaximum = yield* doubleAttribute(build, declaration, "normal-maximum", refuse);
    const normalMinimum = yield* doubleAttribute(build, declaration, "normal-minimum", refuse);
    const masteryValue = yield* doubleAttribute(build, declaration, "mastery-value", refuse);

    return {
      interpretation: valueOf(declaration, "interpretation"),
      longInterpretation: Option.map(valueOf(declaration, "long-interpretation"), collapseXmlSpace),
      masteryValue,
      normalMaximum,
      normalMinimum,
      view,
    };
  });

/**
 * Read a lookup table's optional `default-value` exactly as written (reading 7).
 *
 * @param build The build.
 * @param table The `qti-match-table` or `qti-interpolation-table`.
 * @param baseType The outcome's base type, which the value is read in.
 * @returns The value, none when absent, or the refusal `value-type` at the attribute.
 */
const tableDefault = (
  build: ModelWalk,
  table: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<Option.Option<Single>, Refusal> =>
  Result.transposeOption(
    Option.map(attributeOf(table, "default-value"), (attribute) =>
      typed(
        build,
        attributePath(pathOf(build, table), attribute),
        parseLexical(baseType, attribute.value),
      ),
    ),
  );

/**
 * Read a lookup table entry's `target-value` in its outcome's base type (reading 8), exactly as
 * written (reading 7).
 *
 * @param build The build.
 * @param entry The entry.
 * @param baseType The outcome's base type.
 * @returns The value, or the refusal `missing-attribute` or `value-type`.
 */
const targetValue = (
  build: ModelWalk,
  entry: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<Single, Refusal> =>
  Result.flatMap(requiredAttribute(build, entry, "target-value"), (attribute) =>
    typed(
      build,
      attributePath(pathOf(build, entry), attribute),
      parseLexical(baseType, attribute.value),
    ),
  );

/**
 * Read a `qti-match-table-entry`. Its `source-value`, an `xs:int`, is read as the XSD reads it:
 * outer whitespace goes, then the integer is held exactly and refused outside -2^31 to 2^31-1.
 *
 * @param build The build.
 * @param entry The entry.
 * @param baseType The outcome's base type.
 * @returns The entry, or the refusal `missing-attribute` or `value-type`.
 */
const matchEntryOf = (
  build: ModelWalk,
  entry: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<MatchTableEntry, Refusal> =>
  Result.gen(function* readMatchEntry() {
    const source = yield* requiredAttribute(build, entry, "source-value");
    const path = attributePath(pathOf(build, entry), source);
    const lexical = trimXmlSpace(source.value);
    const sourceValue = integerOf(
      build,
      yield* typed(build, path, parseLexical("integer", lexical)),
    );
    if (sourceValue < leastInt || sourceValue > greatestInt) {
      return yield* Result.fail(
        refusal(build, "value-type", path, { baseType: "xs:int", lexical }),
      );
    }

    return { sourceValue, targetValue: yield* targetValue(build, entry, baseType) };
  });

/**
 * Read a `qti-interpolation-table-entry`. Its `source-value` is a float read exactly as written
 * (reading 7), and its `include-boundary` is true when absent, the XSD's default.
 *
 * @param build The build.
 * @param entry The entry.
 * @param baseType The outcome's base type.
 * @returns The entry, or the refusal `missing-attribute` or `value-type`.
 */
const interpolationEntryOf = (
  build: ModelWalk,
  entry: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<InterpolationTableEntry, Refusal> =>
  Result.gen(function* readInterpolationEntry() {
    const source = yield* requiredAttribute(build, entry, "source-value");
    const sourceValue = floatOf(
      build,
      yield* typed(
        build,
        attributePath(pathOf(build, entry), source),
        parseLexical("float", source.value),
      ),
    );

    return {
      includeBoundary: yield* xsBoolean(build, entry, "include-boundary", true),
      sourceValue,
      targetValue: yield* targetValue(build, entry, baseType),
    };
  });

/**
 * Read an outcome declaration's lookup table, its `qti-match-table` or its
 * `qti-interpolation-table` (the XSD admits at most one of the two), in the outcome's base type.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @param baseType The outcome's base type.
 * @returns The table, none when the declaration has none, or the refusal at its first attribute
 *   outside its type.
 */
const lookupTableOf = (
  build: ModelWalk,
  declaration: SourceElement,
  baseType: ModelledBaseType,
): Result.Result<Option.Option<LookupTable>, Refusal> =>
  Result.transposeOption(
    Option.orElse(
      Option.map(
        Arr.head(childrenNamed(declaration, "qti-match-table")),
        (table): Result.Result<LookupTable, Refusal> =>
          Result.gen(function* readMatchTable() {
            const defaultValue = yield* tableDefault(build, table, baseType);
            const entries: MatchTableEntry[] = [];
            for (const entry of childrenNamed(table, "qti-match-table-entry")) {
              entries.push(yield* matchEntryOf(build, entry, baseType));
            }

            return { defaultValue, entries, kind: "match" as const };
          }),
      ),
      () =>
        Option.map(
          Arr.head(childrenNamed(declaration, "qti-interpolation-table")),
          (table): Result.Result<LookupTable, Refusal> =>
            Result.gen(function* readInterpolationTable() {
              const defaultValue = yield* tableDefault(build, table, baseType);
              const entries: InterpolationTableEntry[] = [];
              for (const entry of childrenNamed(table, "qti-interpolation-table-entry")) {
                entries.push(yield* interpolationEntryOf(build, entry, baseType));
              }

              return { defaultValue, entries, kind: "interpolation" as const };
            }),
        ),
    ),
  );

/**
 * Read a `qti-outcome-declaration`, an item's or a test's: the item and the test model both read
 * one through this, so the two read them alike.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @returns The model, none when its base type is absent or not modelled or its cardinality is
 *   `record`, or a refusal when `identifier` or `cardinality` is missing or a value is outside its
 *   type.
 */
export const outcomeDeclaration = (
  build: ModelWalk,
  declaration: SourceElement,
): Result.Result<Option.Option<OutcomeDeclaration>, Refusal> =>
  Result.gen(function* readOutcomeDeclaration() {
    const read = yield* declared(build, declaration);
    if (Option.isNone(read)) {
      return Option.none();
    }

    const reporting = yield* outcomeReporting(build, declaration, (attribute, rule, detail) =>
      refusal(build, rule, attributePath(pathOf(build, declaration), attribute), detail),
    );
    const defaultValue = yield* optionalValue(build, declaration, "qti-default-value", read.value);
    const lookupTable = yield* lookupTableOf(build, declaration, read.value.baseType);

    return Option.some({ ...read.value, ...reporting, defaultValue, lookupTable });
  });

/**
 * Read a `qti-template-declaration`, through {@link declared} and {@link optionalValue} as an
 * outcome declaration is read.
 *
 * @param build The build.
 * @param declaration The declaration.
 * @returns The model, none when its base type is absent or not modelled or its cardinality is
 *   `record`; or a refusal when `identifier` or `cardinality` is missing, or when its default value
 *   or `math-variable` or `param-variable` (each an `xs:boolean`, false when absent) is outside its
 *   type.
 */
const templateDeclaration = (
  build: ModelWalk,
  declaration: SourceElement,
): Result.Result<Option.Option<TemplateDeclaration>, Refusal> =>
  Result.gen(function* readTemplateDeclaration() {
    const read = yield* declared(build, declaration);
    if (Option.isNone(read)) {
      return Option.none();
    }

    const mathVariable = yield* xsBoolean(build, declaration, "math-variable", false);
    const paramVariable = yield* xsBoolean(build, declaration, "param-variable", false);
    const defaultValue = yield* optionalValue(build, declaration, "qti-default-value", read.value);

    return Option.some({ ...read.value, defaultValue, mathVariable, paramVariable });
  });

/**
 * Replace a body part with its notice, and record the notice.
 *
 * @param build The build.
 * @param feature The feature's key.
 * @param path The part's path.
 * @returns The unsupported node.
 */
const notice = (build: Build, feature: string, path: string): Result.Result<Unsupported> => {
  record(build, { feature, path, shown: "notice" });

  return Result.succeed({ feature, kind: "unsupported", path });
};

/**
 * Read a body element's attributes as written, without namespace declarations, attributes of
 * other namespaces, or the attributes a mark names.
 *
 * @param element The element.
 * @returns Its attributes, `xml:lang` named `xml:lang`.
 */
const bodyAttributes = (element: SourceElement): readonly BodyAttribute[] =>
  element.attributes.flatMap((attribute) =>
    Option.match(attributeName(attribute), {
      onNone: () => [],
      onSome: (name) => (markedAttributes.has(name) ? [] : [{ name, value: attribute.value }]),
    }),
  );

/**
 * Read the children of a body element, the item body included.
 *
 * @param build The build.
 * @param parent The element.
 * @returns Its children's body nodes, in document order, or a refusal.
 */
const bodyNodes = (
  build: Build,
  parent: SourceElement,
): Result.Result<readonly BodyNode[], Refusal> =>
  Result.gen(function* readBodyNodes() {
    const nodes: BodyNode[] = [];
    for (const child of parent.children) {
      // oxlint-disable-next-line eslint/no-use-before-define -- `bodyNodes` and `bodyNode` are mutually recursive, as body elements nest; the call runs only after both are defined.
      nodes.push(yield* bodyNode(build, parent, child));
    }

    return nodes;
  });

/**
 * Read the content of an interaction's first child of one name, such as its `qti-prompt` or an
 * Inline Choice's `qti-label`.
 *
 * @param build The build.
 * @param interaction The interaction.
 * @param local The child's local name.
 * @returns The child's content, none when it has no such child, or a refusal.
 */
const firstContent = (
  build: Build,
  interaction: SourceElement,
  local: "qti-label" | "qti-prompt",
): Result.Result<Option.Option<readonly BodyNode[]>, Refusal> =>
  Result.transposeOption(
    Option.map(Arr.head(childrenNamed(interaction, local)), (child) => {
      markElement(build, child, true);

      return bodyNodes(build, child);
    }),
  );

/**
 * Bind an interaction to its response's base type and cardinality.
 *
 * @param binding The base types and cardinalities the interaction renders with.
 * @param declaration The declaration it names.
 * @returns The bound base type and cardinality, or the feature key of the first one outside the
 *   binding: `cardinality="…"`, then `base-type="…"`.
 */
const bind = <const B extends string, const C extends string>(
  binding: { readonly baseTypes: readonly B[]; readonly cardinalities: readonly C[] },
  declaration: SourceElement,
): Result.Result<{ readonly baseType: B; readonly cardinality: C }, string> => {
  const written = {
    baseType: Option.getOrElse(valueOf(declaration, "base-type"), () => ""),
    cardinality: Option.getOrElse(valueOf(declaration, "cardinality"), () => ""),
  };
  const cardinality = binding.cardinalities.find((value) => value === written.cardinality);
  if (cardinality === undefined) {
    return Result.fail(`cardinality="${written.cardinality}"`);
  }

  const baseType = binding.baseTypes.find((value) => value === written.baseType);

  return baseType === undefined
    ? Result.fail(`base-type="${written.baseType}"`)
    : Result.succeed({ baseType, cardinality });
};

/**
 * Bind a Text Entry or an Extended Text: to a record response the model holds as the string
 * control of cardinality `record`, since a record has no base type of its own and the text typed
 * gives its fields; to any other response as {@link bind} binds it. A record response the model
 * does not hold, one of base type `file` or with a field of it, is outside the binding, so the
 * interaction is the notice `cardinality="record"`.
 *
 * @param build The build, which holds the record responses read so far.
 * @param binding The base types and cardinalities the interaction renders with otherwise.
 * @param declaration The declaration it names.
 * @returns The bound base type and cardinality, or the feature key {@link bind} gives.
 */
const bindText = <const C extends string>(
  build: Build,
  binding: {
    readonly baseTypes: readonly TextEntryInteraction["baseType"][];
    readonly cardinalities: readonly C[];
  },
  declaration: SourceElement,
): Result.Result<
  { readonly baseType: TextEntryInteraction["baseType"]; readonly cardinality: C | "record" },
  string
> =>
  Option.exists(valueOf(declaration, "identifier"), (identifier) =>
    build.records.has(identifierOf(identifier)),
  )
    ? Result.succeed({ baseType: "string", cardinality: "record" })
    : bind(binding, declaration);

/**
 * Read the fields Text Entry and Extended Text share.
 *
 * @param build The build.
 * @param interaction The interaction.
 * @param baseType The bound base type.
 * @returns The fields, or a refusal.
 */
const textFields = (
  build: Build,
  interaction: SourceElement,
  baseType: TextEntryInteraction["baseType"],
): Result.Result<Omit<TextEntryInteraction, "cardinality" | "kind">, Refusal> =>
  Result.gen(function* readTextFields() {
    const base = yield* xsInt(build, interaction, "base");

    return {
      ariaLabel: valueOf(interaction, "aria-label"),
      ariaLabelledby: valueOf(interaction, "aria-labelledby"),
      base: Option.getOrElse(base, () => 10),
      baseType,
      class: Option.getOrElse(valueOf(interaction, "class"), () => ""),
      expectedLength: yield* countAttribute(build, interaction, "expected-length"),
      path: pathOf(build, interaction),
      patternMask: valueOf(interaction, "pattern-mask"),
      patternMaskMessage: valueOf(interaction, "data-patternmask-message"),
      placeholder: valueOf(interaction, "placeholder-text"),
      response: yield* identifierAttribute(build, interaction, "response-identifier"),
    };
  });

/**
 * The values of `show-hide`, whose XSD type is a string enumeration, so a value is read as written.
 */
const showHides = ["hide", "show"] as const;

/**
 * Read an element's `show-hide`, `show` when absent, beside the template variable that controls
 * it.
 *
 * @param build The build.
 * @param element A choice, a `qti-template-block` or a `qti-template-inline`.
 * @param templateIdentifier Its `template-identifier`, read as an identifier.
 * @returns Its template visibility, or the refusal `attribute-type` when `show-hide` is neither
 *   `show` nor `hide`, which the validator refuses first.
 */
const templateVisibilityOf = (
  build: Build,
  element: SourceElement,
  templateIdentifier: string,
): Result.Result<TemplateVisibility, Refusal> =>
  Result.map(enumerated(build, element, "show-hide", showHides), (showHide) => ({
    showHide: Option.getOrElse(showHide, () => "show" as const),
    templateIdentifier,
  }));

/**
 * Read a choice of a Choice or an Inline Choice, a `qti-simple-choice` or a `qti-inline-choice`:
 * its identifier, its `fixed`, an `xs:boolean` false when absent, its content, and its
 * `template-identifier` with its `show-hide`, `show` when absent. A choice with no
 * `template-identifier` has no template visibility, whatever its `show-hide`.
 *
 * @param build The build.
 * @param choice The choice.
 * @returns The choice, or a refusal.
 */
const simpleChoiceOf = (
  build: Build,
  choice: SourceElement,
): Result.Result<SimpleChoice, Refusal> =>
  Result.gen(function* simpleChoice() {
    markElement(build, choice, true);

    const identifier = yield* identifierAttribute(build, choice, "identifier");
    const fixed = yield* xsBoolean(build, choice, "fixed", false);
    const templateVisibility = yield* Result.transposeOption(
      Option.map(valueOf(choice, "template-identifier"), (written) =>
        templateVisibilityOf(build, choice, identifierOf(written)),
      ),
    );

    return {
      content: yield* bodyNodes(build, choice),
      fixed,
      identifier,
      templateVisibility,
    };
  });

/**
 * Read a `qti-choice-interaction` bound as Choice renders it.
 *
 * @param build The build.
 * @param interaction The interaction.
 * @param cardinality The bound cardinality.
 * @returns The Choice model, or a refusal.
 */
const choiceInteraction = (
  build: Build,
  interaction: SourceElement,
  cardinality: ChoiceInteraction["cardinality"],
): Result.Result<ChoiceInteraction, Refusal> =>
  Result.gen(function* readChoice() {
    const maxChoices = yield* countAttribute(build, interaction, "max-choices");
    const minChoices = yield* countAttribute(build, interaction, "min-choices");
    const shuffle = yield* xsBoolean(build, interaction, "shuffle", false);
    const prompt = yield* firstContent(build, interaction, "qti-prompt");
    const choices: SimpleChoice[] = [];
    for (const choice of childrenNamed(interaction, "qti-simple-choice")) {
      choices.push(yield* simpleChoiceOf(build, choice));
    }

    return {
      ariaLabel: valueOf(interaction, "aria-label"),
      ariaLabelledby: valueOf(interaction, "aria-labelledby"),
      cardinality,
      choices,
      class: Option.getOrElse(valueOf(interaction, "class"), () => ""),
      kind: "choice",
      maxChoices: Option.getOrElse(maxChoices, () => 1n),
      messages: {
        max: valueOf(interaction, "data-max-selections-message"),
        min: valueOf(interaction, "data-min-selections-message"),
      },
      minChoices: Option.getOrElse(minChoices, () => 0n),
      orientation: valueOf(interaction, "orientation"),
      path: pathOf(build, interaction),
      prompt,
      response: yield* identifierAttribute(build, interaction, "response-identifier"),
      shuffle,
    };
  });

/**
 * Read a `qti-inline-choice-interaction`, bound as Inline Choice renders it, to a single
 * identifier.
 *
 * `min-choices`, `required`, `shuffle` and each choice's `fixed` are read as their XSD types read
 * them, their outer whitespace gone (reading 7): `required=" true "` is true. Each choice's
 * `template-identifier` and `show-hide` are read as a Choice's are.
 *
 * @param build The build.
 * @param interaction The interaction.
 * @returns The Inline Choice model, or a refusal.
 */
const inlineChoiceInteraction = (
  build: Build,
  interaction: SourceElement,
): Result.Result<InlineChoiceInteraction, Refusal> =>
  Result.gen(function* readInlineChoice() {
    const minChoices = yield* countAttribute(build, interaction, "min-choices");
    const required = yield* xsBoolean(build, interaction, "required", false);
    const shuffle = yield* xsBoolean(build, interaction, "shuffle", false);
    const label = yield* firstContent(build, interaction, "qti-label");
    const choices: SimpleChoice[] = [];
    for (const choice of childrenNamed(interaction, "qti-inline-choice")) {
      choices.push(yield* simpleChoiceOf(build, choice));
    }

    return {
      ariaLabel: valueOf(interaction, "aria-label"),
      ariaLabelledby: valueOf(interaction, "aria-labelledby"),
      choices,
      class: Option.getOrElse(valueOf(interaction, "class"), () => ""),
      kind: "inline-choice",
      label,
      messages: { min: valueOf(interaction, "data-min-selections-message") },
      minChoices: Option.getOrElse(minChoices, () => 0n),
      path: pathOf(build, interaction),
      placeholder: valueOf(interaction, "data-prompt"),
      required,
      response: yield* identifierAttribute(build, interaction, "response-identifier"),
      shuffle,
    };
  });

/**
 * Read one of the four interactions plate renders: its model when its binding is in `renders` and
 * it carries no notice feature, otherwise its notice. A Text Entry or an Extended Text bound to a
 * record response the model holds is the string control of cardinality `record` ({@link bindText}).
 * An Inline Choice whose choices hold content a native `option` cannot show is the notice
 * `qti-inline-choice-interaction`. An Extended Text that carries a feature of
 * `renders.controlNotices`, such as `min-strings>100`, is still built, and the feature is recorded
 * as a notice that stands in place of its Controls.
 *
 * @param build The build.
 * @param interaction The interaction.
 * @param name Which of the four it is.
 * @returns The body node, or the refusal `undeclared-response` when it binds no declaration.
 */
const interactionNode = (
  build: Build,
  interaction: SourceElement,
  name: InteractionName,
): Result.Result<BodyNode, Refusal> =>
  Result.gen(function* readInteraction() {
    const path = pathOf(build, interaction);
    const response = yield* requiredAttribute(build, interaction, "response-identifier");
    const declaration = boundDeclaration(build, interaction);
    if (Option.isNone(declaration)) {
      return yield* Result.fail(
        refusal(build, "undeclared-response", attributePath(path, response), {
          response: identifierOf(response.value),
        }),
      );
    }

    const shown = Arr.findFirst(
      notices,
      (feature) => sitsOn(feature, interaction, true) && holds(build, feature.when, interaction),
    );
    if (Option.isSome(shown)) {
      return yield* notice(build, shown.value.feature, path);
    }

    if (name === "qti-choice-interaction") {
      const bound = bind(renders.bindings[name], declaration.value);
      if (Result.isFailure(bound)) {
        return yield* notice(build, bound.failure, path);
      }

      markElement(build, interaction, true);

      return yield* choiceInteraction(build, interaction, bound.success.cardinality);
    }

    if (name === "qti-text-entry-interaction") {
      const bound = bindText(build, renders.bindings[name], declaration.value);
      if (Result.isFailure(bound)) {
        return yield* notice(build, bound.failure, path);
      }

      markElement(build, interaction, true);

      const fields = yield* textFields(build, interaction, bound.success.baseType);

      return { ...fields, cardinality: bound.success.cardinality, kind: "text-entry" };
    }

    if (name === "qti-inline-choice-interaction") {
      const bound = bind(renders.bindings[name], declaration.value);
      if (Result.isFailure(bound)) {
        return yield* notice(build, bound.failure, path);
      }

      markElement(build, interaction, true);

      return yield* inlineChoiceInteraction(build, interaction);
    }

    const binding = renders.bindings[name];
    const bound = bindText(build, binding, declaration.value);
    if (Result.isFailure(bound)) {
      return yield* notice(build, bound.failure, path);
    }

    const written = Option.getOrElse(valueOf(interaction, "format"), () => "plain");
    const format = binding.formats.find((value) => value === written);
    if (format === undefined) {
      return yield* notice(build, `format="${written}"`, path);
    }

    markElement(build, interaction, true);

    const fields = yield* textFields(build, interaction, bound.success.baseType);
    const expectedLines = yield* countAttribute(build, interaction, "expected-lines");
    const maxStrings = yield* countAttribute(build, interaction, "max-strings");
    const minStrings = yield* countAttribute(build, interaction, "min-strings");
    for (const feature of controlNotices) {
      if (sitsOn(feature, interaction, true) && holds(build, feature.when, interaction)) {
        record(build, { feature: feature.feature, path, shown: "notice" });
      }
    }

    const prompt = yield* firstContent(build, interaction, "qti-prompt");

    return {
      ...fields,
      cardinality: bound.success.cardinality,
      expectedLines,
      format,
      kind: "extended-text",
      maxStrings,
      minStrings: Option.getOrElse(minStrings, () => 0n),
      prompt,
    };
  });

/**
 * Read an `xs:normalizedString` attribute's value as XSD reads it (`whiteSpace="replace"`): each
 * tab, line feed and carriage return becomes a space, and nothing is trimmed.
 *
 * @param written The attribute's value as written.
 * @returns The value.
 */
const normalizedString = (written: string): string => written.replaceAll(/[\t\n\r]/gu, " ");

/**
 * Read a `qti-printed-variable` into its body node, with the marks it carries as a body element.
 * `identifier` is read as an identifier; `base` and `index` are each a literal or a name, split as
 * the validator splits them ({@link integerOrRefOf}); `format`, `field`, `delimiter` and
 * `mapping-indicator` are `xs:normalizedString`s; and an absent attribute takes its default.
 *
 * @param build The build.
 * @param element The printed variable.
 * @returns Its body node, or the refusal `missing-attribute` when it has no `identifier`, or
 *   `value-type` when `power-form` is no `xs:boolean`; the validator refuses both first.
 */
const printedVariable = (
  build: Build,
  element: SourceElement,
): Result.Result<PrintedVariable, Refusal> =>
  Result.gen(function* readPrintedVariable() {
    markElement(build, element, true);

    const identifier = yield* identifierAttribute(build, element, "identifier");
    const powerForm = yield* xsBoolean(build, element, "power-form", false);
    /**
     * Read one of the printed variable's `xs:normalizedString` attributes.
     *
     * @param name The attribute's name.
     * @returns Its value as XSD reads it ({@link normalizedString}), none when it is absent.
     */
    const normalized = (name: string): Option.Option<string> =>
      Option.map(valueOf(element, name), normalizedString);

    return {
      base: Option.match(valueOf(element, "base"), {
        onNone: (): IntegerOrRef => ({ _tag: "literal", value: 10n }),
        onSome: integerOrRefOf,
      }),
      delimiter: Option.getOrElse(normalized("delimiter"), () => ";"),
      field: normalized("field"),
      format: normalized("format"),
      identifier,
      index: Option.map(valueOf(element, "index"), integerOrRefOf),
      kind: "printed-variable",
      mappingIndicator: Option.getOrElse(normalized("mapping-indicator"), () => "="),
      path: pathOf(build, element),
      powerForm,
    };
  });

/**
 * Read a `qti-template-block`'s content: the content of its `qti-content-body`, read as any body
 * content is. Its `qti-stylesheet`s and its `qti-catalog-info` (`TemplateBlockDType`), which the
 * page does not show, are each a mark keyed by its name, as an item's own are.
 *
 * @param build The build.
 * @param block The template block.
 * @returns Its content, or a refusal.
 */
const templateBlockContent = (
  build: Build,
  block: SourceElement,
): Result.Result<readonly BodyNode[], Refusal> =>
  Result.gen(function* readTemplateBlockContent() {
    const parts: (readonly BodyNode[])[] = [];
    for (const part of elementsOf(block)) {
      if (isQti(part, "qti-content-body")) {
        parts.push(yield* bodyNodes(build, part));
      } else {
        record(build, { feature: nameOf(part), path: pathOf(build, part), shown: "mark" });
        parts.push([]);
      }
    }

    return parts.flat();
  });

/**
 * Name the responses a template block's or inline's source content binds: the
 * `response-identifier` of every QTI element in it that carries one, each read as `identifierOf`
 * reads it, each once, in document order. A block's content is its `qti-content-body`'s; an
 * inline's, its own. It reads the source, not the body nodes, since a notice drops its subtree:
 * an interaction plate does not render binds its response as surely as one it does. Nested
 * template content is part of the content. The walk keeps its own stack, as `walk` does, so deep
 * content cannot exhaust the call stack.
 *
 * @param element The template block or inline.
 * @param kind Which of the two it is.
 * @returns The responses, in document order.
 */
const boundResponses = (
  element: SourceElement,
  kind: TemplateContent["kind"],
): readonly string[] => {
  const roots = kind === "template-block" ? childrenNamed(element, "qti-content-body") : [element];
  const pending = roots.flatMap((root) => elementsOf(root)).toReversed();
  const responses = new Set<string>();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const written = isQti(next) ? valueOf(next, "response-identifier") : Option.none();
    if (Option.isSome(written)) {
      responses.add(identifierOf(written.value));
    }

    for (const child of elementsOf(next).toReversed()) {
      pending.push(child);
    }
  }

  return [...responses];
};

/**
 * Read a `qti-template-block` or a `qti-template-inline` into its body node: its `identifier` and
 * `template-identifier`, each read as an identifier, its `show-hide`, `show` when absent, and its
 * content: a block's `qti-content-body`'s ({@link templateBlockContent}), an inline's own, each
 * read as any body content is, and the responses that content binds ({@link boundResponses}).
 *
 * @param build The build.
 * @param element The template block or inline.
 * @param kind Which of the two it is.
 * @returns Its body node, or the refusal `missing-attribute` when it has no `identifier` or no
 *   `template-identifier`, or `attribute-type` when `show-hide` is neither `show` nor `hide`; the
 *   validator refuses each first.
 */
const templateContent = (
  build: Build,
  element: SourceElement,
  kind: TemplateContent["kind"],
): Result.Result<TemplateContent, Refusal> =>
  Result.gen(function* readTemplateContent() {
    markElement(build, element, true);

    const identifier = yield* identifierAttribute(build, element, "identifier");
    const templateIdentifier = yield* identifierAttribute(build, element, "template-identifier");
    const templateVisibility = yield* templateVisibilityOf(build, element, templateIdentifier);
    const content = yield* kind === "template-block"
      ? templateBlockContent(build, element)
      : bodyNodes(build, element);

    return {
      content,
      identifier,
      kind,
      path: pathOf(build, element),
      responses: boundResponses(element, kind),
      templateVisibility,
    };
  });

/**
 * Read one child of a body element.
 *
 * @param build The build.
 * @param parent The element that holds it.
 * @param child The child.
 * @returns Its body node: text as itself, an HTML element with its subtree, an interaction's model,
 *   a printed variable's, a template block's or inline's with its content, or a notice for
 *   anything else, its subtree dropped; or a refusal.
 */
const bodyNode = (
  build: Build,
  parent: SourceElement,
  child: SourceChild,
): Result.Result<BodyNode, Refusal> => {
  if (child.kind === "text") {
    return Result.succeed({ kind: "text", text: child.text });
  }

  if (child.kind === "entity") {
    return notice(build, `&${child.name};`, pathOf(build, parent));
  }

  const interaction = interactionNames.find((name) => isQti(child, name));
  if (interaction !== undefined) {
    return interactionNode(build, child, interaction);
  }

  if (isQti(child, "qti-printed-variable")) {
    return printedVariable(build, child);
  }

  if (isQti(child, "qti-template-block")) {
    return templateContent(build, child, "template-block");
  }

  if (isQti(child, "qti-template-inline")) {
    return templateContent(build, child, "template-inline");
  }

  if (!isQti(child) || child.local.startsWith("qti-")) {
    return notice(build, nameOf(child), pathOf(build, child));
  }

  return Result.gen(function* bodyElement() {
    markElement(build, child, true);

    const children = yield* bodyNodes(build, child);

    return {
      attributes: bodyAttributes(child),
      children,
      kind: "element",
      path: pathOf(build, child),
      tag: child.local,
    };
  });
};

/**
 * Record an element the engine does not run, as a mark keyed by its name or by its own feature.
 *
 * @param build The build.
 * @param element The element.
 * @param feature The mark's key, the element's name by default.
 * @returns None, so the rule tree that holds it is none.
 */
const unread = (
  build: Build,
  element: SourceElement,
  feature: string = nameOf(element),
): Result.Result<Option.Option<never>> => {
  record(build, { feature, path: pathOf(build, element), shown: "mark" });

  return Result.succeed(Option.none());
};

/**
 * Give the generic expression reader its context for a build: the walk, the names the item holds,
 * and the build's two ways to record a mark, so `record` and the build stay here.
 *
 * @param build The build.
 * @returns The reading context.
 */
const readingOf = (build: Build): ExpressionReading => ({
  declared: build.names,
  mark: (element, feature) => {
    record(build, { feature, path: pathOf(build, element), shown: "mark" });

    return Result.void;
  },
  unread: (element, feature) => unread(build, element, feature),
  walk: build,
});

/**
 * Read an expression through the registry's generic reader (`readExpression` in
 * `#plate/model/expressions/read.ts`), each kind by its family's reader spec.
 *
 * Every operand is read, so every element the engine does not run is marked, not only the first. A
 * `qti-variable`'s optional `weight-identifier` is read and held; an item's processing never
 * evaluates it.
 *
 * @param build The build.
 * @param element The expression element.
 * @returns The expression, none when it holds anything the engine does not run, or the refusal
 *   an attribute gives: `value-type` for a `qti-base-value` outside its lexical space, and, in a
 *   document the validator refuses first, the refusal of any attribute outside its type.
 */
const expression = (
  build: Build,
  element: SourceElement,
): Result.Result<Option.Option<Expression>, Refusal> => readExpression(readingOf(build), element);

/**
 * Construct a branch.
 *
 * @param when Its condition.
 * @param then The rules it runs.
 * @returns The branch.
 */
// oxlint-disable-next-line unicorn/no-thenable -- `then` is the branch's rule list, the name the phase-1 slice list fixes; it is an array, never a function, so no `await` treats a branch as a promise.
const branchOf = (when: Expression, then: readonly Rule[]): Branch => ({ then, when });

/**
 * Read a sequence of response rules. A `qti-response-processing-fragment`'s rules take its place,
 * so the sequence holds no fragment.
 *
 * @param build The build.
 * @param elements The rule elements, in order.
 * @returns The rules, none when any holds an element the engine does not run, or a refusal.
 */
const rules = (
  build: Build,
  elements: readonly SourceElement[],
): Result.Result<Option.Option<readonly Rule[]>, Refusal> =>
  Result.gen(function* readRules() {
    const read: Option.Option<readonly Rule[]>[] = [];
    for (const element of elements) {
      // oxlint-disable-next-line eslint/no-use-before-define -- `rules` and `rule` are mutually recursive, as conditions and fragments nest; the call runs only after both are defined.
      read.push(yield* rule(build, element));
    }

    return Option.map(Option.all(read), (each) => each.flat());
  });

/**
 * Read a `qti-response-if` or `qti-response-else-if`: its first child is the condition and the rest
 * are the rules it runs.
 *
 * @param build The build.
 * @param element The branch element.
 * @returns The branch, none when it holds an element the engine does not run, or a refusal.
 */
const branch = (
  build: Build,
  element: SourceElement,
): Result.Result<Option.Option<Branch>, Refusal> =>
  Result.gen(function* readBranch() {
    const [test, ...body] = elementsOf(element);
    if (test === undefined) {
      return yield* unread(build, element);
    }

    const when = yield* expression(build, test);
    const run = yield* rules(build, body);

    return Option.all([when, run]).pipe(Option.map(([read, then]) => branchOf(read, then)));
  });

/**
 * The mark of an XInclude `include` in response processing, which is never fetched (S-6), as the
 * test model marks one.
 */
const includeMark = "xi:include";

/**
 * Read the rule that holds one expression and names an outcome: a `qti-set-outcome-value` or a
 * `qti-lookup-outcome-value`.
 *
 * @param build The build.
 * @param element The rule element.
 * @param kind The rule's kind.
 * @returns The rule, none when it does not hold exactly one expression or its expression holds an
 *   element the engine does not run, or a refusal.
 */
const outcomeRule = (
  build: Build,
  element: SourceElement,
  kind: "lookup-outcome" | "set-outcome",
): Result.Result<Option.Option<Rule>, Refusal> =>
  Result.gen(function* readOutcomeRule() {
    const identifier = yield* identifierAttribute(build, element, "identifier");
    const [operand, ...extra] = elementsOf(element);
    if (operand === undefined || extra.length > 0) {
      return yield* unread(build, element);
    }

    const read = yield* expression(build, operand);

    return read.pipe(Option.map((value): Rule => ({ expression: value, identifier, kind })));
  });

/**
 * Read one response rule element into the rules it runs: a `qti-response-condition`, a
 * `qti-set-outcome-value`, a `qti-lookup-outcome-value` and a `qti-exit-response` are one rule
 * each, and a `qti-response-processing-fragment` is its own rules, read in place, nested fragments
 * included. An XInclude `include` is never fetched (S-6): it is marked `xi:include` at its path, so
 * the processing that holds it runs none.
 *
 * @param build The build.
 * @param element The rule element.
 * @returns The rules, none when it holds an element the engine does not run, or a refusal.
 */
const rule = (
  build: Build,
  element: SourceElement,
): Result.Result<Option.Option<readonly Rule[]>, Refusal> =>
  Result.gen(function* readRule() {
    if (element.namespace === xincludeNamespace && element.local === "include") {
      return yield* unread(build, element, includeMark);
    }

    if (isQti(element, "qti-response-processing-fragment")) {
      return yield* rules(build, elementsOf(element));
    }

    if (isQti(element, "qti-exit-response")) {
      return Option.some<readonly Rule[]>([{ kind: "exit" }]);
    }

    if (isQti(element, "qti-set-outcome-value") || isQti(element, "qti-lookup-outcome-value")) {
      const kind = isQti(element, "qti-set-outcome-value") ? "set-outcome" : "lookup-outcome";
      const read = yield* outcomeRule(build, element, kind);

      return read.pipe(Option.map((each) => [each]));
    }

    if (!isQti(element, "qti-response-condition")) {
      return yield* unread(build, element);
    }

    const parts = elementsOf(element);
    const branches: Option.Option<Branch>[] = [];
    for (const part of parts.filter(
      (each) => isQti(each, "qti-response-if") || isQti(each, "qti-response-else-if"),
    )) {
      branches.push(yield* branch(build, part));
    }

    const otherwise = yield* Option.match(
      Arr.findFirst(parts, (part) => isQti(part, "qti-response-else")),
      {
        onNone: () => Result.succeed(Option.some(Option.none<readonly Rule[]>())),
        onSome: (part) => Result.map(rules(build, elementsOf(part)), Option.map(Option.some)),
      },
    );
    const strays: Option.Option<never>[] = [];
    for (const part of parts.filter(
      (each) =>
        !isQti(each, "qti-response-if") &&
        !isQti(each, "qti-response-else-if") &&
        !isQti(each, "qti-response-else"),
    )) {
      strays.push(yield* unread(build, part));
    }

    return Option.map(
      Option.all({ branches: Option.all(branches), otherwise, strays: Option.all(strays) }),
      (read): readonly Rule[] => [
        { branches: read.branches, kind: "condition", otherwise: read.otherwise },
      ],
    );
  });

/**
 * Construct the rule that sets `SCORE`.
 *
 * @param operand Its value.
 * @returns The rule.
 */
const setScore = (operand: Expression): Rule => ({
  expression: operand,
  identifier: "SCORE",
  kind: "set-outcome",
});

/**
 * Construct a single float base value.
 *
 * @param value The number.
 * @returns The `base-value` expression of `value`.
 */
const floatValue = (value: number): Expression => ({
  kind: "base-value",
  operands: [],
  value: { baseType: "float", cardinality: "single", values: [{ baseType: "float", value }] },
});

/**
 * Construct a `qti-variable`.
 *
 * @param identifier The variable's identifier.
 * @returns The `variable` expression of `identifier`.
 */
const variableOf = (identifier: string): Expression => ({
  identifier,
  kind: "variable",
  operands: [],
  weightIdentifier: Option.none(),
});

/**
 * Construct the rule that sets an outcome to a single identifier base value.
 *
 * @param outcome The outcome's identifier.
 * @param value The identifier it is set to.
 * @returns The rule.
 */
const setIdentifier = (outcome: string, value: string): Rule => ({
  expression: {
    kind: "base-value",
    operands: [],
    value: {
      baseType: "identifier",
      cardinality: "single",
      values: [{ baseType: "identifier", value }],
    },
  },
  identifier: outcome,
  kind: "set-outcome",
});

/**
 * `match_correct`'s rules: `SCORE` is 1 when `RESPONSE` matches its correct response, else 0.
 * `CC2_match`'s file holds the same rules.
 */
const matchCorrect: readonly Rule[] = [
  {
    branches: [
      branchOf(
        {
          kind: "match",
          operands: [
            variableOf("RESPONSE"),
            { identifier: "RESPONSE", kind: "correct", operands: [] },
          ],
        },
        [setScore(floatValue(1))],
      ),
    ],
    kind: "condition",
    otherwise: Option.some([setScore(floatValue(0))]),
  },
];

/**
 * The built-in templates, as the rule trees their text gives: the files in QTI 3's `rptemplates`,
 * transcribed as data, because a browser module reads no file at run time. `map_response_point` is
 * `map_response` with `qti-map-response-point` in place of `qti-map-response`. Of the Common
 * Cartridge templates, `CC2_match` is `match_correct`; `CC2_match_basic` sets `SCORE` to `MAXSCORE`
 * and `FEEDBACKBASIC` to `correct` on a match, else `FEEDBACKBASIC` to `incorrect`; and
 * `CC2_map_response` is `map_response`, then sets `FEEDBACK` to `correct` when `MAXSCORE` and
 * `SCORE` are equal in `exact` mode, else to `incorrect`. A template's tree goes through
 * {@link runnable} as inline rules do, and is also checked for what it needs: one that names a
 * variable the item does not declare, such as `MAXSCORE`, is marked and never refused, and so is
 * one that needs a declaration the item does not provide, such as a `qti-mapping` or a `SCORE` of a
 * single float.
 */
const templates = {
  CC2_map_response: [
    {
      branches: [
        branchOf({ kind: "is-null", operands: [variableOf("RESPONSE")] }, [
          setScore(floatValue(0)),
        ]),
      ],
      kind: "condition",
      otherwise: Option.some([
        setScore({ identifier: "RESPONSE", kind: "map-response", operands: [] }),
      ]),
    },
    {
      branches: [
        branchOf(
          {
            includeLowerBound: true,
            includeUpperBound: true,
            kind: "equal",
            operands: [variableOf("MAXSCORE"), variableOf("SCORE")],
            tolerance: [],
            toleranceMode: "exact",
          },
          [setIdentifier("FEEDBACK", "correct")],
        ),
      ],
      kind: "condition",
      otherwise: Option.some([setIdentifier("FEEDBACK", "incorrect")]),
    },
  ],
  CC2_match: matchCorrect,
  CC2_match_basic: [
    {
      branches: [
        branchOf(
          {
            kind: "match",
            operands: [
              variableOf("RESPONSE"),
              { identifier: "RESPONSE", kind: "correct", operands: [] },
            ],
          },
          [setScore(variableOf("MAXSCORE")), setIdentifier("FEEDBACKBASIC", "correct")],
        ),
      ],
      kind: "condition",
      otherwise: Option.some([setIdentifier("FEEDBACKBASIC", "incorrect")]),
    },
  ],
  map_response: [
    {
      branches: [
        branchOf({ kind: "is-null", operands: [variableOf("RESPONSE")] }, [
          setScore(floatValue(0)),
        ]),
      ],
      kind: "condition",
      otherwise: Option.some([
        setScore({ identifier: "RESPONSE", kind: "map-response", operands: [] }),
      ]),
    },
  ],
  map_response_point: [
    {
      branches: [
        branchOf({ kind: "is-null", operands: [variableOf("RESPONSE")] }, [
          setScore(floatValue(0)),
        ]),
      ],
      kind: "condition",
      otherwise: Option.some([
        setScore({ identifier: "RESPONSE", kind: "map-response-point", operands: [] }),
      ]),
    },
  ],
  match_correct: matchCorrect,
} satisfies Record<TemplateName, readonly Rule[]>;

/**
 * A response processing's rule tree, and the built-in template it is.
 */
interface ProcessingTree {
  /**
   * The built-in template the tree is, none for inline rules.
   */
  readonly template: Option.Option<TemplateName>;
  readonly tree: readonly Rule[];
}

/**
 * Read a `qti-response-processing`.
 *
 * Inline rules take precedence over a template, as the information model says. A built-in
 * template becomes its rule tree; a `template` outside the built-ins is marked `template="<uri>"`
 * either way.
 *
 * @param build The build.
 * @param processing The processing element.
 * @returns The rule tree with the template it is, none when the engine cannot run it, or a refusal.
 */
const processingOf = (
  build: Build,
  processing: SourceElement,
): Result.Result<Option.Option<ProcessingTree>, Refusal> => {
  const uri = valueOf(processing, "template");
  const builtIn = uri.pipe(Option.flatMap(templateName));
  if (Option.isSome(uri) && Option.isNone(builtIn)) {
    record(build, {
      feature: `template="${uri.value}"`,
      path: pathOf(build, processing),
      shown: "mark",
    });
  }

  const inline = elementsOf(processing);
  if (inline.length > 0 || Option.isNone(uri)) {
    return Result.map(
      rules(build, inline),
      Option.map((tree) => ({ template: Option.none(), tree })),
    );
  }

  return Result.succeed(
    builtIn.pipe(Option.map((name) => ({ template: Option.some(name), tree: templates[name] }))),
  );
};

/**
 * The elements whose `identifier` declares an item variable.
 */
const declarationElements: readonly string[] = [
  "qti-context-declaration",
  "qti-outcome-declaration",
  "qti-response-declaration",
  "qti-template-declaration",
];

/**
 * Give the identifier of each variable an item's declarations declare: its response, outcome,
 * template and context declarations.
 *
 * @param root The item's root.
 * @returns The declared identifiers.
 */
const declaredIdentifiers = (root: SourceElement): ReadonlySet<string> =>
  new Set(
    elementsOf(root)
      .filter((child) => declarationElements.some((local) => isQti(child, local)))
      .flatMap((declaration) =>
        Option.match(valueOf(declaration, "identifier"), {
          onNone: () => [],
          onSome: (identifier) => [identifierOf(identifier)],
        }),
      ),
  );

/**
 * The built-in variables the engine can hold a value of, each with its type: `numAttempts`, the
 * attempt count `runAttempt` in `#plate/engine/attempt.ts` passes, a single integer; and the
 * built-in outcome `completionStatus`, which the session record holds among its outcomes
 * (`outcomeDefaults` in `#plate/model/record.ts`), a single identifier.
 */
const builtInTypes: ReadonlyMap<string, ValueType> = new Map<string, ValueType>([
  ["completionStatus", { baseType: "identifier", cardinality: "single" }],
  ["numAttempts", { baseType: "integer", cardinality: "single" }],
]);

/**
 * The kind each built-in variable the engine holds stands as (reading 111, "a processing element's
 * `identifier` names a variable of the kind the element reads or sets"): the built-in response
 * `numAttempts` and the built-in outcome `completionStatus`, as the prose rules name them
 * (`builtInsNamed` in `#plate/validate/rules.ts`). A rule that sets or reads a variable of a kind
 * names the built-ins of that kind too: `qti-set-outcome-value` and `qti-lookup-outcome-value` set
 * `completionStatus`, `qti-set-default-value` sets either one's default,
 * `qti-set-correct-response` sets the correct response of `numAttempts`, and `qti-correct` reads
 * it (`targetOf` in `#plate/engine/template.ts`, `evaluateCorrect` in
 * `#plate/engine/expressions/references.ts`).
 */
const builtInKinds: ReadonlyMap<string, "outcome" | "response"> = new Map([
  ["completionStatus", "outcome"],
  ["numAttempts", "response"],
]);

/**
 * Give the built-in variables the engine holds a value of for an item: each of
 * {@link builtInTypes}, `numAttempts` and `completionStatus`, unless a declaration of the item
 * names a variable by that name. A declared variable wins over a built-in of the same name, as the
 * prose rules read a reference (`variableType` in `#plate/validate/rules.ts`), so such a rule reads
 * the declared variable: the engine reads it when the model holds it, and otherwise the rule is
 * marked. `duration` is never held.
 *
 * @param root The item's root.
 * @returns The built-in variables' identifiers the engine holds.
 */
const heldBuiltIns = (root: SourceElement): ReadonlySet<string> => {
  const named = declaredIdentifiers(root);

  return new Set([...builtInTypes.keys()].filter((identifier) => !named.has(identifier)));
};

/**
 * The built-in variables an item's rules may name, whatever the engine holds of them:
 * `numAttempts`, `duration`, `completionStatus` and the context variable `QTI_CONTEXT`.
 */
const builtInVariables: readonly string[] = [
  "completionStatus",
  "duration",
  "numAttempts",
  "QTI_CONTEXT",
];

/**
 * Give the names of the variables an item holds: every identifier its declarations declare and
 * every built-in variable. `qti-pattern-match`'s `pattern` is a reference only when it braces one
 * of them (ruling R1), and an unchecked reference, such as a `qti-equal`'s `tolerance` token, is
 * judged only when it names one of them (9.11).
 *
 * @param root The item's root.
 * @returns The names.
 */
const declaredNames = (root: SourceElement): ReadonlySet<string> =>
  new Set([...declaredIdentifiers(root), ...builtInVariables]);

/**
 * A variable one of an expression's attributes names, by its kind's reference facet: its identifier
 * and whether a reference there is checked.
 */
interface NamedReference {
  readonly checked: boolean;
  readonly identifier: string;
}

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
 * Give each variable an expression's attributes name, through its kind's reference facet: in the
 * facet's order and, within a list attribute such as `tolerance`, in written order. A literal names
 * nothing.
 *
 * The facet names each attribute's field in the variant, so the walk looks the field up by that
 * name among the variant's fields and finds the references generically, in place of a case per
 * kind.
 *
 * @param operand The expression.
 * @param kindRule Its kind's rule.
 * @returns The variables its attributes name.
 */
const referencesOf = (operand: Expression, kindRule: KindRule): readonly NamedReference[] => {
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
 * The kinds of response and template rule that set a variable, each naming its target in
 * `identifier`.
 */
type SettingKind = Extract<Rule | TemplateRule, { readonly identifier: string }>["kind"];

/**
 * The kinds that read a record whole as an operand: `qti-field-value`, `qti-is-null` and
 * `qti-match` (`recordOrValue` in `#plate/engine/refs.ts`).
 */
const recordReaders: ReadonlySet<ExpressionKind> = new Set(["field-value", "is-null", "match"]);

/**
 * Report whether an operand names a record response the engine holds, as the engine reads one: a
 * `qti-variable`, a `qti-default` or a `qti-correct` of it.
 *
 * @param operand The operand.
 * @param heldRecords The record responses the engine holds while the tree runs.
 * @returns Whether it names one.
 */
const namesHeldRecord = (operand: Expression, heldRecords: ReadonlySet<string>): boolean =>
  (operand.kind === "variable" || operand.kind === "default" || operand.kind === "correct") &&
  heldRecords.has(operand.identifier);

/**
 * Give each identifier a rule tree names that the engine does not hold, once, in the order the tree
 * first names it: a response processing's tree of {@link Rule} or a template processing's tree of
 * {@link TemplateRule}.
 *
 * The evaluator holds only the item's modelled responses, outcomes and template variables and the
 * built-in `numAttempts` and `completionStatus` ({@link heldBuiltIns}; `Variables` in
 * `#plate/engine/evaluate.ts`) and returns `UnknownIdentifierError` for any other identifier a rule
 * names, so `buildItem` runs no tree this walk finds a name in, and that failure stays
 * unreachable. A template variable the model holds is held while template processing runs, and
 * beside response processing only when template processing runs or is absent: the record then
 * holds its value, as template processing or its declared default left it. The walk reads each
 * expression through its kind's rule in the registry (`kindRules` in
 * `#plate/model/expressions/read.ts`), in place of a case per kind:
 *
 * - The declaration facet: the `identifier` of a kind that expects a response, such as `qti-correct`,
 *   `qti-map-response` and `qti-map-response-point`, names one the engine holds only among the
 *   responses, and, for `qti-correct`, the built-in response `numAttempts` the engine holds, whose
 *   correct response the engine reads (`evaluateCorrect` in
 *   `#plate/engine/expressions/references.ts`), though it holds no mapping of it; that of a kind
 *   that expects any variable, such as `qti-variable`, among the responses, the outcomes, the
 *   template variables and the built-in variables.
 * - The reference facet: each variable an attribute names (`referencesOf`), before the operands, in
 *   the facet's order. A checked reference names one the engine holds as `qti-variable` does. An
 *   unchecked one, a `qti-equal`'s `tolerance` token, is judged only when a declaration or a
 *   built-in names it: one that names nothing is never marked, and gives NULL at run time (9.11).
 * - The operands, which every kind holds in `operands`, so the walk recurses without a case per
 *   operator. A record response the engine holds is held as an operand of `qti-field-value`,
 *   `qti-is-null` or `qti-match`, the three kinds that read a record whole, named by a
 *   `qti-variable`, a `qti-default` or a `qti-correct` ({@link namesHeldRecord}); anywhere else it
 *   is a name the engine holds no value of.
 *
 * Each setting rule's target is judged as the engine finds it: `qti-set-outcome-value` and
 * `qti-lookup-outcome-value` set an outcome, or the built-in `completionStatus` where the engine
 * holds it ({@link builtInKinds}), never a template variable, which only template processing sets;
 * `qti-set-template-value` sets a template variable, `qti-set-correct-response` a response, the
 * built-in `numAttempts` where the engine holds it among them, and `qti-set-default-value` a
 * response or an outcome, either built-in among them (`targetOf` in `#plate/engine/template.ts`).
 * The names it finds are valid content, never refused (reading 1, rule `5b8ee08b`): a response, an
 * outcome or a template variable the engine does not hold (base type `file`, cardinality `record`,
 * a record response the model holds in `records` read other than as such an operand among them, or
 * no base type), a template variable beside template processing that does not run, the built-in
 * variable `duration`, read or set, which the engine holds no value for, and the built-in
 * `completionStatus` where a declaration names it. Reading 29 makes an item's `duration` a single
 * float, so it is a valid name in an item's rules. In template processing it also finds
 * `QTI_CONTEXT` and each variable a `qti-context-declaration` declares: template processing may
 * read them (`info.txt:22601`, and a reference to `QTI_CONTEXT` "must succeed",
 * `info.txt:8454-8456`), and the engine holds no context variable. An identifier nothing declares
 * is refused before the model is built when inline rules name it; the walk finds it too. One a
 * built-in template names, such as `MAXSCORE` or `FEEDBACK` in a `CC2_*` template, is not in the
 * document, so nothing refuses it: the walk finds it, and the processing is marked.
 *
 * @param tree The rule tree.
 * @param responses The responses the model holds.
 * @param outcomes The outcomes the model holds.
 * @param heldTemplates The template variables the engine holds a value of: the model's, or none
 *   beside template processing that does not run.
 * @param heldRecords The record responses the engine holds a record of while the tree runs: the
 *   model's `records` beside response processing, none in template processing, which the engine
 *   gives no response value.
 * @param builtIns The built-in variables the engine holds for this item ({@link heldBuiltIns}).
 * @param names The names of the variables the item holds ({@link declaredNames}).
 * @returns The identifiers the engine does not hold, empty when it can run the tree.
 */
const unheldIdentifiers = (
  tree: readonly Rule[] | readonly TemplateRule[],
  responses: ReadonlyMap<string, ResponseDeclaration>,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
  heldTemplates: ReadonlyMap<string, TemplateDeclaration>,
  heldRecords: ReadonlySet<string>,
  builtIns: ReadonlySet<string>,
  names: ReadonlySet<string>,
): readonly string[] => {
  const unheld = new Set<string>();

  /**
   * Report whether the engine holds a variable of a name, as `qti-variable` reads it.
   *
   * @param identifier The name.
   * @returns Whether a response, an outcome, a template variable or a built-in variable the engine
   *   holds has it.
   */
  const isHeld = (identifier: string): boolean =>
    responses.has(identifier) ||
    outcomes.has(identifier) ||
    heldTemplates.has(identifier) ||
    builtIns.has(identifier);

  /**
   * Report whether the engine holds a built-in of a kind by a name ({@link builtInKinds}).
   *
   * @param kind The kind the built-in stands as.
   * @param identifier The name.
   * @returns Whether the engine holds a built-in of that kind by that name.
   */
  const isBuiltIn = (kind: "outcome" | "response", identifier: string): boolean =>
    builtIns.has(identifier) && builtInKinds.get(identifier) === kind;

  /**
   * Add each identifier an expression and its operands read that the engine does not hold: the
   * declaration its kind's declaration facet names, then each variable its attributes name, then
   * those of its operands, but for an operand that names a held record response under a kind that
   * reads a record whole ({@link namesHeldRecord}).
   *
   * @param operand The expression.
   */
  const read = (operand: Expression): void => {
    const kindRule: KindRule = kindRules[operand.kind];
    if (kindRule.declaration !== undefined && "identifier" in operand) {
      const held =
        kindRule.declaration.expected === "response"
          ? responses.has(operand.identifier) ||
            (operand.kind === "correct" && isBuiltIn("response", operand.identifier))
          : isHeld(operand.identifier);
      if (!held) {
        unheld.add(operand.identifier);
      }
    }

    for (const { checked, identifier } of referencesOf(operand, kindRule)) {
      if ((checked || names.has(identifier)) && !isHeld(identifier)) {
        unheld.add(identifier);
      }
    }

    const readsRecords = recordReaders.has(operand.kind);
    for (const each of operand.operands) {
      if (!(readsRecords && namesHeldRecord(each, heldRecords))) {
        read(each);
      }
    }
  };

  /**
   * Report whether the engine holds an outcome a rule may set by a name: a modelled outcome, or the
   * built-in outcome it holds ({@link builtInKinds}).
   *
   * @param identifier The name.
   * @returns Whether a set or a lookup of it runs.
   */
  const isSettable = (identifier: string): boolean =>
    outcomes.has(identifier) || isBuiltIn("outcome", identifier);

  /**
   * Report whether the engine holds a response whose correct response or default a template rule
   * may set by a name: a modelled response, or the built-in response it holds ({@link
   * builtInKinds}).
   *
   * @param identifier The name.
   * @returns Whether a set of its correct response or default runs.
   */
  const isResponse = (identifier: string): boolean =>
    responses.has(identifier) || isBuiltIn("response", identifier);

  /**
   * Whether the engine holds the variable each kind of setting rule sets by a name.
   */
  const targets: Readonly<Record<SettingKind, (identifier: string) => boolean>> = {
    "lookup-outcome": isSettable,
    "set-correct-response": isResponse,
    "set-default-value": (identifier) => isResponse(identifier) || isSettable(identifier),
    "set-outcome": isSettable,
    "set-template-value": (identifier) => heldTemplates.has(identifier),
  };

  /**
   * Add each identifier a rule sequence names, nested branches included, that the engine does not
   * hold: each variable it sets or looks up, and each identifier its expressions read. An exit
   * names none.
   *
   * @param sequence The rules, in order.
   */
  const run = (sequence: readonly (Rule | TemplateRule)[]): void => {
    for (const each of sequence) {
      if (each.kind === "condition" || each.kind === "template-condition") {
        for (const { then, when } of each.branches) {
          read(when);
          run(then);
        }
        const otherwise: Option.Option<readonly (Rule | TemplateRule)[]> = each.otherwise;
        if (Option.isSome(otherwise)) {
          run(otherwise.value);
        }
      } else if (each.kind === "template-constraint") {
        read(each.expression);
      } else if (each.kind !== "exit" && each.kind !== "exit-template") {
        if (!targets[each.kind](each.identifier)) {
          unheld.add(each.identifier);
        }

        read(each.expression);
      }
    }
  };
  run(tree);

  return [...unheld];
};

/**
 * Give every expression a rule tree holds, operands and nested branches included, in the order the
 * tree names them.
 *
 * @param tree The rule tree.
 * @returns The expressions.
 */
const expressionsOf = (tree: readonly Rule[]): readonly Expression[] => {
  const found: Expression[] = [];

  /**
   * Add an expression and, after it, each of its operands.
   *
   * @param operand The expression.
   */
  const add = (operand: Expression): void => {
    found.push(operand);
    for (const each of operand.operands) {
      add(each);
    }
  };

  /**
   * Add the expressions of a rule sequence: a set's and a lookup's expression, and each branch's
   * condition and rules. An exit holds none.
   *
   * @param sequence The rules, in order.
   */
  const run = (sequence: readonly Rule[]): void => {
    for (const each of sequence) {
      if (each.kind === "condition") {
        for (const { then, when } of each.branches) {
          add(when);
          run(then);
        }
        if (Option.isSome(each.otherwise)) {
          run(each.otherwise.value);
        }
      } else if (each.kind !== "exit") {
        add(each.expression);
      }
    }
  };
  run(tree);

  return found;
};

/**
 * Report whether a rule tree maps a point through an area mapping that has a `%` coordinate, which
 * the engine does not run: what a percentage means in scoring is open (9.15).
 *
 * @param tree The rule tree.
 * @param responses The responses the model holds.
 * @returns Whether a `qti-map-response-point` in the tree names a response whose area mapping's
 *   `percent` is true.
 */
const readsPercentArea = (
  tree: readonly Rule[],
  responses: ReadonlyMap<string, ResponseDeclaration>,
): boolean =>
  expressionsOf(tree).some(
    (each) =>
      each.kind === "map-response-point" &&
      Option.exists(
        Option.flatMap(
          Option.fromUndefinedOr(responses.get(each.identifier)),
          (response) => response.areaMapping,
        ),
        (mapping) => mapping.percent,
      ),
  );

/**
 * The base type and cardinality of a value: what `qti-set-outcome-value` compares against the
 * outcome's declaration.
 */
type ValueType = Pick<Value, "baseType" | "cardinality">;

/**
 * Give the value type of a type the kind rules give, none when the value model holds no value of
 * it: a base type of `any`, `unknown` or `file`, or a cardinality of `record` or `unknown`. Such a
 * type is not judged.
 *
 * @param type The type.
 * @returns Its value type, or none.
 */
const valueTypeOf = (type: ExpressionType): Option.Option<ValueType> => {
  const { baseType, cardinality } = type;

  return isModelled(baseType) && cardinality !== "record" && cardinality !== "unknown"
    ? Option.some({ baseType, cardinality })
    : Option.none();
};

/**
 * Give the type of the declaration an expression's declaration facet names, as the engine reads
 * its value: among the responses for a kind that expects a response; among the responses, the
 * outcomes, the template variables and the built-in variables the engine holds for one that
 * expects any variable. The built-ins the engine holds ({@link heldBuiltIns}) have the types
 * {@link builtInTypes} gives: `numAttempts` a single integer, `completionStatus` a single
 * identifier.
 *
 * @param identifier The identifier the expression names.
 * @param expected The kind of variable the facet expects.
 * @param responses The responses the model holds.
 * @param outcomes The outcomes the model holds.
 * @param heldTemplates The template variables the engine holds a value of.
 * @param builtIns The built-in variables the engine holds for this item.
 * @returns The declaration's type, none when the engine holds no variable of that name.
 */
const declarationType = (
  identifier: string,
  expected: DeclarationFacet["expected"],
  responses: ReadonlyMap<string, ResponseDeclaration>,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
  heldTemplates: ReadonlyMap<string, TemplateDeclaration>,
  builtIns: ReadonlySet<string>,
): Option.Option<ValueType> => {
  const response: ValueType | undefined = responses.get(identifier);
  if (expected === "response") {
    return Option.fromUndefinedOr(response);
  }

  return Option.fromUndefinedOr(
    response ?? outcomes.get(identifier) ?? heldTemplates.get(identifier),
  ).pipe(
    Option.orElse(() =>
      builtIns.has(identifier)
        ? Option.fromUndefinedOr(builtInTypes.get(identifier))
        : Option.none(),
    ),
  );
};

/**
 * Give the attributes an expression's result type depends on that it holds itself:
 * `qti-base-value`'s and `qti-test-variables`' base type and the operator name of
 * `qti-math-operator` and `qti-stats-operator`. Every other kind holds none.
 *
 * @param operand The expression.
 * @returns Its own result attributes.
 */
const ownAttributes = (operand: Expression): ResultAttributes => {
  if (operand.kind === "base-value") {
    return { baseType: operand.value.baseType };
  }

  if (operand.kind === "math-operator" || operand.kind === "stats-operator") {
    return { name: operand.name };
  }

  if (operand.kind === "test-variables") {
    return Option.match(operand.baseType, {
      onNone: () => ({}),
      onSome: (baseType) => ({ baseType }),
    });
  }

  return {};
};

/**
 * Give the type of every value an expression gives, through its kind's rule in the registry
 * (`kindRules` in `#plate/model/expressions/read.ts`): the rule's `resultType` over the types of
 * its operands, typed the same way, and its result attributes. For a kind with a declaration facet
 * the attributes carry the type of the declaration it names ({@link declarationType}), and none
 * when the engine holds no variable of that name, so a kind that takes the declaration's type is
 * then unknown; the kind's own attributes, such as `qti-base-value`'s base type, come from the
 * expression ({@link ownAttributes}). A type the value model holds no value of is none
 * ({@link valueTypeOf}): not judged.
 *
 * Each family's tests hold its evaluators to its rules (the type invariant in
 * `#plate/test/processing.ts`), and a NULL keeps the type of the expression that gave it, so the
 * type holds for every value the engine gives the expression.
 *
 * @param operand The expression.
 * @param responses The responses the model holds.
 * @param outcomes The outcomes the model holds.
 * @param heldTemplates The template variables the engine holds a value of.
 * @param builtIns The built-in variables the engine holds for this item.
 * @returns Its type, none when the rule gives a type the value model does not hold.
 */
const typeOf = (
  operand: Expression,
  responses: ReadonlyMap<string, ResponseDeclaration>,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
  heldTemplates: ReadonlyMap<string, TemplateDeclaration>,
  builtIns: ReadonlySet<string>,
): Option.Option<ValueType> => {
  /**
   * Give the type an expression's kind rule gives it.
   *
   * @param each The expression.
   * @returns Its type, unknown where the rule cannot say.
   */
  const expressionTypeOf = (each: Expression): ExpressionType => {
    const kindRule: KindRule = kindRules[each.kind];
    const declaration =
      kindRule.declaration === undefined || !("identifier" in each)
        ? Option.none()
        : declarationType(
            each.identifier,
            kindRule.declaration.expected,
            responses,
            outcomes,
            heldTemplates,
            builtIns,
          );
    const operands: readonly Expression[] = each.operands;

    return kindRule.resultType(operands.map(expressionTypeOf), {
      ...ownAttributes(each),
      ...Option.getOrElse(declaration, () => ({})),
    });
  };

  return valueTypeOf(expressionTypeOf(operand));
};

/**
 * Give each declaration a rule tree needs and the item does not provide, as the mark that names
 * it, once, in the order the tree first needs it.
 *
 * The evaluator returns `UnmappedResponseError` for a `qti-map-response` of a response with no
 * `qti-mapping` and for a `qti-map-response-point` of one with no `qti-area-mapping`, which only a
 * `point` declaration holds, and `OutcomeMismatchError` for a `qti-set-outcome-value` whose
 * expression's type ({@link typeOf}) is not the outcome's, or a `qti-lookup-outcome-value` of an
 * outcome that is not single (`#plate/engine/evaluate.ts`). The prose rules refuse inline rules
 * that map a response with no mapping or set an outcome to another type (`expression-type` and
 * `template-requirements` in `#plate/validate/rules.ts`), but no prose rule judges a lookup's
 * outcome cardinality, and pantry's checker accepts a lookup of any outcome with a lookup table.
 * Of a built-in template they judge less: `template-requirements` judges what a canonical template
 * needs of `RESPONSE` and the base type of `SCORE`, not its cardinality, and leaves the `CC2_*`
 * templates alone (Q6). So this walk judges every need of a built-in template's tree and, of inline
 * rules, only each lookup's outcome cardinality, and {@link runnable} runs no tree it finds a need
 * in, so those failures stay unreachable from a checked item. The marks name what is missing:
 * `mapping:<identifier>` and `area-mapping:<identifier>` for the response's mapping and area
 * mapping, and `outcome-type:<identifier>` for an outcome a rule sets to a value of another base
 * type or cardinality. An identifier the engine does not hold is {@link unheldIdentifiers}'s mark,
 * and no need is judged of it; a `record` outcome is one.
 *
 * @param tree The rule tree.
 * @param responses The responses the model holds.
 * @param outcomes The outcomes the model holds.
 * @param heldTemplates The template variables the engine holds a value of
 *   ({@link unheldIdentifiers}).
 * @param builtIns The built-in variables the engine holds for this item ({@link heldBuiltIns}).
 * @param written `template` for a built-in template's tree, whose every need is judged, or
 *   `inline` for inline rules, of which only a lookup's outcome cardinality is.
 * @returns The marks, empty when every need is met.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponse
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_SetValue
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_LookupOutcomeValue
 */
const unmetNeeds = (
  tree: readonly Rule[],
  responses: ReadonlyMap<string, ResponseDeclaration>,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
  heldTemplates: ReadonlyMap<string, TemplateDeclaration>,
  builtIns: ReadonlySet<string>,
  written: "inline" | "template",
): readonly string[] => {
  const unmet = new Set<string>();

  /**
   * Add the mark of each mapping an expression and its operands read that their response lacks,
   * of a template's tree only: the prose rules refuse an inline one.
   *
   * @param operand The expression.
   */
  const read = (operand: Expression): void => {
    if (written === "inline") {
      return;
    }

    if (operand.kind === "map-response" || operand.kind === "map-response-point") {
      const response = responses.get(operand.identifier);
      const point = operand.kind === "map-response-point";
      const lacking =
        response !== undefined &&
        (point ? Option.isNone(response.areaMapping) : Option.isNone(response.mapping));
      if (lacking) {
        unmet.add(`${point ? "area-mapping" : "mapping"}:${operand.identifier}`);
      }
    }

    for (const each of operand.operands) {
      read(each);
    }
  };

  /**
   * Add the marks of a rule sequence, nested branches included: each mapping its expressions read
   * that their response lacks, and each outcome it sets to a value of another type, a set's of a
   * template's tree only. A lookup gives a single value of its outcome's base type (reading 8), so
   * it needs an outcome of cardinality `single`, inline or not; an exit needs nothing.
   *
   * @param sequence The rules, in order.
   */
  const run = (sequence: readonly Rule[]): void => {
    for (const each of sequence) {
      if (each.kind === "condition") {
        for (const { then, when } of each.branches) {
          read(when);
          run(then);
        }
        if (Option.isSome(each.otherwise)) {
          run(each.otherwise.value);
        }
      } else if (each.kind !== "exit") {
        read(each.expression);

        const outcome = outcomes.get(each.identifier);
        if (outcome !== undefined && (written === "template" || each.kind === "lookup-outcome")) {
          const given =
            each.kind === "set-outcome"
              ? typeOf(each.expression, responses, outcomes, heldTemplates, builtIns)
              : Option.some<ValueType>({ baseType: outcome.baseType, cardinality: "single" });
          if (
            Option.exists(
              given,
              (type) =>
                type.baseType !== outcome.baseType || type.cardinality !== outcome.cardinality,
            )
          ) {
            unmet.add(`outcome-type:${each.identifier}`);
          }
        }
      }
    }
  };
  run(tree);

  return [...unmet];
};

/**
 * A response processing read into a rule tree, with where its marks go.
 */
interface ReadProcessing extends ProcessingTree {
  /**
   * The number of marks recorded when the processing element was read, so the marks it gains later
   * keep document order.
   */
  readonly at: number;
  /**
   * The `qti-response-processing` element's path.
   */
  readonly path: string;
}

/**
 * A template processing read into its rules, with where its marks go.
 */
interface ReadTemplateProcessing {
  /**
   * The number of marks recorded when its rules were read, so the marks it gains later keep
   * document order.
   */
  readonly at: number;
  /**
   * The `qti-template-processing` element's path.
   */
  readonly path: string;
  readonly tree: readonly TemplateRule[];
}

/**
 * Record marks at a processing element's path, placed among the marks already recorded in document
 * order: after the first `at`, which precede the element, and before the rest.
 *
 * @param build The build.
 * @param at The number of marks recorded when the element was read.
 * @param path The element's path.
 * @param features The features to mark.
 */
const markAt = (build: Build, at: number, path: string, features: readonly string[]): void => {
  const after = build.unsupported.splice(at);
  for (const feature of features) {
    build.unsupported.push({ feature, path, shown: "mark" });
  }
  for (const entry of after) {
    build.unsupported.push(entry);
  }
};

/**
 * Keep a response processing's rule tree the engine can run. Each identifier
 * {@link unheldIdentifiers} finds is the mark `variable:<identifier>` at the processing element's
 * path, each need {@link unmetNeeds} finds is its mark there (`mapping:<identifier>`,
 * `area-mapping:<identifier>` or `outcome-type:<identifier>`), and a tree that maps a point through
 * an area mapping with a `%` coordinate ({@link readsPercentArea}) is the mark
 * `area-coords-percent` there. The marks are placed among the others in document order
 * ({@link markAt}), and the tree is then none. So a built-in template the item does not provide
 * for, a `CC2_*` one (Q6) or a canonical one whose `SCORE` has the base type
 * `template-requirements` asks for and another cardinality, is marked and does not run, and is
 * never refused. Inline rules are walked only for a lookup of an outcome that is not single, which
 * is marked `outcome-type:<identifier>` and never refused, as pantry accepts it; the prose rules
 * refuse the inline rules that have any other need. `buildItem` judges a template processing's
 * rules by {@link unheldIdentifiers} alone; the other needs here are response processing's.
 *
 * @param build The build.
 * @param read The processing as read.
 * @param responses The responses the model holds.
 * @param outcomes The outcomes the model holds.
 * @param heldTemplates The template variables the engine holds a value of: the model's, or none
 *   beside template processing that does not run.
 * @param records The record responses the model holds.
 * @returns The tree, or none when it names an identifier the engine does not hold, is a built-in
 *   template that needs a declaration the item does not provide, or reads an area mapping with a
 *   `%` coordinate.
 */
const runnable = (
  build: Build,
  read: ReadProcessing,
  responses: ReadonlyMap<string, ResponseDeclaration>,
  outcomes: ReadonlyMap<string, OutcomeDeclaration>,
  heldTemplates: ReadonlyMap<string, TemplateDeclaration>,
  records: ReadonlyMap<string, RecordDeclaration>,
): Option.Option<readonly Rule[]> => {
  const builtIns = heldBuiltIns(build.document.root);
  const features = [
    ...unheldIdentifiers(
      read.tree,
      responses,
      outcomes,
      heldTemplates,
      new Set(records.keys()),
      builtIns,
      build.names,
    ).map((identifier) => `variable:${identifier}`),
    ...unmetNeeds(
      read.tree,
      responses,
      outcomes,
      heldTemplates,
      builtIns,
      Option.isSome(read.template) ? "template" : "inline",
    ),
  ];
  if (readsPercentArea(read.tree, responses)) {
    features.push("area-coords-percent");
  }

  markAt(build, read.at, read.path, features);

  return features.length === 0 ? Option.some(read.tree) : Option.none();
};

/**
 * Index every element of a document by its path.
 *
 * @param document The document.
 * @returns Each element's path, keyed by the element.
 */
export const pathsOf = (document: SourceDocument): ReadonlyMap<SourceElement, string> =>
  new Map(Array.from(walk(document), (visit) => [visit.element, visit.path]));

/**
 * Key a document's response declarations by their identifier, as {@link Build}'s `declarations`
 * holds them: a later declaration replaces an earlier one with the same identifier, and one without
 * an identifier binds nothing.
 *
 * @param document The document.
 * @returns Each response declaration, keyed by its identifier as `identifierOf` reads it.
 */
const declarationsOf = (document: SourceDocument): ReadonlyMap<string, SourceElement> =>
  new Map(
    childrenNamed(document.root, "qti-response-declaration").flatMap((declaration) =>
      Option.match(valueOf(declaration, "identifier"), {
        onNone: () => [],
        onSome: (identifier) => [[identifierOf(identifier), declaration] as const],
      }),
    ),
  );

/**
 * Give the identifiers of a document's record responses: each response declaration whose
 * `cardinality` is `record`, read as `listed` reads it, whether the model holds it in `records` or,
 * for a base type `file` of its own or of a field, in `unheld`. Template processing that sets one
 * is marked `record-set` (`templateRules` in `#plate/model/template.ts`).
 *
 * @param declarations The document's response declarations by identifier ({@link declarationsOf}).
 * @returns Their identifiers.
 */
const recordResponseNames = (
  declarations: ReadonlyMap<string, SourceElement>,
): ReadonlySet<string> =>
  new Set(
    [...declarations]
      .filter(([, declaration]) =>
        Option.exists(valueOf(declaration, "cardinality"), (written) => written === "record"),
      )
      .map(([identifier]) => identifier),
  );

/**
 * Build the item model of a valid `qti-assessment-item`.
 *
 * The body keeps text and HTML elements as written. Choice, Inline Choice, Text Entry and Extended
 * Text become their models when their binding is one `renders` lists, or for a text interaction a
 * record response the model holds, and they carry no notice feature; a `qti-printed-variable`
 * becomes its model, and a `qti-template-block` or `qti-template-inline` its model with its
 * content; any other `qti-*` element in the body becomes a notice, its subtree dropped. Each
 * `renders` mark adds an unsupported feature, and so does each `qti-*` element outside the body
 * that the model does not read. Response processing is a rule tree: a built-in template resolves to
 * the tree its text gives, and inline rules become their tree when every element is in the engine.
 * The tree is kept only when the engine holds every identifier it names, the item provides every
 * declaration a built-in template's tree needs, every outcome a lookup sets is single, and it maps
 * no point through an area mapping with a `%` coordinate; each identifier it does not hold is the
 * mark `variable:<identifier>` at the processing element's path, each such need unmet its mark
 * there (`mapping:<identifier>`, `area-mapping:<identifier>` or `outcome-type:<identifier>`), such
 * a point mapping the mark `area-coords-percent` there, and the processing is then none. A response
 * declaration of cardinality `record` is held in `records`, with no mark, whatever interaction
 * binds it: its `qti-correct-response` and `qti-default-value` are read field by field
 * ({@link recordResponse}). The engine holds its record beside response processing, read whole as
 * an operand of `qti-field-value`, `qti-is-null` or `qti-match` ({@link unheldIdentifiers}); a
 * processing that reads it anywhere else is marked `variable:<identifier>`, a template rule that
 * sets its default or its correct response is marked `record-set`, and a Text Entry or an Extended
 * Text bound to one is the string control of cardinality `record`. A declaration of base type
 * `file`, an outcome or template declaration of cardinality `record`, and a record response of base
 * type `file` or with a field of it, are held in `unheld`, beside their mark. `records` and
 * `unheld` are each absent when empty. Template declarations of modelled types are read into
 * `templates`, and a `qti-template-processing` into `templateProcessing` through `templateRules` in
 * `#plate/model/template.ts`, which marks what the engine does not run as response processing's
 * reader does. Its rules are kept only when the engine holds every name they read and set while
 * they run: each name {@link unheldIdentifiers} finds, such as `QTI_CONTEXT`, a context variable,
 * or a template variable, response or outcome the model does not hold, is the mark
 * `variable:<identifier>` at the `qti-template-processing` element's path, and the template
 * processing is then none. Nothing is refused: such an item is accepted with that mark. A template
 * variable the model holds is one the engine holds, unless the item's `qti-template-processing`
 * does not run: then no template variable is held, so a tree that reads one is marked
 * `variable:<identifier>`, and the item has no processing, whatever the tree, since that template
 * processing may set a template variable, a default value or a correct response, so a score
 * computed without it could be wrong.
 *
 * @param source A document the structural validator and the prose rules accepted.
 * @returns The item, or the refusal `value-type` at the first typed value outside its lexical
 *   space. A document the validator would refuse can also fail with `missing-attribute`,
 *   `attribute-type` or `undeclared-response`.
 */
export const buildItem = (source: SourceDocument): Result.Result<Item, Refusal> =>
  Result.gen(function* readItem() {
    const build: Build = {
      builder: "buildItem",
      declarations: declarationsOf(source),
      document: source,
      names: declaredNames(source.root),
      paths: pathsOf(source),
      recorded: new Map(),
      records: new Map(),
      unsupported: [],
    };
    const { records } = build;
    const { root } = source;
    markElement(build, root, false);

    const identifier = yield* identifierAttribute(build, root, "identifier");
    const title = yield* requiredValue(build, root, "title");
    const responses = new Map<string, ResponseDeclaration>();
    const outcomes = new Map<string, OutcomeDeclaration>();
    const templateDeclarations = new Map<string, TemplateDeclaration>();
    const unheld = new Map<string, UnheldDeclaration>();
    const holdUnheld = (
      declaration: SourceElement,
      kind: UnheldDeclaration["kind"],
    ): Result.Result<void, Refusal> =>
      Result.map(unheldDeclaration(build, declaration, kind), (read) => {
        if (Option.isSome(read)) {
          unheld.set(read.value.identifier, read.value);
        }
      });
    const body: BodyNode[] = [];
    let processing: Option.Option<ReadProcessing> = Option.none();
    let templateRead: Option.Option<ReadTemplateProcessing> = Option.none();

    for (const part of elementsOf(root).filter((child) => isQti(child))) {
      if (part.local === "qti-item-body") {
        markElement(build, part, true);
        for (const node of yield* bodyNodes(build, part)) {
          body.push(node);
        }
      } else if (part.local === "qti-response-processing") {
        markElement(build, part, false);

        const parsed = yield* processingOf(build, part);
        processing = parsed.pipe(
          Option.map((read) => ({
            ...read,
            at: build.unsupported.length,
            path: pathOf(build, part),
          })),
        );
      } else if (part.local === "qti-response-declaration") {
        markElement(build, part, false);

        const recordRead = yield* recordResponse(build, part);
        // Placed where `markElement` places an outcome's record mark: after its other marks, before
        // those of the elements below it.
        if (recordRead.kind === "file") {
          record(build, { feature: recordMark, path: pathOf(build, part), shown: "mark" });
        }

        markUnreadWithin(build, part);

        const read = yield* responseDeclaration(build, part);
        if (Option.isSome(read)) {
          responses.set(read.value.identifier, read.value);
        }

        if (recordRead.kind === "held") {
          records.set(recordRead.declaration.identifier, recordRead.declaration);
        } else {
          yield* holdUnheld(part, "response");
        }
      } else if (part.local === "qti-outcome-declaration") {
        markElement(build, part, false);
        markUnreadWithin(build, part);

        const read = yield* outcomeDeclaration(build, part);
        if (Option.isSome(read)) {
          outcomes.set(read.value.identifier, read.value);
        }

        yield* holdUnheld(part, "outcome");
      } else if (part.local === "qti-template-declaration") {
        markElement(build, part, false);
        markUnreadWithin(build, part);

        const read = yield* templateDeclaration(build, part);
        if (Option.isSome(read)) {
          templateDeclarations.set(read.value.identifier, read.value);
        }

        yield* holdUnheld(part, "template");
      } else if (part.local === "qti-template-processing") {
        markElement(build, part, false);

        const parsed = yield* templateRules(
          readingOf(build),
          part,
          recordResponseNames(build.declarations),
        );
        templateRead = parsed.pipe(
          Option.map((tree) => ({
            at: build.unsupported.length,
            path: pathOf(build, part),
            tree,
          })),
        );
      } else {
        markElement(build, part, false);
        if (!readElements.has(part.local)) {
          record(build, { feature: part.local, path: pathOf(build, part), shown: "mark" });
        }
      }
    }

    // The names template processing reads or sets that the engine does not hold while it runs. The
    // engine gives it no response or outcome value (`#plate/engine/template.ts`), but P26 refuses
    // every read of one, and of every built-in but `QTI_CONTEXT`, so on a checked item these are
    // `QTI_CONTEXT`, a context variable, a template variable, response or outcome the model does
    // not hold, and the built-in `duration` a rule sets the default or correct response of.
    const templateMarks = Option.match(templateRead, {
      onNone: () => [],
      onSome: (read) =>
        unheldIdentifiers(
          read.tree,
          responses,
          outcomes,
          templateDeclarations,
          new Set(),
          heldBuiltIns(root),
          build.names,
        ).map((name) => `variable:${name}`),
    });
    const templateProcessing = templateRead.pipe(
      Option.filter(() => templateMarks.length === 0),
      Option.map((read) => read.tree),
    );
    // A `qti-template-processing` that does not run: its rules hold an element the engine does not
    // run, which `templateRules` marked, or name a variable the engine does not hold while they run.
    const stalled =
      childrenNamed(root, "qti-template-processing").length > 0 &&
      Option.isNone(templateProcessing);
    const runs = processing.pipe(
      Option.flatMap((read) =>
        runnable(
          build,
          read,
          responses,
          outcomes,
          stalled ? new Map() : templateDeclarations,
          records,
        ),
      ),
    );
    // Placed after `runnable`'s: a valid item's `qti-template-processing` precedes its
    // `qti-response-processing`, so these go at a count no greater than response processing's, and
    // placing them second keeps both in document order.
    if (Option.isSome(templateRead)) {
      markAt(build, templateRead.value.at, templateRead.value.path, templateMarks);
    }

    const built: Item = {
      body,
      document: source.location,
      identifier,
      lang: valueOf(root, "xml:lang"),
      outcomes,
      processing: stalled ? Option.none() : runs,
      responses,
      templateProcessing,
      templates: templateDeclarations,
      title,
      unsupported: build.unsupported,
    };

    // `records` is absent when the item makes no record response declaration it holds, and `unheld`
    // when it makes no declaration it holds no value of, as a model built by hand leaves them out.
    const withRecords: Item = records.size === 0 ? built : { ...built, records };

    return unheld.size === 0 ? withRecords : { ...withRecords, unheld };
  });
