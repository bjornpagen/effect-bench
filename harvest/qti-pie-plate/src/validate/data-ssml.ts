/**
 * The Data-SSML value a `data-ssml` attribute holds, and its decoder.
 *
 * QTI 3 carries speech hints in `data-ssml`, whose value is JSON in the shape 1EdTech's Data-SSML
 * binding defines (`imsqtiv3p0_datassml_v1p0_InfoBind.html` §3.4.5, and its JSON Schema in Appendix
 * C1.1): an object of up to five properties, `break`, `phoneme`, `prosody`, `say-as` and `sub`,
 * each an object of its own properties, with no property the binding does not define ("Extensions
 * are not permitted", §4.2). A value that is not such JSON is refused (the operator's P3).
 *
 * @module
 */
import { Data, Result, Schema } from "effect";
import type { SchemaIssue } from "effect";

/**
 * Construct the Schema of a string property the binding gives an enumeration: a string, refined to
 * one of the values listed.
 *
 * A refinement, not a union of literals, so a value of another JSON type fails as the string it is
 * not and a string outside the list fails the refinement: the two failures stay apart, and
 * {@link problemOf} names them `type` and `value`.
 *
 * @param values The values the binding lists, in its order.
 * @returns The Schema, whose type is the union of the values.
 */
const enumeration = <const Values extends readonly [string, ...string[]]>(values: Values) => {
  const listed: ReadonlySet<string> = new Set(values);

  return Schema.String.pipe(
    Schema.refine((value: string): value is Values[number] => listed.has(value)),
  );
};

/**
 * The Schema of a property the binding types NormalizedString: a string that holds no tab, line
 * feed or carriage return, as JSON decodes it, so the escape `\t` is a tab.
 *
 * R7-a (a `data-ssml` value is Data-SSML JSON): "`time` and `rate` are any normalized string … so
 * no tab, line feed or carriage return in their decoded value". A filter, as an
 * {@link enumeration}'s refinement is, so a string holding one fails as `value` and a value of
 * another JSON type still fails as the string it is not.
 */
const normalizedString = Schema.String.pipe(Schema.check(Schema.isPattern(/^[^\t\n\r]*$/u)));

/**
 * The Schema of `BreakDType` (§3.4.5.1): a pause, by `strength` or by `time`.
 *
 * `time` is a NormalizedString the binding writes in CSS's time format (`250ms`, `3s`). The
 * normalized string's whitespace is judged ({@link normalizedString}); the time format is not (a
 * documented limit, rule `db2ef322`), since the binding's JSON Schema types `time` a string.
 */
const Break = Schema.Struct({
  strength: Schema.optionalKey(
    enumeration(["medium", "none", "strong", "weak", "x-strong", "x-weak"]),
  ),
  time: Schema.optionalKey(normalizedString),
});

/**
 * The Schema of `PhonemeDType` (§3.4.5.3): a pronunciation `ph`, which it requires, in an optional
 * `alphabet` and of an optional `type`.
 */
const Phoneme = Schema.Struct({
  alphabet: Schema.optionalKey(enumeration(["ipa", "x-sampa"])),
  ph: Schema.String,
  type: Schema.optionalKey(enumeration(["default", "ruby"])),
});

/**
 * The Schema of `ProsodyDType` (§3.4.5.4): a speaking `rate`.
 *
 * The binding's JSON Schema gives `rate` as any of six words or a NormalizedString, so any
 * normalized string is a `rate`: its whitespace is judged ({@link normalizedString}), and the
 * percentage its description names is not (a documented limit, rule `db2ef322`).
 */
const Prosody = Schema.Struct({
  rate: Schema.optionalKey(normalizedString),
});

/**
 * The Schema of `SayAsDType` (§3.4.5.5): how to read the text, an `interpret-as`, which it
 * requires.
 */
const SayAs = Schema.Struct({
  "interpret-as": enumeration(["cardinal", "characters", "date", "ordinal", "telephone", "time"]),
});

/**
 * The Schema of `SubDType` (§3.4.5.6): an `alias` to speak in place of the text, which it requires.
 */
const Sub = Schema.Struct({
  alias: Schema.String,
});

/**
 * The Schema of `DataSSMLDType` (§3.4.5.2), the value of a `data-ssml` attribute: an object of up
 * to five properties, none of them required, so `{}` is a value.
 *
 * A Struct keeps only the properties it declares; {@link decodeDataSsml} decodes with excess
 * properties an error, which gives the binding's `"additionalProperties" : false` on every object.
 */
