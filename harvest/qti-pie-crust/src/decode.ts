/* oxlint-disable unicorn/text-encoding-identifier-case -- The XML 1.0 section 4.3.3 label spellings (`UTF-8`, `UTF-16`) and the closed encoder-class names (`utf8`) are this module's data, not identifiers passed to a Node encoding API. */
import { Effect, Option } from "effect";
import { classify } from "#crust/charset.ts";
import type { EncoderClass } from "#crust/charset.ts";
import { positionOf } from "#crust/dtd.ts";
import { ReaderRefusal } from "#crust/errors.ts";

/**
 * A document's characters and the encoding label it was read under.
 *
 * `label` names the encoding the bytes are in: the declaration's label as the document spelled it,
 * with its letter case, or, for a document that declares none, the encoding its byte order mark or
 * the default gives it. It becomes the tree's `charset`; `text` carries no byte order mark.
 */
export interface Decoded {
  readonly label: string;
  readonly text: string;
}

/**
 * The byte order of a UTF-16 document, named as `TextDecoder` names the encoding.
 */
type Utf16Order = "utf-16be" | "utf-16le";

/**
 * Decodes the bytes after any byte order mark under the label the document is read as.
 */
type BodyDecoder = (body: Uint8Array, label: string) => Effect.Effect<string, ReaderRefusal>;

/**
 * A document's body as the code units its row writes ASCII characters in: one byte each, or two in
 * a UTF-16 byte order.
 */
interface Units {
  /**
   * The code unit at `index`, for an `index` below {@link Units.length}.
   */
  readonly at: (index: number) => number;
  /**
   * How many whole code units the body holds.
   */
  readonly length: number;
  /**
   * The first `count` units as characters; a cut surrogate pair becomes U+FFFD, since the text is
   * only searched for the XML declaration.
   */
  readonly text: (count: number) => string;
}

/**
 * A row of XML 1.0 Appendix F.1's table whose documents a decoder here reads.
 *
 * `signature` is the row's opening bytes, of which the first `mark` are a byte order mark, an
 * encoding signature that is no part of the document's text (XML 1.0 section 4.3.3). `units` reads
 * the body in the code units the row writes ASCII characters in, for its XML declaration.
 * `decoders` holds a decoder for each encoder class whose labels name an encoding of the row, and
 * for no other. `undeclared` is the encoding of a document of the row that declares none: the
 * mark's encoding, or UTF-8 where there is no mark (section 4.3.3). `opening` and `named` word the
 * row in a refusal.
 */
interface Decodable {
  readonly _tag: "Decodable";
  readonly decoders: Partial<Readonly<Record<EncoderClass, BodyDecoder>>>;
  readonly mark: number;
  readonly named: string;
  readonly opening: string;
  readonly signature: readonly number[];
  readonly undeclared: string;
  readonly units: (body: Uint8Array) => Units;
}

/**
 * A row of XML 1.0 Appendix F.1's table whose family no decoder here reads: UCS-4 in any of its
 * four byte orders, with a byte order mark or without, or EBCDIC.
 */
interface Unsupported {
  readonly _tag: "Unsupported";
  readonly family: string;
  readonly signature: readonly number[];
}

/**
 * The XML declaration up to and including its `encoding` pseudo-attribute, matched at the start of
 * the declaration's text (XML 1.0 sections 2.8 and 4.3.3).
 */
const declarationPattern =
  /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*')[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?<quoted>"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*')/u;

/**
 * The code units of `<?xml`, which every XML declaration opens with.
 */
const declarationOpen: readonly number[] = [0x3c, 0x3f, 0x78, 0x6d, 0x6c];

/**
 * How many bytes one `String.fromCodePoint` call takes: a call over a whole large document
 * overflows the call stack.
 */
const latin1Chunk = 0x80_00;

/**
 * Read each byte of `bytes` as the character whose code point is the byte's value.
 */
const latin1Text = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += latin1Chunk) {
    chunks.push(String.fromCodePoint(...bytes.subarray(start, start + latin1Chunk)));
  }

  return chunks.join("");
};

/**
 * Test whether `bytes` begins with `prefix`.
 */
const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);

/**
 * Read `body` one byte per code unit.
 *
 * @param body - The bytes after any byte order mark.
 * @returns The units.
 */
const byteUnits = (body: Uint8Array): Units => {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  return {
    at: (index) => view.getUint8(index),
    length: view.byteLength,
    text: (count) => latin1Text(body.subarray(0, count)),
  };
};

