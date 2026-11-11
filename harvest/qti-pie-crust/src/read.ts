import { Effect, Option, Result } from "effect";
import { SaxesParser } from "saxes";
import { decode } from "#crust/decode.ts";
import type { Decoded } from "#crust/decode.ts";
import { PREDEFINED, lexProlog, positionOf, substitute, undeclaredEntity } from "#crust/dtd.ts";
import type { AttlistEntry, Prolog, ValuePiece } from "#crust/dtd.ts";
import { ReaderRefusal, WellFormednessError } from "#crust/errors.ts";
import { NAME_CHAR, NAME_START, isNCName, productionViolation } from "#crust/names.ts";
import { namespacesVersionOf, resolved, rootScope } from "#crust/namespaces.ts";
import type { Scope } from "#crust/namespaces.ts";
import { rebuild } from "#crust/rebuild.ts";
import { SENTINEL_FIRST, SENTINEL_LAST, sentinelsWritten } from "#crust/sentinels.ts";
import type {
  Attribute,
  AttributeReference,
  Child,
  Element,
  EntityRef,
  Misc,
  XmlDocument,
} from "#crust/tree.ts";

/**
 * Where the parser stood when it had read an element's start tag: the line and column it reports.
 */
interface StartTag {
  readonly column: number;
  readonly line: number;
}

/**
 * An element whose start tag has been read and whose end tag has not: its attributes as written,
 * its names unresolved, and where its start tag ended.
 */
interface OpenElement {
  readonly attributes: readonly Attribute[];
  readonly children: Child[];
  readonly qname: string;
  readonly start: StartTag;
}

/**
 * What `parse` builds: the root element and the comments and processing instructions around it,
 * and where each element's start tag ended. The tree's names are unresolved: each element and
 * attribute holds its name as written as its local name, in no namespace and with no prefix, until
 * {@link assemble} resolves them after the attribute-list defaults are added.
 */
interface Built {
  readonly epilog: readonly Misc[];
  readonly prolog: readonly Misc[];
  readonly root: Element;
  readonly starts: ReadonlyMap<Element, StartTag>;
}

/**
 * What the undeclared-reference scan stops at, in document order: a comment, a processing
 * instruction or a CDATA section (skipped whole), a character reference (its value group), or a
 * general entity reference (its name group).
 */
const SCAN = new RegExp(
  String.raw`<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|&#(?:x(?<hex>[0-9A-Fa-f]+)|(?<decimal>[0-9]+));|&(?<name>[${NAME_START}][${NAME_CHAR}]*);`,
  "gu",
);

/**
 * The undeclared entity names the body references, in order of first use, each with where its first
 * reference stands in the body, and the code points the body already holds in the sentinel range,
 * whether written out or named by a character reference.
 */
interface Scanned {
  /**
   * The first reference whose name is no NCName: where it stands in the body, and how its name
   * breaks the production.
   */
  readonly colon: Option.Option<{ readonly offset: number; readonly violation: string }>;
  readonly names: ReadonlyMap<string, number>;
  readonly used: ReadonlySet<number>;
}

/**
 * Scan the body of `substituted` (everything from `bodyStart`) for references to entities that are
 * neither predefined nor declared.
 */
const scanReferences = (body: string, declared: ReadonlyMap<string, string>): Scanned => {
  const names = new Map<string, number>();
  const used = sentinelsWritten(body);
  let colon: Scanned["colon"] = Option.none();
  for (const match of body.matchAll(SCAN)) {
    const [, hex, decimal, name] = match;
    const violation = name === undefined ? Option.none() : productionViolation(name, "NCName");
    if (Option.isNone(colon) && Option.isSome(violation)) {
      colon = Option.some({ offset: match.index, violation: violation.value });
    }

    if (name !== undefined && !PREDEFINED.has(name) && !declared.has(name)) {
      if (!names.has(name)) {
        names.set(name, match.index);
      }
    } else if (hex !== undefined || decimal !== undefined) {
      used.add(hex === undefined ? Number(decimal) : Number.parseInt(hex, 16));
    }
  }

  return { colon, names, used };
};

