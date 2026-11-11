/**
 * The prose rules: what QTI's information model and the project's readings require of an item
 * beyond what its XSD can say.
 *
 * {@link checkRules} returns every refusal it finds, in document order, and never stops at the
 * first, so the verdict can collect them beside the structural validator's. The list of rules is
 * closed: a rule this module does not implement is not refused, and each rule's function names the
 * sentence of the information model, or the reading, that settles it. A rule judges only what the
 * structural validator lets through: a missing or out-of-vocabulary attribute is the XSD's refusal,
 * so a prose rule that would read it passes over it rather than refusing the same fault twice.
 *
 * @module
 */
import { Array as Arr, Option, Result } from "effect";
import { attributePath, qtiNamespace, walk } from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceChild,
  SourceDocument,
  SourceElement,
  Visit,
} from "#plate/document/source.ts";
import {
  accepts,
  expressionKinds,
  floatOrRefOf,
  integerOrRefOf,
  singleOf,
  stringOrRefOf,
} from "#plate/model/expression.ts";
import type {
  ExpressionKind,
  ExpressionType,
  KindRule,
  LiteralOrRef,
  ReferenceEntry,
  ResultAttributes,
} from "#plate/model/expression.ts";
import { kindRules } from "#plate/model/expressions/read.ts";
import {
  format,
  integerLexical,
  isModelled,
  isNcName,
  parseElementText,
  parseLexical,
  readIeeeDouble,
  trimXmlSpace,
} from "#plate/model/values.ts";
import type { InvalidValue, ModelledBaseType, Single } from "#plate/model/values.ts";
import { decodeDataSsml } from "#plate/validate/data-ssml.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import { governingTables } from "#plate/validate/structure.ts";
import { missingToolAttributes } from "#plate/validate/versions.ts";
import type { ChildName, Tables } from "#plate/validate/xsd.ts";
import { baseTypes, cardinalities, templateName } from "#plate/vocabulary.ts";
import type { BaseType, Cardinality, TemplateName } from "#plate/vocabulary.ts";

/**
 * The base types and cardinalities a response declaration may have when an interaction is bound to
 * it.
 *
 * A declaration of one of `cardinalities` other than `record` must also have one of `baseTypes`. A
 * `record` declaration is judged by its cardinality alone, because a record holds named fields
 * (`stringValue`, `floatValue`, …) and has no base type of its own.
 */
interface Requirement {
  readonly baseTypes: readonly BaseType[];
  readonly cardinalities: readonly Cardinality[];
}

/**
 * The binding an interaction requires, by local name, quoted from the normative class descriptions
 * of QTI 3.0's information model (its section 5).
 *
 * This is what QTI allows, not what plate renders: a binding QTI allows and plate does not render,
 * such as a Text Entry bound to a record response with a `file` field, is valid and becomes a
 * notice (`renders` in the vocabulary), so it is not refused here. An interaction whose binding
 * sentence is only in the non-normative section 2 has no entry, by rule `5b8ee08b` (refuse only
 * what the standard refuses) and the operator's ruling `e3bc2c3d`: the Order's "must be bound to a
 * response variable with a base-type of identifier and ordered cardinality only" is §2.4.1.2's
 * alone (info.txt:8766), and its class description, §5.97, does not repeat it. The other
 * interactions' bindings are not checked here; reading 92's counts reach some of them
 * ({@link cardinalityCounts}).
 */
const requirements: ReadonlyMap<string, Requirement> = new Map<string, Requirement>([
  // "The ChoiceInteraction must be bound to a response variable with a base-type of identifier and
  // single or multiple cardinality." (§5.30, info.txt:21733)
  ["qti-choice-interaction", { baseTypes: ["identifier"], cardinalities: ["single", "multiple"] }],
  // "The qti-extended-text-interaction must be bound to a response variable of single, multiple,
  // ordered or record cardinality. [...] Otherwise it ust have a base-type of string, integer or
  // float." (§5.48, info.txt:25345)
  [
    "qti-extended-text-interaction",
    {
      baseTypes: ["string", "integer", "float"],
      cardinalities: ["single", "multiple", "ordered", "record"],
    },
  ],
  // "The order hotspot interaction must be bound to a response variable with a base-type of
  // identifier and ordered cardinality." (§5.61, info.txt:29186)
  ["qti-graphic-order-interaction", { baseTypes: ["identifier"], cardinalities: ["ordered"] }],
  // "The inlineChoiceInteraction must be bound to a response variable with a base-type of identifier
  // and single cardinality only." (§5.74, info.txt:32207)
  ["qti-inline-choice-interaction", { baseTypes: ["identifier"], cardinalities: ["single"] }],
  // "The textEntryInteraction must be bound to a response variable with single or record
  // cardinality only. If the response variable has single cardinality the base-type must be one of
  // string, integer or float" (§5.162, info.txt:47996)
  [
    "qti-text-entry-interaction",
    { baseTypes: ["string", "integer", "float"], cardinalities: ["single", "record"] },
  ],
]);

/**
 * The count that decides the cardinality of the response an interaction binds: its attribute, and
 * the XSD's default for it, which an unwritten count is read as.
 */
interface CardinalityCount {
  readonly attribute: "max-associations" | "max-choices";
  readonly unwritten: bigint;
}

/**
 * The interactions whose most count decides the cardinality of the response they bind, by local
 * name, under reading 92 ("the information model's binding and count sentences that no other
 * reading restates hold as written"): "If max-choices is greater than 1 (or 0) then the interaction
 * must be bound to a response with multiple cardinality", of the `max-choices` of the choice,
 * hottext, hotspot, position object and select point interactions and the `max-associations` of the
 * associate, gap match, graphic associate, graphic gap match and match interactions, each unwritten
 * count read as its XSD default. Both XSDs give every one of them the default `1` but the select
 * point's `max-choices`, whose default is `0`.
 */
const cardinalityCounts: ReadonlyMap<string, CardinalityCount> = new Map([
  ["qti-associate-interaction", { attribute: "max-associations", unwritten: 1n }],
  ["qti-choice-interaction", { attribute: "max-choices", unwritten: 1n }],
  ["qti-gap-match-interaction", { attribute: "max-associations", unwritten: 1n }],
  ["qti-graphic-associate-interaction", { attribute: "max-associations", unwritten: 1n }],
  ["qti-graphic-gap-match-interaction", { attribute: "max-associations", unwritten: 1n }],
  ["qti-hotspot-interaction", { attribute: "max-choices", unwritten: 1n }],
  ["qti-hottext-interaction", { attribute: "max-choices", unwritten: 1n }],
  ["qti-match-interaction", { attribute: "max-associations", unwritten: 1n }],
  ["qti-position-object-interaction", { attribute: "max-choices", unwritten: 1n }],
  ["qti-select-point-interaction", { attribute: "max-choices", unwritten: 0n }],
]);

/**
 * The interactions that bind a second response through a `string-identifier`, the only ones whose
 * XSD declares it: "If the string interaction is bound to a numeric response variable then the
 * actual string entered by the candidate can also be captured by binding the interaction to a
 * second response variable (of base-type string)" (info.txt:25400 and info.txt:48078, the
 * Extended Text's and the Text Entry's `string-identifier`).
 */
const stringBindings: ReadonlySet<string> = new Set([
  "qti-extended-text-interaction",
  "qti-text-entry-interaction",
]);

/**
 * A least count and the most it may reach, both written on one element.
 *
 * Only the most's XSD default is kept: an unwritten least is at most any most, since its XSD
 * default, where it has one, is `0`.
 */
interface CountPair {
  /**
   * The least count's attribute.
   */
  readonly least: string;
  /**
   * The most count's attribute.
   */
  readonly most: string;
  /**
   * The reading that settles the pair.
   */
  readonly reading: string;
  /**
   * The most's XSD default, which an unwritten most is read as, none where the XSD gives none.
   */
  readonly unwritten: Option.Option<bigint>;
  /**
   * Whether a most of `0` sets no limit, so that any least meets it.
   */
  readonly zeroUnlimited: boolean;
}

/**
 * Construct one of reading 76's count pairs, in which a most of `0` sets no limit.
 *
 * @param least The least count's attribute.
 * @param most The most count's attribute.
 * @param unwritten The most's XSD default, none where the XSD gives none.
 * @returns The pair.
 */
const limitPair = (least: string, most: string, unwritten: Option.Option<bigint>): CountPair => ({
  least,
  most,
  reading: "76",
  unwritten,
  zeroUnlimited: true,
});

/**
 * The `min-associations` and `max-associations` pair, whose most every interaction that writes it
 * defaults to `1`.
 */
const associations = limitPair("min-associations", "max-associations", Option.some(1n));

/**
 * The `match-min` and `match-max` pair, whose most the XSD requires and so gives no default.
 */
const matches = limitPair("match-min", "match-max", Option.none());

/**
 * The count pairs reading 76 ("a least count is at most its most, unless the most is 0") holds, by
 * the local name of the element that writes them: the `min-choices` and `max-choices` of the
 * choice, hottext, hotspot, position object and select point interactions, the `min-associations`
 * and `max-associations` of the associate, gap match, graphic associate, graphic gap match and
 * match interactions, the `match-min` and `match-max` of the associable hotspot, gap image, gap
 * text and simple associable choice, an extended text interaction's `min-strings` and
 * `max-strings`, and a media interaction's `min-plays` and `max-plays`. Each most's default is the
 * XSD's: `1` but the select point's `max-choices` and the media interaction's `max-plays`, `0`,
 * and none for `match-max` and `max-strings`.
 */
const countPairs: ReadonlyMap<string, CountPair> = new Map([
  ["qti-associable-hotspot", matches],
  ["qti-associate-interaction", associations],
  ["qti-choice-interaction", limitPair("min-choices", "max-choices", Option.some(1n))],
  ["qti-extended-text-interaction", limitPair("min-strings", "max-strings", Option.none())],
  ["qti-gap-img", matches],
  ["qti-gap-match-interaction", associations],
  ["qti-gap-text", matches],
  ["qti-graphic-associate-interaction", associations],
  ["qti-graphic-gap-match-interaction", associations],
  ["qti-hotspot-interaction", limitPair("min-choices", "max-choices", Option.some(1n))],
  ["qti-hottext-interaction", limitPair("min-choices", "max-choices", Option.some(1n))],
  ["qti-match-interaction", associations],
  ["qti-media-interaction", limitPair("min-plays", "max-plays", Option.some(0n))],
  ["qti-position-object-interaction", limitPair("min-choices", "max-choices", Option.some(1n))],
  ["qti-select-point-interaction", limitPair("min-choices", "max-choices", Option.some(0n))],
  ["qti-simple-associable-choice", matches],
]);

/**
 * The `min-choices` and `max-choices` pair of an order or graphic order interaction, under reading
 * 18: neither interaction gives `0` the meaning "no limit", and the XSD gives neither count a
 * default.
 */
const orderPair: CountPair = {
  least: "min-choices",
  most: "max-choices",
  reading: "18",
  unwritten: Option.none(),
  zeroUnlimited: false,
};

/**
 * The interactions reading 18 bounds by their number of choices, by local name, each with the
 * local name of the children that are its choices.
 */
const orderedChoices: ReadonlyMap<string, string> = new Map([
  ["qti-graphic-order-interaction", "qti-hotspot-choice"],
  ["qti-order-interaction", "qti-simple-choice"],
]);

/**
 * Read an identifier attribute's value as its XSD type reads it.
 *
 * Every identifier these rules compare is an `xs:NCName` or an `xs:ID` or `xs:IDREF` derived from
 * it, whose whitespace facet is `collapse`, and an NCName holds no inner whitespace, so collapsing
 * is removing the outer whitespace. Reading 7 keeps an attribute's outer whitespace only for the
 * base-typed attributes the XSD types as strings, which no identifier here is, so `" RESPONSE"`
 * names `RESPONSE` and refusing it would refuse valid content (reading 1).
 *
 * @param attribute The identifier attribute.
 * @returns The identifier it names.
 */
const identifierOf = (attribute: SourceAttribute): string => trimXmlSpace(attribute.value);

/**
 * Read the name an identifier attribute gives, where it gives one: its value collapsed
 * ({@link identifierOf}), when that is an NCName.
 *
 * Reading 152 ("a value names something only where it is an NCName"): a declaration's
 * `identifier`, an interaction's binding and a variable reference name something only as an
 * `xs:NCName`, and a value outside that lexical space names nothing. It shares no name with
 * another, no reference resolves to it, and the law a reference, a binding or a name is held to
 * does not judge it: the attribute's value domain, the structural validator's `attribute-type`,
 * refuses it alone (readings 157 and 159, E40a). So every law here that resolves or compares a name
 * reads it through this.
 *
 * @param attribute The identifier attribute.
 * @returns The name it gives, none when its collapsed value is no NCName.
 */
const nameOf = (attribute: SourceAttribute): Option.Option<string> =>
  Option.filter(Option.some(identifierOf(attribute)), isNcName);

/**
 * Find an element's attribute in no namespace by its local name.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @returns The attribute, or none when the element does not carry it.
 */
const attributeOf = (element: SourceElement, local: string): Option.Option<SourceAttribute> =>
  Arr.findFirst(
    element.attributes,
    (attribute) => attribute.namespace === "" && attribute.local === local,
  );

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
 * Look a QTI element up in a table keyed by local name.
 *
 * @param table The table.
 * @param element The element.
 * @returns The element's entry, none for an element outside QTI's namespace and for one the table
 *   has no entry for.
 */
const qtiEntry = <Entry>(
  table: ReadonlyMap<string, Entry>,
  element: SourceElement,
): Option.Option<Entry> =>
  element.namespace === qtiNamespace
    ? Option.fromUndefinedOr(table.get(element.local))
    : Option.none();

/**
 * Report whether an element is one of the item's variable declarations, a `qti-*-declaration`.
 *
 * @param element The element.
 * @returns Whether it is a QTI element named `qti-<kind>-declaration`.
 */
const isDeclaration = (element: SourceElement): boolean =>
  isQti(element, (local) => local.startsWith("qti-") && local.endsWith("-declaration"));

/**
 * Report whether an element is an interaction.
 *
 * The XSD declares `response-identifier` on exactly the twenty-two `qti-*-interaction` elements. On
 * any other element only an attribute wildcard admits it, which binds nothing, so the rule that
 * resolves it reads it on interactions alone.
 *
 * @param element The element.
 * @returns Whether it is a QTI element named `qti-<kind>-interaction`.
 */
const isInteraction = (element: SourceElement): boolean =>
  isQti(element, (local) => local.startsWith("qti-") && local.endsWith("-interaction"));

/**
 * Report whether a declaration's base type and cardinality meet an interaction's requirement.
 *
 * @param requirement The interaction's requirement.
 * @param cardinality The declaration's cardinality.
 * @param baseType The declaration's base type, none when its `base-type` is absent or spells none.
 * @returns Whether the cardinality is one the requirement allows and, unless it is `record`, the
 *   base type is one it allows.
 */
const meets = (
  requirement: Requirement,
  cardinality: Cardinality,
  baseType: Option.Option<BaseType>,
): boolean =>
  requirement.cardinalities.includes(cardinality) &&
  (cardinality === "record" ||
    Option.exists(baseType, (value) => requirement.baseTypes.includes(value)));

/**
 * Index the declarations of one kind of an item, or of a test, by the identifier each declares.
 *
 * The declarations are the root's children of that name. When two share an identifier, the last
 * one wins, as it does where the item model binds an interaction; the duplicate is
 * `duplicate-identifier`'s refusal.
 *
 * @param source The document.
 * @param kind The declarations' local name, such as `qti-response-declaration`.
 * @returns Each declared identifier with its declaration.
 */
