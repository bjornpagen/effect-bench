import { Array as Arr, Effect, Option } from "effect";
import { ReaderRefusal, WellFormednessError } from "#crust/errors.ts";
import { NAME_CHAR, NAME_START, productionViolation } from "#crust/names.ts";
import type { Production } from "#crust/names.ts";
import type { XmlDeclaration } from "#crust/tree.ts";

/**
 * One piece of an attribute value as the reader builds it: a run of text, or a reference to a
 * general entity no readable declaration supplies, kept as written.
 *
 * A literal `&` written as `&amp;` or `&#38;` is text, never a reference, so a value's references
 * are the pieces that say so and nothing a later scan of the text could mistake for one.
 */
export type ValuePiece =
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "text"; readonly text: string };

/**
 * The type and the default value of one declared attribute.
 *
 * `type` is the type keyword (`CDATA`, `ID`, `NMTOKENS`, `NOTATION`, ...) or, for an enumeration,
 * the parenthesized list as written. `default` is the value the declaration supplies, as pieces
 * with no two text pieces adjacent and none empty: its character references, the five predefined
 * entity references and the general entities declared before the list expanded into text, any
 * other entity reference a reference piece, and its white space normalized (XML 1.0 section
 * 3.3.3); `#REQUIRED` and `#IMPLIED` supply none.
 */
export interface AttlistEntry {
  readonly default: Option.Option<readonly ValuePiece[]>;
  readonly type: string;
}

/**
 * How a document treats a reference to a general entity that no declaration it can read supplies
 * (XML 1.0 section 4.1, well-formedness constraint "Entity Declared"), in its body and in its
 * attribute defaults alike.
 *
 * A document that says `standalone="yes"` or has no external subset must declare every entity it
 * uses before the use, so such a reference is `refused`, with why no declaration can exist. In any
 * other document the declaration may sit in the external subset, which is never fetched, so the
 * reference is `kept` as written, unless it stands in an attribute default and the internal subset
 * declares the entity after it: a declaration must precede a default's reference, so the lexer
 * refuses that one at the end of the subset.
 */
export type Undeclared =
  | { readonly _tag: "kept" }
  | { readonly _tag: "refused"; readonly why: string };

/**
 * What the prolog of a document says, read before any of the body is parsed.
 *
 * `entities` holds the internal general entities by name, each as its replacement text: character
 * references expanded, general-entity references as written; a parameter-entity reference inside a
 * value is refused. An external or unparsed entity is not in it. `attlists` holds the declared
 * attributes of each element by name. Both stop growing at the first parameter-entity reference
 * the lexer cannot read, unless the document is `standalone`.
 * `bodyStart` is the offset of the first character that the prolog does not account for.
 */
export interface Prolog {
  readonly attlists: ReadonlyMap<string, ReadonlyMap<string, AttlistEntry>>;
  readonly bodyStart: number;
  readonly declaration: Option.Option<XmlDeclaration>;
  readonly doctype: Option.Option<string>;
  readonly entities: ReadonlyMap<string, string>;
  /**
   * The characters of replacement text opened so far, counted as `charge` counts them, so the
   * substitution of the body continues the same count.
   */
  readonly expanded: number;
  /**
   * The document's treatment of a reference to an entity it does not declare, decided by its
   * `standalone` declaration and whether its DOCTYPE names a `SYSTEM` or `PUBLIC` identifier. The
   * external subset is never fetched.
   */
  readonly undeclared: Undeclared;
}

/**
 * Decide how a document treats a reference to an entity it does not declare, by WFC Entity
 * Declared's scope (XML 1.0 section 4.1): a document with no DTD, one whose only subset is an
 * internal one that references no parameter entity, or one that says `standalone="yes"`. Inside it
 * such a reference is not well-formed; outside it the rule is VC Entity Declared, which a reader
 * that does not validate keeps the reference for.
 *
 * @param standalone - Whether the XML declaration says `standalone="yes"`.
 * @param externalSubset - Whether the DOCTYPE names a `SYSTEM` or `PUBLIC` identifier.
 * @param referencesParameters - Whether the internal subset references a parameter entity.
 * @returns `refused` inside the scope, with why; `kept` outside it.
 */
const undeclaredOf = (
  standalone: boolean,
  externalSubset: boolean,
  referencesParameters: boolean,
): Undeclared => {
  if (standalone) {
    return { _tag: "refused", why: 'the document says standalone="yes"' };
  }

  return externalSubset || referencesParameters
    ? { _tag: "kept" }
    : {
        _tag: "refused",
        why: "the document has no external subset and its internal subset references no parameter entity",
      };
};

/**
 * Build the refusal for a reference to an entity the document never declares, or declares only
 * after an attribute default that uses it, and has nowhere else to declare.
 *
 * @param name - The entity's name.
 * @param why - Why no declaration can exist, from {@link Undeclared}.
 * @param position - Where the reference is, in the text the caller reads, or none.
 * @param owner - The attribute whose default holds the reference; none for the body.
 * @param owner.attribute - The attribute's name.
 * @param owner.element - The name of the element the attribute is declared for.
 * @returns The refusal, under rule `undeclared-entity`.
 */
export const undeclaredEntity = (
  name: string,
  why: string,
  position: ReaderRefusal["position"],
  owner?: { readonly attribute: string; readonly element: string },
): ReaderRefusal =>
  new ReaderRefusal({
    detail:
      owner === undefined
        ? `the entity "${name}" is referenced but not declared, and ${why}, so no declaration can exist (XML 1.0 section 4.1, Entity Declared).`
        : `the entity "${name}" is referenced in the default of attribute "${owner.attribute}" of element "${owner.element}" but not declared before that attribute-list declaration, and ${why}, so no declaration can exist (XML 1.0 section 4.1, Entity Declared). Declare the entity before the attribute-list declaration, or write its text in the default.`,
    position,
    rule: "undeclared-entity",
  });

/**
 * Build the refusal for an attribute default that references an entity the internal subset
 * declares only after it. XML 1.0 section 4.1 states "The declaration of a general entity MUST
 * precede any reference to it which appears in a default value in an attribute-list declaration"
 * twice. In WFC Entity Declared's scope (no DTD, an internal subset with no parameter-entity
 * reference, or `standalone="yes"`) it is a well-formedness constraint, so the document is not
 * well-formed. Outside it the same rule is VC Entity Declared, so the document is not valid; and
 * there the default's value is one the specification leaves undetermined: a reader taking the
 * subset in order has not seen the entity at the attribute-list declaration, and neither section
 * 4.4 nor 5.1 fixes what a non-validating reader supplies (libxml2 2.9.13 supplies the empty
 * string). The reader checks no DTD validity in general, but refuses where the infoset the
 * specification defines is undetermined, rather than invent one.
 *
 * @param name - The entity's name.
 * @param owner - The attribute whose default holds the reference.
 * @param owner.attribute - The attribute's name.
 * @param owner.element - The name of the element the attribute is declared for.
 * @param wellFormednessScope - Whether the document is in WFC Entity Declared's scope.
 * @param position - Where the reference is, in the decoded source, or none.
 * @returns The refusal, under rule `undeclared-entity`.
 */
const declaredAfterDefault = (
  name: string,
  owner: { readonly attribute: string; readonly element: string },
  wellFormednessScope: boolean,
  position: ReaderRefusal["position"],
): ReaderRefusal =>
  new ReaderRefusal({
    detail: wellFormednessScope
      ? `the entity "${name}" is referenced in the default of attribute "${owner.attribute}" of element "${owner.element}" before the internal subset declares it, so the document is not well-formed: a declaration must precede every reference in an attribute default (XML 1.0 section 4.1, well-formedness constraint Entity Declared). Move the entity's declaration before the attribute-list declaration.`
      : `the entity "${name}" is referenced in the default of attribute "${owner.attribute}" of element "${owner.element}" before the internal subset declares it, which breaks XML 1.0 section 4.1's validity constraint Entity Declared and leaves the default's value undetermined, since nothing defines what a reader supplies for an entity it has not yet seen. Move the entity's declaration before the attribute-list declaration.`,
    position,
    rule: "undeclared-entity",
  });

/**
 * An XML name, without anchors, for building the patterns below.
 */
const NAME = String.raw`[${NAME_START}][${NAME_CHAR}]*`;

/**
 * White space that XML allows between tokens: space, tab, carriage return and line feed.
 */
const SPACE = /[ \t\r\n]+/uy;

