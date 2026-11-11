/**
 * The one mapping between QTI values and form entries: the name each response posts under, the
 * entries a value encodes to, the value posted entries decode to, and which posted entries belong
 * to this item instance.
 *
 * Entries carry QTI's lexical forms, so a value's form is {@link format}'s and its reading is
 * {@link parseLexical}'s, with the allowances a posted form needs: a number is trimmed, and a
 * string's line breaks are a textarea's. A record posts the text it was typed as, and its other
 * fields are read from that text.
 *
 * @module
 */
import { Array, Data, Option, Result } from "effect";
import { format, isRecordValue, parseLexical, trimXmlSpace } from "#plate/model/values.ts";
import type {
  RecordField,
  RecordValue,
  ResponseValue,
  Single,
  Value,
} from "#plate/model/values.ts";

/**
 * One posted form entry, as `FormData` holds it: a name and a string or file value.
 */
export type Entry = readonly [name: string, value: string | Blob];

/**
 * The base types a phase-1 interaction posts: Choice's `identifier`, and Text Entry's and
 * Extended Text's `string`, `integer` and `float`.
 */
const postedBaseTypes = ["identifier", "string", "integer", "float"] as const;

/**
 * A base type a phase-1 interaction posts.
 */
export type PostedBaseType = (typeof postedBaseTypes)[number];

/**
 * Report whether a phase-1 interaction can post values of a base type.
 *
 * @param baseType A declaration's base type.
 * @returns Whether `baseType` is a {@link PostedBaseType}.
 */
export const isPosted = (baseType: string): baseType is PostedBaseType =>
  postedBaseTypes.some((name) => name === baseType);

/**
 * How a response of a base type travels through the form: the entry name it posts under, from
 * {@link entryName}, and the base type and cardinality of its declaration.
 */
export interface ValueBinding {
  readonly baseType: PostedBaseType;
  readonly cardinality: Value["cardinality"];
  readonly name: string;
}

/**
 * How a record response travels through the form: the entry name it posts under, from
 * {@link entryName}. A record has no base type of its own, and its one posted entry is its text.
 */
export interface RecordBinding {
  readonly cardinality: "record";
  readonly name: string;
}

/**
 * How one response travels through the form: a {@link ValueBinding} for a response of a base type,
 * or a {@link RecordBinding} for a record response.
 */
export type Binding = ValueBinding | RecordBinding;

/**
 * Settings for {@link decode}.
 */
export interface DecodeOptions {
  /**
   * The number base an integer is written in, Text Entry's `base`, an integer from 2 to 36; 10
   * when absent. In any other base no text is an integer.
   */
  readonly base?: number;
}

/**
 * Text made only of characters XML 1.0's `Char` production admits: tab, line feed, carriage
 * return, and every code point from U+0020 up except the surrogates, U+FFFE and U+FFFF. Under the
 * `u` flag a lone surrogate is a code point of its own, so it falls outside.
 */
const xmlText = /^[\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]*$/u;

/**
 * Report whether XML can carry a text: whether every character of it is one XML 1.0's `Char`
 * production admits, so no document that holds it, as text or in an attribute, is ill-formed.
 *
 * A posted value, a stored value and a result's attributes are all written into XML in the end,
 * a result through crust's writer, which does not refuse the others, so `decode`, the value codec
 * and `results` check each with this on its way in.
 *
 * @example
 *   isXmlText("a\tb\n"); // true
 *   isXmlText("a\u0000b"); // false
 *
 * @param text The text.
 * @returns Whether every character is an XML `Char`: no control character other than tab, line
 *   feed and carriage return, no U+FFFE or U+FFFF, and no lone surrogate.
 * @see https://www.w3.org/TR/xml/#NT-Char
 */
export const isXmlText = (text: string): boolean => xmlText.test(text);

/**
 * Why posted entries do not decode to a value of their binding.
 */
type MalformedReason = "character" | "file" | "identifier" | "number" | "single-many";

/**
 * What each {@link MalformedReason} asks the poster to change.
 */
const remedies = {
  character:
    "holds a character XML cannot carry: a control character other than tab, line feed and carriage return, U+FFFE, U+FFFF or a lone surrogate; post the text without it",
  file: "is a file, but this response takes text; post text, not a file",
  identifier:
    "is not an identifier; post a choice's identifier, an NCName such as choiceA, as the form gives it",
  number:
    "is not a number; post digits in the interaction's base with an optional sign, or a finite decimal such as 2.5 or 1E3",
  "single-many": "was posted more than once, but its response takes one value; post it once",
} satisfies Record<MalformedReason, string>;