/**
 * Give each undeclared entity name in the body a stand-in character, or refuse.
 *
 * A reference whose name holds a colon is refused first, as a well-formedness error at the
 * reference: Namespaces in XML section 7 asks every entity name to be an NCName, and the internal
 * subset declares none that is not (`#crust/dtd.ts`). Then the prolog's {@link Prolog.undeclared}
 * treatment decides, as it decided each attribute default's references: a refused reference is a
 * well-formedness error, refused naming the entity. A kept one may be declared in the external
 * subset, which is never read: the name gets a private use character that occurs nowhere in the
 * body, and the parser appends it as plain text. Either refusal stands at the name's first
 * reference, in `substituted`.
 *
 * @param substituted - The document text with its declared entities substituted.
 * @param prolog - The prolog, for its declared entities and its treatment of undeclared ones.
 * @returns The stand-in character of each name, the map empty when the body has no such
 *   reference; the `WellFormednessError` for a reference whose name holds a colon, or the
 *   `ReaderRefusal` for one the treatment refuses.
 */
const assignSentinels = (
  substituted: string,
  prolog: Prolog,
): Effect.Effect<ReadonlyMap<string, string>, ReaderRefusal | WellFormednessError> =>
  Effect.suspend(
    (): Effect.Effect<ReadonlyMap<string, string>, ReaderRefusal | WellFormednessError> => {
      const scanned = scanReferences(substituted.slice(prolog.bodyStart), prolog.entities);
      if (Option.isSome(scanned.colon)) {
        const { offset, violation } = scanned.colon.value;
        const at = prolog.bodyStart + offset;
        const position = positionOf(substituted, at);

        return Effect.fail(
          new WellFormednessError({
            ...position,
            message: `${String(position.line)}:${String(position.column)}: entity reference: ${violation}.`,
          }),
        );
      }

      const at = (offset: number) =>
        Option.some(positionOf(substituted, prolog.bodyStart + offset));
      const [first] = scanned.names;
      if (first === undefined) {
        return Effect.succeed(new Map<string, string>());
      }

      if (prolog.undeclared._tag === "refused") {
        const [name, offset] = first;

        return Effect.fail(undeclaredEntity(name, prolog.undeclared.why, at(offset)));
      }

      const sentinels = new Map<string, string>();
      let point = SENTINEL_FIRST;
      for (const [name, offset] of scanned.names) {
        while (point <= SENTINEL_LAST && scanned.used.has(point)) {
          point += 1;
        }

        if (point > SENTINEL_LAST) {
          return Effect.fail(
            undeclaredEntity(
              name,
              "the document leaves no private use character free to stand for it",
              at(offset),
            ),
          );
        }

        sentinels.set(name, String.fromCodePoint(point));
        point += 1;
      }

      return Effect.succeed(sentinels);
    },
  );

/**
 * The unresolved tree attribute for one written attribute: its name as written, its value the
 * parser's, with no references.
 */
const toAttribute = ([qname, value]: readonly [string, string]): Attribute => ({
  local: qname,
  namespace: "",
  prefix: "",
  qname,
  references: [],
  value,
});

/**
 * The unresolved tree element for a closed element and the children collected for it.
 */
const toElement = (open: OpenElement): Element => ({
  attributes: open.attributes,
  children: open.children,
  kind: "element",
  local: open.qname,
  namespace: "",
  prefix: "",
  qname: open.qname,
});

/**
 * The most elements a document may hold open at once unless its reader says otherwise: 256, the
 * stated limit "Element depth" of spec reading 1's list. Neither XML 1.0 nor QTI bounds an
 * element's depth (production [39] of section 3 and [43] of section 3.1), no official package
 * comes near it, and the bound keeps the recursive walks over a tree, crust's and plate's, within
 * their stacks. libxml2 2.9.13's `xmllint` bounds depth near it too: it reads 257 open elements
 * and refuses 258 ("Excessive depth in document").
 */
export const defaultElementDepth = 256;