/**
 * One XML name at the read position.
 */
const NAME_AT = new RegExp(NAME, "uy");

/**
 * A parenthesized list of names or name tokens separated by `|` (`Enumeration` and `NotationType`).
 */
const ENUMERATION = new RegExp(
  String.raw`\([ \t\r\n]*[${NAME_CHAR}]+(?:[ \t\r\n]*\|[ \t\r\n]*[${NAME_CHAR}]+)*[ \t\r\n]*\)`,
  "uy",
);

/**
 * The keyword after `<!` of each markup declaration the internal subset may hold.
 */
const DECLARATION_KEYWORD = new RegExp(
  String.raw`<!(ENTITY|ATTLIST|ELEMENT|NOTATION)(?![${NAME_CHAR}])`,
  "uy",
);

/**
 * The rest of a markup declaration through its closing `>`, which a quoted literal can contain.
 */
const DECLARATION_REST = /(?:[^"'>]|"[^"]*"|'[^']*')*>/uy;

/**
 * Each construct that can appear inside an entity value: a hexadecimal or decimal character
 * reference, a general-entity reference, a parameter-entity reference (which a value refuses), or a
 * bare `&` or `%`.
 */
const ENTITY_VALUE_TOKEN = new RegExp(
  String.raw`&#x([0-9A-Fa-f]+);|&#([0-9]+);|&(${NAME});|%(${NAME});|[&%]`,
  "gu",
);

/**
 * Each construct that can appear inside an attribute default that needs work: a character
 * reference, an entity reference, or a bare `&` or `<`.
 */
const DEFAULT_TOKEN = new RegExp(String.raw`&#x([0-9A-Fa-f]+);|&#([0-9]+);|&(${NAME});|[&<]`, "gu");

/**
 * Each place in replacement text where a general entity is referenced, with the comments,
 * processing instructions and CDATA sections that hide a reference consumed as one match.
 */
const REFERENCE_OR_HIDDEN = new RegExp(
  String.raw`<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|&(${NAME});`,
  "gu",
);

/**
 * The line break forms XML 1.0 section 2.11 folds to one line feed.
 */
const LINE_BREAK = /\r\n|[\n\r]/gu;

/**
 * The entities every XML processor knows, by name, with their characters (XML 1.0 section 4.6):
 * the one table the prolog's lexer and the body's reference scan (`#crust/read.ts`) both read.
 */
export const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

/**
 * The attribute types other than an enumeration (`StringType`, `TokenizedType` and `NOTATION`).
 */
const ATTRIBUTE_TYPES: ReadonlySet<string> = new Set([
  "CDATA",
  "ENTITIES",
  "ENTITY",
  "ID",
  "IDREF",
  "IDREFS",
  "NMTOKEN",
  "NMTOKENS",
  "NOTATION",
]);

/**
 * A read position in some text: the document, or the replacement text of a parameter entity that is
 * used as markup.
 *
 * `offset` moves as the lexer reads. `anchor` is the offset in `source` where a failure is reported
 * when `text` is a replacement text, the reference that brought it in; it is `None` for the
 * document, where `offset` is already a position in `source`.
 */
interface Cursor {
  readonly anchor: Option.Option<number>;
  offset: number;
  readonly source: string;
  readonly text: string;
}

/**
 * The most replacement texts that may be open at once, one inside another. It is `xmllint`'s depth.
 */
export const EXPANSION_DEPTH = 20;

/**
 * The characters a document may open through entity references, and how many it has opened.
 *
 * `expanded` grows as `charge` is called; `limit` is fixed when the budget is made.
 */
export interface ExpansionBudget {
  expanded: number;
  readonly limit: number;
}

/**
 * The characters of replacement text a document may open before it is refused as amplification.
 */
const EXPANSION_ALLOWED = 1_000_000;

/**
 * How many times the document's own length may be opened, once past `EXPANSION_ALLOWED`.
 */
const EXPANSION_FACTOR = 5;

/**
 * The cost of one reference beyond its text, so that a million references to an empty entity are
 * bounded too.
 */
const EXPANSION_REFERENCE_COST = 20;

/**
 * A fresh budget for a document of `textLength` characters, at the same limit libxml2 sets: the
 * larger of one million characters and five times the document.
 *
 * @param textLength - The length of the whole document text.
 * @param expanded - The characters already counted, when a later stage continues the count.
 */
export const expansionBudget = (textLength: number, expanded = 0): ExpansionBudget => ({
  expanded,
  limit: Math.max(EXPANSION_ALLOWED, EXPANSION_FACTOR * textLength),
});

/**
 * Find the line and column, both starting at 1 as `saxes` counts them, of `offset` in `source`.
 *
 * A column counts code points and `\r\n`, a lone `\r` and `\n` each end a line.
 *
 * @param source - The text the offset lies in.
 * @param offset - A position in `source`, possibly its length.
 * @returns The 1-based line and column of the character at `offset`.
 */
export const positionOf = (source: string, offset: number) => {
  const before = source.slice(0, offset);
  let line = 1;
  let lineStart = 0;
  for (const lineBreak of before.matchAll(LINE_BREAK)) {
    line += 1;
    lineStart = lineBreak.index + lineBreak[0].length;
  }

  return { column: Arr.fromIterable(before.slice(lineStart)).length + 1, line };
};

/**
 * Where something is in the decoded source, as an offset. A refusal's line and column are found
 * from it only when the refusal is built, because {@link positionOf} reads the source up to the
 * offset, and finding them at every reference the expansion budget admits would cost the square of
 * the subset's length before the budget refused anything.
 */
interface Spot {
  readonly offset: number;
  readonly source: string;
}

/**
 * Find where `offset` is in the decoded source, or where the reference that brought a replacement
 * text in is.
 *
 * @param cursor - The read position, which says whether `offset` is a position in the document.
 * @param offset - A position in `cursor.text`; the read position by default.
 * @returns The offset in `cursor.source`; no substitution precedes the prolog.
 */
const spotOf = (cursor: Cursor, offset: number = cursor.offset): Spot => ({
  offset: Option.getOrElse(cursor.anchor, () => offset),
  source: cursor.source,
});

/**
 * Find the 1-based line and column of `spot`.
 *
 * @param spot - Where something is in the decoded source.
 * @returns Its line and column, from {@link positionOf}.
 */
const positionAt = (spot: Spot) => positionOf(spot.source, spot.offset);

/**
 * Count one opened replacement text against `budget`, and say why it is refused if it is.
 *
 * @param budget - The document's budget.
 * @param length - The length of the replacement text being opened.
 * @param depth - How many replacement texts are open, this one included.
 * @param name - The entity, for the refusal.
 * @param at - Where the reference that opens it is, or none; its line and column are found only
 *   for a refusal.
 * @returns The refusal when `depth` is past `EXPANSION_DEPTH` or the budget is spent, else `None`.
 */
const overBudget = (
  budget: ExpansionBudget,
  length: number,
  depth: number,
  name: string,
  at: Option.Option<Spot>,
): Option.Option<ReaderRefusal> => {
  budget.expanded += length + EXPANSION_REFERENCE_COST;
  const position = () => at.pipe(Option.map(positionAt));
  if (depth > EXPANSION_DEPTH) {
    return Option.some(
      new ReaderRefusal({
        detail: `The entity "${name}" is opened ${depth} levels deep, past the limit of ${EXPANSION_DEPTH}. Declare the entity's value in fewer, flatter steps, or write the text out.`,
        position: position(),
        rule: "entity-expansion",
      }),
    );
  }

  if (budget.expanded > budget.limit) {
    return Option.some(
      new ReaderRefusal({
        detail: `The entity "${name}" brings the replacement text opened by the document's entity references to ${budget.expanded} characters, past the limit of ${budget.limit}. Declare the entity's value in fewer, flatter steps, or write the text out.`,
        position: position(),
        rule: "entity-expansion",
      }),
    );
  }

  return Option.none();
};

/**
 * Count one opened replacement text against `budget`.
 *
 * Each call adds `length` and a fixed cost per reference to `budget.expanded`.
 *
 * @param budget - The document's budget.
 * @param length - The length of the replacement text being opened.
 * @param depth - How many replacement texts are open, this one included.
 * @param name - The entity, for the refusal.
 * @param at - Where the reference that opens it is, or none; its line and column are found only
 *   for a refusal.
 * @returns Nothing; fails with a refusal under rule `entity-expansion` when the depth or the
 *   budget is exceeded.
 */
export const charge = (
  budget: ExpansionBudget,
  length: number,
  depth: number,
  name: string,
  at: Option.Option<Spot>,
): Effect.Effect<void, ReaderRefusal> => {
  const refusal = overBudget(budget, length, depth, name, at);

  return Option.isSome(refusal) ? Effect.fail(refusal.value) : Effect.void;
};

/**
 * What the internal subset has declared so far, and whether reading it has stopped.
 *
 * `bound` holds `&name` and `%name` for every entity declared, internal or external, because the
 * first declaration of a name is binding (XML 1.0 section 4.2). `stopped` is set at the first
 * parameter-entity reference that cannot be read (section 5.1). `externalSubset` is read with the
 * DOCTYPE's external identifier and `referencesParameters` as the subset is read, and at the
 * subset's end the two and `standalone` decide WFC Entity Declared's scope, under which every
 * attribute default is judged as the body is. `kept` lists each reference to an entity not yet
 * declared that an attribute default holds, with the attribute and where the reference is in the
 * decoded source, so the end of the subset can refuse one the subset declares after it, or one it
 * never declares in the WFC's scope, at the reference.
 */
interface Tables {
  readonly attlists: Map<string, Map<string, AttlistEntry>>;
  readonly bound: Set<string>;
  readonly budget: ExpansionBudget;
  readonly entities: Map<string, string>;
  /**
   * Whether the DOCTYPE names a `SYSTEM` or `PUBLIC` identifier, read before the internal subset.
   */
  externalSubset: boolean;
  readonly kept: {
    readonly at: Spot;
    readonly name: string;
    readonly owner: DefaultOwner;
  }[];
  readonly parameters: Map<string, string>;
  /**
   * Whether the subset has referenced a parameter entity, read or not, which takes the document
   * out of WFC Entity Declared's scope (XML 1.0 section 4.1).
   */
  referencesParameters: boolean;
  readonly standalone: boolean;
  stopped: boolean;
}

/**
 * The offset and text of a quoted literal's content, for reporting a failure inside it.
 */
interface Literal {
  readonly content: string;
  readonly start: number;
}

/**
 * Describe the text at the read position for an error message.
 *
 * @param cursor - The read position.
 * @returns The next few characters quoted, or a phrase for the end of the text.
 */
const found = (cursor: Cursor): string => {
  const next = cursor.text.slice(cursor.offset, cursor.offset + 12);

  return next === "" ? "the end of the text" : JSON.stringify(next);
};

/**
 * Find the line and column to report for `offset`, or for the reference that brought a replacement
 * text in.
 *
 * @param cursor - The read position, which says whether `offset` is a position in the document.
 * @param offset - A position in `cursor.text`; the read position by default.
 * @returns The 1-based line and column in `cursor.source`.
 */
const placeOf = (cursor: Cursor, offset: number = cursor.offset) =>
  positionAt(spotOf(cursor, offset));

/**
 * Build the well-formedness error for a failure at `offset`, or at the reference that brought a
 * replacement text in.
 *
 * @param cursor - The read position, which says whether `offset` is a position in the document.
 * @param message - What the lexer expected and what it found.
 * @param offset - Where the failure lies in `cursor.text`; the read position by default.
 * @returns An error with the line and column {@link placeOf} gives.
 */
const failure = (
  cursor: Cursor,
  message: string,
  offset: number = cursor.offset,
): WellFormednessError => new WellFormednessError({ ...placeOf(cursor, offset), message });

/**
 * Read `pattern` at the read position and advance past it when it matches.
 *
 * @param cursor - The read position.
 * @param pattern - A sticky expression.
 * @returns The matched text, or `None` and no movement.
 */
const consume = (cursor: Cursor, pattern: RegExp): Option.Option<string> => {
  pattern.lastIndex = cursor.offset;
  const match = pattern.exec(cursor.text);
  if (match === null) {
    return Option.none();
  }

  cursor.offset = pattern.lastIndex;

  return Option.some(match[0]);
};

/**
 * Advance past `token` when it is next.
 *
 * @param cursor - The read position.
 * @param token - The exact text to take.
 * @returns Whether the token was there.
 */
const take = (cursor: Cursor, token: string): boolean => {
  if (!cursor.text.startsWith(token, cursor.offset)) {
    return false;
  }

  cursor.offset += token.length;

  return true;
};

/**
 * Advance past any white space.
 *
 * @param cursor - The read position.
 * @returns Whether there was any.
 */
const skipSpace = (cursor: Cursor): boolean => Option.isSome(consume(cursor, SPACE));

/**
 * Advance past `token`, which must be next.
 *
 * @param cursor - The read position.
 * @param token - The exact text that must come next.
 * @param context - The construct being read, for the message.
 * @returns Nothing; fails when the token is absent.
 */
const expect = Effect.fnUntraced(function* expectToken(
  cursor: Cursor,
  token: string,
  context: string,
): Effect.fn.Return<void, WellFormednessError> {
  if (!take(cursor, token)) {
    yield* failure(cursor, `${context}: expected "${token}", found ${found(cursor)}.`);
  }
});

/**
 * Advance past required white space.
 *
 * @param cursor - The read position.
 * @param context - The construct being read, for the message.
 * @returns Nothing; fails when there is none.
 */
const expectSpace = Effect.fnUntraced(function* expectWhiteSpace(
  cursor: Cursor,
  context: string,
): Effect.fn.Return<void, WellFormednessError> {
  if (!skipSpace(cursor)) {
    yield* failure(cursor, `${context}: expected white space, found ${found(cursor)}.`);
  }
});

/**
 * Read an XML name that must match a namespace production where it stands.
 *
 * @param cursor - The read position.
 * @param context - What the name names, for the message.
 * @param production - The production Namespaces in XML asks the name to match there
 *   (`#crust/names.ts`).
 * @returns The name; fails when none starts here, or the name does not match the production.
 */
const readName = Effect.fnUntraced(function* readXmlName(
  cursor: Cursor,
  context: string,
  production: Production,
): Effect.fn.Return<string, WellFormednessError> {
  const start = cursor.offset;
  const name = consume(cursor, NAME_AT);
  if (Option.isNone(name)) {
    return yield* failure(cursor, `${context}: expected a name, found ${found(cursor)}.`);
  }

  const violation = productionViolation(name.value, production);
  if (Option.isSome(violation)) {
    return yield* failure(cursor, `${context}: ${violation.value}.`, start);
  }

  return name.value;
});

/**
 * Hold every name a run of declaration text holds to a namespace production: the names a
 * NOTATION type lists, or the element names an element type declaration's content model gives.
 *
 * @param cursor - The read position, for failures.
 * @param text - The run of declaration text.
 * @param start - The offset `text` starts at.
 * @param production - The production each name must match.
 * @param context - What the names name, for the message.
 * @returns Nothing; fails at the first name that does not match.
 */
const namesHeldTo = Effect.fnUntraced(function* namesHeldToProduction(
  cursor: Cursor,
  text: string,
  start: number,
  production: Production,
  context: string,
): Effect.fn.Return<void, WellFormednessError> {
  for (const held of text.matchAll(new RegExp(NAME, "gu"))) {
    const violation = productionViolation(held[0], production);
    if (Option.isSome(violation)) {
      yield* failure(cursor, `${context}: ${violation.value}.`, start + held.index);
    }
  }
});

/**
 * Read a literal in single or double quotes, which can hold the other quote and any markup.
 *
 * @param cursor - The read position.
 * @param context - The construct being read, for the message.
 * @returns The content between the quotes and its offset; fails when no quoted literal is next or
 *   its closing quote is missing.
 */
const readQuoted = Effect.fnUntraced(function* readQuotedLiteral(
  cursor: Cursor,
  context: string,
): Effect.fn.Return<Literal, WellFormednessError> {
  const quote = cursor.text[cursor.offset];
  if (quote !== '"' && quote !== "'") {
    return yield* failure(cursor, `${context}: expected a quoted literal, found ${found(cursor)}.`);
  }

  const start = cursor.offset + 1;
  const end = cursor.text.indexOf(quote, start);
  if (end === -1) {
    return yield* failure(cursor, `${context}: the literal that starts here is not closed.`);
  }

  cursor.offset = end + 1;

  return { content: cursor.text.slice(start, end), start };
});

/**
 * Advance past an external identifier (`SYSTEM "uri"` or `PUBLIC "id" "uri"`) when one is next.
 *
 * @param cursor - The read position.
 * @param context - The construct being read, for the message.
 * @returns Whether an identifier was there; fails when one is malformed.
 */
const skipExternalId = Effect.fnUntraced(function* skipExternalIdentifier(
  cursor: Cursor,
  context: string,
): Effect.fn.Return<boolean, WellFormednessError> {
  const system = take(cursor, "SYSTEM");
  if (!system && !take(cursor, "PUBLIC")) {
    return false;
  }

  yield* expectSpace(cursor, context);
  yield* readQuoted(cursor, context);
  if (!system) {
    yield* expectSpace(cursor, context);
    yield* readQuoted(cursor, context);
  }

  return true;
});

/**
 * Advance past a comment, which cannot hold `--` or end in `-` (XML 1.0 section 2.5).
 *
 * @param cursor - The read position, at `<!--`.
 * @returns Nothing; fails when the comment is not closed or holds `--`.
 */
const skipComment = Effect.fnUntraced(function* skipCommentMarkup(
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  const start = cursor.offset + "<!--".length;
  const end = cursor.text.indexOf("-->", start);
  if (end === -1) {
    yield* failure(cursor, "comment: the comment that starts here is not closed.");
  }

  const body = cursor.text.slice(start, end);
  if (body.includes("--") || body.endsWith("-")) {
    yield* failure(cursor, 'comment: "--" may not appear inside a comment.', start);
  }

  cursor.offset = end + "-->".length;
});

/**
 * Advance past a processing instruction, holding it to XML 1.0 section 2.6: its target is a
 * `PITarget`, a name other than `xml` in any case ([17]), and white space or the closing `?>`
 * follows it ([16]).
 *
 * @param cursor - The read position, at `<?`.
 * @returns Nothing; fails when its target is missing or reserved, runs into its data, or it is not
 *   closed.
 */
const skipInstruction = Effect.fnUntraced(function* skipProcessingInstruction(
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  cursor.offset += "<?".length;
  const target = yield* readName(cursor, "processing instruction", "NCName");
  if (/^xml$/iu.test(target)) {
    yield* failure(
      cursor,
      `processing instruction: the target "${target}" is reserved, since a target that spells xml in any case is no PITarget (XML 1.0 section 2.6, [17]). Rename the instruction's target.`,
    );
  }

  if (
    !cursor.text.startsWith("?>", cursor.offset) &&
    !/^[ \t\r\n]/u.test(cursor.text.slice(cursor.offset, cursor.offset + 1))
  ) {
    yield* failure(
      cursor,
      `processing instruction: white space or "?>" must follow the target "${target}" (XML 1.0 section 2.6, [16]), found ${found(cursor)}.`,
    );
  }

  const end = cursor.text.indexOf("?>", cursor.offset);
  if (end === -1) {
    yield* failure(cursor, "processing instruction: the instruction is not closed.");
  }

  cursor.offset = end + "?>".length;
});

/**
 * Advance past the rest of a markup declaration without reading it.
 *
 * @param cursor - The read position, just after the declaration's keyword.
 * @returns Nothing; fails when no closing `>` follows outside quotes.
 */
const skipDeclaration = Effect.fnUntraced(function* skipDeclarationRest(
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  if (Option.isNone(consume(cursor, DECLARATION_REST))) {
    yield* failure(cursor, "declaration: the declaration that starts here is not closed.");
  }
});

/**
 * Tell whether a code point may appear in an XML document (`Char`, XML 1.0 section 2.2).
 *
 * @param code - A code point.
 * @returns True for tab, line feed, carriage return and the allowed ranges.
 */
const isXmlCharacter = (code: number): boolean =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7_ff) ||
  (code >= 0xe0_00 && code <= 0xff_fd) ||
  (code >= 0x1_00_00 && code <= 0x10_ff_ff);

/**
 * Turn a character reference into its character.
 *
 * @param cursor - The read position, for the message's line.
 * @param token - The `RegExp` match for `&#x...;` or `&#...;`, groups 1 and 2.
 * @param offset - Where the reference lies in `cursor.text`.
 * @returns The character; fails when it is not one XML allows.
 */
const characterOf = Effect.fnUntraced(function* characterOfReference(
  cursor: Cursor,
  token: RegExpExecArray,
  offset: number,
): Effect.fn.Return<string, WellFormednessError> {
  const [reference, hex, decimal] = token;
  const code = hex === undefined ? Number(decimal) : Number.parseInt(hex, 16);
  if (!isXmlCharacter(code)) {
    return yield* failure(
      cursor,
      `character reference: "${reference}" does not name a character XML 1.0 allows.`,
      offset,
    );
  }

  return String.fromCodePoint(code);
});

/**
 * Rebuild the content of a literal as pieces, replacing each token `pattern` finds and normalizing
 * the text between them.
 *
 * @param literal - The literal's content and offset.
 * @param pattern - A global expression for the tokens to replace.
 * @param between - Gives the pieces of the text between two tokens.
 * @param replace - Gives the pieces that replace a token, given its match and its offset in the
 *   text.
 * @returns The pieces, in the literal's order.
 */
const expandLiteral = Effect.fnUntraced(function* expandLiteralContent<P, E>(
  literal: Literal,
  pattern: RegExp,
  between: (text: string) => readonly P[],
  replace: (token: RegExpExecArray, offset: number) => Effect.Effect<readonly P[], E>,
): Effect.fn.Return<readonly P[], E> {
  const pieces: P[] = [];
  let from = 0;
  for (const token of literal.content.matchAll(pattern)) {
    pieces.push(
      ...between(literal.content.slice(from, token.index)),
      ...(yield* replace(token, literal.start + token.index)),
    );
    from = token.index + token[0].length;
  }
  pieces.push(...between(literal.content.slice(from)));

  return pieces;
});

/**
 * Compute the replacement text of an entity value (XML 1.0 section 4.5): character references
 * expanded, general-entity references left as written.
 *
 * A parameter-entity reference inside the value is an error when the entity was read, because a
 * markup declaration of the internal subset forbids one (section 2.8, "PEs in Internal Subset").
 * One that was not read stops the subset (section 5.1) and leaves the returned text incomplete; in
 * a `standalone` document it is an error instead, because every entity such a document uses is
 * declared in it.
 *
 * @param tables - The subset's declarations; `stopped` is set when a reference cannot be read.
 * @param cursor - The read position, for failures.
 * @param literal - The entity value's literal.
 * @returns The replacement text.
 */
const expandEntityValue = (tables: Tables, cursor: Cursor, literal: Literal) =>
  expandLiteral(
    literal,
    ENTITY_VALUE_TOKEN,
    (text) => [text.replaceAll(LINE_BREAK, "\n")],
    Effect.fnUntraced(function* replaceEntityToken(
      token: RegExpExecArray,
      offset: number,
    ): Effect.fn.Return<readonly string[], WellFormednessError> {
      const [whole, hex, decimal, general, parameter] = token;
      if (hex !== undefined || decimal !== undefined) {
        return [yield* characterOf(cursor, token, offset)];
      }

      if (general !== undefined) {
        const violation = productionViolation(general, "NCName");
        if (Option.isSome(violation)) {
          return yield* failure(cursor, `entity value: ${violation.value}.`, offset);
        }

        return [whole];
      }

      if (parameter === undefined) {
        return yield* failure(
          cursor,
          `entity value: "${whole}" must be written as a reference, "&#${whole === "&" ? "38" : "37"};".`,
          offset,
        );
      }

      const violation = productionViolation(parameter, "NCName");
      if (Option.isSome(violation)) {
        return yield* failure(cursor, `entity value: ${violation.value}.`, offset);
      }

      if (tables.parameters.has(parameter)) {
        return yield* failure(
          cursor,
          `entity value: the parameter-entity reference "%${parameter};" is not allowed inside a markup declaration of the internal subset (XML 1.0 section 2.8, "PEs in Internal Subset"). Write the value without it, or "&#37;" for a literal percent sign.`,
          offset,
        );
      }

      if (tables.standalone) {
        return yield* failure(
          cursor,
          `entity value: the parameter entity "${parameter}" is not declared before this reference, and a standalone document declares every entity it uses.`,
          offset,
        );
      }

      tables.stopped = true;

      return [];
    }),
  ).pipe(Effect.map((pieces) => pieces.join("")));

/**
 * The attribute a default is declared for, which a refusal of the default names.
 */
interface DefaultOwner {
  readonly attribute: string;
  readonly element: string;
}

/**
 * Compute the value an attribute declaration supplies, as pieces: character references, the five
 * predefined entity references and the general entities declared so far expanded into text, other
 * entity references kept as reference pieces, and each literal tab and line break turned into a
 * space (XML 1.0 sections 3.3.3 and 4.4.5).
 *
 * A declared entity's replacement text is processed by the same rules, recursively, and each one
 * opened is charged against the subset's budget. A replacement text holding a `<` or a bare `&`
 * is refused (the well-formedness constraint "No `<` in Attribute Values"), at the reference. A
 * reference to an entity no earlier declaration supplies is kept or refused as the document's
 * {@link Undeclared} treatment says: a declaration must precede every reference in a default value
 * (section 4.1, "Entity Declared"), so an entity declared later counts as undeclared here.
 *
 * @param tables - The subset's declarations, budget and undeclared-entity treatment.
 * @param cursor - The read position, for failures.
 * @param owner - The attribute the default is declared for.
 * @param literal - The default's literal, or a replacement text being expanded.
 * @param depth - How many replacement texts are open, `literal`'s own excluded.
 * @param at - The offset to report failures at, when `literal` is a replacement text.
 * @returns The default value's pieces, in order, adjacent text pieces not yet joined.
 */
const expandDefault = (
  tables: Tables,
  cursor: Cursor,
  owner: DefaultOwner,
  literal: Literal,
  depth = 0,
  at: Option.Option<number> = Option.none(),
): Effect.Effect<readonly ValuePiece[], WellFormednessError | ReaderRefusal> =>
  expandLiteral(
    literal,
    DEFAULT_TOKEN,
    (text): readonly ValuePiece[] => [
      { kind: "text", text: text.replaceAll(/\r\n|[\t\n\r]/gu, " ") },
    ],
    Effect.fnUntraced(function* replaceDefaultToken(
      token: RegExpExecArray,
      offset: number,
    ): Effect.fn.Return<readonly ValuePiece[], WellFormednessError | ReaderRefusal> {
      const [whole, hex, decimal, entity] = token;
      const where = Option.getOrElse(at, () => offset);
      if (hex !== undefined || decimal !== undefined) {
        return [{ kind: "text", text: yield* characterOf(cursor, token, where) }];
      }

      if (entity === undefined) {
        return yield* failure(
          cursor,
          `attribute default: "${whole}" cannot appear in a default value; write "&#${whole === "&" ? "38" : "60"};".`,
          where,
        );
      }

      const violation = productionViolation(entity, "NCName");
      if (Option.isSome(violation)) {
        return yield* failure(cursor, `attribute default: ${violation.value}.`, where);
      }

      const predefined = PREDEFINED.get(entity);
      if (predefined !== undefined) {
        return [{ kind: "text", text: predefined }];
      }

      const replacement = tables.entities.get(entity);
      if (replacement === undefined) {
        // Kept until the subset ends, when WFC Entity Declared's scope is known (section 4.1): a
        // parameter-entity reference after the list still takes the document out of it.
        tables.kept.push({ at: spotOf(cursor, where), name: entity, owner });

        return [{ kind: "reference", name: entity }];
      }

      yield* charge(
        tables.budget,
        replacement.length,
        depth + 1,
        entity,
        Option.some(spotOf(cursor, where)),
      );

      return yield* expandDefault(
        tables,
        cursor,
        owner,
        { content: replacement, start: where },
        depth + 1,
        Option.some(where),
      );
    }),
  );

/**
 * Join a value's adjacent text pieces and drop its empty ones, so text and references alternate.
 *
 * @param pieces - The pieces, in order.
 * @returns The same value, with no two text pieces adjacent and none empty.
 */
const joined = (pieces: readonly ValuePiece[]): readonly ValuePiece[] => {
  const out: ValuePiece[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (piece.kind === "reference") {
      out.push(piece);
    } else if (last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + piece.text };
    } else if (piece.text !== "") {
      out.push(piece);
    }
  }

  return out;
};