export const declarationsOf = (
  source: SourceDocument,
  kind: string,
): ReadonlyMap<string, SourceElement> =>
  new Map(
    source.root.children.flatMap((child) =>
      child.kind === "element" && isQti(child, (local) => local === kind)
        ? Option.toArray(
            Option.map(
              attributeOf(child, "identifier"),
              (identifier) => [identifierOf(identifier), child] as const,
            ),
          )
        : [],
    ),
  );

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
 * The choice classes whose identifiers share one pool across an item: the nine classes reading 104
 * as amended names ("A choice's identifier is used by no other choice of any class in its
 * document, and names no item variable"), `qti-gap` among them. Each says of its identifier that it
 * "must not be used by any other choice or item variable" (SimpleChoice 5.132.1, `info.txt:42411`;
 * InlineChoice 5.73.1, `info.txt:31918`) or names its own noun ("any other gap", "any other image",
 * "any other text", "any other hotspot", "any other hottext choice"); the amended reading pools the
 * nine, so no two choices of these classes in one item share an identifier, whichever interactions
 * hold them, and a gap and a gap text of one Gap Match may not share one either.
 */
const pooledChoices: ReadonlySet<string> = new Set([
  "qti-associable-hotspot",
  "qti-gap",
  "qti-gap-img",
  "qti-gap-text",
  "qti-hotspot-choice",
  "qti-hottext",
  "qti-inline-choice",
  "qti-simple-associable-choice",
  "qti-simple-choice",
]);

/**
 * The identifiers an item's choices have given so far, each with the class of the first element
 * that gave it: one pool for every class of {@link pooledChoices}, gaps included.
 */
export interface ChoicePools {
  readonly choices: Map<string, string>;
}

/**
 * Find the pool an element's `identifier` is unique within, if it is a choice.
 *
 * Reading 104 as amended gives every choice class one space of identifiers, so a gap shares the
 * pool with the other eight classes: it repeats no gap's identifier, "any other gap" (Gap 5.55.1),
 * and no other choice's, a gap text's of its own Gap Match included.
 *
 * @param element The element.
 * @param pools The item's pools.
 * @returns The pool, or none for an element that is no choice.
 */
const choicePool = (
  element: SourceElement,
  pools: ChoicePools,
): Option.Option<Map<string, string>> =>
  isQti(element, (local) => pooledChoices.has(local)) ? Option.some(pools.choices) : Option.none();

/**
 * Apply `duplicate-identifier` to one choice, a gap included (reading 104 as amended, "A choice's
 * identifier is used by no other choice of any class in its document, and names no item variable",
 * E19): its `identifier` names no item variable, and no earlier choice of the pool
 * ({@link choicePool}) gave it.
 *
 * The item variables are its declarations of all four kinds and its built-ins, `completionStatus`,
 * `numAttempts`, `duration` and `QTI_CONTEXT`, which "are declared implicitly". A choice that names
 * one is refused under `check: "choice-variable"` alone, whether or not it also repeats an earlier
 * choice's identifier, and still counts toward its pool.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param variables The identifiers of the item's variables, declared and built in.
 * @param pools The identifiers the pool has given so far, which this adds the element's to.
 * @returns The refusal at the `identifier` attribute's path, with the element's `class` and, for a
 *   repeat of a choice of another class, its `otherClass`; none for an element that is no choice,
 *   for a first occurrence that names no variable, and for an identifier that names nothing
 *   ({@link nameOf}).
 */
export const choiceIdentifier = (
  source: SourceDocument,
  visit: Visit,
  variables: ReadonlySet<string>,
  pools: ChoicePools,
): readonly Refusal[] => {
  const pool = choicePool(visit.element, pools);
  const attribute = attributeOf(visit.element, "identifier");
  const name = attribute.pipe(Option.flatMap(nameOf));
  if (Option.isNone(pool) || Option.isNone(attribute) || Option.isNone(name)) {
    return [];
  }

  const identifier = name.value;
  const path = attributePath(visit.path, attribute.value);
  const choiceClass = visit.element.local;
  const earlier = Option.fromUndefinedOr(pool.value.get(identifier));
  if (Option.isNone(earlier)) {
    pool.value.set(identifier, choiceClass);
  }

  if (variables.has(identifier)) {
    return [
      refusal(source, "duplicate-identifier", path, {
        check: "choice-variable",
        class: choiceClass,
        identifier,
        reading: "104",
      }),
    ];
  }

  return Option.match(earlier, {
    onNone: () => [],
    onSome: (otherClass) => [
      refusal(
        source,
        "duplicate-identifier",
        path,
        otherClass === choiceClass
          ? { class: choiceClass, identifier, reading: "104" }
          : { class: choiceClass, identifier, otherClass, reading: "104" },
      ),
    ],
  });
};

/**
 * Apply `duplicate-identifier` to one of the item's declarations: its `identifier` is not one an
 * earlier declaration gave.
 *
 * The item's declarations share one scope, the root: "All item variables declared in an item share
 * the same namespace" (info.txt:12006). A choice's identifier is judged against them, and against
 * the other choices, by {@link choiceIdentifier}.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param declared The identifiers the item's declarations have given so far, which this adds the
 *   element's to.
 * @returns The refusal at the repeated `identifier` attribute's path, or none for the first
 *   occurrence, for an element that is no declaration of the root, and for an identifier that names
 *   nothing ({@link nameOf}).
 */
const duplicateDeclaration = (
  source: SourceDocument,
  visit: Visit,
  declared: Set<string>,
): readonly Refusal[] => {
  const attribute = attributeOf(visit.element, "identifier");
  const name = attribute.pipe(Option.flatMap(nameOf));
  const declaration =
    Option.exists(visit.parent, (parent) => parent === source.root) && isDeclaration(visit.element);
  if (!declaration || Option.isNone(attribute) || Option.isNone(name)) {
    return [];
  }

  const identifier = name.value;
  if (!declared.has(identifier)) {
    declared.add(identifier);

    return [];
  }

  return [
    refusal(source, "duplicate-identifier", attributePath(visit.path, attribute.value), {
      identifier,
    }),
  ];
};

/**
 * Read a declaration's cardinality, where its `cardinality` spells one.
 *
 * Reading 158 ("a declaration whose cardinality or base type spells nothing is still a declaration:
 * each law over it judges what it does spell"): a `cardinality` that is absent or outside the
 * vocabulary is the structural validator's refusal, and a law that reads it judges nothing here.
 *
 * @param declaration The declaration.
 * @returns Its cardinality, none when it spells none.
 */
const cardinalityOf = (declaration: SourceElement): Option.Option<Cardinality> =>
  Option.flatMap(attributeOf(declaration, "cardinality"), (attribute) =>
    Arr.findFirst(cardinalities, (value) => value === attribute.value),
  );

/**
 * A declaration's `base-type` as written, and the base type it spells.
 */
interface DeclaredBaseType {
  readonly baseType: Option.Option<BaseType>;
  readonly written: Option.Option<string>;
}

/**
 * Read a declaration's `base-type` as written, and the base type it spells.
 *
 * Under reading 158 a `base-type` that spells nothing types nothing, as an unwritten one does, so
 * a law that reads the base type judges neither.
 *
 * @param declaration The declaration.
 * @returns The `base-type` as written, none when absent, and the base type it spells, none when
 *   absent or outside the vocabulary.
 */
const baseTypeOf = (declaration: SourceElement): DeclaredBaseType => {
  const written = Option.map(attributeOf(declaration, "base-type"), (attribute) => attribute.value);

  return {
    baseType: written.pipe(
      Option.flatMap((value) => Arr.findFirst(baseTypes, (candidate) => candidate === value)),
    ),
    written,
  };
};

/**
 * Read a count attribute's value as an `xs:nonNegativeInteger`, exactly and unbounded (reading 45).
 *
 * @param attribute The count attribute.
 * @returns The count, none when its value is not a non-negative integer, which the structural
 *   validator refuses as `attribute-type`.
 */
const nonNegativeOf = (attribute: SourceAttribute): Option.Option<bigint> => {
  const lexical = trimXmlSpace(attribute.value);

  return integerLexical.test(lexical)
    ? Option.filter(Option.some(BigInt(lexical)), (value) => value >= 0n)
    : Option.none();
};

/**
 * Read an interaction's count as an `xs:nonNegativeInteger`, or as the XSD's default where the
 * interaction does not write it, exactly and unbounded (reading 45).
 *
 * @param element The interaction.
 * @param count The count and its default.
 * @returns The count, none when its value is not a non-negative integer, which the structural
 *   validator refuses as `attribute-type`.
 */
const countOf = (element: SourceElement, count: CardinalityCount): Option.Option<bigint> =>
  Option.match(attributeOf(element, count.attribute), {
    onNone: () => Option.some(count.unwritten),
    onSome: nonNegativeOf,
  });

/**
 * List the `qti-gap`s an element holds, at any depth.
 *
 * @param element The element.
 * @returns Its QTI `qti-gap` descendants, in document order.
 */
const gapsIn = (element: SourceElement): readonly SourceElement[] =>
  element.children.flatMap((child) =>
    child.kind === "element"
      ? [...(isQti(child, (local) => local === "qti-gap") ? [child] : []), ...gapsIn(child)]
      : [],
  );

/**
 * Apply a count pair to an element: its least count is at most its most, unless the most is `0`
 * and the pair reads `0` as no limit.
 *
 * Each count is read as written, exactly and unbounded (reading 45); an unwritten most is read as
 * its XSD default, and an unwritten least is at most any most. A pair whose most is unwritten with
 * no default is not compared, nor one whose count's value is not a non-negative integer, which is
 * the structural validator's `attribute-type`. A least above its most is `count-range` with
 * `check: "count-pair"`, at the most where it is written and otherwise at the element that would
 * write it.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param pair The pair it writes.
 * @returns The refusal, or none when the least is at most the most.
 */
const pairRefusals = (
  source: SourceDocument,
  visit: Visit,
  pair: CountPair,
): readonly Refusal[] => {
  const written = attributeOf(visit.element, pair.most);
  const least = Option.flatMap(attributeOf(visit.element, pair.least), nonNegativeOf);
  const most = Option.match(written, { onNone: () => pair.unwritten, onSome: nonNegativeOf });
  if (
    Option.isNone(least) ||
    Option.isNone(most) ||
    least.value <= most.value ||
    (pair.zeroUnlimited && most.value === 0n)
  ) {
    return [];
  }

  const at = Option.match(written, {
    onNone: () => visit.path,
    onSome: (attribute) => attributePath(visit.path, attribute),
  });

  return [
    refusal(source, "count-range", at, {
      check: "count-pair",
      element: visit.element.local,
      least: pair.least,
      leastValue: least.value.toString(),
      most: pair.most,
      mostValue: most.value.toString(),
      reading: pair.reading,
    }),
  ];
};

/**
 * Apply reading 18 to an order or graphic order interaction that writes `min-choices`: that count,
 * and a `max-choices` beside it, is at most the interaction's number of choices, its
 * `qti-simple-choice` or `qti-hotspot-choice` children, and its `max-choices` is at least its
 * `min-choices`, `0` included ({@link orderPair}).
 *
 * The information model's sentences for both interactions: "If specified, min-choices must be 1 or
 * greater but must not exceed the number of choices available. If unspecified, all of the choices
 * must be ordered and max-choices is ignored", and "max-choices must be greater than or equal to
 * min-choices and must not exceed the number of choices available". So without a `min-choices` no
 * count is read. A count above the number of choices is `count-range` with `check:
 * "choice-count"`, at the count; a `min-choices` below 1 is the structural validator's refusal.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @returns The refusals, none for an element that is no order or graphic order interaction, or
 *   that writes no `min-choices`.
 */
const orderCounts = (source: SourceDocument, visit: Visit): readonly Refusal[] => {
  const choice = qtiEntry(orderedChoices, visit.element);
  if (Option.isNone(choice) || Option.isNone(attributeOf(visit.element, "min-choices"))) {
    return [];
  }

  const choices = BigInt(
    visit.element.children.filter(
      (child) => child.kind === "element" && isQti(child, (local) => local === choice.value),
    ).length,
  );
  const overChoices = [orderPair.least, orderPair.most].flatMap((local) =>
    Option.toArray(
      Option.flatMap(attributeOf(visit.element, local), (attribute) =>
        Option.map(
          Option.filter(nonNegativeOf(attribute), (value) => value > choices),
          (value) =>
            refusal(source, "count-range", attributePath(visit.path, attribute), {
              attribute: local,
              check: "choice-count",
              choices: choices.toString(),
              reading: orderPair.reading,
              value: value.toString(),
            }),
        ),
      ),
    ),
  );

  return [...overChoices, ...pairRefusals(source, visit, orderPair)];
};

/**
 * Apply the count rules to an element: reading 76's pairs ({@link countPairs}) and reading 18's
 * counts of an order or graphic order interaction ({@link orderCounts}).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @returns The `count-range` refusals, none when every count it writes holds.
 */
const countRules = (source: SourceDocument, visit: Visit): readonly Refusal[] => [
  ...Option.match(qtiEntry(countPairs, visit.element), {
    onNone: () => [],
    onSome: (pair) => pairRefusals(source, visit, pair),
  }),
  ...orderCounts(source, visit),
];

/**
 * Apply reading 92's count sentence, then the operator's ruling on a gap match, to an interaction
 * and the cardinality of the response it binds.
 *
 * Reading 92 ("the information model's binding and count sentences that no other reading restates
 * hold as written"): "If max-choices is greater than 1 (or 0) then the interaction must be bound to
 * a response with multiple cardinality", of each count {@link cardinalityCounts} lists, read as
 * written or as its XSD default. A count above 1, or 0, which sets no limit, bound to a response
 * that is not `multiple` is `binding` with `check: "count-cardinality"`. A count whose value is not
 * a non-negative integer is the structural validator's refusal and is not compared.
 *
 * The operator's ruling P7, which main now shares as reading 169 ("A gap match interaction with two
 * or more gaps binds a response of multiple cardinality"), beside reading 92's sentence on
 * `max-associations`: the gap match "must be bound to a response variable with base-type
 * 'directedPair' and either single or multiple cardinality, depending on the number of gaps"
 * (info.txt:8792), and "with one gap either cardinality may bind, and with two or more only
 * `multiple` may". So a gap match of two or more `qti-gap`s bound to a response that is not
 * `multiple` (`single`, `ordered` or `record`) is `binding` with `check: "gap-match-single"`, whose
 * `cardinality` is the response's. Main and pantry refuse each of them too: pantry's `Binding
 * cardinality` law refuses a `single` one (`packages/pantry/src/qti/interactions.ts`), and its fit
 * laws an `ordered` one (`BindingFit`, which admits a gap match bound `single` or `multiple`) and a
 * `record` one (`RecordBindingFit`, which admits no gap match), both in
 * `packages/pantry/src/grammar/facets.ts`. A gap match of one gap is not judged here: binding it
 * `ordered` or `record` is outside E11's reach. The gaps are judged only where the count gives no
 * refusal, so a gap match bound otherwise than `multiple` gets one refusal, whose remedy, a
 * `multiple` response, is the same.
 *
 * @param source The document.
 * @param visit The interaction's visit.
 * @param response The response identifier it binds.
 * @param cardinality That response's cardinality.
 * @returns The refusal, or none when the interaction binds as its count and its gaps need.
 */
const cardinalityRules = (
  source: SourceDocument,
  visit: Visit,
  response: string,
  cardinality: Cardinality,
): readonly Refusal[] => {
  const count = qtiEntry(cardinalityCounts, visit.element);
  if (Option.isNone(count) || cardinality === "multiple") {
    return [];
  }

  const counted = Option.match(countOf(visit.element, count.value), {
    onNone: () => [],
    onSome: (value) =>
      value === 1n
        ? []
        : [
            refusal(source, "binding", visit.path, {
              attribute: count.value.attribute,
              check: "count-cardinality",
              count: value.toString(),
              interaction: visit.element.local,
              reading: "92",
              response,
            }),
          ],
  });
  const gaps =
    counted.length === 0 && visit.element.local === "qti-gap-match-interaction"
      ? gapsIn(visit.element).length
      : 0;

  return gaps > 1
    ? [
        refusal(source, "binding", visit.path, {
          cardinality,
          check: "gap-match-single",
          gaps: gaps.toString(),
          interaction: visit.element.local,
          response,
        }),
      ]
    : counted;
};

/**
 * Apply `binding`, reading 92's counts and reading 19 to an interaction and the declaration its
 * `response-identifier` names.
 *
 * `binding` reads the declaration the interaction's `response-identifier` names, never any other
 * declaration in the document: QTI's Schematron runs some base-type tests against every
 * declaration, and by reading 9 ("the Schematron's rules are read by their intent, not their text")
 * each rule applies over the bound declaration. Every interaction {@link requirements} lists is held
 * to its requirement; every interaction {@link cardinalityCounts} lists is held to its count, and a
 * gap match to its gaps ({@link cardinalityRules}), only where the requirement gives no refusal,
 * since that refusal already names the response's cardinality.
 *
 * Reading 158 ("a declaration whose cardinality or base type spells nothing is still a declaration:
 * each law over it judges what it does spell"): a declaration whose `cardinality` spells nothing is
 * not judged. The requirement reads both attributes but for a `record`, which it judges by its
 * cardinality alone, so a declaration of another cardinality whose `base-type` is absent (E39a's
 * `missing-attribute`) or spells nothing (its value domain's `attribute-type`) is not held to it;
 * the counts read the cardinality alone.
 *
 * Reading 19: an Extended Text bound to a `multiple` or `ordered` declaration carries `max-strings`
 * (the information model requires it of a container binding; the XSD makes it optional because it
 * cannot see the binding). Without it the interaction is `missing-attribute`; the binding itself
 * stays valid.
 *
 * @param source The document.
 * @param visit The interaction's visit.
 * @param response The response identifier it names.
 * @param declaration The declaration of that identifier.
 * @returns The refusals `binding` and reading 19 give, empty when the binding holds.
 */
const bindingRules = (
  source: SourceDocument,
  visit: Visit,
  response: string,
  declaration: SourceElement,
): readonly Refusal[] => {
  const cardinality = cardinalityOf(declaration);
  if (Option.isNone(cardinality)) {
    return [];
  }

  const { baseType, written } = baseTypeOf(declaration);
  const judged = cardinality.value === "record" || Option.isSome(baseType);
  const binding = Option.match(qtiEntry(requirements, visit.element), {
    onNone: () => [],
    onSome: (requirement) =>
      judged && !meets(requirement, cardinality.value, baseType)
        ? [
            refusal(source, "binding", visit.path, {
              baseType: Option.getOrElse(written, () => ""),
              cardinality: cardinality.value,
              interaction: visit.element.local,
              response,
            }),
          ]
        : [],
  });
  const counted =
    binding.length === 0 ? cardinalityRules(source, visit, response, cardinality.value) : [];

  const extendedText = isQti(visit.element, (local) => local === "qti-extended-text-interaction");
  const container = cardinality.value === "multiple" || cardinality.value === "ordered";
  const maxStrings =
    extendedText && container && Option.isNone(attributeOf(visit.element, "max-strings"))
      ? [
          refusal(source, "missing-attribute", visit.path, {
            attribute: "max-strings",
            element: visit.element.local,
          }),
        ]
      : [];

  return [...binding, ...counted, ...maxStrings];
};

/**
 * Apply reading 92's "Each response variable declared may be bound to one and only one
 * interaction" to one binding: a response that an earlier binding of the item already binds is
 * `binding` with `check: "bound-once"`, at the attribute that binds it the second time.
 *
 * @param source The document.
 * @param visit The interaction's visit.
 * @param attribute The attribute that binds the response, a `response-identifier` or a
 *   `string-identifier`.
 * @param response The declared response it names.
 * @param bound The responses earlier bindings bind, which this adds `response` to.
 * @param reading The reading that settles a second binding here: `92` for another interaction's,
 *   `14` for a `string-identifier` that names its own interaction's response.
 * @returns The refusal, or none for the response's first binding.
 */
const boundOnce = (
  source: SourceDocument,
  visit: Visit,
  attribute: SourceAttribute,
  response: string,
  bound: Set<string>,
  reading: string,
): readonly Refusal[] => {
  if (!bound.has(response)) {
    bound.add(response);

    return [];
  }

  return [
    refusal(source, "binding", attributePath(visit.path, attribute), {
      attribute: attribute.local,
      check: "bound-once",
      interaction: visit.element.local,
      reading,
      response,
    }),
  ];
};

/**
 * Apply `undeclared-response` to an interaction's `response-identifier`, then reading 92's single
 * binding and {@link bindingRules} to the declaration it names.
 *
 * Reading I-8.6 (the goal's decision `01e90255`): an interaction's `response-identifier` names a
 * declared `qti-response-declaration`; reading 14 ("a text-entry interaction's
 * `response-identifier` and `string-identifier` are `xs:IDREF`s, as the XSD types them") resolves a
 * Text Entry's to the declaration it names, as every interaction's is resolved here.
 *
 * @param source The document.
 * @param visit The interaction's visit.
 * @param declarations The item's response declarations by identifier.
 * @param bound The responses earlier bindings bind.
 * @param attribute The interaction's `response-identifier`.
 * @returns The refusal at the attribute's path when it names no declaration, otherwise the
 *   refusals of its binding; none when its value names nothing ({@link nameOf}).
 */
const responseBinding = (
  source: SourceDocument,
  visit: Visit,
  declarations: ReadonlyMap<string, SourceElement>,
  bound: Set<string>,
  attribute: SourceAttribute,
): readonly Refusal[] => {
  const name = nameOf(attribute);
  if (Option.isNone(name)) {
    return [];
  }

  const response = name.value;
  const declaration = declarations.get(response);
  if (declaration === undefined) {
    return [
      refusal(source, "undeclared-response", attributePath(visit.path, attribute), { response }),
    ];
  }

  return [
    ...boundOnce(source, visit, attribute, response, bound, "92"),
    ...bindingRules(source, visit, response, declaration),
  ];
};

/**
 * Apply `undeclared-response`, reading 92's single binding and `binding` to a Text Entry's or an
 * Extended Text's `string-identifier`.
 *
 * Reading 14 ("a text-entry interaction's `response-identifier` and `string-identifier` are
 * `xs:IDREF`s, as the XSD types them") resolves a `string-identifier` to the declaration it names,
 * as a `response-identifier` is resolved: naming no declared response is `undeclared-response`,
 * its `attribute` naming the `string-identifier`. The response it names is "a second response
 * variable (of base-type string)" (info.txt:48078), and the information model asks nothing more of
 * it (rule `5b8ee08b`), so it is held to that sentence alone, for a Text Entry and an Extended Text
 * alike: a `record`, which has no base type, and a declaration that spells a base type other than
 * `string` are each `binding` with `check: "string-binding"`, and any other cardinality fits,
 * whatever the interaction's own response is. Reading 158 holds the base type to it only where it
 * spells one; a declaration whose `cardinality` spells nothing is not judged. A response bound
 * already, the interaction's own among them, is bound a second time ({@link boundOnce}).
 *
 * @param source The document.
 * @param visit The interaction's visit.
 * @param declarations The item's response declarations by identifier.
 * @param bound The responses earlier bindings bind.
 * @param attribute The interaction's `string-identifier`.
 * @param own The response its `response-identifier` names, which sets the reading a second
 *   binding of it cites; none when it writes none or names nothing.
 * @returns The refusals of its binding, empty when it binds a `string` response that is not a
 *   `record` and that no other binding binds, and when its value names nothing ({@link nameOf}).
 */
const stringBinding = (
  source: SourceDocument,
  visit: Visit,
  declarations: ReadonlyMap<string, SourceElement>,
  bound: Set<string>,
  attribute: SourceAttribute,
  own: Option.Option<string>,
): readonly Refusal[] => {
  const name = nameOf(attribute);
  if (Option.isNone(name)) {
    return [];
  }

  const response = name.value;
  const declaration = declarations.get(response);
  if (declaration === undefined) {
    return [
      refusal(source, "undeclared-response", attributePath(visit.path, attribute), {
        attribute: attribute.local,
        element: visit.element.local,
        identifier: response,
        reading: "14",
        response,
      }),
    ];
  }

  const reading = Option.exists(own, (identifier) => identifier === response) ? "14" : "92";
  const cardinality = cardinalityOf(declaration);
  const { baseType, written } = baseTypeOf(declaration);
  const fits = Option.match(cardinality, {
    onNone: () => true,
    onSome: (value) => value !== "record" && !Option.exists(baseType, (type) => type !== "string"),
  });

  return [
    ...boundOnce(source, visit, attribute, response, bound, reading),
    ...(fits
      ? []
      : [
          refusal(source, "binding", visit.path, {
            baseType: Option.getOrElse(written, () => ""),
            cardinality: Option.getOrElse(cardinality, () => ""),
            check: "string-binding",
            interaction: visit.element.local,
            reading: "14",
            response,
          }),
        ]),
  ];
};

/**
 * Resolve the bindings of an interaction: its `response-identifier`, then, on a Text Entry or an
 * Extended Text, its `string-identifier`, in that order, so a `string-identifier` that names the
 * interaction's own response is its second binding.
 *
 * Only an interaction's bindings are read: the XSD declares `response-identifier` on the
 * `qti-*-interaction` elements and `string-identifier` on the two {@link stringBindings}, and on
 * any other element only an attribute wildcard admits either, which binds nothing. An interaction
 * with no `response-identifier` is the structural validator's `missing-attribute`.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param declarations The item's response declarations by identifier.
 * @param bound The responses earlier bindings bind, which this adds the interaction's to.
 * @returns The refusals of its bindings; none for an element that is not an interaction.
 */
const responseRules = (
  source: SourceDocument,
  visit: Visit,
  declarations: ReadonlyMap<string, SourceElement>,
  bound: Set<string>,
): readonly Refusal[] => {
  if (!isInteraction(visit.element)) {
    return [];
  }

  const own = attributeOf(visit.element, "response-identifier");
  const second = isQti(visit.element, (local) => stringBindings.has(local))
    ? attributeOf(visit.element, "string-identifier")
    : Option.none();
  const first = Option.match(own, {
    onNone: () => [],
    onSome: (attribute) => responseBinding(source, visit, declarations, bound, attribute),
  });

  return [
    ...first,
    ...Option.match(second, {
      onNone: () => [],
      onSome: (attribute) =>
        stringBinding(
          source,
          visit,
          declarations,
          bound,
          attribute,
          own.pipe(Option.flatMap(nameOf)),
        ),
    }),
  ];
};

/**
 * Apply reading 92 to a Portable Custom Interaction's `qti-context-variable`: it names a context
 * variable, one the item declares in a `qti-context-declaration` or the built-in `QTI_CONTEXT`.
 * The reading's bullet: the element "allows an item author to bind a context variable to the PCI
 * instance", the context variables are the declared ones and `QTI_CONTEXT`, and "All variables must
 * be declared except for the built-in session variables"; the Schematron's rule 20Ba states the
 * same. Another name is `undeclared-variable` with `check: "context-variable"`. The XSD declares
 * the element only inside a `qti-portable-custom-interaction`, and requires its `identifier`, whose
 * absence is the structural validator's `missing-attribute`.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param contexts The item's context declarations by identifier.
 * @returns The refusal at the element, or none when it names a context variable, when its
 *   `identifier` names nothing ({@link nameOf}), or when it is no `qti-context-variable`.
 */
const contextVariableReference = (
  source: SourceDocument,
  visit: Visit,
  contexts: ReadonlyMap<string, SourceElement>,
): readonly Refusal[] => {
  const name = Option.flatMap(attributeOf(visit.element, "identifier"), nameOf);
  if (!isQti(visit.element, (local) => local === "qti-context-variable") || Option.isNone(name)) {
    return [];
  }

  const identifier = name.value;

  return identifier === "QTI_CONTEXT" || contexts.has(identifier)
    ? []
    : [
        refusal(source, "undeclared-variable", visit.path, {
          check: "context-variable",
          element: visit.element.local,
          identifier,
          reading: "92",
        }),
      ];
};

/**
 * Apply R10-a ("A PCI names its module by `module`, by `qti-interaction-modules`, or by both") to a
 * Portable Custom Interaction: it carries a `module` attribute, holds a `qti-interaction-modules`
 * child, or both. The information model's `module` (§5.106.2, in 3.0.0 and 3.0.1): "If this
 * characteristic is provided the qti-interaction-modules child attribute is not required, if
 * omitted then the modules child element is mandatory" (`info.txt:37583`). The XSD makes both
 * optional, so the structural walk refuses neither, and a PCI with neither is `missing-attribute`
 * with `check: "pci-module-source"` here. Any written `module` counts, whatever its value: the
 * structural walk judges its value. Every version is judged alike, with no version seam.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @returns The refusal at the PCI, or none when it names its module by either form, or when it is
 *   no `qti-portable-custom-interaction`.
 */
export const pciModuleSource = (source: SourceDocument, visit: Visit): readonly Refusal[] => {
  if (!isQti(visit.element, (local) => local === "qti-portable-custom-interaction")) {
    return [];
  }

  const named =
    Option.isSome(attributeOf(visit.element, "module")) ||
    visit.element.children.some(
      (child) =>
        child.kind === "element" && isQti(child, (local) => local === "qti-interaction-modules"),
    );

  return named
    ? []
    : [
        refusal(source, "missing-attribute", visit.path, {
          attribute: "module",
          check: "pci-module-source",
          element: visit.element.local,
          source: "info.txt:37583",
        }),
      ];
};

/**
 * Type a name a test's processing reads with a `.` in it that the test does not declare whole: a
 * prefixed read (`ITEMREF.VAR`, `ITEMREF.N.VAR`, a part's or a section's `duration`; readings 4
 * and 37), which only the test's items can type.
 *
 * @param name The name, as its attribute gives it.
 * @returns Its type: `unknown` when the caller holds no items, which satisfies every rule.
 */
export type PrefixedTyper = (name: string) => ExpressionType;

/**
 * Give the base type an unweighted `qti-test-variables` with no `base-type` collects, from the
 * declarations of the variable it names in the test's items (G-R3 199): `integer` when every single
 * integer or float declaration of it is integer, or when there is none; `float` when one is a
 * float; `unknown` when a declaration it may match is not judged. Only the test's items can give
 * it, so a test checked alone, or a section on its own, holds none.
 *
 * @param variableIdentifier The `variable-identifier`.
 * @returns The base type.
 */
export type CollectedTyper = (variableIdentifier: string) => "float" | "integer" | "unknown";

/**
 * The document's declarations a rule resolves identifiers against, and each element's parent, as
 * the walk has met them. As a {@link VariableScope} it is the document's, with its built-ins: an
 * item's, or the processing scope of a test or a section ({@link processingRefusals}).
 */
interface Context extends VariableScope {
  readonly outcomes: ReadonlyMap<string, SourceElement>;
  /**
   * Each element the rules have judged so far, but the root, with its parent.
   */
  readonly parents: Map<SourceElement, SourceElement>;
  readonly responses: ReadonlyMap<string, SourceElement>;
  /**
   * The responses whose correct response the item's template processing sets, by identifier.
   */
  readonly setCorrectResponses: ReadonlySet<string>;
  /**
   * Type the template variable a `qti-template-default` sets, an item's, which only a package that
   * holds the test's items can find: none for every default of a test checked alone, and in an
   * item, which holds no default.
   */
  readonly templateDefaultType: (templateDefault: SourceElement) => Option.Option<ExpressionType>;
  /**
   * Type what an unweighted `qti-test-variables` with no `base-type` collects (G-R3 199): none in
   * an item, which holds no such expression, and in a test or a section checked without its items;
   * the items' declarations in a test a package holds, or a section a test reaches.
   */
  readonly typeCollected: Option.Option<CollectedTyper>;
  /**
   * Type a name that no declaration and no built-in answers: none for every name in an item, whose
   * reading of such a name is `undeclared-variable`; a prefixed read's type in a test; `unknown`
   * for every name in a section, which resolves its names in each test that holds it (reading 5).
   */
  readonly typeUnanswered: (identifier: string) => Option.Option<ExpressionType>;
  /**
   * Each expression typed so far, with its type ({@link expressionType}), so an expression's type
   * is worked out once however many of its ancestors judge their operands.
   */
  readonly types: Map<SourceElement, Option.Option<ExpressionType>>;
  /**
   * Every declaration a `qti-variable` may read: response, outcome, template and context
   * declarations alike.
   */
  readonly variables: ReadonlyMap<string, SourceElement>;
}

/**
 * A declaration a response-processing template or a `qti-map-response` needs: its kind and
 * identifier, and the base type and the child element it must have, where it must.
 */
interface Needed {
  readonly baseType: Option.Option<BaseType>;
  readonly child: Option.Option<string>;
  readonly declaration: "qti-outcome-declaration" | "qti-response-declaration";
  readonly identifier: string;
}

/**
 * The `SCORE` every standard template sets, which must be a float (research `ea422814` §5.1, from
 * the information model's response-processing templates).
 */
const floatScore: Needed = {
  baseType: Option.some("float"),
  child: Option.none(),
  declaration: "qti-outcome-declaration",
  identifier: "SCORE",
};

/**
 * Name the `RESPONSE` a standard template reads, which must hold a child element.
 *
 * @param child The child's local name.
 * @param baseType The base type it must have, none when any will do.
 * @returns What the template needs of `RESPONSE`.
 */
const responseHolding = (child: string, baseType: Option.Option<BaseType>): Needed => ({
  baseType,
  child: Option.some(child),
  declaration: "qti-response-declaration",
  identifier: "RESPONSE",
});

/**
 * What each standard template needs declared (research `ea422814` §5.1): a `RESPONSE` and a float
 * `SCORE`, where `match_correct`'s `RESPONSE` has a correct response, `map_response`'s a
 * `qti-mapping`, and `map_response_point`'s is a `point` with a `qti-area-mapping`.
 *
 * A `qti-correct-response` child is the one need template processing can meet instead: it may set
 * the correct response, but not a mapping or an area mapping ({@link templateRequirements}).
 *
 * The `CC2_*` templates need nothing here: `template-requirements` judges the three canonical
 * templates only (Q6), so a `CC2_*` template is never refused by it. What any built-in template's
 * tree needs beyond this table and the item does not provide, a canonical template's or a `CC2_*`
 * one's, such as a variable, a `qti-mapping`, or a `SCORE` of the cardinality as well as the base
 * type a rule sets, the item model marks instead, and that processing does not run (`runnable` in
 * `#plate/model/item.ts`).
 */
const templateNeeds = {
  CC2_map_response: [],
  CC2_match: [],
  CC2_match_basic: [],
  map_response: [responseHolding("qti-mapping", Option.none()), floatScore],
  map_response_point: [responseHolding("qti-area-mapping", Option.some("point")), floatScore],
  match_correct: [responseHolding("qti-correct-response", Option.none()), floatScore],
} as const satisfies Record<TemplateName, readonly Needed[]>;

/**
 * Report whether a declaration meets what a template or an expression needs of it.
 *
 * Its `base-type` is compared as written, as the binding rule and the item model compare it: a
 * value outside the vocabulary is the structural validator's refusal.
 *
 * @param declaration The declaration found under the needed identifier.
 * @param needed What is needed of it.
 * @returns Whether it has the needed base type and child, where they are needed.
 */
const provides = (declaration: SourceElement, needed: Needed): boolean =>
  Option.match(needed.baseType, {
    onNone: () => true,
    onSome: (baseType) =>
      Option.exists(
        attributeOf(declaration, "base-type"),
        (attribute) => attribute.value === baseType,
      ),
  }) &&
  Option.match(needed.child, {
    onNone: () => true,
    onSome: (child) =>
      declaration.children.some(
        (element) => element.kind === "element" && isQti(element, (local) => local === child),
      ),
  });

/**
 * Construct the detail of a `template-requirements` refusal: the element that needs the
 * declaration, and what it needs.
 *
 * @param element The local name of the element that needs it.
 * @param needed What it needs.
 * @returns The detail, with `baseType` and `child` only where they are needed.
 */
const neededDetail = (element: string, needed: Needed) => ({
  ...Option.match(needed.baseType, { onNone: () => ({}), onSome: (baseType) => ({ baseType }) }),
  ...Option.match(needed.child, { onNone: () => ({}), onSome: (child) => ({ child }) }),
  declaration: needed.declaration,
  element,
  identifier: needed.identifier,
});

/**
 * Apply `template-requirements` to a `qti-response-processing` that names a standard template.
 *
 * Research `ea422814` §5.1: each standard template needs a declared `RESPONSE`, with a correct
 * response for `match_correct`, a `qti-mapping` for `map_response`, and a `point` base type and a
 * `qti-area-mapping` for `map_response_point`, and a declared float `SCORE`. The template is
 * resolved by the vocabulary's `templateName` from its `template` as written, as the item model
 * resolves it; a `CC2_*` template needs nothing (Q6), and any other template is not judged. What a
 * built-in template's tree needs beyond {@link templateNeeds}, the item model marks. "If both
 * embedded rules and a template reference are supplied then the internal rules take precedence"
 * (the information model), so a template beside inline rules never runs and is not judged either;
 * the inline rules are.
 *
 * The correct response `match_correct` needs may also be set by template processing: "The response
 * variable to have its correct value set" is a template rule, `qti-set-correct-response` (the
 * information model, `info-compact.txt:11917`). The engine does not run template processing, and
 * the item model then runs no response processing, but the item is valid, so it is not refused
 * (reading 1). So a `RESPONSE` with no `qti-correct-response` child meets the need when
 * {@link setCorrectResponses} finds one set. No template rule sets a mapping or an area mapping,
 * so those needs are met only by the declaration's child.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The item's declarations, and the responses whose correct response template
 *   processing sets.
 * @returns One refusal at the processing element's path per declaration the template needs and
 *   lacks; none for any other element.
 */
const templateRequirements = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const template = Option.flatMap(attributeOf(visit.element, "template"), (attribute) =>
    templateName(attribute.value),
  );
  const inline = visit.element.children.some((child) => child.kind === "element");
  if (
    !isQti(visit.element, (local) => local === "qti-response-processing") ||
    Option.isNone(template) ||
    inline
  ) {
    return [];
  }

  return templateNeeds[template.value].flatMap((needed) => {
    const declarations =
      needed.declaration === "qti-response-declaration" ? context.responses : context.outcomes;
    const declaration = declarations.get(needed.identifier);
    const setByTemplate =
      Option.exists(needed.child, (child) => child === "qti-correct-response") &&
      context.setCorrectResponses.has(needed.identifier);
    const remaining: Needed = setByTemplate ? { ...needed, child: Option.none() } : needed;

    return declaration !== undefined && provides(declaration, remaining)
      ? []
      : [
          refusal(source, "template-requirements", visit.path, {
            ...neededDetail(visit.element.local, needed),
            template: template.value,
          }),
        ];
  });
};