/**
 * The failure of decoding posted entries: they are not a value of their binding, for the reason
 * given.
 *
 * `entry` is the binding's entry name, and `reason` is the first of {@link decode}'s refusals the
 * entries meet.
 */
export class Malformed extends Data.TaggedError("Malformed")<{
  readonly entry: string;
  readonly reason: MalformedReason;
}> {
  /**
   * The entry name and what to post instead, in one line.
   */
  override get message(): string {
    return `The form entry ${JSON.stringify(this.entry)} ${remedies[this.reason]}.`;
  }
}

/**
 * The requirements an instance token meets, in the order {@link checkInstance} checks them.
 *
 * - `non-empty`: it holds at least one character.
 * - `characters`: every character is an ASCII letter, a digit, `_`, `.`, `:` or `-`, which an `id`,
 *   an IDREFS list and a form entry name all take, and none of which is whitespace.
 * - `id-boundary`: it does not end in `-` and holds no `--`. The renderer's ids are
 *   `<instance>-<segment>-…` (`scopedId`) and an authored id is `<instance>--<id>` (`authoredId`),
 *   so a token that broke this would let one instance's part id equal another's authored id: `ab-`
 *   with `status` and `ab` with an authored `status` both give `ab--status`.
 */
export const instanceRequirements = ["non-empty", "characters", "id-boundary"] as const;

/**
 * A requirement an instance token meets: one of {@link instanceRequirements}.
 */
export type InstanceRequirement = (typeof instanceRequirements)[number];

/**
 * The characters an instance token is made of: ASCII letters, digits, `_`, `.`, `:` and `-`.
 */
const tokenCharacters = /^[\w.:-]*$/u;

/**
 * Whether a token meets each requirement, one check per requirement.
 */
const meets: Readonly<Record<InstanceRequirement, (token: string) => boolean>> = {
  characters: (token) => tokenCharacters.test(token),
  "id-boundary": (token) => !token.endsWith("-") && !token.includes("--"),
  "non-empty": (token) => token !== "",
};

/**
 * Check an instance token: an opaque token, unique per page, that scopes an item instance's ids
 * and entry names.
 *
 * A lowercase UUID passes, as do React's `useId()` forms `_r_1_` (React 19.2 and later) and `:r1:`
 * (React 18 and 19.0); React 19.1's `«r1»` does not, so its caller passes a token of their own.
 *
 * Two tokens that each pass can still collide when one extends the other after a `.` or `-`, such
 * as `a` and `a.b`: an id joins the token to a response identifier with `-`, an entry name joins
 * them with `.`, and an identifier may itself hold both, so instance `a` with response `b.X` posts
 * under the same name as instance `a.b` with response `X`. Unique tokens of one length, such as
 * UUIDs, never do.
 *
 * @example
 *   checkInstance("_r_1_"); // Option.none()
 *   checkInstance("ab-"); // Option.some("id-boundary")
 *
 * @param token The token an author passes as the instance.
 * @returns The first of {@link instanceRequirements} the token breaks, or none when it meets them
 *   all.
 */
export const checkInstance = (token: string): Option.Option<InstanceRequirement> =>
  Array.findFirst(instanceRequirements, (requirement) => !meets[requirement](token));

/**
 * Name the form entry a response posts under in one item instance.
 *
 * The OD-2 placeholder: changing the wire name is this one edit.
 *
 * @param instance The item instance token, one {@link checkInstance} passes, such as a lowercase
 *   UUID.
 * @param response The response declaration's identifier.
 * @returns `<instance>.<response>`.
 */
export const entryName = (instance: string, response: string): string => `${instance}.${response}`;

/**
 * Give the text a record was typed as: its `stringValue` field, which {@link encode} posts for the
 * record and the text control bound to it shows and checks.
 *
 * @param record The record.
 * @returns Its `stringValue`, or none when it has no such field, as the NULL record has none.
 */
export const recordText = (record: RecordValue): readonly Single[] =>
  record.fields.flatMap(({ identifier, value }) => (identifier === "stringValue" ? [value] : []));