/**
 * Advance past the rest of an external entity declaration, whose identifier says where the entity
 * lives and which the lexer never fetches; a general entity may also be unparsed (`NDATA`).
 *
 * @param cursor - The read position, after the entity's name.
 * @param parameter - Whether the declaration is of a parameter entity, which cannot be unparsed.
 * @returns Nothing; fails when neither a quoted value nor an external identifier is there.
 */
const skipExternalEntity = Effect.fnUntraced(function* skipExternalEntityDeclaration(
  cursor: Cursor,
  parameter: boolean,
): Effect.fn.Return<void, WellFormednessError> {
  const context = "entity declaration";
  const external = yield* skipExternalId(cursor, context);
  if (!external) {
    yield* failure(
      cursor,
      `${context}: expected a quoted value, "SYSTEM" or "PUBLIC", found ${found(cursor)}.`,
    );
  }

  skipSpace(cursor);
  if (!parameter && take(cursor, "NDATA")) {
    yield* expectSpace(cursor, context);
    yield* readName(cursor, `${context}, notation name`, "NCName");
    skipSpace(cursor);
  }

  yield* expect(cursor, ">", context);
});

/**
 * Read an `<!ENTITY>` declaration and table it: a general entity in `entities`, a parameter entity
 * in `parameters`, unless its name already has a declaration or it is external.
 *
 * @param tables - The subset's declarations.
 * @param cursor - The read position, just after `<!ENTITY`.
 * @returns Nothing; fails when the declaration is malformed.
 */
