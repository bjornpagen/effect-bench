/**
 * Structural validation: whether a document's elements, attributes and text are those the QTI XSD
 * admits, as the generated {@link Tables} record them.
 *
 * {@link checkStructure} walks the document once from its root, into every QTI-namespace element
 * the tables admit, and returns every refusal it finds in document order, never stopping at the
 * first, so the verdict can collect them beside the prose rules'. Apart from the readings below, it
 * never refuses what the XSD admits (reading 1): namespace declarations, `xsi:schemaLocation` and
 * `xsi:noNamespaceSchemaLocation`, whitespace between elements, entity references and whatever a
 * wildcard matches all pass. Given the tables of other namespaces, such as a content package
 * manifest's, it walks their elements too, each by its own namespace's tables and by the same
 * rules, reading `##other` against that namespace; the readings stay QTI's, but for the rows that
 * read XML's own `xml:lang`, which hold on every element it checks (reading 129). The tables it
 * holds stand for the document's schema set (reading 81). An element in a namespace it holds no
 * tables for that its parent's table names, such as MathML, is kept and not walked, and so is what
 * a `skip` element wildcard admits.
 *
 * What a `lax` element wildcard admits is walked as XML Schema assesses it (rule `5b8ee08b`): a
 * global element of the tables, QTI's or another namespace's, is checked by its table (reading
 * 81), a nested QTI root or manifest is kept as foreign content (reading 6), foreign content whose
 * `xsi:type` names a complex type the tables define is kept unchecked (reading 50), foreign content
 * whose `xsi:type` names a simple type, built in or in the tables, has its attributes and element
 * children refused and its text accepted unchecked, plate's open limit that reading 60 ("a simple
 * type it names governs its text and is checked") records, and any other element is passed over
 * while its children are admitted laxly in turn, its `xsi:type` refused where it is no QName or
 * its prefix is bound to nothing (reading 83). What a `strict` element wildcard admits stands only
 * by a global declaration or an `xsi:type` (reading 81): a global element of the tables is checked
 * by its table, a nested root they declare is kept as foreign content (reading 113), an element of
 * a namespace the schema set imports but plate holds no tables for, such as MathML, is kept and
 * not walked, plate's open limit, an element whose `xsi:type` names a type of the tables or of XML
 * Schema's is treated as under `lax`, and any other element is refused. `qti-ordering`'s `##other`
 * slot is read as `##any`, laxly, so a QTI element there is admitted like any other (reading 61,
 * "an element in QTI's own namespace inside `qti-ordering`'s extension slot is valid"). On every
 * element it walks it judges `xsi:type` and `xsi:nil` as XML Schema judges them (reading 47), and
 * no attribute wildcard admits either: a type is valid when it names the element's declared type or
 * a type derived from it, and `xsi:nil` never is, because no table records a nillable element.
 * After a valid `xsi:type` naming a type of the tables, that type's own table governs the element's
 * attributes, text and children in place of its name's (AD-9); {@link governingTables} gives the
 * table that governs each element the walk checks.
 *
 * Over the XSD's rules it applies the shared readings that set the XSD aside where the walk can see
 * them, each a row of {@link readingRows}: attributes narrowed, retyped, withdrawn or required,
 * `data-*` names, the attributes an element the Schematron's extension lists cover may carry
 * (reading 90), placements, child counts and the range of the count attributes, and beside them
 * the information model's own sentences the XSD does not hold: the floor of a literal `figures` or
 * `n`, the `tolerance` an absolute or relative `qti-equal` must carry, the identifiers the built-in
 * variables keep from every declaration, and the values a `tolerance` holds. The XSD's own order
 * and counts of children are not checked, but for the order of the two content models whose
 * repeated wildcard follows the particles that name their children (reading 96). Over QTI's
 * elements it keeps the document's ID/IDREF table, as XML Schema does (readings 101, 109 and 156),
 * and refuses a repeated ID and an IDREF that names no ID.
 *
 * @module
 */
import { Option, Result } from "effect";
import { greatestCount, leastCount } from "#plate/count-range.ts";
import {
  attributePath,
  mathmlNamespace,
  qtiNamespace,
  ssmlNamespace,
  walk,
  xincludeNamespace,
  xmlNamespace,
  xmlnsNamespace,
  xsdNamespace,
  xsiNamespace,
} from "#plate/document/source.ts";
import type {
  SourceAttribute,
  SourceDocument,
  SourceElement,
  Visit,
} from "#plate/document/source.ts";
import {
  decimalLexical,
  doubleLexical,
  integerLexical,
  isLanguageTag,
  isNcName,
  parseLexical,
} from "#plate/model/values.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { RefusalRule } from "#plate/validate/refusal.ts";
import { patternEquivalents } from "#plate/validate/xsd.ts";
import type {
  AttributeTable,
  AttributeType,
  BuiltinName,
  ChildName,
  ContentTable,
  ElementTable,
  Tables,
  TypeEntry,
  Wildcard,
} from "#plate/validate/xsd.ts";
import { baseTypes, manifestNamespace } from "#plate/vocabulary.ts";

/**
 * An attribute name QTI 3.0's schema spells differently from a name authors write: the element it
 * belongs to, the name as written, the name to write instead, and the reading that settles it.
 */
interface Misspelling {
  readonly element: string;
  readonly reading: string;
  readonly schema: string;
  readonly written: string;
}

/**
 * The table of misspellings, which gives an `unknown-attribute` refusal its suggestion.
 *
 * A name with no row is refused with no suggestion, and its wording says to remove the attribute.
 */
const misspellings: readonly Misspelling[] = [
  // Reading 11 ("a PCI's secondary module configuration is `secondary-configuration`"): the
  // schema's name for what QTI 3.0's implementation guide alone calls `fallback-configuration`.
  {
    element: "qti-interaction-modules",
    reading: "11",
    schema: "secondary-configuration",
    written: "fallback-configuration",
  },
];

/**
 * Where one of reading 7's typed-value attributes takes its base type: the `base-type` of the
 * enclosing response or outcome declaration, or `float` for one that is always an XSD double.
 */
type BaseTypeSource = "float" | "qti-outcome-declaration" | "qti-response-declaration";

/**
 * The typed-value attributes reading 7 lists that an item can carry, each on its own element,
 * with where each takes its base type (reading 7, "a typed value in element text is trimmed; in an
 * attribute it is exact").
 *
 * Outer XML whitespace in one of these is `padded-attribute`, except in a value of base type
 * `string`, whose whitespace is part of the value. Every other attribute is read as its XSD type
 * reads it, collapsed unless it is a string, and never refused for padding: `normal-maximum`, a
 * slider's `lower-bound` and a `title` among them. Reading 7's usage-data attributes, on
 * `ud:mapping` and `ud:mapEntry`, never sit in an item.
 */
const typedValueAttributes: ReadonlyMap<string, ReadonlyMap<string, BaseTypeSource>> = new Map<
  string,
  ReadonlyMap<string, BaseTypeSource>
>([
  ["qti-area-map-entry", new Map([["mapped-value", "float"]])],
  [
    "qti-area-mapping",
    new Map([
      ["default-value", "float"],
      ["lower-bound", "float"],
      ["upper-bound", "float"],
    ]),
  ],
  ["qti-interpolation-table", new Map([["default-value", "qti-outcome-declaration"]])],
  [
    "qti-interpolation-table-entry",
    new Map([
      ["source-value", "float"],
      ["target-value", "qti-outcome-declaration"],
    ]),
  ],
  [
    "qti-map-entry",
    new Map([
      ["map-key", "qti-response-declaration"],
      ["mapped-value", "float"],
    ]),
  ],
  [
    "qti-mapping",
    new Map([
      ["default-value", "float"],
      ["lower-bound", "float"],
      ["upper-bound", "float"],
    ]),
  ],
  ["qti-match-table", new Map([["default-value", "qti-outcome-declaration"]])],
  ["qti-match-table-entry", new Map([["target-value", "qti-outcome-declaration"]])],
]);

/**
 * A run of XML whitespace: space, tab, carriage return or line feed, and no other character.
 */
const xmlSpaceRun = /[\t\n\r ]+/gu;

/**
 * XML whitespace at the start or the end of a value.
 */
const outerXmlSpace = /^[\t\n\r ]|[\t\n\r ]$/u;

/**
 * A character other than XML whitespace.
 */
const nonXmlSpace = /[^\t\n\r ]/u;

/**
 * Collapse a value's XML whitespace, as XSD's `whiteSpace="collapse"` does: each run becomes one
 * space, and a space at either end is removed.
 *
 * @param value The value as written.
 * @returns The collapsed value.
 */
const collapse = (value: string): string => {
  const single = value.replaceAll(xmlSpaceRun, " ");
  const start = single.startsWith(" ") ? 1 : 0;
  const end = single.endsWith(" ") && single.length > start ? single.length - 1 : single.length;

  return single.slice(start, end);
};

/**
 * Replace a value's XML whitespace, as XSD's `whiteSpace="replace"` does: each tab and line break
 * becomes a space, and nothing is removed.
 *
 * @param value The value as written.
 * @returns The value with each tab and line break replaced.
 */
const replace = (value: string): string => value.replaceAll(/[\t\n\r]/gu, " ");

/**
 * Apply a built-in's whitespace facet to a value: `string` keeps it, `normalizedString` replaces
 * each tab and line break with a space, and every other built-in collapses it.
 *
 * @param name The built-in the value is read as.
 * @param value The value as written.
 * @returns The value the built-in's lexical check reads.
 */
const whitespaced = (name: BuiltinName, value: string): string => {
  if (name === "string") {
    return value;
  }

  return name === "normalizedString" ? replace(value) : collapse(value);
};

/**
 * The least value of `xs:int`, -2^31.
 */
const leastInt = -2_147_483_648n;

/**
 * The greatest value of `xs:int`, 2^31 - 1.
 */
const greatestInt = 2_147_483_647n;

/**
 * The lexical check of each built-in: whether a value, after its whitespace facet, is in the
 * built-in's lexical space.
 *
 * An integer kind's range is compared exactly as a `bigint`, never through a `Number`. `anyURI`,
 * `anyType` and the two string types admit any text. `ID` and `IDREF` keep the lexical space of the
 * `NCName` they restrict (XML Schema Part 2, section 3.3.8); what an ID's value means beyond its
 * spelling is the document's ID/IDREF table's ({@link checkIds}).
 */
const lexicalChecks = {
  ID: isNcName,
  IDREF: isNcName,
  NCName: isNcName,
  anyType: () => true,
  anyURI: () => true,
  boolean: (value: string) =>
    value === "true" || value === "false" || value === "1" || value === "0",
  decimal: (value: string) => decimalLexical.test(value),
  double: (value: string) => doubleLexical.test(value),
  int: (value: string) =>
    integerLexical.test(value) && BigInt(value) >= leastInt && BigInt(value) <= greatestInt,
  integer: (value: string) => integerLexical.test(value),
  nonNegativeInteger: (value: string) => integerLexical.test(value) && BigInt(value) >= 0n,
  normalizedString: () => true,
  string: () => true,
} satisfies Record<BuiltinName, (value: string) => boolean>;

/**
 * The number an `xs:double` lexical form names, read by the value model's {@link parseLexical}, so
 * the walk and the value model cannot read one form two ways.
 *
 * A form beyond the largest finite double names the largest finite double of its sign, the closest
 * value of the value space (XML Schema Part 2 §3.2.5); only `INF` and `-INF` name the infinities.
 *
 * @param lexical The lexical form.
 * @returns The number it names, or none when the text is outside the lexical space.
 */
const doubleValue = (lexical: string): Option.Option<number> =>
  Option.flatMap(Result.getSuccess(parseLexical("float", lexical)), (single) =>
    single.baseType === "float" ? Option.some(single.value) : Option.none(),
  );

/**
 * Count the digits after a decimal lexical form's point.
 *
 * @param lexical A value {@link decimalLexical} admits.
 * @returns The number of fraction digits, 0 when it has no point.
 */
const fractionDigits = (lexical: string): number => lexical.split(".")[1]?.length ?? 0;

/**
 * Read a decimal lexical form as an exact integer scaled by a power of ten.
 *
 * @param lexical A value {@link decimalLexical} admits.
 * @param places The number of fraction digits to scale by, at least the value's own.
 * @returns The value times 10^`places`.
 */
const scaledDecimal = (lexical: string, places: number): bigint => {
  const [whole = "", fraction = ""] = lexical.replace(/^[+-]/u, "").split(".");
  const magnitude = BigInt(`0${whole}${fraction.padEnd(places, "0")}`);

  return lexical.startsWith("-") ? -magnitude : magnitude;
};

/**
 * Report whether a value meets a `minInclusive` bound.
 *
 * A decimal or an integer kind compares exactly, digit for digit; a double compares the numbers
 * {@link doubleValue} reads, so `NaN` meets no bound. A bound outside the built-in's lexical space,
 * or a bound on a built-in that is not a number, is met by nothing.
 *
 * @param name The built-in the value is read as.
 * @param value The value, already in the built-in's lexical space.
 * @param bound The bound's lexical form.
 * @returns Whether the value is at least the bound.
 */
const meetsBound = (name: BuiltinName, value: string, bound: string): boolean => {
  if (name === "double") {
    const read = doubleValue(value);
    const least = doubleValue(bound);

    return Option.isSome(read) && Option.isSome(least) && read.value >= least.value;
  }

  if (name === "decimal" || name === "int" || name === "integer" || name === "nonNegativeInteger") {
    const places = Math.max(fractionDigits(value), fractionDigits(bound));

    return (
      decimalLexical.test(bound) && scaledDecimal(value, places) >= scaledDecimal(bound, places)
    );
  }

  return false;
};

/**
 * What settles a narrowed attribute, which its refusal's detail carries: a shared reading, or a
 * line of the information model with the `check` that names the case and the qti package's rule
 * that refuses the same, `pantry`. A typed outcome's row also names the outcome, `identifier`, and
 * the base type it must have, `baseType`, for the wording; its `base-type` row cites the
 * information model's line, and its `cardinality` row reading 153.
 */
type Narrowing =
  | { readonly reading: string }
  | { readonly check: string; readonly pantry: string; readonly source: string }
  | ({
      readonly baseType: string;
      readonly check: "reserved-outcome-type";
      readonly identifier: string;
      readonly pantry: string;
    } & ({ readonly reading: string } | { readonly source: string }));

/**
 * A reading, or a sentence of the information model, that narrows an attribute: on the named
 * elements, or on every element whose table declares it, a value the XSD's own type admits must
 * also satisfy `holds`, which reads the value under `whiteSpace` and, where the narrowing depends
 * on another attribute or on the document the element sits in, the element and its path, or it is
 * `attribute-type` with `expected` as the values the row admits and the facts of `settled`.
 *
 * `whiteSpace` is how `holds` reads the value: `collapse`d, or with each tab and line break
 * `replace`d by a space and nothing trimmed, as XSD reads an `xs:normalizedString`. A row that
 * agrees with a rule of the qti package reads the value as that rule does, so it refuses the
 * padding the rule refuses, and no more.
 */
interface NarrowedAttribute {
  readonly attribute: string;
  readonly elements: "declaring" | readonly string[];
  readonly expected: string;
  readonly holds: (lexical: string, element: SourceElement, path: string) => boolean;
  readonly kind: "narrowed-attribute";
  readonly settled: Narrowing;
  readonly whiteSpace: "collapse" | "replace";
}

/**
 * A reading that retypes an attribute on one element: the XSD's type no longer applies, so its
 * `attribute-type` check is skipped here, and a prose rule reads the value instead.
 */
interface RetypedAttribute {
  readonly attribute: string;
  readonly element: string;
  readonly kind: "retyped-attribute";
  readonly reading: string;
}

/**
 * A reading that refuses attribute names a wildcard would admit: a name in no namespace that starts
 * with `prefix` and does not match `pattern` is `unknown-attribute`.
 */
interface AttributeName {
  readonly kind: "attribute-name";
  readonly pattern: RegExp;
  readonly prefix: string;
  readonly reading: string;
}

/**
 * A reading, or a sentence of the information model, that places elements the XSD admits more
 * widely: in a document whose root `roots` accepts, each of `elements` must have `container` as its
 * parent, or as an ancestor, and `admits` must accept that container, or it is
 * `misplaced-element`. `requires` says where it must sit, for the wording, and `reading` is the
 * shared reading the refusal cites, none for a row the information model settles alone, whose line
 * the row's comment gives.
 */
interface Placement {
  readonly admits: (container: SourceElement) => boolean;
  readonly container: string;
  readonly elements: readonly string[];
  readonly kind: "placement";
  readonly reading: Option.Option<string>;
  readonly requires: string;
  readonly roots: (root: SourceElement) => boolean;
  readonly within: "ancestor" | "parent";
}

/**
 * A child count the XSD does not hold: when `applies` accepts the parent of one of `elements`, the
 * number of its child elements that `counted` names (`any` for every child element, else QTI local
 * names) must not be one `refuses` rejects, or it is `child-count`. `child` and `required` name the
 * children and the count for the wording, and `source` is the reading or the specification line
 * that sets it.
 */
interface ChildCount {
  readonly applies: (parent: Option.Option<SourceElement>) => boolean;
  readonly child: string;
  readonly counted: "any" | readonly string[];
  readonly elements: readonly string[];
  readonly kind: "child-count";
  readonly refuses: (count: number) => boolean;
  readonly required: "at least one" | "exactly one";
  readonly source: string;
}

/**
 * A range the XSD leaves unbounded: each of `attributes`, in no namespace, on an element whose
 * table declares it, whose value the XSD's own type admits and that is an integer after collapse,
 * must lie from `least` to `greatest`, compared exactly, or it is `count-range`. A value that is
 * not an integer, such as `figures`' variable form, is not compared.
 */
interface CountRange {
  readonly attributes: readonly string[];
  readonly greatest: bigint;
  readonly kind: "count-range";
  readonly least: bigint;
  readonly reading: string;
}

/**
 * A row's condition on its element: the attribute in no namespace that sets a mode, and the value
 * it must have. The value is read collapsed, or as the default the element's table declares when
 * the element does not write it; a value that holds an unexpanded entity reference is unknown and
 * meets no condition.
 */
interface Condition {
  readonly attribute: string;
  readonly value: string;
}

/**
 * A floor the information model sets on an attribute the XSD types as an integer or a variable's
 * name: on `element`, when `when` holds, a value the XSD's own type admits that is an integer
 * after collapse must be at least `least`, compared exactly, or it is `attribute-type`, citing
 * `source`, the information model's line. A variable's name is not compared: its value is known
 * only at run time.
 */
interface IntegerFloor {
  readonly attribute: string;
  readonly element: string;
  readonly kind: "integer-floor";
  readonly least: bigint;
  readonly source: string;
  readonly when: Option.Option<Condition>;
}

/**
 * An attribute the information model requires where the XSD makes it optional: on `element`, when
 * `when` holds, `attribute` in no namespace must be written, or it is `missing-attribute` at the
 * element, citing `source`, the information model's line.
 */
interface ConditionalAttribute {
  readonly attribute: string;
  readonly element: string;
  readonly kind: "conditional-attribute";
  readonly source: string;
  readonly when: Condition;
}

/**
 * An attribute a reading requires where the XSD makes it optional: on `element`, when `applies`
 * accepts the element and its parent, `attribute` in no namespace must be written, or it is
 * `missing-attribute` at the element, citing `reading`. The row holds by the element's name, so an
 * element an `xsi:type` governs is held to it too (reading 84).
 */
interface RequiredAttribute {
  readonly applies: (element: SourceElement, parent: Option.Option<SourceElement>) => boolean;
  readonly attribute: string;
  readonly element: string;
  readonly kind: "required-attribute";
  readonly reading: string;
}

/**
 * An attribute the XSD declares on an element that a reading refuses there: on `element`,
 * `attribute` in no namespace is `unknown-attribute`, citing `reading`, whatever its value. The row
 * holds by the element's name, whether or not the table that governs the element declares the
 * attribute (reading 84).
 */
interface WithdrawnAttribute {
  readonly attribute: string;
  readonly element: string;
  readonly kind: "withdrawn-attribute";
  readonly reading: string;
}

/**
 * A reading that narrows an attribute of XML's own namespace, which XML defines for every element:
 * on every element the walk checks, in every namespace, whether the table that governs it declares
 * the attribute or an attribute wildcard admits it, and on every element it passes over laxly, the
 * value collapsed must satisfy `holds`, which also reads the element, or it is `attribute-type`
 * with `expected` as the values the row admits, citing `reading`. An attribute the walk refuses as
 * `unknown-attribute` is not read again.
 */
