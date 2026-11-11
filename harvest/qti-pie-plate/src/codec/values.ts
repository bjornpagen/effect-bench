/**
 * The Schema codecs of the value model, for the server and the boundaries: {@link SingleSchema},
 * {@link ValueSchema} and {@link RecordValueSchema} check, encode and decode the plain
 * {@link Single}, {@link Value} and {@link RecordValue} types of `#plate/model/values.ts`, and
 * {@link ResponseValueSchema} a response's value of either kind.
 *
 * No browser module imports this file, so Schema stays out of the browser bundle.
 *
 * @module
 */
import { Array as Arr, Option, Schema, SchemaTransformation } from "effect";
import { isXmlText } from "#plate/form/encoding.ts";
import { isNcName, modelledBaseTypes, modelledCardinalities } from "#plate/model/values.ts";
import type { RecordValue, Single, Value } from "#plate/model/values.ts";

/**
 * An identifier as a Schema: a string that is an NCName.
 */
const IdentifierText = Schema.String.check(
  Schema.makeFilter((text: string) =>
    isNcName(text) ? undefined : "an identifier must be an NCName; start it with a letter or _",
  ),
);

/**
 * A string or a URI as a Schema: text whose every character XML can carry, since a stored value
 * may be written into a result. It refuses what `decode` refuses of a posted string.
 */
const XmlText = Schema.String.check(
  Schema.makeFilter((text: string) =>
    isXmlText(text)
      ? undefined
      : "this text holds a character XML cannot carry; remove each control character other than tab, line feed and carriage return, each U+FFFE and U+FFFF, and each lone surrogate",
  ),
);

/**
 * The names the stored form writes for the floats a JSON number cannot carry: xs:double's names for
 * the infinities and NaN, as `formatFloat` writes them, and `-0`, because `JSON.stringify` writes
 * negative zero as `0`.
 */
const FloatNames = Schema.Literals(["INF", "-INF", "NaN", "-0"]);

/**
 * Decide whether a stored float is one of {@link FloatNames} rather than a number.
 */
const isFloatName = Schema.is(FloatNames);

/**
 * The float each of {@link FloatNames} names.
 */
const namedFloats: Readonly<Record<typeof FloatNames.Type, number>> = {
  "-0": -0,
  "-INF": Number.NEGATIVE_INFINITY,
  INF: Number.POSITIVE_INFINITY,
  NaN: Number.NaN,
};

/**
 * A float as a Schema whose encoded form survives JSON text: a finite number other than negative
 * zero stays a number, and the infinities, NaN and negative zero are written by name. The decode
 * reads the four names back and refuses any other string, so a stored value has one spelling.
 */
const FloatFromJson = Schema.Union([Schema.Finite, FloatNames]).pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transform({
      decode: (stored) => (isFloatName(stored) ? namedFloats[stored] : stored),
      encode: (number) =>
        Option.getOrElse(
          Arr.findFirst(FloatNames.literals, (name) => Object.is(namedFloats[name], number)),
          () => number,
        ),
    }),
  ),
);

/**
 * Read a float out of a stored record, so a host that shows one never depends on the stored
 * spelling: a number as written, or the infinity, NaN or negative zero its name stands for.
 *
 * @param stored The float's `value` in the stored record.
 * @returns The float, or none when the stored value is not one this codec writes.
 */
export const decodeStoredFloat = Schema.decodeOption(FloatFromJson);

/**
 * The Schema of one QTI value, tagged by its base type; its type is {@link Single}.
 *
 * An integer is exact at any size. Its encoded form is its decimal digits, which `parseLexical`
 * reads to the same value, so a value decoded from a record is one the parser could have read. A
 * point is two such integers, x then y, each encoded as its decimal digits. A string or a URI holds
 * only characters XML can carry. A float is an xs:double. Its encoded form is a JSON number when it
 * is finite and not negative zero, and otherwise `"INF"`, `"-INF"`, `"NaN"` or `"-0"`, so
 * `JSON.stringify` keeps every float.
 */
export const SingleSchema = Schema.Union([
  Schema.Struct({ baseType: Schema.Literal("identifier"), value: IdentifierText }),
  Schema.Struct({ baseType: Schema.Literal("boolean"), value: Schema.Boolean }),
  Schema.Struct({ baseType: Schema.Literal("integer"), value: Schema.BigIntFromString }),
  Schema.Struct({ baseType: Schema.Literal("float"), value: FloatFromJson }),
  Schema.Struct({ baseType: Schema.Literal("string"), value: XmlText }),
  Schema.Struct({
    baseType: Schema.Literal("point"),
    value: Schema.Tuple([Schema.BigIntFromString, Schema.BigIntFromString]),
  }),
  Schema.Struct({
    baseType: Schema.Literal("pair"),
    value: Schema.Tuple([IdentifierText, IdentifierText]),
  }),
  Schema.Struct({
    baseType: Schema.Literal("directedPair"),
    value: Schema.Tuple([IdentifierText, IdentifierText]),
  }),
  Schema.Struct({ baseType: Schema.Literal("duration"), value: FloatFromJson }),
  Schema.Struct({ baseType: Schema.Literal("uri"), value: XmlText }),
]);