/**
 * Climb from an element through its ancestors, each passing its step's test in turn.
 *
 * @param parents Each element's parent, as the walk has met them.
 * @param element The element to climb from.
 * @param steps One test per ancestor, the parent's first.
 * @returns The last ancestor climbed to, or none when an ancestor is missing or fails its test.
 */
const enclosing = (
  parents: ReadonlyMap<SourceElement, SourceElement>,
  element: SourceElement,
  steps: readonly ((ancestor: SourceElement) => boolean)[],
): Option.Option<SourceElement> => {
  let reached = element;
  for (const step of steps) {
    const ancestor = parents.get(reached);
    if (ancestor === undefined || !step(ancestor)) {
      return Option.none();
    }

    reached = ancestor;
  }

  return Option.some(reached);
};

/**
 * The processing an element of the rules belongs to, as the qti package names its languages
 * (`languages` in `packages/pantry/src/grammar/expression.ts`, held by the relation `Processing` in
 * `packages/pantry/src/qti/expressions.ts`): an item's response processing or template processing,
 * a test's outcome processing, or the expression a test or a section holds in a
 * `qti-pre-condition`, a `qti-branch-rule` or a `qti-template-default`. A template default is an
 * expression, never template processing: it may read an outcome, a built-in and an item's variable
 * (9.24), so the template read rule ({@link templateReads}, P26) never judges it.
 */
type Processing = "expression" | "outcome" | "response" | "template";

/**
 * The element that holds each processing, by its local name: the qti package judges all four test
 * contexts (`languages` and `processingRoots` in `packages/pantry/src/grammar/expression.ts`;
 * `processingRowsOf` in `packages/pantry/src/import/overlays/expressions.ts`).
 */
const processings: ReadonlyMap<string, Processing> = new Map<string, Processing>([
  ["qti-branch-rule", "expression"],
  ["qti-outcome-processing", "outcome"],
  ["qti-pre-condition", "expression"],
  ["qti-response-processing", "response"],
  ["qti-template-default", "expression"],
  ["qti-template-processing", "template"],
]);

/**
 * Give the processing an element lies in: the nearest of its ancestors that holds one
 * ({@link processings}).
 *
 * @param context The parents the walk has met.
 * @param element The element.
 * @returns The processing, none for an element in neither.
 */
const processingOf = (context: Context, element: SourceElement): Option.Option<Processing> => {
  for (
    let ancestor = context.parents.get(element);
    ancestor !== undefined;
    ancestor = context.parents.get(ancestor)
  ) {
    const processing = qtiEntry(processings, ancestor);
    if (Option.isSome(processing)) {
      return processing;
    }
  }

  return Option.none();
};

/**
 * Report whether an element lies anywhere under an element that holds a processing
 * ({@link processings}), the processing the type and reference rules judge. The qti package judges
 * them alike (the expression laws of `packages/pantry/src/qti/expressions.ts`).
 *
 * @param context The parents the walk has met.
 * @param element The element.
 * @returns Whether one of its ancestors holds a processing.
 */
const inProcessing = (context: Context, element: SourceElement): boolean =>
  Option.isSome(processingOf(context, element));

/**
 * Report whether an element lies anywhere under the element that holds one processing
 * ({@link processings}).
 *
 * @param context The parents the walk has met.
 * @param element The element.
 * @param processing The processing.
 * @returns Whether its nearest processing is that one.
 */
const liesIn = (context: Context, element: SourceElement, processing: Processing): boolean =>
  Option.exists(processingOf(context, element), (nearest) => nearest === processing);

/**
 * What each inline mapping expression needs of the response it names.
 *
 * `qti-map-response` needs a `qti-mapping`, "the associated mapping, which must have been
 * declared" (the information model, `info-compact.txt:11438`). `qti-map-response-point` "looks up
 * the value of a response variable that must be of base-type point, and transforms it using the
 * associated areaMapping" (`info-compact.txt:11437`), so it needs a `point` response holding a
 * `qti-area-mapping`. The `identifier` here is a placeholder: each expression's own replaces it.
 */
const mappingNeeds = {
  "qti-map-response": responseHolding("qti-mapping", Option.none()),
  "qti-map-response-point": responseHolding("qti-area-mapping", Option.some("point")),
} as const satisfies Record<string, Needed>;

/**
 * The local name of an inline mapping expression.
 */
type MappingExpression = keyof typeof mappingNeeds;

/**
 * Read an element's local name as an inline mapping expression's.
 *
 * @param element The element's local name.
 * @returns The mapping expression, none for any other element.
 */
const mappingExpressionOf = (element: string): Option.Option<MappingExpression> =>
  Arr.findFirst(
    Object.keys(mappingNeeds),
    (local): local is MappingExpression => local === element,
  );

/**
 * Judge the response declaration a `qti-map-response` or a `qti-map-response-point` names against
 * what {@link mappingNeeds} lists for that expression: the detail of the `template-requirements`
 * refusal it earns when the declaration lacks it. An item's inline expression is judged so
 * ({@link mapResponseRequirements}), and so is a test's that names a response through an item ref
 * (`#plate/package/open.ts`).
 *
 * @param element The expression's local name.
 * @param identifier The name the expression gives the response, which the detail repeats.
 * @param declaration The response's declaration.
 * @returns The refusal's detail; none when the declaration provides what the expression needs, or
 *   the element is neither expression.
 */
export const mappingRequirement = (
  element: string,
  identifier: string,
  declaration: SourceElement,
): Option.Option<Readonly<Record<string, string>>> =>
  Option.flatMap(mappingExpressionOf(element), (expression) => {
    const needed: Needed = { ...mappingNeeds[expression], identifier };

    return provides(declaration, needed)
      ? Option.none()
      : Option.some(neededDetail(expression, needed));
  });

/**
 * Give the detail of the `template-requirements` refusal a `qti-map-response` or a
 * `qti-map-response-point` earns when it names a response with none of what {@link mappingNeeds}
 * lists for it, a built-in response among them ({@link mapResponseRequirements}).
 *
 * @param element The expression's local name.
 * @param identifier The name the expression gives the response, which the detail repeats.
 * @returns The refusal's detail; none when the element is neither expression.
 */
const mappingNeedOf = (
  element: string,
  identifier: string,
): Option.Option<Readonly<Record<string, string>>> =>
  Option.map(mappingExpressionOf(element), (expression) =>
    neededDetail(expression, { ...mappingNeeds[expression], identifier }),
  );

/**
 * Apply `template-requirements` to an inline `qti-map-response` or `qti-map-response-point`: the
 * response it names is declared with what {@link mappingNeeds} lists for it
 * ({@link mappingRequirement}). The qti package refuses both as P27 (the `Mapped response` law
 * in `packages/pantry/src/qti/expressions.ts`).
 *
 * An expression that names no response declaration is not judged here: an undeclared variable is
 * its own refusal, and this rule refuses a declared response that lacks what it needs. A built-in
 * response is one such an expression may name (reading 111, "a processing element's `identifier`
 * names a variable of the kind the element reads or sets"): an item's `numAttempts` or `duration`,
 * and a test's `duration`, with the `numAttempts` plate keeps for a test that declares none
 * ({@link testProcessingBuiltIns}, as ruled, B4). No declaration may take its name, so it has no
 * mapping or area mapping: it is refused here, with the detail a declared response that lacks both
 * would get. Reading 166 says so: "An unprefixed `qti-map-response` or `qti-map-response-point`
 * that names a built-in response variable, an item's `numAttempts` or `duration` or a test's
 * `duration`, is refused under 'Mapped response' too: a built-in has no declaration, so no mapping
 * or area mapping has been declared". The qti package refuses the same by its `Mapped response`
 * law, which a built-in breaks for want of the table. A name a test declares is no built-in there
 * (reading 168, "A test may declare a variable named `numAttempts` or `completionStatus`";
 * {@link testProcessingScope}), so a mapping expression of a declared outcome `numAttempts` keeps
 * {@link undeclaredVariable}'s refusal, never this one.
 *
 * In an item only response processing is judged. Template processing is not: every response this
 * rule could judge there is a read template processing may not make, {@link templateReads}'
 * refusal (P26) alone, so it is refused once. The qti package states the two as separate laws,
 * `Template reads` (P26) and `Mapped response` (P27), and names a refusal by its most specific law
 * in one fixed order (`precedence` in `packages/pantry/src/vocab/laws.ts`). In a test, and in a
 * section document under a test that reaches it ({@link processingRefusals}), every processing is
 * judged: outcome processing, a pre-condition, a branch rule and a template default, the four
 * contexts the qti package judges. A section document on its own holds no built-in, so nothing is
 * refused there.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations, its built-ins and the parents the walk has met.
 * @returns The refusal at the expression's path when its response lacks what it needs; none for any
 *   other element, and for one outside the processing judged: an item's response processing, or
 *   any processing of a test or a section.
 */
const mapResponseRequirements = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const name = Option.flatMap(attributeOf(visit.element, "identifier"), nameOf);
  const judged =
    context.declarer === "test"
      ? inProcessing(context, visit.element)
      : liesIn(context, visit.element, "response");
  if (visit.element.namespace !== qtiNamespace || Option.isNone(name) || !judged) {
    return [];
  }

  const identifier = name.value;
  const declaration = context.responses.get(identifier);
  const detail =
    declaration === undefined
      ? Option.filter(mappingNeedOf(visit.element.local, identifier), () =>
          Option.exists(
            Option.fromUndefinedOr(context.builtIns.get(identifier)),
            (builtIn) => builtIn.kind === "response",
          ),
        )
      : mappingRequirement(visit.element.local, identifier, declaration);

  return Option.toArray(
    detail.pipe(Option.map((facts) => refusal(source, "template-requirements", visit.path, facts))),
  );
};

/**
 * Give an element's `base-type` when the value model holds values of it.
 *
 * A base type the value model does not hold (`file`) has no lexical check here (the slice list's
 * 0.11 item 3), so its values are not judged. A `point` is held, so a value that is not two
 * integers is refused, as the qti package refuses it (`pointValuePattern` in
 * `packages/pantry/src/qti/expression-types.ts`, read by the `Typed value` law in
 * `packages/pantry/src/qti/declarations.ts`, rule `typed-copy`, and by the `Literal lexical` law in
 * `packages/pantry/src/qti/expressions.ts`, rule `attribute-lexical`). A missing or
 * out-of-vocabulary `base-type` is the structural validator's.
 *
 * @param element An element with a `base-type`, such as a declaration or a `qti-base-value`.
 * @returns Its base type, none when it is absent or not modelled.
 */
const modelledBaseType = (element: SourceElement): Option.Option<ModelledBaseType> =>
  Option.flatMap(attributeOf(element, "base-type"), (attribute) =>
    isModelled(attribute.value) ? Option.some(attribute.value) : Option.none(),
  );

/**
 * Report whether a declaration is a record: its `cardinality` is `record`.
 *
 * @param declaration The declaration.
 * @returns Whether it declares a record.
 */
const isRecordDeclaration = (declaration: SourceElement): boolean =>
  Option.exists(
    attributeOf(declaration, "cardinality"),
    (attribute) => attribute.value === "record",
  );

/**
 * Give the base type a declaration's typed values take, when this rule judges them.
 *
 * A `record` declaration's values are typed field by field, each by its own `base-type`
 * ({@link textBaseType}), so a `base-type` the record declaration itself carries types none of
 * them and is accepted unread (G-R4, pending). Values of a base type {@link modelledBaseType} does
 * not give are not judged either.
 *
 * @param declaration The declaration.
 * @returns Its base type, none when its values are not judged under it.
 */
const declaredBaseType = (declaration: SourceElement): Option.Option<ModelledBaseType> =>
  isRecordDeclaration(declaration) ? Option.none() : modelledBaseType(declaration);

/**
 * Join an element's text children, the content of a `qti-value` or a `qti-base-value`, as the item
 * model joins them.
 *
 * @param element The element.
 * @returns Its text, as written.
 */
const textOf = (element: SourceElement): string =>
  element.children.flatMap((child) => (child.kind === "text" ? [child.text] : [])).join("");

/**
 * Construct the `value-type` refusals of a parse.
 *
 * @param source The document.
 * @param path The path of the element or attribute holding the value.
 * @param parsed The parse of its value.
 * @returns One refusal naming the base type and the text read, or none when the value parses.
 */
const valueRefusals = <A>(
  source: SourceDocument,
  path: string,
  parsed: Result.Result<A, InvalidValue>,
): readonly Refusal[] =>
  Option.toArray(
    Option.map(Result.getFailure(parsed), (failure) =>
      refusal(source, "value-type", path, {
        baseType: failure.baseType,
        lexical: failure.lexical,
      }),
    ),
  );

/**
 * Make a test of an element's QTI local name.
 *
 * @param names The local names that pass.
 * @returns The test.
 */
const named =
  (...names: readonly string[]) =>
  (element: SourceElement): boolean =>
    isQti(element, (local) => names.includes(local));

/**
 * The base-typed attributes reading 7 lists whose XSD type is a string, each with its element and
 * the ancestors that lead to the declaration that types it. The float attributes reading 7 also
 * lists (`mapped-value`, the mappings' bounds and `default-value`, an interpolation entry's
 * `source-value`) are XSD doubles, which the structural validator's `attribute-type` checks.
 */
const typedAttributes = [
  // Reading 7: "`map-key` of a map entry", under its response declaration's base type.
  {
    attribute: "map-key",
    element: "qti-map-entry",
    steps: [named("qti-mapping"), named("qti-response-declaration")],
  },
  // Reading 7: "a match table's and an interpolation table's `default-value`", under the outcome's.
  {
    attribute: "default-value",
    element: "qti-match-table",
    steps: [named("qti-outcome-declaration")],
  },
  {
    attribute: "default-value",
    element: "qti-interpolation-table",
    steps: [named("qti-outcome-declaration")],
  },
  // Reading 7: "their entries' `target-value`"; reading 8: a match table entry's `target-value` is a
  // value of the outcome's base type, not a base-type name.
  {
    attribute: "target-value",
    element: "qti-match-table-entry",
    steps: [named("qti-match-table"), named("qti-outcome-declaration")],
  },
  {
    attribute: "target-value",
    element: "qti-interpolation-table-entry",
    steps: [named("qti-interpolation-table"), named("qti-outcome-declaration")],
  },
] as const;

/**
 * Apply `value-type` to the base-typed attributes of one element.
 *
 * Reading 7: such an attribute's value is exact, and outer whitespace around a typed value makes it
 * invalid. That padding is the structural validator's `padded-attribute`, so for a base type other
 * than `string` the value is read here with its outer whitespace removed, and a padded value gives
 * one refusal, not two. For `string` the whitespace is part of the value and is kept.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @returns The refusal at each attribute's path whose value is outside its base type.
 */
const attributeValueType = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] =>
  typedAttributes.flatMap((typed) => {
    if (!isQti(visit.element, (local) => local === typed.element)) {
      return [];
    }

    const attribute = attributeOf(visit.element, typed.attribute);
    const baseType = Option.flatMap(
      enclosing(context.parents, visit.element, typed.steps),
      declaredBaseType,
    );
    if (Option.isNone(attribute) || Option.isNone(baseType)) {
      return [];
    }

    const written = attribute.value.value;
    const lexical = baseType.value === "string" ? written : trimXmlSpace(written);

    return valueRefusals(
      source,
      attributePath(visit.path, attribute.value),
      parseLexical(baseType.value, lexical),
    );
  });

/**
 * The steps from a `qti-value` up to the declaration whose `qti-correct-response` or
 * `qti-default-value` holds it.
 */
const valueToDeclaration = [named("qti-correct-response", "qti-default-value"), isDeclaration];

/**
 * Report whether an element is a field of a record declaration's value: a `qti-value` in the
 * `qti-correct-response` or the `qti-default-value` of a declaration whose `cardinality` is
 * `record`, any of an item's four kinds or a test's outcome or context declaration.
 *
 * @param visit The element's visit.
 * @param parents Each element's parent, as the walk has met them.
 * @returns Whether it is such a field.
 */
const isRecordField = (visit: Visit, parents: ReadonlyMap<SourceElement, SourceElement>): boolean =>
  isQti(visit.element, (local) => local === "qti-value") &&
  Option.exists(enclosing(parents, visit.element, valueToDeclaration), isRecordDeclaration);

/**
 * Give the base type an element's text is read in, when its text is a typed value this rule
 * judges: a `qti-base-value`'s own `base-type`; for a `qti-value` in a declaration's
 * `qti-correct-response` or `qti-default-value`, the declaration's, or, when the declaration is a
 * record, the field's own `base-type` ({@link isRecordField}).
 *
 * A declaration's values are typed only where its `cardinality` spells one (reading 158, "each law
 * over it judges what it does spell", E40a): the law over a typed value reads the cardinality and
 * the base type both, so a value of a declaration whose `cardinality` is unwritten or spells
 * nothing is not judged, and the structural validator refuses the cardinality alone.
 *
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @returns The base type, none for any other element and for a value this rule does not judge.
 */
const textBaseType = (visit: Visit, context: Context): Option.Option<ModelledBaseType> => {
  if (isQti(visit.element, (local) => local === "qti-base-value")) {
    return modelledBaseType(visit.element);
  }

  if (!isQti(visit.element, (local) => local === "qti-value")) {
    return Option.none();
  }

  return Option.flatMap(
    Option.filter(enclosing(context.parents, visit.element, valueToDeclaration), (declaration) =>
      Option.isSome(cardinalityOf(declaration)),
    ),
    (declaration) =>
      modelledBaseType(isRecordDeclaration(declaration) ? visit.element : declaration),
  );
};

/**
 * Apply `value-type` to an element's text under a base type, read as the value model's
 * `parseElementText` reads element text (reading 7's trim).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param baseType The base type its text is read in, none when it is not judged.
 * @returns The refusal at the element's path when its text is outside the base type; none when it
 *   parses or no base type is given.
 */
const textUnder = (
  source: SourceDocument,
  visit: Visit,
  baseType: Option.Option<ModelledBaseType>,
): readonly Refusal[] =>
  Option.match(baseType, {
    onNone: () => [],
    onSome: (type) =>
      valueRefusals(source, visit.path, parseElementText(type, textOf(visit.element))),
  });

/**
 * Apply `value-type` to an element whose text is a typed value.
 *
 * Reading 1 and the value model's lexical spaces (research `ea422814` §3): a `qti-value` in a
 * declaration's `qti-correct-response` or `qti-default-value` parses under the declaration's base
 * type, a field of a record declaration's value under its own `base-type` (as pantry's import reads
 * it, the `Typed value` law in `packages/pantry/src/qti/declarations.ts`), and a `qti-base-value`
 * under its own `base-type`, after reading 7's trim of element text, which the value model's
 * `parseElementText` applies. A boolean is `true` or `false`, never `1` or `0` (reading 34). The
 * XSD does not decide, typing `qti-value` as `xs:normalizedString` and `qti-base-value` as
 * `xs:string`; the information model's boolean base type is the boolean primitive's set
 * (`info.txt:72950`), "with permitted values of "true" and "false"" (`info.txt:74908`). XML
 * Schema's `1` and `0` belong only to the attributes the XSD types `xs:boolean`.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @returns The refusal at the element's path when its text is outside its base type; none for any
 *   other element and for a value whose base type is not judged.
 */
const textValueType = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => textUnder(source, visit, textBaseType(visit, context));

/**
 * The attributes each field of a record declaration's value carries.
 */
const fieldAttributes = ["field-identifier", "base-type"] as const;

/**
 * Construct the `missing-attribute` refusals of a field of a record declaration's value, one at
 * each of {@link fieldAttributes} it does not carry.
 *
 * @param source The document.
 * @param visit The field's visit.
 * @returns One refusal at each missing attribute's path, `field-identifier`'s first.
 */
const missingFieldAttributes = (source: SourceDocument, visit: Visit): readonly Refusal[] =>
  fieldAttributes.flatMap((attribute) =>
    Option.isSome(attributeOf(visit.element, attribute))
      ? []
      : [
          refusal(
            source,
            "missing-attribute",
            attributePath(visit.path, { local: attribute, namespace: "" }),
            { attribute, element: "qti-value", source: "info.txt:73046" },
          ),
        ],
  );

/**
 * Apply `missing-attribute` to a field of a record declaration's value: a `qti-value` in the
 * `qti-correct-response` or `qti-default-value` of a declaration whose `cardinality` is `record`
 * ({@link isRecordField}) carries both `field-identifier` and `base-type`.
 *
 * The XSD makes both optional on every `qti-value`; the information model requires them of a
 * record's: a record "contains a set of independent values each identified by its own identifier
 * and having its own base-type" (`info.txt:73046`). The qti package refuses the same document: its
 * `Value cardinality` law (`packages/pantry/src/qti/declarations.ts`, rule `value-cardinality`)
 * holds a record's field to both a `field-identifier` and a `base-type`. A field whose text is
 * outside its own `base-type` is `value-type`'s ({@link textValueType}).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @returns One refusal at each missing attribute's path, `field-identifier`'s first; none for any
 *   other element.
 */
const recordFieldAttributes = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] =>
  isRecordField(visit, context.parents) ? missingFieldAttributes(source, visit) : [];

/**
 * Apply an item's rules for a field of a record declaration's value to one visit of a test or a
 * section document: `missing-attribute` for each of `field-identifier` and `base-type` the field
 * lacks ({@link recordFieldAttributes}), then `value-type` when its text is outside its own
 * `base-type` ({@link textValueType}'s record branch), with the paths and details an item's field
 * gets. `checkTestRules` calls it once per judged visit.
 *
 * A test's record declarations take their fields as an item's do. The information model requires
 * both attributes of every record's field (`info.txt:73046`), and the qti package builds a test's
 * declarations as an item's (`rowsOf` in `packages/pantry/src/import/overlays/declarations.ts`, run
 * for every document), so its `Value cardinality` law (`packages/pantry/src/qti/declarations.ts`)
 * refuses a test's field with no `base-type` or no `field-identifier` too. The rest of a test's
 * record declaration is the test model's, which marks it `cardinality="record"`.
 *
 * @param source The test or section document.
 * @param visit The element's visit.
 * @param parents Each element of the document with its parent.
 * @returns The refusals, `missing-attribute`'s first; none for an element that is not a field of a
 *   record declaration's value.
 */