export const DataSsml = Schema.Struct({
  break: Schema.optionalKey(Break),
  phoneme: Schema.optionalKey(Phoneme),
  prosody: Schema.optionalKey(Prosody),
  "say-as": Schema.optionalKey(SayAs),
  sub: Schema.optionalKey(Sub),
});

/**
 * What is wrong with a `data-ssml` value, the refusal's `problem`.
 *
 * - `json`: the value is not JSON.
 * - `name`: an object holds a property the binding does not define.
 * - `type`: a value is not of the JSON type its place takes, or an object lacks a property it
 *   requires: the value as a whole is not an object, a property holds a number where it takes a
 *   string or a string where it takes an object, or `sub` has no `alias`.
 * - `value`: a string is not one of the values its property's enumeration lists, or a
 *   NormalizedString property (`time`, `rate`) holds a tab, line feed or carriage return.
 */
export type DataSsmlProblem = "json" | "name" | "type" | "value";

/**
 * Each {@link DataSsmlProblem} as {@link InvalidDataSsml}'s message words it.
 */
const problemTexts: Readonly<Record<DataSsmlProblem, string>> = {
  json: "is not JSON",
  name: "holds a property Data-SSML does not define",
  type: "holds a value of a JSON type Data-SSML does not allow there, or lacks a property it requires",
  value: "holds a value outside what its property allows",
};

/**
 * The failure of {@link decodeDataSsml} for a value that is not Data-SSML JSON, by the
 * {@link DataSsmlProblem} its decoding found first.
 */
export class InvalidDataSsml extends Data.TaggedError("InvalidDataSsml")<{
  readonly problem: DataSsmlProblem;
}> {
  /**
   * What is wrong with the value, and what to write instead.
   */
  override get message(): string {
    return `The data-ssml value ${problemTexts[this.problem]}. Write it as Data-SSML JSON: an object of break, phoneme, prosody, say-as and sub, each holding only the properties and values 1EdTech's Data-SSML binding defines for it.`;
  }
}

/**
 * Name the {@link DataSsmlProblem} a failed decoding's issue describes, by its first leaf.
 *
 * The decoder reports the first issue only, so each composite holds one path down to it.
 * `Encoding` is the JSON parse's own failure, above every leaf the parsed value can give; a
 * `Filter` is an {@link enumeration}'s refinement or {@link normalizedString}'s check. `AnyOf`,
 * `OneOf` and `Forbidden` arise from no input under {@link DataSsml}, which holds no union and no
 * forbidden key; they are named with the leaves they resemble so the mapping is total.
 *
 * @param issue The issue.
 * @returns The problem.
 */
const problemOf = (issue: SchemaIssue.Issue): DataSsmlProblem => {
  switch (issue._tag) {
    case "Encoding": {
      return "json";
    }
    case "Composite": {
      return problemOf(issue.issues[0]);
    }
    case "Pointer": {
      return problemOf(issue.issue);
    }
    case "UnexpectedKey": {
      return "name";
    }
    case "AnyOf":
    case "InvalidType":
    case "MissingKey":
    case "OneOf": {
      return "type";
    }
    case "Filter":
    case "Forbidden":
    case "InvalidValue": {
      return "value";
    }
    default: {
      return issue satisfies never;
    }
  }
};

/**
 * The decoder of {@link DataSsml} from JSON text, through Effect Schema's `fromJsonString`. It
 * reports the first issue only, and a property a definition does not declare is an issue
 * (`onExcessProperty: "error"`), not a key it strips.
 */
const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(DataSsml), {
  onExcessProperty: "error",
});

/**
 * Decode a `data-ssml` attribute's value, as the XML reader gives it with its entities replaced,
 * as Data-SSML JSON.
 *
 * Every serialization the binding allows (§4.1: single quotes around the attribute, or its double
 * quotes written as entities) reaches here as the same text, so none is preferred.
 *
 * A documented limit (rule `db2ef322`; no corpus document holds `data-ssml`): R7-a accepts a name
 * written twice in one object and judges each of its values, but `fromJsonString` parses with
 * `JSON.parse`, which keeps the last, so only the last value is judged here. Lifting it needs a
 * JSON reader that keeps duplicate names.
 *
 * @param value The attribute's value.
 * @returns The decoded value, or {@link InvalidDataSsml} naming the first problem found.
 */
export const decodeDataSsml = (
  value: string,
): Result.Result<typeof DataSsml.Type, InvalidDataSsml> =>
  Result.mapError(
    decodeJson(value),
    ({ issue }) => new InvalidDataSsml({ problem: problemOf(issue) }),
  );