const lexEntity = Effect.fnUntraced(function* lexEntityDeclaration(
  tables: Tables,
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  const context = "entity declaration";
  yield* expectSpace(cursor, context);

  const parameter = take(cursor, "%");
  if (parameter) {
    yield* expectSpace(cursor, context);
  }

  const name = yield* readName(cursor, context, "NCName");
  yield* expectSpace(cursor, context);

  const key = `${parameter ? "%" : "&"}${name}`;
  if (cursor.text[cursor.offset] === '"' || cursor.text[cursor.offset] === "'") {
    const literal = yield* readQuoted(cursor, context);
    skipSpace(cursor);
    yield* expect(cursor, ">", context);

    const value = yield* expandEntityValue(tables, cursor, literal);
    if (!tables.stopped && !tables.bound.has(key)) {
      (parameter ? tables.parameters : tables.entities).set(name, value);
    }
  } else {
    yield* skipExternalEntity(cursor, parameter);
  }

  tables.bound.add(key);
});

/**
 * Read an attribute's type: a keyword, `NOTATION` with its names, or an enumeration.
 *
 * @param cursor - The read position, at the type.
 * @returns The keyword, or the enumeration as written; fails when it is none of the types.
 */
const lexAttributeType = Effect.fnUntraced(function* lexAttributeTypeDeclaration(
  cursor: Cursor,
): Effect.fn.Return<string, WellFormednessError> {
  const context = "attribute-list declaration";
  const enumeration = consume(cursor, ENUMERATION);
  if (Option.isSome(enumeration)) {
    return enumeration.value;
  }

  const start = cursor.offset;
  const keyword = yield* readName(cursor, `${context}, attribute type`, "Name");
  if (!ATTRIBUTE_TYPES.has(keyword)) {
    return yield* failure(
      cursor,
      `${context}: "${keyword}" is not an attribute type; use CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration.`,
      start,
    );
  }

  if (keyword === "NOTATION") {
    yield* expectSpace(cursor, context);

    const listed = cursor.offset;
    const names = consume(cursor, ENUMERATION);
    if (Option.isNone(names)) {
      return yield* failure(
        cursor,
        `${context}: expected the parenthesized notation names, found ${found(cursor)}.`,
      );
    }

    yield* namesHeldTo(cursor, names.value, listed, "NCName", `${context}, notation name`);
  }

  return keyword;
});