export const recordFieldRefusals = (
  source: SourceDocument,
  visit: Visit,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): readonly Refusal[] =>
  isRecordField(visit, parents)
    ? [
        ...missingFieldAttributes(source, visit),
        ...textUnder(source, visit, modelledBaseType(visit.element)),
      ]
    : [];

/**
 * What one item has written so far in each holder whose values may not repeat, a mapping or a
 * record value, by holder: each record value's field identifiers, each mapping's keys as written,
 * and each mapping's keys as values of its declaration's base type ({@link mapKeyValue}).
 */
interface Written {
  readonly fields: Map<SourceElement, Set<string>>;
  readonly keyValues: Map<SourceElement, Set<string>>;
  readonly keys: Map<SourceElement, Set<string>>;
}

/**
 * Record a value a holder writes, and report whether the holder wrote it before.
 *
 * @param written What each holder has written so far, which this adds the value to.
 * @param holder The mapping or record value that writes it.
 * @param value The value, as the comparison reads it.
 * @returns Whether an earlier entry of the same holder wrote the same value.
 */
const writtenBefore = (
  written: Map<SourceElement, Set<string>>,
  holder: SourceElement,
  value: string,
): boolean => {
  const values = written.get(holder);
  if (values === undefined) {
    written.set(holder, new Set([value]));

    return false;
  }

  if (values.has(value)) {
    return true;
  }

  values.add(value);

  return false;
};

/**
 * Give a single value as one text that two singles share exactly when they are one value, as a
 * mapping's keys compare (reading 98): a pair's identifiers in an order of their own, since a pair
 * is undirected, and every other value in its base type's lexical form ({@link format}), which
 * writes an integer and a point's coordinates without signs or leading zeros a value does not
 * need.
 *
 * @param single The value.
 * @returns The text.
 */
const singleKey = (single: Single): string => {
  if (single.baseType !== "pair") {
    return format(single);
  }

  const [source, destination] = single.value;

  return source <= destination ? `${source} ${destination}` : `${destination} ${source}`;
};

/**
 * Read a map key as the value it names under its declaration's base type, as one text two keys
 * share exactly when they repeat (reading 98): an integer by its value at any length (`1`, `01`
 * and `+1`), a point as its integer tuple, a pair unordered and a directed pair in order, and a
 * boolean, a string, an identifier and a URI as written. A float, and a duration, which the value
 * model reads as a float, is the double reading 144 reads it as (reading 154): `1e400`, `2e400`
 * and `INF` repeat, as do `0` and `-0`, and two `NaN`s.
 *
 * @param baseType The declaration's base type.
 * @param lexical The key, without its outer whitespace unless the base type is `string`.
 * @returns The text, none when the key is outside the base type's lexical space, which
 *   {@link attributeValueType} refuses.
 */
const mapKeyValue = (baseType: ModelledBaseType, lexical: string): Option.Option<string> =>
  baseType === "float" || baseType === "duration"
    ? Option.map(readIeeeDouble(lexical), (double) =>
        Number.isNaN(double) ? "NaN" : String(double),
      )
    : Option.map(Result.getSuccess(parseLexical(baseType, lexical)), singleKey);

/**
 * The steps from a `qti-map-entry` up to the response declaration whose mapping holds it.
 */
const mapEntryToDeclaration = [named("qti-mapping"), named("qti-response-declaration")];

/**
 * Apply `duplicate-identifier` with `check: "map-key"` to a map entry whose `map-key` an earlier
 * entry of its mapping wrote (reading 98, B5b): "The map is defined by a set of mapEntries, each
 * of which maps a single value from the source set onto a single float" (section 5.88.4), so two
 * entries of one key map one value twice.
 *
 * The keys compare twice (reading 160). As values of the declaration's base type
 * ({@link mapKeyValue}), where its `base-type` spells one the value model holds and it is no record
 * ({@link declaredBaseType}): `1` and `01` repeat in an integer mapping, and that refusal names the
 * base type and cites reading 154 for a float, reading 98 otherwise. And as written, in every
 * mapping, whatever its declaration's `cardinality` or `base-type` spells (reading 158): a key that
 * repeats only so, such as `a` twice under `base-type=" string "`, is refused with an empty
 * `baseType`, citing reading 160, while `1` and `01` under `" integer "` are two keys. A string
 * compares by its code points, whatever an entry's `case-sensitive` says, so `York` and `york` are
 * two keys (reading 165, "Two string map keys that differ only by case are two keys, and a
 * response that matches several entries takes the first one listed", which narrows reading 98's
 * string clause). A key outside its base type's lexical space has no value to compare, and is
 * {@link attributeValueType}'s refusal.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @param written The keys each mapping has written so far, which this adds the entry's to.
 * @returns The refusal at the repeating entry's path; none for its mapping's first entry of that
 *   key and for any other element.
 */
const repeatedMapKey = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
  written: Written,
): readonly Refusal[] => {
  const key = attributeOf(visit.element, "map-key");
  const mapping = context.parents.get(visit.element);
  if (
    !isQti(visit.element, (local) => local === "qti-map-entry") ||
    Option.isNone(key) ||
    mapping === undefined ||
    !named("qti-mapping")(mapping)
  ) {
    return [];
  }

  const lexical = key.value.value;
  const baseType = Option.flatMap(
    enclosing(context.parents, visit.element, mapEntryToDeclaration),
    declaredBaseType,
  );
  const value = baseType.pipe(
    Option.flatMap((type) =>
      mapKeyValue(type, type === "string" ? lexical : trimXmlSpace(lexical)),
    ),
  );
  const repeatsValue = Option.exists(value, (text) =>
    writtenBefore(written.keyValues, mapping, text),
  );
  const repeatsText = writtenBefore(written.keys, mapping, lexical);
  if (repeatsValue && Option.isSome(baseType)) {
    return [
      refusal(source, "duplicate-identifier", visit.path, {
        baseType: baseType.value,
        check: "map-key",
        key: lexical,
        reading: baseType.value === "float" ? "154" : "98",
      }),
    ];
  }

  return repeatsText
    ? [
        refusal(source, "duplicate-identifier", visit.path, {
          baseType: "",
          check: "map-key",
          key: lexical,
          reading: "160",
        }),
      ]
    : [];
};

/**
 * Apply `duplicate-identifier` with `check: "field"` to a field of a record declaration's value
 * ({@link isRecordField}) whose `field-identifier` an earlier field of the same value wrote (B7): a
 * record "contains a set of independent values each identified by its own identifier"
 * (`info.txt:73046`), and reading 158 counts the law over a record's field keys among those that
 * read neither the declaration's `cardinality` nor its `base-type`. A `qti-correct-response` and a
 * `qti-default-value` are two values, each with its own fields. A `field-identifier` that is no
 * NCName names nothing ({@link nameOf}) and is not compared. A test's record declarations take
 * their fields as an item's do, so `checkTestRules` in `#plate/validate/test-rules.ts` applies it
 * to a test's too.
 *
 * @param source The item, test or section document.
 * @param visit The element's visit.
 * @param parents Each element's parent, as the walk has met them.
 * @param fields The field identifiers each record value has written so far, which this adds the
 *   field's to.
 * @returns The refusal at the repeating field's path; none for its value's first field of that
 *   identifier and for any other element.
 */
export const repeatedField = (
  source: SourceDocument,
  visit: Visit,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  fields: Map<SourceElement, Set<string>>,
): readonly Refusal[] => {
  const value = parents.get(visit.element);
  const name = Option.flatMap(attributeOf(visit.element, "field-identifier"), nameOf);
  if (!isRecordField(visit, parents) || value === undefined || Option.isNone(name)) {
    return [];
  }

  return writtenBefore(fields, value, name.value)
    ? [
        refusal(source, "duplicate-identifier", visit.path, {
          check: "field",
          field: name.value,
          reading: "158",
        }),
      ]
    : [];
};

/**
 * The bounds an outcome declaration may write about its `mastery-value`, each with the detail fact
 * that names it and the test of a mastery value that breaks it.
 */
const masteryBounds = [
  {
    attribute: "normal-minimum",
    breaks: (mastery: number, bound: number) => mastery < bound,
    fact: "least",
  },
  {
    attribute: "normal-maximum",
    breaks: (mastery: number, bound: number) => mastery > bound,
    fact: "greatest",
  },
] as const;

/**
 * Apply `attribute-type` with `check: "mastery-range"` to an outcome declaration whose
 * `mastery-value` lies outside the bounds it writes (E42a): the Schematron's RULE SPECIFIC CLASS
 * OUTCOMEDEC 1 and 2, read by their intent (reading 9), hold a mastery value at least the
 * `normal-minimum` and at most the `normal-maximum`. One refusal for each bound broken, which a
 * declaration whose bounds cross can break both; the detail names it as written, `least` or
 * `greatest`.
 *
 * Each value is compared by its IEEE double (reading 144); one outside xs:double's lexical space
 * is the structural validator's to refuse, and is not compared. A bound the declaration does not
 * write is not judged here: a QTI 3.0.1 `normal-minimum` that is not written is 0.0 (reading 149),
 * which only the document's version decides, so `checkVersion` in `#plate/validate/versions.ts`
 * judges that floor. A test's outcome declarations carry the same attributes, so `checkTestRules`
 * in `#plate/validate/test-rules.ts` applies it to a test's too.
 *
 * @param source The item, test or section document.
 * @param visit The element's visit.
 * @returns The refusals at the `mastery-value` attribute's path, the minimum's first; none for any
 *   other element.
 */
export const masteryRange = (source: SourceDocument, visit: Visit): readonly Refusal[] => {
  const mastery = attributeOf(visit.element, "mastery-value");
  const value = mastery.pipe(
    Option.flatMap((attribute) => readIeeeDouble(trimXmlSpace(attribute.value))),
  );
  if (
    !isQti(visit.element, (local) => local === "qti-outcome-declaration") ||
    Option.isNone(mastery) ||
    Option.isNone(value)
  ) {
    return [];
  }

  return masteryBounds.flatMap(({ attribute, breaks, fact }) =>
    Option.toArray(
      Option.flatMap(attributeOf(visit.element, attribute), (bound) =>
        Option.map(
          Option.filter(readIeeeDouble(trimXmlSpace(bound.value)), (limit) =>
            breaks(value.value, limit),
          ),
          () =>
            refusal(source, "attribute-type", attributePath(visit.path, mastery.value), {
              attribute: mastery.value.local,
              check: "mastery-range",
              element: visit.element.local,
              [fact]: bound.value,
              reading: "9",
              value: mastery.value.value,
            }),
        ),
      ),
    ),
  );
};

/**
 * Apply `value-type` to a `qti-base-value` that lies in a processing ({@link processings}), as
 * {@link textValueType} judges it: its text parses under its own `base-type`. The qti package
 * refuses the same in every processing a document holds, a test's and a section's included (the
 * `Literal lexical` law in `packages/pantry/src/qti/expressions.ts`, rule `attribute-lexical`,
 * formerly P7). A declaration's values are left to the test model's builder, which refuses them
 * first.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The parents the walk has met.
 * @returns The refusal at the expression's path when its text is outside its base type; none for
 *   any other element and for one outside processing.
 */
const literalValueType = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] =>
  isQti(visit.element, (local) => local === "qti-base-value") &&
  inProcessing(context, visit.element)
    ? textValueType(source, visit, context)
    : [];

/**
 * The built-in variables an item's response processing may read, with their types.
 *
 * `numAttempts`, `duration` and `completionStatus` are the item's (reading 29: in an item
 * `duration` is a single float, seconds). `QTI_CONTEXT` is the built-in context variable, a record,
 * which has no base type of its own: "any references within an item or an assessment to the
 * QTI_CONTEXT variable [...] must succeed" (`info-compact.txt:8456`).
 *
 * `duration` is typed here in every item, and read whether the item is time dependent or not:
 * reading 150 ("an item's built-in `duration` may be read whether or not the item is time
 * dependent") finds no normative law that reads `time-dependent`.
 */
const builtIns: ReadonlyMap<string, ExpressionType> = new Map<string, ExpressionType>([
  ["completionStatus", singleOf("identifier")],
  ["duration", singleOf("float")],
  ["numAttempts", singleOf("integer")],
  ["QTI_CONTEXT", { baseType: "unknown", cardinality: "record" }],
]);

/**
 * The kind of each built-in variable, which is declared implicitly (`info.txt:8440`): "There are
 * two built-in response variables: 'numAttempts' and 'duration'" (`:8466`), "There is one built-in
 * outcome variable, 'completionStatus'" (`:8488`), and "There is one built-in context variable:
 * 'QTI_CONTEXT'" (`:8456`). Their types are {@link builtIns}'.
 */
const builtInKinds: ReadonlyMap<string, NamedKind> = new Map<string, NamedKind>([
  ["completionStatus", "outcome"],
  ["duration", "response"],
  ["numAttempts", "response"],
  ["QTI_CONTEXT", "context"],
]);

/**
 * The item's built-ins as a printed variable or a `template-identifier` names them: each of
 * {@link builtInKinds} with its type from {@link builtIns}.
 */
const itemBuiltIns: ReadonlyMap<string, NamedVariable> = new Map(
  [...builtInKinds].map(([identifier, kind]) => [
    identifier,
    { kind, type: Option.fromUndefinedOr(builtIns.get(identifier)) },
  ]),
);

/**
 * What a reference resolves a name against beside the declarations: the document's built-ins, the
 * typer of a name neither answers, and the kind of document that declares the variables, which a
 * refusal of a name nothing answers names ({@link declaredBy}), as a {@link Context} holds them.
 */
type Names = Pick<Context, "builtIns" | "declarer" | "typeUnanswered">;

/**
 * An item's {@link Names}: its built-ins, no type for a name nothing answers, which is
 * `undeclared-variable`, and the item as the declarer.
 */
const itemNames: Names = {
  builtIns: itemBuiltIns,
  declarer: "item",
  typeUnanswered: () => Option.none(),
};

/**
 * Add the `declarer` fact to the facts of an `undeclared-variable` refusal when the document is a
 * test, or a section document a test reaches, so the verdict's wording names the test, which
 * declares outcomes and context variables, and never asks it to declare a response or a template
 * variable. A printed variable's refusal, a processing expression's and a reference attribute's
 * carry it ({@link printedUndeclared}, {@link undeclaredVariable}, {@link referenceRefusals}); an
 * item's facts are left as they are.
 *
 * @param facts The refusal's facts.
 * @param declarer The kind of document whose declarations the name was looked up in.
 * @returns The facts, with `declarer: "test"` for a test.
 */
const declaredBy = (
  facts: Readonly<Record<string, string>>,
  declarer: VariableScope["declarer"],
): Readonly<Record<string, string>> => (declarer === "item" ? facts : { ...facts, declarer });

/**
 * The kind of a variable template processing may not read: a declared response or outcome
 * variable, or a built-in.
 */
type ForbiddenRead = "built-in" | "outcome" | "response";

/**
 * Give the kind of variable a name read in template processing names, when template processing
 * may not read it (pantry's P26).
 *
 * "An expression used in a qti-template-rule must not refer to the value of a response variable or
 * outcome variable. It may only refer to the values of the template variables." (`info.txt:65111`)
 * Context variables "may be referenced in template processing" (`info.txt:22601`), and so may the
 * built-in context variable `QTI_CONTEXT`. So a declared response or outcome is forbidden, and so
 * is every other built-in that no declaration answers (`numAttempts`, `duration`,
 * `completionStatus`); a template or context declaration is not. The qti package decides the same
 * (the `Template reads` law in `packages/pantry/src/qti/expressions.ts`, over `resolve` in
 * `packages/pantry/src/import/overlays/expressions.ts`), the declaration first, as here.
 *
 * @param identifier The name read, as {@link identifierOf} reads it.
 * @param declarations Every declaration of the item, by identifier.
 * @returns The kind of variable it names, none when template processing may read it or it names
 *   nothing.
 */
const forbiddenRead = (
  identifier: string,
  declarations: ReadonlyMap<string, SourceElement>,
): Option.Option<ForbiddenRead> => {
  const declaration = declarations.get(identifier);
  if (declaration === undefined) {
    return builtIns.has(identifier) && identifier !== "QTI_CONTEXT"
      ? Option.some("built-in")
      : Option.none();
  }

  if (isQti(declaration, (local) => local === "qti-response-declaration")) {
    return Option.some("response");
  }

  return isQti(declaration, (local) => local === "qti-outcome-declaration")
    ? Option.some("outcome")
    : Option.none();
};

/**
 * Construct the `expression-type` refusal of a read template processing may not make, with
 * `check: "template-read"` (pantry's P26, {@link forbiddenRead}).
 *
 * @param source The document.
 * @param visit The reading element's visit.
 * @param identifier The name it reads.
 * @param variableKind The kind of variable the name names.
 * @param attribute The reference attribute it reads the name through, none when it reads it
 *   through its `identifier`.
 * @returns The refusal at the reading element's path.
 */
const templateReadRefusal = (
  source: SourceDocument,
  visit: Visit,
  identifier: string,
  variableKind: ForbiddenRead,
  attribute: Option.Option<string>,
): Refusal =>
  refusal(source, "expression-type", visit.path, {
    ...Option.match(attribute, {
      onNone: () => ({}),
      onSome: (name) => ({ attribute: name }),
    }),
    check: "template-read",
    element: visit.element.local,
    identifier,
    variableKind,
  });

/**
 * The kind of variable an element's `identifier` must name: a response, an outcome, or any
 * variable.
 */
type Expected = "outcome" | "response" | "variable";

/**
 * The rules of inline response processing whose `identifier` names the variable they set, and the
 * kind each must name: `qti-set-outcome-value` sets an outcome variable (`info-compact.txt:11770`),
 * and so does `qti-lookup-outcome-value`, whose `identifier` is "The identifier of the outcome
 * variable to be set" (`:10775`).
 *
 * An expression names its variable through its kind's declaration facet in the registry instead
 * ({@link namingOf}).
 */
const referencing: ReadonlyMap<string, Expected> = new Map<string, Expected>([
  ["qti-lookup-outcome-value", "outcome"],
  ["qti-set-outcome-value", "outcome"],
]);

/**
 * The built-in variables each kind of reference may name: each built-in stands as a declaration of
 * its kind ({@link builtInKinds}), so a reference that names a variable of a kind names the
 * built-ins of that kind too (reading 111, "a processing element's `identifier` names a variable
 * of the kind the element reads or sets"). `qti-set-outcome-value` and `qti-lookup-outcome-value`
 * set the built-in outcome `completionStatus`; `qti-correct`, `qti-map-response` and
 * `qti-map-response-point` read the built-in responses `numAttempts` and `duration`, and a
 * mapping expression of one is refused for the mapping a built-in lacks
 * ({@link mapResponseRequirements}); `qti-variable` and `qti-default` read every built-in. The qti
 * package decides the same: its `Variable kind` law (`packages/pantry/src/qti/expressions.ts`)
 * judges a reference to a built-in as one to a declaration of the kind its `BuiltInVariable`
 * relation (`packages/pantry/src/grammar/install.ts`) stands it as.
 */
const builtInsNamed = {
  outcome: ["completionStatus"],
  response: ["numAttempts", "duration"],
  variable: [...builtIns.keys()],
} as const satisfies Record<Expected, readonly string[]>;

/**
 * An element's `identifier`, read as a reference to a variable of the kind the element names.
 */
interface Reference {
  readonly expected: Expected;
  readonly identifier: string;
}

/**
 * Give the expression kind an element is: a QTI element named `qti-` and one of the registry's
 * kinds.
 *
 * @param element The element.
 * @returns Its kind, none for any other element.
 */
const kindOf = (element: SourceElement): Option.Option<ExpressionKind> =>
  element.namespace === qtiNamespace && element.local.startsWith("qti-")
    ? Arr.findFirst(expressionKinds, (kind) => `qti-${kind}` === element.local)
    : Option.none();

/**
 * Give the attribute through which an element names a variable, and the kind of variable it must
 * name: a rule of {@link referencing}, or an expression whose kind's rule declares a declaration
 * facet (`qti-variable` and `qti-default` name any variable; `qti-correct`, `qti-map-response` and
 * `qti-map-response-point` a response). So a kind whose rule declares the facet has its identifier
 * checked here with no edit to this module.
 *
 * "This expression looks up the value of an item variable that has been declared in a
 * corresponding variable declaration or is one of the built-in variables" (`qti-variable`,
 * `info-compact.txt:9286`); `qti-correct`, `qti-map-response` and `qti-map-response-point` read a
 * response variable (`:11418`, `:11438`, `:11437`).
 *
 * @param element The element.
 * @returns The naming attribute and the kind expected, none for an element that names no variable.
 */
const namingOf = (
  element: SourceElement,
): Option.Option<{ readonly attribute: string; readonly expected: Expected }> => {
  const expected = referencing.get(element.local);
  if (element.namespace !== qtiNamespace) {
    return Option.none();
  }

  return expected === undefined
    ? Option.flatMap(kindOf(element), (kind) => Option.fromUndefinedOr(kindRules[kind].declaration))
    : Option.some({ attribute: "identifier", expected });
};

/**
 * Read the variable reference of an element that names one.
 *
 * @param element The element.
 * @returns Its reference, none for an element that names no variable, for one with no
 *   `identifier`, which is the structural validator's `missing-attribute`, and for one whose
 *   `identifier` names nothing ({@link nameOf}), which no law here judges and nothing types.
 */
const referenceOf = (element: SourceElement): Option.Option<Reference> =>
  Option.flatMap(namingOf(element), ({ attribute, expected }) =>
    Option.map(Option.flatMap(attributeOf(element, attribute), nameOf), (identifier) => ({
      expected,
      identifier,
    })),
  );

/**
 * Give the value of an attribute when it is one of a vocabulary's, as written.
 *
 * @param element The element.
 * @param local The attribute's local name.
 * @param vocabulary The values the attribute may hold.
 * @returns The value, none when the attribute is absent or outside the vocabulary.
 */
const vocabularyValue = <A extends string>(
  element: SourceElement,
  local: string,
  vocabulary: readonly A[],
): Option.Option<A> =>
  Option.flatMap(attributeOf(element, local), (attribute) =>
    Arr.findFirst(vocabulary, (value) => value === attribute.value),
  );

/**
 * Give the type a declaration declares, the one the rules read and a package types an item's
 * variable by when a test reads it through an item ref (`#plate/package/open.ts`).
 *
 * A declaration whose `cardinality` is absent or outside the vocabulary, or whose `base-type` is
 * outside it, is the structural validator's refusal, so its type is not judged here. A declaration
 * with no `base-type` (a `record`) has no base type of its own, `unknown`.
 *
 * @param declaration The declaration.
 * @returns Its type, none when it is not judged.
 */
export const declarationType = (declaration: SourceElement): Option.Option<ExpressionType> => {
  const baseType = vocabularyValue(declaration, "base-type", baseTypes);
  if (Option.isSome(attributeOf(declaration, "base-type")) && Option.isNone(baseType)) {
    return Option.none();
  }

  return Option.map(vocabularyValue(declaration, "cardinality", cardinalities), (cardinality) => ({
    baseType: Option.getOrElse(baseType, (): ExpressionType["baseType"] => "unknown"),
    cardinality,
  }));
};

/**
 * Give the document's declarations a reference of a kind may name.
 *
 * @param expected The kind of variable the reference must name.
 * @param context The document's declarations.
 * @returns The outcome or the response declarations, or every declaration a `qti-variable` may
 *   read, by identifier.
 */
const declarationsNamable = (
  expected: Expected,
  context: Context,
): ReadonlyMap<string, SourceElement> =>
  ({ outcome: context.outcomes, response: context.responses, variable: context.variables })[
    expected
  ];

/**
 * Find the variable a reference names, and its type.
 *
 * A declaration of the expected kind wins over a built-in of the same name, and a built-in of the
 * document's ({@link VariableScope}'s `builtIns`) over the context's typer of a name neither
 * answers (`typeUnanswered`). Identifiers compare exactly, so one that holds `.` names the
 * declaration of that exact identifier (reading 37); in an item the typer answers nothing, and a
 * prefixed reference (`ITEMREF.VAR`, reading 4) is typed only in a test's processing.
 *
 * @param reference The reference.
 * @param context The document's declarations, built-ins and typer.
 * @returns The variable's type, itself none when its declaration's type is not judged; none when
 *   no variable of the expected kind has the identifier.
 */
const variableType = (
  reference: Reference,
  context: Context,
): Option.Option<Option.Option<ExpressionType>> => {
  const declaration = declarationsNamable(reference.expected, context).get(reference.identifier);
  if (declaration !== undefined) {
    return Option.some(declarationType(declaration));
  }

  const namable: readonly string[] = builtInsNamed[reference.expected];
  const builtIn = context.builtIns.get(reference.identifier);
  if (builtIn !== undefined && namable.includes(reference.identifier)) {
    return Option.some(builtIn.type);
  }

  return Option.map(context.typeUnanswered(reference.identifier), Option.some);
};

/**
 * The kind each declaration that a `qti-variable` may read declares, by its local name.
 */
const declarationKinds: ReadonlyMap<string, NamedKind> = new Map<string, NamedKind>([
  ["qti-context-declaration", "context"],
  ["qti-outcome-declaration", "outcome"],
  ["qti-response-declaration", "response"],
  ["qti-template-declaration", "template"],
]);