/**
 * Report what is wrong with one value of a {@link Value}.
 *
 * @param value The value that holds `single`.
 * @param single The value to check.
 * @returns The problem in words that say what to change, or none when `single` fits.
 */
const misfit = (value: Value, single: Single): Option.Option<string> => {
  if (single.baseType !== value.baseType) {
    return Option.some(
      `this value has base type ${single.baseType} inside a ${value.baseType} value; give it base type ${value.baseType}`,
    );
  }

  return single.baseType === "string" && single.value === ""
    ? Option.some("an empty string is NULL, not a value; remove it, so NULL is no values")
    : Option.none();
};

/**
 * The Schema of a QTI value of a modelled base type, as the session record carries it; its type is
 * {@link Value}.
 *
 * NULL is `values: []` at any cardinality, because QTI treats an empty string and an empty
 * container as NULL; there is no other spelling of NULL, so the Schema refuses an empty string. A
 * `single` holds at most one value, and every value carries the value's own base type.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Variables
 */
export const ValueSchema = Schema.Struct({
  baseType: Schema.Literals(modelledBaseTypes),
  cardinality: Schema.Literals(modelledCardinalities),
  values: Schema.Array(SingleSchema),
}).check(
  Schema.makeFilter((value) => {
    const misfits: Schema.FilterIssue[] = value.values.flatMap((single, index) =>
      Option.match(misfit(value, single), {
        onNone: () => [],
        onSome: (issue) => [{ issue, path: ["values", index] }],
      }),
    );

    return value.cardinality === "single" && value.values.length > 1
      ? [
          ...misfits,
          {
            issue: `a single value holds at most one value, not ${String(value.values.length)}; keep one, or none for NULL`,
            path: ["values"],
          },
        ]
      : misfits;
  }),
);

/**
 * One field of a record as a Schema; its type is `RecordField`. Its identifier's rules are the
 * record's ({@link recordMisfits}), since one of them, that no identifier repeats, reads every
 * field.
 */
const RecordFieldSchema = Schema.Struct({ identifier: Schema.String, value: SingleSchema });

/**
 * Report what is wrong with each field of a record: an identifier that is not an NCName, an
 * identifier an earlier field names, or a value that is the empty string, which is NULL, and a NULL
 * field is no field. It reads each field once, keeping the identifiers seen, so the time is linear
 * in the number of fields.
 *
 * @param record The record.
 * @returns Each problem in words that say what to change, with the path to its field.
 */
const recordMisfits = (record: RecordValue): Schema.FilterIssue[] => {
  const seen = new Set<string>();
  const misfits: Schema.FilterIssue[] = [];
  for (const [index, field] of record.fields.entries()) {
    const named = JSON.stringify(field.identifier);
    if (!isNcName(field.identifier)) {
      misfits.push({
        issue: `the field identifier ${named} is not an NCName; start it with a letter or _, then use letters, digits, -, _ or .`,
        path: ["fields", index, "identifier"],
      });
    }

    if (seen.has(field.identifier)) {
      misfits.push({
        issue: `the field identifier ${named} is named by an earlier field too; keep one field of each identifier`,
        path: ["fields", index, "identifier"],
      });
    }

    if (field.value.baseType === "string" && field.value.value === "") {
      misfits.push({
        issue: `the field ${named} holds an empty string, which is NULL, and a NULL field is no field; remove the field`,
        path: ["fields", index, "value"],
      });
    }

    seen.add(field.identifier);
  }

  return misfits;
};

/**
 * The Schema of a record value, as a record response holds it; its type is {@link RecordValue}.
 *
 * Each field is an identifier and a single of a modelled base type, encoded as {@link SingleSchema}
 * encodes a single, so an integer of any size stays exact and a float JSON has no number for is
 * written by name. The record's rules are checks on its type, so decoding and encoding refuse the
 * same records: each identifier is an NCName, no identifier is named twice, and no field holds the
 * empty string, since a NULL field is no field. A record with no field is NULL.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Variables
 */
export const RecordValueSchema = Schema.Struct({
  cardinality: Schema.Literal("record"),
  fields: Schema.Array(RecordFieldSchema),
}).check(Schema.makeFilter(recordMisfits));

/**
 * The Schema of a response's value, a {@link Value} or a {@link RecordValue}, told apart by the
 * cardinality; its type is `ResponseValue`.
 */
export const ResponseValueSchema = Schema.Union([ValueSchema, RecordValueSchema]);