interface XmlAttribute {
  readonly attribute: string;
  readonly expected: string;
  readonly holds: (lexical: string, element: SourceElement) => boolean;
  readonly kind: "xml-attribute";
  readonly reading: string;
}

/**
 * One reading applied over the XSD's rules, or one sentence of the information model.
 */
type ReadingRow =
  | AttributeName
  | ChildCount
  | ConditionalAttribute
  | CountRange
  | IntegerFloor
  | NarrowedAttribute
  | Placement
  | RequiredAttribute
  | RetypedAttribute
  | WithdrawnAttribute
  | XmlAttribute;

/**
 * Accept every parent, for a child count that holds wherever its element sits, every root, for a
 * placement that holds in every document, every container, for a placement that asks nothing of
 * its container but its name, and every element, for an attribute a reading requires wherever its
 * element sits.
 *
 * @returns Always true.
 */
const anywhere = (): boolean => true;

/**
 * Report whether a document's root is neither a QTI test nor a QTI section, whose misplaced
 * outcome-only expressions the test prose rules refuse as `expression-placement` (reading 23), so
 * that the structural walk does not refuse them a second time.
 *
 * @param root The document's root.
 * @returns Whether the root is anything but a `qti-assessment-test` or a `qti-assessment-section`.
 */
const outsideTests = (root: SourceElement): boolean =>
  root.namespace !== qtiNamespace ||
  (root.local !== "qti-assessment-test" && root.local !== "qti-assessment-section");

/**
 * Read the value an element gives an attribute in no namespace, for a row's condition: the value
 * it writes, collapsed, or the default its table declares when it writes none.
 *
 * @param element The element.
 * @param declared The attributes the element's table declares.
 * @param local The attribute's local name.
 * @returns The value, or none when the element writes none and its table declares no default, or
 *   when the value written holds an unexpanded entity reference, whose value is unknown.
 */
const modeOf = (
  element: SourceElement,
  declared: readonly AttributeTable[],
  local: string,
): Option.Option<string> => {
  const written = element.attributes.find(
    (attribute) => attribute.namespace === "" && attribute.local === local,
  );
  if (written !== undefined) {
    return written.references.length === 0 ? Option.some(collapse(written.value)) : Option.none();
  }

  return Option.fromUndefinedOr(
    declared.find((declaration) => declaration.namespace === "" && declaration.local === local)
      ?.default,
  );
};

/**
 * Report whether a declaration spells one of some values in an attribute in no namespace, compared
 * exactly as written: the XSD types a declaration's `base-type` and `cardinality`, like a
 * hotspot's `shape`, as enumerations of `xs:string`, whose whiteSpace is `preserve`, and declares
 * no default for any of them. One that is unwritten, holds an unexpanded entity reference or
 * spells no code, such as `base-type=" file"`, spells none of them, so no law over that attribute
 * judges its declaration; its value domain, or the XSD's required attribute, refuses it alone
 * (readings 157 and 158).
 *
 * @param declaration The declaration, or a hotspot.
 * @param local The attribute's local name.
 * @param values The values.
 * @returns Whether the declaration's attribute is one of them.
 */
const declares = (declaration: SourceElement, local: string, values: readonly string[]): boolean =>
  declaration.attributes.some(
    (attribute) =>
      attribute.namespace === "" &&
      attribute.local === local &&
      attribute.references.length === 0 &&
      values.includes(attribute.value),
  );

/**
 * Report whether a response declaration may hold a `qti-mapping`: its base type is neither `file`
 * nor `duration` (info.txt:34086) and its cardinality is not `record` (info.txt:9306). A value that
 * is unknown is not refused.
 *
 * @param declaration The response declaration.
 * @returns Whether its mapping is placed.
 */
const holdsMapping = (declaration: SourceElement): boolean =>
  !declares(declaration, "base-type", ["duration", "file"]) &&
  !declares(declaration, "cardinality", ["record"]);

/**
 * The base types other than `point`, whose declarations hold no `qti-area-mapping`.
 */
const otherThanPoint: readonly string[] = baseTypes.filter((name) => name !== "point");

/**
 * Report whether a response declaration may hold a `qti-area-mapping`: its base type is `point`
 * (info.txt:39388), and it is no record, which has no base type (reading 153). Each half reads one
 * attribute and judges only where it spells a code (reading 158), so a base type unwritten, unknown
 * or spelling nothing is not refused here: a record is refused by its cardinality alone, and
 * another declaration that writes no base type is `missing-attribute` alone ({@link checkUntyped}).
 *
 * @param declaration The response declaration.
 * @returns Whether its area mapping is placed.
 */
const holdsAreaMapping = (declaration: SourceElement): boolean =>
  !declares(declaration, "base-type", otherThanPoint) &&
  !declares(declaration, "cardinality", ["record"]);

/**
 * The declarations whose `qti-default-value` and `qti-correct-response` hold their values.
 */
const declarations: ReadonlySet<string> = new Set([
  "qti-outcome-declaration",
  "qti-response-declaration",
  "qti-template-declaration",
]);

/**
 * Report whether a declaration's `cardinality` spells one of some cardinalities, compared exactly
 * as written: the XSD types it as an enumeration of `xs:string`, whose whiteSpace is `preserve`.
 * One that is unwritten, holds an unexpanded entity reference or spells no cardinality spells none
 * of them, so no row that reads the cardinality judges its declaration; its value domain, or the
 * XSD's required attribute, refuses it alone (reading 158).
 *
 * @param declaration The declaration.
 * @param cardinalities The cardinalities.
 * @returns Whether its `cardinality` is one of them.
 */
const spellsCardinality = (declaration: SourceElement, cardinalities: readonly string[]): boolean =>
  declares(declaration, "cardinality", cardinalities);

/**
 * Report whether a parent is a declaration whose `cardinality` is `single`, compared exactly as
 * written: the XSD types it as an enumeration of `xs:string`, with no whitespace facet.
 *
 * @param parent The parent of a value container.
 * @returns Whether its values are one value.
 */
const isSingleDeclaration = (parent: Option.Option<SourceElement>): boolean =>
  Option.exists(
    parent,
    (declaration) =>
      declaration.namespace === qtiNamespace &&
      declarations.has(declaration.local) &&
      declaration.attributes.some(
        (attribute) =>
          attribute.namespace === "" &&
          attribute.local === "cardinality" &&
          attribute.value === "single",
      ),
  );

/**
 * The identifiers of the built-in session variables, which "are reserved" (info.txt:12006), so no
 * declaration in an item, or in a document whose root is a declaration, may take one: the qti
 * package refuses such a declaration of any kind by its `Declaration not reserved` law
 * (`packages/pantry/src/qti/declarations.ts`). A test reserves fewer,
 * {@link testReservedIdentifiers} (reading 168). An identifier is an NCName, compared exactly after
 * collapse, so `Duration` is another name.
 */
const reservedIdentifiers: ReadonlySet<string> = new Set([
  "completionStatus",
  "duration",
  "numAttempts",
]);

/**
 * The identifiers a declaration in a test may not take. Reading 168 ("A test may declare a variable
 * named `numAttempts` or `completionStatus`; in a test only `duration` is reserved"): a test's
 * processing holds `duration` as a built-in and neither of the other two, so a test's declaration
 * of either shadows no built-in of the test. The qti package's `Declaration not reserved` law is
 * narrowed alike.
 */
const testReservedIdentifiers: ReadonlySet<string> = new Set(["duration"]);

/**
 * The identifiers each kind of document reserves, with the values its declarations may take, for
 * the wording: whether the row judges a declaration in a test ({@link inTest}), the identifiers it
 * reserves there, and `expected`. Every declaration sits in a test or not, so exactly one row
 * judges it.
 */
const reservedIdentifierRows = [
  [
    false,
    reservedIdentifiers,
    "an identifier other than the built-in variables' completionStatus, numAttempts and duration",
  ],
  [true, testReservedIdentifiers, "an identifier other than the built-in variable duration"],
] as const;

/**
 * Each declaration, with the line of the information model that keeps the built-in variables'
 * identifiers from it. An outcome's, a response's and a template's `identifier` each say "The
 * identifiers of the built-in session variables are reserved"; a context declaration's says "All
 * item variables declared in an item share the same namespace", the namespace the built-in
 * variables are in.
 */
const reservingDeclarations = [
  ["qti-context-declaration", "info.txt:22603"],
  ["qti-outcome-declaration", "info.txt:12006"],
  ["qti-response-declaration", "info.txt:39226"],
  ["qti-template-declaration", "info.txt:45843"],
] as const;

/**
 * The declarations of a variable, one of each kind, each with a `cardinality` and a `base-type`,
 * of which the information model says "Variables with record cardinality have no base-type"
 * (info.txt:12060, :22682, :39280, :45897).
 */
const variableDeclarations: ReadonlySet<string> = new Set(
  reservingDeclarations.map(([element]) => element),
);

/**
 * The outcomes whose base type the information model fixes, each with that base type, the line its
 * refusal cites and whether the type holds in a test too. The outcome declaration's description
 * (§4.5, info.txt:11979) says "SCORE needs to be a float" and "MAXSCORE needs to be a float" of
 * items ("Items that declare a numeric outcome variable", "Items that declare a maximum score"),
 * so they are typed in an item and any base type in a test; it says "PASSED needs to be a boolean"
 * of "Items or tests", so it is typed in both. Each row's line is §2.2.2.3's restatement of the
 * same sentence (info.txt:8478, :8480, :8482). A typed outcome is a value of its base type, so it
 * is no record (reading 153), wherever its type holds. Plate accepts a test's SCORE and MAXSCORE of
 * any base type as the operator ruled (P8), which main now shares as reading 163 ("SCORE's and
 * MAXSCORE's float rule binds items only; PASSED's boolean rule binds items and tests"): main
 * accepts such a test, and the qti package's `Reserved type` law
 * (`packages/pantry/src/qti/declarations.ts`) accepts one declared `record` too.
 */
const typedOutcomes = [
  ["SCORE", "float", "info.txt:8478", false],
  ["MAXSCORE", "float", "info.txt:8480", false],
  ["PASSED", "boolean", "info.txt:8482", true],
] as const;

/**
 * Report whether an element sits in a test: its document's root is a QTI `qti-assessment-test`,
 * whose path step {@link walk} writes as the bare local name, so every descendant's path starts
 * with it and a `/`.
 *
 * @param path The element's path.
 * @returns Whether the element is below a test's root.
 */
const inTest = (path: string): boolean => path.startsWith("qti-assessment-test/");

/**
 * Report whether an outcome declaration is one a row of {@link typedOutcomes} types: it is named
 * the row's outcome, and its document is one where the row's type holds. A row typed in an item
 * only does not type a declaration in a test ({@link inTest}); in every other document, an item and
 * a lone declaration included, it does.
 *
 * The identifier is compared exactly after collapse, as {@link reservedIdentifiers} compares it, so
 * `Score` is another name; one that holds an unexpanded entity reference is unknown and is typed by
 * no row.
 *
 * @param identifier The outcome the row types.
 * @param inTests Whether the row's type holds in a test too.
 * @param element The declaration.
 * @param path Its path.
 * @returns Whether the row types it.
 */
const typedHere = (
  identifier: string,
  inTests: boolean,
  element: SourceElement,
  path: string,
): boolean => {
  const named = element.attributes.find(
    (attribute) => attribute.namespace === "" && attribute.local === "identifier",
  );

  return (
    named !== undefined &&
    named.references.length === 0 &&
    collapse(named.value) === identifier &&
    (inTests || !inTest(path))
  );
};

/**
 * Report whether an outcome declaration's `base-type` is the one its identifier needs, as the qti
 * package's `ReservedOutcomeTypes` reads it.
 *
 * A declaration whose `cardinality` is `record` holds here, for a record has no base type (reading
 * 153): a typed one is refused at its `cardinality` ({@link valuedAs}), and the `base-type` a
 * record writes is `unknown-attribute` ({@link isRecordBaseType}), so its base type is not judged
 * a third time; one cause is refused under one rule.
 *
 * @param identifier The outcome the row types.
 * @param baseType The base type that outcome must have.
 * @param inTests Whether that base type holds in a test too.
 * @returns Whether a collapsed `base-type` meets the row on its declaration at its path.
 */
const typedAs =
  (identifier: string, baseType: string, inTests: boolean) =>
  (lexical: string, element: SourceElement, path: string): boolean =>
    lexical === baseType ||
    !typedHere(identifier, inTests, element, path) ||
    spellsCardinality(element, ["record"]);

/**
 * Report whether an outcome declaration's `cardinality` lets it hold a value of the base type its
 * identifier needs. The information model types SCORE and MAXSCORE as floats and PASSED as a
 * boolean (§4.5, info.txt:11979), and a record has no base type (reading 153), so a typed outcome
 * declared `record` is refused at its `cardinality`, whether or not it writes a `base-type`. A
 * test's SCORE and MAXSCORE are typed by no row, so a test may declare them `record` (P8).
 *
 * @param identifier The outcome the row types.
 * @param inTests Whether the row's type holds in a test too.
 * @returns Whether a `cardinality`, in its value domain, meets the row on its declaration at its
 *   path.
 */
const valuedAs =
  (identifier: string, inTests: boolean) =>
  (lexical: string, element: SourceElement, path: string): boolean =>
    lexical !== "record" || !typedHere(identifier, inTests, element, path);

/**
 * Report whether a row of {@link reservedIdentifierRows} leaves a declaration its `identifier`: the
 * row judges only a declaration in the kind of document it is for, a test or any other
 * ({@link inTest}), and holds for every other.
 *
 * @param inTests Whether the row is for a declaration in a test.
 * @param reserved The identifiers the row reserves.
 * @returns Whether a collapsed `identifier` meets the row on its declaration at its path.
 */
const unreservedIn =
  (inTests: boolean, reserved: ReadonlySet<string>) =>
  (lexical: string, _element: SourceElement, path: string): boolean =>
    inTest(path) !== inTests || !reserved.has(lexical);

/**
 * A number in `xs:double`'s lexical space that is above 0 but for `INF`, read off the number as
 * written (reading 121): no `-` sign and a mantissa digit other than 0. No character of the class
 * crosses the exponent's `E` or `e`, so the digit is the mantissa's and `0e5` has none, and the
 * pattern checks in linear time. `NaN` and `-INF` have no such digit.
 */
const positiveMantissa = /^\+?[.0-9]*[1-9]/u;

/**
 * Report whether a collapsed `tolerance` is what reading 121 ("every `tolerance` is one or two
 * values, each number among them above 0") reads the information model to allow: "two positive
 * numbers, t0 and t1 ... If only one value is given it is used for both" (§5.46.2), each value of
 * its ToleranceList "either strings (must not contain a space) or numbers" (§9.1.5).
 *
 * A value in `xs:double`'s lexical space under XML Schema 1.0 is a number; any other value is a
 * string, which names a variable read at run time and is not judged here, so `1,5` and `+INF`,
 * which XML Schema 1.0 does not admit as a double, are accepted. A number is positive as written,
 * by its sign and a mantissa digit other than 0, not by its nearest double: `0`, `-0`, `0e5`, `-1`,
 * `NaN` and `-INF` are refused, and `INF` and `1e-400` accepted. The count binds in every mode, so
 * an empty `tolerance` holds no value and is refused, and so are three values. Pantry's "Equal
 * tolerance" law (`packages/pantry/src/qti/operators.ts`) judges the count and the sign alike.
 *
 * @param lexical The `tolerance`, collapsed.
 * @returns Whether it is one or two values, each a number above 0 or a variable's name.
 */
const toleranceTokens = (lexical: string): boolean => {
  const values = lexical.split(" ");

  return (
    lexical !== "" &&
    values.length <= 2 &&
    values.every(
      (value) => !doubleLexical.test(value) || value === "INF" || positiveMantissa.test(value),
    )
  );
};

/**
 * One piece of a printed variable's `format` that begins with `%`: the escape `%%`, or a conversion
 * specifier, a `%`, flags from `#`, `0`, space, `+` and `-`, a width, a precision of a point
 * "followed by zero or more digits" (info.txt:8686), so `%.f` is one, and a conversion code.
 *
 * The codes are the information model's, `E e f G g r R i o X x` (reading 132), and `d`, which
 * prints as `%i`: the operator's ruling on P1, which main now shares as reading 171 ("A printed
 * variable's `format` may use `d` as a conversion code"), adding `d` to the codes of readings 132
 * and 161.
 *
 * The width cannot start with `0`, so no character can end the flags and start the width. A
 * pattern whose flags and width both match `0` makes a refused `%`, a run of zeros and a letter
 * that is no code backtrack over every split of the run, quadratic time on an untrusted attribute
 * (review `079e8c44` P2-13). A `0` after the flags is a flag here, so the pattern admits exactly
 * the pieces a width of any digits admits, and each attempt takes time linear in the run it reads.
 */