/**
 * The `declared` fact of an `undeclared-variable` refusal in a test whose name is a built-in's
 * ({@link builtInKinds}) that the test declares as an outcome or a context variable.
 *
 * A test may declare `numAttempts` or `completionStatus` (reading 168, "A test may declare a
 * variable named `numAttempts` or `completionStatus`; in a test only `duration` is reserved"), and
 * the declaration takes the built-in's place in its processing ({@link testProcessingScope}). An
 * expression that reads another kind, such as a `qti-correct` of a declared outcome `numAttempts`,
 * which reads a response, is then refused although the name is declared, and the fact lets the
 * wording say that the test declares it, rather than that the built-in has no declaration. Any
 * other name, and every name in an item, carries no such fact.
 *
 * @param identifier The name the expression gives.
 * @param context The document's declarations.
 * @returns The fact `declared`, `outcome` or `context`, for such a name in a test; no fact
 *   otherwise.
 */
const declaredBuiltIn = (
  identifier: string,
  context: Context,
): Readonly<Record<string, string>> => {
  const declaration = context.variables.get(identifier);
  const declared = declaration === undefined ? undefined : declarationKinds.get(declaration.local);

  return context.declarer === "test" &&
    builtInKinds.has(identifier) &&
    (declared === "outcome" || declared === "context")
    ? { declared }
    : {};
};

/**
 * Apply `undeclared-variable` to an element that lies in a processing ({@link processings}) and
 * names a variable ({@link namingOf}).
 *
 * An expression whose kind's rule declares a declaration facet names a variable of the kind the
 * facet expects: `qti-variable` a response, outcome, template or context declaration of the
 * document, or a built-in variable (`info-compact.txt:9286`), and `qti-default` likewise;
 * `qti-correct`, `qti-map-response` and `qti-map-response-point` a response declaration or a
 * built-in response, `numAttempts` or `duration`. `qti-set-outcome-value` and
 * `qti-lookup-outcome-value` name an outcome declaration or `completionStatus`. The qti package
 * refuses each by its `Variable declared` law (P8) and its `Variable kind` law (rule
 * `variable-kind`), both in `packages/pantry/src/qti/expressions.ts`. A reference attribute that
 * names no variable is {@link attributeReferences}' refusal, and a template rule's target
 * {@link templateTarget}'s. In template processing a name that template processing may not read
 * ({@link forbiddenRead}) is {@link templateReads}' refusal (P26) alone, never this one as well.
 * The qti package states that read as its own law, `Template reads` (P26), beside `Variable
 * declared` and `Variable kind`, and names a refusal by its most specific law in one fixed order
 * (`precedence` in `packages/pantry/src/vocab/laws.ts`).
 *
 * A read of the built-in `duration` is never refused for the item's `time-dependent`: reading 150
 * ("an item's built-in `duration` may be read whether or not the item is time dependent"). A
 * built-in is named by the kind it stands as ({@link builtInsNamed}, reading 111): a
 * `qti-lookup-outcome-value` sets `completionStatus` as a `qti-set-outcome-value` does, and a
 * `qti-correct` reads `numAttempts` or `duration`.
 *
 * In a test a name its context's typer answers (`typeUnanswered`), a prefixed read, is never
 * refused here, nor is any name in a section on its own ({@link processingRefusals}): the qti
 * package types a prefixed read through the assembled test (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`, judged by its `Variable declared`, `Variable kind` and
 * `Prefixed reference` laws), which a package judges, and, by reading 112 ("a test's setter sets a
 * variable of its own document, so a prefixed reading never resolves it"), resolves a setter's name
 * by its unsplit reading alone. A name nothing answers in a test's processing, or in a section
 * document a test reaches, is refused with `declarer: "test"` ({@link declaredBy}), so its wording
 * names the test, which declares outcomes and context variables and no response, rather than an
 * item. A built-in's name the test declares as an outcome or a context variable also carries the
 * kind that declares it ({@link declaredBuiltIn}).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusal at the element's path when it names no variable of the kind it must; none
 *   for any other element, for one outside processing, and for a read template processing may not
 *   make.
 */
const undeclaredVariable = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const reference = referenceOf(visit.element);
  if (Option.isNone(reference) || !inProcessing(context, visit.element)) {
    return [];
  }

  const { expected, identifier } = reference.value;
  if (
    liesIn(context, visit.element, "template") &&
    Option.isSome(forbiddenRead(identifier, context.variables))
  ) {
    return [];
  }

  return Option.isNone(variableType(reference.value, context))
    ? [
        refusal(
          source,
          "undeclared-variable",
          visit.path,
          declaredBy(
            {
              element: visit.element.local,
              expected,
              identifier,
              ...declaredBuiltIn(identifier, context),
            },
            context.declarer,
          ),
        ),
      ]
    : [];
};

/**
 * Apply `expression-type` with `check: "template-read"` to an expression of template processing
 * that reads a variable through its `identifier` ({@link namingOf}): `qti-variable`, `qti-default`,
 * `qti-correct`, `qti-map-response` and `qti-map-response-point`. One that names a declared
 * response or outcome, or a built-in other than `QTI_CONTEXT`, reads what template processing may
 * not ({@link forbiddenRead}). The qti package refuses the same as P26 (the `Template reads` law in
 * `packages/pantry/src/qti/expressions.ts`, the `Mapped response` law there judging the two mapping
 * kinds); a mapping kind's P27 and a `qti-correct`'s wrong kind are not reported beside it
 * ({@link mapResponseRequirements}, {@link undeclaredVariable}).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The item's declarations and the parents the walk has met.
 * @returns The refusal at the expression's path, with the identifier and the kind of variable it
 *   names; none for any other element and for one outside template processing.
 */
const templateReads = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const reference = referenceOf(visit.element);
  if (Option.isNone(reference) || !liesIn(context, visit.element, "template")) {
    return [];
  }

  const { identifier } = reference.value;

  return Option.match(forbiddenRead(identifier, context.variables), {
    onNone: () => [],
    onSome: (variableKind) => [
      templateReadRefusal(source, visit, identifier, variableKind, Option.none()),
    ],
  });
};

/**
 * Give the child elements of an element, in document order: an expression's operands.
 *
 * @param element The element.
 * @returns Its child elements.
 */
const operandsOf = (element: SourceElement): readonly SourceElement[] =>
  element.children.flatMap((child) => (child.kind === "element" ? [child] : []));

/**
 * Give the one expression an element holds, its only child element.
 *
 * @param element A `qti-set-outcome-value` or a `qti-lookup-outcome-value`.
 * @returns Its expression, none when it holds no child element or more than one.
 */
const operandOf = (element: SourceElement): Option.Option<SourceElement> => {
  const operands = operandsOf(element);

  return operands.length === 1 ? Arr.head(operands) : Option.none();
};

/**
 * Report whether a reference is a prefixed read: no declaration of the kind it expects and no
 * built-in it may name answers it, so only the context's typer can (`typeUnanswered`), as
 * {@link variableType} resolves it. In an item that typer answers nothing.
 *
 * @param reference The reference.
 * @param context The document's declarations, built-ins and typer.
 * @returns True when neither a declaration nor a built-in answers the reference.
 */
const isPrefixedRead = (reference: Reference, context: Context): boolean => {
  const namable: readonly string[] = builtInsNamed[reference.expected];

  return (
    !declarationsNamable(reference.expected, context).has(reference.identifier) &&
    !(context.builtIns.has(reference.identifier) && namable.includes(reference.identifier))
  );
};

/**
 * Give the type a weighted read takes (G-R3 198). "When applying a weight to the value of a
 * variable with base-type integer the value is subject to type promotion and the result of the
 * expression has base-type float" (`info.txt:72139`), and weights apply only "when the item
 * identifier prefixing technique … is being used to look up the value of an item variable". So a
 * prefixed read of an integer item variable is a float of its declared cardinality, whether or not
 * its item ref defines the weight, which is then 1.0. A float stays a float, and "if the item
 * variable is of any other type the weight is ignored" (G-R3 186). A name the test declares,
 * unprefixed or whole, or a built-in, keeps its declared type; in a test checked alone a prefixed
 * read is unknown and stays so. The engine weights a read alike (`evaluateVariable` in
 * `#plate/engine/expressions/references.ts`). The qti package promotes no weighted read (the
 * relation `ExpressionAttribute` in `packages/pantry/src/qti/expressions.ts` reads
 * `weight-identifier` on `qti-test-variables` alone): an agreement difference G-R3 198 settles.
 *
 * @param reference The weighted reference.
 * @param declared The type of the variable it names ({@link variableType}).
 * @param context The document's declarations, built-ins and typer.
 * @returns The read's type.
 */
const weightedType = (
  reference: Reference,
  declared: ExpressionType,
  context: Context,
): ExpressionType =>
  declared.baseType === "integer" && isPrefixedRead(reference, context)
    ? { ...declared, baseType: "float" }
    : declared;

/**
 * Give the base type a `qti-test-variables` collects from the test's items, as the context's typer
 * gives it for its `variable-identifier` (`typeCollected`; G-R3 199), for its kind's rule to read
 * when it is unweighted and writes no `base-type`.
 *
 * @param expression The expression.
 * @param context The document's declarations and typers.
 * @returns The `collected` attribute; none for another kind, one with no `variable-identifier`, or
 *   a context that holds no items.
 */
const collectedAttribute = (
  expression: SourceElement,
  context: Context,
): Pick<ResultAttributes, "collected"> => {
  if (!isQti(expression, (local) => local === "qti-test-variables")) {
    return {};
  }

  const collected = Option.flatMap(attributeOf(expression, "variable-identifier"), (identifier) =>
    context.typeCollected.pipe(Option.map((typeCollected) => typeCollected(identifier.value))),
  );

  return Option.match(collected, {
    onNone: () => ({}),
    onSome: (baseType) => ({ collected: baseType }),
  });
};

/**
 * Give the attributes an expression's type depends on, as its kind's rule reads them
 * (`ResultAttributes` in `#plate/model/expression.ts`): the expression's own `base-type`
 * (`qti-base-value`'s and `qti-test-variables`'), operator `name` (`qti-math-operator`'s and
 * `qti-stats-operator`'s) and whether it carries a `weight-identifier`; for a `qti-test-variables`,
 * the base type it collects from the test's items ({@link collectedAttribute}); and, for a kind
 * whose rule declares a declaration facet, the type of the declaration it names
 * ({@link variableType}), which a weighted read promotes ({@link weightedType}).
 *
 * A `base-type` outside the vocabulary is the structural validator's refusal and is not filled
 * in, nor is the type of a declaration that is not judged, so the rule reads either as unknown.
 *
 * @param expression The expression.
 * @param rule Its kind's rule.
 * @param context The document's declarations.
 * @returns The attributes, none when the kind's declaration facet names no variable of the kind it
 *   expects, which leaves the expression untyped.
 */
const resultAttributes = (
  expression: SourceElement,
  rule: KindRule,
  context: Context,
): Option.Option<ResultAttributes> => {
  const weighted = Option.isSome(attributeOf(expression, "weight-identifier"));
  const own: ResultAttributes = {
    ...Option.match(vocabularyValue(expression, "base-type", baseTypes), {
      onNone: () => ({}),
      onSome: (baseType) => ({ baseType }),
    }),
    ...Option.match(attributeOf(expression, "name"), {
      onNone: () => ({}),
      onSome: (name) => ({ name: name.value }),
    }),
    ...collectedAttribute(expression, context),
    weighted,
  };
  if (rule.declaration === undefined) {
    return Option.some(own);
  }

  return Option.flatMap(referenceOf(expression), (reference) =>
    Option.map(variableType(reference, context), (declared) =>
      Option.match(declared, {
        onNone: () => own,
        onSome: (type) => {
          const { baseType, cardinality } = weighted
            ? weightedType(reference, type, context)
            : type;

          return { ...own, baseType, cardinality };
        },
      }),
    ),
  );
};

/**
 * Give the type of an expression through its kind's rule in the registry (`kindRules` in
 * `#plate/model/expressions/read.ts`): the rule's `resultType` over its operands' types, typed the
 * same way, and its {@link resultAttributes}. The qti package types expressions alike (the
 * typings of `expressionTypings` in `packages/pantry/src/grammar/expression.ts`).
 *
 * An expression is untyped (none) when its element is no expression kind, when any of its operands
 * is untyped, or when its declaration facet names no variable (ruling R3). Untyped is not judged,
 * and it is not a kind's `unknown` or `any`, which pass up as the qti package passes them and
 * satisfy every rule.
 *
 * Each type is kept in the context, so an expression is typed once however many of its ancestors
 * judge their operands.
 *
 * @param expression The expression.
 * @param context The document's declarations and the types worked out so far.
 * @returns Its type, none when it is untyped.
 */
const expressionType = (
  expression: SourceElement,
  context: Context,
): Option.Option<ExpressionType> => {
  const known = context.types.get(expression);
  if (known !== undefined) {
    return known;
  }

  const type = Option.flatMap(kindOf(expression), (kind) => {
    const rule: KindRule = kindRules[kind];

    return Option.flatMap(
      Option.all(operandsOf(expression).map((operand) => expressionType(operand, context))),
      (operands) =>
        Option.map(resultAttributes(expression, rule, context), (attributes) =>
          rule.resultType(operands, attributes),
        ),
    );
  });
  context.types.set(expression, type);

  return type;
};

/**
 * The type an untyped operand is judged as: unknown, which satisfies every operand rule, so a
 * typed sibling is still judged (ruling R3).
 */
const untyped: ExpressionType = { baseType: "unknown", cardinality: "unknown" };

/**
 * Spell a type's base type for a refusal's detail.
 *
 * @param type The type.
 * @returns Its base type, empty for one with no base type of its own (`unknown`, or `any`).
 */
const baseTypeText = (type: ExpressionType): string =>
  type.baseType === "any" || type.baseType === "unknown" ? "" : type.baseType;

/**
 * Report whether two types agree, as the qti package's `Set type` law compares them, with
 * `silentBases` (`packages/pantry/src/qti/expressions.ts`): the same base type unless either has
 * none of its own (`any` or `unknown`), and the same cardinality unless either is `unknown`.
 *
 * @param one A type.
 * @param other Another.
 * @returns Whether they agree.
 */
const agree = (one: ExpressionType, other: ExpressionType): boolean =>
  (one.baseType === other.baseType ||
    [one.baseType, other.baseType].some(
      (baseType) => baseType === "any" || baseType === "unknown",
    )) &&
  (one.cardinality === other.cardinality ||
    one.cardinality === "unknown" ||
    other.cardinality === "unknown");

/**
 * The kind of variable a template rule sets: a template variable, a response's correct or default
 * value, or an outcome's default value.
 */
type TargetKind = "outcome" | "response" | "template";

/**
 * The declaration that declares a variable of each kind a template rule may set.
 */
const targetDeclarations = {
  outcome: "qti-outcome-declaration",
  response: "qti-response-declaration",
  template: "qti-template-declaration",
} as const satisfies Record<TargetKind, string>;

/**
 * The template rules that set a variable to their expression, and the kinds of variable each may
 * set, as the information model names them: `qti-set-template-value` "sets the value of a template
 * variable" (`info.txt:65138`), `qti-set-correct-response` names "The response variable to have its
 * correct value set" (`:65246`), and `qti-set-default-value` "The response variable or outcome
 * variable to have its default value set" (`:65219`). The qti package admits the same kinds
 * (`referenceDeclarations` in `packages/pantry/src/qti/expression-types.ts`, judged by its
 * `Variable kind` law, rule `variable-kind`).
 */
const templateSetters: ReadonlyMap<string, readonly TargetKind[]> = new Map<
  string,
  readonly TargetKind[]
>([
  ["qti-set-correct-response", ["response"]],
  ["qti-set-default-value", ["response", "outcome"]],
  ["qti-set-template-value", ["template"]],
]);

/**
 * A template rule's target: the name its `identifier` gives, the kinds of variable the rule may
 * set, and, when the name answers a variable of one of those kinds, that kind and the variable's
 * type, itself none when its declaration's type is not judged ({@link declarationType}).
 */
interface TemplateTarget {
  readonly identifier: string;
  readonly kinds: readonly TargetKind[];
  readonly set: Option.Option<{
    readonly kind: TargetKind;
    readonly type: Option.Option<ExpressionType>;
  }>;
}

/**
 * Read the target of a template rule that sets a variable ({@link templateSetters}).
 *
 * The name answers a declaration of the item, else a built-in, which stands as a declaration of its
 * kind (reading 111, "a processing element's `identifier` names a variable of the kind the element
 * reads or sets"): `numAttempts` and `duration` a response, `completionStatus` an outcome ({@link
 * builtInKinds}), each typed as the built-in. A declaration wins over a built-in of the same name,
 * as {@link variableType} finds one. A name that a declaration or a built-in of another kind answers
 * sets nothing the rule may set.
 *
 * @param element The element.
 * @param context The item's declarations and built-ins.
 * @returns The target; none for an element that is not such a rule, for one with no
 *   `identifier`, which is the structural validator's `missing-attribute`, and for one whose
 *   `identifier` names nothing ({@link nameOf}).
 */
const templateTargetOf = (
  element: SourceElement,
  context: Context,
): Option.Option<TemplateTarget> =>
  Option.map(
    Option.all([
      qtiEntry(templateSetters, element),
      Option.flatMap(attributeOf(element, "identifier"), nameOf),
    ]),
    ([kinds, identifier]) => {
      const declaration = context.variables.get(identifier);

      return {
        identifier,
        kinds,
        set:
          declaration === undefined
            ? Option.flatMap(Option.fromUndefinedOr(context.builtIns.get(identifier)), (builtIn) =>
                Option.map(
                  Arr.findFirst(kinds, (kind) => kind === builtIn.kind),
                  (kind) => ({ kind, type: builtIn.type }),
                ),
              )
            : Option.map(
                Arr.findFirst(kinds, (kind) =>
                  isQti(declaration, (local) => local === targetDeclarations[kind]),
                ),
                (kind) => ({ kind, type: declarationType(declaration) }),
              ),
      };
    },
  );

/**
 * Apply `undeclared-variable` to a template rule whose `identifier` names no variable of a kind the
 * rule may set ({@link templateTargetOf}): a `qti-set-template-value` names a template variable, a
 * `qti-set-correct-response` a response, and a `qti-set-default-value` a response or an outcome,
 * a built-in of that kind among them (reading 111).
 *
 * A name the item declares no variable for, and one a declaration or a built-in of another kind
 * answers, such as a `qti-set-correct-response` of the built-in outcome `completionStatus`, are
 * refused alike, as a `qti-set-outcome-value` that names no outcome is ({@link
 * undeclaredVariable}), with the kinds the rule may set as `expected`, space-separated. The qti
 * package refuses the first by its `Variable declared` law and the second by its `Variable kind`
 * law, which judges a built-in as a declaration of the kind its `BuiltInVariable` relation stands
 * it as (the laws in `packages/pantry/src/qti/expressions.ts`, the relation in
 * `packages/pantry/src/grammar/install.ts`).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The item's declarations and the parents the walk has met.
 * @returns The refusal at the rule's path when its target is not a variable it may set; none for
 *   any other element and for one outside template processing.
 */
const templateTarget = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const target = templateTargetOf(visit.element, context);
  if (
    Option.isNone(target) ||
    Option.isSome(target.value.set) ||
    !liesIn(context, visit.element, "template")
  ) {
    return [];
  }

  return [
    refusal(source, "undeclared-variable", visit.path, {
      element: visit.element.local,
      expected: target.value.kinds.join(" "),
      identifier: target.value.identifier,
    }),
  ];
};

/**
 * Give the variable a setting rule sets and its type: a `qti-set-outcome-value`'s outcome, as
 * {@link variableType} finds it, a template rule's variable among the kinds {@link templateSetters}
 * lets it set, a built-in of that kind among them, with that kind ({@link templateTargetOf}), or
 * the template variable of its item a test's `qti-template-default` sets, named by its
 * `template-identifier` and typed by the context (`TemplateDefaultTarget` in
 * `packages/pantry/src/qti/expressions.ts`, typed by its `Template default type` law).
 *
 * @param element The rule.
 * @param context The document's declarations.
 * @returns The variable's identifier and type, and its kind for a template rule or a template
 *   default; none for an element that sets no variable, for one whose variable is undeclared or of
 *   a kind it may not set, for a declaration whose type is not judged, and for a template default
 *   the context does not type.
 */
const setTarget = (
  element: SourceElement,
  context: Context,
): Option.Option<{
  readonly identifier: string;
  readonly kind: Option.Option<TargetKind>;
  readonly type: ExpressionType;
}> => {
  if (isQti(element, (local) => local === "qti-template-default")) {
    return Option.flatMap(attributeOf(element, "template-identifier"), (written) =>
      Option.map(context.templateDefaultType(element), (type) => ({
        identifier: identifierOf(written),
        kind: Option.some<TargetKind>("template"),
        type,
      })),
    );
  }

  if (isQti(element, (local) => local === "qti-set-outcome-value")) {
    return Option.flatMap(referenceOf(element), (reference) =>
      Option.map(Option.flatten(variableType(reference, context)), (type) => ({
        identifier: reference.identifier,
        kind: Option.none(),
        type,
      })),
    );
  }

  return Option.flatMap(templateTargetOf(element, context), ({ identifier, set }) =>
    set.pipe(
      Option.flatMap(({ kind, type }) =>
        type.pipe(
          Option.map((declared) => ({
            identifier,
            kind: Option.some(kind),
            type: declared,
          })),
        ),
      ),
    ),
  );
};

/**
 * Apply `expression-type` to a rule that sets a variable to its expression: a
 * `qti-set-outcome-value` of inline response processing or of a test's outcome processing, a
 * `qti-set-template-value`, a `qti-set-correct-response` or a `qti-set-default-value` of template
 * processing, and a test's `qti-template-default`, which sets a template variable of its item ref's
 * item and is itself the element that holds its expression.
 *
 * "Floating point values can not be assigned to integer variables and vice-versa"
 * (`info-compact.txt:11770`): the expression's base type and cardinality are the variable's ({@link
 * agree}), the outcome's, the template variable's, or the response's or outcome's whose correct or
 * default value the rule sets ({@link setTarget}). A type with no base type (a `record`) compares
 * by cardinality alone. A variable or an expression that is not typed is not judged, nor is a
 * template rule's variable that is undeclared or of a kind the rule may not set ({@link
 * templateTarget} refuses that). The qti package refuses the same as P20 (`setKinds` in
 * `packages/pantry/src/grammar/expression.ts`, judged by the `Set type` law in
 * `packages/pantry/src/qti/expressions.ts`). The detail names the variable's type `outcomeBaseType`
 * and `outcomeCardinality` whatever its kind, and `element` names the rule; a template rule's or a
 * template default's detail names the variable's kind too, `targetKind` (`template`, `response` or
 * `outcome`), so its sentence does not word a template variable or a response as an outcome.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusal at the rule's path when its expression's type is not its variable's; none
 *   for any other element.
 */
const setType = (source: SourceDocument, visit: Visit, context: Context): readonly Refusal[] => {
  if (
    !inProcessing(context, visit.element) &&
    !isQti(visit.element, (local) => local === "qti-template-default")
  ) {
    return [];
  }

  const target = setTarget(visit.element, context);
  const expression = Option.flatMap(operandOf(visit.element), (operand) =>
    expressionType(operand, context),
  );
  if (Option.isNone(target) || Option.isNone(expression)) {
    return [];
  }

  return agree(expression.value, target.value.type)
    ? []
    : [
        refusal(source, "expression-type", visit.path, {
          element: visit.element.local,
          expressionBaseType: baseTypeText(expression.value),
          expressionCardinality: expression.value.cardinality,
          identifier: target.value.identifier,
          outcomeBaseType: baseTypeText(target.value.type),
          outcomeCardinality: target.value.type.cardinality,
          ...Option.match(target.value.kind, {
            onNone: () => ({}),
            onSome: (targetKind) => ({ targetKind }),
          }),
        }),
      ];
};

/**
 * The local names of the rules whose first child is a condition: the branches of a response
 * condition, of an outcome condition and of a template condition, and a template constraint, as
 * the qti package's `conditionKinds` lists them (`packages/pantry/src/grammar/expression.ts`). A
 * `qti-pre-condition` and a `qti-branch-rule` are not among them: the information model words
 * each as "If the expression evaluates to 'true'" (`info.txt` 5.23) and types neither.
 */
const conditionBranches: ReadonlySet<string> = new Set([
  "qti-outcome-else-if",
  "qti-outcome-if",
  "qti-response-else-if",
  "qti-response-if",
  "qti-template-constraint",
  "qti-template-else-if",
  "qti-template-if",
]);

/**
 * Apply `expression-type` to the condition of a `qti-response-if` or `qti-response-else-if` of
 * inline response processing, of a `qti-outcome-if` or `qti-outcome-else-if` of a test's outcome
 * processing, or of a `qti-template-if`, `qti-template-else-if` or `qti-template-constraint` of
 * template processing.
 *
 * "A responseIf part consists of an expression which must have an effective base-type of boolean
 * and single cardinality" (`info-compact.txt:10963`), and a `qti-response-else-if` part likewise
 * (`info-compact.txt:10945`); so must a `qti-template-if` part and a `qti-template-else-if` part
 * (`:11165`, `:11166`), and "A qti-template-constraint contains an expression which must have an
 * effective base-type of boolean and single cardinality" (`:11918`): the rule's first child
 * element, its condition, is a single `boolean` ({@link agree}). A condition that is untyped
 * ({@link expressionType}) is not judged, and one of base type `any` or `unknown` passes, as a
 * `qti-null` does. The qti package refuses the same as P21 (the `Condition type` law in
 * `packages/pantry/src/qti/expressions.ts`, over `conditionKinds` in
 * `packages/pantry/src/grammar/expression.ts`).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusal at the rule's path, with `check: "condition"` and the condition's type,
 *   when its condition is not a single `boolean`; none for any other element.
 */
