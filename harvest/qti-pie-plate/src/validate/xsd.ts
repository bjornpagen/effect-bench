/**
 * The QTI XSD as tables: for every element the XSD declares, the attributes it admits with their
 * types and its attribute wildcard, the children it admits, its element wildcard, whether it holds
 * text, whether it is declared globally, the types it is declared with and whether the
 * Schematron's extension rules cover it; and for every named type, what it derives from and how,
 * and its own table of the same attributes, children, wildcards and text. {@link generateTables}
 * builds them from the XSD's source view; structural validation reads them and never the XSD
 * itself. {@link generateOccurrences} gives, for the same elements and types, how many times each
 * one's content model admits each child it names.
 *
 * @module
 */
import { Config, Effect, Option, Schema } from "effect";
import type {
  SourceAttribute,
  SourceChild,
  SourceDocument,
  SourceElement,
} from "#plate/document/source.ts";
import { xmlNamespace, xmlnsNamespace, xsdNamespace } from "#plate/document/source.ts";
import { isNcName } from "#plate/model/values.ts";

/**
 * Where the XSD is cached: `.cache/gr8des/qti3/xsd/imsqti_asiv3p0p1_v1p0.xsd` under `HOME`. Only
 * the script that regenerates the tables and the tables' test read it.
 *
 * It is defined here, not beside the committed tables in `src/validate/tables.ts`, because that
 * module decodes the committed tables when it loads: after a change to the tables' Schema the old
 * file no longer decodes, and importing it would stop the regeneration that replaces it.
 */
export const xsdPath = Config.NonEmptyString("HOME").pipe(
  Config.map((home) => `${home}/.cache/gr8des/qti3/xsd/imsqti_asiv3p0p1_v1p0.xsd`),
);

/**
 * The XML Schema built-in types a table records by name.
 *
 * They are the built-ins the QTI XSD uses but `IDREFS`, which records as a list of `IDREF`. `ID`
 * and `IDREF` record by their own names, each checked as the `NCName` it restricts, so that
 * structural validation can keep a document's ID/IDREF table (XML Schema Part 1, section 3.15.5;
 * readings 101 and 156): which values are IDs, and which name one, follows the type that governs
 * each attribute (reading 84). Whether an identifier names a declared variable is a prose rule.
 */
export const builtinNames = [
  "anyType",
  "anyURI",
  "boolean",
  "decimal",
  "double",
  "ID",
  "IDREF",
  "int",
  "integer",
  "NCName",
  "nonNegativeInteger",
  "normalizedString",
  "string",
] as const;

/**
 * The name of a built-in type a table records.
 */
export type BuiltinName = (typeof builtinNames)[number];

/**
 * The Schema of a built-in type's name.
 */
const Builtin = Schema.Literals(builtinNames);

/**
 * The type of an attribute's value, as the XSD's simple type defines it.
 *
 * Each kind records the built-in it derives from: an `enumeration` or a `pattern` by its `base`, a
 * `builtin` by its `name`, and a `list` or a `union` through its item or members. `minInclusive` is
 * the facet's lexical value, so an integer bound stays exact.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `AttributeType` is the type and the Schema of an attribute's type under one name, as section 0.5 of the phase-1 slice list names it; the type is written out because the Schema is recursive.
export type AttributeType =
  | { readonly base: BuiltinName; readonly kind: "enumeration"; readonly values: readonly string[] }
  | { readonly item: AttributeType; readonly kind: "list" }
  | { readonly kind: "union"; readonly members: readonly AttributeType[] }
  | { readonly kind: "builtin"; readonly minInclusive?: string; readonly name: BuiltinName }
  | { readonly base: BuiltinName; readonly kind: "pattern"; readonly pattern: string };

/**
 * The Schema of an attribute's type, recursive through a list's item and a union's members.
 */
export const AttributeType: Schema.Codec<AttributeType> = Schema.Union([
  Schema.Struct({
    base: Builtin,
    kind: Schema.Literal("enumeration"),
    values: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    item: Schema.suspend((): Schema.Codec<AttributeType> => AttributeType),
    kind: Schema.Literal("list"),
  }),
  Schema.Struct({
    kind: Schema.Literal("union"),
    members: Schema.Array(Schema.suspend((): Schema.Codec<AttributeType> => AttributeType)),
  }),
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    minInclusive: Schema.optionalKey(Schema.String),
    name: Builtin,
  }),
  Schema.Struct({ base: Builtin, kind: Schema.Literal("pattern"), pattern: Schema.String }),
]);

/**
 * The Schema of a wildcard, the `xs:anyAttribute` or `xs:any` of an element's type.
 *
 * `namespace` is `##any`, `##other` (any namespace except the target namespace, which is QTI's, and
 * except no namespace) or the sorted list of namespaces it admits, `""` standing for no namespace.
 * `process` is the wildcard's `processContents`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `Wildcard` is the Schema and the type of a wildcard under one name, as section 0.5 of the phase-1 slice list names it.
export const Wildcard = Schema.Struct({
  namespace: Schema.Union([Schema.Literals(["##any", "##other"]), Schema.Array(Schema.String)]),
  process: Schema.Literals(["strict", "lax", "skip"]),
});

/**
 * A wildcard, as {@link Wildcard} decodes it.
 */
export type Wildcard = typeof Wildcard.Type;

/**
 * The namespace rule of a wildcard.
 */
type WildcardNamespace = Wildcard["namespace"];

/**
 * The Schema of a name by namespace and local name: an element an element table admits as a child,
 * or a type a table names.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `ChildName` is the Schema and the type of a child's name under one name, as section 0.5 of the phase-1 slice list names it.
export const ChildName = Schema.Struct({ local: Schema.String, namespace: Schema.String });

/**
 * A child's name, as {@link ChildName} decodes it.
 */
export type ChildName = typeof ChildName.Type;

/**
 * The Schema of one attribute an element admits by name: its namespace, `""` for none, and local
 * name, its `use`, its `default` when the XSD gives one, and its type.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `AttributeTable` is the Schema and the type of an attribute's table under one name, as section 0.5 of the phase-1 slice list names it.
export const AttributeTable = Schema.Struct({
  default: Schema.optionalKey(Schema.String),
  local: Schema.String,
  namespace: Schema.String,
  type: AttributeType,
  use: Schema.Literals(["required", "optional", "prohibited"]),
});

/**
 * An attribute's table, as {@link AttributeTable} decodes it.
 */
export type AttributeTable = typeof AttributeTable.Type;

/**
 * The Schema of what a table admits, the fields an element's table and a named type's entry
 * share: the attributes it admits by name, sorted by namespace then local name, and its attribute
 * wildcard; the children it admits, sorted the same way, its element wildcard, and whether it holds
 * text.
 *
 * A missing wildcard is an absent key, never `null`, so a table writes to JSON as plain data.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `ContentTable` is the Schema and the type of what a table admits under one name, as section 0.5 of the phase-3 slice list names it.
export const ContentTable = Schema.Struct({
  anyAttribute: Schema.optionalKey(Wildcard),
  anyElement: Schema.optionalKey(Wildcard),
  attributes: Schema.Array(AttributeTable),
  children: Schema.Array(ChildName),
  text: Schema.Boolean,
});

/**
 * What a table admits, as {@link ContentTable} decodes it.
 */
export type ContentTable = typeof ContentTable.Type;

/**
 * The Schema of one element's table: what it admits, the fields of a {@link ContentTable}; whether
 * some declaration of its name is global; and the types its name is declared with.
 *
 * `types` holds each distinct named type a declaration of the name gives, sorted by namespace then
 * local name: its `type`, or `xs:anyType` for a declaration with no type. `anonymousType` is
 * present, and `true`, when some declaration defines its type inline; no `xsi:type` can name that
 * type, and `types` holds no name for it. `extensionCovered` is present, and `true`, when one of
 * the Schematron's extension patterns the XSD embeds has a rule for the element's name: reading 90
 * then admits, beside what the XSD declares, only a `data-` attribute.
 *
 * A missing wildcard, inline type or extension rule is an absent key, never `null` or `false`, so
 * a table writes to JSON as plain data.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `ElementTable` is the Schema and the type of an element's table under one name, as section 0.5 of the phase-1 slice list names it.
export const ElementTable = Schema.Struct({
  anonymousType: Schema.optionalKey(Schema.Literal(true)),
  anyAttribute: ContentTable.fields.anyAttribute,
  anyElement: ContentTable.fields.anyElement,
  attributes: ContentTable.fields.attributes,
  children: ContentTable.fields.children,
  extensionCovered: Schema.optionalKey(Schema.Literal(true)),
  global: Schema.Boolean,
  text: ContentTable.fields.text,
  types: Schema.Array(ChildName),
});

/**
 * An element's table, as {@link ElementTable} decodes it.
 */
export type ElementTable = typeof ElementTable.Type;

/**
 * The Schema of a named type's entry: what it derives from and how, and its own table, the fields
 * of a {@link ContentTable}.
 *
 * An `extension` or a `restriction` names its `base`, a type in the target namespace or in XML
 * Schema's. A complex type that neither extends nor restricts restricts `xs:anyType`, as XML Schema
 * defines it. A `union` has no base; `members` names its member types in order, those in
 * `memberTypes` and then each inline member by the type its restriction is based on.
 *
 * The table is the one an element declared with the type alone gets, so an extension's holds its
 * base's attributes and children and its own. A simple type's holds text and no attributes,
 * children or wildcards.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `TypeEntry` is the Schema and the type of a named type's entry under one name, as section 0.5 of the phase-3 slice list names its field.
export const TypeEntry = Schema.Union([
  Schema.Struct({
    anyAttribute: ContentTable.fields.anyAttribute,
    anyElement: ContentTable.fields.anyElement,
    attributes: ContentTable.fields.attributes,
    base: ChildName,
    children: ContentTable.fields.children,
    derivation: Schema.Literals(["extension", "restriction"]),
    text: ContentTable.fields.text,
  }),
  Schema.Struct({
    anyAttribute: ContentTable.fields.anyAttribute,
    anyElement: ContentTable.fields.anyElement,
    attributes: ContentTable.fields.attributes,
    children: ContentTable.fields.children,
    derivation: Schema.Literal("union"),
    members: Schema.Array(ChildName),
    text: ContentTable.fields.text,
  }),
]);

/**
 * A named type's entry, as {@link TypeEntry} decodes it.
 */
export type TypeEntry = typeof TypeEntry.Type;

/**
 * The Schema of the tables: one element table per local name the XSD declares, global or local,
 * in the QTI namespace, and one entry per named simple or complex type in the target namespace,
 * each keyed by local name in sorted order.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `Tables` is the Schema and the type of the tables under one name, as section 0.5 of the phase-1 slice list names it.
export const Tables = Schema.Struct({
  elements: Schema.Record(Schema.String, ElementTable),
  types: Schema.Record(Schema.String, TypeEntry),
});

/**
 * The tables, as {@link Tables} decodes them.
 */
export type Tables = typeof Tables.Type;

/**
 * The Schema of how many times a table admits one child it names: the child's namespace and local
 * name, and the least and the greatest number of times its content model admits it, as XML
 * Schema's `minOccurs` and `maxOccurs` spell them.
 *
 * Each count is the decimal form of a non-negative integer, so it stays exact; `maxOccurs` is
 * `unbounded` when the content model sets no greatest number.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `ChildOccurrence` is the Schema and the type of a child's counts under one name, as `ChildName` is.
export const ChildOccurrence = Schema.Struct({
  local: Schema.String,
  maxOccurs: Schema.String,
  minOccurs: Schema.String,
  namespace: Schema.String,
});

/**
 * A child's counts, as {@link ChildOccurrence} decodes them.
 */
export type ChildOccurrence = typeof ChildOccurrence.Type;

/**
 * The Schema of the occurrences: for every element table and every named type's entry the
 * {@link Tables} of the same XSD hold, keyed the same way, the counts of each child it names,
 * sorted by namespace then local name.
 *
 * An element a wildcard admits has no counts, and a type or element with no children by name has
 * an empty list.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `Occurrences` is the Schema and the type of the occurrences under one name, as `Tables` is.
export const Occurrences = Schema.Struct({
  elements: Schema.Record(Schema.String, Schema.Array(ChildOccurrence)),
  types: Schema.Record(Schema.String, Schema.Array(ChildOccurrence)),
});

/**
 * The occurrences, as {@link Occurrences} decodes them.
 */