/**
 * How {@link readXml} reads a document.
 */
export interface ReadOptions {
  /**
   * The most elements open at once before the document is refused under rule `element-depth`:
   * {@link defaultElementDepth} when absent, and `Number.POSITIVE_INFINITY` for a document of any
   * depth.
   */
  readonly elementDepth?: number;
}

/**
 * Run `saxes` over `substituted` and build the root element with the comments and processing
 * instructions around it, its names unresolved.
 *
 * `saxes` reads without namespaces: a namespace declaration may come from an attribute-list
 * default, which `saxes` never sees, so every namespace constraint is judged after the defaults are
 * added ({@link assemble}). It throws its first well-formedness error; that error becomes a
 * `WellFormednessError` at the position the parser had reached, as does a processing instruction
 * target holding a colon, which Namespaces in XML section 7 forbids. A document that nests more
 * than `elementDepth` elements is refused with a `ReaderRefusal` under rule `element-depth`. The
 * tree is built on a stack of open elements, so a document of any depth within that bound is read
 * without recursion.
 *
 * @param substituted - The document text with its declared entities substituted.
 * @param sentinels - The stand-in character of each undeclared entity name.
 * @param elementDepth - The most elements open at once.
 * @returns The root element, the comments and processing instructions around it and where each
 *   start tag ended; the `ReaderRefusal` for an element past `elementDepth`, or the
 *   `WellFormednessError` for the first error `saxes` raises.
 */
const parse = (
  substituted: string,
  sentinels: ReadonlyMap<string, string>,
  elementDepth: number,
): Effect.Effect<Built, WellFormednessError | ReaderRefusal> => {
  const parser = new SaxesParser({ position: true });
  for (const [name, sentinel] of sentinels) {
    parser.ENTITIES[name] = sentinel;
  }

  return Effect.try({
    catch: (error) =>
      error instanceof ReaderRefusal
        ? error
        : new WellFormednessError({
            column: parser.column,
            line: parser.line,
            message: error instanceof Error ? error.message : String(error),
          }),
    try: () => {
      const open: OpenElement[] = [];
      const starts = new Map<Element, StartTag>();
      const prolog: Misc[] = [];
      const epilog: Misc[] = [];
      let root: Element | undefined;
      const place = (node: Child & Misc): void => {
        const parent = open.at(-1);
        if (parent === undefined) {
          (root ? epilog : prolog).push(node);
        } else {
          parent.children.push(node);
        }
      };

      parser.on("opentag", (tag) => {
        if (open.length >= elementDepth) {
          throw new ReaderRefusal({
            detail: `The document nests elements more than ${elementDepth} deep: element <${tag.name}> at line ${parser.line}, column ${parser.column} opens past the reader's limit. Flatten the structure so at most ${elementDepth} elements are open at once.`,
            position: Option.some({ column: parser.column, line: parser.line }),
            rule: "element-depth",
          });
        }

        // The attribute record's insertion order is the order the attributes were written in,
        // namespace declarations included.
        open.push({
          attributes: Object.entries(tag.attributes).map(toAttribute),
          children: [],
          qname: tag.name,
          start: { column: parser.column, line: parser.line },
        });
      });
      parser.on("closetag", () => {
        const closed = open.pop();
        if (closed === undefined) {
          return;
        }

        const element = toElement(closed);
        starts.set(element, closed.start);

        const parent = open.at(-1);
        if (parent === undefined) {
          root = element;
        } else {
          parent.children.push(element);
        }
      });
      // `saxes` emits a text event only for text that is not empty: `handleTextInRoot` calls its
      // handler with the run so far only when that run is non-empty, and `end` only when the
      // remaining text is (saxes 6.0.0, saxes.js:1625-1700 and :1822-1825), so no empty run is ever
      // put in the tree.
      parser.on("text", (value) => {
        const parent = open.at(-1);
        const last = parent?.children.at(-1);
        if (parent === undefined) {
          return;
        }

        if (last?.kind === "text" && last.cdata) {
          parent.children.push({ cdata: false, kind: "text", value });
        } else if (last?.kind === "text") {
          parent.children[parent.children.length - 1] = { ...last, value: last.value + value };
        } else {
          parent.children.push({ cdata: false, kind: "text", value });
        }
      });
      parser.on("cdata", (value) => {
        open.at(-1)?.children.push({ cdata: true, kind: "text", value });
      });
      parser.on("comment", (text) => {
        place({ kind: "comment", text });
      });
      parser.on("processinginstruction", ({ body, target }) => {
        if (!isNCName(target)) {
          throw new Error(
            `the processing instruction target ${target} holds a colon, which Namespaces in XML section 7 forbids in every processing instruction target`,
          );
        }

        place({ data: body, kind: "pi", target });
      });
      parser.write(substituted).close();

      if (root === undefined) {
        throw new Error("the document has no root element");
      }

      return { epilog, prolog, root, starts };
    },
  });
};