const printfPiece = /%(?:%|[#0 +-]*(?:[1-9][0-9]*)?(?:\.[0-9]*)?[EefGgrRioXxd])/gu;

/**
 * Report whether a printed variable's `format` is a printf format string, as reading 132 reads the
 * information model's syntax (§2.3.4), reading 161 its count and reading 171 its codes: any text
 * but `%`, the escape `%%`, and conversion specifiers ({@link printfPiece}), any number of them,
 * none included. So `%d`, `%d %d`, `%i of %i`, `Score: %.1f`, `100%%` and a format of text alone
 * are formats, and `%q`, `%u` and a trailing `%`, which ends in no code, are not (the operator's
 * B2c).
 *
 * Every escape and specifier is removed, left to right; a `%` left over begins neither. Pantry's
 * `printfFormat` grammar (`packages/pantry/src/grammar/attributes.ts`) admits the same formats,
 * over the information model's codes and `d` (reading 171, "a printed variable's `format` may use
 * `d` as a conversion code").
 *
 * @param lexical The `format`, its tabs and line breaks replaced.
 * @returns Whether every `%` in it begins an escape or a conversion specifier.
 */
const printfFormat = (lexical: string): boolean =>
  !lexical.replaceAll(printfPiece, "").includes("%");

/**
 * Report whether an integer count, already in its XSD type, is at least 1.
 *
 * @param lexical The count, collapsed.
 * @returns Whether it is an integer of 1 or more.
 */
const atLeastOne = (lexical: string): boolean =>
  integerLexical.test(lexical) && BigInt(lexical) >= 1n;

/**
 * Accept an element whose parent is a QTI element of one of some names, for a row that holds by
 * where its element sits.
 *
 * @param locals The parents' local names.
 * @returns Whether an element's parent is one of them.
 */
const childOf =
  (...locals: readonly string[]) =>
  (_element: SourceElement, parent: Option.Option<SourceElement>): boolean =>
    Option.exists(
      parent,
      (container) => container.namespace === qtiNamespace && locals.includes(container.local),
    );

/**
 * Report whether a `track` is in HTML's subtitles state: it writes no `kind`, whose missing value
 * default is that state (reading 125), or writes `kind="subtitles"` exactly, as the XSD's
 * enumeration of `xs:string` compares it. A `kind` that holds an unexpanded entity reference is
 * unknown, and is in no state.
 *
 * @param track The track.
 * @returns Whether it is in the subtitles state.
 */
const inSubtitlesState = (track: SourceElement): boolean => {
  const kind = track.attributes.find(
    (attribute) => attribute.namespace === "" && attribute.local === "kind",
  );

  return kind === undefined || (kind.references.length === 0 && kind.value === "subtitles");
};

/**
 * Report whether a URL holds a character other than a space, as the information model's "a valid
 * non-empty URL potentially surrounded by spaces" requires (reading 124). The value is read with
 * each tab and line break replaced by a space, as its `xs:normalizedString` type reads it.
 *
 * @param lexical The URL, its tabs and line breaks replaced.
 * @returns Whether it is not blank.
 */
const isNonBlank = (lexical: string): boolean => nonXmlSpace.test(lexical);

/**
 * RFC 2045's media type, `type "/" subtype` (section 5.1), as reading 135 reads it: each a `token`,
 * one or more US-ASCII characters other than space, the control characters and the tspecials
 * `( ) < > @ , ; : \ " / [ ] ? =`. No character of a token is a slash, so the pattern checks in
 * linear time.
 *
 * @see https://www.rfc-editor.org/rfc/rfc2045#section-5.1
 */
const mimeType = /^[!#$%&'*+.^_`{|}~0-9A-Za-z-]+\/[!#$%&'*+.^_`{|}~0-9A-Za-z-]+$/u;

/**
 * Report whether a collapsed list holds only MIME types, each as {@link mimeType} reads one. The
 * empty list is admitted, as the XSD's list type admits it.
 *
 * @param lexical The list, collapsed.
 * @returns Whether every item is a MIME type.
 */
const isMimeTypeList = (lexical: string): boolean =>
  lexical === "" || lexical.split(" ").every((item) => mimeType.test(item));

/**
 * Report whether a text is a well-formed BCP 47 language tag or empty, the values reading 129 gives
 * `lang` and, on every element but an item's and a stimulus's root, `xml:lang`.
 *
 * @param lexical The value, read under its whitespace facet.
 * @returns Whether it is a language tag or empty.
 */
const isLanguageOrEmpty = (lexical: string): boolean => lexical === "" || isLanguageTag(lexical);

/**
 * The QTI elements whose `xml:lang` is a language tag and never empty: the item's and the
 * stimulus's `language`, "Natural language identifiers as defined by [BCP 47]" (information model,
 * sections 4.1.4 and 4.3.4), which state no empty value (reading 129).
 */
const languageRoots: ReadonlySet<string> = new Set([
  "qti-assessment-item",
  "qti-assessment-stimulus",
]);

/**
 * Report whether an element is one of {@link languageRoots}.
 *
 * @param element The element.
 * @returns Whether its `xml:lang` may not be empty.
 */
const isLanguageRoot = (element: SourceElement): boolean =>
  element.namespace === qtiNamespace && languageRoots.has(element.local);

/**
 * What a MIME type admits, for the wording of its refusal.
 */
const mimeTypeText =
  "a type and a subtype joined by one slash, each one or more ASCII letters, digits or the characters ! # $ % & ' * + - . ^ _ ` { | } ~";

/**
 * The shared readings this module applies over the XSD's rules, one row each.
 *
 * Every refusal a row gives carries the row's reading in its detail, as `reading`, which the
 * verdict's wording cites; a `child-count` refusal carries `source`, a reading or a specification
 * line, instead, and so does the refusal of an information-model row, its line of `info.txt`. A
 * narrowed attribute that the information model settles carries, beside `source`, the `check` that
 * names its case and the qti package's rule, `pantry`. A placement the information model settles
 * carries neither: its line and the qti package's rule are in the row's comment.
 */
const readingRows: readonly ReadingRow[] = [
  // Reading 8 ("a match table entry's `target-value` is a value of the outcome's base type"): of
  // the enclosing outcome's, not one of the base-type names the XSD enumerates. The prose
  // rules' `value-type` reads it; its padding stays reading 7's.
  {
    attribute: "target-value",
    element: "qti-match-table-entry",
    kind: "retyped-attribute",
    reading: "8",
  },
  // Reading 13 ("a `data-*` attribute name is `data-[a-z0-9_.-]+`, with no namespace"), even
  // where an attribute wildcard would admit any name.
  { kind: "attribute-name", pattern: /^data-[a-z0-9_.-]+$/u, prefix: "data-", reading: "13" },
  // Reading 16 ("`normal-maximum` is greater than zero"), where the XSD's `NonNegativeDoubleDType`
  // admits 0. It compares the number, so `0`, `0.0`, `-0` and `0e0` all fail.
  {
    attribute: "normal-maximum",
    elements: ["qti-outcome-declaration"],
    expected: "a double greater than 0",
    holds: (lexical) => Option.exists(doubleValue(lexical), (read) => read > 0),
    kind: "narrowed-attribute",
    settled: { reading: "16" },
    whiteSpace: "collapse",
  },
  // Reading 17 ("a `view` list has at least one view"), where the XSD's list admits none.
  {
    attribute: "view",
    elements: "declaring",
    expected: "a list of at least one view",
    holds: (lexical) => lexical !== "",
    kind: "narrowed-attribute",
    settled: { reading: "17" },
    whiteSpace: "collapse",
  },
  // Reading 18 ("an order or graphic-order interaction's `min-choices`, where written, is from 1
  // to its number of choices, and a `max-choices` written beside it is from `min-choices` to its
  // number of choices"): `min-choices` is at least 1, where the XSD admits 0. This row holds that
  // floor alone. The prose rules (D4a) hold each count to the interaction's number of choices, and
  // a `max-choices` written beside a `min-choices` to at least that `min-choices`, with no
  // exemption for 0: neither interaction gives `max-choices="0"` the choice interaction's meaning
  // of no limit.
  {
    attribute: "min-choices",
    elements: ["qti-graphic-order-interaction", "qti-order-interaction"],
    expected: "an integer at least 1",
    holds: atLeastOne,
    kind: "narrowed-attribute",
    settled: { reading: "18" },
    whiteSpace: "collapse",
  },
  // Reading 92 ("the information model's binding and count sentences that no other reading
  // restates hold as written"): a position object interaction's `min-choices`, where written, is
  // at least 1, "If specified, min-choices must be 1 or greater" (section 5.107.2), where the XSD
  // admits 0.
  {
    attribute: "min-choices",
    elements: ["qti-position-object-interaction"],
    expected: "an integer at least 1",
    holds: atLeastOne,
    kind: "narrowed-attribute",
    settled: { reading: "92" },
    whiteSpace: "collapse",
  },
  // Reading 20 ("a PCI has exactly one `qti-interaction-markup`, which may be empty").
  {
    applies: anywhere,
    child: "qti-interaction-markup",
    counted: ["qti-interaction-markup"],
    elements: ["qti-portable-custom-interaction"],
    kind: "child-count",
    refuses: (count) => count !== 1,
    required: "exactly one",
    source: "reading 20",
  },
  // Reading 21 ("`qti-repeat` has one or more operands"): at least one operand, any child
  // element.
  {
    applies: anywhere,
    child: "operand",
    counted: "any",
    elements: ["qti-repeat"],
    kind: "child-count",
    refuses: (count) => count === 0,
    required: "at least one",
    source: "reading 21",
  },
  // No row counts a card's or a card entry's children: one with no content is accepted, as the
  // operator ruled (P5, overseer `b7d702d6`), which main now shares as reading 31 ("A card holds an
  // HTML content node, file hrefs, both, or nothing").
  // Reading 22 ("a `qti-template-constraint` is a direct child of `qti-template-processing`"),
  // where the XSD also admits it in the template conditions' branches.
  {
    admits: anywhere,
    container: "qti-template-processing",
    elements: ["qti-template-constraint"],
    kind: "placement",
    reading: Option.some("22"),
    requires: "a direct child of qti-template-processing",
    roots: anywhere,
    within: "parent",
  },
  // Reading 23 ("the eight outcome-only expressions are forbidden outside outcome processing"):
  // they sit inside outcome processing, so in an item, which holds none, every one is misplaced.
  // In a test or a section the test prose rules refuse a misplaced one as `expression-placement`,
  // once.
  {
    admits: anywhere,
    container: "qti-outcome-processing",
    elements: [
      "qti-number-correct",
      "qti-number-incorrect",
      "qti-number-presented",
      "qti-number-responded",
      "qti-number-selected",
      "qti-outcome-maximum",
      "qti-outcome-minimum",
      "qti-test-variables",
    ],
    kind: "placement",
    reading: Option.some("23"),
    requires: "inside qti-outcome-processing",
    roots: outsideTests,
    within: "ancestor",
  },
  // Reading 38 ("a `qti-gap` appears only within a gap-match interaction, and a `qti-hottext` may
  // appear in any flow or inline content"): the row also refuses a gap in a graphic gap-match
  // interaction's gap text. Nothing refuses a hottext outside a hottext interaction, nor a gap text
  // holding gaps, which the reading leaves alone.
  {
    admits: anywhere,
    container: "qti-gap-match-interaction",
    elements: ["qti-gap"],
    kind: "placement",
    reading: Option.some("38"),
    requires: "inside a qti-gap-match-interaction",
    roots: anywhere,
    within: "ancestor",
  },
  // The information model maps "a source set of any base-type (except file and duration)"
  // (info.txt:34086), and `qti-map-response` "cannot be applied to variables of record
  // cardinality" (info.txt:9306), so a response declaration of base type file or duration, or of
  // cardinality record, holds no `qti-mapping`: reading 78 ("a mapping maps a base type other
  // than `file` and `duration`, of a variable that is not a record"). The qti package refuses it
  // as `mapping-base-type` (the `MappableBaseType` law in `packages/pantry/src/qti/mapping.ts`).
  {
    admits: holdsMapping,
    container: "qti-response-declaration",
    elements: ["qti-mapping"],
    kind: "placement",
    reading: Option.none(),
    requires:
      "in a qti-response-declaration whose base type is neither file nor duration and whose cardinality is not record",
    roots: anywhere,
    within: "parent",
  },
  // An area mapping "may only be present in declarations of variables with base-type point"
  // (info.txt:39388): reading 99 ("an area mapping maps points"). The qti package refuses it as
  // `mapping-base-type` (the `AreaMapping base type` law in `packages/pantry/src/qti/mapping.ts`).
  {
    admits: holdsAreaMapping,
    container: "qti-response-declaration",
    elements: ["qti-area-mapping"],
    kind: "placement",
    reading: Option.none(),
    requires:
      "in a qti-response-declaration whose base type is point and whose cardinality is not record",
    roots: anywhere,
    within: "parent",
  },
  // Reading 46 ("a count attribute holds a signed 64-bit integer"), read exactly: the eight
  // interaction counts, `xs:nonNegativeInteger` in the XSD, and `figures` on `qti-round-to` and
  // `qti-equal-rounded`, an `xs:integer` or a template variable's name.
  {
    attributes: [
      "figures",
      "match-max",
      "match-min",
      "max-associations",
      "max-choices",
      "max-plays",
      "min-associations",
      "min-choices",
      "min-plays",
    ],
    greatest: greatestCount,
    kind: "count-range",
    least: leastCount,
    reading: "46",
  },
  // The information model's `figures` (info.txt:25131 for `qti-equal-rounded`, info.txt:39732 for
  // `qti-round-to`): "If rounding-mode="significantFigures", the value of figures must be a non-zero
  // positive integer. If rounding-mode="decimalPlaces", the value of figures must be an integer
  // greater than or equal to zero", as pantry's `EqualRoundedFigures` and `RoundToFigures` (P10)
  // refuse. `qti-equal-rounded`'s mode defaults to `significantFigures`; `qti-round-to`'s has no
  // default, so one it lacks is `missing-attribute` and its `figures` is not compared.
  {
    attribute: "figures",
    element: "qti-equal-rounded",
    kind: "integer-floor",
    least: 0n,
    source: "info.txt:25131",
    when: Option.some({ attribute: "rounding-mode", value: "decimalPlaces" }),
  },
  {
    attribute: "figures",
    element: "qti-equal-rounded",
    kind: "integer-floor",
    least: 1n,
    source: "info.txt:25131",
    when: Option.some({ attribute: "rounding-mode", value: "significantFigures" }),
  },
  {
    attribute: "figures",
    element: "qti-round-to",
    kind: "integer-floor",
    least: 0n,
    source: "info.txt:39732",
    when: Option.some({ attribute: "rounding-mode", value: "decimalPlaces" }),
  },
  {
    attribute: "figures",
    element: "qti-round-to",
    kind: "integer-floor",
    least: 1n,
    source: "info.txt:39732",
    when: Option.some({ attribute: "rounding-mode", value: "significantFigures" }),
  },
  // The information model's `qti-index` (info.txt:9426): "n must be a positive integer", as
  // pantry's `IndexPositive` (P11) refuses. `qti-repeat`'s `number-repeats` (pantry's `RepeatInt`,
  // P6) needs no row: its XSD type, an NCName or an `xs:int`, already refuses an integer outside
  // `xs:int` as `attribute-type`.
  {
    attribute: "n",
    element: "qti-index",
    kind: "integer-floor",
    least: 1n,
    source: "info.txt:9426",
    when: Option.none(),
  },
  // The information model's `qti-equal` (info.txt:24946): "If the tolerance mode is absolute or
  // relative then the tolerance must be specified", as pantry (P36) refuses an absolute or relative
  // `Equal` with no `Tolerance` row. A `tolerance` written empty is specified, and holds no value,
  // which its own row refuses (reading 121); `tolerance-mode` defaults to `exact`, which needs none.
  {
    attribute: "tolerance",
    element: "qti-equal",
    kind: "conditional-attribute",
    source: "info.txt:24946",
    when: { attribute: "tolerance-mode", value: "absolute" },
  },
  {
    attribute: "tolerance",
    element: "qti-equal",
    kind: "conditional-attribute",
    source: "info.txt:24946",
    when: { attribute: "tolerance-mode", value: "relative" },
  },
  // The information model reserves the built-in session variables' identifiers, `completionStatus`,
  // `numAttempts` and `duration`, from every declaration (info.txt:12006, :22603, :39226, :45843),
  // as pantry's `DeclarationNotReserved` refuses a declaration of any kind that takes one.
  // Admitted, such a declaration would shadow the built-in it names. Reading 168 ("A test may
  // declare a variable named `numAttempts` or `completionStatus`; in a test only `duration` is
  // reserved") narrows it in a test, whose processing holds neither of the other two: an item, and
  // a document whose root is a declaration, keep all three reserved.
  ...reservingDeclarations.flatMap(([element, source]): readonly NarrowedAttribute[] =>
    reservedIdentifierRows.map(([inTests, reserved, expected]): NarrowedAttribute => ({
      attribute: "identifier",
      elements: [element],
      expected,
      holds: unreservedIn(inTests, reserved),
      kind: "narrowed-attribute",
      settled: { check: "reserved-identifier", pantry: "DeclarationNotReserved", source },
      whiteSpace: "collapse",
    })),
  ),
  // The information model fixes the base types of three outcomes: an item's SCORE and MAXSCORE are
  // floats, and an item's or a test's PASSED a boolean (§4.5, info.txt:11979); a test's SCORE and
  // MAXSCORE may be of any base type, a record included (P8). A record has no base type (reading
  // 153), so a typed outcome declared `record` is refused at its `cardinality`. Main now shares P8
  // as reading 163 ("SCORE's and MAXSCORE's float rule binds items only; PASSED's boolean rule binds
  // items and tests"): pantry's `Reserved type` law accepts a test's SCORE and MAXSCORE of any base
  // type, a record included, as plate does.
  // A response or template declaration of those names is not an outcome.
  ...typedOutcomes.flatMap(
    ([identifier, baseType, source, inTests]): readonly NarrowedAttribute[] => [
      {
        attribute: "base-type",
        elements: ["qti-outcome-declaration"],
        expected: `${baseType}, the base type of an outcome named ${identifier}`,
        holds: typedAs(identifier, baseType, inTests),
        kind: "narrowed-attribute",
        settled: {
          baseType,
          check: "reserved-outcome-type",
          identifier,
          pantry: "ReservedOutcomeTypes",
          source,
        },
        whiteSpace: "collapse",
      },
      {
        attribute: "cardinality",
        elements: ["qti-outcome-declaration"],
        expected: `single, multiple or ordered: an outcome named ${identifier} has the base type ${baseType}, and a record has none`,
        holds: valuedAs(identifier, inTests),
        kind: "narrowed-attribute",
        settled: {
          baseType,
          check: "reserved-outcome-type",
          identifier,
          pantry: "ReservedOutcomeTypes",
          reading: "153",
        },
        whiteSpace: "collapse",
      },
    ],
  ),
  // Reading 121: the information model's `tolerance` (info.txt:24946) is two positive numbers, t0
  // and t1, or one for both, in every mode, and a value that is not a number is a string that names
  // a variable read at run time, such as `1,5`. The XSD's unbounded list of `xs:string` and
  // `xs:double` bounds neither the count nor the sign (see toleranceTokens).
  {
    attribute: "tolerance",
    elements: ["qti-equal"],
    expected: "one or two values, one space apart, each a number above 0 or a variable's name",
    holds: toleranceTokens,
    kind: "narrowed-attribute",
    settled: { check: "tolerance-token", reading: "121" },
    whiteSpace: "collapse",
  },
  // The information model's printed variable `format` is "The format conversion specifier"
  // (info.txt:70323), whose syntax is a C `printf` conversion (info.txt:8686). Readings 132 and 161
  // read it as a printf format string of any number of conversions over the listed codes, and
  // reading 171 ("A printed variable's `format` may use `d` as a conversion code"), the operator's
  // ruling on P1, adds `d`, so `%d`, `%i of %i`, `Score: %.1f` and `100%%` are formats,
  // and `%q`, `%u` and a trailing `%` are not (see printfFormat). The `xs:normalizedString` is
  // read with its tabs and line breaks replaced, so text around a conversion is any text.
  {
    attribute: "format",
    elements: ["qti-printed-variable"],
    expected:
      "a printf format: any text, %% for a percent sign, and conversions, each a %, then any of the flags #, 0, space, + and -, an optional width, an optional precision of a point and zero or more digits, and one of the codes E, e, f, G, g, r, R, i, o, X, x and d",
    holds: printfFormat,
    kind: "narrowed-attribute",
    settled: { check: "printf-format", reading: "132" },
    whiteSpace: "replace",
  },
  // Single cardinality is "a single value" (info.txt:73049, the information model's
  // `CardinalityEnum`), so the default or correct value of a single declaration holds one
  // `qti-value`, where the XSD admits one or more. Only more than one is refused here: none is the
  // XSD's own minimum, which the walk leaves unchecked as it leaves every XSD count.
  {
    applies: isSingleDeclaration,
    child: "qti-value",
    counted: ["qti-value"],
    elements: ["qti-correct-response", "qti-default-value"],
    kind: "child-count",
    refuses: (count) => count > 1,
    required: "exactly one",
    source: "info.txt:73049",
  },
  // Reading 9 ("the Schematron's rules are read by their intent, not their text"): its two ARIA
  // role rules bind. RULE ARIA ROLE 1a, "The 'source' tag must not have an ARIA role attribute",
  // withdraws the `role` the XSD declares on `source`.
  { attribute: "role", element: "source", kind: "withdrawn-attribute", reading: "9" },
  // RULE ARIA ROLE 1b, "The 'h1' tag may have an ARIA role value of 'heading' or 'tab' or
  // 'presentation' only", where the XSD lists 74 roles. `h2` to `h6` keep every role it lists. The
  // XSD's enumeration of `xs:string` has already compared the value as written.
  {
    attribute: "role",
    elements: ["h1"],
    expected: "heading, tab or presentation, the roles an h1 may take",
    holds: (lexical) => lexical === "heading" || lexical === "tab" || lexical === "presentation",
    kind: "narrowed-attribute",
    settled: { reading: "9" },
    whiteSpace: "replace",
  },
  // Reading 123 ("a `bdo` carries `dir`, and its value is `ltr` or `rtl`"): "Authors must specify
  // the dir attribute on this tag" and "The auto value must not be specified" (information model,
  // section 5.11), where the XSD declares `dir` optional with the default `auto`. The default is
  // never read, since a valid `bdo` writes the attribute. Every other element's `dir` keeps `auto`.
  {
    applies: anywhere,
    attribute: "dir",
    element: "bdo",
    kind: "required-attribute",
    reading: "123",
  },
  {
    attribute: "dir",
    elements: ["bdo"],
    expected: "ltr or rtl, the directions a bdo overrides to",
    holds: (lexical) => lexical !== "auto",
    kind: "narrowed-attribute",
    settled: { reading: "123" },
    whiteSpace: "replace",
  },
  // Reading 124 ("a `source` in a `picture` carries `srcset`, and one in an `audio` or a `video`
  // carries `src`"), by the parent, as the HTML Standard the Source class restates splits the two.
  // A `source` QTI admits elsewhere is bound by neither.
  {
    applies: childOf("picture"),
    attribute: "srcset",
    element: "source",
    kind: "required-attribute",
    reading: "124",
  },
  {
    applies: childOf("audio", "video"),
    attribute: "src",
    element: "source",
    kind: "required-attribute",
    reading: "124",
  },
  // Reading 124: each media URL is "a valid non-empty URL potentially surrounded by spaces", so it
  // holds a character other than a space, where the XSD's `xs:normalizedString` admits the empty
  // and the blank value: an `audio`'s and a `video`'s `src`, a `video`'s `poster`, a `source`'s
  // `src` and its `srcset`. Spaces around the URL are admitted. The URL's own syntax is the
  // reading's stated limit.
  {
    attribute: "src",
    elements: ["audio", "source", "video"],
    expected: "a URL holding a character other than a space",
    holds: isNonBlank,
    kind: "narrowed-attribute",
    settled: { reading: "124" },
    whiteSpace: "replace",
  },
  {
    attribute: "poster",
    elements: ["video"],
    expected: "a URL holding a character other than a space",
    holds: isNonBlank,
    kind: "narrowed-attribute",
    settled: { reading: "124" },
    whiteSpace: "replace",
  },
  {
    attribute: "srcset",
    elements: ["source"],
    expected: "a URL holding a character other than a space",
    holds: isNonBlank,
    kind: "narrowed-attribute",
    settled: { reading: "124" },
    whiteSpace: "replace",
  },
  // Reading 125 ("a `track` in the subtitles state carries `srclang`, and a `track` with no `kind`
  // is in that state"), HTML's missing value default; a `track` of another state need not. Its
  // `src`, which the XSD already requires, is read as reading 124 reads a media URL.
  {
    applies: inSubtitlesState,
    attribute: "srclang",
    element: "track",
    kind: "required-attribute",
    reading: "125",
  },
  {
    attribute: "src",
    elements: ["track"],
    expected: "a URL holding a character other than a space",
    holds: isNonBlank,
    kind: "narrowed-attribute",
    settled: { reading: "125" },
    whiteSpace: "replace",
  },
  // Reading 129 ("`xml:lang`, `lang` and a track's `srclang` hold BCP 47 language tags,
  // well-formed as RFC 5646 defines them"), where the XSD's `xs:normalizedString` admits any
  // value: `lang`, on every element that declares it, is a tag or empty, its `replace` whitespace
  // kept, so `lang="en "` is refused; a track's `srclang` is a tag and never empty. Validity
  // against the IANA registry is the reading's stated limit.
  {
    attribute: "lang",
    elements: "declaring",
    expected: "a well-formed BCP 47 language tag, or empty",
    holds: isLanguageOrEmpty,
    kind: "narrowed-attribute",
    settled: { reading: "129" },
    whiteSpace: "replace",
  },
  {
    attribute: "srclang",
    elements: ["track"],
    expected: "a well-formed BCP 47 language tag",
    holds: (lexical) => isLanguageTag(lexical),
    kind: "narrowed-attribute",
    settled: { reading: "129" },
    whiteSpace: "replace",
  },
  // Reading 129: `xml:lang`, on every element, is a tag or empty (XML 1.0, section 2.12), its
  // whitespace collapsed as `xs:language` collapses it, and on an item's or a stimulus's root a tag
  // and never empty. XML defines it for every element, so these rows read it on every element the
  // walk visits, in every namespace: each it checks, a manifest's LOM strings among them, and each
  // it passes over laxly, where `xml.xsd`'s type, or the wildcard that admits it, says nothing of
  // its value. What the walk never visits is not read, plate's open limit beside reading 60's: what
  // a `skip` wildcard admits; an element of a namespace plate holds no tables for, such as MathML,
  // that its parent's table names or a `strict` wildcard admits; a QTI root or a manifest nested in
  // lax content (reading 6); and content a complex `xsi:type` keeps unchecked (reading 50); each
  // with everything below it.
  {
    attribute: "lang",
    expected: "a well-formed BCP 47 language tag, which an item or a stimulus may not leave empty",
    holds: (lexical, element) => !isLanguageRoot(element) || isLanguageTag(lexical),
    kind: "xml-attribute",
    reading: "129",
  },
  {
    attribute: "lang",
    expected: "a well-formed BCP 47 language tag, or empty",
    holds: (lexical, element) => isLanguageRoot(element) || isLanguageOrEmpty(lexical),
    kind: "xml-attribute",
    reading: "129",
  },
  // Reading 135 ("a MIME type is RFC 2045's type and subtype: two tokens joined by a slash"), on
  // its nine attributes by their elements' names, where the XSD's pattern also admits a space and
  // the control character U+007F. Registration with IANA is the reading's stated limit.
  {
    attribute: "type",
    elements: ["a", "object", "param", "qti-stylesheet", "source"],
    expected: `a MIME type: ${mimeTypeText}`,
    holds: (lexical) => mimeType.test(lexical),
    kind: "narrowed-attribute",
    settled: { reading: "135" },
    whiteSpace: "replace",
  },
  {
    attribute: "mime-type",
    elements: ["qti-calculator-info", "qti-digital-material", "qti-file-href"],
    expected: `a MIME type: ${mimeTypeText}`,
    holds: (lexical) => mimeType.test(lexical),
    kind: "narrowed-attribute",
    settled: { reading: "135" },
    whiteSpace: "replace",
  },
  {
    attribute: "type",
    elements: ["qti-upload-interaction"],
    expected: `a list of MIME types, each ${mimeTypeText}`,
    holds: isMimeTypeList,
    kind: "narrowed-attribute",
    settled: { reading: "135" },
    whiteSpace: "collapse",
  },
];

/**
 * Keep the rows of {@link readingRows} of one kind.
 *
 * @param kind The rows' kind.
 * @returns Those rows, in the table's order.
 */
const rowsOf = <K extends ReadingRow["kind"]>(
  kind: K,
): readonly Extract<ReadingRow, { kind: K }>[] =>
  readingRows.filter((row): row is Extract<ReadingRow, { kind: K }> => row.kind === kind);

/**
 * The rows that narrow an attribute.
 */
const narrowedAttributes = rowsOf("narrowed-attribute");

/**
 * The rows that retype an attribute.
 */
const retypedAttributes = rowsOf("retyped-attribute");

/**
 * The rows that refuse attribute names.
 */
const attributeNames = rowsOf("attribute-name");

/**
 * The rows that place elements.
 */
const placements = rowsOf("placement");

/**
 * The rows that count children.
 */
const childCounts = rowsOf("child-count");

/**
 * The rows that bound counts.
 */
const countRanges = rowsOf("count-range");

/**
 * The rows that set a floor under an integer literal.
 */
const integerFloors = rowsOf("integer-floor");

/**
 * The rows that require an attribute under a mode.
 */
const conditionalAttributes = rowsOf("conditional-attribute");

/**
 * The rows that require an attribute the XSD makes optional.
 */
const requiredAttributes = rowsOf("required-attribute");

/**
 * The rows that withdraw an attribute the XSD declares.
 */
const withdrawnAttributes = rowsOf("withdrawn-attribute");

/**
 * The rows that narrow an attribute of XML's own namespace.
 */
const xmlAttributes = rowsOf("xml-attribute");

/**
 * Report whether a row's condition holds on an element.
 *
 * @param condition The condition.
 * @param element The element.
 * @param declared The attributes the element's table declares, for a default.
 * @returns Whether the element gives the condition's attribute the condition's value.
 */
const meets = (
  condition: Condition,
  element: SourceElement,
  declared: readonly AttributeTable[],
): boolean =>
  Option.exists(
    modeOf(element, declared, condition.attribute),
    (value) => value === condition.value,
  );

/**
 * The facts a refusal gives the condition its row met: the attribute that sets the mode and the
 * value it has.
 *
 * @param condition The condition.
 * @returns `whenAttribute` and `whenValue`.
 */
const conditionFacts = (condition: Condition) => ({
  whenAttribute: condition.attribute,
  whenValue: condition.value,
});

/**
 * Report whether an attribute's type admits a value.
 *
 * A built-in, an enumeration and a pattern apply their built-in's whitespace first. A list
 * collapses the value and checks each item, an empty list included. A union admits what any member
 * admits, each member applying its own whitespace. A pattern is checked through its JavaScript
 * equivalent in {@link patternEquivalents}, and a pattern with none admits nothing.
 *
 * @param type The attribute's type.
 * @param value The value as written.
 * @returns Whether the value is in the type.
 */
const admits = (type: AttributeType, value: string): boolean => {
  switch (type.kind) {
    case "builtin": {
      const lexical = whitespaced(type.name, value);

      return (
        lexicalChecks[type.name](lexical) &&
        (type.minInclusive === undefined || meetsBound(type.name, lexical, type.minInclusive))
      );
    }
    case "enumeration": {
      return type.values.includes(whitespaced(type.base, value));
    }
    case "list": {
      const items = collapse(value);

      return items === "" || items.split(" ").every((item) => admits(type.item, item));
    }
    case "pattern": {
      const lexical = whitespaced(type.base, value);
      const equivalent = patternEquivalents.get(type.pattern);

      return equivalent !== undefined && lexicalChecks[type.base](lexical) && equivalent(lexical);
    }
    case "union": {
      return type.members.some((member) => admits(member, value));
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Describe the values an attribute's type admits, for the wording of an `attribute-type`
 * refusal.
 *
 * @param type The attribute's type.
 * @returns A phrase such as `nonNegativeInteger`, `one of single, multiple` or `a list of NCName`.
 */
const describeType = (type: AttributeType): string => {
  switch (type.kind) {
    case "builtin": {
      return type.minInclusive === undefined
        ? type.name
        : `${type.name} at least ${type.minInclusive}`;
    }
    case "enumeration": {
      return `one of ${type.values.join(", ")}`;
    }
    case "list": {
      return `a list of ${describeType(type.item)}`;
    }
    case "pattern": {
      return `${type.base} matching ${type.pattern}`;
    }
    case "union": {
      return type.members.map(describeType).join(" or ");
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Report whether a wildcard admits a namespace.
 *
 * `##any` admits every namespace and none. `##other` admits any namespace but the target namespace
 * of the schema that wrote the wildcard, QTI's for QTI's tables, and never none. A list admits its
 * namespaces, `""` standing for none.
 *
 * @param wildcard The element's `xs:any` or `xs:anyAttribute`.
 * @param namespace The namespace of the element or attribute, `""` for none.
 * @param target The namespace of the tables the wildcard is in.
 * @returns Whether the wildcard matches it.
 */
const wildcardAdmits = (wildcard: Wildcard, namespace: string, target: string): boolean => {
  if (wildcard.namespace === "##any") {
    return true;
  }

  if (wildcard.namespace === "##other") {
    return namespace !== "" && namespace !== target;
  }

  return wildcard.namespace.includes(namespace);
};

/**
 * Name an element as a refusal's detail does: its local name in the QTI namespace and
 * `{<namespace>}<local>` otherwise, as its path step spells it.
 *
 * @param element The element.
 * @returns Its name.
 */
const elementName = (element: SourceElement): string =>
  element.namespace === qtiNamespace ? element.local : `{${element.namespace}}${element.local}`;

/**
 * Name an attribute as a refusal's detail does, as its path step spells it without the `@`: its
 * local name in no namespace, `xml:<local>` in the XML namespace and `{<namespace>}<local>`
 * otherwise.
 *
 * @param attribute The attribute's name parts.
 * @returns Its name.
 */
export const attributeName = (attribute: Pick<SourceAttribute, "local" | "namespace">): string => {
  if (attribute.namespace === "") {
    return attribute.local;
  }

  return attribute.namespace === xmlNamespace
    ? `xml:${attribute.local}`
    : `{${attribute.namespace}}${attribute.local}`;
};

/**
 * Report whether an attribute is one the XSD admits on every element without declaring it: a
 * namespace declaration, which the shared reader returns as an attribute, `xsi:schemaLocation` or
 * `xsi:noNamespaceSchemaLocation`.
 *
 * `xsi:type` and `xsi:nil` are not allowances: {@link checkInstance} judges them on every element
 * the walk checks.
 *
 * @param attribute The attribute.
 * @returns Whether it is always allowed.
 */
export const isAllowance = (attribute: SourceAttribute): boolean =>
  attribute.namespace === xmlnsNamespace ||
  (attribute.namespace === xsiNamespace &&
    (attribute.local === "schemaLocation" || attribute.local === "noNamespaceSchemaLocation"));

/**
 * Report whether an attribute is `xsi:type` or `xsi:nil`, which {@link checkInstance} judges and
 * the attribute loop passes over.
 *
 * @param attribute The attribute.
 * @returns Whether it is one of the two.
 */
export const isInstanceAttribute = (attribute: SourceAttribute): boolean =>
  attribute.namespace === xsiNamespace && (attribute.local === "type" || attribute.local === "nil");

/**
 * Look up an element's table, only among the tables' own keys.
 *
 * @param tables The tables.
 * @param local The element's local name in the tables' namespace.
 * @returns Its table, or none when the tables declare no element of that name.
 */
export const tableOf = (tables: Tables, local: string): Option.Option<ElementTable> =>
  Object.hasOwn(tables.elements, local)
    ? Option.fromUndefinedOr(tables.elements[local])
    : Option.none();

/**
 * The tables the walk checks by, keyed by namespace URI: QTI's tables under QTI's namespace, and
 * each other namespace's tables under its own.
 */
type Schemas = ReadonlyMap<string, Tables>;

/**
 * Gather the tables the walk checks by.
 *
 * @param tables QTI's tables.
 * @param others The tables of other namespaces, keyed by namespace URI. An entry for QTI's
 *   namespace is set aside: `tables` are QTI's.
 * @returns The tables by namespace.
 */
const schemasOf = (tables: Tables, others: ReadonlyMap<string, Tables> = new Map()): Schemas =>
  new Map<string, Tables>([...others, [qtiNamespace, tables]]);

/**
 * Look up an element's table among the tables of its namespace.
 *
 * @param schemas The tables by namespace.
 * @param element The element.
 * @returns Its table, or none when the walk holds no tables for its namespace or they declare no
 *   element of its local name.
 */
const elementTableOf = (schemas: Schemas, element: SourceElement): Option.Option<ElementTable> =>
  Option.flatMap(Option.fromUndefinedOr(schemas.get(element.namespace)), (owner) =>
    tableOf(owner, element.local),
  );

/**
 * Look up a named type's entry among the tables of its namespace, only among their own keys.
 *
 * @param schemas The tables by namespace.
 * @param type The type's name.
 * @returns Its entry, or none when the walk holds no tables for its namespace or they define no
 *   type of its local name.
 */
const typeEntryOf = (schemas: Schemas, type: ChildName): Option.Option<TypeEntry> => {
  const owner = schemas.get(type.namespace);

  return owner !== undefined && Object.hasOwn(owner.types, type.local)
    ? Option.fromUndefinedOr(owner.types[type.local])
    : Option.none();
};

/**
 * The table that governs an element the walk checks, with the namespace of the tables it comes
 * from, against which its `##other` wildcards are read.
 */
interface Governed {
  readonly namespace: string;
  readonly table: ContentTable;
}

/**
 * The base of each XML Schema built-in type, by local name, so that a derivation is followed
 * through the built-ins as it is through QTI's types.
 *
 * Each derived built-in restricts the base XML Schema Part 2 names for it (section 3.3). The
 * primitives and the three list types have `anySimpleType` as their base (Part 2, section 4.1.1),
 * and its base is `anyType` (Part 1, section 3.14.7), which has none.
 */
const builtinBases: ReadonlyMap<string, string> = new Map([
  ["anySimpleType", "anyType"],
  ["anyURI", "anySimpleType"],
  ["base64Binary", "anySimpleType"],
  ["boolean", "anySimpleType"],
  ["byte", "short"],
  ["date", "anySimpleType"],
  ["dateTime", "anySimpleType"],
  ["decimal", "anySimpleType"],
  ["double", "anySimpleType"],
  ["duration", "anySimpleType"],
  ["ENTITIES", "anySimpleType"],
  ["ENTITY", "NCName"],
  ["float", "anySimpleType"],
  ["gDay", "anySimpleType"],
  ["gMonth", "anySimpleType"],
  ["gMonthDay", "anySimpleType"],
  ["gYear", "anySimpleType"],
  ["gYearMonth", "anySimpleType"],
  ["hexBinary", "anySimpleType"],
  ["ID", "NCName"],
  ["IDREF", "NCName"],
  ["IDREFS", "anySimpleType"],
  ["int", "long"],
  ["integer", "decimal"],
  ["language", "token"],
  ["long", "integer"],
  ["Name", "token"],
  ["NCName", "Name"],
  ["negativeInteger", "nonPositiveInteger"],
  ["NMTOKEN", "token"],
  ["NMTOKENS", "anySimpleType"],
  ["nonNegativeInteger", "integer"],
  ["nonPositiveInteger", "integer"],
  ["normalizedString", "string"],
  ["NOTATION", "anySimpleType"],
  ["positiveInteger", "nonNegativeInteger"],
  ["QName", "anySimpleType"],
  ["short", "int"],
  ["string", "anySimpleType"],
  ["time", "anySimpleType"],
  ["token", "normalizedString"],
  ["unsignedByte", "unsignedShort"],
  ["unsignedInt", "unsignedLong"],
  ["unsignedLong", "nonNegativeInteger"],
  ["unsignedShort", "unsignedInt"],
]);

/**
 * Find the base of a named type: through the `types` of its namespace's tables for one of QTI's
 * or another namespace the walk holds tables for, `anySimpleType` for a union, and through
 * {@link builtinBases} for one of XML Schema's.
 *
 * @param type The type's name.
 * @param schemas The tables by namespace.
 * @returns Its base, or none for `anyType` and for a name that resolves to no type.
 */
const baseOf = (type: ChildName, schemas: Schemas): Option.Option<ChildName> => {
  if (type.namespace === xsdNamespace) {
    const base = builtinBases.get(type.local);

    return base === undefined
      ? Option.none()
      : Option.some({ local: base, namespace: xsdNamespace });
  }

  return Option.map(typeEntryOf(schemas, type), (entry) =>
    "base" in entry ? entry.base : { local: "anySimpleType", namespace: xsdNamespace },
  );
};

/**
 * Report whether a type is one of the declared types or derived from one of them, through any
 * chain of extensions and restrictions (XML Schema Part 1, section 3.3.4, clause 4.3). The XSD
 * blocks no derivation, so every chain counts.
 *
 * @param type The type's name.
 * @param declared The types the element is declared with.
 * @param schemas The tables by namespace.
 * @returns Whether `type` is validly derived from one of `declared`.
 */
const derivesFrom = (
  type: ChildName,
  declared: readonly ChildName[],
  schemas: Schemas,
): boolean => {
  const seen = new Set<string>();
  for (
    let current = Option.some(type);
    Option.isSome(current);
    current = baseOf(current.value, schemas)
  ) {
    const { local, namespace } = current.value;
    const key = `{${namespace}}${local}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    if (declared.some((name) => name.namespace === namespace && name.local === local)) {
      return true;
    }
  }

  return false;
};

/**
 * Find the namespace a prefix is bound to at an element, from the declarations on it and on its
 * ancestors, the nearest first.
 *
 * `xml` and `xmlns` are bound by definition. The empty prefix stands for the default namespace,
 * which is no namespace, `""`, when no declaration is in scope. The reader gives a default
 * declaration the local name `xmlns` and a prefixed one its prefix.
 *
 * @param prefix The prefix, `""` for none.
 * @param element The element the name is written on.
 * @param parents Each walked element's parent.
 * @returns The namespace, or none when the prefix is bound to nothing.
 */
const boundNamespace = (
  prefix: string,
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): Option.Option<string> => {
  if (prefix === "xml") {
    return Option.some(xmlNamespace);
  }

  if (prefix === "xmlns") {
    return Option.some(xmlnsNamespace);
  }

  const local = prefix === "" ? "xmlns" : prefix;
  for (
    let current: SourceElement | undefined = element;
    current !== undefined;
    current = parents.get(current)
  ) {
    const declaration = current.attributes.find(
      (attribute) => attribute.namespace === xmlnsNamespace && attribute.local === local,
    );
    if (declaration !== undefined) {
      return prefix === "" || declaration.value !== ""
        ? Option.some(declaration.value)
        : Option.none();
    }
  }

  return prefix === "" ? Option.some("") : Option.none();
};

/**
 * Split a QName as written into its prefix and local name, after collapsing its whitespace, as
 * `xs:QName` does.
 *
 * @param value The QName as written.
 * @returns Its prefix, empty where it has none, and its local name, or none when it is not a
 * QName.
 */
const qNameParts = (value: string): Option.Option<{ local: string; prefix: string }> => {
  const lexical = collapse(value);
  const colon = lexical.indexOf(":");
  const prefix = colon === -1 ? "" : lexical.slice(0, colon);
  const local = lexical.slice(colon + 1);

  return (colon !== -1 && !isNcName(prefix)) || !isNcName(local)
    ? Option.none()
    : Option.some({ local, prefix });
};

/**
 * Resolve a QName written on an element: collapse its whitespace, as `xs:QName` does, and bind its
 * prefix through the declarations in scope.
 *
 * @param value The QName as written.
 * @param element The element it is written on.
 * @param parents Each walked element's parent.
 * @returns The name it stands for, or none when it is not a QName or its prefix is bound to
 *   nothing.
 */
const resolveQName = (
  value: string,
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): Option.Option<ChildName> =>
  Option.flatMap(qNameParts(value), ({ local, prefix }) =>
    Option.map(boundNamespace(prefix, element, parents), (namespace) => ({ local, namespace })),
  );

/**
 * Name a type as a refusal's detail does: its local name in the QTI namespace and
 * `{<namespace>}<local>` otherwise, as {@link elementName} names an element.
 *
 * @param type The type's name.
 * @returns Its name.
 */
const typeName = (type: ChildName): string =>
  type.namespace === qtiNamespace ? type.local : `{${type.namespace}}${type.local}`;

/**
 * Describe the values an element's `xsi:type` may take, for the wording of its `attribute-type`
 * refusal.
 *
 * @param table The element's table.
 * @returns A phrase naming the element's declared types.
 */
const describeInstanceTypes = (table: ElementTable): string => {
  const [first, ...others] = table.types.map(typeName);
  if (first === undefined) {
    return "a named type derived from the element's anonymous type, and the XSD has none";
  }

  return others.length === 0
    ? `a QName naming ${first} or a type derived from it`
    : `a QName naming one of ${[first, ...others].join(", ")} or a type derived from one of them`;
};

/**
 * The QTI elements whose `##other` element wildcard is read as `##any`, by local name, by reading
 * 61 ("an element in QTI's own namespace inside `qti-ordering`'s extension slot is valid"):
 * `qti-ordering`, whose extension tags the information model allows to be "reused QTI ASI tags"
 * (section 5.98.3) where the XSD admits only other namespaces. The slot stays `lax`, so a QTI
 * element there is admitted as any element of lax wildcard content is: a global one is checked by
 * its table, a nested QTI root is kept as foreign content, and one no global declaration names is
 * passed over as foreign content, its children admitted laxly. `qti-selection` is not one: its
 * extension tags "must be new tags" (section 5.129.4), so a QTI element there stays refused.
 */
const ownNamespaceSlots: ReadonlySet<string> = new Set(["qti-ordering"]);

/**
 * The QTI roots reading 6 keeps as foreign content when wildcard content holds one: the item,
 * test, section and stimulus roots and the two processing roots, by local name.
 */
const nestedRoots: ReadonlySet<string> = new Set([
  "qti-assessment-item",
  "qti-assessment-section",
  "qti-assessment-stimulus",
  "qti-assessment-test",
  "qti-outcome-processing",
  "qti-response-processing",
]);

/**
 * Report whether an element is a root reading 6 keeps as foreign content when wildcard content
 * holds one: one of {@link nestedRoots}, or a content package's `manifest`.
 *
 * @param element The element.
 * @returns Whether it is kept foreign there.
 */
const isForeignRoot = (element: SourceElement): boolean =>
  element.namespace === qtiNamespace
    ? nestedRoots.has(element.local)
    : element.namespace === manifestNamespace && element.local === "manifest";

/**
 * XLink's namespace, which a content package's schema set imports through the content packaging
 * extension, and whose tables plate does not hold.
 */
const xlinkNamespace = "http://www.w3.org/1999/xlink";

/**
 * The namespaces an item's, test's, section's or stimulus's schema set imports whose tables plate
 * does not hold: XInclude, MathML 3 and SSML 1.1, which the ASI XSD imports (reading 81).
 */
const assessmentUntabled: ReadonlySet<string> = new Set([
  mathmlNamespace,
  ssmlNamespace,
  xincludeNamespace,
]);

/**
 * The namespaces a manifest's schema set imports whose tables plate does not hold: XLink, which
 * the content packaging extension imports (reading 81).
 */
const manifestUntabled: ReadonlySet<string> = new Set([xlinkNamespace]);

/**
 * Give the namespaces the walk's schema set imports whose tables plate does not hold, so that an
 * element of one under a `strict` wildcard is kept and not walked, plate's open limit: with no
 * tables, the walk cannot tell a global declaration there from none. The set is a manifest's when
 * the walk holds the content packaging tables, and an assessment document's otherwise.
 *
 * @param schemas The tables by namespace.
 * @returns The namespaces.
 */
const untabledOf = (schemas: Schemas): ReadonlySet<string> =>
  schemas.has(manifestNamespace) ? manifestUntabled : assessmentUntabled;

/**
 * The content models whose repeated element wildcard follows the particles that name their
 * children, by the name of the element whose type each is, `{<namespace>}<local>` (reading 96, "a
 * repeated wildcard keeps its sequence's order"): QTI's `qti-companion-materials-info`, of
 * `CompanionMaterialsInfoDType`, and the AfA DRD's `accessForAllResource`, of
 * `Access_For_All_Resource.Type`, each ending in `grpStrict.any`.
 */
const wildcardLast: ReadonlySet<string> = new Set([
  `{${qtiNamespace}}qti-companion-materials-info`,
  "{http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0drd_v1p0}accessForAllResource",
]);

/**
 * Find the nearest QTI-namespace ancestor of an element with a given local name.
 *
 * @param element The element.
 * @param local The ancestor's local name.
 * @param parents Each walked element's parent.
 * @returns The ancestor, or none when no ancestor has that name.
 */
const enclosing = (
  element: SourceElement,
  local: string,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): Option.Option<SourceElement> => {
  for (let current = parents.get(element); current !== undefined; current = parents.get(current)) {
    if (current.namespace === qtiNamespace && current.local === local) {
      return Option.some(current);
    }
  }

  return Option.none();
};

/**
 * Report whether a value is padded where reading 7 refuses padding.
 *
 * The attribute must be one of {@link typedValueAttributes} on its element, its value must start or
 * end with XML whitespace, and its base type must not be `string`. A missing declaration, or one
 * with no `base-type`, is not a string.
 *
 * @param element The attribute's element.
 * @param attribute The attribute.
 * @param parents Each walked element's parent.
 * @returns Whether the attribute is `padded-attribute`.
 */
const isPadded = (
  element: SourceElement,
  attribute: SourceAttribute,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): boolean => {
  const source =
    element.namespace === qtiNamespace && attribute.namespace === ""
      ? typedValueAttributes.get(element.local)?.get(attribute.local)
      : undefined;
  if (source === undefined || !outerXmlSpace.test(attribute.value)) {
    return false;
  }

  if (source === "float") {
    return true;
  }

  const baseType = Option.flatMap(enclosing(element, source, parents), (declaration) =>
    Option.fromUndefinedOr(
      declaration.attributes.find(
        (candidate) => candidate.namespace === "" && candidate.local === "base-type",
      ),
    ),
  );

  return Option.match(baseType, {
    onNone: () => true,
    onSome: (written) => collapse(written.value) !== "string",
  });
};

/**
 * Construct a structural refusal located at an element or attribute path.
 *
 * @param source The document refused.
 * @param rule The rule it breaks.
 * @param path The element or attribute path.
 * @param detail The facts the verdict's wording needs.
 * @param suggestion The name the table of misspellings suggests, if any.
 * @returns The refusal.
 */
const refuse = (
  source: SourceDocument,
  rule: RefusalRule,
  path: string,
  detail: Readonly<Record<string, string>>,
  suggestion: Option.Option<string> = Option.none(),
): Refusal =>
  new Refusal({
    detail,
    document: source.location,
    location: { kind: "path", path },
    readerRule: Option.none(),
    rule,
    suggestion,
  });

/**
 * Find the {@link readingRows} row that refuses an attribute's name, if any. The readings are
 * QTI's, so an element in another namespace has none.
 *
 * @param element The attribute's element.
 * @param attribute The attribute.
 * @returns The row whose prefix the name starts with and whose pattern it does not match.
 */
const misnamed = (
  element: SourceElement,
  attribute: SourceAttribute,
): Option.Option<AttributeName> =>
  Option.fromUndefinedOr(
    attributeNames.find(
      (row) =>
        element.namespace === qtiNamespace &&
        attribute.namespace === "" &&
        attribute.local.startsWith(row.prefix) &&
        !row.pattern.test(attribute.local),
    ),
  );

/**
 * Report whether an attribute an element's governing table does not declare is one reading 90
 * ("on an element the Schematron's extension-attribute lists cover, an attribute its XSD does not
 * declare is a `data-` attribute, or the document is refused") lets an element its lists cover
 * carry: a `data-` attribute in no namespace, whose name reading 13 then judges, or reading 10's
 * `aria-keyshortcuts` where the table declares the XSD's `aria-keyshorts` (the empty elements).
 * XML Schema's four `xsi:` attributes and the namespace declarations never reach this check.
 *
 * @param table The table that governs the element.
 * @param attribute The undeclared attribute.
 * @returns Whether the attribute is an extension reading 90 admits.
 */
const isExtension = (table: ContentTable, attribute: SourceAttribute): boolean =>
  attribute.namespace === "" &&
  (attribute.local.startsWith("data-") ||
    (attribute.local === "aria-keyshortcuts" &&
      table.attributes.some(
        (declaration) =>
          declaration.use !== "prohibited" &&
          declaration.namespace === "" &&
          declaration.local === "aria-keyshorts",
      )));

/**
 * What an attribute's type makes of its value in the document's ID/IDREF table (XML Schema Part 1,
 * section 3.15.5): an ID, an IDREF, or a list of IDREFs.
 */
type IdRole = "id" | "idref" | "idrefs";

/**
 * Find the role a built-in gives a value in the ID/IDREF table.
 *
 * @param name The built-in.
 * @returns `id` for `ID`, `idref` for `IDREF`, none for any other.
 */
const builtinRole = (name: BuiltinName): Option.Option<IdRole> => {
  if (name === "ID") {
    return Option.some("id");
  }

  return name === "IDREF" ? Option.some("idref") : Option.none();
};

/**
 * Find the role an attribute's type gives its value in the ID/IDREF table: an atomic type derived
 * from `ID` or `IDREF`, through any facet, gives its built-in's; a list of an `IDREF` type is
 * `idrefs`, as `xs:IDREFS` is; a union takes no part.
 *
 * @param type The attribute's type, as its declaration gives it.
 * @returns The role, or none for a type that is neither.
 */
const idRoleOf = (type: AttributeType): Option.Option<IdRole> => {
  switch (type.kind) {
    case "builtin": {
      return builtinRole(type.name);
    }
    case "enumeration":
    case "pattern": {
      return builtinRole(type.base);
    }
    case "list": {
      return Option.flatMap(idRoleOf(type.item), (role) =>
        role === "idref" ? Option.some<IdRole>("idrefs") : Option.none(),
      );
    }
    case "union": {
      return Option.none();
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Report whether an attribute's type makes its value one IDREF of the document's ID/IDREF table
 * ({@link idRoleOf}): `xs:IDREF` or an atomic type derived from it, never a list of them.
 *
 * @param type The attribute's type, as its declaration gives it.
 * @returns Whether its value is an IDREF.
 */
export const isIdrefType = (type: AttributeType): boolean =>
  Option.exists(idRoleOf(type), (role) => role === "idref");

/**
 * Report whether a table declares an attribute use of a type derived from `ID`, such as `id` of
 * `UniqueIdentifierDType`, whether or not the element writes it.
 *
 * @param table The table that governs an element.
 * @returns Whether one of its attribute uses is an ID.
 */
const declaresId = (table: ContentTable): boolean =>
  table.attributes.some(
    (declaration) =>
      declaration.use !== "prohibited" &&
      Option.exists(idRoleOf(declaration.type), (role) => role === "id"),
  );

/**
 * Report whether an attribute the governing table does not declare is a wild ID: XML's `xml:id`,
 * which `xml.xsd` declares of type `xs:ID`, admitted by an attribute wildcard that assesses it, a
 * `lax` or a `strict` one (XML Schema Part 1, section 3.4.4, clause 5; reading 109). Under `skip`
 * it is not assessed and is no ID. Only QTI's tables are read for IDs: a manifest's ID and IDREF
 * typing is not applied ({@link checkIds}).
 *
 * @param governed The table that governs the element, with its tables' namespace.
 * @param attribute The undeclared attribute.
 * @returns Whether the attribute is a wild ID of the element.
 */
const isWildId = (governed: Governed, attribute: SourceAttribute): boolean => {
  const wildcard = governed.table.anyAttribute;

  return (
    governed.namespace === qtiNamespace &&
    attribute.namespace === xmlNamespace &&
    attribute.local === "id" &&
    wildcard !== undefined &&
    wildcard.process !== "skip" &&
    wildcardAdmits(wildcard, attribute.namespace, governed.namespace)
  );
};

/**
 * Check one attribute the element's table does not declare.
 *
 * When the element's attribute wildcard matches its namespace it is allowed, unless a reading
 * refuses its name: then it is `unknown-attribute`, suggesting the name in lower case when that
 * name passes. On an element the Schematron's extension lists cover, the wildcard admits only an
 * extension ({@link isExtension}), and any other attribute it matches is `unknown-attribute`,
 * citing reading 90, as XML's `xml:id` and an attribute in another namespace are. A wild ID
 * ({@link isWildId}) on an element whose governing table declares an ID attribute use is
 * `unknown-attribute` too, citing reading 109 ("an element whose type has an ID attribute use holds
 * no wildcard `xml:id`"), even where the element writes no ID. Otherwise it is `unknown-attribute`,
 * with the misspelling table's suggestion when a row matches.
 *
 * @param source The document.
 * @param element The attribute's element.
 * @param path The element's path.
 * @param governed The table that governs the element, with its tables' namespace.
 * @param covered Whether the extension lists cover the element, by its name's table: the lists
 *   name elements, so an element an `xsi:type` governs is covered by its name, and what its
 *   governing table declares is still declared.
 * @param attribute The undeclared attribute.
 * @returns The refusal, or none when the wildcard admits the attribute and no reading refuses
 *   its name.
 */
const checkUndeclared = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  governed: Governed,
  covered: boolean,
  attribute: SourceAttribute,
): Option.Option<Refusal> => {
  const detail = { attribute: attributeName(attribute), element: elementName(element) };
  const wildcard = governed.table.anyAttribute;
  const admitted =
    wildcard !== undefined && wildcardAdmits(wildcard, attribute.namespace, governed.namespace);
  if (admitted && covered && !isExtension(governed.table, attribute)) {
    return Option.some(
      refuse(source, "unknown-attribute", attributePath(path, attribute), {
        ...detail,
        reading: "90",
      }),
    );
  }

  if (isWildId(governed, attribute) && declaresId(governed.table)) {
    return Option.some(
      refuse(source, "unknown-attribute", attributePath(path, attribute), {
        ...detail,
        reading: "109",
      }),
    );
  }

  if (admitted) {
    return Option.map(misnamed(element, attribute), (row) =>
      refuse(
        source,
        "unknown-attribute",
        attributePath(path, attribute),
        { ...detail, reading: row.reading },
        Option.liftPredicate(attribute.local.toLowerCase(), (lower) => row.pattern.test(lower)),
      ),
    );
  }

  const row = misspellings.find(
    (candidate) =>
      element.namespace === qtiNamespace &&
      candidate.element === element.local &&
      attribute.namespace === "" &&
      candidate.written === attribute.local,
  );

  return Option.some(
    row === undefined
      ? refuse(source, "unknown-attribute", attributePath(path, attribute), detail)
      : refuse(
          source,
          "unknown-attribute",
          attributePath(path, attribute),
          { ...detail, reading: row.reading },
          Option.some(row.schema),
        ),
  );
};

/**
 * Check an attribute of XML's own namespace against the rows that narrow it, on an element of any
 * namespace the walk checks, whether its table declares the attribute or a wildcard admits it, and
 * on one the walk passes over laxly ({@link checkPassed}).
 *
 * @param source The document.
 * @param element The attribute's element.
 * @param path The element's path.
 * @param attribute The attribute.
 * @returns Its `attribute-type` refusals; none for an attribute in another namespace, or one whose
 *   value holds an unexpanded entity reference, which is unknown.
 */
const checkXml = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  attribute: SourceAttribute,
): readonly Refusal[] => {
  if (attribute.namespace !== xmlNamespace || attribute.references.length > 0) {
    return [];
  }

  const lexical = collapse(attribute.value);

  return xmlAttributes
    .filter((row) => row.attribute === attribute.local && !row.holds(lexical, element))
    .map((row) =>
      refuse(source, "attribute-type", attributePath(path, attribute), {
        attribute: attributeName(attribute),
        element: elementName(element),
        expected: row.expected,
        reading: row.reading,
        value: attribute.value,
      }),
    );
};

/**
 * The type `xml.xsd` gives `xml:id`, `xs:ID`, by its global declaration, against which XML Schema
 * assesses an `xml:id` no table declares wherever a `lax` or `strict` wildcard admits it.
 */
const xmlIdType: AttributeType = { kind: "builtin", name: "ID" };

/**
 * Check an attribute that no table declares and a wildcard admits, if it is one of XML's own
 * namespace: an `xml:id` against `xml.xsd`'s global declaration ({@link xmlIdType}) where the
 * wildcard assesses it, a `lax` or a `strict` one (XML Schema Part 1, section 3.4.4, clause 5, as
 * {@link isWildId} reads it), and then against the rows that narrow XML's attributes
 * ({@link checkXml}). An `xml:id` that is no NCName once collapsed is `attribute-type`, its
 * `expected` the type's, as a declared ID attribute of that value is, since reading 156 holds that
 * "its value domain alone refuses it"; it binds no ID ({@link boundIdOf}). Under `skip` it is not
 * assessed.
 *
 * @param source The document.
 * @param element The attribute's element.
 * @param path The element's path.
 * @param wildcard The attribute wildcard that admits it: the table's that governs an element the
 *   walk checks, or the ur-type's ({@link urTypeAttributes}) for one it passes over laxly; none
 *   where no wildcard is written.
 * @param attribute The attribute.
 * @returns Its `attribute-type` refusals; none for an attribute in another namespace, or one whose
 *   value holds an unexpanded entity reference, which is unknown.
 */
const checkWildXml = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  wildcard: Wildcard | undefined,
  attribute: SourceAttribute,
): readonly Refusal[] => {
  const assessed =
    wildcard !== undefined &&
    wildcard.process !== "skip" &&
    attribute.namespace === xmlNamespace &&
    attribute.local === "id" &&
    attribute.references.length === 0;
  const typed =
    assessed && !admits(xmlIdType, attribute.value)
      ? [
          refuse(source, "attribute-type", attributePath(path, attribute), {
            attribute: attributeName(attribute),
            element: elementName(element),
            expected: describeType(xmlIdType),
            value: attribute.value,
          }),
        ]
      : [];

  return [...typed, ...checkXml(source, element, path, attribute)];
};

/**
 * Check a declared attribute's value: against the XSD's type, unless a reading retypes it, and then
 * against the readings that narrow it, the count ranges and the information model's integer
 * floors. The readings are QTI's, so an attribute of an element in another namespace is checked
 * against its type alone, but for an attribute of XML's own namespace, which {@link checkXml}
 * reads on every element.
 *
 * @param source The document.
 * @param element The attribute's element.
 * @param path The element's path.
 * @param type The attribute's type, as its declaration gives it.
 * @param attribute The attribute, whose value holds no unexpanded entity reference.
 * @param declared The attributes the element's table declares, for the default of a floor's mode.
 * @returns Its `attribute-type` and `count-range` refusals.
 */
const checkValue = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  type: AttributeType,
  attribute: SourceAttribute,
  declared: readonly AttributeTable[],
): readonly Refusal[] => {
  const name = attributeName(attribute);
  const local = attribute.namespace === "" && element.namespace === qtiNamespace;
  const retyped = retypedAttributes.some(
    (row) => local && row.element === element.local && row.attribute === attribute.local,
  );
  if (retyped) {
    return [];
  }

  const at = attributePath(path, attribute);
  const detail = { attribute: name, element: elementName(element), value: attribute.value };
  if (!admits(type, attribute.value)) {
    return [refuse(source, "attribute-type", at, { ...detail, expected: describeType(type) })];
  }

  const lexical = collapse(attribute.value);
  const replaced = replace(attribute.value);
  const narrowed = narrowedAttributes
    .filter(
      (row) =>
        local &&
        row.attribute === attribute.local &&
        (row.elements === "declaring" || row.elements.includes(element.local)) &&
        !row.holds(row.whiteSpace === "collapse" ? lexical : replaced, element, path),
    )
    .map((row) =>
      refuse(source, "attribute-type", at, { ...detail, expected: row.expected, ...row.settled }),
    );
  const ranged = countRanges
    .filter(
      (row) =>
        local &&
        row.attributes.includes(attribute.local) &&
        integerLexical.test(lexical) &&
        (BigInt(lexical) < row.least || BigInt(lexical) > row.greatest),
    )
    .map((row) =>
      refuse(source, "count-range", at, {
        attribute: name,
        greatest: row.greatest.toString(),
        least: row.least.toString(),
        lexical,
        reading: row.reading,
      }),
    );
  const floored = integerFloors
    .filter(
      (row) =>
        local &&
        row.element === element.local &&
        row.attribute === attribute.local &&
        integerLexical.test(lexical) &&
        BigInt(lexical) < row.least &&
        Option.match(row.when, {
          onNone: () => true,
          onSome: (condition) => meets(condition, element, declared),
        }),
    )
    .map((row) => {
      const mode = Option.match(row.when, {
        onNone: () => "",
        onSome: (condition) => ` when ${condition.attribute} is ${condition.value}`,
      });

      return refuse(source, "attribute-type", at, {
        ...detail,
        expected: `an integer at least ${row.least.toString()}${mode}`,
        least: row.least.toString(),
        source: row.source,
        ...Option.match(row.when, { onNone: () => ({}), onSome: conditionFacts }),
      });
    });

  return [...narrowed, ...ranged, ...floored, ...checkXml(source, element, path, attribute)];
};

/**
 * Check the attributes the information model requires of an element under a mode it sets, where
 * the XSD makes them optional.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param declared The attributes the element's table declares, for the default of a mode.
 * @returns Its `missing-attribute` refusals, one per row whose condition the element meets and
 *   whose attribute it does not write.
 */
const checkConditional = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  declared: readonly AttributeTable[],
): readonly Refusal[] =>
  element.namespace === qtiNamespace
    ? conditionalAttributes
        .filter(
          (row) =>
            row.element === element.local &&
            meets(row.when, element, declared) &&
            !element.attributes.some(
              (attribute) => attribute.namespace === "" && attribute.local === row.attribute,
            ),
        )
        .map((row) =>
          refuse(source, "missing-attribute", path, {
            attribute: row.attribute,
            element: elementName(element),
            source: row.source,
            ...conditionFacts(row.when),
          }),
        )
    : [];

/**
 * Check the attributes a reading requires of an element where the XSD makes them optional.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parent The element's parent, none for the root.
 * @returns Its `missing-attribute` refusals, one per row that applies to the element and whose
 *   attribute it does not write.
 */
const checkRequired = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parent: Option.Option<SourceElement>,
): readonly Refusal[] =>
  element.namespace === qtiNamespace
    ? requiredAttributes
        .filter(
          (row) =>
            row.element === element.local &&
            row.applies(element, parent) &&
            !element.attributes.some(
              (attribute) => attribute.namespace === "" && attribute.local === row.attribute,
            ),
        )
        .map((row) =>
          refuse(source, "missing-attribute", path, {
            attribute: row.attribute,
            element: elementName(element),
            reading: row.reading,
          }),
        )
    : [];

/**
 * Find the {@link readingRows} row that withdraws an attribute from its element, if any. The
 * readings are QTI's, so an element in another namespace has none.
 *
 * @param element The attribute's element.
 * @param attribute The attribute.
 * @returns The row that names the element and the attribute.
 */
const withdrawnFrom = (
  element: SourceElement,
  attribute: SourceAttribute,
): Option.Option<WithdrawnAttribute> =>
  Option.fromUndefinedOr(
    withdrawnAttributes.find(
      (row) =>
        element.namespace === qtiNamespace &&
        attribute.namespace === "" &&
        row.element === element.local &&
        row.attribute === attribute.local,
    ),
  );

/**
 * Check that a variable's declaration writes a `base-type` where it has a base type: a record has
 * none, and every variable of another cardinality is "identified with a base-type" (info.txt:12060,
 * :22682, :39280, :45897; reading 153). So a declaration whose `cardinality` spells `single`,
 * `multiple` or `ordered` and writes no `base-type` is `missing-attribute` at the declaration,
 * citing reading 158, which judges a declaration by what its attributes spell: one whose
 * `cardinality` spells nothing is its value domain's alone ({@link spellsCardinality}).
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @returns Its `missing-attribute` refusal, or none.
 */
const checkUntyped = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
): readonly Refusal[] =>
  element.namespace === qtiNamespace &&
  variableDeclarations.has(element.local) &&
  spellsCardinality(element, ["single", "multiple", "ordered"]) &&
  !element.attributes.some(
    (attribute) => attribute.namespace === "" && attribute.local === "base-type",
  )
    ? [
        refuse(source, "missing-attribute", path, {
          attribute: "base-type",
          element: elementName(element),
          reading: "158",
        }),
      ]
    : [];

/**
 * Report whether an attribute is a `base-type` that a record declaration writes, which is
 * `unknown-attribute`, citing reading 153: "Variables with record cardinality have no base-type"
 * (info.txt:12060, :22682, :39280, :45897). Only a `base-type` in its value domain is: one outside
 * it is that domain's alone, and so is every attribute of a declaration whose `cardinality` spells
 * no cardinality (reading 158).
 *
 * @param element The attribute's element.
 * @param attribute The attribute, whose value holds no unexpanded entity reference.
 * @param type The attribute's type, as its declaration gives it.
 * @returns Whether it is a record's `base-type`.
 */
const isRecordBaseType = (
  element: SourceElement,
  attribute: SourceAttribute,
  type: AttributeType,
): boolean =>
  element.namespace === qtiNamespace &&
  variableDeclarations.has(element.local) &&
  attribute.namespace === "" &&
  attribute.local === "base-type" &&
  spellsCardinality(element, ["record"]) &&
  admits(type, attribute.value);

/**
 * Report whether an element sits where a placement row requires.
 *
 * @param row The placement.
 * @param element The element, one of the row's.
 * @param parents Each walked element's parent.
 * @returns Whether its parent, or its nearest ancestor of the container's name, is the row's
 *   container and the row admits it.
 */
const isPlaced = (
  row: Placement,
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): boolean => {
  const container =
    row.within === "ancestor"
      ? enclosing(element, row.container, parents)
      : Option.filter(
          Option.fromUndefinedOr(parents.get(element)),
          (parent) => parent.namespace === qtiNamespace && parent.local === row.container,
        );

  return Option.exists(container, row.admits);
};

/**
 * Count the child elements of an element that a child-count row names; text is not a child.
 *
 * @param row The child count.
 * @param element The element.
 * @returns How many of its child elements the row counts.
 */
const countChildren = (row: ChildCount, element: SourceElement): number =>
  element.children.filter(
    (child) =>
      child.kind === "element" &&
      (row.counted === "any" ||
        (child.namespace === qtiNamespace && row.counted.includes(child.local))),
  ).length;

/**
 * Check one element against the placement rows that name it.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parents Each walked element's parent.
 * @returns Its `misplaced-element` refusals.
 */
const checkPlacement = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): readonly Refusal[] =>
  placements
    .filter(
      (row) =>
        element.namespace === qtiNamespace &&
        row.elements.includes(element.local) &&
        row.roots(source.root) &&
        !isPlaced(row, element, parents),
    )
    .map((row) =>
      refuse(source, "misplaced-element", path, {
        element: elementName(element),
        ...Option.match(row.reading, {
          onNone: () => ({}),
          onSome: (reading) => ({ reading }),
        }),
        requires: row.requires,
      }),
    );

/**
 * Report whether a hotspot is a default hotspot: its `shape` spells `default`, compared exactly as
 * written ({@link declares}), for the XSD types it as an enumeration of `xs:string`, whose
 * whiteSpace is `preserve`. A shape that spells no shape, such as `" default"`, is its value
 * domain's alone.
 *
 * @param hotspot A `qti-hotspot-choice` or a `qti-associable-hotspot`.
 * @returns Whether it is a default hotspot.
 */
const isDefaultHotspot = (hotspot: SourceElement): boolean =>
  declares(hotspot, "shape", ["default"]);

/**
 * The interactions whose default hotspot choice comes last (reading 80): "The default hotspot, if
 * defined, must appear last".
 */
const lastDefaultHotspot: ReadonlySet<string> = new Set([
  "qti-graphic-order-interaction",
  "qti-hotspot-interaction",
]);

/**
 * The lookup tables an outcome declaration may hold (reading 100).
 */
const lookupTables: ReadonlySet<string> = new Set(["qti-interpolation-table", "qti-match-table"]);

/**
 * Each parent's last element child, found once per parent: {@link checkStructure} keeps one for the
 * document it checks, so an interaction of many default hotspots and much text after them is
 * scanned once, not once per hotspot.
 */
type LastElements = Map<SourceElement, SourceElement>;

/**
 * Report whether an element is its parent's last element child. Text, whitespace and entity
 * references after it do not count, nor do comments and processing instructions, which the shared
 * reader does not keep. The parent's children are scanned the first time one of them asks, and the
 * answer is kept in `lastElements` for the others.
 *
 * @param element The element.
 * @param parent Its parent.
 * @param lastElements The last element child of each parent already scanned.
 * @returns Whether no element follows it in its parent.
 */
const isLastElement = (
  element: SourceElement,
  parent: SourceElement,
  lastElements: LastElements,
): boolean => {
  const known = lastElements.get(parent);
  if (known !== undefined) {
    return known === element;
  }

  const last = parent.children.findLast(
    (child): child is SourceElement => child.kind === "element",
  );
  if (last !== undefined) {
    lastElements.set(parent, last);
  }

  return last === element;
};

/**
 * Check a hotspot's place by reading 80 ("a default hotspot is the last hotspot choice of its
 * interaction, and a graphic gap match interaction has none"), where the XSD admits a default
 * hotspot anywhere among its interaction's hotspots. A hotspot or graphic order interaction's
 * default hotspot choice is its last element child, after its image and every other hotspot, and
 * of a graphic gap match interaction's hotspots "The default hotspot must not be defined", last or
 * not; either out of place is `misplaced-element`, `check: "default-hotspot"`, naming the
 * interaction, its `context`. A graphic associate interaction's default hotspot may stand
 * anywhere: of it the information model says nothing. A hotspot whose parent is of another name,
 * an element an `xsi:type` gives an interaction's type, is not judged, plate's limit for an
 * outlandish case (rule `db2ef322`).
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parent The element's parent, if it was walked.
 * @param lastElements The last element child of each parent already scanned.
 * @returns Its `misplaced-element` refusal, or none.
 */
const checkDefaultHotspot = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parent: SourceElement | undefined,
  lastElements: LastElements,
): readonly Refusal[] =>
  element.namespace === qtiNamespace &&
  parent?.namespace === qtiNamespace &&
  isDefaultHotspot(element) &&
  ((element.local === "qti-hotspot-choice" &&
    lastDefaultHotspot.has(parent.local) &&
    !isLastElement(element, parent, lastElements)) ||
    (element.local === "qti-associable-hotspot" &&
      parent.local === "qti-graphic-gap-match-interaction"))
    ? [
        refuse(source, "misplaced-element", path, {
          check: "default-hotspot",
          context: parent.local,
          element: element.local,
          reading: "80",
        }),
      ]
    : [];

/**
 * Check a lookup table's outcome by reading 100 ("a lookup table sets a single outcome"): a
 * `qti-match-table` or `qti-interpolation-table` belongs to an outcome declaration of single
 * cardinality, so one under a declaration whose cardinality spells `multiple`, `ordered` or
 * `record` is `misplaced-element`, `check: "lookup-cardinality"`, naming the outcome's collapsed
 * `identifier`, empty where it writes none or one that holds an unexpanded entity reference. The
 * law reads the cardinality alone, so it judges the declaration whatever its identifier spells
 * (reading 157), and leaves one whose cardinality spells no cardinality to its value domain
 * (reading 158).
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parent The element's parent, if it was walked.
 * @returns Its `misplaced-element` refusal, or none.
 */
const checkLookupTable = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parent: SourceElement | undefined,
): readonly Refusal[] =>
  element.namespace === qtiNamespace &&
  lookupTables.has(element.local) &&
  parent?.namespace === qtiNamespace &&
  parent.local === "qti-outcome-declaration" &&
  declares(parent, "cardinality", ["multiple", "ordered", "record"])
    ? [
        refuse(source, "misplaced-element", path, {
          check: "lookup-cardinality",
          element: element.local,
          identifier: Option.getOrElse(modeOf(parent, [], "identifier"), () => ""),
          reading: "100",
        }),
      ]
    : [];

/**
 * Check one element against the child-count rows that name it.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parents Each walked element's parent.
 * @returns Its `child-count` refusals.
 */
const checkChildCounts = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parents: ReadonlyMap<SourceElement, SourceElement>,
): readonly Refusal[] => {
  const parent = Option.fromUndefinedOr(parents.get(element));

  return childCounts
    .filter(
      (row) =>
        element.namespace === qtiNamespace &&
        row.elements.includes(element.local) &&
        row.applies(parent) &&
        row.refuses(countChildren(row, element)),
    )
    .map((row) =>
      refuse(source, "child-count", path, {
        child: row.child,
        element: elementName(element),
        required: row.required,
        source: row.source,
      }),
    );
};

/**
 * Judge an element's `xsi:type` and `xsi:nil` as XML Schema judges them (reading 47).
 *
 * No declaration names either, and no attribute wildcard takes either (XML Schema Part 1, section
 * 3.4.4, clause 3), so they are judged here, never by {@link checkUndeclared}. `xsi:type` is valid
 * when its value, a QName, names one of the types the element's table lists in `types`, or a type
 * derived from one of them (section 3.3.4, clause 4); otherwise, its prefix bound to nothing
 * included, it is `attribute-type`. For a name declared with several types, a type valid for any
 * one of them is valid. A value holding an unexpanded entity reference is unknown and not judged.
 * The walk does not check the element's content against the named type, so `xs:ENTITY`, whose
 * content would have to name an unparsed entity the reader does not see, is admitted unverified
 * where it derives from the declared type (reading 50). No table records a nillable element: the
 * XSD declares none, and table generation refuses a schema that does. So `xsi:nil` is
 * `unknown-attribute` whatever its value (section 3.3.4, clause 3).
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param table The table of the element's name, which lists the types it is declared with.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace, for the derivations of their types.
 * @returns The refusals of the two attributes, in document order.
 */
const checkInstance = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  table: ElementTable,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): readonly Refusal[] =>
  element.attributes.filter(isInstanceAttribute).flatMap((attribute) => {
    const at = attributePath(path, attribute);
    const detail = { attribute: attributeName(attribute), element: elementName(element) };
    if (attribute.local === "nil") {
      return [refuse(source, "unknown-attribute", at, { ...detail, reading: "47" })];
    }

    const valid =
      attribute.references.length > 0 ||
      Option.exists(resolveQName(attribute.value, element, parents), (type) =>
        derivesFrom(type, table.types, schemas),
      );

    return valid
      ? []
      : [
          refuse(source, "attribute-type", at, {
            ...detail,
            expected: describeInstanceTypes(table),
            reading: "47",
            value: attribute.value,
          }),
        ];
  });

/**
 * Find the entry of the type an element's valid `xsi:type` names, in QTI's tables or another
 * namespace's, whose table then governs the element in place of its name's (AD-9, XML Schema Part
 * 1, section 3.3.4, clause 4.3).
 *
 * The type is valid as {@link checkInstance} judges it: its QName resolves through the declarations
 * in scope and names one of the types the element's name is declared with, or a type derived from
 * one of them. For a name declared with several types, the named type's own table governs, not the
 * union of the name's. A type of XML Schema's, which adds no attribute or child, leaves the name's
 * table in force, and so does an invalid type, an absent one, or one whose value holds an
 * unexpanded entity reference and is unknown.
 *
 * @param element The element.
 * @param table The table of the element's name.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns The named type's entry with its namespace, or none when the name's table governs.
 */
const namedType = (
  element: SourceElement,
  table: ElementTable,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): Option.Option<Governed> => {
  const written = element.attributes.find(
    (attribute) => attribute.namespace === xsiNamespace && attribute.local === "type",
  );
  if (written === undefined || written.references.length > 0) {
    return Option.none();
  }

  return Option.flatMap(resolveQName(written.value, element, parents), (type) =>
    derivesFrom(type, table.types, schemas)
      ? Option.map(typeEntryOf(schemas, type), (entry) => ({
          namespace: type.namespace,
          table: entry,
        }))
      : Option.none(),
  );
};

/**
 * Check the attributes and the text of one element the walk admitted.
 *
 * A required attribute that is absent is `missing-attribute` at the element, and so is one the
 * information model requires under a mode the element sets ({@link checkConditional}), one a
 * reading requires where the XSD makes it optional ({@link checkRequired}), and a variable's
 * `base-type` where it has a base type ({@link checkUntyped}). `xsi:type` and `xsi:nil` go to
 * {@link checkInstance}, before any other attribute. An attribute a reading withdraws from the
 * element is `unknown-attribute` ({@link withdrawnFrom}), declared or not. A declared attribute
 * goes to {@link checkValue} and is checked for `padded-attribute`, unless its value holds an
 * unexpanded entity reference, whose value is unknown, or it is a record's `base-type`, which is
 * `unknown-attribute` ({@link isRecordBaseType}). An undeclared one goes to {@link checkUndeclared},
 * with whether the Schematron's extension lists cover the element's name (reading 90), and one a
 * wildcard admits then to {@link checkWildXml}, which holds an `xml:id` to `xs:ID` and reads
 * `xml:lang` wherever it is written. Non-whitespace text in an element whose table admits none is
 * `text-not-allowed`. The placement and child-count rows go to {@link checkPlacement} and
 * {@link checkChildCounts}, and a default hotspot's place and a lookup table's outcome to
 * {@link checkDefaultHotspot} and {@link checkLookupTable}. The attributes and the text are checked
 * by the table that governs the element, and its `xsi:type` by the types its name is declared with.
 * The readings' rows name QTI's elements and attributes only.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param name The table of the element's name.
 * @param governed The table that governs the element, its name's or a valid `xsi:type`'s, with its
 *   tables' namespace.
 * @param parents Each walked element's parent, for the declaration a padded value reads and the
 *   namespace declarations in scope.
 * @param schemas The tables by namespace, for the derivations an `xsi:type` follows.
 * @param lastElements The last element child of each parent already scanned, which a default
 *   hotspot's place reads.
 * @returns The element's refusals: its placements, missing attributes, its `xsi:type` and `xsi:nil`,
 *   then each other attribute's in document order, then its text, then its child counts.
 */
const checkElement = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  name: ElementTable,
  governed: Governed,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
  lastElements: LastElements,
): readonly Refusal[] => {
  const { table } = governed;
  const refusals: Refusal[] = [
    ...checkPlacement(source, element, path, parents),
    ...checkDefaultHotspot(source, element, path, parents.get(element), lastElements),
    ...checkLookupTable(source, element, path, parents.get(element)),
  ];
  const label = elementName(element);
  const declared = table.attributes.filter((declaration) => declaration.use !== "prohibited");
  const covered = name.extensionCovered === true;

  for (const declaration of declared) {
    const present = element.attributes.some(
      (attribute) =>
        attribute.namespace === declaration.namespace && attribute.local === declaration.local,
    );
    if (declaration.use === "required" && !present) {
      refusals.push(
        refuse(source, "missing-attribute", path, {
          attribute: attributeName(declaration),
          element: label,
        }),
      );
    }
  }

  refusals.push(
    ...checkConditional(source, element, path, declared),
    ...checkRequired(source, element, path, Option.fromUndefinedOr(parents.get(element))),
    ...checkUntyped(source, element, path),
    ...checkInstance(source, element, path, name, parents, schemas),
  );
  for (const attribute of element.attributes) {
    if (isAllowance(attribute) || isInstanceAttribute(attribute)) {
      continue;
    }

    const withdrawn = withdrawnFrom(element, attribute);
    if (Option.isSome(withdrawn)) {
      refusals.push(
        refuse(source, "unknown-attribute", attributePath(path, attribute), {
          attribute: attributeName(attribute),
          element: label,
          reading: withdrawn.value.reading,
        }),
      );
      continue;
    }

    const declaration = declared.find(
      (candidate) =>
        candidate.namespace === attribute.namespace && candidate.local === attribute.local,
    );
    if (declaration === undefined) {
      refusals.push(
        ...Option.match(checkUndeclared(source, element, path, governed, covered, attribute), {
          onNone: () => checkWildXml(source, element, path, table.anyAttribute, attribute),
          onSome: (refusal) => [refusal],
        }),
      );
      continue;
    }

    if (attribute.references.length > 0) {
      continue;
    }

    if (isRecordBaseType(element, attribute, declaration.type)) {
      refusals.push(
        refuse(source, "unknown-attribute", attributePath(path, attribute), {
          attribute: attributeName(attribute),
          element: label,
          reading: "153",
        }),
      );
      continue;
    }

    refusals.push(...checkValue(source, element, path, declaration.type, attribute, declared));
    if (isPadded(element, attribute, parents)) {
      refusals.push(
        refuse(source, "padded-attribute", attributePath(path, attribute), {
          attribute: attributeName(attribute),
          element: label,
          reading: "7",
          value: attribute.value,
        }),
      );
    }
  }

  const holdsText = element.children.some(
    (child) => child.kind === "text" && nonXmlSpace.test(child.text),
  );
  if (holdsText && !table.text) {
    refusals.push(refuse(source, "text-not-allowed", path, { element: label }));
  }

  return [...refusals, ...checkChildCounts(source, element, path, parents)];
};

/**
 * Check the attributes of an element a simple type governs in lax wildcard content, by reading 60
 * ("a simple type it names governs its text and is checked").
 *
 * Such an element may hold no attribute but `xsi:type`, `xsi:nil`, `xsi:schemaLocation` and
 * `xsi:noNamespaceSchemaLocation` (XML Schema Part 1, section 3.3.4, Element Locally Valid (Type),
 * clause 3.1.1), so each other attribute is `unknown-attribute`, `xml:lang` included. A namespace
 * declaration, which the shared reader returns as an attribute, is not one. Its element children
 * are refused by the walk, and its text is accepted unchecked, plate's open limit that reading 60
 * records.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @returns Its attributes' refusals, in document order.
 */
const checkSimplyTyped = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
): readonly Refusal[] =>
  element.attributes
    .filter((attribute) => !isAllowance(attribute) && !isInstanceAttribute(attribute))
    .map((attribute) =>
      refuse(source, "unknown-attribute", attributePath(path, attribute), {
        attribute: attributeName(attribute),
        element: elementName(element),
        reading: "60",
      }),
    );