export type Occurrences = typeof Occurrences.Type;

/**
 * The failure of table generation on an XSD construct the tables have no form for.
 *
 * `construct` names the construct, such as `xs:maxLength` or `xs:pattern`, and `detail` says what
 * about it could not be mapped.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError<Self>()` is a class factory that is called once and extended, never thrown.
export class TableGenerationError extends Schema.TaggedError<TableGenerationError>()(
  "TableGenerationError",
  { construct: Schema.String, detail: Schema.String },
) {
  /**
   * The construct, what could not be mapped, and where to map it.
   */
  override get message(): string {
    return `The XSD's ${this.construct} has no table form: ${this.detail}. Map it in generateTables (src/validate/xsd.ts) before generating tables from this XSD.`;
  }
}

/**
 * Construct a {@link TableGenerationError}.
 *
 * @param construct The construct that could not be mapped.
 * @param detail What about it could not be mapped.
 * @returns The failure.
 */
const failure = (construct: string, detail: string): TableGenerationError =>
  new TableGenerationError({ construct, detail });

/**
 * The XSD's pattern for shape coordinates: three or four numbers, or an even count of six or more,
 * each a run of digits with an optional `%`.
 */
const coordinatesPattern = String.raw`(([0-9]+%?[,]){2}([0-9]+%?))|(([0-9]+%?[,]){3}([0-9]+%?))|(([0-9]+%?[,]){2}(([0-9]+%?[,]){2})+([0-9]+%?[,])([0-9]+%?))`;

/**
 * Shape coordinates, the XSD's own pattern anchored whole.
 *
 * The pattern uses only syntax that XSD and JavaScript read alike, so the check is built from the
 * same string the map keys it by and cannot drift from it.
 */
const coordinates = new RegExp(`^(?:${coordinatesPattern})$`, "u");

/**
 * A length: digits, then an optional percent sign.
 */
const length = /^[0-9]+%?$/u;

/**
 * A MIME type: two runs of Basic Latin characters other than the XSD's excluded punctuation,
 * joined by a slash.
 *
 * The `v` flag's class subtraction stands for the XSD's. `\p{ASCII}` is U+0000 to U+007F, the Basic
 * Latin block the XSD names `\p{IsBasicLatin}`. `(` and `)` are escaped because the `v` flag
 * refuses them bare inside a class.
 */
const mimeType = /^[\p{ASCII}--[\(\)<>@,;:\\"\/\[\]?=]]+\/[\p{ASCII}--[\(\)<>@,;:\\"\/\[\]?=]]+$/v;

/**
 * An extension name: `ext:` and at least one letter, digit, `_`, `.` or `-`.
 */
const extensionName = /^ext:[a-zA-Z0-9_.-]+$/u;

/**
 * Report whether a value is an NCName wrapped in braces, a variable reference in a string.
 *
 * @param value The value to check.
 * @returns Whether it is `{`, an NCName and `}`.
 */
const isBracedNcName = (value: string): boolean =>
  value.startsWith("{") && value.endsWith("}") && isNcName(value.slice(1, -1));

/**
 * A hand-written JavaScript check for each `xs:pattern` value of the QTI XSD, keyed by the value as
 * the source view holds it, entities already decoded.
 *
 * An XSD pattern matches the whole value, so every check is anchored at both ends. The patterns
 * built from `\i` and `\c` minus `:` are the NCName production, which {@link isNcName} checks. A
 * pattern missing here is a {@link TableGenerationError}, so the tables never hold a pattern that
 * structural validation cannot check.
 */
export const patternEquivalents: ReadonlyMap<string, (value: string) => boolean> = new Map([
  [coordinatesPattern, (value: string) => coordinates.test(value)],
  [String.raw`\{[\i-[:]][\c-[:]]*\}`, isBracedNcName],
  ["[0-9]+%?", (value: string) => length.test(value)],
  [
    String.raw`[\p{IsBasicLatin}-[()<>@,;:\\"/\[\]?=]]+/[\p{IsBasicLatin}-[()<>@,;:\\"/\[\]?=]]+`,
    (value: string) => mimeType.test(value),
  ],
  [String.raw`(ext:)[a-zA-Z0-9_\.\-]+`, (value: string) => extensionName.test(value)],
  [String.raw`[\i-[:]][\c-[:]]*`, isNcName],
]);

/**
 * Construct the type of a built-in with no facets.
 *
 * @param name The built-in's name.
 * @returns Its attribute type.
 */
const builtinType = (name: BuiltinName): AttributeType => ({ kind: "builtin", name });

/**
 * The type of an attribute the tables cannot see into: one in an imported namespace, which is
 * recorded without reading the imported schema, and one declared with no type, which is
 * `xs:anySimpleType` and admits any string.
 */
const anyString = builtinType("string");

/**
 * The attribute type of each XML Schema built-in a simple type may name, by local name.
 */
const builtins: ReadonlyMap<string, AttributeType> = new Map([
  ...builtinNames.map((name) => [name, builtinType(name)] as const),
  ["IDREFS", { item: builtinType("IDREF"), kind: "list" }],
]);

/**
 * Report whether a string is an attribute declaration's `use`.
 */
const isUse = Schema.is(AttributeTable.fields.use);

/**
 * Report whether a string is a wildcard's `processContents`.
 */
const isProcess = Schema.is(Wildcard.fields.process);

/**
 * The facets a restriction may carry, the only three in the QTI XSD.
 */
const knownFacets = ["enumeration", "minInclusive", "pattern"] as const;

/**
 * Report whether a string names one of {@link knownFacets}.
 */
const isKnownFacet = Schema.is(Schema.Literals(knownFacets));

/**
 * The namespace prefixes in scope at an XSD element, `""` for the default namespace.
 */
type Scope = ReadonlyMap<string, string>;

/**
 * A QName of the XSD resolved to its namespace and local name.
 */
interface QName {
  readonly local: string;
  readonly namespace: string;
}

/**
 * What a type admits: its attributes by name and its children, each keyed by {@link clarkName}, its
 * attribute and element wildcards, and whether it holds text.
 */
interface TypeTable {
  readonly anyAttribute: Option.Option<Wildcard>;
  readonly anyElement: Option.Option<Wildcard>;
  readonly attributes: ReadonlyMap<string, AttributeTable>;
  readonly children: ReadonlyMap<string, ChildName>;
  readonly text: boolean;
}

/**
 * The attribute declarations and attribute wildcards one construct holds, attribute group
 * references expanded, in document order.
 */
interface Declarations {
  readonly attributes: readonly AttributeTable[];
  readonly wildcards: readonly Wildcard[];
}

/**
 * The children and element wildcards one content model holds, model groups flattened and group
 * references expanded, in document order.
 */
interface Particles {
  readonly children: readonly ChildName[];
  readonly wildcards: readonly Wildcard[];
}

/**
 * What a named type derives from and how, the part of its {@link TypeEntry} beside its table.
 */
type Derivation =
  | { readonly base: ChildName; readonly derivation: "extension" | "restriction" }
  | { readonly derivation: "union"; readonly members: readonly ChildName[] };

/**
 * What one table generation reads and remembers: the schema's target namespace and its attribute
 * and element forms, each XSD element's namespace scope, the top-level definitions by name, and the
 * named types it has mapped or is mapping.
 *
 * The caches and `pending` belong to one call of {@link generateTables}, so the generation stays
 * pure over its source view.
 */
interface Context {
  readonly attributeGroups: ReadonlyMap<string, SourceElement>;
  readonly attributes: ReadonlyMap<string, SourceElement>;
  readonly complexCache: Map<string, TypeTable>;
  readonly complexTypes: ReadonlyMap<string, SourceElement>;
  readonly elements: ReadonlyMap<string, SourceElement>;
  readonly groups: ReadonlyMap<string, SourceElement>;
  /**
   * The names of the types being mapped, so a type that derives from itself fails rather than
   * looping.
   */
  readonly pending: Set<string>;
  readonly qualifiedAttributes: boolean;
  readonly qualifiedElements: boolean;
  readonly scopes: ReadonlyMap<SourceElement, Scope>;
  readonly simpleCache: Map<string, AttributeType>;
  readonly simpleTypes: ReadonlyMap<string, SourceElement>;
  readonly target: string;
}

/**
 * The table of a simple type, or of a built-in simple type: text, and no attributes or children.
 */
const simpleTypeTable: TypeTable = {
  anyAttribute: Option.none(),
  anyElement: Option.none(),
  attributes: new Map(),
  children: new Map(),
  text: true,
};

/**
 * The table of `xs:anyType`, the type of an element declared without one: mixed content, and no
 * attributes or children by name but any of either through its lax wildcards.
 */
const anyTypeTable: TypeTable = {
  anyAttribute: Option.some({ namespace: "##any", process: "lax" }),
  anyElement: Option.some({ namespace: "##any", process: "lax" }),
  attributes: new Map(),
  children: new Map(),
  text: true,
};

/**
 * The name of `xs:anyType`: the type of an element declared with no type, and the base of a complex
 * type that neither extends nor restricts another.
 */
const anyTypeName: ChildName = { local: "anyType", namespace: xsdNamespace };

/**
 * Compare two strings by UTF-16 code units, so the tables' order does not depend on a locale.
 *
 * @param left The first string.
 * @param right The second string.
 * @returns A negative number, zero or a positive number as `left` sorts before, with or after
 *   `right`.
 */
const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

/**
 * Sort strings by code unit and drop repeats.
 *
 * @param values The strings.
 * @returns Each distinct string once, in order.
 */
const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted(compareText);

/**
 * Name an attribute or child in Clark notation, `{namespace}local`, a key equal only for equal
 * names.
 *
 * @param name The name's parts.
 * @returns The name as one string.
 */
const clarkName = (name: QName): string => `{${name.namespace}}${name.local}`;

/**
 * Compare two names by namespace, then local name, the order of the tables' attributes and
 * children.
 *
 * @param left The first name.
 * @param right The second name.
 * @returns A negative number, zero or a positive number as `left` sorts before, with or after
 *   `right`.
 */
const compareNames = (left: QName, right: QName): number =>
  compareText(left.namespace, right.namespace) || compareText(left.local, right.local);

/**
 * Report whether a child of an XSD element is itself an element in the XML Schema namespace.
 *
 * @param child A child of an XSD element.
 * @returns Whether it is an XSD element.
 */
const isXsdElement = (child: SourceChild): child is SourceElement =>
  child.kind === "element" && child.namespace === xsdNamespace;

/**
 * List an XSD element's XSD element children, in document order.
 *
 * @param element The XSD element.
 * @returns Its children in the XML Schema namespace.
 */
const xsdChildren = (element: SourceElement): readonly SourceElement[] =>
  element.children.filter(isXsdElement);

/**
 * Find an XSD element's first XSD child with a local name.
 *
 * @param element The XSD element.
 * @param local The child's local name, such as `complexContent`.
 * @returns The child, or `undefined` when it has none.
 */
const childNamed = (element: SourceElement, local: string): SourceElement | undefined =>
  xsdChildren(element).find((child) => child.local === local);

/**
 * Read an unqualified attribute of an XSD element, such as `name`, `type` or `base`.
 *
 * @param element The XSD element.
 * @param local The attribute's local name.
 * @returns Its value, or `undefined` when the element has no such attribute.
 */
const valueOf = (element: SourceElement, local: string): string | undefined =>
  element.attributes.find((attribute) => attribute.namespace === "" && attribute.local === local)
    ?.value;

/**
 * Split a whitespace-separated list, such as `memberTypes`, into its items.
 *
 * @param list The list as written.
 * @returns Its non-empty items.
 */
const listItems = (list: string): readonly string[] =>
  list.split(/[\t\n\r ]+/u).filter((item) => item !== "");

/**
 * Report whether an XSD attribute's `xs:boolean` value is true.
 *
 * @param value The value as written, or `undefined` when the attribute is absent.
 * @returns Whether it is `true` or `1`, surrounding whitespace aside.
 */
const isTrue = (value: string | undefined): boolean => {
  const trimmed = value?.trim();

  return trimmed === "true" || trimmed === "1";
};

