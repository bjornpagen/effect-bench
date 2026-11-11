/**
 * The printed-value formatter: the text a `qti-printed-variable` writes for a value of the value
 * model ({@link formatPrinted}), through the attribute's `format` when it has one and in a default
 * form when it does not.
 *
 * QTI bases `format` on the C conversion specifiers (ISO 9899) and gives a worked table
 * (`B#format-attribute-of-printed-variable`, Appendix E), but leaves open the default form, the
 * text around a conversion, the base of `index`, an exact tie, a float under an integer conversion,
 * a `base` outside 2 to 36, a negative under `o`, `x` or `X`, an infinity or NaN under an integer
 * conversion, and a width, a precision or a whole text too long to hold. The defaults here are
 * drafted readings, each marked "G-R2, pending" where it is applied. C's `d` prints as `i` does, a
 * conversion after the first prints as written and `%%` prints `%`, as the operator ruled on P1
 * (readings 132 and 161 admit `%%` and any number of conversions, and leave the printing to the
 * renderer). The two size bounds are approved: a text that would pass {@link fieldBound} or
 * {@link textBound} is not printed at all, and {@link formatPrinted} says so, so its caller can fail
 * rather than show a blank slot. A caller may hold a text to a smaller bound, as `redactItem` holds
 * each printed text to what remains of its output budget, and the formatter stops building as soon
 * as the text would pass it. Every float reaches decimal digits through {@link shortestDecimal}, the
 * one approximated step, and is rounded or truncated as that decimal, never as the double's binary
 * expansion, so a page and Node print the same text. A duration prints as a float does, its
 * seconds, `format` applying (G-R3, pending).
 *
 * @module
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Derived_PrintedVariable
 */
import { Option, pipe } from "effect";
import { shortestDecimal } from "#plate/engine/math.ts";
import { format as lexicalForm } from "#plate/model/values.ts";
import type { ModelledBaseType, Single, Value } from "#plate/model/values.ts";

/**
 * The attributes of a `qti-printed-variable` that shape its text, each already resolved: a
 * variable named in `base` or `index` is the caller's to read before the call.
 *
 * - `format`: the conversion specifier, with any text around it; absent, the value prints in its
 *   default form.
 * - `base`: the radix of the `i` and `d` conversions, 10 when absent; a base outside 2 to 36 writes
 *   base 10 (G-R2, pending).
 * - `index`: the member of an `ordered` value to print, counting from 1 (G-R2, pending); absent or
 *   out of range, every member prints. The information model scopes it to `ordered`, so another
 *   cardinality ignores it.
 * - `powerForm`: when true, a float printed with no `format` writes its exponent `e+n` as `x 10 to
 *   the power n`, with an ASCII `x` as the information model writes it (G-R2, pending).
 * - `delimiter`: the text between a container's printed members, `;` when absent.
 * - `mappingIndicator`: the text between a record field's name and value, `=` when absent. No value
 *   of the model is a record until records are modelled, so nothing reads it yet.
 */
export interface PrintOptions {
  readonly format?: string;
  readonly base?: bigint;
  readonly index?: bigint;
  readonly powerForm?: boolean;
  readonly delimiter?: string;
  readonly mappingIndicator?: string;
}

/**
 * The base types `format` applies to: QTI's numerical values, integers and floats, and a
 * duration, whose seconds print as a float's do (G-R3, pending).
 */
const formattedBaseTypes: ReadonlySet<ModelledBaseType> = new Set(["integer", "float", "duration"]);

/**
 * A value `format` applies to: an integer, a float or a duration.
 */
type Formatted = Extract<Single, { readonly baseType: "integer" | "float" | "duration" }>;

/**
 * Report whether `format` applies to a value.
 *
 * @param single The value.
 * @returns Whether its base type is one of {@link formattedBaseTypes}.
 */
const isFormatted = (single: Single): single is Formatted =>
  formattedBaseTypes.has(single.baseType);

/**
 * The conversion letters a value is printed under (QTI 2.3.4). C's `d`, which the operator's ruling
 * on P1 admits, is read as `i` ({@link codeOf}); C's `u` is not admitted.
 */
const codes = ["E", "e", "f", "G", "g", "r", "R", "i", "o", "X", "x"] as const;

/**
 * A conversion letter `format` admits.
 */
type Code = (typeof codes)[number];