/**
 * Read `body` as UTF-16 code units in `order`.
 *
 * @param body - The bytes after any byte order mark.
 * @param order - The byte order.
 * @returns The units.
 */
const utf16Units = (body: Uint8Array, order: Utf16Order): Units => {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  return {
    at: (index) => view.getUint16(2 * index, order === "utf-16le"),
    length: Math.floor(view.byteLength / 2),
    text: (count) => new TextDecoder(order).decode(body.subarray(0, 2 * count)),
  };
};

/**
 * Read the `encoding` the XML declaration opening a body gives, if one opens it.
 *
 * The declaration's text runs from `<?xml` to its first `?>`, since no character of [23] XMLDecl's
 * values is `?` or `>`. Its white space is unbounded ([3] S), so the run is read however far it
 * reaches, and a body that `<?xml` opens but no `?>` closes is read whole.
 *
 * @param units - The body as its row writes ASCII characters.
 * @returns The label exactly as written; `None` when no declaration opens the body or it gives no
 *   encoding.
 */
const declaredEncoding = (units: Units): Option.Option<string> => {
  if (
    units.length < declarationOpen.length ||
    !declarationOpen.every((unit, index) => units.at(index) === unit)
  ) {
    return Option.none();
  }

  let end = declarationOpen.length;
  while (end < units.length && !(units.at(end - 1) === 0x3f && units.at(end) === 0x3e)) {
    end += 1;
  }

  const quoted = declarationPattern.exec(units.text(end + 1))?.groups?.["quoted"];

  return Option.map(Option.fromUndefinedOr(quoted), (value) => value.slice(1, -1));
};

/**
 * Builds the refusal for bytes the label's decoder could not accept.
 *
 * @param rule - The rule the bytes break.
 * @param detail - What in the input broke it.
 * @param position - Where in the decoded text it broke, or none for the document as a whole.
 * @returns The refusal.
 */
const refuse = (
  rule: ReaderRefusal["rule"],
  detail: string,
  position: ReaderRefusal["position"],
): ReaderRefusal => new ReaderRefusal({ detail, position, rule });

/**
 * Decode `body` with the named `TextDecoder` encoding, failing on any malformed sequence.
 *
 * A `TextDecoder` resolves a name through the WHATWG Encoding Standard's label table, which maps
 * some labels onto a different encoding: `ISO-8859-9` constructs a decoder whose `encoding` is
 * `windows-1254`, which assigns different characters to bytes 0x80 to 0x9F and 0xD0, 0xDD and 0xDE.
 * A decoder whose `encoding` is not the name asked for would read some bytes as characters the
 * author did not write, so it is refused. The byte order mark is the caller's, so the decoder keeps
 * any it meets (`ignoreBOM`), and a second one reaches the parser as U+FEFF.
 *
 * @param name - The `TextDecoder` encoding name, lower-case.
 * @param label - The label as the document spelled it, for the refusal's detail.
 * @param body - The bytes to decode.
 * @returns The decoded text; an `unsupported-encoding` refusal when no decoder serves the name or
 *   the decoder serves another encoding, and a `decode` refusal when the bytes are malformed.
 */
const decodeStrictly = (
  name: string,
  label: string,
  body: Uint8Array,
): Effect.Effect<string, ReaderRefusal> =>
  Effect.gen(function* openAndDecode() {
    const decoder = yield* Effect.try({
      catch: () =>
        refuse(
          "unsupported-encoding",
          `No decoder here recognizes the encoding "${label}". Re-save the document as UTF-8, or declare an encoding this reader can decode.`,
          Option.none(),
        ),
      try: () => new TextDecoder(name, { fatal: true, ignoreBOM: true }),
    });

    if (decoder.encoding !== name) {
      return yield* refuse(
        "unsupported-encoding",
        `The encoding "${label}" is decoded as "${decoder.encoding}" by the decoder that serves that label, so some bytes would read as characters the author did not write. Re-save the document as UTF-8.`,
        Option.none(),
      );
    }

    return yield* Effect.try({
      catch: () =>
        refuse(
          "decode",
          `The document is read as ${label}, but its bytes are not valid in that encoding. Fix the bytes that are not valid ${label}, or re-save the document as UTF-8.`,
          Option.none(),
        ),
      try: () => decoder.decode(body),
    });
  });