/**
 * A value's pieces after the second normalization step a non-`CDATA` attribute type adds (XML 1.0
 * section 3.3.3): each run of spaces made one, and a space at either end removed. A reference is
 * no space, so a run ends at one; only U+0020 counts, so a tab or other white space a character
 * reference wrote stays.
 *
 * @param pieces - The value's pieces, text and references alternating.
 * @returns The normalized pieces, text and references still alternating.
 */
const collapsed = (pieces: readonly ValuePiece[]): readonly ValuePiece[] =>
  pieces.flatMap((piece, at): readonly ValuePiece[] => {
    if (piece.kind === "reference") {
      return [piece];
    }

    const spaced = piece.text.replaceAll(/ +/gu, " ");
    const start = at === 0 && spaced.startsWith(" ") ? 1 : 0;
    const end =
      at === pieces.length - 1 && spaced.endsWith(" ") ? spaced.length - 1 : spaced.length;
    const text = spaced.slice(start, Math.max(start, end));

    return text === "" ? [] : [{ kind: "text", text }];
  });

/**
 * Split `value` around its stand-in characters: the text between them, and the reference each
 * stand-in stands for.
 *
 * @param value - Text the parser built, holding a stand-in for each undeclared reference.
 * @param names - The entity name each stand-in character stands for.
 * @returns The pieces, text and references alternating, no text piece empty.
 */
const piecesOf = (value: string, names: ReadonlyMap<string, string>): readonly ValuePiece[] => {
  const pieces: ValuePiece[] = [];
  let run = "";
  for (const character of value) {
    const name = names.get(character);
    if (name === undefined) {
      run += character;
    } else {
      if (run !== "") {
        pieces.push({ kind: "text", text: run });
      }

      pieces.push({ kind: "reference", name });
      run = "";
    }
  }

  if (run !== "") {
    pieces.push({ kind: "text", text: run });
  }

  return pieces;
};

/**
 * Write a value's pieces as an attribute value: text as itself, each reference as `&name;`, with
 * where each reference's `&` lands.
 *
 * @param pieces - The value's pieces.
 * @returns The value and its references, in order.
 */
const attributeValueOf = (
  pieces: readonly ValuePiece[],
): Pick<Attribute, "references" | "value"> => {
  const references: AttributeReference[] = [];
  let value = "";
  for (const piece of pieces) {
    if (piece.kind === "text") {
      value += piece.text;
    } else {
      references.push({ name: piece.name, offset: value.length });
      value += `&${piece.name};`;
    }
  }

  return { references, value };
};

/**
 * Normalize a value's pieces as its declared type asks: as given for `CDATA` or an undeclared
 * attribute, {@link collapsed} for any other type.
 *
 * @param pieces - The value's pieces.
 * @param entry - The attribute's declaration, none where the ATTLIST table has none.
 * @returns The normalized pieces.
 */
const normalizedAs = (
  pieces: readonly ValuePiece[],
  entry: Option.Option<AttlistEntry>,
): readonly ValuePiece[] =>
  Option.exists(entry, ({ type }) => type !== "CDATA") ? collapsed(pieces) : pieces;

