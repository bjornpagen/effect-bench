/* oxlint-disable unicorn/text-encoding-identifier-case -- The XML 1.0 section 4.3.3 label spellings (`UTF-8`, `US-ASCII`) and the closed encoder-class names (`utf8`) are this module's data, not identifiers passed to a Node encoding API. */
import { Option } from "effect";
import { preorder } from "#crust/tour.ts";
import type { Child, XmlDocument } from "#crust/tree.ts";

/**
 * How a label's characters become bytes: `decode-only` marks a label the reader can decode but the
 * writer cannot encode.
 *
 * Each of UTF-16's three Unicode encoding schemes is its own class, because each begins its bytes
 * differently (Unicode 16.0 section 3.10, D96 to D98): `utf16` is the UTF-16 scheme, which an XML
 * document begins with a byte order mark (XML 1.0 section 4.3.3), and `utf16be` and `utf16le` are
 * UTF-16BE and UTF-16LE, which never begin with one, an initial `FE FF` or `FF FE` being the
 * character U+FEFF (RFC 2781 sections 3.3, 4.1 and 4.2).
 */
export type EncoderClass =
  | "utf8"
  | "utf16"
  | "utf16be"
  | "utf16le"
  | "latin1"
  | "ascii"
  | "decode-only";

/**
 * A label's canonical name and encoder class.
 */
export interface LabelClass {
  /**
   * The IANA preferred name for a label in the table, and the label itself, as spelled, for any
   * other label.
   */
  readonly canonical: string;
  readonly class: EncoderClass;
}

/**
 * The labels XML 1.0 section 4.3.3 lets a document declare that this package can both decode and
 * encode, grouped by the IANA name they share.
 *
 * Every other label is `decode-only`: the reader admits it when a `TextDecoder` knows it, and the
 * writer never encodes it.
 */
const groups: readonly {
  readonly aliases: readonly string[];
  readonly canonical: string;
  readonly class: EncoderClass;
}[] = [
  { aliases: [], canonical: "UTF-8", class: "utf8" },
  { aliases: [], canonical: "UTF-16", class: "utf16" },
  { aliases: [], canonical: "UTF-16LE", class: "utf16le" },
  { aliases: [], canonical: "UTF-16BE", class: "utf16be" },
  {
    aliases: [
      "ISO8859-1",
      "ISO_8859-1",
      "latin1",
      "l1",
      "IBM819",
      "CP819",
      "csISOLatin1",
      "iso-ir-100",
    ],
    canonical: "ISO-8859-1",
    class: "latin1",
  },
  {
    aliases: [
      "ASCII",
      "ANSI_X3.4-1968",
      "ANSI_X3.4-1986",
      "ISO646-US",
      "us",
      "IBM367",
      "cp367",
      "csASCII",
    ],
    canonical: "US-ASCII",
    class: "ascii",
  },
];

/**
 * The label table keyed by lower-cased label, because XML 1.0 section 4.3.3 compares encoding names
 * case-insensitively.
 */
const table: ReadonlyMap<string, LabelClass> = new Map(
  groups.flatMap(({ aliases, canonical, class: encoderClass }) =>
    [canonical, ...aliases].map((label) => [
      label.toLowerCase(),
      { canonical, class: encoderClass },
    ]),
  ),
);

/**
 * Classify an XML encoding label by the encoder that can write it.
 *
 * @param label - The label as read from the document, in any letter case.
 * @returns The label's canonical name and encoder class; `decode-only` for a label outside the
 *   table, which `xml/decode.ts` admits only when a `TextDecoder` knows it under that exact name.
 */
export const classify = (label: string): LabelClass =>
  table.get(label.toLowerCase()) ?? { canonical: label, class: "decode-only" };

/**
 * The highest code point each encoder class writes as a single byte, absent for a class with no
 * such limit.
 */
const thresholds: Readonly<Record<EncoderClass, Option.Option<number>>> = {
  ascii: Option.some(0x7f),
  "decode-only": Option.none(),
  latin1: Option.some(0xff),
  utf16: Option.none(),
  utf16be: Option.none(),
  utf16le: Option.none(),
  utf8: Option.none(),
};