/**
 * Encode a value as the entries a form posts for it.
 *
 * A record posts its `stringValue` field ({@link recordText}), the text {@link decode} reads every
 * other field from, so a record decoded from a post encodes back to that post.
 *
 * @param value The response's value.
 * @param binding The response's binding, which names the entries.
 * @returns No entries for NULL, one for a `single`, one for each value of a `multiple` or
 *   `ordered`, in order, and for a record one for its `stringValue` field, none when it has none,
 *   all under the binding's name and in {@link format}'s lexical form.
 */
export const encode = (value: ResponseValue, binding: Binding): readonly Entry[] => {
  const singles = isRecordValue(value) ? recordText(value) : value.values;

  return singles.map((single) => [binding.name, format(single)]);
};

/**
 * The prefix `BigInt` takes to read a magnitude in each base it reads.
 */
const bigIntPrefixes: ReadonlyMap<number, string> = new Map([
  [2, "0b"],
  [8, "0o"],
  [10, ""],
  [16, "0x"],
]);

/**
 * The most digits {@link readByHalves} folds as a float: 36^10 − 1 is below 2^53, so the fold is
 * exact in every base up to 36.
 */
const leafLength = 10;

/**
 * Read the magnitude of digits in a base `BigInt` does not read, by halves: the high half times
 * the base to the length of the low half, plus the low half.
 *
 * The time is subquadratic in the number of digits, because each level of halving does a few
 * multiplications of its own size, and the powers of the base it needs are computed once. A
 * per-digit `total * base + digit` loop over bigints is quadratic: it took 433 ms on 100,000 base-7
 * digits.
 *
 * @param digits The value of each digit, most significant first, each below `base`.
 * @param base The number base, from 2 to 36.
 * @returns The magnitude the digits name.
 */
const readByHalves = (digits: readonly number[], base: number): bigint => {
  const radix = BigInt(base);
  const powers = new Map<number, bigint>();
  const power = (exponent: number): bigint => {
    const known = powers.get(exponent) ?? radix ** BigInt(exponent);
    powers.set(exponent, known);

    return known;
  };

  const read = (start: number, end: number): bigint => {
    if (end - start <= leafLength) {
      let total = 0;
      for (const digit of digits.slice(start, end)) {
        total = total * base + digit;
      }

      return BigInt(total);
    }

    const middle = start + Math.ceil((end - start) / 2);

    return read(start, middle) * power(end - middle) + read(middle, end);
  };

  return read(0, digits.length);
};

/**
 * Read a posted integer in a base, exactly and at any size: an optional sign, then one or more
 * ASCII digits below the base, where `a` to `z` in either case are the digits from 10.
 *
 * Bases 2, 8, 10 and 16 are read by `BigInt`, and every other base by {@link readByHalves}.
 * `BigInt` reads only digits this check has admitted, so it never throws.
 *
 * @param text The trimmed text.
 * @param base The number base.
 * @returns The integer, or none when the base is not an integer from 2 to 36, there are no digits,
 *   or a digit is outside the base.
 */
const readInteger = (text: string, base: number): Option.Option<bigint> => {
  const sign = text.startsWith("-") || text.startsWith("+") ? text.slice(0, 1) : "";
  const digits = text.slice(sign.length);
  const values = Array.fromIterable(digits).map((digit) => Number.parseInt(digit, 36));
  const inBase = values.every((value) => value < base);
  if (!Number.isInteger(base) || base < 2 || base > 36 || digits === "" || !inBase) {
    return Option.none();
  }

  const prefix = bigIntPrefixes.get(base);
  const magnitude = prefix === undefined ? readByHalves(values, base) : BigInt(prefix + digits);

  return Option.some(sign === "-" ? -magnitude : magnitude);
};

/**
 * Give the reason a posted number is refused, whichever step refuses it.
 *
 * @returns `number`.
 */
const notANumber = (): MalformedReason => "number";

/**
 * Read one posted string as a value of a base type.
 *
 * Text holding a character XML cannot carry is refused first, whatever the base type, since the
 * value would end in a result no XML reader reads. Empty text is no value. A number is trimmed
 * first, so blank text is no value too. An integer is read exactly in `base`, then its decimal
 * digits take the value model's one path, so a posted integer is the value the same digits are in
 * content. A float is the value model's reading of the text; it is non-finite only for `INF`,
 * `-INF` and `NaN`, which a posted form refuses.
 *
 * @param baseType The binding's base type.
 * @param text The posted string.
 * @param base The number base of an integer, from 2 to 36.
 * @returns The value, none for empty text, or the reason the text is not a value.
 */