/**
 * An element's attributes in the finished tree: each written one with its stand-ins restored as
 * references and its value normalized by its declared type, then each declared default the element
 * lacks, in declaration order, built from the default's own pieces.
 *
 * A default never holds a stand-in: its references are pieces the prolog's lexer kept, and its text
 * is the prolog's, which the body's stand-ins are chosen apart from. So a default is appended after
 * the stand-ins are restored, and no character of its text is read as a reference.
 *
 * @param element - The element as `saxes` built it, its names unresolved.
 * @param table - The ATTLIST table of the element's name, none where the prolog declares none.
 * @param names - The entity name each stand-in character stands for.
 * @returns The attributes, their names unresolved until {@link resolved} resolves them with the
 *   element's.
 */
const attributesOf = (
  element: Element,
  table: Option.Option<ReadonlyMap<string, AttlistEntry>>,
  names: ReadonlyMap<string, string>,
): readonly Attribute[] => {
  const written = element.attributes.map((attribute): Attribute => ({
    ...attribute,
    ...attributeValueOf(
      normalizedAs(
        piecesOf(attribute.value, names),
        table.pipe(
          Option.flatMap((entries) => Option.fromUndefinedOr(entries.get(attribute.qname))),
        ),
      ),
    ),
  }));
  const present = new Set(element.attributes.map((attribute) => attribute.qname));
  const defaulted = Option.toArray(table).flatMap((entries) =>
    [...entries].flatMap(([declared, entry]): readonly Attribute[] =>
      !present.has(declared) && Option.isSome(entry.default)
        ? [
            {
              local: declared,
              namespace: "",
              prefix: "",
              qname: declared,
              ...attributeValueOf(normalizedAs(entry.default.value, Option.some(entry))),
            },
          ]
        : [],
    ),
  );

  return [...written, ...defaulted];
};

/**
 * A text run's nodes once its stand-in characters are restored: the text between them as `Text`
 * runs and each stand-in as an `EntityRef`.
 *
 * @param value - The run's text.
 * @param names - The entity name each stand-in character stands for.
 * @returns The nodes, in order.
 */
const restoredText = (value: string, names: ReadonlyMap<string, string>): readonly Child[] =>
  piecesOf(value, names).map((piece): Child =>
    piece.kind === "text"
      ? { cdata: false, kind: "text", value: piece.text }
      : ({ kind: "entityRef", name: piece.name } satisfies EntityRef),
  );

/**
 * Build the error for a namespace constraint an element breaks, at the position its start tag
 * ended, where `saxes` itself reports a well-formedness error a start tag holds.
 *
 * @param start - Where the element's start tag ended.
 * @param message - What the element breaks.
 * @returns The error.
 */
const violationAt = (start: StartTag, message: string): WellFormednessError =>
  new WellFormednessError({
    column: start.column,
    line: start.line,
    message: `${String(start.line)}:${String(start.column)}: ${message}.`,
  });

/**
 * Read where an element of the built tree ended its start tag. {@link parse} records it for every
 * element it builds, when the element closes, so an element it did not build is its caller's defect
 * and is thrown as one.
 *
 * @param built - The tree `saxes` built.
 * @param element - One of its elements.
 * @returns Where the element's start tag ended.
 */
const startOf = (built: Built, element: Element): StartTag => {
  const start = built.starts.get(element);
  if (start === undefined) {
    throw new Error(
      `The reader's built tree records no start tag for the element <${element.qname}>.`,
    );
  }

  return start;
};

/**
 * Assemble the document from what the earlier stages read and the tree `saxes` built.
 *
 * One walk, without recursion, gives every element its {@link attributesOf}, written and
 * defaulted, then resolves its names and its attributes' against the namespaces in scope, its own
 * declarations, written or defaulted, included ({@link resolved}); and it puts every stand-in
 * character of the content back as the `EntityRef` it stands for.
 *
 * @param decoded - The decoded bytes, for the charset label.
 * @param prolog - The prolog, for its declaration, DOCTYPE and ATTLIST tables.
 * @param built - The root element, the comments and processing instructions around it, and where
 *   each start tag ended.
 * @param names - The entity name each stand-in character stands for.
 * @returns The document; the `WellFormednessError` of the first namespace constraint an element
 *   breaks, in document order.
 */