/**
 * The decoder of each encoder class whose encodings write each ASCII character as the one byte of
 * its value.
 *
 * `latin1` reads each byte as the code point of the same value through `String.fromCodePoint`,
 * never through a `TextDecoder`: the WHATWG table maps `ISO-8859-1` to `windows-1252`, which turns
 * bytes 0x80 to 0x9F into printable characters where ISO-8859-1 and XML 1.0 section 4.3.3 give the
 * C1 controls U+0080 to U+009F. `ascii` admits only bytes below 0x80 and then reads them the same
 * way; it refuses the first byte at or above 0x80 at its line and column in the bytes before it,
 * which are all ASCII and so read as text. A `decode-only` label goes to `TextDecoder` under its
 * own name.
 */
const asciiDecoders: Readonly<Record<"ascii" | "decode-only" | "latin1" | "utf8", BodyDecoder>> = {
  ascii: (body, label) => {
    const byte = body.find((value) => value >= 0x80);

    if (byte === undefined) {
      return Effect.succeed(latin1Text(body));
    }

    const offset = body.indexOf(byte);
    const before = latin1Text(body.subarray(0, offset));

    return Effect.fail(
      refuse(
        "decode",
        `The document is read as ${label}, which holds only bytes below 0x80, but the byte at offset ${offset} is 0x${byte.toString(16).toUpperCase()}. Re-save the document as UTF-8, or declare the encoding it was written in.`,
        Option.some(positionOf(before, before.length)),
      ),
    );
  },
  "decode-only": (body, label) => decodeStrictly(label.toLowerCase(), label, body),
  latin1: (body) => Effect.succeed(latin1Text(body)),
  utf8: (body, label) => decodeStrictly("utf-8", label, body),
};

/**
 * Build the decoder of UTF-16 bytes in `order`.
 *
 * @param order - The byte order the row's opening bytes give.
 * @returns The decoder.
 */
const utf16Decoder =
  (order: Utf16Order): BodyDecoder =>
  (body, label) =>
    decodeStrictly(order, label, body);

/**
 * A row of XML 1.0 Appendix F.1's table, one a decoder here reads or one none does.
 */
export type Row = Decodable | Unsupported;

/**
 * Build a row of a family no decoder here reads.
 *
 * @param signature - The row's opening bytes.
 * @param family - The family, worded for the refusal.
 * @returns The row.
 */
const unsupported = (signature: readonly number[], family: string): Unsupported => ({
  _tag: "Unsupported",
  family,
  signature,
});

/**
 * XML 1.0 Appendix F.1's table, every row but its last, in the order the rows are tried: a
 * document is in the first row whose signature opens it, else in {@link asciiRow}.
 *
 * The UCS-4 marks come before the UTF-16 ones, because the table's UTF-16 rows are `FE FF ## ##`
 * and `FF FE ## ##`, two `##` never both `00`. A byte order mark is UTF-16 under the one label
 * `UTF-16`, which "MUST" begin with one (XML 1.0 section 4.3.3); `<?` in UTF-16 with no mark is
 * UTF-16BE or UTF-16LE in its own order, whose bytes never open with a mark (Unicode 16.0 section
 * 3.10, D96 and D97; RFC 2781 sections 4.1 and 4.2).
 *
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#sec-guessing-no-ext-info | XML 1.0 (Fifth Edition), Appendix F.1}
 * @see {@link https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-3/ | Unicode 16.0, section 3.10}
 * @see {@link https://www.rfc-editor.org/rfc/rfc2781#section-4 | RFC 2781, section 4}
 */