/**
 * Extend a namespace scope with an element's own declarations.
 *
 * A declaration is an attribute in the xmlns namespace: `xmlns:p` has the local name `p`, and the
 * default namespace's `xmlns` has the local name `xmlns`, which no prefix may be.
 *
 * @param element The element.
 * @param parent The scope of the element's parent.
 * @returns The scope at the element.
 */
const declare = (element: SourceElement, parent: Scope): Scope => {
  const declarations = element.attributes.filter(
    (attribute) => attribute.namespace === xmlnsNamespace,
  );
  if (declarations.length === 0) {
    return parent;
  }

  return new Map([
    ...parent,
    ...declarations.map(
      (declaration) =>
        [declaration.local === "xmlns" ? "" : declaration.local, declaration.value] as const,
    ),
  ]);
};

/**
 * What one walk of the schema finds: each XSD element's namespace scope, and every named element
 * declaration with its name, in document order.
 */
interface SchemaIndex {
  readonly declarations: readonly (readonly [string, SourceElement])[];
  readonly scopes: ReadonlyMap<SourceElement, Scope>;
}

/**
 * Walk the schema once: record each XSD element's namespace scope, and collect every
 * `xs:element` with a `name`, global or local, in document order.
 *
 * Annotations are skipped, since nothing in them declares. The walk keeps its own stack.
 *
 * @param root The `xs:schema` element.
 * @returns The scopes, and each named element declaration with its name.
 */
const indexSchema = (root: SourceElement): SchemaIndex => {
  const scopes = new Map<SourceElement, Scope>();
  const declarations: (readonly [string, SourceElement])[] = [];
  const pending: (readonly [SourceElement, Scope])[] = [[root, declare(root, new Map())]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [element, scope] = next;
    scopes.set(element, scope);

    const name = valueOf(element, "name");
    if (element.local === "element" && name !== undefined) {
      declarations.push([name, element]);
    }

    for (const child of xsdChildren(element).toReversed()) {
      if (child.local !== "annotation") {
        pending.push([child, declare(child, scope)]);
      }
    }
  }

  return { declarations, scopes };
};

/**
 * Index the schema's top-level definitions of one kind by name.
 *
 * @param root The `xs:schema` element.
 * @param local The definition's construct, such as `complexType`.
 * @returns Each named definition of that kind.
 */
const definitions = (root: SourceElement, local: string): ReadonlyMap<string, SourceElement> =>
  new Map(
    xsdChildren(root).flatMap((child) => {
      const name = valueOf(child, "name");

      return child.local === local && name !== undefined ? [[name, child] as const] : [];
    }),
  );

/**
 * The XSD attributes the tables refuse when true: an element that may be nil, and a type or element
 * that cannot appear in an instance itself. False is their default and changes nothing.
 */
const refusedWhenTrue: ReadonlySet<string> = new Set(["abstract", "nillable"]);

/**
 * The XSD attributes the tables refuse whatever their value: the derivations and substitutions a
 * definition blocks or forbids, the schema's defaults for both, and substitution groups.
 */
const refusedAlways: ReadonlySet<string> = new Set([
  "block",
  "blockDefault",
  "final",
  "finalDefault",
  "substitutionGroup",
]);

/**
 * Report whether an XSD element's attribute carries a meaning the tables do not record.
 *
 * @param attribute The attribute.
 * @returns Whether it is {@link refusedWhenTrue} and true, or {@link refusedAlways}.
 */
const isUnrecorded = (attribute: SourceAttribute): boolean =>
  attribute.namespace === "" &&
  (refusedWhenTrue.has(attribute.local)
    ? isTrue(attribute.value)
    : refusedAlways.has(attribute.local));

/**
 * Refuse the first XSD construct whose meaning the tables do not record: `nillable` or `abstract`
 * set true, or any `block`, `final`, `blockDefault`, `finalDefault` or `substitutionGroup`.
 *
 * The QTI XSD sets none of them. A rule built on tables generated from an XSD that does would be
 * wrong, so generation stops instead.
 *
 * @param elements The schema's XSD elements outside annotations, its root included.
 * @returns Nothing, or {@link TableGenerationError} naming the attribute.
 */
const refuseUnrecorded = (
  elements: Iterable<SourceElement>,
): Effect.Effect<void, TableGenerationError> => {
  for (const element of elements) {
    const attribute = element.attributes.find(isUnrecorded);
    if (attribute !== undefined) {
      const name = valueOf(element, "name");
      const holder = name === undefined ? `xs:${element.local}` : `xs:${element.local} ${name}`;

      return Effect.fail(
        failure(
          attribute.local,
          `${holder} sets ${attribute.local}="${attribute.value}", which the tables do not record`,
        ),
      );
    }
  }

  return Effect.void;
};

/**
 * Resolve a QName written in an XSD attribute, such as `type="xs:string"` or `ref="xml:lang"`.
 *
 * The `xml` prefix is always the XML namespace. An unprefixed name takes the default namespace in
 * scope, or no namespace when none is declared.
 *
 * @param context The generation's context.
 * @param element The XSD element whose attribute holds the QName.
 * @param qname The QName as written.
 * @returns The resolved name, or {@link TableGenerationError} when its prefix is not declared.
 */
const resolveQName = (
  context: Context,
  element: SourceElement,
  qname: string,
): Effect.Effect<QName, TableGenerationError> => {
  const colon = qname.indexOf(":");
  const prefix = colon === -1 ? "" : qname.slice(0, colon);
  const local = qname.slice(colon + 1);
  if (prefix === "xml") {
    return Effect.succeed({ local, namespace: xmlNamespace });
  }

  const namespace = context.scopes.get(element)?.get(prefix);
  if (namespace !== undefined) {
    return Effect.succeed({ local, namespace });
  }

  return prefix === ""
    ? Effect.succeed({ local, namespace: "" })
    : Effect.fail(failure("QName", `the prefix "${prefix}" of ${qname} is not declared`));
};

/**
 * Report the built-in an atomic type derives from.
 *
 * @param type The type.
 * @returns The built-in's name, or none for a list or a union.
 */