const conditionType = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  if (
    !isQti(visit.element, (local) => conditionBranches.has(local)) ||
    !inProcessing(context, visit.element)
  ) {
    return [];
  }

  const condition = Option.flatMap(Arr.head(operandsOf(visit.element)), (expression) =>
    expressionType(expression, context),
  );
  if (Option.isNone(condition) || agree(condition.value, singleOf("boolean"))) {
    return [];
  }

  return [
    refusal(source, "expression-type", visit.path, {
      check: "condition",
      element: visit.element.local,
      expressionBaseType: baseTypeText(condition.value),
      expressionCardinality: condition.value.cardinality,
    }),
  ];
};

/**
 * The base types a lookup operand may have under each lookup table (reading 28).
 */
const lookupOperands = {
  "qti-interpolation-table": ["integer", "float", "duration"],
  "qti-match-table": ["integer"],
} as const satisfies Record<string, readonly BaseType[]>;

/**
 * The local name of a lookup table.
 */
type LookupTable = keyof typeof lookupOperands;

/**
 * Give the lookup table an outcome declaration holds.
 *
 * @param declaration The outcome declaration.
 * @returns The table's local name, none when the declaration holds neither table.
 */
const lookupTableOf = (declaration: SourceElement): Option.Option<LookupTable> =>
  Arr.findFirst(
    declaration.children.flatMap((child) =>
      child.kind === "element" && child.namespace === qtiNamespace ? [child.local] : [],
    ),
    (local): local is LookupTable => Object.hasOwn(lookupOperands, local),
  );

/**
 * Apply `template-requirements` to a `qti-lookup-outcome-value` that lies in a processing
 * ({@link processings}): the outcome it names is declared with a lookup table, as the lookup "sets
 * the value of an outcome variable to the value obtained by looking up the value of the associated
 * expression in the lookupTable associated with the outcome's declaration" (the information model,
 * `info-compact.txt:10774`).
 *
 * A lookup that names no outcome declaration is not judged here: an undeclared variable is its own
 * refusal, and this rule refuses only a declared outcome that holds neither a `qti-match-table` nor
 * a `qti-interpolation-table`. The detail has {@link neededDetail}'s keys, with both tables in
 * `child`.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusal at the `qti-lookup-outcome-value`'s path when its outcome holds no lookup
 *   table; none for any other element.
 */
const lookupTableRequirements = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const name = Option.flatMap(attributeOf(visit.element, "identifier"), nameOf);
  if (
    !isQti(visit.element, (local) => local === "qti-lookup-outcome-value") ||
    Option.isNone(name) ||
    !inProcessing(context, visit.element)
  ) {
    return [];
  }

  const identifier = name.value;
  const declaration = context.outcomes.get(identifier);

  return declaration === undefined || Option.isSome(lookupTableOf(declaration))
    ? []
    : [
        refusal(source, "template-requirements", visit.path, {
          child: "qti-match-table or qti-interpolation-table",
          declaration: "qti-outcome-declaration",
          element: visit.element.local,
          identifier,
        }),
      ];
};

/**
 * The base types a lookup operand may have whatever its table: those of the table that reads the
 * most, the `qti-interpolation-table` (reading 28).
 */
const anyLookupOperand: readonly BaseType[] = lookupOperands["qti-interpolation-table"];

/**
 * Apply `expression-type` to a `qti-lookup-outcome-value`'s operand (reading 28).
 *
 * The operand is a single integer, float or duration, and an integer when the outcome holds a
 * `qti-match-table` (operator ruling `96840ced`, Q15 B). An operand that is untyped
 * ({@link expressionType}) is accepted. An outcome that is undeclared or holds no lookup table is
 * not judged against a table here: they are `undeclared-variable`'s refusal and
 * {@link lookupTableRequirements}'s. The qti package refuses the same as P22 (the `Lookup type`
 * law in `packages/pantry/src/qti/expressions.ts`).
 *
 * A target no declaration answers but the context's typer does (`typeUnanswered`: a test's
 * prefixed target, `I1.SCORE`, or any name in a section) still needs a single integer, float or
 * duration operand: `checkLookup`'s first branch judges the operand for every target, before it
 * reads any declaration. That refusal has no `table`, since the outcome's table is its item's, not
 * the test's to judge.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusal at the `qti-lookup-outcome-value`'s path when its operand's type is not one
 *   its table allows, or one no lookup reads; none for any other element.
 */
const lookupOperandType = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const name = Option.flatMap(attributeOf(visit.element, "identifier"), nameOf);
  if (
    !isQti(visit.element, (local) => local === "qti-lookup-outcome-value") ||
    Option.isNone(name) ||
    !inProcessing(context, visit.element)
  ) {
    return [];
  }

  const identifier = name.value;
  const declaration = context.outcomes.get(identifier);
  const table =
    declaration === undefined
      ? Option.map(context.typeUnanswered(identifier), () => Option.none<LookupTable>())
      : Option.map(lookupTableOf(declaration), Option.some);
  const operand = Option.flatMap(operandOf(visit.element), (expression) =>
    expressionType(expression, context),
  );
  if (Option.isNone(table) || Option.isNone(operand)) {
    return [];
  }

  const allowed = Option.match(table.value, {
    onNone: () => anyLookupOperand,
    onSome: (local) => lookupOperands[local],
  });

  return accepts(operand.value, allowed, ["single"])
    ? []
    : [
        refusal(source, "expression-type", visit.path, {
          element: visit.element.local,
          expressionBaseType: baseTypeText(operand.value),
          expressionCardinality: operand.value.cardinality,
          identifier,
          reading: "28",
          ...Option.match(table.value, {
            onNone: () => ({}),
            onSome: (local) => ({ table: local }),
          }),
        }),
      ];
};

/**
 * Apply `expression-type` with `check: "weight"` to a `qti-test-variables` of a test's outcome
 * processing that has a `weight-identifier` and a `base-type` other than `float`: the qti package
 * refuses it as P29 (the `Weighted base` law in `packages/pantry/src/qti/expressions.ts`), since a
 * weight's behaviour "is only defined if the base-type attribute is float or omitted", and the same
 * line rules out `base-type` integer (`info.txt:71457`; G-R3 199). One with no `base-type` is not
 * refused, and is a float (`testRules` in `#plate/model/expressions/test.ts`). A `base-type`
 * outside the vocabulary is the structural validator's refusal, so it is not judged here. It reads
 * the two attributes alone.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The test's declarations and the parents the walk has met.
 * @returns The refusal at the expression's path, with its `baseType`; none for any other element
 *   and for one outside outcome processing.
 */
const weightType = (source: SourceDocument, visit: Visit, context: Context): readonly Refusal[] => {
  if (
    !isQti(visit.element, (local) => local === "qti-test-variables") ||
    Option.isNone(attributeOf(visit.element, "weight-identifier")) ||
    !liesIn(context, visit.element, "outcome")
  ) {
    return [];
  }

  return Option.match(vocabularyValue(visit.element, "base-type", baseTypes), {
    onNone: () => [],
    onSome: (baseType) =>
      baseType === "float"
        ? []
        : [
            refusal(source, "expression-type", visit.path, {
              baseType,
              check: "weight",
              element: visit.element.local,
            }),
          ],
  });
};

/**
 * Apply reading 23's `expression-placement` to a `qti-variable` of an item that carries
 * `weight-identifier`. Weights are "defined only in the test context (and hence only in outcomes
 * processing)", so a weighted variable follows the outcome-only expressions (T-O10, pick A), and an
 * item, which holds no outcome processing, holds none: in its response processing, its template
 * processing or anywhere else. The qti package once refused the same as P12; no law in
 * `packages/pantry/src/qti/expressions.ts` names a `qti-variable`'s `weight-identifier` now, and no
 * reading states the refusal, so plate keeps it on the information model's sentence alone, a
 * question for the next readings batch. A test's and a section's are judged by
 * `expressionPlacement` in `#plate/validate/test-rules.ts`, with the same facts.
 *
 * @param source The item.
 * @param visit The element's visit.
 * @returns The refusal at the `weight-identifier`'s path, with the attribute, the element and the
 *   reading; none for any other element.
 */
const weightPlacement = (source: SourceDocument, visit: Visit): readonly Refusal[] => {
  const { element } = visit;
  if (!isQti(element, (local) => local === "qti-variable")) {
    return [];
  }

  return Option.match(attributeOf(element, "weight-identifier"), {
    onNone: () => [],
    onSome: (attribute) => [
      refusal(source, "expression-placement", attributePath(visit.path, attribute), {
        attribute: attribute.local,
        element: element.local,
        reading: "23",
      }),
    ],
  });
};

/**
 * Apply `expression-type` to the operands of an expression that lies in a processing ({@link
 * processings}): each operand its kind's rule does not accept (`operandsAccept` in the registry,
 * `kindRules` in `#plate/model/expressions/read.ts`), so the engine never meets an operand its
 * evaluator does not take. The qti package refuses the same as P23 (the `Operand fit` and `One
 * base` laws in `packages/pantry/src/qti/expressions.ts`, over `expressionTypings` in
 * `packages/pantry/src/grammar/expression.ts`).
 *
 * An untyped operand is judged as unknown ({@link untyped}), which every rule accepts, so a typed
 * sibling is still judged (ruling R3). Each refusal is at the expression's path, one per operand
 * the rule gives, with `check: "operand"`: the operand's position among the expression's child
 * elements, from 1, its type, and what the kind accepts there (`acceptsBaseTypes` is `any` for a
 * kind that takes any base type). `qti-equal`, whose operands are single integers or floats
 * (`info-compact.txt:11415`), is refused through comparison's rule.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns One refusal per operand of a type the kind does not accept; none for any other element.
 */
const operandTypes = (source: SourceDocument, visit: Visit, context: Context): readonly Refusal[] =>
  Option.match(kindOf(visit.element), {
    onNone: () => [],
    onSome: (kind) => {
      if (!inProcessing(context, visit.element)) {
        return [];
      }

      const types = operandsOf(visit.element).map((operand) =>
        Option.getOrElse(expressionType(operand, context), () => untyped),
      );

      return kindRules[kind].operandsAccept(types).map((mismatch) => {
        const type = types[mismatch.position - 1] ?? untyped;

        return refusal(source, "expression-type", visit.path, {
          acceptsBaseTypes: mismatch.baseTypes === "any" ? "any" : mismatch.baseTypes.join(" "),
          acceptsCardinalities: mismatch.cardinalities.join(" "),
          check: "operand",
          element: visit.element.local,
          expressionBaseType: baseTypeText(type),
          expressionCardinality: type.cardinality,
          operand: String(mismatch.position),
        });
      });
    },
  });

/**
 * Classify one value of a reference attribute as the literal or the reference it holds, through
 * the classifier of the base type its facet entry names (`#plate/model/expression.ts`), the one the
 * item model's reader uses too. An integer attribute's value is read as `xs:integer` first, so
 * `INF` and `NaN` name variables there (ruling R4); a float's as `xs:double` first; a string's is a
 * reference only when it is a braced name of a variable the item holds (ruling R1).
 */
const classifiers = {
  float: floatOrRefOf,
  integer: integerOrRefOf,
  string: stringOrRefOf,
} as const satisfies Record<
  ReferenceEntry["baseType"],
  (written: string, declared: ReadonlySet<string>) => LiteralOrRef<unknown>
>;

/**
 * Split a reference attribute's value into the values it holds: the tokens of a list, which XML
 * whitespace separates, or the one value as written.
 *
 * @param written The attribute's value.
 * @param entry The attribute's facet entry.
 * @returns Each value, as written.
 */
const valuesOf = (written: string, entry: ReferenceEntry): readonly string[] =>
  entry.list ? written.split(/[\t\n\r ]+/u).filter((token) => token !== "") : [written];

/**
 * Give the names a reference attribute's value may name, which a string's classifier reads: the
 * document's declared names and built-ins, and the name a value braces when no declaration and no
 * built-in answers it but the context's typer types it (`typeUnanswered`) other than `unknown`.
 *
 * That last is a test's prefixed read a package resolves (`{I1.N}`), which the qti package reads as
 * a reference (`referenceMembers` in `packages/pantry/src/grammar/references.ts`) and judges
 * through the variable it resolves to (the `Reference type` law in
 * `packages/pantry/src/qti/expressions.ts`, P24). A test checked alone types every prefixed read
 * `unknown`, and a section every name, so a braced name there stays literal text (ruling R1), as a
 * braced name no reading resolves (`{I9.X}`) does through a package; an item's typer answers
 * nothing.
 *
 * @param value One value of the attribute, as written.
 * @param declared The document's declared names and built-ins.
 * @param names The document's built-ins and the typer of a name nothing else answers.
 * @returns The names the value may name.
 */
const namableBy = (
  value: string,
  declared: ReadonlySet<string>,
  names: Names,
): ReadonlySet<string> => {
  const braced = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : "";
  const typed =
    braced !== "" &&
    !declared.has(braced) &&
    Option.exists(
      names.typeUnanswered(braced),
      (type) => type.baseType !== "unknown" || type.cardinality !== "unknown",
    );

  return typed ? new Set([...declared, braced]) : declared;
};

/**
 * Apply `undeclared-variable` and `expression-type` to the variables an expression's reference
 * attributes name, as its kind's reference facet lists them (`references` of its rule in the
 * registry). The qti package refuses the same as P8 and P24 (the `Variable declared` and
 * `Reference type` laws in `packages/pantry/src/qti/expressions.ts`).
 *
 * Each value of a checked entry's attribute goes through its classifier ({@link classifiers}); a
 * literal names no variable. A reference that no declaration of the item names and no built-in
 * answers is `undeclared-variable`, with the `attribute` (P8). One that names a variable other than
 * a single template or outcome variable of the entry's base type ({@link agree}) is
 * `expression-type` with `check: "reference"` (P24): a response, a context variable, a built-in,
 * or a template or outcome variable of another type. An entry that is not checked, `qti-equal`'s
 * `tolerance`, never refuses, and neither does a declaration whose own type is not judged. A
 * reference whose text is no NCName lies outside both members of the attribute's union, which is
 * the structural validator's refusal, so it is passed over here.
 *
 * A reference to the built-in `duration`, which no declaration answers, is P24 alone, whether the
 * item is time dependent or not: reading 150 ("an item's built-in `duration` may be read whether or
 * not the item is time dependent").
 *
 * In template processing a reference that names a variable template processing may not read, a
 * declared response or outcome or a built-in other than `QTI_CONTEXT` ({@link forbiddenRead}), is
 * `expression-type` with `check: "template-read"` and the `attribute` (P26), and nothing else,
 * never P24 as well. The qti package states the two as its `Template reads` and `Reference type`
 * laws, and names a refusal by its most specific law in one fixed order (`precedence` in
 * `packages/pantry/src/vocab/laws.ts`). `tolerance` is not a checked entry, so a `tolerance` that
 * names such a variable is not refused (OD-P8-20). A reference that names nothing, or a template
 * variable of another type, is refused as in response processing.
 *
 * In a test's processing a name its typer answers (`typeUnanswered`), which no declaration and no
 * built-in does, is a prefixed read: it is never `undeclared-variable`, and it is P24's when its
 * type does not agree with the entry's single base type, as the qti package's `Reference type` law
 * judges the variable it resolves to. A string attribute's braced name
 * is such a read only when the typer types it other than `unknown` ({@link namableBy}). In a
 * section on its own every name is typed `unknown`, so none is refused. A name nothing answers in a
 * test's processing, or in a section document a test reaches, carries `declarer: "test"`
 * ({@link declaredBy}), so its wording names the test rather than an item.
 *
 * It reads only the facet entries it is given, so it judges any kind whose rule declares them.
 *
 * @param source The document.
 * @param visit The expression's visit.
 * @param references The reference facet of the expression's kind.
 * @param declarations Every declaration of the document, by identifier.
 * @param processing The processing the expression lies in, response processing unless given.
 * @param names The document's built-ins, the typer of a name nothing else answers and the kind of
 *   document that declares the variables, an item's unless given.
 * @returns The refusals at the expression's path, one per value that names no variable, one of
 *   another kind or type, or one template processing may not read.
 */
export const referenceRefusals = (
  source: SourceDocument,
  visit: Visit,
  references: readonly ReferenceEntry[],
  declarations: ReadonlyMap<string, SourceElement>,
  processing: Processing = "response",
  names: Names = itemNames,
): readonly Refusal[] =>
  references.flatMap((entry) => {
    const written = attributeOf(visit.element, entry.attribute);
    if (!entry.checked || Option.isNone(written)) {
      return [];
    }

    const declared: ReadonlySet<string> = new Set([
      ...declarations.keys(),
      ...names.builtIns.keys(),
    ]);

    return valuesOf(written.value.value, entry).flatMap((value) => {
      const classified = classifiers[entry.baseType](value, namableBy(value, declared, names));
      if (classified._tag === "literal" || !isNcName(classified.identifier)) {
        return [];
      }

      const { identifier } = classified;
      const forbidden =
        processing === "template" ? forbiddenRead(identifier, declarations) : Option.none();
      if (Option.isSome(forbidden)) {
        return [
          templateReadRefusal(
            source,
            visit,
            identifier,
            forbidden.value,
            Option.some(entry.attribute),
          ),
        ];
      }

      const declaration = declarations.get(identifier);
      const unanswered =
        declaration === undefined && !names.builtIns.has(identifier)
          ? Option.some(names.typeUnanswered(identifier))
          : Option.none();
      if (Option.exists(unanswered, Option.isNone)) {
        return [
          refusal(
            source,
            "undeclared-variable",
            visit.path,
            declaredBy(
              {
                attribute: entry.attribute,
                element: visit.element.local,
                expected: "variable",
                identifier,
              },
              names.declarer,
            ),
          ),
        ];
      }

      const fits = Option.match(Option.flatten(unanswered), {
        onNone: () =>
          declaration !== undefined &&
          isQti(
            declaration,
            (local) => local === "qti-template-declaration" || local === "qti-outcome-declaration",
          ) &&
          !Option.exists(
            declarationType(declaration),
            (type) => !agree(type, singleOf(entry.baseType)),
          ),
        onSome: (type) => agree(type, singleOf(entry.baseType)),
      });

      return fits
        ? []
        : [
            refusal(source, "expression-type", visit.path, {
              attribute: entry.attribute,
              check: "reference",
              element: visit.element.local,
              expectedBaseType: entry.baseType,
              identifier,
            }),
          ];
    });
  });

/**
 * Apply {@link referenceRefusals} to an expression that lies in a processing ({@link processings}),
 * with its kind's reference facet from the registry, the processing it lies in and the context's
 * built-ins and typer.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The document's declarations and the parents the walk has met.
 * @returns The refusals of the variables its reference attributes name; none for any other
 * element.
 */
const attributeReferences = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] =>
  Option.match(Option.all([kindOf(visit.element), processingOf(context, visit.element)]), {
    onNone: () => [],
    onSome: ([kind, processing]) =>
      referenceRefusals(
        source,
        visit,
        kindRules[kind].references,
        context.variables,
        processing,
        context,
      ),
  });

/**
 * The line of QTI's information model that names what a printed variable's `identifier` may name:
 * "The outcome variable or template variable must have been defined. The values of response
 * variables cannot be printed directly [...]".
 */
const printedSource = "info.txt:70296";

/**
 * The kinds of variable a printed variable names that each kind of document declares, as an
 * `undeclared-variable` refusal's `expected` lists them: an item declares outcomes and template
 * variables, and a test declares outcomes and no template variable.
 */
const printedKinds: Readonly<Record<VariableScope["declarer"], string>> = {
  item: "outcome template",
  test: "outcome",
};

/**
 * The kind of variable a printed variable or a `template-identifier` may name or be refused for
 * naming.
 */
export type NamedKind = "context" | "outcome" | "response" | "template";

/**
 * The variable a printed variable's attribute or a `template-identifier` names: its kind, and its
 * type unless its declaration's type is not judged ({@link declarationType}).
 */
export interface NamedVariable {
  readonly kind: NamedKind;
  readonly type: Option.Option<ExpressionType>;
}

/**
 * The variables a name that a printed variable or a `template-identifier` gives resolves against in
 * one document: those it declares, those built into it, and which kind of document it is.
 */
export interface VariableScope {
  /**
   * Each variable the document declares implicitly, by name, with its kind and type. A name a
   * built-in answers counts as declared (`info.txt:8440`).
   */
  readonly builtIns: ReadonlyMap<string, NamedVariable>;
  /**
   * The kind of document that declares the variables, which an `undeclared-variable` refusal's
   * wording names: an item, or a test, which declares outcomes and context variables and no
   * template or response variable.
   */
  readonly declarer: "item" | "test";
  /**
   * Each declaration of the document, by identifier.
   */
  readonly variables: ReadonlyMap<string, SourceElement>;
}

/**
 * Find the variable a name a printed variable or a `template-identifier` gives names: a declaration
 * of the document, or else one of its built-ins, which counts as declared (Mind amendment 1 to
 * `p8-06e`, from `info.txt:8440`). A declaration wins over a built-in of the same name, as
 * {@link variableType} finds one; the structural walk refuses such a declaration.
 *
 * @param identifier The name.
 * @param scope The document's declarations and built-ins.
 * @returns The variable's kind and type; none when neither a declaration nor a built-in answers.
 */
const namedVariable = (identifier: string, scope: VariableScope): Option.Option<NamedVariable> => {
  const declaration = scope.variables.get(identifier);
  if (declaration !== undefined) {
    return Option.map(
      Option.fromUndefinedOr(declarationKinds.get(declaration.local)),
      (kind): NamedVariable => ({ kind, type: declarationType(declaration) }),
    );
  }

  return Option.fromUndefinedOr(scope.builtIns.get(identifier));
};

/**
 * Report whether a kind of variable is one a printed variable prints: a template or an outcome.
 *
 * @param kind The kind.
 * @returns Whether it is `template` or `outcome`.
 */
const printable = (kind: NamedKind): boolean => kind === "template" || kind === "outcome";

/**
 * Construct the `undeclared-variable` refusal of a name a printed variable's attribute gives that
 * nothing declares or builds in. Its `expected` lists the kinds the document declares that a
 * printed variable prints ({@link printedKinds}); a test's refusal also carries `declarer: "test"`
 * ({@link declaredBy}), so its wording names the test rather than an item.
 *
 * @param source The document.
 * @param path The attribute's path.
 * @param attribute The attribute's local name.
 * @param identifier The name.
 * @param declarer The kind of document whose declarations the name was looked up in.
 * @returns The refusal, at the attribute's path.
 */
const printedUndeclared = (
  source: SourceDocument,
  path: string,
  attribute: string,
  identifier: string,
  declarer: VariableScope["declarer"],
): Refusal =>
  refusal(
    source,
    "undeclared-variable",
    path,
    declaredBy(
      { attribute, element: "qti-printed-variable", expected: printedKinds[declarer], identifier },
      declarer,
    ),
  );

/**
 * Judge what a printed variable's `identifier` names: an outcome or a template variable of any
 * type, which the document declares or builds in (an item's `completionStatus`).
 *
 * @param source The document.
 * @param path The `identifier` attribute's path.
 * @param identifier The name, as {@link identifierOf} reads it.
 * @param scope The document's declarations and built-ins.
 * @returns The refusal when nothing answers the name, or a response or a context variable does,
 *   declared or built in; none otherwise.
 */
const printedIdentifier = (
  source: SourceDocument,
  path: string,
  identifier: string,
  scope: VariableScope,
): readonly Refusal[] =>
  Option.match(namedVariable(identifier, scope), {
    onNone: () => [printedUndeclared(source, path, "identifier", identifier, scope.declarer)],
    onSome: ({ kind }) =>
      printable(kind)
        ? []
        : [
            refusal(
              source,
              "expression-type",
              path,
              declaredBy(
                {
                  attribute: "identifier",
                  check: "reference",
                  element: "qti-printed-variable",
                  identifier,
                  source: printedSource,
                  variableKind: kind,
                },
                scope.declarer,
              ),
            ),
          ],
  });

/**
 * Judge what a printed variable's `base` or `index` names when it is written as a name: a single
 * integer outcome or template variable, which the document declares or builds in. A built-in
 * follows the same rule, so an item's `numAttempts`, a response, is refused by its kind and its
 * `completionStatus`, a single identifier, by its type. One written as an integer names no
 * variable, and one whose text is no NCName is the structural validator's refusal; both are passed
 * over. The value is classified as the item model classifies an integer attribute
 * ({@link integerOrRefOf}).
 *
 * @param source The document.
 * @param path The attribute's path.
 * @param attribute The attribute.
 * @param scope The document's declarations and built-ins.
 * @returns The refusal when nothing answers the name, or it names a variable that is not a single
 *   integer outcome or template variable; none otherwise.
 */