/**
 * Give the highest code point an encoder class writes as a single byte.
 *
 * @param cls - The encoder class.
 * @returns U+00FF for `latin1` and U+007F for `ascii`; `None` for a class with no such limit.
 */
export const threshold = (cls: EncoderClass): Option.Option<number> => thresholds[cls];

/**
 * Read the code point of one character of a string's iteration, a lone surrogate counting as one.
 *
 * A string's iterator never yields the empty string, the one input `codePointAt(0)` gives no number
 * for, so an empty `character` is its caller's defect and is thrown as one.
 *
 * @param character - One character, as a string's iterator or a one-character match yields it.
 * @returns Its code point.
 */
export const codePointOf = (character: string): number => {
  const point = character.codePointAt(0);
  if (point === undefined) {
    throw new RangeError("codePointOf reads one character, and was given the empty string.");
  }

  return point;
};

/**
 * Test whether `text` holds a code point above `limit`.
 *
 * @param limit - The highest code point the label's encoder writes as a single byte.
 * @param text - The text to inspect, a lone surrogate counting as one code point.
 * @returns `true` when some code point of `text` exceeds `limit`.
 */
const holdsAbove = (limit: number, text: string): boolean => {
  for (const character of text) {
    if (codePointOf(character) > limit) {
      return true;
    }
  }

  return false;
};

/**
 * Test whether a node's own constructs hold, in a place a character reference cannot reach, a code
 * point above `limit`: comment text, a processing instruction's target or data, an element's name
 * or an attribute's name, or an entity reference's name (a child node, or one inside an
 * attribute's value). An entity reference is written back verbatim as `&name;` and a name cannot be
 * written as a character reference. A node's children are their own nodes.
 *
 * @param limit - The highest code point the label's encoder writes as a single byte.
 * @param node - The node to inspect; text runs are skipped, and an attribute's value is not read
 *   beyond the names of its entity references.
 * @returns `true` when anything the node itself holds that is inspected exceeds `limit`.
 */
const ownHoldsAbove = (limit: number, node: Child): boolean => {
  if (node.kind === "element") {
    return (
      holdsAbove(limit, node.qname) ||
      node.attributes.some(
        (attribute) =>
          holdsAbove(limit, attribute.qname) ||
          attribute.references.some((reference) => holdsAbove(limit, reference.name)),
      )
    );
  }

  if (node.kind === "comment") {
    return holdsAbove(limit, node.text);
  }

  if (node.kind === "pi") {
    return holdsAbove(limit, node.target) || holdsAbove(limit, node.data);
  }

  if (node.kind === "entityRef") {
    return holdsAbove(limit, node.name);
  }

  return false;
};

/**
 * Decide the label an exported document is encoded in, from the label it was read under.
 *
 * The decision is made once, at import, so the encoder never falls back silently: a character it
 * cannot reference in the label it is given is an `EncodeError`. A character above the threshold of
 * `latin1` or `ascii` can be written as a numeric character reference in a text run or an attribute
 * value, but nowhere else, so only comment text, processing-instruction targets and data, element
 * and attribute names, and entity-reference names are inspected. An entity reference is written
 * back as `&name;`, so its name is as unwritable as a comment. The document is visited by its
 * {@link preorder}, so a tree of any depth is inspected without recursion.
 *
 * @param label - The label the document was read under, as read.
 * @param doc - The document whose prolog, root subtree and epilog are inspected.
 * @returns `label` when its class is `utf8` or one of UTF-16's, or is `latin1` or `ascii` and nothing
 *   inspected exceeds the class's threshold; `"UTF-8"` for a `decode-only` label and for a `latin1`
 *   or `ascii` document holding such a character.
 */
export const exportCharset = (label: string, doc: XmlDocument): string => {
  const { class: encoderClass } = classify(label);
  const limit = threshold(encoderClass);

  if (encoderClass === "decode-only") {
    return "UTF-8";
  }

  if (Option.isNone(limit)) {
    return label;
  }

  const holdsAboveLimit = [...doc.prolog, doc.root, ...doc.epilog].some((node) =>
    preorder(node).some((visited) => ownHoldsAbove(limit.value, visited)),
  );

  return holdsAboveLimit ? "UTF-8" : label;
};