const assemble = (
  decoded: Decoded,
  prolog: Prolog,
  built: Built,
  names: ReadonlyMap<string, string>,
): Effect.Effect<XmlDocument, WellFormednessError> => {
  const namespaces = namespacesVersionOf(
    Option.match(prolog.declaration, {
      onNone: () => "1.0",
      onSome: (declaration) => declaration.version,
    }),
  );
  const root = rebuild<Scope, WellFormednessError>(
    built.root,
    rootScope,
    (element, scope) =>
      Result.mapError(
        resolved(
          {
            ...element,
            attributes: attributesOf(
              element,
              Option.fromUndefinedOr(prolog.attlists.get(element.qname)),
              names,
            ),
          },
          scope,
          namespaces,
        ),
        (message) => violationAt(startOf(built, element), message),
      ),
    (leaf) =>
      Result.succeed(
        leaf.kind === "text" && !leaf.cdata && names.size > 0
          ? restoredText(leaf.value, names)
          : [leaf],
      ),
  );

  return Result.match(root, {
    onFailure: (error) => Effect.fail(error),
    onSuccess: (resolvedRoot) =>
      Effect.succeed({
        charset: decoded.label,
        declaration: prolog.declaration,
        doctype: prolog.doctype,
        epilog: built.epilog,
        prolog: built.prolog,
        root: resolvedRoot,
      }),
  });
};

/**
 * Read a document's bytes into its tree.
 *
 * The bytes are decoded, the prolog is lexed and the declared entities are substituted into the
 * body, then `saxes` parses the result without namespaces and the tree is built from its events:
 * adjacent text events become one `Text`, a CDATA section stays its own `Text`, and the
 * empty-element form is dropped. The ATTLIST table is then applied: a declared default the element
 * lacks is appended, and a non-`CDATA` attribute value is normalized. Last, every name is resolved
 * against the namespace declarations in scope, defaulted ones included, and each namespace
 * constraint is checked (`#crust/namespaces.ts`).
 *
 * A reference to an entity the document does not declare is refused when the document is
 * `standalone="yes"` or has no external subset. Otherwise each such name is registered with
 * `saxes` as one private use character that the document does not contain, and after the parse each
 * character becomes the reference it stood for: an `EntityRef` in content, `&name;` with a recorded
 * offset in an attribute value.
 *
 * At most `options.elementDepth` elements may be open at once, {@link defaultElementDepth} (256,
 * as in `xmllint`) unless the caller gives another bound; a deeper document is refused under rule
 * `element-depth`. Within the bound, a document of any depth or width is read: the tree is built,
 * and then rewritten, on stacks of its own, never by recursion.
 *
 * @param bytes - The document as read from storage.
 * @param options - How to read it: the element depth it is refused past.
 * @returns The tree; a `ReaderRefusal` from decoding, the prolog, an entity reference or the
 *   element depth, or a `WellFormednessError` whose position is the parser's, or the end of the
 *   start tag of an element that breaks a namespace constraint, in the text with its declared
 *   entities substituted.
 */
export const readXml = Effect.fn("xml.read")(function* readXml(
  bytes: Uint8Array,
  options: ReadOptions = {},
): Effect.fn.Return<XmlDocument, WellFormednessError | ReaderRefusal> {
  const decoded = yield* decode(bytes);
  const prolog = yield* lexProlog(decoded.text);
  const substituted = yield* substitute(decoded.text, prolog);
  const sentinels = yield* assignSentinels(substituted, prolog);
  const built = yield* parse(substituted, sentinels, options.elementDepth ?? defaultElementDepth);
  const names = new Map([...sentinels].map(([name, sentinel]) => [sentinel, name]));

  return yield* assemble(decoded, prolog, built, names);
});