const readPosted = (
  baseType: PostedBaseType,
  text: string,
  base: number,
): Result.Result<Option.Option<Single>, MalformedReason> => {
  if (!isXmlText(text)) {
    return Result.fail("character");
  }

  const lexical = baseType === "integer" || baseType === "float" ? text.trim() : text;
  if (lexical === "") {
    return Result.succeedNone;
  }

  if (baseType === "string") {
    return Result.succeedSome({ baseType, value: lexical.replaceAll(/\r\n?/gu, "\n") });
  }

  if (baseType === "identifier") {
    return parseLexical(baseType, lexical).pipe(
      Result.mapError((): MalformedReason => "identifier"),
      Result.map(Option.some),
    );
  }

  const decimal =
    baseType === "integer" ? Option.map(readInteger(lexical, base), String) : Option.some(lexical);

  return Result.fromOption(decimal, notANumber).pipe(
    Result.flatMap((number) => Result.mapError(parseLexical(baseType, number), notANumber)),
    Result.filterOrFail(
      (single) => single.baseType !== "float" || Number.isFinite(single.value),
      notANumber,
    ),
    Result.map(Option.some),
  );
};

/**
 * A number in a record's text: xs:double's lexical form, as {@link parseLexical} reads a float,
 * without `INF`, `-INF` and `NaN`. An optional sign, the digits before the point, the point and the
 * digits after it when written, and `e` or `E` with the exponent when written; {@link numberFields}
 * also asks for at least one digit before or after the point. Each run of digits ends at a
 * character the next part starts with, so a failed match backtracks in time linear in the text.
 */
const recordNumber =
  /^(?<sign>[+-]?)(?<whole>[0-9]*)(?:\.(?<fraction>[0-9]*))?(?:[Ee](?<exponent>[+-]?[0-9]+))?$/u;

/**
 * A digit other than zero: where a number's significant figures start.
 */
const nonZeroDigit = /[1-9]/u;

/**
 * Construct an integer field of a record.
 *
 * @param identifier The field's identifier.
 * @param value The field's value.
 * @returns The field.
 */
const integerField = (identifier: string, value: bigint): RecordField => ({
  identifier,
  value: { baseType: "integer", value },
});

/**
 * Give the fields a record's text gives when it is a number: `floatValue`, `integerValue`,
 * `leftDigits`, `rightDigits`, `ndp`, `nsf` and `exponent`, in that order (G-R4, pending).
 *
 * The text is trimmed of XML whitespace only, so a no-break space keeps it from being a number.
 * `floatValue` is the value model's reading of a float, so past the largest double it is the
 * largest finite double of its sign. `integerValue` is the exact integer, present only when no
 * fractional digit and no exponent is written (`5.` gives 5). `leftDigits` and `rightDigits` count
 * the digits written before and after the point, leading and trailing zeros included, the sign
 * not. `ndp` is `rightDigits` minus the exponent, and may be negative. `nsf` counts from the first
 * non-zero digit to the last digit written; a zero value has the digits after the point, at least
 * one. `exponent` is present only when written. Every integer is exact at any size, and each count
 * is one scan of the text.
 *
 * @param text The posted text, as posted.
 * @returns The fields, or none when the trimmed text is not a number.
 */
const numberFields = (text: string): readonly RecordField[] => {
  const trimmed = trimXmlSpace(text);
  const parts = recordNumber.exec(trimmed)?.groups;
  const sign = parts?.["sign"] ?? "";
  const whole = parts?.["whole"] ?? "";
  const fraction = parts?.["fraction"] ?? "";
  const written = Option.fromUndefinedOr(parts?.["exponent"]);
  if (whole === "" && fraction === "") {
    return [];
  }

  const exponent = written.pipe(Option.map(BigInt));
  const digits = whole + fraction;
  const first = digits.search(nonZeroDigit);
  const significant = first === -1 ? Math.max(fraction.length, 1) : digits.length - first;
  const isInteger = Option.isNone(written) && fraction === "" && whole !== "";
  const integer = isInteger
    ? Result.getSuccess(parseLexical("integer", sign + whole))
    : Option.none<Single>();
  const float = Result.getSuccess(parseLexical("float", trimmed));

  return [
    ...Option.toArray(float.pipe(Option.map((value) => ({ identifier: "floatValue", value })))),
    ...Option.toArray(integer.pipe(Option.map((value) => ({ identifier: "integerValue", value })))),
    integerField("leftDigits", BigInt(whole.length)),
    integerField("rightDigits", BigInt(fraction.length)),
    integerField("ndp", BigInt(fraction.length) - Option.getOrElse(exponent, () => 0n)),
    integerField("nsf", BigInt(significant)),
    ...Option.toArray(exponent.pipe(Option.map((value) => integerField("exponent", value)))),
  ];
};