export const appendixRows: readonly Row[] = [
  unsupported([0x00, 0x00, 0xfe, 0xff], "UCS-4 in big-endian (1234) order with a byte order mark"),
  unsupported(
    [0xff, 0xfe, 0x00, 0x00],
    "UCS-4 in little-endian (4321) order with a byte order mark",
  ),
  unsupported([0x00, 0x00, 0xff, 0xfe], "UCS-4 in the 2143 octet order with a byte order mark"),
  unsupported([0xfe, 0xff, 0x00, 0x00], "UCS-4 in the 3412 octet order with a byte order mark"),
  {
    _tag: "Decodable",
    decoders: { utf16: utf16Decoder("utf-16be") },
    mark: 2,
    named: "UTF-16",
    opening: "the UTF-16 byte order mark FE FF",
    signature: [0xfe, 0xff],
    undeclared: "UTF-16",
    units: (body) => utf16Units(body, "utf-16be"),
  },
  {
    _tag: "Decodable",
    decoders: { utf16: utf16Decoder("utf-16le") },
    mark: 2,
    named: "UTF-16",
    opening: "the UTF-16 byte order mark FF FE",
    signature: [0xff, 0xfe],
    undeclared: "UTF-16",
    units: (body) => utf16Units(body, "utf-16le"),
  },
  {
    _tag: "Decodable",
    decoders: { utf8: asciiDecoders.utf8 },
    mark: 3,
    named: "UTF-8",
    opening: "the UTF-8 byte order mark EF BB BF",
    signature: [0xef, 0xbb, 0xbf],
    undeclared: "UTF-8",
    units: byteUnits,
  },
  unsupported([0x00, 0x00, 0x00, 0x3c], "UCS-4 in big-endian (1234) order"),
  unsupported([0x3c, 0x00, 0x00, 0x00], "UCS-4 in little-endian (4321) order"),
  unsupported([0x00, 0x00, 0x3c, 0x00], "UCS-4 in the 2143 octet order"),
  unsupported([0x00, 0x3c, 0x00, 0x00], "UCS-4 in the 3412 octet order"),
  {
    _tag: "Decodable",
    decoders: { utf16be: utf16Decoder("utf-16be") },
    mark: 0,
    named: "UTF-16BE",
    opening: "<? in big-endian UTF-16 with no byte order mark (00 3C 00 3F)",
    signature: [0x00, 0x3c, 0x00, 0x3f],
    undeclared: "UTF-8",
    units: (body) => utf16Units(body, "utf-16be"),
  },
  {
    _tag: "Decodable",
    decoders: { utf16le: utf16Decoder("utf-16le") },
    mark: 0,
    named: "UTF-16LE",
    opening: "<? in little-endian UTF-16 with no byte order mark (3C 00 3F 00)",
    signature: [0x3c, 0x00, 0x3f, 0x00],
    undeclared: "UTF-8",
    units: (body) => utf16Units(body, "utf-16le"),
  },
  unsupported([0x4c, 0x6f, 0xa7, 0x94], "EBCDIC"),
];

/**
 * The last row of XML 1.0 Appendix F.1's table, which every document {@link appendixRows} does not
 * take is in: both the table's `3C 3F 78 6D` (an encoding that writes ASCII as single bytes, which
 * the declaration names) and its "Other" (UTF-8 without an encoding declaration). Either is read
 * one byte per code unit, and a declaration, if one opens the document, names its encoding.
 */
const asciiRow: Decodable = {
  _tag: "Decodable",
  decoders: asciiDecoders,
  mark: 0,
  named: "an encoding that writes ASCII as single bytes, such as UTF-8",
  opening: "bytes of an encoding that writes ASCII as single bytes",
  signature: [],
  undeclared: "UTF-8",
  units: byteUnits,
};

/**
 * Builds the refusal for a document whose label names an encoding its opening bytes rule out.
 *
 * @param row - The row the opening bytes put the document in.
 * @param label - The encoding the document is read as.
 * @param declared - Whether its declaration names `label`, rather than the default giving it.
 * @returns The refusal, under rule `encoding-mismatch`.
 */
const mismatch = (row: Decodable, label: string, declared: boolean): ReaderRefusal =>
  refuse(
    "encoding-mismatch",
    `The document begins with ${row.opening}, which only ${row.named} begins with (XML 1.0 Appendix F), but ${declared ? `its declaration names ${label}` : `it declares no encoding, which makes it ${label} (XML 1.0 section 4.3.3)`}. Declare the encoding the bytes are in, or re-save the document in ${label}.`,
    Option.none(),
  );

/**
 * Decode a document's body under the label it is read as, refusing a label its row rules out.
 *
 * @param row - The row the opening bytes put the document in.
 * @param body - The bytes after any byte order mark.
 * @returns The label and the text; an `encoding-mismatch` refusal for a label the row has no
 *   decoder for, an `unsupported-encoding` refusal for a label no decoder serves faithfully, or a
 *   `decode` refusal for bytes not valid in the label.
 */
const decodeRow = (row: Decodable, body: Uint8Array): Effect.Effect<Decoded, ReaderRefusal> => {
  const declared = declaredEncoding(row.units(body));
  const label = Option.getOrElse(declared, () => row.undeclared);
  const decoder = row.decoders[classify(label).class];

  return decoder === undefined
    ? Effect.fail(mismatch(row, label, Option.isSome(declared)))
    : Effect.map(decoder(body, label), (text) => ({ label, text }));
};