/**
 * How the walk treats one element: check it against its name's table, refuse it as
 * `unknown-element` (citing the reading that refuses it, if any), pass over it and admit its
 * children laxly, refusing its `xsi:type` where `mistyped` holds it, check it as an element a
 * simple type governs, by reading 60 ("a simple type it names governs its text and is checked"),
 * or pass over it and its subtree.
 */
type Admission =
  | { readonly kind: "check"; readonly table: ElementTable }
  | { readonly kind: "unknown"; readonly reading: Option.Option<string> }
  | { readonly kind: "lax"; readonly mistyped: Option.Option<SourceAttribute> }
  | { readonly kind: "simple" }
  | { readonly kind: "pass" };

/**
 * Report whether a named type is a simple type: one of XML Schema's built-in simple types, or a
 * type in the `types` of QTI's tables or another namespace's that is a union or restricts a simple
 * type (XML Schema Part 1, section 3.14). An extension is a complex type with simple content, and a
 * restriction of `xs:anyType` or of a complex type is complex, so neither is simple, nor is a name
 * that resolves to no type.
 *
 * @param type The type's name.
 * @param schemas The tables by namespace.
 * @returns Whether `type` names a simple type.
 */
const isSimpleType = (type: ChildName, schemas: Schemas): boolean => {
  const seen = new Set<string>();
  let current = type;
  while (current.namespace !== xsdNamespace) {
    const key = `{${current.namespace}}${current.local}`;
    const entry = Option.getOrUndefined(typeEntryOf(schemas, current));
    if (entry === undefined || entry.derivation === "extension" || seen.has(key)) {
      return false;
    }

    if (entry.derivation === "union") {
      return true;
    }

    seen.add(key);
    current = entry.base;
  }

  return builtinBases.has(current.local);
};