const printedInteger = (
  source: SourceDocument,
  path: string,
  attribute: SourceAttribute,
  scope: VariableScope,
): readonly Refusal[] => {
  const classified = integerOrRefOf(attribute.value);
  if (classified._tag === "literal" || !isNcName(classified.identifier)) {
    return [];
  }

  const { identifier } = classified;

  return Option.match(namedVariable(identifier, scope), {
    onNone: () => [printedUndeclared(source, path, attribute.local, identifier, scope.declarer)],
    onSome: ({ kind, type }) =>
      printable(kind) && !Option.exists(type, (known) => !agree(known, singleOf("integer")))
        ? []
        : [
            refusal(
              source,
              "expression-type",
              path,
              declaredBy(
                {
                  attribute: attribute.local,
                  check: "reference",
                  element: "qti-printed-variable",
                  expectedBaseType: "integer",
                  identifier,
                },
                scope.declarer,
              ),
            ),
          ],
  });
};

/**
 * Apply `undeclared-variable` and `expression-type` to the variables a `qti-printed-variable` of an
 * item or a test names, as the qti package refuses them as `printed-variable-ref` (its `Printed
 * variable reference` law in `packages/pantry/src/qti/interactions.ts`, over `PrintedVariableRef`,
 * which binds the printed variables of an item and of a test).
 *
 * Its `identifier` names an outcome or a template variable of any type: "The outcome variable or
 * template variable must have been defined. The values of response variables cannot be printed
 * directly" (`info.txt:70296`). Its `base` and `index`, each an `IntegerOrVariableRef`, name a
 * single integer outcome or template variable when written as a name. A built-in of the document
 * counts as declared, since it is declared implicitly (`info.txt:8440`), and has its kind: in an
 * item ({@link builtInKinds}) `completionStatus` may be printed, and `numAttempts`, `duration` and
 * `QTI_CONTEXT` are refused by kind (Mind amendment 1). A printed `completionStatus` is reading
 * 77's ("a feedback element names an outcome variable, and a printed variable an outcome or a
 * template variable, the built-in `completionStatus` among them"), which the qti package now
 * accepts too. A name that nothing declares or builds in is `undeclared-variable` with
 * the `attribute` and, as `expected`, the kinds the document declares that a printed variable
 * prints. A name of another kind or type is `expression-type` with `check: "reference"`: for
 * `identifier`, a response or a context variable, with its `variableKind` and the information
 * model's line as `source`, since any type may be printed; for `base` and `index`, anything but a
 * single integer outcome or template variable, with `expectedBaseType` as P24 words it. A
 * declaration whose own type is not judged ({@link declarationType}) is not refused. Each refusal
 * is at the attribute's path, and a test's carries `declarer: "test"` ({@link declaredBy}).
 *
 * A printed variable anywhere in the document is judged: in an item's body, a feedback or a rubric
 * block alike, through {@link checkRules}, and in a test's rubric blocks and test feedback, through
 * `checkTestRules`, against the test's declarations. A section's or a stimulus's is not, since
 * neither declares the variables it prints. A missing `identifier` is the structural validator's
 * `missing-attribute`, and one whose text is no NCName its refusal too, so both are passed over.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param scope The document's declarations and built-ins.
 * @returns The refusals of its `identifier`, `base` and `index`, in that order; none for any other
 *   element.
 */
export const printedVariableReferences = (
  source: SourceDocument,
  visit: Visit,
  scope: VariableScope,
): readonly Refusal[] => {
  if (!isQti(visit.element, (local) => local === "qti-printed-variable")) {
    return [];
  }

  const identifier = Option.filter(
    Option.map(attributeOf(visit.element, "identifier"), (written) => ({
      name: identifierOf(written),
      written,
    })),
    ({ name }) => isNcName(name),
  );

  return [
    ...Option.match(identifier, {
      onNone: () => [],
      onSome: ({ name, written }) =>
        printedIdentifier(source, attributePath(visit.path, written), name, scope),
    }),
    ...(["base", "index"] as const).flatMap((local) =>
      Option.match(attributeOf(visit.element, local), {
        onNone: () => [],
        onSome: (written) =>
          printedInteger(source, attributePath(visit.path, written), written, scope),
      }),
    ),
  ];
};

/**
 * An item's feedback elements, each of which names in its `outcome-identifier` the outcome whose
 * value shows or hides it.
 */
const itemFeedback: ReadonlySet<string> = new Set([
  "qti-feedback-block",
  "qti-feedback-inline",
  "qti-modal-feedback",
]);

/**
 * Apply reading 77 to an item's feedback element ({@link itemFeedback}, E3a): its
 * `outcome-identifier` is "The identifier of an outcome variable that must have a base-type of
 * identifier and be of either single or multiple cardinality", as a test's `qti-test-feedback`'s
 * is (`feedbackOutcome` in `#plate/validate/test-rules.ts`).
 *
 * A name no outcome of the item answers is `undeclared-variable`, expecting an outcome: one the
 * item declares nothing for, and one a response, a template or a context variable answers, the
 * built-ins `numAttempts`, `duration` and `QTI_CONTEXT` among them. The built-in outcome
 * `completionStatus`, a single identifier, is named as an item's outcome is ({@link variableType}).
 * An outcome of another cardinality, or whose base type is not `identifier`, is `expression-type`
 * with `check: "feedback-outcome"`, its `baseType` (empty where it has none, as a record has none)
 * and `cardinality`; one whose `base-type` spells nothing is judged by its cardinality alone
 * (reading 159). An outcome whose type is not judged ({@link declarationType}), and an
 * `outcome-identifier` that names nothing ({@link nameOf}), are the structural validator's.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The item's declarations and built-ins.
 * @returns The refusal at the `outcome-identifier` attribute's path; none for any other element.
 */
const feedbackOutcome = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const written = attributeOf(visit.element, "outcome-identifier");
  const name = written.pipe(Option.flatMap(nameOf));
  if (
    !isQti(visit.element, (local) => itemFeedback.has(local)) ||
    Option.isNone(written) ||
    Option.isNone(name)
  ) {
    return [];
  }

  const identifier = name.value;
  const element = visit.element.local;
  const path = attributePath(visit.path, written.value);

  return Option.match(variableType({ expected: "outcome", identifier }, context), {
    onNone: () => [
      refusal(source, "undeclared-variable", path, {
        attribute: "outcome-identifier",
        element,
        expected: "outcome",
        identifier,
        reading: "77",
      }),
    ],
    onSome: (type) =>
      Option.toArray(
        type.pipe(
          Option.filter(
            ({ baseType, cardinality }) =>
              (cardinality !== "single" && cardinality !== "multiple") ||
              (baseType !== "identifier" && baseType !== "unknown"),
          ),
          Option.map(({ baseType, cardinality }) =>
            refusal(source, "expression-type", path, {
              baseType: baseType === "unknown" ? "" : baseType,
              cardinality,
              check: "feedback-outcome",
              element,
              identifier,
              reading: "77",
            }),
          ),
        ),
      ),
  });
};

/**
 * The elements of an item that carry a `template-identifier`, each with the line of QTI's
 * information model that types it: "The identifier of a template variable that must have a
 * base-type of identifier and be of either single or multiple cardinality" (`qti-simple-choice`'s
 * line words it "be either single of multiple"). A `qti-template-block` or `qti-template-inline` in
 * a rubric block cites the same line as one in the body, which its rubric variant repeats
 * (`info.txt:40339`, `:40743`). `qti-template-default` and `qti-template-variable` also carry one,
 * but only in a test, which these rules do not judge.
 */
const templateIdentifierSources: ReadonlyMap<string, string> = new Map([
  ["qti-associable-hotspot", "info.txt:15278"],
  ["qti-gap", "info.txt:26939"],
  ["qti-gap-img", "info.txt:27259"],
  ["qti-gap-text", "info.txt:28161"],
  ["qti-hotspot-choice", "info.txt:30639"],
  ["qti-hottext", "info.txt:30039"],
  ["qti-inline-choice", "info.txt:31973"],
  ["qti-simple-associable-choice", "info.txt:42077"],
  ["qti-simple-choice", "info.txt:42466"],
  ["qti-template-block", "info.txt:45053"],
  ["qti-template-inline", "info.txt:46462"],
]);

/**
 * Report whether a variable is one a `template-identifier` may name: a template variable of base
 * type identifier and of single or multiple cardinality. A declaration whose own type is not judged
 * ({@link declarationType}) is not refused; one with no base type of its own, such as a record, is.
 *
 * @param variable The variable the name names.
 * @returns Whether it is a template variable that is not of another type.
 */
const controlsVisibility = ({ kind, type }: NamedVariable): boolean =>
  kind === "template" &&
  Option.match(type, {
    onNone: () => true,
    onSome: ({ baseType, cardinality }) =>
      baseType === "identifier" && (cardinality === "single" || cardinality === "multiple"),
  });

/**
 * Apply `undeclared-variable` and `expression-type` to the variable an item's element names in its
 * `template-identifier`, as the qti package refuses it as `template-ref`: R36's
 * `TemplateContentRefType` for a template block or inline, in a rubric block too, and
 * `ChoiceTemplateRefType` for a choice, now its `Template reference` law in
 * `packages/pantry/src/qti/interactions.ts`, over every choice's `template-identifier`.
 *
 * The variable must be a template variable "that must have a base-type of identifier and be of
 * either single or multiple cardinality" (`info.txt:45053`, and each element's line in
 * {@link templateIdentifierSources}). Every element that carries one is judged, whether or not plate
 * renders it, in the body, a feedback or a rubric block alike (audit B A5). A `qti-simple-choice`'s
 * is judged too, as the information model types it as it types the rest (`info.txt:42466`): plate
 * refuses it because the standard does (OD-P8-19, rule `5b8ee08b`), and the qti package now refuses
 * it too (its `Template reference` law in `packages/pantry/src/qti/interactions.ts`).
 *
 * A name that nothing declares or builds in is `undeclared-variable` with `expected: "template"`
 * (OD-P8-11; the qti package's `binding-declared`). A built-in counts as declared, as for a printed
 * variable ({@link namedVariable}), so it is refused by its kind. A name of another kind, or a
 * template variable of another type, is `expression-type` with `check: "reference"`, the
 * `expectedBaseType` `identifier`, the `expectedCardinalities` `single multiple`, which select the
 * verdict's sentence for this check, and the element's line as `source`. Each refusal is at the
 * attribute's path. A missing `template-identifier`, or one whose text is no NCName, is the
 * structural validator's refusal and is passed over; a test's or a stimulus's element is not
 * judged, since {@link checkRules} judges only an item.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param context The item's declarations.
 * @returns The refusal of its `template-identifier`; none for an element that carries none, and for
 *   one naming an identifier template variable, single or multiple.
 */
const templateIdentifierReference = (
  source: SourceDocument,
  visit: Visit,
  context: Context,
): readonly Refusal[] => {
  const line = qtiEntry(templateIdentifierSources, visit.element);
  const written = Option.filter(attributeOf(visit.element, "template-identifier"), (attribute) =>
    isNcName(identifierOf(attribute)),
  );

  return Option.match(Option.all([line, written]), {
    onNone: () => [],
    onSome: ([cited, attribute]) => {
      const identifier = identifierOf(attribute);
      const path = attributePath(visit.path, attribute);
      const facts = { attribute: "template-identifier", element: visit.element.local, identifier };

      return Option.match(namedVariable(identifier, context), {
        onNone: () => [
          refusal(source, "undeclared-variable", path, { ...facts, expected: "template" }),
        ],
        onSome: (variable) =>
          controlsVisibility(variable)
            ? []
            : [
                refusal(source, "expression-type", path, {
                  ...facts,
                  check: "reference",
                  expectedBaseType: "identifier",
                  expectedCardinalities: "single multiple",
                  source: cited,
                }),
              ],
      });
    },
  });
};

/**
 * The declarations whose variables a `qti-variable` may read. Where two share an identifier, the
 * later kind here wins; the duplicate is `duplicate-identifier`'s refusal.
 */
const variableDeclarations = [
  "qti-context-declaration",
  "qti-template-declaration",
  "qti-outcome-declaration",
  "qti-response-declaration",
] as const;

/**
 * List the elements the prose rules judge, in document order: exactly those the structural walk
 * checks, the keys of {@link governingTables}.
 *
 * One admission decides for both stages, so the rules never refuse what the walk does not check,
 * nor skip what it does. An element outside QTI's namespace is not judged, nor anything below it
 * that the walk does not reach, nor an element the walk refuses as unknown. In lax wildcard content
 * (rule `5b8ee08b`) the rules judge what the walk checks there, a global QTI element and what its
 * table admits below it, and not what the walk passes over: a nested QTI root (reading 6) or a QTI
 * element the XSD declares only locally, such as a `qti-choice-interaction` directly inside a
 * `qti-custom-interaction`.
 *
 * @param source The document.
 * @param tables The tables generated from the QTI XSD, the ones the structural walk checks it by.
 * @returns Each element the rules judge, with the path and the parent `walk` gives it.
 */
export const judgedVisits = (source: SourceDocument, tables: Tables): readonly Visit[] => {
  const governing = governingTables(source, tables);

  return [...walk(source)].filter((visit) => governing.has(visit.element));
};

/**
 * Report whether a judged element holds an unexpanded entity reference where a rule may read it:
 * in an attribute's value or among its children, wildcard content included. Every prose rule of a
 * document judges nothing when one of its judged elements does: the item rules here, the test
 * rules (`#plate/validate/test-rules.ts`), the catalog rules (`#plate/validate/catalog.ts`) and the
 * stimulus rules of the verdict, which leaves such a document unchecked unless the structural walk
 * refuses it.
 *
 * @param element The element.
 * @returns Whether its attributes or its children hold a reference whose value is unknown.
 */
export const holdsUnexpanded = (element: SourceElement): boolean =>
  element.attributes.some((attribute) => attribute.references.length > 0) ||
  element.children.some((child) => child.kind === "entity");

/**
 * Collect the responses whose correct response the item's template processing sets.
 *
 * Each `qti-set-correct-response` counts wherever it sits in the root's `qti-template-processing`,
 * among its rules or in a `qti-template-condition`'s branch, because the engine does not run
 * template processing and so cannot tell which branch would set it. Only the elements the rules
 * judge count, as everywhere in these rules.
 *
 * @param source The document.
 * @param visits The elements the rules judge, in document order, so each parent comes before its
 *   children.
 * @returns The identifier each such `qti-set-correct-response` names, read as {@link identifierOf}
 *   reads it.
 */
const setCorrectResponses = (
  source: SourceDocument,
  visits: readonly Visit[],
): ReadonlySet<string> => {
  const inTemplateProcessing = new Set<SourceElement>();
  const responses = new Set<string>();
  for (const visit of visits) {
    const entered = Option.exists(visit.parent, (parent) =>
      parent === source.root
        ? isQti(visit.element, (local) => local === "qti-template-processing")
        : inTemplateProcessing.has(parent),
    );
    if (entered) {
      inTemplateProcessing.add(visit.element);

      const identifier = attributeOf(visit.element, "identifier");
      if (
        isQti(visit.element, (local) => local === "qti-set-correct-response") &&
        Option.isSome(identifier)
      ) {
        responses.add(identifierOf(identifier.value));
      }
    }
  }

  return responses;
};

/**
 * The ASI types whose `label` characteristic states the sentence "If an item uses labels then
 * values for the associated toolName and toolVersion characteristics must also be provided", in
 * both information models (reading 128): BasePromptInteraction's (section 5.15.5), the six of the
 * BaseSequence family's (sections 5.16.5 to 5.21.5) and ItemBody's (section 5.79.4). The other
 * types that declare a `label` describe it as text for a reader and ask for nothing: the item's
 * and the stimulus's own, ItemFileInfo's (a `qti-digital-material`'s or a `qti-calculator-info`'s)
 * and PrintedVariable's. A QTI 3.0.1 item root's own `label` is `checkVersion`'s (E31b).
 */
const toolLabelTypes: ReadonlySet<string> = new Set([
  "BasePromptInteractionDType",
  "BaseSequenceDType",
  "BaseSequenceEmptyDType",
  "BaseSequenceFullDType",
  "BaseSequenceRIdentDType",
  "BaseSequenceXBaseDType",
  "BaseSequenceXBaseEmptyDType",
  "ItemBodyDType",
]);

/**
 * Report whether a named type is one of {@link toolLabelTypes} or derives from one, by extension or
 * restriction, through the tables' named types.
 *
 * @param tables The tables generated from the QTI XSD.
 * @param type The type, as an element's table names it.
 * @returns Whether its derivation chain reaches a type whose `label` asks for its tool.
 */
const derivesToolLabel = (tables: Tables, type: ChildName): boolean => {
  const climbed = new Set<string>();
  let current = Option.some(type);
  while (
    Option.isSome(current) &&
    current.value.namespace === qtiNamespace &&
    !climbed.has(current.value.local)
  ) {
    const { local } = current.value;
    if (toolLabelTypes.has(local)) {
      return true;
    }

    climbed.add(local);
    current = Option.flatMap(Option.fromUndefinedOr(tables.types[local]), (entry) =>
      entry.derivation === "union" ? Option.none() : Option.some(entry.base),
    );
  }

  return false;
};

/**
 * Report whether an element's `label` asks for the tool that labelled it (reading 128): its kind's
 * declared type is one of {@link toolLabelTypes} or derives from one. A type an `xsi:type` names is
 * validly derived from the declared type, so it asks for the same. The kinds this gives are exactly
 * those whose `label` the XSD declares inside one of those types: the body's HTML elements, the
 * interactions, their choices and prompts, the feedback, template and rubric blocks and the item
 * body itself.
 *
 * @param tables The tables generated from the QTI XSD.
 * @param element The element.
 * @returns Whether it is a QTI element of such a kind.
 */
const asksForTool = (tables: Tables, element: SourceElement): boolean =>
  element.namespace === qtiNamespace &&
  Option.exists(Option.fromUndefinedOr(tables.elements[element.local]), (table) =>
    table.types.some((type) => derivesToolLabel(tables, type)),
  );

/**
 * Apply `missing-attribute` with `check: "label-tool"` to an item that labels a body element
 * (reading 128, E31a): an item one of whose elements carries a `label` its kind's characteristic
 * asks a tool for ({@link asksForTool}) carries both `tool-name` and `tool-version` on its root, in
 * either version. One refusal per item, at its root, naming the first such element in document
 * order; `checkVersion`'s E31b adds none beside it for a QTI 3.0.1 root's own `label`.
 *
 * @param source The document, an item.
 * @param visits The elements the rules judge, in document order.
 * @param tables The tables generated from the QTI XSD.
 * @returns The one refusal at the root, listing the missing tool attributes space-separated and the
 *   labelled element's path as `labelled`; none when the root carries both or nothing is labelled.
 */
const labelTool = (
  source: SourceDocument,
  visits: readonly Visit[],
  tables: Tables,
): readonly Refusal[] => {
  const { root } = source;
  const missing = missingToolAttributes(root);
  if (missing.length === 0) {
    return [];
  }

  return Option.toArray(
    Option.map(
      Arr.findFirst(
        visits,
        ({ element }) =>
          Option.isSome(attributeOf(element, "label")) && asksForTool(tables, element),
      ),
      ({ path }) =>
        refusal(source, "missing-attribute", root.local, {
          attribute: missing.join(" "),
          check: "label-tool",
          element: root.local,
          labelled: path,
          reading: "128",
        }),
    ),
  );
};

/**
 * Where each element of a document sits, as the body content rules read it: whether a template
 * block holds it, the table it takes part in, and its place among its parent's children.
 */
export interface Placing {
  /**
   * The ids of the `th`s that take part in each table, each collapsed.
   */
  readonly headerIds: ReadonlyMap<SourceElement, ReadonlySet<string>>;
  /**
   * Each element's index among its parent's children, every child node counted: a text, an entity
   * reference or an element, as {@link edgeCharacter} reads a neighbour. Every element but the root
   * has one.
   */
  readonly positions: ReadonlyMap<SourceElement, number>;
  /**
   * The nearest `table` each element lies in, for those a table holds.
   */
  readonly tableOf: ReadonlyMap<SourceElement, SourceElement>;
  /**
   * The elements a `qti-template-block` holds at any depth.
   */
  readonly templated: ReadonlySet<SourceElement>;
}

/**
 * Find where each element of a document sits ({@link Placing}), over every element the document
 * holds, so an ancestor the rules do not judge still places what it holds. Each element's children
 * are read once, as the walk reaches it, so a rule that reads an element's neighbour takes it by
 * position: a search of the parent's children per element grows as the square of its siblings.
 *
 * @param source The document.
 * @returns Its placing.
 */
export const placingOf = (source: SourceDocument): Placing => {
  const headerIds = new Map<SourceElement, Set<string>>();
  const positions = new Map<SourceElement, number>();
  const tableOf = new Map<SourceElement, SourceElement>();
  const templated = new Set<SourceElement>();
  for (const { element, parent } of walk(source)) {
    for (const [index, child] of element.children.entries()) {
      if (child.kind === "element") {
        positions.set(child, index);
      }
    }

    if (Option.isSome(parent)) {
      const holder = parent.value;
      if (templated.has(holder) || isQti(holder, (local) => local === "qti-template-block")) {
        templated.add(element);
      }

      const table = isQti(holder, (local) => local === "table") ? holder : tableOf.get(holder);
      if (table !== undefined) {
        tableOf.set(element, table);

        const id = attributeOf(element, "id");
        if (isQti(element, (local) => local === "th") && Option.isSome(id)) {
          const ids = headerIds.get(table) ?? new Set<string>();
          ids.add(identifierOf(id.value));
          headerIds.set(table, ids);
        }
      }
    }
  }

  return { headerIds, positions, tableOf, templated };
};

/**
 * Apply `misplaced-element` to an interaction a `qti-template-block` holds at any depth (reading
 * 143, E37): "A qti-template-block must not contain any interactions, either directly or
 * indirectly" (section 5.145), which is stricter than the XSD, whose content body reaches the
 * interactions. A template inline's HTML may hold the four inline interactions, which this does not
 * judge.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param placing Where the document's elements sit.
 * @returns The refusal at the interaction's path; none for any other element.
 */
const templateBlockInteraction = (
  source: SourceDocument,
  visit: Visit,
  placing: Placing,
): readonly Refusal[] =>
  isInteraction(visit.element) && placing.templated.has(visit.element)
    ? [
        refusal(source, "misplaced-element", visit.path, {
          element: visit.element.local,
          reading: "143",
          requires: "outside a qti-template-block",
        }),
      ]
    : [];

/**
 * Apply `attribute-type` with `check: "headers"` to a `td`'s or a `th`'s `headers` (reading 126,
 * E29): each token is the `id` of a `th` of the cell's own table, its nearest, compared
 * case-sensitively with the `id` collapsed, and no token is written twice. A cell no table holds
 * takes part in none, so every token it writes is refused. A token outside the NCName's lexical
 * space names nothing and is its value domain's alone (reading 152).
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param placing Where the document's elements sit.
 * @returns One refusal at the `headers` attribute's path, naming the first token at fault; none
 *   when every token names a header of the cell's table once, and for any other element.
 */
export const tableHeaders = (
  source: SourceDocument,
  visit: Visit,
  placing: Placing,
): readonly Refusal[] => {
  const attribute = attributeOf(visit.element, "headers");
  if (
    !isQti(visit.element, (local) => local === "td" || local === "th") ||
    Option.isNone(attribute)
  ) {
    return [];
  }

  const table = placing.tableOf.get(visit.element);
  const held = table === undefined ? undefined : placing.headerIds.get(table);
  const written = new Set<string>();
  for (const token of attribute.value.value.split(/[\t\n\r ]+/u).filter(isNcName)) {
    if (written.has(token) || held?.has(token) !== true) {
      return [
        refusal(source, "attribute-type", attributePath(visit.path, attribute.value), {
          attribute: attribute.value.local,
          check: "headers",
          element: visit.element.local,
          reading: "126",
          token,
          value: attribute.value.value,
        }),
      ];
    }

    written.add(token);
  }

  return [];
};

/**
 * The quotation punctuation of reading 127: the double quote, the curly and low quotes but the
 * right single quotation mark `’`, and the guillemets. The ASCII apostrophe and `’` are left out,
 * each an apostrophe as often as a quote, so a `’` that does close a quote around a `q` is not
 * refused, the reading's known under-refusal.
 */
const quotationMarks: ReadonlySet<string> = new Set([
  '"',
  "«",
  "»",
  "‘",
  "‚",
  "‛",
  "“",
  "”",
  "„",
  "‟",
  "‹",
  "›",
]);

/**
 * Read the character at one edge of a neighbour of a `q`, where the neighbour holds characters: a
 * text. An element or an absent neighbour holds none.
 *
 * @param child The neighbour, or none at the edge of its parent.
 * @param edge Which edge: the first character, or the last.
 * @returns The character, none for a neighbour that is no text or holds none.
 */
const edgeCharacter = (
  child: SourceChild | undefined,
  edge: "first" | "last",
): Option.Option<string> =>
  child?.kind === "text"
    ? Option.fromUndefinedOr(edge === "first" ? child.text.at(0) : child.text.at(-1))
    : Option.none();