/**
 * Refuse decoded text that holds U+0000, which XML 1.0 section 2.2 allows nowhere in a document.
 *
 * The decoded text holds no unpaired surrogate, the other code point section 2.2 leaves out, so
 * nothing here looks for one. Every decoder above emits scalar values only:
 *
 * - `latin1` and `ascii` map a byte to U+0000 to U+00FF;
 * - Every other decoder is a fatal `TextDecoder`. The WHATWG Encoding Standard's decoders produce no
 *   surrogate (§4.1, process an item: "result does not contain any surrogates"). The UTF-8 decoder
 *   errs on the bytes of one (§8.1.1: after 0xED the upper boundary is 0x9F). The shared UTF-16
 *   decoder errs on a leading surrogate that no trailing one follows, and on a lone trailing one
 *   (§14.2.1, steps 6.7 and 8). In fatal mode an error refuses the document as `decode`.
 *
 * `decode.test.ts` holds this to every lone surrogate.
 *
 * @param decoded - The label and the decoded text.
 * @returns `decoded` itself; a `nul` refusal naming the first U+0000's offset, positioned at its
 *   line and column in the decoded text.
 * @see {@link https://encoding.spec.whatwg.org/#concept-encoding-process | Encoding Standard, process an item}
 */
const requireXmlCharacters = (decoded: Decoded): Effect.Effect<Decoded, ReaderRefusal> => {
  const offset = decoded.text.indexOf("\0");

  return offset === -1
    ? Effect.succeed(decoded)
    : Effect.fail(
        refuse(
          "nul",
          `The decoded text holds U+0000 at offset ${offset}, a character XML 1.0 forbids anywhere in a document. Remove it from the source.`,
          Option.some(positionOf(decoded.text, offset)),
        ),
      );
};

/**
 * Build the decoder of a table of XML 1.0 Appendix F.1's rows: the rows tried in order, then
 * {@link asciiRow}. {@link decode} is the decoder of {@link appendixRows}; a test builds one of a
 * table it has changed, a past defect kept as data, and shows its search tells the two apart.
 *
 * @param table - The rows, in the order they are tried.
 * @returns The decoder, as {@link decode} describes it for its own table.
 */
export const decodeBy = (table: readonly Row[]) =>
  Effect.fn("xml.decode")(function* decode(
    bytes: Uint8Array,
  ): Effect.fn.Return<Decoded, ReaderRefusal> {
    const row = table.find(({ signature }) => startsWith(bytes, signature)) ?? asciiRow;
    if (row._tag === "Unsupported") {
      return yield* refuse(
        "unsupported-encoding",
        `The document begins with the bytes of ${row.family} (XML 1.0 Appendix F), an encoding this reader cannot decode. Re-save the document as UTF-8.`,
        Option.none(),
      );
    }

    return yield* decodeRow(row, bytes.subarray(row.mark)).pipe(
      Effect.flatMap(requireXmlCharacters),
    );
  });

/**
 * Turn a document's bytes into its text, refusing whatever cannot be decoded faithfully.
 *
 * The opening bytes put the document in a row of XML 1.0 Appendix F.1's table ({@link
 * appendixRows}), and the row's code units read its XML declaration, however long. The label the
 * document is read as is the declaration's `encoding`, else the row's `undeclared`: a byte order
 * mark's encoding, or UTF-8. The label must name an encoding of the row, because section 4.3.3
 * makes it a fatal error "for an entity including an encoding declaration to be presented to the
 * XML processor in an encoding other than that named in the declaration, or for an entity which
 * begins with neither a Byte Order Mark nor an encoding declaration to use an encoding other than
 * UTF-8", and the Appendix's note has the name checked even where the opening bytes settle the
 * encoding. The body is then decoded with every error fatal, so no byte is ever replaced with
 * U+FFFD, and must hold no U+0000.
 *
 * @param bytes - The document as read from storage.
 * @returns The text, without its byte order mark, and the label it was read as, which becomes the
 *   tree's `charset`; a `ReaderRefusal` whose rule is `encoding-mismatch` for a label the opening
 *   bytes rule out, `unsupported-encoding` for UCS-4, EBCDIC or a label the reader cannot decode
 *   faithfully, `decode` for bytes that are not valid in the label, and `nul` for text that holds
 *   U+0000, which XML 1.0 forbids.
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#charencoding | XML 1.0 (Fifth Edition), section 4.3.3}
 */
export const decode = decodeBy(appendixRows);