/**
 * What an element's `xsi:type` gives wildcard assessment where no global declaration governs the
 * element: none written; a value holding an unexpanded entity reference, whose type is unknown; a
 * value that is no QName or whose prefix no declaration in scope binds, which the attribute's own
 * built-in declaration refuses (reading 83); XML Schema's ur-type, `xs:anyType`; a simple type,
 * built in or in the `types` of the tables the walk holds; a complex type in those `types`; or a
 * QName that names no type of either.
 */
type InstanceType =
  | { readonly kind: "absent" }
  | { readonly kind: "complex" }
  | { readonly kind: "entity" }
  | { readonly kind: "simple" }
  | { readonly kind: "unresolvable"; readonly attribute: SourceAttribute }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ur-type" };

/**
 * Read an element's `xsi:type` as {@link InstanceType} sorts it.
 *
 * @param element The element.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns What its `xsi:type` gives.
 */
const instanceTypeOf = (
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): InstanceType => {
  const written = element.attributes.find(
    (attribute) => attribute.namespace === xsiNamespace && attribute.local === "type",
  );
  if (written === undefined) {
    return { kind: "absent" };
  }

  if (written.references.length > 0) {
    return { kind: "entity" };
  }

  return Option.match(resolveQName(written.value, element, parents), {
    onNone: (): InstanceType => ({ attribute: written, kind: "unresolvable" }),
    onSome: (type): InstanceType => {
      if (type.namespace === xsdNamespace && type.local === "anyType") {
        return { kind: "ur-type" };
      }

      if (isSimpleType(type, schemas)) {
        return { kind: "simple" };
      }

      return Option.isSome(typeEntryOf(schemas, type))
        ? { kind: "complex" }
        : { kind: "unresolved" };
    },
  });
};