const derivedBuiltin = (type: AttributeType): Option.Option<BuiltinName> => {
  switch (type.kind) {
    case "builtin": {
      return Option.some(type.name);
    }
    case "enumeration":
    case "pattern": {
      return Option.some(type.base);
    }
    case "list":
    case "union": {
      return Option.none();
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Apply a restriction's facets to its base type.
 *
 * One restriction uses one kind of facet: one or more `enumeration`s, which name the values and
 * keep the base's built-in; one `pattern`, which must have an entry in {@link patternEquivalents};
 * or one `minInclusive`. A pattern or a bound restricts a plain built-in only.
 *
 * @param base The type the restriction restricts.
 * @param facets The restriction's facet elements.
 * @returns The restricted type, or {@link TableGenerationError} naming a facet the tables have no
 *   form for.
 */
const applyFacets = Effect.fnUntraced(function* applyFacets(
  base: AttributeType,
  facets: readonly SourceElement[],
): Effect.fn.Return<AttributeType, TableGenerationError> {
  const values: Readonly<Record<(typeof knownFacets)[number], string[]>> = {
    enumeration: [],
    minInclusive: [],
    pattern: [],
  };
  for (const facet of facets) {
    if (!isKnownFacet(facet.local)) {
      return yield* failure(
        `xs:${facet.local}`,
        `the facet ${facet.local} is not one of ${knownFacets.join(", ")}`,
      );
    }

    const value = valueOf(facet, "value");
    if (value === undefined) {
      return yield* failure(`xs:${facet.local}`, "the facet has no value");
    }

    values[facet.local].push(value);
  }

  const { enumeration, minInclusive, pattern } = values;
  const kinds = [enumeration, minInclusive, pattern].filter((found) => found.length > 0).length;
  if (kinds === 0) {
    return base;
  }

  if (kinds > 1) {
    return yield* failure(
      "xs:restriction",
      "it combines more than one of enumeration, pattern and minInclusive",
    );
  }

  if (enumeration.length > 0) {
    const builtin = derivedBuiltin(base);
    if (Option.isNone(builtin)) {
      return yield* failure("xs:enumeration", "it restricts a list or a union type");
    }

    return { base: builtin.value, kind: "enumeration", values: enumeration };
  }

  const construct = pattern.length > 0 ? "xs:pattern" : "xs:minInclusive";
  if (base.kind !== "builtin" || base.minInclusive !== undefined) {
    return yield* failure(construct, "it restricts a type that is not a built-in without facets");
  }

  const [only, ...more] = pattern.length > 0 ? pattern : minInclusive;
  if (only === undefined || more.length > 0) {
    return yield* failure(construct, "one restriction holds more than one of it");
  }

  if (pattern.length === 0) {
    return { kind: "builtin", minInclusive: only, name: base.name };
  }

  if (!patternEquivalents.has(only)) {
    return yield* failure(construct, `the pattern ${only} has no entry in patternEquivalents`);
  }

  return { base: base.name, kind: "pattern", pattern: only };
});

/**
 * Map a named simple type, or an XML Schema built-in, to its attribute type.
 *
 * A named type is mapped once per generation and then read from the cache.
 *
 * @param context The generation's context.
 * @param name The type's resolved name.
 * @returns Its attribute type, or {@link TableGenerationError} when no such simple type exists.
 */
const namedSimpleType = Effect.fnUntraced(function* namedSimpleType(
  context: Context,
  name: QName,
): Effect.fn.Return<AttributeType, TableGenerationError> {
  if (name.namespace === xsdNamespace) {
    const known = builtins.get(name.local);
    if (known === undefined) {
      return yield* failure("type", `xs:${name.local} is not a built-in the tables record`);
    }

    return known;
  }

  const definition =
    name.namespace === context.target ? context.simpleTypes.get(name.local) : undefined;
  if (definition === undefined) {
    return yield* failure("type", `no simple type ${clarkName(name)} is declared`);
  }

  const cached = context.simpleCache.get(name.local);
  if (cached !== undefined) {
    return cached;
  }

  if (context.pending.has(name.local)) {
    return yield* failure("xs:simpleType", `${name.local} derives from itself`);
  }

  context.pending.add(name.local);

  // oxlint-disable-next-line eslint/no-use-before-define -- `namedSimpleType` and `simpleType` are mutually recursive, as a simple type names others; the call runs only after both are defined.
  const type = yield* simpleType(context, definition);
  context.pending.delete(name.local);
  context.simpleCache.set(name.local, type);

  return type;
});

/**
 * Map the type an XSD construct names in an attribute, or defines inline in an `xs:simpleType`
 * child.
 *
 * @param context The generation's context.
 * @param holder The construct, such as an `xs:list` with its `itemType`.
 * @param attribute The attribute that names the type.
 * @returns The type, or none when the construct names no type and defines none inline.
 */
const typeOf = Effect.fnUntraced(function* typeOf(
  context: Context,
  holder: SourceElement,
  attribute: string,
): Effect.fn.Return<Option.Option<AttributeType>, TableGenerationError> {
  const name = valueOf(holder, attribute);
  if (name !== undefined) {
    return Option.some(yield* namedSimpleType(context, yield* resolveQName(context, holder, name)));
  }

  const inline = childNamed(holder, "simpleType");

  // oxlint-disable-next-line eslint/no-use-before-define -- `typeOf` and `simpleType` are mutually recursive, as simple types nest inline; the call runs only after both are defined.
  return inline === undefined ? Option.none() : Option.some(yield* simpleType(context, inline));
});

/**
 * Map an `xs:simpleType` definition to its attribute type: a restriction of a built-in or a named
 * type with its facets, a list, or a union of `memberTypes` and inline members.
 *
 * @param context The generation's context.
 * @param definition The `xs:simpleType` element.
 * @returns The attribute type, or {@link TableGenerationError} naming what could not be mapped.
 */
const simpleType = Effect.fnUntraced(function* simpleType(
  context: Context,
  definition: SourceElement,
): Effect.fn.Return<AttributeType, TableGenerationError> {
  const derivation = xsdChildren(definition).find((child) => child.local !== "annotation");
  if (derivation === undefined) {
    return yield* failure("xs:simpleType", "it holds no restriction, list or union");
  }

  if (derivation.local === "restriction") {
    const base = yield* typeOf(context, derivation, "base");
    if (Option.isNone(base)) {
      return yield* failure("xs:restriction", "it has neither a base nor an inline simple type");
    }

    const facets = xsdChildren(derivation).filter(
      (child) => child.local !== "annotation" && child.local !== "simpleType",
    );

    return yield* applyFacets(base.value, facets);
  }

  if (derivation.local === "list") {
    const item = yield* typeOf(context, derivation, "itemType");
    if (Option.isNone(item)) {
      return yield* failure("xs:list", "it has neither an itemType nor an inline simple type");
    }

    return { item: item.value, kind: "list" };
  }

  if (derivation.local === "union") {
    const members: AttributeType[] = [];
    for (const member of listItems(valueOf(derivation, "memberTypes") ?? "")) {
      members.push(
        yield* namedSimpleType(context, yield* resolveQName(context, derivation, member)),
      );
    }
    for (const inline of xsdChildren(derivation).filter((child) => child.local === "simpleType")) {
      members.push(yield* simpleType(context, inline));
    }
    if (members.length === 0) {
      return yield* failure("xs:union", "it has no member types");
    }

    return { kind: "union", members };
  }

  return yield* failure(
    `xs:${derivation.local}`,
    "a simple type holds it in place of a derivation",
  );
});

/**
 * Map an `xs:anyAttribute` or `xs:any` to its wildcard, with XSD's defaults `##any` and `strict`.
 *
 * In a namespace list, `##targetNamespace` becomes the target namespace and `##local` becomes `""`.
 *
 * @param context The generation's context.
 * @param element The wildcard element.
 * @returns The wildcard, or {@link TableGenerationError} for a value XSD does not define.
 */
const wildcardOf = Effect.fnUntraced(function* wildcardOf(
  context: Context,
  element: SourceElement,
): Effect.fn.Return<Wildcard, TableGenerationError> {
  const construct = `xs:${element.local}`;
  const process = valueOf(element, "processContents") ?? "strict";
  if (!isProcess(process)) {
    return yield* failure(construct, `processContents="${process}" is not strict, lax or skip`);
  }

  const namespace = valueOf(element, "namespace") ?? "##any";
  if (namespace === "##any" || namespace === "##other") {
    return { namespace, process };
  }

  const names: string[] = [];
  for (const token of listItems(namespace)) {
    if (token === "##targetNamespace") {
      names.push(context.target);
    } else if (token === "##local") {
      names.push("");
    } else if (token.startsWith("##")) {
      return yield* failure(construct, `the namespace token ${token} is not one XSD defines`);
    } else {
      names.push(token);
    }
  }

  return { namespace: sortedUnique(names), process };
});

/**
 * Report whether a wildcard's namespace rule is `##any` or `##other` rather than a list.
 *
 * @param namespace The rule.
 * @returns Whether it is one of the two named rules.
 */
const isNamedRule = (namespace: WildcardNamespace): namespace is "##any" | "##other" =>
  namespace === "##any" || namespace === "##other";

/**
 * Join two wildcard namespace rules into the rule that admits what either admits.
 *
 * `##other` excludes the target namespace and no namespace, so its union with a list is `##other`
 * when the list holds neither and `##any` when it holds both.
 *
 * @param target The schema's target namespace.
 * @param left One rule.
 * @param right The other rule.
 * @returns The union, or {@link TableGenerationError} when `##other` and a list holding only one of
 *   the two excluded namespaces have no union a rule can write.
 */
const unionNamespaces = (
  target: string,
  left: WildcardNamespace,
  right: WildcardNamespace,
): Effect.Effect<WildcardNamespace, TableGenerationError> => {
  if (left === "##any" || right === "##any") {
    return Effect.succeed("##any");
  }

  if (!isNamedRule(left) && !isNamedRule(right)) {
    return Effect.succeed(sortedUnique([...left, ...right]));
  }

  const list = isNamedRule(left) ? right : left;
  if (isNamedRule(list)) {
    return Effect.succeed("##other");
  }

  const coversTarget = list.includes(target);
  if (coversTarget === list.includes("")) {
    return Effect.succeed(coversTarget ? "##any" : "##other");
  }

  return Effect.fail(
    failure("wildcard", `the union of ##other and the list ${list.join(" ")} has no rule`),
  );
};

/**
 * Report whether two wildcards admit the same namespaces with the same processing.
 *
 * @param left One wildcard.
 * @param right The other.
 * @returns Whether they are equal; a namespace list is sorted, so equal lists are equal in order.
 */
const sameWildcard = (left: Wildcard, right: Wildcard): boolean =>
  left.process === right.process &&
  (isNamedRule(left.namespace) || isNamedRule(right.namespace)
    ? left.namespace === right.namespace
    : left.namespace.join(" ") === right.namespace.join(" "));

/**
 * Join the wildcards one construct gathers from its own `xs:anyAttribute` and its attribute groups.
 *
 * XSD intersects them; the tables take them when they are all equal, which is how the QTI XSD
 * writes them, and fail on any other intersection.
 *
 * @param wildcards The gathered wildcards.
 * @returns The construct's wildcard, none when it gathered none.
 */
const completeWildcard = (
  wildcards: readonly Wildcard[],
): Effect.Effect<Option.Option<Wildcard>, TableGenerationError> => {
  const [first, ...rest] = wildcards;
  if (first === undefined) {
    return Effect.succeed(Option.none());
  }

  return rest.every((wildcard) => sameWildcard(wildcard, first))
    ? Effect.succeed(Option.some(first))
    : Effect.fail(failure("xs:anyAttribute", "one type gathers attribute wildcards that differ"));
};

/**
 * The processing a wildcard asks for, from the strictest to the laxest.
 */
const processOrder: readonly Wildcard["process"][] = ["strict", "lax", "skip"];

/**
 * Join two optional wildcards into one that admits what either admits, with the laxer processing:
 * two declarations of one element name, an extension and its base, or two `xs:any` of one content
 * model.
 *
 * @param target The schema's target namespace.
 * @param left One wildcard, or `undefined`.
 * @param right The other, or `undefined`.
 * @returns The joined wildcard, none when neither is given.
 */
const unionWildcards = Effect.fnUntraced(function* unionWildcards(
  target: string,
  left: Wildcard | undefined,
  right: Wildcard | undefined,
): Effect.fn.Return<Option.Option<Wildcard>, TableGenerationError> {
  if (left === undefined || right === undefined) {
    return Option.fromNullishOr(left ?? right);
  }

  const namespace = yield* unionNamespaces(target, left.namespace, right.namespace);
  const process =
    processOrder.indexOf(left.process) >= processOrder.indexOf(right.process)
      ? left.process
      : right.process;

  return Option.some({ namespace, process });
});

/**
 * Join the element wildcards one content model gathers.
 *
 * Each `xs:any` is a particle of its own, so an element any of them matches is admitted: the
 * tables take their union, as {@link unionWildcards} joins two.
 *
 * @param target The schema's target namespace.
 * @param wildcards The gathered wildcards.
 * @returns The content model's wildcard, none when it gathered none.
 */
const joinWildcards = Effect.fnUntraced(function* joinWildcards(
  target: string,
  wildcards: readonly Wildcard[],
): Effect.fn.Return<Option.Option<Wildcard>, TableGenerationError> {
  let joined = Option.none<Wildcard>();
  for (const wildcard of wildcards) {
    joined = yield* unionWildcards(target, Option.getOrUndefined(joined), wildcard);
  }

  return joined;
});

/**
 * Refuse an attribute declaration that fixes its value, which the tables cannot record.
 *
 * @param declaration The `xs:attribute` element.
 * @returns Nothing, or {@link TableGenerationError} when it fixes its value.
 */
const refuseFixed = (declaration: SourceElement): Effect.Effect<void, TableGenerationError> =>
  valueOf(declaration, "fixed") === undefined
    ? Effect.void
    : Effect.fail(failure("xs:attribute", "a fixed value is not recorded by the tables"));

/**
 * Add a declaration's `default` to an attribute table when it has one.
 *
 * @param table The table without a default.
 * @param value The default as written, or `undefined`.
 * @returns The table, with `default` only when a value is given.
 */
const withDefault = (table: AttributeTable, value: string | undefined): AttributeTable =>
  value === undefined ? table : { default: value, ...table };

/**
 * Map an `xs:attribute` declaration or reference to its attribute table.
 *
 * A reference into the target namespace takes the global declaration's type. A reference into an
 * imported namespace, such as `xml:lang`, is recorded by namespace and local name as a string,
 * without reading the imported schema. A local declaration is in no namespace unless its `form`,
 * or the schema's `attributeFormDefault`, is `qualified`.
 *
 * @param context The generation's context.
 * @param declaration The `xs:attribute` element.
 * @returns The table, or {@link TableGenerationError} naming what could not be mapped.
 */
const attributeTable = Effect.fnUntraced(function* attributeTable(
  context: Context,
  declaration: SourceElement,
): Effect.fn.Return<AttributeTable, TableGenerationError> {
  const use = valueOf(declaration, "use") ?? "optional";
  if (!isUse(use)) {
    return yield* failure("xs:attribute", `use="${use}" is not required, optional or prohibited`);
  }

  yield* refuseFixed(declaration);

  const ref = valueOf(declaration, "ref");
  if (ref !== undefined) {
    const name = yield* resolveQName(context, declaration, ref);
    if (name.namespace !== context.target) {
      return withDefault({ ...name, type: anyString, use }, valueOf(declaration, "default"));
    }

    const global = context.attributes.get(name.local);
    if (global === undefined) {
      return yield* failure("xs:attribute", `no global attribute ${ref} is declared`);
    }

    yield* refuseFixed(global);

    const type = yield* typeOf(context, global, "type");

    return withDefault(
      { ...name, type: Option.getOrElse(type, () => anyString), use },
      valueOf(declaration, "default") ?? valueOf(global, "default"),
    );
  }

  const local = valueOf(declaration, "name");
  if (local === undefined) {
    return yield* failure("xs:attribute", "a declaration has neither a name nor a ref");
  }

  const form = valueOf(declaration, "form") ?? (context.qualifiedAttributes ? "qualified" : "");
  const type = yield* typeOf(context, declaration, "type");

  return withDefault(
    {
      local,
      namespace: form === "qualified" ? context.target : "",
      type: Option.getOrElse(type, () => anyString),
      use,
    },
    valueOf(declaration, "default"),
  );
});

/**
 * Gather a construct's attribute declarations and wildcards, expanding its attribute group
 * references, nested ones included.
 *
 * @param context The generation's context.
 * @param holder A complex type, a derivation or an attribute group.
 * @param groups The attribute groups being expanded, so a group that refers to itself fails.
 * @returns The declarations and wildcards in document order.
 */
const gather = Effect.fnUntraced(function* gather(
  context: Context,
  holder: SourceElement,
  groups: ReadonlySet<string>,
): Effect.fn.Return<Declarations, TableGenerationError> {
  const attributes: AttributeTable[] = [];
  const wildcards: Wildcard[] = [];
  for (const child of xsdChildren(holder)) {
    if (child.local === "attribute") {
      attributes.push(yield* attributeTable(context, child));
    } else if (child.local === "anyAttribute") {
      wildcards.push(yield* wildcardOf(context, child));
    } else if (child.local === "attributeGroup") {
      const ref = valueOf(child, "ref");
      if (ref === undefined) {
        return yield* failure("xs:attributeGroup", "a reference has no ref");
      }

      const name = yield* resolveQName(context, child, ref);
      const group =
        name.namespace === context.target ? context.attributeGroups.get(name.local) : undefined;
      if (group === undefined) {
        return yield* failure("xs:attributeGroup", `no attribute group ${ref} is declared`);
      }

      if (groups.has(name.local)) {
        return yield* failure("xs:attributeGroup", `${ref} refers to itself`);
      }

      const nested = yield* gather(context, group, new Set([...groups, name.local]));
      attributes.push(...nested.attributes);
      wildcards.push(...nested.wildcards);
    }
  }

  return { attributes, wildcards };
});

/**
 * Apply attribute declarations over inherited attributes.
 *
 * A declaration replaces an inherited one of the same name. A `prohibited` one adds nothing, and in
 * a restriction it removes the inherited attribute.
 *
 * @param inherited The base type's attributes.
 * @param declared The derivation's own declarations.
 * @param restricting Whether the derivation is a restriction.
 * @returns The derived type's attributes.
 */
const applyDeclarations = (
  inherited: ReadonlyMap<string, AttributeTable>,
  declared: readonly AttributeTable[],
  restricting: boolean,
): ReadonlyMap<string, AttributeTable> => {
  const attributes = new Map(inherited);
  for (const declaration of declared) {
    if (declaration.use !== "prohibited") {
      attributes.set(clarkName(declaration), declaration);
    } else if (restricting) {
      attributes.delete(clarkName(declaration));
    }
  }

  return attributes;
};

/**
 * Name the child an `xs:element` particle admits.
 *
 * A reference into the target namespace names a global element, which must be declared. A
 * reference into an imported namespace, such as `m3:math`, is the child by namespace and local
 * name, and the imported schema is never read. A local declaration is in no namespace unless its
 * `form`, or the schema's `elementFormDefault`, is `qualified`; its own table comes from its own
 * declaration, so its content is not walked here.
 *
 * @param context The generation's context.
 * @param declaration The `xs:element` particle.
 * @returns The child's name, or {@link TableGenerationError} naming what could not be mapped.
 */
const childName = Effect.fnUntraced(function* childName(
  context: Context,
  declaration: SourceElement,
): Effect.fn.Return<ChildName, TableGenerationError> {
  const ref = valueOf(declaration, "ref");
  if (ref !== undefined) {
    const name = yield* resolveQName(context, declaration, ref);
    if (name.namespace === context.target && !context.elements.has(name.local)) {
      return yield* failure("xs:element", `no global element ${ref} is declared`);
    }

    return { local: name.local, namespace: name.namespace };
  }

  const local = valueOf(declaration, "name");
  if (local === undefined) {
    return yield* failure("xs:element", "a declaration has neither a name nor a ref");
  }

  const form = valueOf(declaration, "form") ?? (context.qualifiedElements ? "qualified" : "");

  return { local, namespace: form === "qualified" ? context.target : "" };
});

/**
 * The model groups a content model nests, whose particles flatten into it.
 */
const modelGroups: ReadonlySet<string> = new Set(["all", "choice", "sequence"]);

/**
 * A named model group a `xs:group` reference expands to, with the set of groups being expanded
 * once it is.
 */
interface ReferencedGroup {
  readonly definition: SourceElement;
  readonly expanding: ReadonlySet<string>;
}

/**
 * Find the named model group an `xs:group` reference names.
 *
 * @param context The generation's context.
 * @param reference The `xs:group` reference.
 * @param groups The groups being expanded, so a group that refers to itself fails.
 * @returns The group's definition and the groups being expanded with it, or
 *   {@link TableGenerationError} when the reference has no `ref`, names no group of the target
 *   namespace, or names a group being expanded.
 */
const referencedGroup = Effect.fnUntraced(function* referencedGroup(
  context: Context,
  reference: SourceElement,
  groups: ReadonlySet<string>,
): Effect.fn.Return<ReferencedGroup, TableGenerationError> {
  const ref = valueOf(reference, "ref");
  if (ref === undefined) {
    return yield* failure("xs:group", "a reference has no ref");
  }

  const name = yield* resolveQName(context, reference, ref);
  const definition = name.namespace === context.target ? context.groups.get(name.local) : undefined;
  if (definition === undefined) {
    return yield* failure("xs:group", `no group ${ref} is declared`);
  }

  if (groups.has(name.local)) {
    return yield* failure("xs:group", `${ref} refers to itself`);
  }

  return { definition, expanding: new Set([...groups, name.local]) };
});

/**
 * Gather a content model's children and element wildcards, flattening `sequence`, `choice` and
 * `all` and expanding `xs:group` references, nested ones included.
 *
 * Order and counts are dropped: the tables keep which children an element admits, never a content
 * model automaton. Constructs that are not particles, such as attribute declarations, are skipped.
 *
 * @param context The generation's context.
 * @param holder A complex type, a derivation, a model group or a group definition.
 * @param groups The groups being expanded, so a group that refers to itself fails.
 * @returns The children and wildcards in document order.
 */
const gatherParticles = Effect.fnUntraced(function* gatherParticles(
  context: Context,
  holder: SourceElement,
  groups: ReadonlySet<string>,
): Effect.fn.Return<Particles, TableGenerationError> {
  const children: ChildName[] = [];
  const wildcards: Wildcard[] = [];
  for (const child of xsdChildren(holder)) {
    if (child.local === "element") {
      children.push(yield* childName(context, child));
    } else if (child.local === "any") {
      wildcards.push(yield* wildcardOf(context, child));
    } else if (modelGroups.has(child.local)) {
      const nested = yield* gatherParticles(context, child, groups);
      children.push(...nested.children);
      wildcards.push(...nested.wildcards);
    } else if (child.local === "group") {
      const group = yield* referencedGroup(context, child, groups);
      const nested = yield* gatherParticles(context, group.definition, group.expanding);
      children.push(...nested.children);
      wildcards.push(...nested.wildcards);
    }
  }

  return { children, wildcards };
});

/**
 * Key children by {@link clarkName}, so a child named twice is admitted once.
 *
 * @param children The children.
 * @returns Each distinct child, keyed by its name.
 */
const childMap = (children: Iterable<ChildName>): ReadonlyMap<string, ChildName> =>
  new Map([...children].map((child) => [clarkName(child), child]));

/**
 * Report whether a complex type's content is mixed, so its element holds text.
 *
 * As XSD reads them, its `complexContent`'s `mixed` decides when it has one, otherwise the type's
 * own, and neither means element-only. The value is an `xs:boolean`.
 *
 * @param type The `xs:complexType` element.
 * @param content Its `xs:complexContent`, when it has one.
 * @returns Whether its content is mixed.
 */
const isMixed = (type: SourceElement, content?: SourceElement): boolean =>
  isTrue((content === undefined ? undefined : valueOf(content, "mixed")) ?? valueOf(type, "mixed"));

/**
 * The attribute wildcard of a derived type: a restriction's own, and an extension's base's joined
 * with its own and taking its own processing, as XSD defines both.
 *
 * @param target The schema's target namespace.
 * @param restricting Whether the derivation is a restriction.
 * @param base The base type's attribute wildcard.
 * @param own The derivation's own attribute wildcard.
 * @returns The derived type's attribute wildcard.
 */
const derivedAttributeWildcard = (
  target: string,
  restricting: boolean,
  base: Option.Option<Wildcard>,
  own: Option.Option<Wildcard>,
): Effect.Effect<Option.Option<Wildcard>, TableGenerationError> => {
  if (restricting || Option.isNone(base)) {
    return Effect.succeed(own);
  }

  if (Option.isNone(own)) {
    return Effect.succeed(base);
  }

  return unionNamespaces(target, base.value.namespace, own.value.namespace).pipe(
    Effect.map((namespace) => Option.some({ namespace, process: own.value.process })),
  );
};

/**
 * Report the table of the type a name resolves to: a named complex type, a named simple type or an
 * XML Schema built-in.
 *
 * @param context The generation's context.
 * @param name The type's resolved name.
 * @returns Its table, or {@link TableGenerationError} when no such type exists.
 */
const typeTable = Effect.fnUntraced(function* typeTable(
  context: Context,
  name: QName,
): Effect.fn.Return<TypeTable, TableGenerationError> {
  if (name.namespace === xsdNamespace) {
    if (name.local === "anyType") {
      return anyTypeTable;
    }

    if (builtins.has(name.local)) {
      return simpleTypeTable;
    }

    return yield* failure("type", `xs:${name.local} is not a built-in the tables record`);
  }

  const complex =
    name.namespace === context.target ? context.complexTypes.get(name.local) : undefined;
  if (complex === undefined) {
    if (name.namespace === context.target && context.simpleTypes.has(name.local)) {
      return simpleTypeTable;
    }

    return yield* failure("type", `no type ${clarkName(name)} is declared`);
  }

  const cached = context.complexCache.get(name.local);
  if (cached !== undefined) {
    return cached;
  }

  if (context.pending.has(name.local)) {
    return yield* failure("xs:complexType", `${name.local} derives from itself`);
  }

  context.pending.add(name.local);

  // oxlint-disable-next-line eslint/no-use-before-define -- `typeTable` and `complexTable` are mutually recursive, as a complex type derives from another; the call runs only after both are defined.
  const table = yield* complexTable(context, complex);
  context.pending.delete(name.local);
  context.complexCache.set(name.local, table);

  return table;
});

/**
 * Report the table of a complex type.
 *
 * Without `complexContent` or `simpleContent`, its attributes and children are its own. An
 * extension inherits its base's attributes and children and adds its own, and each of its
 * wildcards is the union of its base's and its own. A restriction inherits its base's attributes
 * and applies its own declarations, its attribute wildcard is its own alone, and its children and
 * element wildcard are its own alone, as XSD defines them. It holds text when its content is mixed
 * or simple, never by inheritance.
 *
 * @param context The generation's context.
 * @param type The `xs:complexType` element.
 * @returns Its table, or {@link TableGenerationError} naming what could not be mapped.
 */
const complexTable = Effect.fnUntraced(function* complexTable(
  context: Context,
  type: SourceElement,
): Effect.fn.Return<TypeTable, TableGenerationError> {
  const content = childNamed(type, "complexContent") ?? childNamed(type, "simpleContent");
  if (content === undefined) {
    const own = yield* gather(context, type, new Set());
    const particles = yield* gatherParticles(context, type, new Set());

    return {
      anyAttribute: yield* completeWildcard(own.wildcards),
      anyElement: yield* joinWildcards(context.target, particles.wildcards),
      attributes: applyDeclarations(new Map(), own.attributes, false),
      children: childMap(particles.children),
      text: isMixed(type),
    };
  }

  const derivation = childNamed(content, "extension") ?? childNamed(content, "restriction");
  if (derivation === undefined) {
    return yield* failure(`xs:${content.local}`, "it holds neither an extension nor a restriction");
  }

  const baseName = valueOf(derivation, "base");
  if (baseName === undefined) {
    return yield* failure(`xs:${derivation.local}`, "it has no base");
  }

  const base = yield* typeTable(context, yield* resolveQName(context, derivation, baseName));
  const own = yield* gather(context, derivation, new Set());
  const particles = yield* gatherParticles(context, derivation, new Set());
  const ownElements = yield* joinWildcards(context.target, particles.wildcards);
  const restricting = derivation.local === "restriction";

  return {
    anyAttribute: yield* derivedAttributeWildcard(
      context.target,
      restricting,
      base.anyAttribute,
      yield* completeWildcard(own.wildcards),
    ),
    anyElement: restricting
      ? ownElements
      : yield* unionWildcards(
          context.target,
          Option.getOrUndefined(base.anyElement),
          Option.getOrUndefined(ownElements),
        ),
    attributes: applyDeclarations(base.attributes, own.attributes, restricting),
    children: restricting
      ? childMap(particles.children)
      : childMap([...base.children.values(), ...particles.children]),
    text: content.local === "simpleContent" || isMixed(type, content),
  };
});

/**
 * Report the table of an element declaration's type: its `type`, its inline type, or, with
 * neither, `xs:anyType`.
 *
 * @param context The generation's context.
 * @param element The `xs:element` element.
 * @returns Its type's table, or {@link TableGenerationError} naming what could not be mapped.
 */
const declarationTable = Effect.fnUntraced(function* declarationTable(
  context: Context,
  element: SourceElement,
): Effect.fn.Return<TypeTable, TableGenerationError> {
  const typeName = valueOf(element, "type");
  if (typeName !== undefined) {
    return yield* typeTable(context, yield* resolveQName(context, element, typeName));
  }

  const complex = childNamed(element, "complexType");
  if (complex !== undefined) {
    return yield* complexTable(context, complex);
  }

  return childNamed(element, "simpleType") === undefined ? anyTypeTable : simpleTypeTable;
});

/**
 * Report the named type an element declaration gives: its `type`, or `xs:anyType` when it has
 * neither a `type` nor an inline type.
 *
 * @param context The generation's context.
 * @param element The `xs:element` element.
 * @returns The type's name, none when the declaration defines its type inline, or
 *   {@link TableGenerationError} when the `type`'s prefix is not declared.
 */
const declaredType = Effect.fnUntraced(function* declaredType(
  context: Context,
  element: SourceElement,
): Effect.fn.Return<Option.Option<ChildName>, TableGenerationError> {
  const typeName = valueOf(element, "type");
  if (typeName !== undefined) {
    const { local, namespace } = yield* resolveQName(context, element, typeName);

    return Option.some({ local, namespace });
  }

  const inline = childNamed(element, "complexType") ?? childNamed(element, "simpleType");

  return inline === undefined ? Option.some(anyTypeName) : Option.none();
});

/**
 * Resolve a type a named type's entry names, as its base or a union member.
 *
 * @param context The generation's context.
 * @param holder The XSD element whose attribute holds the QName.
 * @param qname The QName as written.
 * @returns The type's name, or {@link TableGenerationError} when it names neither a type in XML
 *   Schema's namespace nor a named type of the target namespace.
 */
const typeReference = Effect.fnUntraced(function* typeReference(
  context: Context,
  holder: SourceElement,
  qname: string,
): Effect.fn.Return<ChildName, TableGenerationError> {
  const { local, namespace } = yield* resolveQName(context, holder, qname);
  const declared =
    namespace === context.target &&
    (context.complexTypes.has(local) || context.simpleTypes.has(local));
  if (namespace !== xsdNamespace && !declared) {
    return yield* failure("type", `no type ${clarkName({ local, namespace })} is declared`);
  }

  return { local, namespace };
});

/**
 * Report the base a simple type's `xs:restriction` names.
 *
 * @param context The generation's context.
 * @param restriction The `xs:restriction` element.
 * @returns The base's name, or {@link TableGenerationError} when the restriction restricts an inline
 *   simple type, which has no name to record.
 */
const restrictionBase = Effect.fnUntraced(function* restrictionBase(
  context: Context,
  restriction: SourceElement,
): Effect.fn.Return<ChildName, TableGenerationError> {
  const base = valueOf(restriction, "base");
  if (base === undefined) {
    return yield* failure(
      "xs:restriction",
      "it restricts an inline simple type, which has no name for a type entry to record as its base",
    );
  }

  return yield* typeReference(context, restriction, base);
});

/**
 * Report a named complex type's derivation: the base and derivation of its `complexContent` or
 * `simpleContent`, or, with neither, a restriction of `xs:anyType`, as XML Schema defines it.
 *
 * @param context The generation's context.
 * @param type The `xs:complexType` element.
 * @returns Its derivation, or {@link TableGenerationError} naming what could not be mapped.
 */
const complexDerivation = Effect.fnUntraced(function* complexDerivation(
  context: Context,
  type: SourceElement,
): Effect.fn.Return<Derivation, TableGenerationError> {
  const content = childNamed(type, "complexContent") ?? childNamed(type, "simpleContent");
  if (content === undefined) {
    return { base: anyTypeName, derivation: "restriction" };
  }

  const derivation = childNamed(content, "extension") ?? childNamed(content, "restriction");
  if (derivation === undefined) {
    return yield* failure(`xs:${content.local}`, "it holds neither an extension nor a restriction");
  }

  const base = valueOf(derivation, "base");
  if (base === undefined) {
    return yield* failure(`xs:${derivation.local}`, "it has no base");
  }

  return {
    base: yield* typeReference(context, derivation, base),
    derivation: derivation.local === "extension" ? "extension" : "restriction",
  };
});

/**
 * Report a named simple type's derivation: a restriction's base, or a union's members, those in
 * `memberTypes` and then each inline member by the base its restriction names.
 *
 * @param context The generation's context.
 * @param name The type's local name.
 * @param definition The `xs:simpleType` element.
 * @returns Its derivation, or {@link TableGenerationError} for a list, which a type entry has no
 *   form for, or for what else could not be mapped.
 */
const simpleDerivation = Effect.fnUntraced(function* simpleDerivation(
  context: Context,
  name: string,
  definition: SourceElement,
): Effect.fn.Return<Derivation, TableGenerationError> {
  const derivation = xsdChildren(definition).find((child) => child.local !== "annotation");
  if (derivation === undefined) {
    return yield* failure("xs:simpleType", "it holds no restriction, list or union");
  }

  if (derivation.local === "restriction") {
    return { base: yield* restrictionBase(context, derivation), derivation: "restriction" };
  }

  if (derivation.local === "list") {
    return yield* failure(
      "xs:list",
      `the named simple type ${name} is a list, which a type entry has no form for; the attribute tables map a list only where an attribute declares it inline`,
    );
  }

  if (derivation.local !== "union") {
    return yield* failure(
      `xs:${derivation.local}`,
      "a simple type holds it in place of a derivation",
    );
  }

  const members: ChildName[] = [];
  for (const member of listItems(valueOf(derivation, "memberTypes") ?? "")) {
    members.push(yield* typeReference(context, derivation, member));
  }
  for (const inline of xsdChildren(derivation).filter((child) => child.local === "simpleType")) {
    const restriction = xsdChildren(inline).find((child) => child.local !== "annotation");
    if (restriction?.local !== "restriction") {
      return yield* failure(
        "xs:union",
        `an inline member of ${name} is not a restriction, so no type name stands for it`,
      );
    }

    members.push(yield* restrictionBase(context, restriction));
  }
  if (members.length === 0) {
    return yield* failure("xs:union", "it has no member types");
  }

  return { derivation: "union", members };
});

/**
 * Sort attribute tables by namespace, then local name.
 *
 * @param attributes The tables.
 * @returns The tables in order.
 */
const sortAttributes = (attributes: Iterable<AttributeTable>): readonly AttributeTable[] =>
  [...attributes].toSorted(compareNames);

/**
 * Sort children by namespace, then local name.
 *
 * @param children The children.
 * @returns The children in order.
 */
const sortChildren = (children: Iterable<ChildName>): readonly ChildName[] =>
  [...children].toSorted(compareNames);

/**
 * Add the wildcards a table has to it, an element's table or a type's entry, each as a key only
 * when present.
 *
 * The keys go in front, so every table is built in the sorted key order its Schema encodes, and
 * writing the tables as JSON gives the same bytes either way.
 *
 * @param table The table without wildcards.
 * @param anyAttribute The attribute wildcard, if any.
 * @param anyElement The element wildcard, if any.
 * @returns The table with `anyAttribute` and `anyElement` set where given.
 */
const withWildcards = <Table extends ContentTable>(
  table: Table,
  anyAttribute: Option.Option<Wildcard>,
  anyElement: Option.Option<Wildcard>,
): Table => {
  const withElements = Option.match(anyElement, {
    onNone: () => table,
    onSome: (wildcard) => ({ anyElement: wildcard, ...table }),
  });

  return Option.match(anyAttribute, {
    onNone: () => withElements,
    onSome: (wildcard) => ({ anyAttribute: wildcard, ...withElements }),
  });
};

/**
 * Add `anonymousType` to an element table when a declaration of its name has an inline type.
 *
 * The key goes in front, as {@link withWildcards} puts its keys, so the table keeps its Schema's
 * sorted key order.
 *
 * @param table The table.
 * @param anonymous Whether a declaration of its name has an inline type.
 * @returns The table, with `anonymousType: true` only when `anonymous` holds.
 */
const withAnonymousType = (table: ElementTable, anonymous: boolean): ElementTable =>
  anonymous ? { anonymousType: true, ...table } : table;

/**
 * What one element declaration says of its name beside its type's table: whether it is global,
 * the named type it gives, and whether it defines its type inline instead.
 */
interface Declaration {
  readonly anonymous: boolean;
  readonly global: boolean;
  readonly types: readonly ChildName[];
}

/**
 * Build the table one element declaration gives its name.
 *
 * @param type The table of the declaration's type.
 * @param declaration What the declaration says of its name.
 * @returns The element table, attributes and children sorted.
 */
const elementTable = (type: TypeTable, declaration: Declaration): ElementTable =>
  withAnonymousType(
    withWildcards(
      {
        attributes: sortAttributes(type.attributes.values()),
        children: sortChildren(type.children.values()),
        global: declaration.global,
        text: type.text,
        types: declaration.types,
      },
      type.anyAttribute,
      type.anyElement,
    ),
    declaration.anonymous,
  );

/**
 * Build a named type's entry: its derivation and its table, in the form {@link elementTable} gives
 * an element declared with the type alone.
 *
 * @param type The type's table.
 * @param derivation What the type derives from and how.
 * @returns The entry, attributes and children sorted.
 */
const typeEntry = (type: TypeTable, derivation: Derivation): TypeEntry =>
  withWildcards(
    derivation.derivation === "union"
      ? {
          attributes: sortAttributes(type.attributes.values()),
          children: sortChildren(type.children.values()),
          derivation: derivation.derivation,
          members: derivation.members,
          text: type.text,
        }
      : {
          attributes: sortAttributes(type.attributes.values()),
          base: derivation.base,
          children: sortChildren(type.children.values()),
          derivation: derivation.derivation,
          text: type.text,
        },
    type.anyAttribute,
    type.anyElement,
  );

/**
 * Report the entry of every named simple and complex type the schema defines, keyed by local name
 * in sorted order: its derivation, and the table {@link typeTable} gives an element declared with
 * it.
 *
 * @param context The generation's context.
 * @returns The entries, or {@link TableGenerationError} naming what could not be mapped.
 */
const typeEntries = Effect.fnUntraced(function* typeEntries(
  context: Context,
): Effect.fn.Return<Readonly<Record<string, TypeEntry>>, TableGenerationError> {
  const entries = new Map<string, TypeEntry>();
  for (const [name, type] of context.complexTypes) {
    const derivation = yield* complexDerivation(context, type);
    const table = yield* typeTable(context, { local: name, namespace: context.target });
    entries.set(name, typeEntry(table, derivation));
  }
  for (const [name, definition] of context.simpleTypes) {
    if (entries.has(name)) {
      return yield* failure(
        "xs:simpleType",
        `${name} also names a complex type, and simple and complex types share one symbol space`,
      );
    }

    entries.set(
      name,
      typeEntry(simpleTypeTable, yield* simpleDerivation(context, name, definition)),
    );
  }

  return Object.fromEntries([...entries].toSorted(([left], [right]) => compareText(left, right)));
});

/**
 * Write an attribute type as a string equal only for equal types.
 *
 * @param type The type.
 * @returns Its canonical spelling.
 */
const typeKey = (type: AttributeType): string => {
  switch (type.kind) {
    case "builtin": {
      return JSON.stringify([type.kind, type.name, type.minInclusive ?? null]);
    }
    case "enumeration": {
      return JSON.stringify([type.kind, type.base, type.values]);
    }
    case "pattern": {
      return JSON.stringify([type.kind, type.base, type.pattern]);
    }
    case "list": {
      return JSON.stringify([type.kind, typeKey(type.item)]);
    }
    case "union": {
      return JSON.stringify([type.kind, type.members.map(typeKey)]);
    }
    default: {
      return type satisfies never;
    }
  }
};

/**
 * Join two attribute types into the type that admits what either admits.
 *
 * @param left One type.
 * @param right The other.
 * @returns `left` when they are equal, otherwise a union of their distinct members.
 */
const unionTypes = (left: AttributeType, right: AttributeType): AttributeType => {
  if (typeKey(left) === typeKey(right)) {
    return left;
  }

  const members = new Map<string, AttributeType>();
  for (const type of [left, right]) {
    for (const member of type.kind === "union" ? type.members : [type]) {
      members.set(typeKey(member), member);
    }
  }

  return { kind: "union", members: [...members.values()] };
};

/**
 * Make an attribute optional, for an element name one of whose types does not declare it.
 *
 * @param table The attribute's table.
 * @returns The table with `use` optional where it was required.
 */
const asOptional = (table: AttributeTable): AttributeTable =>
  table.use === "required" ? { ...table, use: "optional" } : table;

/**
 * Join two declarations of one attribute from two types of one element name.
 *
 * It is required only when both require it, its type admits either type's values, and it keeps a
 * default only when both give the same one.
 *
 * @param left One declaration.
 * @param right The other.
 * @returns The joined table.
 */
const unionAttribute = (left: AttributeTable, right: AttributeTable): AttributeTable =>
  withDefault(
    {
      local: left.local,
      namespace: left.namespace,
      type: unionTypes(left.type, right.type),
      use: left.use === "required" && right.use === "required" ? "required" : "optional",
    },
    left.default === right.default ? left.default : undefined,
  );

/**
 * Join the tables of two declarations of one element name, so nothing either type admits is
 * refused.
 *
 * An attribute only one declares becomes optional. Children, wildcards and declared types are
 * joined; text is allowed, the name is global and its type is inline when either says so.
 *
 * @param target The schema's target namespace.
 * @param left One table.
 * @param right The other.
 * @returns The joined table, or {@link TableGenerationError} when two wildcards have no union.
 */
const unionTables = Effect.fnUntraced(function* unionTables(
  target: string,
  left: ElementTable,
  right: ElementTable,
): Effect.fn.Return<ElementTable, TableGenerationError> {
  const leftNames = new Set(left.attributes.map(clarkName));
  const rightAttributes = new Map(right.attributes.map((table) => [clarkName(table), table]));
  const attributes = [
    ...left.attributes.map((table) => {
      const other = rightAttributes.get(clarkName(table));

      return other === undefined ? asOptional(table) : unionAttribute(table, other);
    }),
    ...right.attributes.filter((table) => !leftNames.has(clarkName(table))).map(asOptional),
  ];

  const children = childMap([...left.children, ...right.children]);
  const anyAttribute = yield* unionWildcards(target, left.anyAttribute, right.anyAttribute);
  const anyElement = yield* unionWildcards(target, left.anyElement, right.anyElement);

  return withAnonymousType(
    withWildcards(
      {
        attributes: sortAttributes(attributes),
        children: sortChildren(children.values()),
        global: left.global || right.global,
        text: left.text || right.text,
        types: sortChildren(childMap([...left.types, ...right.types]).values()),
      },
      anyAttribute,
      anyElement,
    ),
    left.anonymousType === true || right.anonymousType === true,
  );
});

/**
 * How many times a content model admits one child: from `min` to `max`, where `max` is `unbounded`
 * when the model sets no greatest number.
 */
interface Range {
  readonly max: bigint | "unbounded";
  readonly min: bigint;
}

/**
 * One child a content model names, with its {@link Range}.
 */
interface Counted {
  readonly name: ChildName;
  readonly range: Range;
}

/**
 * The children a content model names, each keyed by {@link clarkName} with its range.
 */
type Counts = ReadonlyMap<string, Counted>;

/**
 * What one generation of occurrences remembers beside the tables' context: the counts of the
 * named complex types it has mapped, and the names of those it is mapping, so a type that derives
 * from itself fails rather than looping.
 */
interface Counting {
  readonly cache: Map<string, Counts>;
  readonly context: Context;
  readonly pending: Set<string>;
}

/**
 * The range of a child a content model does not name: it never appears.
 */
const absent: Range = { max: 0n, min: 0n };

/**
 * The particles a content model holds: element declarations and references, element wildcards,
 * model groups and group references.
 */
const particleNames: ReadonlySet<string> = new Set([...modelGroups, "any", "element", "group"]);

/**
 * The lexical form of `xs:nonNegativeInteger`, whose values `minOccurs` and `maxOccurs` take.
 */
const nonNegativeInteger = /^\+?[0-9]+$/u;

/**
 * Report the larger of two counts, `unbounded` larger than any number.
 *
 * @param left One count.
 * @param right The other.
 * @returns The larger count.
 */
const larger = (left: Range["max"], right: Range["max"]): Range["max"] => {
  if (left === "unbounded" || right === "unbounded") {
    return "unbounded";
  }

  return left > right ? left : right;
};

/**
 * Multiply two greatest counts, where none of anything is none even when the other is unbounded.
 *
 * @param left One count.
 * @param right The other.
 * @returns The product.
 */
const product = (left: Range["max"], right: Range["max"]): Range["max"] => {
  if (left === 0n || right === 0n) {
    return 0n;
  }

  return left === "unbounded" || right === "unbounded" ? "unbounded" : left * right;
};

/**
 * Read a particle's `minOccurs` and `maxOccurs`, each 1 when absent, as XML Schema defines them.
 *
 * @param particle The particle.
 * @returns Its range, or {@link TableGenerationError} for a `minOccurs` that is not a non-negative
 *   integer or a `maxOccurs` that is neither one nor `unbounded`.
 */
const occursOf = Effect.fnUntraced(function* occursOf(
  particle: SourceElement,
): Effect.fn.Return<Range, TableGenerationError> {
  const min = valueOf(particle, "minOccurs")?.trim() ?? "1";
  const max = valueOf(particle, "maxOccurs")?.trim() ?? "1";
  if (!nonNegativeInteger.test(min)) {
    return yield* failure(
      `xs:${particle.local}`,
      `minOccurs="${min}" is not a non-negative integer`,
    );
  }

  if (max !== "unbounded" && !nonNegativeInteger.test(max)) {
    return yield* failure(
      `xs:${particle.local}`,
      `maxOccurs="${max}" is neither a non-negative integer nor unbounded`,
    );
  }

  return { max: max === "unbounded" ? "unbounded" : BigInt(max), min: BigInt(min) };
});

/**
 * Repeat a content model's counts as a particle's own range repeats it.
 *
 * @param counts The counts of the particle's content.
 * @param by The particle's own range.
 * @returns Each child's range multiplied by it.
 */
const repeatCounts = (counts: Counts, by: Range): Counts =>
  new Map(
    [...counts].map(([key, { name, range }]) => [
      key,
      { name, range: { max: product(range.max, by.max), min: range.min * by.min } },
    ]),
  );

/**
 * Join the counts of particles that all appear, a sequence's or an `all`'s, or a base's content and
 * an extension's: a child named in several adds their ranges.
 *
 * @param parts The particles' counts, in order.
 * @returns The counts of their sequence.
 */
const sequenceCounts = (parts: readonly Counts[]): Counts => {
  const counts = new Map<string, Counted>();
  for (const part of parts) {
    for (const [key, entry] of part) {
      const seen = counts.get(key);
      counts.set(
        key,
        seen === undefined
          ? entry
          : {
              name: entry.name,
              range: {
                max:
                  seen.range.max === "unbounded" || entry.range.max === "unbounded"
                    ? "unbounded"
                    : seen.range.max + entry.range.max,
                min: seen.range.min + entry.range.min,
              },
            },
      );
    }
  }

  return counts;
};

/**
 * Join the counts of alternatives of which one applies, a choice's branches or the types of one
 * element name's declarations: each child takes its least and greatest count over them, an
 * alternative that does not name it counting none.
 *
 * @param alternatives The alternatives' counts.
 * @returns The counts of their choice.
 */
const alternativeCounts = (alternatives: readonly Counts[]): Counts => {
  const names = new Map<string, ChildName>();
  for (const alternative of alternatives) {
    for (const [key, { name }] of alternative) {
      names.set(key, name);
    }
  }

  const counts = new Map<string, Counted>();
  for (const [key, name] of names) {
    let range: Range | undefined;
    for (const alternative of alternatives) {
      const next = alternative.get(key)?.range ?? absent;
      range =
        range === undefined
          ? next
          : { max: larger(range.max, next.max), min: range.min < next.min ? range.min : next.min };
    }
    counts.set(key, { name, range: range ?? absent });
  }

  return counts;
};

/**
 * Count the children one particle names: an element declaration or reference once per its own
 * range, a model group's particles joined as a sequence or a choice and repeated by its range, a
 * group reference's named group repeated by the reference's, and an element wildcard none.
 *
 * @param context The generation's context.
 * @param particle The particle.
 * @param groups The groups being expanded, so a group that refers to itself fails.
 * @returns The counts, or {@link TableGenerationError} naming what could not be mapped.
 */
const particleCounts = Effect.fnUntraced(function* particleCounts(
  context: Context,
  particle: SourceElement,
  groups: ReadonlySet<string>,
): Effect.fn.Return<Counts, TableGenerationError> {
  const range = yield* occursOf(particle);
  if (particle.local === "element") {
    const name = yield* childName(context, particle);

    return new Map([[clarkName(name), { name, range }]]);
  }

  if (particle.local === "any") {
    return new Map();
  }

  if (particle.local === "group") {
    const group = yield* referencedGroup(context, particle, groups);
    // oxlint-disable-next-line eslint/no-use-before-define -- `particleCounts` and `contentCounts` are mutually recursive, as a named group holds a model group; the call runs only after both are defined.
    const content = yield* contentCounts(context, group.definition, group.expanding);

    return repeatCounts(content, range);
  }

  const parts: Counts[] = [];
  for (const child of xsdChildren(particle).filter((nested) => particleNames.has(nested.local))) {
    parts.push(yield* particleCounts(context, child, groups));
  }

  return repeatCounts(
    particle.local === "choice" ? alternativeCounts(parts) : sequenceCounts(parts),
    range,
  );
});

/**
 * Count the children named by the content model a holder holds: the model group or group reference
 * of a complex type, a derivation or a named group, or none when it holds neither.
 *
 * @param context The generation's context.
 * @param holder The holder.
 * @param groups The groups being expanded, so a group that refers to itself fails.
 * @returns The counts, or {@link TableGenerationError} naming what could not be mapped.
 */
const contentCounts = Effect.fnUntraced(function* contentCounts(
  context: Context,
  holder: SourceElement,
  groups: ReadonlySet<string>,
): Effect.fn.Return<Counts, TableGenerationError> {
  const content = xsdChildren(holder).find(
    (child) => modelGroups.has(child.local) || child.local === "group",
  );

  return content === undefined ? new Map() : yield* particleCounts(context, content, groups);
});

/**
 * Count the children of the type a name resolves to, as {@link typeTable} finds its table: a named
 * complex type's from its definition, once per generation, and none for a simple type or an XML
 * Schema built-in, `xs:anyType` included, whose wildcards name no child.
 *
 * @param counting The generation's memory.
 * @param name The type's resolved name.
 * @returns The counts, or {@link TableGenerationError} when no such type exists.
 */
const typeCounts = Effect.fnUntraced(function* typeCounts(
  counting: Counting,
  name: QName,
): Effect.fn.Return<Counts, TableGenerationError> {
  const { context } = counting;
  if (name.namespace === xsdNamespace) {
    if (name.local === "anyType" || builtins.has(name.local)) {
      return new Map();
    }

    return yield* failure("type", `xs:${name.local} is not a built-in the tables record`);
  }

  const complex =
    name.namespace === context.target ? context.complexTypes.get(name.local) : undefined;
  if (complex === undefined) {
    if (name.namespace === context.target && context.simpleTypes.has(name.local)) {
      return new Map();
    }

    return yield* failure("type", `no type ${clarkName(name)} is declared`);
  }

  const cached = counting.cache.get(name.local);
  if (cached !== undefined) {
    return cached;
  }

  if (counting.pending.has(name.local)) {
    return yield* failure("xs:complexType", `${name.local} derives from itself`);
  }

  counting.pending.add(name.local);

  // oxlint-disable-next-line eslint/no-use-before-define -- `typeCounts` and `complexCounts` are mutually recursive, as a complex type derives from another; the call runs only after both are defined.
  const counts = yield* complexCounts(counting, complex);
  counting.pending.delete(name.local);
  counting.cache.set(name.local, counts);

  return counts;
});

/**
 * Count the children of a complex type, as {@link complexTable} finds them: its own content
 * model's, an extension's base's followed by its own, and a restriction's own alone.
 *
 * @param counting The generation's memory.
 * @param type The `xs:complexType` element.
 * @returns The counts, or {@link TableGenerationError} naming what could not be mapped.
 */
const complexCounts = Effect.fnUntraced(function* complexCounts(
  counting: Counting,
  type: SourceElement,
): Effect.fn.Return<Counts, TableGenerationError> {
  const { context } = counting;
  const content = childNamed(type, "complexContent") ?? childNamed(type, "simpleContent");
  if (content === undefined) {
    return yield* contentCounts(context, type, new Set());
  }

  const derivation = childNamed(content, "extension") ?? childNamed(content, "restriction");
  if (derivation === undefined) {
    return yield* failure(`xs:${content.local}`, "it holds neither an extension nor a restriction");
  }

  const baseName = valueOf(derivation, "base");
  if (baseName === undefined) {
    return yield* failure(`xs:${derivation.local}`, "it has no base");
  }

  const base = yield* typeCounts(counting, yield* resolveQName(context, derivation, baseName));
  const own = yield* contentCounts(context, derivation, new Set());

  return derivation.local === "restriction" ? own : sequenceCounts([base, own]);
});

/**
 * Count the children of an element declaration's type: its `type`, its inline complex type, or
 * none for an inline simple type or `xs:anyType`.
 *
 * @param counting The generation's memory.
 * @param element The `xs:element` element.
 * @returns The counts, or {@link TableGenerationError} naming what could not be mapped.
 */
const declarationCounts = Effect.fnUntraced(function* declarationCounts(
  counting: Counting,
  element: SourceElement,
): Effect.fn.Return<Counts, TableGenerationError> {
  const typeName = valueOf(element, "type");
  if (typeName !== undefined) {
    return yield* typeCounts(counting, yield* resolveQName(counting.context, element, typeName));
  }

  const complex = childNamed(element, "complexType");

  return complex === undefined ? new Map() : yield* complexCounts(counting, complex);
});

/**
 * Write counts in the {@link Occurrences} form: each child's counts in decimal, sorted by namespace
 * then local name.
 *
 * @param counts The counts.
 * @returns The children's occurrences.
 */
const occurrenceList = (counts: Counts): readonly ChildOccurrence[] =>
  [...counts.values()]
    .map(({ name, range }) => ({
      local: name.local,
      maxOccurs: String(range.max),
      minOccurs: String(range.min),
      namespace: name.namespace,
    }))
    .toSorted(compareNames);

/**
 * Write each holder's counts in the {@link Occurrences} form, keyed by local name in sorted order.
 *
 * @param holders Each element's or type's counts by local name.
 * @returns The occurrences of each.
 */
const occurrenceRecord = (
  holders: ReadonlyMap<string, Counts>,
): Readonly<Record<string, readonly ChildOccurrence[]>> =>
  Object.fromEntries(
    [...holders]
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([name, counts]) => [name, occurrenceList(counts)]),
  );

/**
 * What a generation reads from a schema before it maps anything: the context it maps with, and
 * every named element declaration, global or local, with its name, in document order.
 */
interface Generation {
  readonly context: Context;
  readonly declarations: SchemaIndex["declarations"];
}

/**
 * Read a schema's root, refuse the constructs the tables do not record, and build the context one
 * generation maps it with.
 *
 * @param xsd The XSD, whose root is `xs:schema`.
 * @returns The context and the named element declarations, or {@link TableGenerationError} for a
 *   root that is not `xs:schema` or the first construct the tables do not record.
 */
const schemaContext = Effect.fnUntraced(function* schemaContext(
  xsd: SourceDocument,
): Effect.fn.Return<Generation, TableGenerationError> {
  const { root } = xsd;
  if (root.namespace !== xsdNamespace || root.local !== "schema") {
    return yield* failure(
      "xs:schema",
      `the root of ${xsd.location} is {${root.namespace}}${root.local}, not xs:schema`,
    );
  }

  const { declarations, scopes } = indexSchema(root);
  yield* refuseUnrecorded(scopes.keys());

  return {
    context: {
      attributeGroups: definitions(root, "attributeGroup"),
      attributes: definitions(root, "attribute"),
      complexCache: new Map(),
      complexTypes: definitions(root, "complexType"),
      elements: definitions(root, "element"),
      groups: definitions(root, "group"),
      pending: new Set(),
      qualifiedAttributes: valueOf(root, "attributeFormDefault") === "qualified",
      qualifiedElements: valueOf(root, "elementFormDefault") === "qualified",
      scopes,
      simpleCache: new Map(),
      simpleTypes: definitions(root, "simpleType"),
      target: valueOf(root, "targetNamespace") ?? "",
    },
    declarations,
  };
});

/**
 * Schematron's namespace, in which the ASI XSD's annotations state its rules.
 */
const schematronNamespace = "http://purl.oclc.org/dsdl/schematron";

/**
 * The ids of the Schematron patterns that list, element by element, the attributes it may carry:
 * those of QTI's ASI binding's section 5.2, The Constrained Namespace Extension Rule Definitions,
 * which reading 90 reads ("on an element the Schematron's extension-attribute lists cover, an
 * attribute its XSD does not declare is a `data-` attribute, or the document is refused").
 */
const extensionPatterns: ReadonlySet<string> = new Set([
  "RULESET_GLOBALELEMENT_DATAEXTENSIONRULES",
  "RULESET_LOCALELEMENT_DATAEXTENSIONRULES",
  "RULESET_ROOTELEMENT_DATAEXTENSIONRULES",
]);

/**
 * A Schematron rule's context in the one form the extension patterns write: every element of one
 * name, `//<prefix>:<local>`.
 */
const everyElementNamed = /^\/\/(?<prefix>[^/:]+):(?<local>[^/:]+)$/u;

/**
 * List an element's children in Schematron's namespace with one local name, in document order.
 *
 * @param element The element.
 * @param local The children's local name, such as `rule`.
 * @returns Those children.
 */
const schematronChildren = (element: SourceElement, local: string): readonly SourceElement[] =>
  element.children.filter(
    (child): child is SourceElement =>
      child.kind === "element" && child.namespace === schematronNamespace && child.local === local,
  );

/**
 * Read the names of the elements the schema's extension patterns cover ({@link extensionPatterns}):
 * the local name each rule's context selects, in the target namespace.
 *
 * The patterns sit in the `xs:appinfo` of the schema's top-level `xs:annotation`s, and their
 * contexts' prefixes are bound by the `sch:ns` there. Only the patterns' contexts are read, never
 * their assertions: which attributes an element declares is the XSD's to say, and reading 90 makes
 * every other attribute an extension. A schema with no such pattern covers nothing.
 *
 * @param root The `xs:schema` element.
 * @param target The schema's target namespace.
 * @returns The covered elements' local names, or {@link TableGenerationError} for a context not of
 *   the form `//<prefix>:<local>`, or whose prefix no `sch:ns` binds to the target namespace.
 */
const extensionCovered = Effect.fnUntraced(function* extensionCovered(
  root: SourceElement,
  target: string,
): Effect.fn.Return<ReadonlySet<string>, TableGenerationError> {
  const appinfo = xsdChildren(root)
    .filter((child) => child.local === "annotation")
    .flatMap((annotation) => xsdChildren(annotation).filter((child) => child.local === "appinfo"));
  const prefixes = new Map(
    appinfo.flatMap((info) =>
      schematronChildren(info, "ns").map(
        (ns) => [valueOf(ns, "prefix") ?? "", valueOf(ns, "uri") ?? ""] as const,
      ),
    ),
  );
  const covered = new Set<string>();
  for (const pattern of appinfo.flatMap((info) => schematronChildren(info, "pattern"))) {
    const id = valueOf(pattern, "id") ?? "";
    if (!extensionPatterns.has(id)) {
      continue;
    }

    for (const rule of schematronChildren(pattern, "rule")) {
      const context = valueOf(rule, "context") ?? "";
      const { local = "", prefix = "" } = everyElementNamed.exec(context)?.groups ?? {};
      if (!isNcName(prefix) || !isNcName(local)) {
        return yield* failure(
          "sch:rule",
          `the context ${JSON.stringify(context)} in ${id} is not //<prefix>:<name>`,
        );
      }

      if (prefixes.get(prefix) !== target) {
        return yield* failure(
          "sch:rule",
          `the prefix ${prefix} of the context ${context} in ${id} is not bound to the target namespace ${target} by an sch:ns`,
        );
      }

      covered.add(local);
    }
  }

  return covered;
});

/**
 * Generate the tables of an XSD from its source view.
 *
 * Every `xs:element` with a `name`, global or local, gets the table of its type, and a name
 * declared with more than one type gets the union of their tables, with whether any declaration of
 * it is global and the types they give. Attribute group references expand, extensions and
 * restrictions inherit, and every simple type maps to an {@link AttributeType}. Content models
 * flatten into the children an element admits, through group references, with no order or counts;
 * {@link generateOccurrences} gives the counts.
 * Every named type gets its {@link TypeEntry}: its derivation, and the table an element declared
 * with it alone gets. Each element the schema's Schematron extension patterns cover is marked
 * `extensionCovered` ({@link extensionCovered}), by its name, whatever its declarations. The XSD
 * is recorded as written; readings that set part of it aside are applied over the tables by
 * structural validation. Imported schemas are never read: an element referenced from one is a
 * child by name only.
 *
 * An XSD that sets `nillable` or `abstract` true, or any `block`, `final`, `blockDefault`,
 * `finalDefault` or `substitutionGroup`, is refused, since the tables do not record them.
 *
 * @param xsd The XSD, whose root is `xs:schema`.
 * @returns The tables, elements and types sorted by name, attributes, children and declared types
 *   by namespace then local name, or {@link TableGenerationError} naming the first construct with
 *   no table form, or an extension pattern's rule that names an element the XSD does not declare.
 */
export const generateTables = Effect.fn("plate.generateTables")(function* generateTables(
  xsd: SourceDocument,
): Effect.fn.Return<Tables, TableGenerationError> {
  const { context, declarations } = yield* schemaContext(xsd);
  const tables = new Map<string, ElementTable>();
  for (const [name, element] of declarations) {
    const declared = yield* declaredType(context, element);
    const table = elementTable(yield* declarationTable(context, element), {
      anonymous: Option.isNone(declared),
      global: context.elements.get(name) === element,
      types: Option.toArray(declared),
    });
    const seen = tables.get(name);
    tables.set(name, seen === undefined ? table : yield* unionTables(context.target, seen, table));
  }

  for (const name of yield* extensionCovered(xsd.root, context.target)) {
    const table = tables.get(name);
    if (table === undefined) {
      return yield* failure(
        "sch:rule",
        `an extension pattern's rule covers ${name}, an element the XSD does not declare`,
      );
    }

    tables.set(name, { ...table, extensionCovered: true });
  }

  return {
    elements: Object.fromEntries(
      [...tables].toSorted(([left], [right]) => compareText(left, right)),
    ),
    types: yield* typeEntries(context),
  };
});

/**
 * Generate the occurrences of an XSD from its source view: for every element and named type
 * {@link generateTables} gives a table, how many times its content model admits each child it
 * names.
 *
 * A child's least and greatest count are those its content model sets, model groups and group
 * references followed: a sequence adds what its particles admit, a choice takes the least and the
 * greatest over its branches, and a particle's own `minOccurs` and `maxOccurs` multiply what it
 * holds. An extension adds its own content to its base's, and a restriction's content is its own.
 * A name declared with more than one type takes, for each child, the least and the greatest count
 * over its declarations, a declaration that does not name the child counting none. The counts are
 * bounds on each child alone: they keep no order, and no rule that ties one child's count to
 * another's. Elements a wildcard admits are not counted.
 *
 * @param xsd The XSD, whose root is `xs:schema`.
 * @returns The occurrences, keyed as {@link generateTables} keys the tables, or
 *   {@link TableGenerationError} naming the first construct with no table form, as
 *   {@link generateTables} would, or a count that is not a non-negative integer.
 */
export const generateOccurrences = Effect.fn("plate.generateOccurrences")(
  function* generateOccurrences(
    xsd: SourceDocument,
  ): Effect.fn.Return<Occurrences, TableGenerationError> {
    const { context, declarations } = yield* schemaContext(xsd);
    const counting: Counting = { cache: new Map(), context, pending: new Set() };

    const elements = new Map<string, Counts>();
    for (const [name, element] of declarations) {
      const counts = yield* declarationCounts(counting, element);
      const seen = elements.get(name);
      elements.set(name, seen === undefined ? counts : alternativeCounts([seen, counts]));
    }

    const types = new Map<string, Counts>();
    for (const name of context.complexTypes.keys()) {
      types.set(name, yield* typeCounts(counting, { local: name, namespace: context.target }));
    }
    for (const name of context.simpleTypes.keys()) {
      if (types.has(name)) {
        return yield* failure(
          "xs:simpleType",
          `${name} also names a complex type, and simple and complex types share one symbol space`,
        );
      }

      types.set(name, new Map());
    }

    return { elements: occurrenceRecord(elements), types: occurrenceRecord(types) };
  },
);