/**
 * Report whether a letter is a conversion letter `format` admits.
 *
 * @param letter One letter.
 * @returns Whether it is one of {@link codes}.
 */
const isCode = (letter: string): letter is Code => codes.some((code) => code === letter);

/**
 * Read a specifier's conversion letter as the letter it prints under: `d` as `i`, which C's
 * `printf` treats alike, so `%d` prints as `%i` would, `base` included (the operator's ruling on
 * P1); each of {@link codes} as itself.
 *
 * @param letter The letter {@link conversionPattern} matched.
 * @returns The letter, or none for one that is no conversion letter.
 */
const codeOf = (letter: string): Option.Option<Code> => {
  if (letter === "d") {
    return Option.some("i");
  }

  return isCode(letter) ? Option.some(letter) : Option.none();
};

/**
 * One conversion specifier as written: its flags from `# 0 - space +`, its minimum field width (0
 * when none is written), its precision (none when no `.` is written; `.` alone is 0, as in C) and
 * its conversion letter.
 */
interface Conversion {
  readonly flags: string;
  readonly width: number;
  readonly precision: Option.Option<number>;
  readonly code: Code;
}

/**
 * How a `format` lays out a numeric value: its printed text when it holds no conversion; the text
 * printed before the first conversion, that conversion and the text printed after it; or
 * `oversized` when that conversion's width or precision passes {@link fieldBound}. Printed text
 * writes each `%%` as `%` and each later conversion as written.
 */
type Layout =
  | { readonly kind: "literal"; readonly text: string }
  | {
      readonly kind: "conversion";
      readonly before: string;
      readonly conversion: Conversion;
      readonly after: string;
    }
  | { readonly kind: "oversized" };

/**
 * A converted number before it is fitted to its field width: whether it is negative, the radix
 * prefix `#` adds (`0x`, `0X`), its digits, and whether the `0` flag may pad it. C pads neither an
 * integer conversion with a precision nor an infinity or NaN with zeros.
 */
interface Field {
  readonly negative: boolean;
  readonly prefix: string;
  readonly body: string;
  readonly zeros: boolean;
}

/**
 * A decimal in scientific form, split at its exponent: the mantissa (`9.876540`) and the exponent
 * (`e+02`), so `g` can trim the mantissa's zeros before the exponent follows it.
 */
interface Scientific {
  readonly mantissa: string;
  readonly exponent: string;
}

/**
 * A non-negative decimal as significant digits and the place of the point: the value is
 * `0.digits × 10^point`. The digits hold no leading or trailing zero, and zero is `0` with point 1,
 * so `987.654` is `987654` at 3 and `0.0000987` is `987` at -4.
 */
interface Decimal {
  readonly digits: string;
  readonly point: number;
}

/**
 * The escape `%%` and the conversion specifiers of a `format`, read left to right as C reads a
 * format string, the escape first, so the `%i` inside `%%i` is no conversion: a specifier as QTI
 * 2.3.4 writes one, `%`, flags, a width, a precision of `.` and zero or more digits, and one
 * conversion letter, or C's `d`. A `%` that starts neither is text.
 */