/**
 * Apply `text-not-allowed` with `check: "quotation"` to a `q` (reading 127, E30): "Quotation
 * punctuation (such as quotation marks) that is quoting the contents of the tag must not appear
 * immediately before, after, or inside q tags" (section 5.111). Four characters are read, each
 * alone: the last of the text before the `q`, the first of the text after it, and the first and
 * the last of its own content; a mark inside its content but at neither end quotes nothing. A
 * neighbour that is no text, an element or the parent's edge, holds no character, and a space keeps
 * a mark from standing immediately beside the `q`. The reader substitutes a predefined entity, so
 * `&quot;` is read as `"`.
 *
 * Plate's limit (rule `db2ef322`): the reader drops comments and processing instructions from the
 * source view (`#plate/document/read.ts`), so one between a mark and a `q`, which the reading says
 * keeps the mark from standing beside it, is not seen, and that mark is refused.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param placing Where the document's elements sit, the `q`'s position among its siblings read
 *   from it.
 * @returns One refusal at the `q`, naming the first mark found and the `side` it stands on, in the
 *   order before, after, start and end; none for any other element.
 */
export const quotation = (
  source: SourceDocument,
  visit: Visit,
  placing: Placing,
): readonly Refusal[] => {
  const at = placing.positions.get(visit.element);
  if (
    !isQti(visit.element, (local) => local === "q") ||
    Option.isNone(visit.parent) ||
    at === undefined
  ) {
    return [];
  }

  const siblings = visit.parent.value.children;
  const own = visit.element.children;
  const sides = [
    ["before", at > 0 ? edgeCharacter(siblings[at - 1], "last") : Option.none()],
    ["after", edgeCharacter(siblings[at + 1], "first")],
    ["start", edgeCharacter(own.at(0), "first")],
    ["end", edgeCharacter(own.at(-1), "last")],
  ] as const;

  return sides
    .flatMap(([side, character]) =>
      Option.toArray(character.pipe(Option.filter((mark) => quotationMarks.has(mark)))).map(
        (mark) =>
          refusal(source, "text-not-allowed", visit.path, {
            check: "quotation",
            element: visit.element.local,
            mark,
            reading: "127",
            side,
          }),
      ),
    )
    .slice(0, 1);
};

/**
 * Report whether an element's kind declares `data-ssml`: a QTI element whose name's table holds the
 * attribute in no namespace. The XSD declares it on exactly the 45 elements the Data-SSML binding
 * lists (§5), a rubric block among them; on any other, only an attribute wildcard admits a
 * `data-ssml`, laxly and unchecked, so nothing the standard states makes its value Data-SSML and it
 * is not refused (rule `5b8ee08b`).
 *
 * @param tables The tables generated from the QTI XSD.
 * @param element The element.
 * @returns Whether its kind declares `data-ssml`.
 */
const declaresDataSsml = (tables: Tables, element: SourceElement): boolean =>
  element.namespace === qtiNamespace &&
  Option.exists(Option.fromUndefinedOr(tables.elements[element.local]), (table) =>
    table.attributes.some(
      (attribute) => attribute.namespace === "" && attribute.local === "data-ssml",
    ),
  );

/**
 * Apply `attribute-type` with `check: "data-ssml"` to a `data-ssml` value that is not Data-SSML
 * JSON (the operator's P3), where the element's kind declares the attribute
 * ({@link declaresDataSsml}): the value, with its entities replaced, decodes as the Data-SSML
 * binding's JSON ({@link decodeDataSsml}). The XSD types it `xs:string`, so the binding alone
 * judges it. A value that decodes keeps the `data-ssml` feature mark every body element carrying
 * the attribute gets (`#plate/vocabulary.ts`).
 *
 * It judges every document by the same decoder, with the same refusal: an item's elements here, a
 * test's and a section's rubric blocks and test feedback through `checkTestRules` in
 * `#plate/validate/test-rules.ts`, and a stimulus's body through the verdict's own stimulus rules.
 *
 * @param source The document.
 * @param visit The element's visit.
 * @param tables The tables generated from the QTI XSD.
 * @returns One refusal at the attribute's path, naming the first `problem` the decoding found;
 *   none when the value is Data-SSML JSON, and for an element that carries no `data-ssml` or whose
 *   kind does not declare it.
 */
export const dataSsml = (
  source: SourceDocument,
  visit: Visit,
  tables: Tables,
): readonly Refusal[] => {
  const attribute = attributeOf(visit.element, "data-ssml");
  if (Option.isNone(attribute) || !declaresDataSsml(tables, visit.element)) {
    return [];
  }

  return Result.match(decodeDataSsml(attribute.value.value), {
    onFailure: ({ problem }) => [
      refusal(source, "attribute-type", attributePath(visit.path, attribute.value), {
        attribute: attribute.value.local,
        check: "data-ssml",
        element: visit.element.local,
        problem,
      }),
    ],
    onSuccess: () => [],
  });
};

/**
 * Check a document against the prose rules: `undeclared-response`, `duplicate-identifier`,
 * `binding`, `count-range`, `template-requirements`, `value-type`, `undeclared-variable`,
 * `expression-type`, and the body content's `missing-attribute`, `misplaced-element`,
 * `attribute-type` and `text-not-allowed`, reading 19's `max-strings` on an Extended Text bound to
 * a container, and reading 23's `expression-placement` on a `qti-variable` that carries
 * `weight-identifier`, which only a test's outcome processing may hold ({@link weightPlacement},
 * which pantry once refused as P12). `undeclared-response` and `binding` judge each binding an
 * interaction makes, its `response-identifier` and a Text Entry's or an Extended Text's
 * `string-identifier` ({@link responseRules}): the declaration each names, its fit, reading 92's
 * counts and single binding, and a gap match's gaps. `count-range` judges a least count against its
 * most (reading 76) and an order interaction's counts against its choices (reading 18,
 * {@link countRules}). `duplicate-identifier` judges the item's declarations among themselves
 * ({@link duplicateDeclaration}), and each choice of the nine pooled classes, gaps among them,
 * against the one pool and the item's variables (reading 104 as amended, E19,
 * {@link choiceIdentifier}), a mapping's keys, as written and as values of its base type (readings
 * 98 and 160, B5b, {@link repeatedMapKey}), and a record value's fields (B7,
 * {@link repeatedField}). `attribute-type` judges a `mastery-value` outside the bounds its outcome
 * declaration writes (reading 9, E42a, {@link masteryRange}). Every law over a name reads it only
 * where it is an NCName ({@link nameOf}, reading 152, E40a), and a declaration's values are typed
 * only where its cardinality spells one (reading 158). The body content rules judge an item that
 * labels a body element without naming its tool, `missing-attribute` once at the root
 * ({@link labelTool}, reading 128, E31a); an interaction a `qti-template-block` holds,
 * `misplaced-element` ({@link templateBlockInteraction}, reading 143, E37); a cell's `headers` that
 * names no header of its table, or one twice, `attribute-type` ({@link tableHeaders}, reading 126,
 * E29); and a quotation mark against a `q`, `text-not-allowed` ({@link quotation}, reading 127,
 * E30); and a `data-ssml` value that is not Data-SSML JSON, `attribute-type` ({@link dataSsml}, the
 * operator's P3). `template-requirements` judges the declarations a standard template, an inline
 * `qti-map-response` or `qti-map-response-point` and a `qti-lookup-outcome-value` need, and a
 * mapping expression of a built-in response, which has none. `undeclared-variable` judges the
 * variable a rule or an expression names, through its kind's declaration facet in the registry, and
 * the variables its reference attributes name, through its kind's reference facet, a built-in by
 * the kind it stands as (reading 111), and refuses a template rule that sets a variable of a kind
 * it may not set, and a name a `qti-printed-variable` or a `template-identifier` gives that the
 * item declares no variable of, or a Portable Custom Interaction's `qti-context-variable` names
 * that is no context variable ({@link contextVariableReference}), or a feedback element's
 * `outcome-identifier` names that is no outcome of the item ({@link feedbackOutcome}, reading 77,
 * E3a). `expression-type` judges what a `qti-set-outcome-value`, `qti-set-template-value`,
 * `qti-set-correct-response` or `qti-set-default-value` sets, a branch's or a template constraint's
 * condition, a lookup's operand, every expression's operands by its kind's rule, the variables its
 * reference attributes name, a read template processing may not make, and the kind and type of the
 * variables a `qti-printed-variable` or a `template-identifier` names, and the type of the outcome
 * a feedback element names. Each expression is typed through its kind's rule in the registry
 * (`kindRules` in `#plate/model/expressions/read.ts`). The variable, type and reference rules judge
 * inline response processing and template processing alike, as the qti package does. A field of a
 * record declaration's value that lacks its `field-identifier` or its `base-type` is
 * `missing-attribute` ({@link recordFieldAttributes}), and so is a Portable Custom Interaction that
 * names its module by neither a `module` nor a `qti-interaction-modules` ({@link pciModuleSource},
 * R10-a).
 *
 * The rules judge exactly what the structural walk checks, and only an item they can read whole:
 *
 * - A root other than a QTI `qti-assessment-item` gives no refusal. Every rule reads an item's
 *   declarations, and phase 1 leaves any other root `unchecked` (spec §4.5).
 * - A document whose judged elements hold an unexpanded entity reference anywhere gives no refusal.
 *   The rules read identifiers across elements, so one reference whose value is unknown changes
 *   what another element's rule finds: `identifier="&id;"` on a declaration would make every
 *   `qti-variable` naming that identifier look undeclared. Such a document is `unchecked` unless
 *   the structural walk refuses it.
 * - Only the elements the structural walk checks are visited, the keys of {@link governingTables} for
 *   the same tables. An element outside QTI's namespace is not, nor is an element the walk refuses
 *   as unknown. In lax wildcard content the rules judge the elements the walk checks there as they
 *   judge them anywhere else (reading 57): an interaction there binds a declared response, its
 *   identifiers count toward `duplicate-identifier`, and an unexpanded entity reference among a
 *   checked element's children leaves the document to the verdict's `unchecked`.
 *
 * Every refusal is located at an element or attribute path and returned in document order; the
 * check never stops at the first. An empty list means no prose rule this module implements refuses
 * the document, not that the document is valid: the structural validator judges the XSD's rules.
 *
 * @param source The document to check.
 * @param tables The tables generated from the QTI XSD, the ones `checkStructure` checks the
 *   document by.
 * @returns The refusals, empty when every rule holds or the document is one the rules do not judge.
 * @see {@link Refusal} for what each refusal carries.
 */
export const checkRules = (source: SourceDocument, tables: Tables): readonly Refusal[] => {
  if (!isQti(source.root, (local) => local === "qti-assessment-item")) {
    return [];
  }

  const visits = judgedVisits(source, tables);
  if (visits.some((visit) => holdsUnexpanded(visit.element))) {
    return [];
  }

  const context: Context = {
    builtIns: itemBuiltIns,
    declarer: "item",
    outcomes: declarationsOf(source, "qti-outcome-declaration"),
    parents: new Map(),
    responses: declarationsOf(source, "qti-response-declaration"),
    setCorrectResponses: setCorrectResponses(source, visits),
    templateDefaultType: () => Option.none(),
    typeCollected: Option.none(),
    typeUnanswered: itemNames.typeUnanswered,
    types: new Map(),
    variables: new Map(variableDeclarations.flatMap((kind) => [...declarationsOf(source, kind)])),
  };
  const declared = new Set<string>();
  const written: Written = { fields: new Map(), keyValues: new Map(), keys: new Map() };
  const pools: ChoicePools = { choices: new Map() };
  const variables = new Set([...context.variables.keys(), ...itemBuiltIns.keys()]);
  const bound = new Set<string>();
  const contexts = declarationsOf(source, "qti-context-declaration");
  const placing = placingOf(source);
  const refusals: Refusal[] = [...labelTool(source, visits, tables)];
  for (const visit of visits) {
    if (Option.isSome(visit.parent)) {
      context.parents.set(visit.element, visit.parent.value);
    }

    refusals.push(
      ...duplicateDeclaration(source, visit, declared),
      ...choiceIdentifier(source, visit, variables, pools),
      ...repeatedMapKey(source, visit, context, written),
      ...repeatedField(source, visit, context.parents, written.fields),
      ...responseRules(source, visit, context.responses, bound),
      ...countRules(source, visit),
      ...contextVariableReference(source, visit, contexts),
      ...pciModuleSource(source, visit),
      ...templateRequirements(source, visit, context),
      ...mapResponseRequirements(source, visit, context),
      ...attributeValueType(source, visit, context),
      ...masteryRange(source, visit),
      ...textValueType(source, visit, context),
      ...recordFieldAttributes(source, visit, context),
      ...undeclaredVariable(source, visit, context),
      ...templateTarget(source, visit, context),
      ...templateReads(source, visit, context),
      ...attributeReferences(source, visit, context),
      ...weightPlacement(source, visit),
      ...printedVariableReferences(source, visit, context),
      ...feedbackOutcome(source, visit, context),
      ...templateIdentifierReference(source, visit, context),
      ...setType(source, visit, context),
      ...conditionType(source, visit, context),
      ...lookupTableRequirements(source, visit, context),
      ...lookupOperandType(source, visit, context),
      ...operandTypes(source, visit, context),
      ...templateBlockInteraction(source, visit, placing),
      ...tableHeaders(source, visit, placing),
      ...quotation(source, visit, placing),
      ...dataSsml(source, visit, tables),
    );
  }

  return refusals;
};

/**
 * The built-in variables a test's processing reads, with the types plate gives them in a test:
 * `duration` a single duration, "the time spent on the test [...] of base-type duration and single
 * cardinality" (`info.txt:9226`, reading 29), and `numAttempts`, `completionStatus` and
 * `QTI_CONTEXT` typed as an item's. The qti package now gives a test only `duration`, a duration,
 * and `QTI_CONTEXT` (`builtIns` in `packages/pantry/src/grammar/references.ts`, typed by
 * `builtInTypes` in `packages/pantry/src/grammar/expression.ts`); plate keeps a test's own
 * `numAttempts` and `completionStatus` where the test declares neither, as ruled (B4), an agreement
 * difference (G-R3 184, pending). A test may declare either (reading 168, "A test may declare a
 * variable named `numAttempts` or `completionStatus`; in a test only `duration` is reserved"), and
 * its processing then reads the declared variable: {@link testProcessingScope} drops from this map
 * each built-in the test declares, under any kind. A test's printed variables name fewer: only
 * `duration` and `QTI_CONTEXT` (`testBuiltIns` in `#plate/validate/test-rules.ts`).
 */
const testProcessingBuiltIns: ReadonlyMap<string, NamedVariable> = new Map(
  [...builtInKinds].map(([identifier, kind]) => [
    identifier,
    {
      kind,
      type: Option.fromUndefinedOr(
        identifier === "duration" ? singleOf("duration") : builtIns.get(identifier),
      ),
    },
  ]),
);

/**
 * What a processing scope gives the rules' {@link Context}: the names a test's or a section's
 * expressions resolve against, beside its outcomes.
 */
type ProcessingScope = Pick<
  Context,
  "builtIns" | "declarer" | "outcomes" | "typeCollected" | "typeUnanswered" | "variables"
>;

/**
 * The processing scope of a test: its outcome and context declarations, the four built-ins its
 * processing reads ({@link testProcessingBuiltIns}), the typer of a prefixed read, a name with a
 * `.` that no declaration answers whole, and the typer of what a `qti-test-variables` collects.
 *
 * A built-in the test declares, under any kind, is not among them: its declaration takes the
 * built-in's place (reading 168, "A test may declare a variable named `numAttempts` or
 * `completionStatus`; in a test only `duration` is reserved"), so a `qti-correct` or a map
 * response of a declared outcome `numAttempts`, which reads a response, names none and is refused
 * `undeclared-variable`, its refusal carrying the kind that declares the name
 * ({@link declaredBuiltIn}).
 *
 * A dotted name the test declares whole is that declaration and never a prefixed read (reading 37),
 * whatever kind of variable the reference expects: where it expects another kind
 * ({@link variableType}), a `qti-map-response` or a `qti-correct` of a test outcome `A.B`, or a
 * `qti-set-outcome-value` of a context variable `C.X`, nothing answers it, and it is refused
 * `undeclared-variable` as its undotted form is (pantry's P8 and P27, its `Variable declared` and
 * `Mapped response` laws).
 *
 * @param test The test document.
 * @param typePrefixed The typer of its prefixed reads.
 * @param typeCollected The typer of what its collections collect, none without its items.
 * @returns The scope.
 */
const testProcessingScope = (
  test: SourceDocument,
  typePrefixed: PrefixedTyper,
  typeCollected: Option.Option<CollectedTyper>,
): ProcessingScope => {
  const variables = new Map(
    variableDeclarations.flatMap((kind) => [...declarationsOf(test, kind)]),
  );

  return {
    builtIns: new Map(
      [...testProcessingBuiltIns].filter(([identifier]) => !variables.has(identifier)),
    ),
    declarer: "test",
    outcomes: declarationsOf(test, "qti-outcome-declaration"),
    typeCollected,
    typeUnanswered: (identifier) =>
      identifier.includes(".") && !variables.has(identifier)
        ? Option.some(typePrefixed(identifier))
        : Option.none(),
    variables,
  };
};

/**
 * The processing scope of a section document on its own: no declaration and no built-in, with
 * every name typed `unknown`, so only the rules that need no declaration judge it. A section
 * resolves its names in each test that holds it (reading 5), so this is the scope its own verdict
 * judges it under.
 */
const sectionProcessingScope: ProcessingScope = {
  builtIns: new Map(),
  declarer: "test",
  outcomes: new Map(),
  typeCollected: Option.none(),
  typeUnanswered: () => Option.some(untyped),
  variables: new Map(),
};

/**
 * The processing scope of a test or a section: what its expressions resolve a name against, beside
 * its outcomes ({@link Context}).
 *
 * A test's is its own ({@link testProcessingScope}). A section document's is, under a test that
 * reaches it, that test's, its prefixed reads typed by `typePrefixed`, since its references
 * "resolve once for each test that includes the section, not once for the section on its own"
 * (reading 5); on its own it is {@link sectionProcessingScope}, every name `unknown`.
 *
 * @param source The document.
 * @param typePrefixed The typer of a test's prefixed reads, the reaching test's for a section.
 * @param reaching The test document a section is judged under, none for a section on its own;
 *   passed over for a test.
 * @param typeCollected The typer of what a test's collections collect, the reaching test's for a
 *   section; none without the test's items, and passed over for a section on its own.
 * @returns The scope, none for a root that is neither a QTI test nor a QTI section.
 */
const processingScope = (
  source: SourceDocument,
  typePrefixed: PrefixedTyper,
  reaching: Option.Option<SourceDocument>,
  typeCollected: Option.Option<CollectedTyper>,
): Option.Option<ProcessingScope> => {
  if (isQti(source.root, (local) => local === "qti-assessment-test")) {
    return Option.some(testProcessingScope(source, typePrefixed, typeCollected));
  }

  return isQti(source.root, (local) => local === "qti-assessment-section")
    ? Option.some(
        Option.match(reaching, {
          onNone: () => sectionProcessingScope,
          onSome: (test) => testProcessingScope(test, typePrefixed, typeCollected),
        }),
      )
    : Option.none();
};

/**
 * Check a test's or a section's expressions against the item's processing rules, each where the qti
 * package applies it (the expression laws of `packages/pantry/src/qti/expressions.ts`, over the
 * four contexts of `languages` in `packages/pantry/src/grammar/expression.ts`):
 *
 * - `undeclared-variable` (P8, {@link undeclaredVariable}), and the operand and reference-attribute
 *   types of `expression-type` (P23, {@link operandTypes}; P24, {@link attributeReferences}), in a
 *   `qti-outcome-processing`, a `qti-pre-condition`, a `qti-branch-rule` and a
 *   `qti-template-default`. A test declares no response, so an unprefixed `qti-map-response` or
 *   `qti-map-response-point` of a name that is no built-in response names none and is refused
 *   `undeclared-variable`, where the qti package reports P27 (its `Mapped response` law); a
 *   prefixed one is a package's to judge.
 * - `template-requirements` (P27, {@link mapResponseRequirements}) in the same four: an unprefixed
 *   `qti-map-response` or `qti-map-response-point` of a built-in response the scope holds, a test's
 *   `duration`, and `numAttempts` where the test declares none, has no mapping or area mapping
 *   (reading 166, "An unprefixed `qti-map-response` or `qti-map-response-point` that names a
 *   built-in response variable, an item's `numAttempts` or `duration` or a test's `duration`, is
 *   refused under 'Mapped response' too"). A test that declares `numAttempts` (reading 168) holds
 *   no such built-in, so its mapping expression of the name keeps the refusal above.
 * - What a `qti-set-outcome-value` sets (P20, {@link setType}) and a `qti-lookup-outcome-value`'s
 *   table and operand (P22, {@link lookupTableRequirements}, {@link lookupOperandType}) in outcome
 *   processing, and what a `qti-template-default` sets (P20) where `templateDefaultType` types its
 *   target.
 * - The condition of a `qti-outcome-if` or a `qti-outcome-else-if` (P21, {@link conditionType}),
 *   never of a pre-condition or a branch rule.
 * - A weighted `qti-test-variables` whose base type is not `float` (P29, {@link weightType}).
 * - The text of a `qti-base-value` in any of the four, against its `base-type` (`value-type`, P7,
 *   {@link literalValueType}).
 *
 * An unweighted `qti-test-variables` with no `base-type` is a multiple of the base type
 * `typeCollected` gives it from the test's items, where it is given (G-R3 199,
 * {@link collectedAttribute}), and unknown otherwise. The qti package types one with no `base-type`
 * unknown (its `qti-test-variables` typing in `packages/pantry/src/grammar/expression.ts`), so a
 * package whose test sets a float from an integer collection is refused here and accepted there: an
 * agreement difference G-R3 199 settles, since the engine's run fails it (`OutcomeMismatchError`).
 *
 * The rules are the item's own, so the two runs cannot drift. Names resolve against the processing
 * scope ({@link processingScope}): a test's declarations and built-ins, where a name with a `.`
 * that the test does not declare whole is a prefixed read, typed by `typePrefixed` and never
 * refused `undeclared-variable` here (reading 48, "a dotted reference is accepted when exactly one
 * reading names a real item ref, test part or section and its variable", is a package's). A section
 * document's names are all typed `unknown` on its own, as its own verdict judges it; under a test
 * that reaches it (`reaching`), as a package judges it once for each such test, they resolve
 * against that test's scope, so a name the test neither declares nor holds as a built-in is
 * `undeclared-variable`, with the test as its `declarer` as in a test ({@link declaredBy}), and
 * each prefixed read is typed by the reaching test's `typePrefixed` (pantry's relations
 * `AssembledReference` and `Reading` in `packages/pantry/src/qti/expressions.ts`). A template
 * default is an expression, so the template read rule (P26) and the template rules' targets do not
 * judge it; its own target is an item's template variable, which only a package can find, so its
 * expression is judged against that variable (P20, {@link setType}) only where
 * `templateDefaultType` types it.
 *
 * As {@link checkRules} does, it judges exactly what the structural walk checks, and gives no
 * refusal for a document whose judged elements hold an unexpanded entity reference. Every refusal
 * is at the path of the element it judges, in document order.
 *
 * @param source The test or section document.
 * @param tables The tables generated from the QTI XSD, the ones `checkStructure` checks the
 *   document by.
 * @param typePrefixed The type of each prefixed read: `unknown` for a test checked alone, which
 *   satisfies every rule; the items' types for a test a package holds.
 * @param templateDefaultType The type of the template variable a `qti-template-default` sets, its
 *   item ref's item's (`TemplateDefaultTarget` in `packages/pantry/src/qti/expressions.ts`): none
 *   unless given, as for a test checked alone, which judges no default against its target; a
 *   package's for a test it holds, or a section document a test reaches.
 * @param reaching For a section document, the test document it is judged under, a test that
 *   reaches it: none unless given, which judges the section on its own, every name `unknown`.
 *   Passed over for a test.
 * @param typeCollected The base type an unweighted `qti-test-variables` with no `base-type`
 *   collects, from the test's items ({@link CollectedTyper}): absent unless given, as for a test
 *   checked alone, which types each such collection unknown; a package's for a test it holds, or a
 *   section document a test reaches. Passed over for a section on its own.
 * @returns The refusals, empty when every rule holds or the document is not a test or a section.
 */
export const processingRefusals = (
  source: SourceDocument,
  tables: Tables,
  typePrefixed: PrefixedTyper,
  templateDefaultType: (templateDefault: SourceElement) => Option.Option<ExpressionType> = () =>
    Option.none(),
  reaching: Option.Option<SourceDocument> = Option.none(),
  typeCollected?: CollectedTyper,
): readonly Refusal[] => {
  const scope = processingScope(
    source,
    typePrefixed,
    reaching,
    Option.fromUndefinedOr(typeCollected),
  );
  if (Option.isNone(scope)) {
    return [];
  }

  const visits = judgedVisits(source, tables);
  if (visits.some((visit) => holdsUnexpanded(visit.element))) {
    return [];
  }

  const context: Context = {
    ...scope.value,
    parents: new Map(),
    responses: new Map(),
    setCorrectResponses: new Set(),
    templateDefaultType,
    types: new Map(),
  };
  const refusals: Refusal[] = [];
  for (const visit of visits) {
    if (Option.isSome(visit.parent)) {
      context.parents.set(visit.element, visit.parent.value);
    }

    refusals.push(
      ...literalValueType(source, visit, context),
      ...mapResponseRequirements(source, visit, context),
      ...undeclaredVariable(source, visit, context),
      ...attributeReferences(source, visit, context),
      ...setType(source, visit, context),
      ...conditionType(source, visit, context),
      ...lookupTableRequirements(source, visit, context),
      ...lookupOperandType(source, visit, context),
      ...weightType(source, visit, context),
      ...operandTypes(source, visit, context),
    );
  }

  return refusals;
};
