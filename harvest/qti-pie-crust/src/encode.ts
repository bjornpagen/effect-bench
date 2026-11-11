/* oxlint-disable unicorn/prefer-code-point -- The writers need UTF-16 code units, not code points: `codePointAt` joins a surrogate pair into one value, which one unit-wise write cannot carry. */
import { Effect } from "effect";
import type { EncoderClass } from "#crust/charset.ts";
import { classify } from "#crust/charset.ts";
import { EncodeError } from "#crust/errors.ts";
import type { XmlDocument } from "#crust/tree.ts";
import { writeXml } from "#crust/write.ts";

/**
 * Write `text` as one byte per UTF-16 code unit.
 *
 * `writeXml` has already written every code point above the class's threshold as a character
 * reference or failed, so each code unit fits one byte. It walks code units by index: a code point
 * walk would drop the second half of a surrogate pair.
 */
const singleBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }

  return bytes;
};

/**
 * Write `text` as UTF-16 code units in the given byte order.
 *
 * Each code unit is written as it is, so a surrogate pair becomes its two units in that order, and
 * a leading U+FEFF becomes the byte order mark of that order.
 */
const utf16Bytes = (text: string, littleEndian: boolean): Uint8Array => {
  const bytes = new Uint8Array(2 * text.length);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(2 * index, text.charCodeAt(index), littleEndian);
  }

  return bytes;
};

/**
 * The one writer of each encoder class, so a class added to `EncoderClass` is a type error here
 * until it has one.
 *
 * The three UTF-16 classes are the three UTF-16 encoding schemes, each written as it begins
 * (Unicode 16.0 section 3.10, D96 to D98): `utf16` leads with U+FEFF as its byte order mark, which
 * an XML document in UTF-16 "MUST" begin with (XML 1.0 section 4.3.3), and is written
 * little-endian; `utf16be` and `utf16le` write no mark, since "Systems labelling UTF-16BE text MUST
 * NOT prepend a BOM to the text", and likewise UTF-16LE (RFC 2781 section 3.3).
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc2781#section-3.3 | RFC 2781, section 3.3}
 */
const encoders: Record<EncoderClass, (doc: XmlDocument) => Effect.Effect<Uint8Array, EncodeError>> =
  {
    ascii: (doc) => Effect.map(writeXml(doc, { threshold: 0x7f }), singleBytes),
    "decode-only": () =>
      Effect.fail(new EncodeError({ codePoint: 0, threshold: 0, where: "label" })),
    latin1: (doc) => Effect.map(writeXml(doc, { threshold: 0xff }), singleBytes),
    utf16: (doc) => Effect.map(writeXml(doc), (text) => utf16Bytes(`\uFEFF${text}`, true)),
    utf16be: (doc) => Effect.map(writeXml(doc), (text) => utf16Bytes(text, false)),
    utf16le: (doc) => Effect.map(writeXml(doc), (text) => utf16Bytes(text, true)),
    utf8: (doc) => Effect.map(writeXml(doc), (text) => new TextEncoder().encode(text)),
  };

/**
 * Encode a document in the label it is given, and never decide a fallback.
 *
 * The label's encoder class sets the form. `utf8` writes the text through `TextEncoder`, with no
 * byte order mark. `UTF-16` writes `FF FE` and the text little-endian, whatever byte order the
 * document was read in; `UTF-16LE` and `UTF-16BE` write the text in their own order with no mark,
 * each code unit through a `DataView`. `latin1` and `ascii` write each code point above the class's
 * threshold as a numeric character reference, where one is possible, and the text as single bytes.
 * The declaration is written as the document carries it, so a caller that exports under another
 * label sets `declaration.encoding` first: the reader refuses bytes in another encoding than the
 * one their declaration names.
 *
 * @param doc - The tree to encode.
 * @param label - The label to encode in, as `exportCharset` decided it at import.
 * @returns The bytes, or an `EncodeError`: `where: "label"` when the label has no encoder, which
 *   a wrong import decision must surface; otherwise the first construct, in document order, that
 *   holds a code point the label cannot carry and no reference can write.
 */
export const encode = (doc: XmlDocument, label: string): Effect.Effect<Uint8Array, EncodeError> =>
  encoders[classify(label).class](doc);