/**
 * Read a record from the texts posted for it, at most one (G-R4, pending).
 *
 * Its text is read as a string binding reads one: refused when it holds a character XML cannot
 * carry, NULL when empty, and with CRLF and a lone CR turned into LF. That text is the record's
 * `stringValue`, and {@link numberFields} gives the rest. Text Entry's `base` is never applied.
 *
 * @param texts The posted texts, none or one.
 * @returns The record, NULL (no field) when nothing or empty text was posted, or the reason the
 *   text is refused.
 */
const readRecord = (texts: readonly string[]): Result.Result<RecordValue, MalformedReason> => {
  const [text = ""] = texts;

  return readPosted("string", text, 10).pipe(
    Result.map((stringValue): RecordValue => ({
      cardinality: "record",
      fields: Option.match(stringValue, {
        onNone: () => [],
        onSome: (value) => [{ identifier: "stringValue", value }, ...numberFields(text)],
      }),
    })),
  );
};

/**
 * Read a value of a base type from the texts posted for it.
 *
 * @param texts The posted texts.
 * @param binding The response's binding.
 * @param base The number base of an integer.
 * @returns The value, holding each text that is not empty, in order, or the first reason a text is
 *   refused.
 */
const readValue = (
  texts: readonly string[],
  binding: ValueBinding,
  base: number,
): Result.Result<Value, MalformedReason> =>
  Result.all(texts.map((text) => readPosted(binding.baseType, text, base))).pipe(
    Result.map((values) => ({
      baseType: binding.baseType,
      cardinality: binding.cardinality,
      values: Array.getSomes(values),
    })),
  );

/**
 * Give the texts posted under a binding's name, in order.
 *
 * @param entries The posted entries.
 * @param binding The response's binding.
 * @returns The texts, or `file` when one entry is a file, and `single-many` when a `single` or a
 *   record has more than one.
 */
const postedTexts = (
  entries: readonly Entry[],
  binding: Binding,
): Result.Result<readonly string[], MalformedReason> => {
  const posted = entries.filter(([name]) => name === binding.name).map(([, value]) => value);
  const texts = posted.filter((value): value is string => typeof value === "string");
  if (texts.length < posted.length) {
    return Result.fail("file");
  }

  const takesOne = binding.cardinality === "single" || binding.cardinality === "record";

  return takesOne && texts.length > 1 ? Result.fail("single-many") : Result.succeed(texts);
};

/**
 * Decode posted entries under a binding of either kind, as {@link decode} does.
 *
 * @param entries The posted entries.
 * @param binding The response's binding.
 * @param options The number base of an integer.
 * @returns A record for a record binding, a value of the binding's base type for the other, or
 *   {@link Malformed}.
 */
const decodeResponse = (
  entries: readonly Entry[],
  binding: Binding,
  options: DecodeOptions = {},
): Result.Result<ResponseValue, Malformed> =>
  postedTexts(entries, binding).pipe(
    Result.flatMap((texts): Result.Result<ResponseValue, MalformedReason> =>
      binding.cardinality === "record"
        ? readRecord(texts)
        : readValue(texts, binding, options.base ?? 10),
    ),
    Result.mapError((reason) => new Malformed({ entry: binding.name, reason })),
  );

/**
 * {@link decode}'s signatures: its result follows its binding.
 */
interface Decode {
  /**
   * A value binding's entries decode to a value of its base type and cardinality.
   */
  (
    entries: readonly Entry[],
    binding: ValueBinding,
    options?: DecodeOptions,
  ): Result.Result<Value, Malformed>;
  /**
   * A record binding's entries decode to a record.
   */
  (
    entries: readonly Entry[],
    binding: RecordBinding,
    options?: DecodeOptions,
  ): Result.Result<RecordValue, Malformed>;
  /**
   * A binding of either kind decodes to either kind of value.
   */
  (
    entries: readonly Entry[],
    binding: Binding,
    options?: DecodeOptions,
  ): Result.Result<ResponseValue, Malformed>;
}