/**
 * Decide how lax assessment treats an element no global declaration of the tables checks, by its
 * `xsi:type` (XML Schema Part 1, section 3.3.4, Schema-Validity Assessment (Element), clause 1.2).
 *
 * An `xsi:type` that resolves governs the element. Under a simple type, built in or in the `types`
 * of the tables the walk holds, the element may hold no attribute but the four `xsi:` ones and no
 * element child (section 3.3.4, Element Locally Valid (Type), clause 3.1), which the walk checks,
 * while its text is accepted unchecked: plate's open limit that reading 60 ("a simple type it names
 * governs its text and is checked") records. Under a complex type in those `types` it is kept
 * unchecked with everything below it, and so is an element whose `xsi:type` holds an unexpanded
 * entity reference, whose type is unknown (reading 50). An absent `xsi:type`, `xs:anyType`, and a
 * name that resolves to no type leave the element laxly assessed, against the ur-type definition,
 * which is the lax walk itself. So does an `xsi:type` that is no QName or whose prefix no
 * declaration in scope binds, which is itself refused: XML Schema still assesses it against its
 * built-in declaration, of type `xs:QName` (reading 83, "a prefix nothing binds makes the document
 * invalid").
 *
 * @param element The element.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns `simple` under a simple type, `pass` under a complex or unknown one, and `lax`
 *   otherwise, holding the `xsi:type` to refuse where it does not resolve.
 */