const conversionPattern =
  /%%|%(?<flags>[#0 +-]*)(?<width>[0-9]*)(?:\.(?<precision>[0-9]*))?(?<code>[EefGgrRidoXx])/gu;

/**
 * The longest text the formatter writes for one value, 1,000,000 characters (UTF-16 code units, as
 * a string's length counts them), its members' texts and the delimiters between them together. A
 * value whose text would pass it is not printed: {@link formatPrinted} gives none, and `render`
 * fails `OutputTooLarge` naming this bound and the printed variable rather than show its slot
 * blank. {@link fieldBound} holds each member's conversion, but a container holds up to 1,000,000
 * members, so 600 members of 999,999 characters, or 1,000,000 members of 600, would join past an
 * engine's longest string, and the engine must not throw. A caller's smaller bound
 * ({@link formatPrinted}'s `bound`) takes its place; a larger one never does.
 */
export const textBound = 1_000_000;

/**
 * The largest field width or precision the formatter writes, {@link textBound} (1,000,000
 * characters), so one number names both bounds. A value under a specifier past it is not printed,
 * the format's literal text included: {@link formatPrinted} gives none, and `render` fails
 * `OutputTooLarge` naming the bound and the printed variable. `%1000000000i` would ask for a string
 * longer than an engine holds (V8's longest is 2^29 − 24 characters), and the engine must not
 * throw. It bounds one conversion; {@link textBound} bounds the text a container's members make
 * together.
 */
const fieldBound = BigInt(textBound);

/**
 * Zero, as a {@link Decimal}.
 */
const zero: Decimal = { digits: "0", point: 1 };

/**
 * Write a small integer's decimal digits exactly, without `String` on a number.
 *
 * @param integer A safe integer.
 * @returns Its digits, `-` before a negative.
 */
const written = (integer: number): string => BigInt(integer).toString();

/**
 * Read the decimal a shortest decimal form names: `987.654`, `100`, `1e+21`, `1.5e-7`.
 *
 * @param text The unsigned digits, with an optional point and exponent.
 * @returns The decimal, trailing zeros removed.
 */
const decimalOf = (text: string): Decimal => {
  const [mantissa = "", exponent = "0"] = text.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const all = `${whole}${fraction}`;
  const significant = all.replace(/^0+/u, "");
  const digits = significant.replace(/0+$/u, "");

  return digits === ""
    ? zero
    : {
        digits,
        point: whole.length + Number(exponent) - (all.length - significant.length),
      };
};

/**
 * Round a decimal to a number of significant digits, halves away from zero: the first digit
 * dropped decides, 5 or more raising the last digit kept (G-R2, pending). The decimal is the one
 * reading 54 writes, so `2.675` at three digits is `2.68` although the nearest double lies below
 * it.
 *
 * @param decimal The decimal.
 * @param keep How many leading digits stay. Below 0 the value rounds to zero; at 0 it rounds to
 *   zero or to one unit of the place above its first digit.
 * @returns The rounded decimal; a carry past the first digit moves the point.
 */
const rounded = (decimal: Decimal, keep: number): Decimal => {
  if (keep >= decimal.digits.length) {
    return decimal;
  }

  if (keep < 0) {
    return zero;
  }

  const kept = decimal.digits.slice(0, keep);
  if (decimal.digits.charAt(keep) < "5") {
    const digits = kept.replace(/0+$/u, "");

    return digits === "" ? zero : { digits, point: decimal.point };
  }

  const raised = (BigInt(`0${kept}`) + 1n).toString();

  return {
    digits: raised.replace(/0+$/u, ""),
    point: decimal.point + raised.length - kept.length,
  };
};

/**
 * Write a decimal in fixed form with a number of fraction digits; the decimal is already rounded
 * to them.
 *
 * @param decimal The decimal.
 * @param precision The fraction digits to write.
 * @param point Whether to write the point when no fraction digit follows it (`#`).
 * @returns The digits, `987.654000` for `987654` at 3 with 6.
 */
const fixed = (decimal: Decimal, precision: number, point: boolean): string => {
  const { digits } = decimal;
  const whole =
    decimal.point <= 0 ? "0" : digits.slice(0, decimal.point).padEnd(decimal.point, "0");
  const fraction = `${"0".repeat(Math.max(0, Math.min(-decimal.point, precision)))}${digits.slice(
    Math.max(decimal.point, 0),
    Math.max(decimal.point + precision, 0),
  )}`.padEnd(precision, "0");

  return precision > 0 || point ? `${whole}.${fraction}` : whole;
};

/**
 * Report whether a conversion writes its letters in upper case: `E`, `G`, `R` and `X`.
 *
 * @param conversion The conversion.
 * @returns Whether its letter is upper case.
 */
const isUpper = (conversion: Conversion): boolean =>
  conversion.code === "E" ||
  conversion.code === "G" ||
  conversion.code === "R" ||
  conversion.code === "X";

/**
 * Write a decimal in scientific form, split at the exponent; the decimal is already rounded to one
 * digit more than the precision.
 *
 * @param decimal The decimal.
 * @param precision The digits to write after the point.
 * @param point Whether to write the point when no digit follows it (`#`).
 * @param upper Whether the exponent letter is `E`.
 * @returns The mantissa and the exponent, which has at least two digits.
 */
const scientific = (
  decimal: Decimal,
  precision: number,
  point: boolean,
  upper: boolean,
): Scientific => {
  const power = decimal.point - 1;
  const rest = decimal.digits.slice(1, 1 + precision).padEnd(precision, "0");

  return {
    exponent: `${upper ? "E" : "e"}${power < 0 ? "-" : "+"}${written(Math.abs(power)).padStart(2, "0")}`,
    mantissa:
      precision > 0 || point ? `${decimal.digits.charAt(0)}.${rest}` : decimal.digits.charAt(0),
  };
};

/**
 * Remove the trailing zeros of a fraction, and the point when no digit is left after it, as `g`
 * does without `#`.
 *
 * @param mantissa Digits with or without a point.
 * @returns `987` for `987.000`, `0.1` for `0.10`; digits with no point unchanged.
 */
const trimmed = (mantissa: string): string =>
  mantissa.includes(".") ? mantissa.replace(/\.?0+$/u, "") : mantissa;

/**
 * Write a decimal under `g`, `G`, `r` or `R`: rounded to the precision in significant digits (6
 * when none is written, 1 for 0), then in fixed or scientific form, trailing zeros removed unless
 * `#` is set.
 *
 * `g` uses scientific form when the exponent X is below -4 or not below the precision P, as C does.
 * `r` uses it "only if the requested number of significant figures is less than the number of
 * digits to the left of the decimal point" (QTI 2.3.4), that is when P is at most X.
 *
 * @param decimal The decimal.
 * @param conversion The conversion, one of `g G r R`.
 * @returns The digits.
 */
const general = (decimal: Decimal, conversion: Conversion): string => {
  const asked = Option.getOrElse(conversion.precision, () => 6);
  const precision = asked === 0 ? 1 : asked;
  const value = rounded(decimal, precision);
  const power = value.point - 1;
  const alternate = conversion.flags.includes("#");
  const isScientific =
    conversion.code === "g" || conversion.code === "G"
      ? power < -4 || power >= precision
      : precision <= power;

  if (!isScientific) {
    const digits = fixed(value, precision - power - 1, alternate);

    return alternate ? digits : trimmed(digits);
  }

  const { exponent, mantissa } = scientific(value, precision - 1, alternate, isUpper(conversion));

  return `${alternate ? mantissa : trimmed(mantissa)}${exponent}`;
};

/**
 * Convert a decimal under a floating conversion, `e E f g G r R`.
 *
 * @param negative Whether the value is negative; a float's sign bit, so `-0` and a negative that
 *   rounds to zero keep their `-`, as C writes them.
 * @param decimal The value's magnitude.
 * @param conversion The conversion.
 * @returns The field.
 */
const floatingField = (negative: boolean, decimal: Decimal, conversion: Conversion): Field => {
  const precision = Option.getOrElse(conversion.precision, () => 6);
  const alternate = conversion.flags.includes("#");
  let body: string;

  if (conversion.code === "f") {
    body = fixed(rounded(decimal, decimal.point + precision), precision, alternate);
  } else if (conversion.code === "e" || conversion.code === "E") {
    const { exponent, mantissa } = scientific(
      rounded(decimal, precision + 1),
      precision,
      alternate,
      isUpper(conversion),
    );
    body = `${mantissa}${exponent}`;
  } else {
    body = general(decimal, conversion);
  }

  return { body, negative, prefix: "", zeros: true };
};

/**
 * Choose the radix of an integer conversion: 8 for `o`, 16 for `x` and `X`, and for `i`, which `d`
 * is read as, the base given, or 10 when it is outside 2 to 36, which have no digits to write it in
 * (G-R2, pending).
 *
 * @param conversion The conversion, one of `i o x X`.
 * @param base The resolved `base`.
 * @returns The radix.
 */
const radixOf = (conversion: Conversion, base: bigint): number => {
  if (conversion.code === "o") {
    return 8;
  }

  if (conversion.code !== "i") {
    return 16;
  }

  return base >= 2n && base <= 36n ? Number(base) : 10;
};

/**
 * Convert an integer under an integer conversion, `i o x X`: `i` in the base given, `o` in octal,
 * `x` and `X` in hexadecimal. A negative writes `-` and its magnitude's digits; under `o`, `x` and
 * `X`, which C reads as unsigned, that is a drafted reading (G-R2, pending), since an unbounded
 * integer has no two's complement to write.
 *
 * The precision is the least number of digits, so `%.0i` of 0 writes none; `#` makes octal start
 * with `0` and puts `0x` or `0X` before a hexadecimal other than 0.
 *
 * @param integer The integer.
 * @param conversion The conversion.
 * @param base The radix of `i`, 10 outside 2 to 36.
 * @returns The field.
 */
const integerField = (integer: bigint, conversion: Conversion, base: bigint): Field => {
  const magnitude = integer < 0n ? -integer : integer;
  const radix = radixOf(conversion, base);
  const digits = Option.match(conversion.precision, {
    onNone: () => magnitude.toString(radix),
    onSome: (precision) =>
      precision === 0 && magnitude === 0n ? "" : magnitude.toString(radix).padStart(precision, "0"),
  });
  const alternate = conversion.flags.includes("#");
  const body = isUpper(conversion) ? digits.toUpperCase() : digits;

  return {
    body: alternate && conversion.code === "o" && !body.startsWith("0") ? `0${body}` : body,
    negative: integer < 0n,
    prefix:
      alternate && magnitude !== 0n && (conversion.code === "x" || conversion.code === "X")
        ? `0${conversion.code}`
        : "",
    zeros: Option.isNone(conversion.precision),
  };
};

/**
 * Convert an infinity or NaN, under any conversion, as C writes them under a floating one: `inf`
 * and `nan`, in upper case for `E G R X`, never padded with zeros. Under `i o x X`, where C gives
 * no value, it prints `inf`, `-inf` or `nan` the same way, upper case under `X` (G-R2, pending).
 *
 * @param x The infinity or NaN.
 * @param conversion The conversion.
 * @returns The field.
 */
const nonFiniteField = (x: number, conversion: Conversion): Field => {
  const name = Number.isNaN(x) ? "nan" : "inf";

  return {
    body: isUpper(conversion) ? name.toUpperCase() : name,
    negative: x < 0,
    prefix: "",
    zeros: false,
  };
};

/**
 * Take the integer part of a finite float's shortest decimal, truncated toward zero with its sign
 * kept: `1e23` is `100000000000000000000000` and `-2.7` is `-2`, never the double's binary value
 * (`99999999999999991611392` for `1e23`).
 *
 * @param x A finite float.
 * @returns Its integer part.
 */
const truncated = (x: number): bigint => {
  const whole = BigInt(fixed(decimalOf(shortestDecimal(Math.abs(x))), 0, false));

  return x < 0 ? -whole : whole;
};

/**
 * Convert a number under a conversion. An integer under a floating conversion writes its exact
 * decimal; a float under an integer conversion is truncated toward zero first, as C converts a
 * double to an integer type, but from its shortest decimal ({@link truncated}; G-R2, pending), so
 * `%i` and `%.0f` of `1e23` print the same digits. QTI says floats "should only" take the floating
 * conversions, and states neither case. A duration converts as a float of its seconds.
 *
 * @param single The integer, float or duration.
 * @param conversion The conversion.
 * @param base The radix of `i`.
 * @returns The field.
 */
const fieldOf = (single: Formatted, conversion: Conversion, base: bigint): Field => {
  const isInteger = "ioXx".includes(conversion.code);

  if (single.baseType === "integer") {
    const magnitude = single.value < 0n ? -single.value : single.value;

    return isInteger
      ? integerField(single.value, conversion, base)
      : floatingField(single.value < 0n, decimalOf(magnitude.toString()), conversion);
  }

  const x = single.value;
  if (!Number.isFinite(x)) {
    return nonFiniteField(x, conversion);
  }

  return isInteger
    ? integerField(truncated(x), conversion, base)
    : floatingField(x < 0 || Object.is(x, -0), decimalOf(shortestDecimal(Math.abs(x))), conversion);
};

/**
 * Choose the sign a field writes: `-` for a negative; otherwise `+` under the `+` flag or a space
 * under the space flag, which `o x X` ignore, else none.
 *
 * @param negative Whether the number is negative.
 * @param conversion The conversion.
 * @returns The sign.
 */
const signOf = (negative: boolean, conversion: Conversion): string => {
  if (negative) {
    return "-";
  }

  if ("oXx".includes(conversion.code)) {
    return "";
  }

  if (conversion.flags.includes("+")) {
    return "+";
  }

  return conversion.flags.includes(" ") ? " " : "";
};

/**
 * Fit a field to its conversion's flags and width: its sign ({@link signOf}), then spaces before
 * it, spaces after it under `-`, or zeros between the sign and prefix and the digits under `0`.
 *
 * @param field The converted number.
 * @param conversion The conversion.
 * @returns The text.
 */
const fitted = (field: Field, conversion: Conversion): string => {
  const { flags } = conversion;
  const sign = signOf(field.negative, conversion);
  const text = `${sign}${field.prefix}${field.body}`;
  const room = conversion.width - text.length;

  if (room <= 0) {
    return text;
  }

  if (flags.includes("-")) {
    return `${text}${" ".repeat(room)}`;
  }

  return flags.includes("0") && field.zeros
    ? `${sign}${field.prefix}${"0".repeat(room)}${field.body}`
    : `${" ".repeat(room)}${text}`;
};

/**
 * Read how a `format` lays out a value, left to right: the value fills its first conversion, the
 * text around that conversion prints as written but for each `%%`, which prints `%`, and so does
 * any later conversion, so `%i of %i` of 3 prints `3 of %i` and `Score: %i%%` prints `Score: 3%`
 * (the operator's ruling on P1; G-R2 160, restated). A format with no conversion prints its text,
 * so `100%%` prints `100%` and `%%i` prints `%i`.
 *
 * @param format The `format` attribute.
 * @returns The layout.
 */
const layoutOf = (format: string): Layout => {
  let text = "";
  let cursor = 0;
  let first: { readonly before: string; readonly conversion: Conversion } | undefined;
  for (const match of format.matchAll(conversionPattern)) {
    text += format.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const groups = match.groups ?? {};
    const code = codeOf(groups["code"] ?? "");
    if (match[0] === "%%") {
      text += "%";
    } else if (first !== undefined || Option.isNone(code)) {
      text += match[0];
    } else {
      const width = BigInt(`0${groups["width"] ?? ""}`);
      const precision = Option.map(Option.fromNullishOr(groups["precision"]), (digits) =>
        BigInt(`0${digits}`),
      );

      if (width > fieldBound || Option.exists(precision, (digits) => digits > fieldBound)) {
        return { kind: "oversized" };
      }

      first = {
        before: text,
        conversion: {
          code: code.value,
          flags: groups["flags"] ?? "",
          precision: pipe(precision, Option.map(Number)),
          width: Number(width),
        },
      };
      text = "";
    }
  }

  text += format.slice(cursor);

  return first === undefined
    ? { kind: "literal", text }
    : { after: text, before: first.before, conversion: first.conversion, kind: "conversion" };
};

/**
 * Write a value in its default form, with no `format` (G-R2, pending): an integer as its decimal
 * digits; a float, and a duration's seconds, as reading 54 writes a float, its shortest decimal
 * (`1.5`, `1e+21`), with `-0`, `INF`, `-INF` and `NaN` by name; every other base type as the value
 * model writes it.
 *
 * @param single The value.
 * @param powerForm Whether a float's or a duration's exponent `e+n` is written `x 10 to the power
 *   n`, as the information model words `power-form`.
 * @returns The text.
 */
const defaultForm = (single: Single, powerForm: boolean): string => {
  if (single.baseType !== "float" && single.baseType !== "duration") {
    return lexicalForm(single);
  }

  const x = single.value;
  if (Number.isNaN(x)) {
    return "NaN";
  }

  if (!Number.isFinite(x)) {
    return x < 0 ? "-INF" : "INF";
  }

  if (Object.is(x, -0)) {
    return "-0";
  }

  const text = shortestDecimal(x);

  return powerForm ? text.replace(/e\+?(?<power>-?[0-9]+)$/u, " x 10 to the power $<power>") : text;
};

/**
 * Build the printer of one member of a value: the default form for a value that is not an
 * integer, a float or a duration, or with no `format`; the `format`'s layout for one of those.
 * QTI applies `format` to "numerical values" only; a duration takes it as a float of its seconds
 * (G-R3, pending).
 *
 * @param baseType The value's base type.
 * @param options The printed variable's options.
 * @returns The printer, or none when the format's conversion is oversized, so the value is not
 *   printed.
 */
const printerOf = (
  baseType: ModelledBaseType,
  options: PrintOptions,
): Option.Option<(single: Single) => string> => {
  const powerForm = options.powerForm ?? false;
  if (options.format === undefined || !formattedBaseTypes.has(baseType)) {
    return Option.some((single) => defaultForm(single, powerForm));
  }

  const layout = layoutOf(options.format);
  if (layout.kind === "oversized") {
    return Option.none();
  }

  if (layout.kind === "literal") {
    return Option.some(() => layout.text);
  }

  const base = options.base ?? 10n;

  return Option.some((single) =>
    isFormatted(single)
      ? `${layout.before}${fitted(fieldOf(single, layout.conversion, base), layout.conversion)}${layout.after}`
      : defaultForm(single, powerForm),
  );
};

/**
 * Pick the members of a value to print: an `ordered` value's `index`-th member, counting from 1,
 * when `index` names one; otherwise every member (G-R2, pending).
 *
 * @param value The value.
 * @param index The resolved `index`, if any.
 * @returns The members, none for NULL.
 */
const shownOf = (value: Value, index: bigint | undefined): readonly Single[] => {
  const member =
    value.cardinality === "ordered" && index !== undefined && index >= 1n
      ? value.values[Number(index - 1n)]
      : undefined;

  return member === undefined ? value.values : [member];
};

/**
 * Join members' texts by a delimiter, printing each member only while the text so far stays within
 * a bound, so no text past it is ever built: the member that would pass it is the last printed.
 *
 * @param members The members to print, in order.
 * @param print The printer of one member.
 * @param delimiter The text between two members.
 * @param bound The most characters the joined text may hold, at most {@link textBound}.
 * @returns The joined text, or none as soon as it would pass `bound`.
 */
const joinedWithin = (
  members: readonly Single[],
  print: (single: Single) => string,
  delimiter: string,
  bound: number,
): Option.Option<string> => {
  const texts: string[] = [];
  let length = 0;
  for (const member of members) {
    const text = print(member);
    length += (texts.length === 0 ? 0 : delimiter.length) + text.length;
    if (length > bound) {
      return Option.none();
    }

    texts.push(text);
  }

  return Option.some(texts.join(delimiter));
};

/**
 * Write the text a `qti-printed-variable` shows for a value: each member printed, through `format`
 * when the value is an integer, a float or a duration and a format is given, and joined by
 * `delimiter`. NULL prints nothing, whatever the format. It never throws and never builds a text
 * past an engine's longest string: a value under a conversion wider than {@link fieldBound}, or
 * whose whole text would pass {@link textBound}, both 1,000,000 characters, is not printed, and it
 * gives none, so the caller can tell that from NULL's empty text and fail rather than show a blank
 * slot (`render` fails `OutputTooLarge`, naming the bound and the printed variable).
 *
 * A caller that holds the text to fewer characters passes `bound`: the text is then held to the
 * smaller of `bound` and {@link textBound}, the members are printed one by one only while the text
 * so far stays within it, and none is given as soon as it would pass it, so no more than one
 * member is printed past what fits. `redactItem` passes what remains of its output budget. A
 * `bound` that is not a number below {@link textBound}, `NaN` included, holds the text to
 * {@link textBound}.
 *
 * Records are not modelled, so no record reaches it; `mappingIndicator` waits for them.
 *
 * @example
 *   formatPrinted(floatValue(2.675), { format: "Score: %.2f" }); // Option.some("Score: 2.68")
 *   formatPrinted(integerValue(5n), { format: "%1000001i" }); // Option.none()
 *   formatPrinted(orderedIntegers([10n, 20n, 30n]), {}, 5); // Option.none(): "10;20;30" is 8
 *
 * @param value The variable's value.
 * @param options The printed variable's resolved attributes.
 * @param bound The most characters the text may hold, {@link textBound} when absent or larger.
 * @returns Some text, empty for NULL; or none for a value under a conversion wider than
 *   1,000,000 characters, and for one whose text, delimiters included, would be longer than
 *   `bound` or 1,000,000 characters, whichever is fewer.
 */
export const formatPrinted = (
  value: Value,
  options: PrintOptions = {},
  bound: number = textBound,
): Option.Option<string> => {
  const shown = shownOf(value, options.index);
  if (shown.length === 0) {
    return Option.some("");
  }

  return Option.flatMap(printerOf(value.baseType, options), (print) =>
    joinedWithin(shown, print, options.delimiter ?? ";", bound < textBound ? bound : textBound),
  );
};