/**
 * Decode the entries a form posted as a value of one binding.
 *
 * Only the entries named for the binding are read. Text holding a character outside XML 1.0's
 * `Char` production is refused, so a decoded value is one a result can hold. No entry, or one empty
 * entry, is NULL. A number is trimmed, then read as an integer in `base` or as a decimal with an
 * optional exponent. A posted integer is exact at any size, in every base from 2 to 36, and in a
 * base other than 2, 8, 10 or 16 it is read in time subquadratic in its digits. A posted float
 * follows the value model's lexical rules, as content does, so a decimal beyond the largest double
 * reads as the largest finite double of its sign; only `INF`, `-INF` and `NaN`, which the value
 * model reads as non-finite, are refused. An identifier must be an NCName. A string has CRLF and a
 * lone CR turned into LF, as a textarea's value has, so a value holds LF line breaks only.
 *
 * A record binding reads one text, kept as the record's `stringValue` field with its line breaks
 * made LF, and, when the text trimmed of XML whitespace is a decimal number with an optional
 * exponent, the fields `floatValue`, `integerValue` (only for a whole number with no exponent),
 * `leftDigits`, `rightDigits`, `ndp`, `nsf` and `exponent` (only when written), every integer
 * exact (G-R4, pending). Text that is not such a number, `INF`, `-INF` and `NaN` among it,
 * gives `stringValue` alone; empty text gives a NULL record, with no field. `base` is not applied.
 *
 * @example
 *   decode([["i.R", "1.5e3"]], { cardinality: "record", name: "i.R" });
 *   // A record: stringValue "1.5e3", floatValue 1500, leftDigits 1, rightDigits 1, ndp -2,
 *   // nsf 2, exponent 3.
 *
 * @param entries The posted entries.
 * @param binding The response's binding.
 * @param options The number base of an integer, which a record binding ignores.
 * @returns A value of the binding's base type for a {@link ValueBinding}, a record for a
 *   {@link RecordBinding}, or {@link Malformed}: `file` for a file, `single-many` for two entries
 *   of a `single` or a record, `character` for text holding a character XML cannot carry, and
 *   `number` or `identifier` for text outside the base type's lexical space.
 */
export const decode =
  // SAFETY: decodeResponse gives a record exactly when the binding's cardinality is `record`, which only a RecordBinding has, and a Value of the binding's base type otherwise, which is what each overload states.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SAFETY note above: one body cannot state the overloads to TypeScript, which checks each overload against the body's union result.
  decodeResponse as Decode;

/**
 * Posted entries split by owner.
 */
export interface Partition {
  /**
   * Entries named for this item instance.
   */
  readonly own: readonly Entry[];
  /**
   * Entries named for another item instance.
   */
  readonly foreign: readonly Entry[];
  /**
   * Every other entry: the host's own fields, which the core ignores.
   */
  readonly host: readonly Entry[];
}

/**
 * An entry name another item instance gives when its token is the UUID `render` draws: a UUID, a
 * dot, then the rest of the name.
 */
const drawnInstanceName =
  /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12}\./u;

/**
 * Split posted entries into this instance's, other instances', and the host's.
 *
 * Only a drawn token has a shape, so a UUID is the one other instance this can recognise; another
 * instance with a token of its own posts what reads as host fields here.
 *
 * @param entries The posted entries, in order.
 * @param instance This item instance's token, any that {@link checkInstance} passes.
 * @returns The entries in posted order, by owner: a name beginning `<instance>.` is this
 *   instance's; else a name `<uuid>.<anything>` is a foreign instance's; every other name is a
 *   host field.
 */
export const partition = (entries: readonly Entry[], instance: string): Partition => {
  const prefix = `${instance}.`;
  const owner = ([name]: Entry): keyof Partition => {
    if (name.startsWith(prefix)) {
      return "own";
    }

    return drawnInstanceName.test(name) ? "foreign" : "host";
  };

  return {
    foreign: entries.filter((entry) => owner(entry) === "foreign"),
    host: entries.filter((entry) => owner(entry) === "host"),
    own: entries.filter((entry) => owner(entry) === "own"),
  };
};