const admitByInstanceType = (
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): Admission => {
  const type = instanceTypeOf(element, parents, schemas);
  switch (type.kind) {
    case "complex":
    case "entity": {
      return { kind: "pass" };
    }
    case "simple": {
      return { kind: "simple" };
    }
    case "unresolvable": {
      return { kind: "lax", mistyped: Option.some(type.attribute) };
    }
    case "absent":
    case "unresolved":
    case "ur-type": {
      return { kind: "lax", mistyped: Option.none() };
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Decide how the walk treats an element in lax wildcard content, as XML Schema assesses an element
 * a `lax` wildcard matches (Part 1, section 3.10.4, and section 3.3.4, Schema-Validity Assessment
 * (Element)): by its declaration where one is found, and laxly otherwise.
 *
 * A root reading 6 keeps foreign, a nested QTI root or a manifest, is passed over with everything
 * below it. Any other element the tables declare globally, in QTI's namespace or another the walk
 * holds tables for, is checked by its table, its children following that table (rule `5b8ee08b`):
 * the tables stand for the document's schema set, whose global declarations a wildcard finds
 * (reading 81). Any other element, one declared only locally or an element of a namespace the walk
 * holds no tables for, is governed by its `xsi:type` where that resolves, as
 * {@link admitByInstanceType} decides: under a simple type its attributes and element children are
 * refused and its text accepted unchecked, plate's open limit that reading 60 ("a simple type it
 * names governs its text and is checked") records, and under a complex type it is passed over with
 * everything below it (reading 50). Without such a type it is passed over, and each of its children
 * admitted laxly in turn.
 *
 * @param element The element.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns How to treat the element.
 */
const admitLaxly = (
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): Admission => {
  if (isForeignRoot(element)) {
    return { kind: "pass" };
  }

  return Option.match(
    Option.filter(elementTableOf(schemas, element), (table) => table.global),
    {
      onNone: () => admitByInstanceType(element, parents, schemas),
      onSome: (table): Admission => ({ kind: "check", table }),
    },
  );
};

/**
 * Decide how the walk treats an element a `strict` wildcard admits, as XML Schema assesses it:
 * there must be a global declaration for it in the document's schema set, or an `xsi:type` naming a
 * type of that set or of XML Schema's (Part 1, section 3.10.1, and section 3.10.4, Item Valid
 * (Wildcard), clause 2), by reading 81 ("a `strict` wildcard refuses any other element unless its
 * `xsi:type` names a type of that set or a built-in").
 *
 * An element the tables declare globally is checked by its table, but a root reading 6 keeps
 * foreign, which stands by its declaration and is passed over with everything below it, as under
 * `lax` (reading 113). An element of a namespace the schema set imports but plate holds no tables
 * for, such as MathML in an item ({@link untabledOf}), is passed over with everything below it,
 * plate's open limit: the walk cannot tell its global declarations from none. Any other element
 * stands only by its `xsi:type`: a simple, complex or unknown one is treated as {@link
 * admitByInstanceType} treats it under `lax`, and `xs:anyType` leaves it laxly assessed. With no
 * `xsi:type`, or one that resolves to no type, it is refused as `unknown-element`, citing reading
 * 81, and not entered, so its `xsi:type` is not judged apart.
 *
 * @param element The element.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns How to treat the element.
 */
const admitStrictly = (
  element: SourceElement,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): Admission => {
  const table = Option.filter(elementTableOf(schemas, element), (declared) => declared.global);
  if (Option.isSome(table)) {
    return isForeignRoot(element) ? { kind: "pass" } : { kind: "check", table: table.value };
  }

  if (untabledOf(schemas).has(element.namespace)) {
    return { kind: "pass" };
  }

  const type = instanceTypeOf(element, parents, schemas);
  switch (type.kind) {
    case "complex":
    case "entity": {
      return { kind: "pass" };
    }
    case "simple": {
      return { kind: "simple" };
    }
    case "ur-type": {
      return { kind: "lax", mistyped: Option.none() };
    }
    case "absent":
    case "unresolvable":
    case "unresolved": {
      return { kind: "unknown", reading: Option.some("81") };
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Decide how the walk treats an element, from the table that governs its parent.
 *
 * An element is tabled when its namespace is QTI's or one whose tables the walk holds. The root is
 * checked when it is tabled and its tables declare its name, and refused when they do not; a root
 * in a namespace the walk holds no tables for is the verdict's `not-qti-root`, so it is passed
 * over. A child of an element a simple type governs in lax wildcard content is refused, citing
 * reading 60 ("a simple type it names governs its text and is checked"). A child of any other
 * element the walk did not check is passed over, unless the walk passed over the parent laxly: then
 * it is admitted laxly, by {@link admitLaxly}. A child its parent's table names is checked when it
 * is tabled and has a table, refused when it is tabled and has none, and passed over in any other
 * namespace. A child only the parent's element wildcard matches, `##other` read against the
 * namespace of the parent's tables, is admitted by the wildcard's `processContents`: laxly by
 * {@link admitLaxly}, strictly by {@link admitStrictly}, and passed over with everything below it
 * under `skip`. The wildcard of one of {@link ownNamespaceSlots} is read as `##any`, by reading 61
 * ("an element in QTI's own namespace inside `qti-ordering`'s extension slot is valid"), so a QTI
 * child there is admitted laxly too. Any other child is refused.
 *
 * @param element The element.
 * @param parent Its parent, none for the root.
 * @param checked The table that governs each element the walk has checked so far, with its
 *   tables' namespace.
 * @param laxed Each element the walk has passed over so far while admitting its children laxly.
 * @param simple Each element the walk has found so far that a simple type governs in lax wildcard
 *   content.
 * @param parents Each walked element's parent, for the namespace declarations in scope.
 * @param schemas The tables by namespace.
 * @returns How to treat the element.
 */
const admit = (
  element: SourceElement,
  parent: Option.Option<SourceElement>,
  checked: ReadonlyMap<SourceElement, Governed>,
  laxed: ReadonlySet<SourceElement>,
  simple: ReadonlySet<SourceElement>,
  parents: ReadonlyMap<SourceElement, SourceElement>,
  schemas: Schemas,
): Admission => {
  /**
   * Admit the element by its own table: passed over when it is not tabled, checked when its
   * namespace's tables declare its local name, and unknown when they do not.
   *
   * @returns The element's admission.
   */
  const byTable = (): Admission => {
    if (!schemas.has(element.namespace)) {
      return { kind: "pass" };
    }

    return Option.match(elementTableOf(schemas, element), {
      onNone: () => ({ kind: "unknown", reading: Option.none() }),
      onSome: (table) => ({ kind: "check", table }),
    });
  };

  if (Option.isNone(parent)) {
    return byTable();
  }

  if (simple.has(parent.value)) {
    return { kind: "unknown", reading: Option.some("60") };
  }

  const governed = checked.get(parent.value);
  if (governed === undefined) {
    return laxed.has(parent.value) ? admitLaxly(element, parents, schemas) : { kind: "pass" };
  }

  const named = governed.table.children.some(
    (child) => child.namespace === element.namespace && child.local === element.local,
  );
  if (named) {
    return byTable();
  }

  const declared = governed.table.anyElement;
  const wildcard =
    declared !== undefined &&
    parent.value.namespace === qtiNamespace &&
    ownNamespaceSlots.has(parent.value.local)
      ? { ...declared, namespace: "##any" as const }
      : declared;
  if (wildcard === undefined || !wildcardAdmits(wildcard, element.namespace, governed.namespace)) {
    return { kind: "unknown", reading: Option.none() };
  }

  switch (wildcard.process) {
    case "lax": {
      return admitLaxly(element, parents, schemas);
    }
    case "strict": {
      return admitStrictly(element, parents, schemas);
    }
    case "skip": {
      return { kind: "pass" };
    }
    default: {
      return wildcard.process satisfies never;
    }
  }
};

/**
 * One element the walk visits, in document order: checked by the table that governs it, checked as
 * an element a simple type governs in lax wildcard content, by reading 60 ("a simple type it names
 * governs its text and is checked"), refused as `unknown-element`, citing the reading that refuses
 * it, if any, or passed over laxly, its attributes assessed against the ur-type ({@link
 * checkPassed}): `mistyped` holds its `xsi:type` to refuse where that does not resolve, by reading
 * 83 ("a prefix nothing binds makes the document invalid"), and `qti` whether the walk reached it
 * below an element QTI's tables govern, so that its `xml:id` is one of the document's IDs
 * ({@link idEntriesOf}).
 */
type Step =
  | {
      readonly governed: Governed;
      readonly kind: "check";
      readonly name: ElementTable;
      readonly visit: Visit;
    }
  | {
      readonly kind: "lax";
      readonly mistyped: Option.Option<SourceAttribute>;
      readonly qti: boolean;
      readonly visit: Visit;
    }
  | { readonly kind: "simple"; readonly visit: Visit }
  | { readonly kind: "unknown"; readonly reading: Option.Option<string>; readonly visit: Visit };

/**
 * The walk of a document: each element it checks, refuses or passes over laxly, the table that
 * governs each element it checks with its tables' namespace, and each element's parent.
 */
interface Walked {
  readonly governing: ReadonlyMap<SourceElement, Governed>;
  readonly parents: ReadonlyMap<SourceElement, SourceElement>;
  readonly steps: readonly Step[];
}

/**
 * Walk a document once from its root, deciding how each element is treated and, for each element
 * it checks, which table governs it: its name's, or the table of the type a valid `xsi:type` names.
 * An element's children are admitted by the table that governs it, laxly when the walk passed over
 * it in lax wildcard content, and as `unknown-element` when a simple type governs it there, by
 * reading 60 ("a simple type it names governs its text and is checked"). An element passed over
 * laxly leaves a step that holds its `xsi:type` where that does not resolve, and whether it lies
 * below an element QTI's tables govern, with elements passed over laxly between.
 *
 * @param source The document.
 * @param schemas The tables by namespace.
 * @returns The walk.
 */
const walkTables = (source: SourceDocument, schemas: Schemas): Walked => {
  const parents = new Map<SourceElement, SourceElement>();
  const governing = new Map<SourceElement, Governed>();
  const laxed = new Set<SourceElement>();
  const simple = new Set<SourceElement>();
  // Each element QTI's tables govern, and each element passed over laxly below one.
  const underQti = new Set<SourceElement>();
  const steps: Step[] = [];

  for (const visit of walk(source)) {
    const { element, parent } = visit;
    if (Option.isSome(parent)) {
      parents.set(element, parent.value);
    }

    const admission = admit(element, parent, governing, laxed, simple, parents, schemas);
    if (admission.kind === "lax") {
      laxed.add(element);

      const qti = Option.exists(parent, (container) => underQti.has(container));
      if (qti) {
        underQti.add(element);
      }

      steps.push({ kind: "lax", mistyped: admission.mistyped, qti, visit });
    } else if (admission.kind === "simple") {
      simple.add(element);
      steps.push({ kind: "simple", visit });
    } else if (admission.kind === "unknown") {
      steps.push({ kind: "unknown", reading: admission.reading, visit });
    } else if (admission.kind === "check") {
      const name = admission.table;
      const governed = Option.getOrElse(
        namedType(element, name, parents, schemas),
        (): Governed => ({ namespace: element.namespace, table: name }),
      );
      governing.set(element, governed);
      if (governed.namespace === qtiNamespace) {
        underQti.add(element);
      }

      steps.push({ governed, kind: "check", name, visit });
    }
  }

  return { governing, parents, steps };
};

/**
 * Find the children out of the order reading 96 ("a repeated wildcard keeps its sequence's order")
 * keeps. In each element the walk checks whose content model is one of {@link wildcardLast}, a
 * child its table names stands in a particle before the wildcard's, so once a child only the
 * wildcard admits has come, every such child after it is out of order (XML Schema Part 1, section
 * 3.8.4, Element Sequence Valid). A child neither the table names nor the wildcard admits is
 * refused as `unknown-element` and holds no place in the sequence.
 *
 * @param governing The table that governs each element the walk checks, with its tables'
 *   namespace.
 * @returns The children out of order.
 */
const misorderedOf = (
  governing: ReadonlyMap<SourceElement, Governed>,
): ReadonlySet<SourceElement> => {
  const misordered = new Set<SourceElement>();
  for (const [element, { namespace, table }] of governing) {
    const wildcard = table.anyElement;
    if (wildcard === undefined || !wildcardLast.has(`{${element.namespace}}${element.local}`)) {
      continue;
    }

    let held = false;
    for (const child of element.children) {
      if (child.kind !== "element") {
        continue;
      }

      const named = table.children.some(
        (name) => name.namespace === child.namespace && name.local === child.local,
      );
      if (named && held) {
        misordered.add(child);
      } else if (!named && wildcardAdmits(wildcard, child.namespace, namespace)) {
        held = true;
      }
    }
  }

  return misordered;
};

/**
 * Check a child's place in its parent's sequence by reading 96 ("a repeated wildcard keeps its
 * sequence's order"): one {@link misorderedOf} finds, after a child the parent's repeated wildcard
 * holds, is `misplaced-element`, `check: "order"`, naming the parent, its `context`.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param parent The element's parent, none for the root.
 * @param misordered The children out of order.
 * @returns Its `misplaced-element` refusal, or none.
 */
const checkOrder = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  parent: Option.Option<SourceElement>,
  misordered: ReadonlySet<SourceElement>,
): readonly Refusal[] =>
  Option.match(parent, {
    onNone: () => [],
    onSome: (container) =>
      misordered.has(element)
        ? [
            refuse(source, "misplaced-element", path, {
              check: "order",
              context: elementName(container),
              element: elementName(element),
              reading: "96",
            }),
          ]
        : [],
  });

/**
 * Refuse the `xsi:type` of an element in wildcard content that it does not resolve, as XML Schema
 * assesses the attribute against its built-in declaration, of type `xs:QName`, though no
 * declaration governs the element: a QName whose prefix no declaration in scope binds by reading
 * 83 ("a prefix nothing binds makes the document invalid"), and a value that is no QName by
 * reading 47, which judges `xsi:type` as XML Schema does.
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param attribute Its `xsi:type`.
 * @returns The `attribute-type` refusal.
 */
const refuseMistyped = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  attribute: SourceAttribute,
): Refusal => {
  const qualified = Option.isSome(qNameParts(attribute.value));

  return refuse(source, "attribute-type", attributePath(path, attribute), {
    attribute: attributeName(attribute),
    element: elementName(element),
    expected: qualified ? "a QName whose prefix a namespace declaration in scope binds" : "a QName",
    reading: qualified ? "83" : "47",
    value: attribute.value,
  });
};

/**
 * The attribute wildcard of the ur-type definition, `xs:anyType`, against which XML Schema assesses
 * an element no declaration governs in lax wildcard content (Part 1, section 3.4.7): every
 * namespace, laxly, so an attribute of XML's own namespace, which `xml.xsd` declares globally, is
 * assessed by its declaration, and an attribute nothing declares globally is not assessed.
 */
const urTypeAttributes: Wildcard = { namespace: "##any", process: "lax" };

/**
 * Check an element the walk passes over laxly, as XML Schema assesses it against the ur-type:
 * its `xsi:type` where that does not resolve ({@link refuseMistyped}), then each attribute in
 * document order as {@link checkWildXml} checks one the ur-type's wildcard admits
 * ({@link urTypeAttributes}), so an `xml:id` is held to `xs:ID` and `xml:lang` to reading 129's
 * rows. Its `xml:id` is one of the document's IDs where it lies below an element QTI's tables
 * govern ({@link idEntriesOf}).
 *
 * @param source The document.
 * @param element The element.
 * @param path The element's path.
 * @param mistyped Its `xsi:type`, where that does not resolve.
 * @returns Its refusals, its `xsi:type`'s first.
 */
const checkPassed = (
  source: SourceDocument,
  element: SourceElement,
  path: string,
  mistyped: Option.Option<SourceAttribute>,
): readonly Refusal[] => [
  ...Option.match(mistyped, {
    onNone: () => [],
    onSome: (attribute) => [refuseMistyped(source, element, path, attribute)],
  }),
  ...element.attributes.flatMap((attribute) =>
    checkWildXml(source, element, path, urTypeAttributes, attribute),
  ),
];

/**
 * The IDREFs a reading sets aside, by element and attribute, each with the reading: the XSD types
 * them `xs:IDREF`, and the table does not resolve them.
 *
 * Reading 15 ("a `variable-identifier-ref` names an outcome declaration, not an `xs:ID`"): an
 * outcome declaration's `variable-identifier-ref` names an external variable, so its value is read
 * as the `NCName` it is spelled as, and never as a reference into the table.
 */
const idrefsSetAside: readonly { readonly attribute: string; readonly element: string }[] = [
  { attribute: "variable-identifier-ref", element: "qti-outcome-declaration" },
];

/**
 * The declarations whose identifier is one of the document's IDs: a response declaration's, typed
 * `UniqueIdentifierDType`, an `xs:ID` (reading 14), and a context declaration's, typed `xs:NCName`,
 * which reading 74 ("an identifier names one variable among the declarations of its document")
 * makes unique among the document's IDs as the information model calls it a UniqueIdentifier. The
 * value names the reading a repeat cites.
 */
const identifyingDeclarations: ReadonlyMap<string, string> = new Map([
  ["qti-context-declaration", "74"],
  ["qti-response-declaration", "14"],
]);

/**
 * One attribute value of the document's ID/IDREF table, as the walk found it.
 */
interface IdEntry {
  readonly attribute: SourceAttribute;
  /**
   * The reading a repeat cites when the attribute is the `identifier` of one of the root's
   * {@link identifyingDeclarations}, none otherwise.
   */
  readonly declaration: Option.Option<string>;
  readonly element: SourceElement;
  readonly path: string;
  readonly role: IdRole;
}

/**
 * Find the role an attribute of an element the walk checks takes in the ID/IDREF table.
 *
 * A declared attribute takes its declaration's type's role ({@link idRoleOf}), but for an IDREF a
 * reading sets aside ({@link idrefsSetAside}); XML's `xml:id` is an ID wherever a table declares
 * it, since `xml.xsd` types it `xs:ID`; and a context declaration's `identifier` is an ID by
 * reading 74 ({@link identifyingDeclarations}). An undeclared attribute is an ID only as a wild ID
 * ({@link isWildId}) that stands: not on an element the Schematron's extension lists cover, where
 * reading 90 refuses it, and not beside a declared ID attribute use, where reading 109 does.
 *
 * @param element The element.
 * @param governed The table that governs it, with its tables' namespace.
 * @param covered Whether the extension lists cover the element, by its name's table.
 * @param attribute The attribute, which is no allowance, `xsi:type` or `xsi:nil`.
 * @returns The role, or none for an attribute that takes no part.
 */
const roleOf = (
  element: SourceElement,
  governed: Governed,
  covered: boolean,
  attribute: SourceAttribute,
): Option.Option<IdRole> => {
  const declaration = governed.table.attributes.find(
    (candidate) =>
      candidate.use !== "prohibited" &&
      candidate.namespace === attribute.namespace &&
      candidate.local === attribute.local,
  );
  if (declaration === undefined) {
    return isWildId(governed, attribute) && !covered && !declaresId(governed.table)
      ? Option.some("id")
      : Option.none();
  }

  if (attribute.namespace === xmlNamespace && attribute.local === "id") {
    return Option.some("id");
  }

  const qti = element.namespace === qtiNamespace && attribute.namespace === "";
  if (qti && attribute.local === "identifier" && element.local === "qti-context-declaration") {
    return Option.some("id");
  }

  const setAside = idrefsSetAside.some(
    (row) => qti && row.element === element.local && row.attribute === attribute.local,
  );

  return setAside ? Option.none() : idRoleOf(declaration.type);
};

/**
 * Collect the ID/IDREF table's entries from the walk's steps, in document order.
 *
 * Only elements QTI's tables govern take part, and the elements the walk passes over laxly below
 * them, whose `xml:id` alone is an entry: lax assessment judges it by `xml.xsd`'s declaration, of
 * type `xs:ID`, and assesses no other attribute of theirs, which nothing declares globally. A
 * manifest's ID and IDREF typing is not applied, a limit by rule `db2ef322`, since the manifest's
 * own rules already refuse a dependency that names no resource (`dependency-unresolved`). An
 * attribute a reading withdraws takes no part.
 *
 * @param source The document.
 * @param steps The walk's steps.
 * @returns Each attribute with a role, with its element and the element's path.
 */
const idEntriesOf = (source: SourceDocument, steps: readonly Step[]): readonly IdEntry[] =>
  steps.flatMap((step): readonly IdEntry[] => {
    if (step.kind === "lax" && step.qti) {
      const { element, path } = step.visit;

      return element.attributes
        .filter((attribute) => attribute.namespace === xmlNamespace && attribute.local === "id")
        .map((attribute): IdEntry => ({
          attribute,
          declaration: Option.none(),
          element,
          path,
          role: "id",
        }));
    }

    if (step.kind !== "check" || step.governed.namespace !== qtiNamespace) {
      return [];
    }

    const { element, parent, path } = step.visit;
    const covered = step.name.extensionCovered === true;
    const atRoot = Option.exists(parent, (container) => container === source.root);

    return element.attributes.flatMap((attribute): readonly IdEntry[] => {
      if (
        isAllowance(attribute) ||
        isInstanceAttribute(attribute) ||
        Option.isSome(withdrawnFrom(element, attribute))
      ) {
        return [];
      }

      const identifying =
        atRoot && element.namespace === qtiNamespace && attribute.namespace === ""
          ? Option.fromUndefinedOr(identifyingDeclarations.get(element.local))
          : Option.none();
      const declaration = attribute.local === "identifier" ? identifying : Option.none<string>();

      return Option.toArray(
        Option.map(roleOf(element, step.governed, covered, attribute), (role) => ({
          attribute,
          declaration,
          element,
          path,
          role,
        })),
      );
    });
  });

/**
 * What the walk does not check that may hold IDs, so that an IDREF it cannot resolve is not refused
 * for want of them.
 */
interface Unwalked {
  /**
   * The `id` and `xml:id` values of every element of a MathML or SSML island, collapsed: those
   * languages type them `xs:ID`, and the walk keeps their elements without checking them.
   */
  readonly ids: ReadonlySet<string>;
  /**
   * Whether the document holds an XInclude element: an included fragment's IDs are its assembly's
   * (reading 117, "an included fragment is judged in place"), so an IDREF may name an ID only the
   * fragment holds.
   */
  readonly includes: boolean;
}

/**
 * Find what the walk does not check that may hold IDs ({@link Unwalked}).
 *
 * @param source The document.
 * @returns The islands' IDs and whether the document includes a fragment.
 */
const unwalkedOf = (source: SourceDocument): Unwalked => {
  const islands = new Set<SourceElement>();
  const ids = new Set<string>();
  let includes = false;
  for (const { element, parent } of walk(source)) {
    includes ||= element.namespace === xincludeNamespace;
    const island =
      element.namespace === mathmlNamespace ||
      element.namespace === ssmlNamespace ||
      Option.exists(parent, (container) => islands.has(container));
    if (!island) {
      continue;
    }

    islands.add(element);
    for (const attribute of element.attributes) {
      const named =
        attribute.local === "id" &&
        (attribute.namespace === "" || attribute.namespace === xmlNamespace);
      if (named) {
        ids.add(collapse(attribute.value));
      }
    }
  }

  return { ids, includes };
};

/**
 * Find the ID an entry of the ID/IDREF table binds: its value collapsed, where the entry is an ID
 * whose value holds no unexpanded entity reference and is an NCName once collapsed. Any other value
 * binds nothing (reading 156).
 *
 * @param entry The entry.
 * @returns The ID it binds, or none.
 */
const boundIdOf = (entry: IdEntry): Option.Option<string> => {
  if (entry.role !== "id" || entry.attribute.references.length > 0) {
    return Option.none();
  }

  const value = collapse(entry.attribute.value);

  return isNcName(value) ? Option.some(value) : Option.none();
};

/**
 * Keep the document's ID/IDREF table (XML Schema Part 1, section 3.15.5, and section 3.3.4,
 * Validation Root Valid (ID/IDREF); readings 101 and 156) and give each element its refusals.
 *
 * The table holds every attribute of an element QTI's tables govern whose type, the governing
 * type's (reading 84), derives from `ID`, and so the response declarations' identifiers (reading
 * 14); a context declaration's identifier (reading 74); a wild `xml:id` that stands (reading 109);
 * and the `xml:id` of an element the walk passes over laxly below one QTI's tables govern. Only a
 * value that is an NCName once collapsed is an ID; any other binds nothing and its value domain
 * alone refuses it (reading 156). Then:
 *
 * - An ID a different element already gave is `duplicate-identifier` at the later attribute, its
 *   detail the `identifier` and the reading that makes the two collide: 14 where a response
 *   declaration's identifier is one of them (D3b), 74 where a context declaration's is (E1b), and
 *   101 otherwise (cvc-id clause 2). Two of the root's declarations that share an identifier are
 *   not refused here: the prose rules refuse them as two declarations of one name (E1a).
 * - Each value of an IDREF, and each token of a list of IDREFs, that names no ID is `attribute-type`,
 *   `check: "idref-target"`, at the attribute, its detail the token as the `value` (cvc-id clause
 *   1, reading 156). One that is no NCName names no ID. An IDREF a reading sets aside is not
 *   resolved ({@link idrefsSetAside}).
 *
 * Its limits, each recorded here: an ID an element's text carries under an `xsi:type` (reading 101)
 * takes no part, since the walk does not check simply typed text (reading 60), so the table holds
 * attributes alone, as reading 91 requires a rule a package cannot yet check to be recorded. An
 * `xml:id` of content the walk never visits takes no part (the reading-129 rows' comment names that
 * content). A manifest's IDs and IDREFs are not judged ({@link idEntriesOf}). An IDREF is not
 * refused where the table cannot be complete: in a document that includes a fragment, whose IDs are
 * its assembly's (reading 117), and where an ID attribute's value holds an unexpanded entity
 * reference; nor where it names an `id` or `xml:id` of a MathML or SSML island, which the walk
 * keeps unchecked ({@link unwalkedOf}). An attribute whose value holds an unexpanded entity
 * reference is unknown and not judged.
 *
 * @param source The document.
 * @param steps The walk's steps.
 * @returns Each element's ID and IDREF refusals, in the order of its attributes; an element with
 *   none has no entry.
 */
const checkIds = (
  source: SourceDocument,
  steps: readonly Step[],
): ReadonlyMap<SourceElement, readonly Refusal[]> => {
  const entries = idEntriesOf(source, steps);
  const unwalked = unwalkedOf(source);
  const firsts = new Map<string, IdEntry>();
  const repeats = new Map<IdEntry, Refusal>();
  let complete = !unwalked.includes;
  for (const entry of entries) {
    if (entry.role === "id" && entry.attribute.references.length > 0) {
      complete = false;
    }

    const bound = boundIdOf(entry);
    if (Option.isNone(bound)) {
      continue;
    }

    const { value } = bound;
    const earlier = firsts.get(value);
    if (earlier === undefined) {
      firsts.set(value, entry);
      continue;
    }

    const bothDeclared = Option.isSome(earlier.declaration) && Option.isSome(entry.declaration);
    if (earlier.element === entry.element || bothDeclared) {
      continue;
    }

    const reading = Option.getOrElse(
      Option.orElse(entry.declaration, () => earlier.declaration),
      () => "101",
    );
    repeats.set(
      entry,
      refuse(source, "duplicate-identifier", attributePath(entry.path, entry.attribute), {
        identifier: value,
        reading,
      }),
    );
  }

  const refusals = new Map<SourceElement, Refusal[]>();
  for (const entry of entries) {
    const found: Refusal[] = [];
    const repeat = repeats.get(entry);
    if (repeat !== undefined) {
      found.push(repeat);
    }

    if (entry.role !== "id" && complete && entry.attribute.references.length === 0) {
      const lexical = collapse(entry.attribute.value);
      const tokens =
        entry.role === "idref" ? [lexical] : lexical.split(" ").filter((token) => token !== "");
      for (const token of tokens) {
        if (!firsts.has(token) && !unwalked.ids.has(token)) {
          found.push(
            refuse(source, "attribute-type", attributePath(entry.path, entry.attribute), {
              attribute: attributeName(entry.attribute),
              check: "idref-target",
              element: elementName(entry.element),
              reading: "156",
              value: token,
            }),
          );
        }
      }
    }

    if (found.length > 0) {
      refusals.set(entry.element, [...(refusals.get(entry.element) ?? []), ...found]);
    }
  }

  return refusals;
};

/**
 * Give the document's IDs as its ID/IDREF table binds them ({@link checkIds}), each with the
 * element that holds it: the declared ID attributes of the elements QTI's tables govern, a response
 * declaration's identifier among them (reading 14), a context declaration's identifier (reading
 * 74), a wild `xml:id` that stands (reading 109) and the `xml:id` of an element passed over laxly
 * below one QTI's tables govern, as {@link idEntriesOf} finds them, each collapsed and an NCName
 * ({@link boundIdOf}). An ID two elements give is held by the first, in document order, as the
 * table resolves an IDREF to it. The `id` and `xml:id` of a MathML or SSML island are not among
 * them, since the walk keeps those elements unchecked ({@link unwalkedOf}).
 *
 * It walks the document again, so a caller asks for it only where it needs it.
 *
 * @param source The document.
 * @param tables The tables generated from the QTI XSD.
 * @returns Each ID, keyed by its value, with the element that holds it.
 */
export const idHoldersOf = (
  source: SourceDocument,
  tables: Tables,
): ReadonlyMap<string, SourceElement> => {
  const holders = new Map<string, SourceElement>();
  for (const entry of idEntriesOf(source, walkTables(source, schemasOf(tables)).steps)) {
    const bound = boundIdOf(entry);
    if (Option.isSome(bound) && !holders.has(bound.value)) {
      holders.set(bound.value, entry.element);
    }
  }

  return holders;
};

/**
 * Give each element the structural walk checks with the table that governs it (AD-9).
 *
 * That is the element's name's table, or, after a valid `xsi:type` naming a type of QTI's tables
 * or of another namespace's, that type's own entry in their `types`: for a name declared with
 * several types, the named type's table, not the union. A type of XML Schema's leaves the name's
 * table in force. The elements the walk checks in lax wildcard content, and the elements of the
 * namespaces `others` holds, are among them. An element the walk passes over or refuses has no
 * entry. {@link checkStructure} walks by the same tables, so the two cannot drift.
 *
 * @param source The document, as the reader adapter built it.
 * @param tables The tables generated from the QTI XSD.
 * @param others The tables of other namespaces, keyed by namespace URI, by which the walk checks
 *   those namespaces' elements as it checks QTI's; none by default. An entry for QTI's namespace is
 *   set aside.
 * @returns The table that governs each checked element, keyed by the element; each value is the
 *   element's table or the type's entry itself, never a copy.
 */
export const governingTables = (
  source: SourceDocument,
  tables: Tables,
  others?: ReadonlyMap<string, Tables>,
): ReadonlyMap<SourceElement, ContentTable> =>
  new Map(
    Array.from(walkTables(source, schemasOf(tables, others)).governing, ([element, governed]) => [
      element,
      governed.table,
    ]),
  );

/**
 * Check a document against the XSD's tables, every structural rule at once.
 *
 * The walk starts at the root and enters every QTI-namespace element the tables admit, lax and
 * strict wildcard content included, and every element of a namespace `others` holds, which it
 * checks by that namespace's tables by the same rules, `xsi:type`, `xsi:nil` and wildcard content
 * among them. It refuses `unknown-element`, `unknown-attribute`, `missing-attribute`,
 * `attribute-type`, `padded-attribute` and `text-not-allowed`, and the readings'
 * `misplaced-element`, the order after a repeated wildcard among them (reading 96), `child-count`
 * and `count-range`, each at the path of the element or attribute at fault. Over QTI's elements it
 * keeps the document's ID/IDREF table ({@link checkIds}): a repeated ID is `duplicate-identifier`,
 * and an IDREF that names no ID is `attribute-type`, `check: "idref-target"`, after the element's
 * other refusals. The readings are QTI's and apply to QTI's elements only, but for the rows that
 * read XML's own `xml:lang`, which hold on every element the walk checks or passes over laxly
 * (reading 129). An element passed over laxly is assessed against the ur-type ({@link
 * checkPassed}): its unresolvable `xsi:type` and its `xml:id` and `xml:lang` are judged, and below
 * an element QTI's tables govern its `xml:id` is one of the IDs. Each element is checked by the
 * table {@link governingTables} gives it, except one a simple type governs in lax wildcard content,
 * whose attributes and element children are refused and whose text is not checked, plate's open
 * limit that reading 60 ("a simple type it names governs its text and is checked") records. It does
 * not enter an element it refuses as unknown, and does enter a misplaced one. A document whose root
 * is outside QTI's namespace and every namespace of `others` yields nothing here: that is the
 * verdict's `not-qti-root`.
 *
 * @param source The document, as the reader adapter built it.
 * @param tables The tables generated from the QTI XSD.
 * @param others The tables of other namespaces, keyed by namespace URI; none by default, which
 *   checks QTI's elements alone. An entry for QTI's namespace is set aside.
 * @returns Every refusal, in document order; empty when the document's structure is valid.
 */
export const checkStructure = (
  source: SourceDocument,
  tables: Tables,
  others?: ReadonlyMap<string, Tables>,
): readonly Refusal[] => {
  const schemas = schemasOf(tables, others);
  const { governing, parents, steps } = walkTables(source, schemas);
  const misordered = misorderedOf(governing);
  const identified = checkIds(source, steps);
  const lastElements: LastElements = new Map();

  return steps.flatMap((step): readonly Refusal[] => {
    const { element, parent, path } = step.visit;
    if (step.kind === "check") {
      return [
        ...checkOrder(source, element, path, parent, misordered),
        ...checkElement(
          source,
          element,
          path,
          step.name,
          step.governed,
          parents,
          schemas,
          lastElements,
        ),
        ...(identified.get(element) ?? []),
      ];
    }

    if (step.kind === "simple") {
      return checkSimplyTyped(source, element, path);
    }

    if (step.kind === "lax") {
      return [
        ...checkPassed(source, element, path, step.mistyped),
        ...(identified.get(element) ?? []),
      ];
    }

    const named = Option.match(parent, {
      onNone: () => ({ element: elementName(element) }),
      onSome: (container) => ({ element: elementName(element), parent: elementName(container) }),
    });
    const detail = Option.match(step.reading, {
      onNone: () => named,
      onSome: (reading) => ({ ...named, reading }),
    });

    return [refuse(source, "unknown-element", path, detail)];
  });
};