/**
 * Read an attribute's default declaration.
 *
 * @param tables - The subset's declarations, budget and undeclared-entity treatment.
 * @param cursor - The read position, at the default declaration.
 * @param owner - The attribute the default is declared for.
 * @returns The default value as joined pieces, or `None` for `#REQUIRED` and `#IMPLIED`; fails
 *   when it is none of the four forms, or holds a reference the document's treatment refuses.
 */
const lexAttributeDefault = Effect.fnUntraced(function* lexAttributeDefaultDeclaration(
  tables: Tables,
  cursor: Cursor,
  owner: DefaultOwner,
): Effect.fn.Return<Option.Option<readonly ValuePiece[]>, WellFormednessError | ReaderRefusal> {
  const context = "attribute-list declaration";
  if (take(cursor, "#REQUIRED") || take(cursor, "#IMPLIED")) {
    return Option.none();
  }

  if (take(cursor, "#FIXED")) {
    yield* expectSpace(cursor, context);
  } else if (cursor.text[cursor.offset] !== '"' && cursor.text[cursor.offset] !== "'") {
    return yield* failure(
      cursor,
      `${context}: expected "#REQUIRED", "#IMPLIED", "#FIXED" or a quoted default value, found ${found(cursor)}.`,
    );
  }

  return Option.some(
    joined(yield* expandDefault(tables, cursor, owner, yield* readQuoted(cursor, context))),
  );
});

/**
 * Read an `<!ATTLIST>` declaration and table each attribute under its element, unless the element
 * already declares an attribute of that name.
 *
 * @param tables - The subset's declarations.
 * @param cursor - The read position, just after `<!ATTLIST`.
 * @returns Nothing; fails when the declaration is malformed.
 */
const lexAttlist = Effect.fnUntraced(function* lexAttlistDeclaration(
  tables: Tables,
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError | ReaderRefusal> {
  const context = "attribute-list declaration";
  yield* expectSpace(cursor, context);

  const element = yield* readName(cursor, `${context}, element name`, "QName");
  for (;;) {
    const spaced = skipSpace(cursor);
    if (take(cursor, ">")) {
      return;
    }

    if (!spaced) {
      yield* failure(cursor, `${context}: expected white space or ">", found ${found(cursor)}.`);
    }

    const name = yield* readName(cursor, `${context}, attribute name`, "QName");
    yield* expectSpace(cursor, context);

    const type = yield* lexAttributeType(cursor);
    yield* expectSpace(cursor, context);

    const entry = {
      default: yield* lexAttributeDefault(tables, cursor, { attribute: name, element }),
      type,
    };
    const attributes = tables.attlists.get(element);
    if (attributes === undefined) {
      tables.attlists.set(element, new Map([[name, entry]]));
    } else if (!attributes.has(name)) {
      attributes.set(name, entry);
    }
  }
});

/**
 * Find the general entities that refer to themselves, directly or through others.
 *
 * A reference counts where the parser that follows would act on it, so one inside a comment, a
 * processing instruction or a CDATA section of a replacement text does not (XML 1.0 section 4.4,
 * well-formedness constraint "No Recursion").
 *
 * @param entities - The general entities by name, each as its replacement text.
 * @returns The names along the first cycle found, ending where it began, or `None`.
 */
const findCycle = (entities: ReadonlyMap<string, string>): Option.Option<readonly string[]> => {
  const cleared = new Set<string>();
  for (const [root, text] of entities) {
    if (cleared.has(root)) {
      continue;
    }

    // Each entity along the path from `root`, with the references of its replacement text that are
    // not yet followed; the innermost last.
    const path: { readonly name: string; readonly references: Iterator<RegExpExecArray> }[] = [
      { name: root, references: text.matchAll(REFERENCE_OR_HIDDEN) },
    ];
    const onPath = new Set<string>([root]);
    for (let frame = path.at(-1); frame !== undefined; frame = path.at(-1)) {
      const step = frame.references.next();
      if (step.done === true) {
        path.pop();
        onPath.delete(frame.name);
        cleared.add(frame.name);

        continue;
      }

      const [, name] = step.value;
      if (name === undefined) {
        continue;
      }

      if (onPath.has(name)) {
        const names = path.map((entry) => entry.name);

        return Option.some([...names.slice(names.indexOf(name)), name]);
      }

      const replacement = entities.get(name);
      if (replacement !== undefined && !cleared.has(name)) {
        path.push({ name, references: replacement.matchAll(REFERENCE_OR_HIDDEN) });
        onPath.add(name);
      }
    }
  }

  return Option.none();
};

/**
 * Read a `%name;` reference between the declarations of a subset.
 *
 * A parameter entity that was not read stops the subset unless the document is `standalone` (XML
 * 1.0 section 5.1).
 *
 * @param tables - The subset's declarations.
 * @param cursor - The read position, at the `%`.
 * @param active - The parameter entities whose replacement text is being lexed, so one that names
 *   itself through a `&#37;` is refused instead of looping.
 * @returns The name and replacement text of the parameter entity to lex as more of the subset, or
 *   `None` when it was not read or the subset has stopped; fails when the reference is malformed or
 *   the parameter entity refers to itself.
 */
const readParameterReference = Effect.fnUntraced(function* readParameterEntityReference(
  tables: Tables,
  cursor: Cursor,
  active: ReadonlySet<string>,
): Effect.fn.Return<
  Option.Option<{ name: string; replacement: string }>,
  WellFormednessError | ReaderRefusal
> {
  const start = cursor.offset;
  cursor.offset += "%".length;
  const name = yield* readName(cursor, "parameter-entity reference", "NCName");
  yield* expect(cursor, ";", "parameter-entity reference");
  tables.referencesParameters = true;

  const replacement = tables.parameters.get(name);
  if (tables.stopped) {
    return Option.none();
  }

  if (replacement === undefined) {
    tables.stopped = !tables.standalone;

    return Option.none();
  }

  if (active.has(name)) {
    return yield* new ReaderRefusal({
      detail: `The parameter entity "${name}" refers to itself, which XML 1.0 forbids (well-formedness constraint "No Recursion"). Remove the reference from its replacement text.`,
      position: Option.some(placeOf(cursor, start)),
      rule: "entity-cycle",
    });
  }

  return Option.some({ name, replacement });
});

/**
 * Read the keyword that follows `<!` in a markup declaration of the internal subset.
 *
 * @param cursor - The read position, at `<` of something that is not a comment or an instruction.
 * @returns The consumed `<!ENTITY`, `<!ATTLIST`, `<!ELEMENT` or `<!NOTATION`; fails when the text is
 *   none of them.
 */
const readDeclarationKeyword = Effect.fnUntraced(function* readSubsetDeclarationKeyword(
  cursor: Cursor,
): Effect.fn.Return<string, WellFormednessError> {
  const keyword = consume(cursor, DECLARATION_KEYWORD);
  if (Option.isNone(keyword)) {
    return yield* failure(
      cursor,
      `internal subset: expected a markup declaration, a comment, a processing instruction or a parameter-entity reference, found ${found(cursor)}.`,
    );
  }

  return keyword.value;
});

/**
 * Tables a declaration after the subset stopped is lexed into, so its literals are held to their
 * productions (a default's `AttValue`, an `EntityValue`, the characters its references name) while
 * nothing it declares binds: empty, apart from the subset's budget, and keeping every reference,
 * since a document whose subset references a parameter entity is outside WFC Entity Declared's
 * scope (XML 1.0 section 4.1).
 *
 * @param tables - The subset's tables.
 * @returns The tables to drop.
 */
const unprocessed = (tables: Tables): Tables => ({
  attlists: new Map(),
  bound: new Set(),
  budget: tables.budget,
  entities: new Map(),
  externalSubset: tables.externalSubset,
  kept: [],
  parameters: new Map(),
  referencesParameters: true,
  standalone: tables.standalone,
  stopped: false,
});

/**
 * Read an element type declaration's names after its keyword and skip the rest: the element's
 * name ([17] elementdecl) and every name its content model gives ([18] cp, [19] Mixed) are each a
 * QName (Namespaces in XML section 5); the model's keywords, `EMPTY`, `ANY` and `#PCDATA`'s
 * `PCDATA`, are QNames too.
 *
 * @param cursor - The read position, just after `<!ELEMENT`.
 * @returns Nothing; fails when a name is no QName or the declaration is not closed.
 */
const lexElementNames = Effect.fnUntraced(function* lexElementDeclarationNames(
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  const context = "element type declaration";
  yield* expectSpace(cursor, context);
  yield* readName(cursor, context, "QName");

  const model = cursor.offset;
  const rest = consume(cursor, DECLARATION_REST);
  if (Option.isNone(rest)) {
    return yield* failure(cursor, "declaration: the declaration that starts here is not closed.");
  }

  return yield* namesHeldTo(cursor, rest.value, model, "QName", `${context}, content model`);
});

/**
 * Read one comment, processing instruction or markup declaration of the internal subset.
 *
 * `ELEMENT` and `NOTATION` declarations are read for their names alone (Namespaces in XML sections
 * 5 and 7). An `ENTITY` or `ATTLIST` declaration after the subset stopped is lexed but not
 * processed (XML 1.0 section 5.1).
 *
 * @param tables - The subset's declarations.
 * @param cursor - The read position, at a `<`.
 * @returns Nothing; fails when the markup is malformed.
 */
const lexMarkup = Effect.fnUntraced(function* lexSubsetMarkup(
  tables: Tables,
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError | ReaderRefusal> {
  if (cursor.text.startsWith("<!--", cursor.offset)) {
    yield* skipComment(cursor);
  } else if (cursor.text.startsWith("<?", cursor.offset)) {
    yield* skipInstruction(cursor);
  } else {
    const keyword = yield* readDeclarationKeyword(cursor);
    // After the subset stopped, an entity or attribute-list declaration is not processed (XML 1.0
    // section 5.1) but is still held to its production: it is lexed into tables of its own, which
    // are dropped.
    const into = tables.stopped ? unprocessed(tables) : tables;
    if (keyword.endsWith("ELEMENT")) {
      yield* lexElementNames(cursor);
    } else if (keyword.endsWith("NOTATION")) {
      yield* expectSpace(cursor, "notation declaration");
      yield* readName(cursor, "notation declaration", "NCName");
      yield* skipDeclaration(cursor);
    } else if (keyword.endsWith("ENTITY")) {
      yield* lexEntity(into, cursor);
    } else {
      yield* lexAttlist(into, cursor);
    }
  }
});

/**
 * Read the markup of an internal subset up to its closing `]` or the end of the text, and the
 * markup of each parameter entity it uses between declarations.
 *
 * @param tables - The subset's declarations.
 * @param cursor - The read position, after `[` or at the start of a replacement text.
 * @param active - The parameter entities whose replacement text is being lexed.
 * @returns Nothing; the cursor rests at the `]` or the end.
 */
const lexSubset: (
  tables: Tables,
  cursor: Cursor,
  active: ReadonlySet<string>,
) => Effect.Effect<void, WellFormednessError | ReaderRefusal> = Effect.fnUntraced(
  function* lexSubsetRun(
    tables: Tables,
    cursor: Cursor,
    active: ReadonlySet<string>,
  ): Effect.fn.Return<void, WellFormednessError | ReaderRefusal> {
    for (;;) {
      skipSpace(cursor);

      const next = cursor.text[cursor.offset];
      if (next === undefined || next === "]") {
        return;
      }

      if (next === "%") {
        const start = cursor.offset;
        const used = yield* readParameterReference(tables, cursor, active);
        if (Option.isSome(used)) {
          const inside: Cursor = {
            anchor: Option.orElseSome(cursor.anchor, () => start),
            offset: 0,
            source: cursor.source,
            text: used.value.replacement,
          };
          yield* charge(
            tables.budget,
            used.value.replacement.length,
            active.size + 1,
            used.value.name,
            Option.some(spotOf(cursor, start)),
          );
          yield* lexSubset(tables, inside, new Set([...active, used.value.name]));
          if (inside.offset < inside.text.length) {
            yield* failure(
              inside,
              `parameter-entity reference: the replacement text of "${used.value.name}" has ${found(inside)} where markup was expected.`,
            );
          }
        }
      } else {
        yield* lexMarkup(tables, cursor);
      }
    }
  },
);

/**
 * Read a `<!DOCTYPE>` declaration, its internal subset into `tables`.
 *
 * The external identifier precedes the internal subset; how an undeclared reference is treated is
 * decided once the subset ends, when whether it references a parameter entity is known too.
 *
 * @param tables - The subset's declarations, filled as the subset is read.
 * @param cursor - The read position, at `<!DOCTYPE`.
 * @returns The declaration's text whole; fails when it is malformed.
 */
const lexDoctype = Effect.fnUntraced(function* lexDoctypeDeclaration(
  tables: Tables,
  cursor: Cursor,
): Effect.fn.Return<string, WellFormednessError | ReaderRefusal> {
  const context = "document type declaration";
  const start = cursor.offset;
  cursor.offset += "<!DOCTYPE".length;
  yield* expectSpace(cursor, context);
  yield* readName(cursor, context, "QName");
  skipSpace(cursor);

  tables.externalSubset = yield* skipExternalId(cursor, context);
  skipSpace(cursor);
  if (take(cursor, "[")) {
    yield* lexSubset(tables, cursor, new Set());
    yield* expect(cursor, "]", "internal subset");
    skipSpace(cursor);
  }

  yield* expect(cursor, ">", context);

  return cursor.text.slice(start, cursor.offset);
});

/**
 * Read one pseudo-attribute of the XML declaration, `name="value"` or `name='value'`.
 *
 * @param cursor - The read position, after the previous pseudo-attribute.
 * @param name - The pseudo-attribute's name.
 * @returns The value as written, or `None` when the pseudo-attribute is absent; fails when it
 *   starts but is malformed.
 */
const lexPseudoAttribute = Effect.fnUntraced(function* lexPseudoAttributeDeclaration(
  cursor: Cursor,
  name: string,
): Effect.fn.Return<Option.Option<string>, WellFormednessError> {
  const context = "XML declaration";
  const before = cursor.offset;
  const spaced = skipSpace(cursor);
  if (!cursor.text.startsWith(name, cursor.offset)) {
    cursor.offset = before;

    return Option.none();
  }

  if (!spaced) {
    return yield* failure(cursor, `${context}: expected white space before "${name}".`);
  }

  cursor.offset += name.length;
  skipSpace(cursor);
  yield* expect(cursor, "=", context);
  skipSpace(cursor);

  const value = yield* readQuoted(cursor, `${context}, ${name}`);
  if (name === "standalone" && value.content !== "yes" && value.content !== "no") {
    return yield* failure(
      cursor,
      `${context}: standalone must be "yes" or "no", found ${JSON.stringify(value.content)}.`,
      value.start,
    );
  }

  return Option.some(value.content);
});

/**
 * Read the XML declaration when the text starts with one.
 *
 * `<?xml-stylesheet ...?>` and a declaration that is not first are processing instructions, not
 * declarations, and are left for the parser that follows.
 *
 * @param cursor - The read position, at the start of the text.
 * @returns The declaration's three fields as written, or `None`; fails when it is malformed.
 */
const lexDeclaration = Effect.fnUntraced(function* lexXmlDeclaration(
  cursor: Cursor,
): Effect.fn.Return<Option.Option<XmlDeclaration>, WellFormednessError> {
  if (!/^<\?xml[ \t\r\n]/u.test(cursor.text)) {
    return Option.none();
  }

  cursor.offset = "<?xml".length;
  const version = yield* lexPseudoAttribute(cursor, "version");
  if (Option.isNone(version)) {
    return yield* failure(cursor, `XML declaration: expected version, found ${found(cursor)}.`);
  }

  const encoding = yield* lexPseudoAttribute(cursor, "encoding");
  const standalone = yield* lexPseudoAttribute(cursor, "standalone");
  skipSpace(cursor);
  yield* expect(cursor, "?>", "XML declaration");

  return Option.some({ encoding, standalone, version: version.value });
});

/**
 * Advance past the white space, comments and processing instructions of the prolog.
 *
 * @param cursor - The read position.
 * @returns Nothing; fails when a comment or processing instruction is malformed.
 */
const skipMisc = Effect.fnUntraced(function* skipMiscMarkup(
  cursor: Cursor,
): Effect.fn.Return<void, WellFormednessError> {
  for (;;) {
    skipSpace(cursor);
    if (cursor.text.startsWith("<!--", cursor.offset)) {
      yield* skipComment(cursor);
    } else if (cursor.text.startsWith("<?", cursor.offset)) {
      yield* skipInstruction(cursor);
    } else {
      return;
    }
  }
});

/**
 * Lex the prolog of an XML document: the XML declaration, the document type declaration with its
 * internal subset, and where the body starts.
 *
 * Nothing after the document type declaration is read. The internal subset is read as XML 1.0
 * section 4.5 and 5.1 describe: entity values are expanded at declaration (a parameter-entity
 * reference inside one is refused, section 2.8), the first declaration of
 * a name binds, and reading stops at the first parameter-entity reference that was not read unless
 * the declaration says `standalone="yes"`. An external subset is recorded and never fetched.
 *
 * @param text - The decoded document text.
 * @returns The prolog; fails with a well-formedness error carrying the line and column of a
 *   malformed declaration or subset, or with a refusal under rule `entity-cycle` for a general
 *   entity that refers to itself.
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#sec-prolog-dtd XML 1.0, section 2.8}
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#intern-replacement XML 1.0, section 4.5}
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#proc-types XML 1.0, section 5.1}
 */
export const lexProlog = Effect.fnUntraced(function* lexPrologText(
  text: string,
): Effect.fn.Return<Prolog, WellFormednessError | ReaderRefusal> {
  const cursor: Cursor = { anchor: Option.none(), offset: 0, source: text, text };
  const declaration = yield* lexDeclaration(cursor);
  const standalone = Option.exists(declaration, (read) => Option.contains(read.standalone, "yes"));
  const tables: Tables = {
    attlists: new Map(),
    bound: new Set(),
    budget: expansionBudget(text.length),
    entities: new Map(),
    externalSubset: false,
    kept: [],
    parameters: new Map(),
    referencesParameters: false,
    standalone,
    stopped: false,
  };
  yield* skipMisc(cursor);

  const doctype = text.startsWith("<!DOCTYPE", cursor.offset)
    ? Option.some(yield* lexDoctype(tables, cursor))
    : Option.none();
  const undeclared = undeclaredOf(standalone, tables.externalSubset, tables.referencesParameters);
  const early = tables.kept.find(({ name }) => tables.bound.has(`&${name}`));
  if (early !== undefined) {
    return yield* declaredAfterDefault(
      early.name,
      early.owner,
      undeclared._tag === "refused",
      Option.some(positionAt(early.at)),
    );
  }

  const never = tables.kept.find(({ name }) => !tables.bound.has(`&${name}`));
  if (never !== undefined && undeclared._tag === "refused") {
    return yield* undeclaredEntity(
      never.name,
      undeclared.why,
      Option.some(positionAt(never.at)),
      never.owner,
    );
  }

  const cycle = findCycle(tables.entities);
  if (Option.isSome(cycle)) {
    return yield* new ReaderRefusal({
      detail: `The general entity "${cycle.value[0]}" refers to itself (${cycle.value.join(" -> ")}), which XML 1.0 forbids (well-formedness constraint "No Recursion"). Remove one of the references from the internal subset.`,
      position: Option.none(),
      rule: "entity-cycle",
    });
  }

  return {
    attlists: tables.attlists,
    bodyStart: cursor.offset,
    declaration,
    doctype,
    entities: tables.entities,
    expanded: tables.budget.expanded,
    undeclared,
  };
});

/**
 * How a quote of replacement text is written inside an attribute value literal.
 */
const ATTRIBUTE_QUOTES: ReadonlyMap<string, string> = new Map([
  ['"', "&#34;"],
  ["'", "&#39;"],
]);

/**
 * A reference to a general entity, `&name;`, sticky.
 */
const REFERENCE_AT = new RegExp(`&(${NAME});`, "uy");

/**
 * Where a markup run that substitution does not touch ends: the end of a comment, a processing
 * instruction or a CDATA section that starts at `offset`, or `offset` itself when none does.
 */
const hiddenEnd = (text: string, offset: number): number => {
  for (const [open, close] of [
    ["<!--", "-->"],
    ["<?", "?>"],
    ["<![CDATA[", "]]>"],
  ] as const) {
    if (text.startsWith(open, offset)) {
      const end = text.indexOf(close, offset + open.length);

      return end === -1 ? text.length : end + close.length;
    }
  }

  return offset;
};

/**
 * One reference to a declared, non-predefined entity at `offset`: its replacement text and the
 * offset after its `;`, or none.
 */
const declaredReferenceAt = (
  text: string,
  offset: number,
  entities: ReadonlyMap<string, string>,
): Option.Option<{ readonly end: number; readonly name: string; readonly replacement: string }> => {
  REFERENCE_AT.lastIndex = offset;
  const match = REFERENCE_AT.exec(text);
  const name = match?.[1];
  if (match === null || name === undefined || PREDEFINED.has(name)) {
    return Option.none();
  }

  const replacement = entities.get(name);

  return replacement === undefined
    ? Option.none()
    : Option.some({ end: offset + match[0].length, name, replacement });
};

/**
 * Substitute the declared general entities of `prolog` into `text`.
 *
 * The prolog and the DOCTYPE stay verbatim at the front, so an offset into the result is an offset
 * into the text a parser reads. From `bodyStart` on, each reference to a declared entity other
 * than the five predefined ones is replaced, and the replacement text is rescanned: in element
 * content it goes in as written, so markup in it is parsed as markup; inside an attribute value
 * literal it goes in with both quotes written as character references, so it cannot end the
 * literal. Comments, processing instructions and CDATA sections, undeclared names and character
 * references are left as written. Each replacement text opened is charged against the budget the
 * prolog began, so nesting past `EXPANSION_DEPTH` or amplification past its limit is refused.
 *
 * @returns The substituted text; fails with a refusal under rule `entity-expansion` when the
 *   references open too much.
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#entproc XML 1.0, section 4.4}
 */
export const substitute = (text: string, prolog: Prolog): Effect.Effect<string, ReaderRefusal> =>
  Effect.suspend(() => {
    const { bodyStart, entities } = prolog;
    const budget = expansionBudget(text.length, prolog.expanded);
    const opened = { refusal: Option.none<ReaderRefusal>() };
    let body = text.slice(0, bodyStart);

    const open = (length: number, depth: number, name: string): boolean => {
      opened.refusal = overBudget(budget, length, depth, name, Option.none());

      return Option.isNone(opened.refusal);
    };

    const expandAttribute = (source: string, depth: number): string => {
      let result = "";
      let offset = 0;
      while (offset < source.length && Option.isNone(opened.refusal)) {
        const reference =
          source[offset] === "&" ? declaredReferenceAt(source, offset, entities) : Option.none();
        if (Option.isSome(reference)) {
          const { name, replacement } = reference.value;
          if (open(replacement.length, depth + 1, name)) {
            result += expandAttribute(replacement, depth + 1);
          }

          offset = reference.value.end;
        } else {
          const char = source.charAt(offset);
          result += ATTRIBUTE_QUOTES.get(char) ?? char;
          offset += 1;
        }
      }

      return result;
    };

    const scanTag = (source: string, start: number, depth: number): number => {
      let offset = start + 1;
      body += "<";
      while (offset < source.length && Option.isNone(opened.refusal)) {
        const char = source[offset];
        if (char === ">") {
          body += ">";

          return offset + 1;
        }

        if (char === '"' || char === "'") {
          body += char;
          offset += 1;
          while (
            offset < source.length &&
            source[offset] !== char &&
            Option.isNone(opened.refusal)
          ) {
            const reference =
              source[offset] === "&"
                ? declaredReferenceAt(source, offset, entities)
                : Option.none();
            if (Option.isSome(reference)) {
              const { name, replacement } = reference.value;
              if (open(replacement.length, depth + 1, name)) {
                body += expandAttribute(replacement, depth + 1);
              }

              offset = reference.value.end;
            } else {
              body += source[offset];
              offset += 1;
            }
          }
          if (offset < source.length) {
            body += char;
            offset += 1;
          }
        } else {
          body += char;
          offset += 1;
        }
      }

      return offset;
    };

    const scanContent = (source: string, depth: number): void => {
      let offset = 0;
      while (offset < source.length && Option.isNone(opened.refusal)) {
        const hidden = hiddenEnd(source, offset);
        if (hidden > offset) {
          body += source.slice(offset, hidden);
          offset = hidden;
        } else if (source[offset] === "<") {
          offset = scanTag(source, offset, depth);
        } else if (source[offset] === "&") {
          const reference = declaredReferenceAt(source, offset, entities);
          if (Option.isSome(reference)) {
            const { name, replacement } = reference.value;
            if (open(replacement.length, depth + 1, name)) {
              scanContent(replacement, depth + 1);
            }

            offset = reference.value.end;
          } else {
            body += "&";
            offset += 1;
          }
        } else {
          const next = source.slice(offset).search(/[<&]/u);
          const end = next === -1 ? source.length : offset + next;
          body += source.slice(offset, end);
          offset = end;
        }
      }
    };

    scanContent(text.slice(bodyStart), 0);

    if (Option.isSome(opened.refusal)) {
      return Effect.fail(opened.refusal.value);
    }

    return Effect.succeed(body);
  });
