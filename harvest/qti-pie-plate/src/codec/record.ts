/**
 * The Schema codec of the session record, for the server and the boundaries:
 * {@link ItemRecordSchema} checks the plain {@link ItemRecord} of `#plate/model/record.ts`,
 * {@link encodeRecord} writes it in the form the host stores, and {@link decodeRecord} checks one
 * the host hands back before the renderer trusts it. The stored form names its version,
 * {@link storedVersion}, and only that version is read, so a change to the form shows as another
 * version rather than as a record that half fits.
 *
 * No browser module imports this file, so Schema stays out of the browser bundle.
 *
 * @module
 */
import { Data, Formatter, Option, Result, Schema, SchemaTransformation } from "effect";
import { RecordValueSchema, ValueSchema } from "#plate/codec/values.ts";
import type { ItemRecord } from "#plate/model/record.ts";

/**
 * The version of every stored form this renderer writes, the session record's and the test
 * session's, and the only version it reads. The two forms share it, so a change to either form
 * moves both, and a form whose fields did not change still names the new version.
 */
export const storedVersion = 4;

/**
 * The fields of one item's session, as {@link ItemRecord} has them.
 */
const recordFields = {
  attempt: Schema.Literals(["none", "submitted"]),
  correct: Schema.Record(Schema.String, ValueSchema),
  defaults: Schema.Record(Schema.String, ValueSchema),
  document: Schema.String,
  instance: Schema.String,
  item: Schema.String,
  kind: Schema.Literal("item"),
  notices: Schema.Array(Schema.String),
  numAttempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outcomes: Schema.Record(Schema.String, ValueSchema),
  records: Schema.Record(Schema.String, RecordValueSchema),
  responses: Schema.Record(Schema.String, ValueSchema),
  seed: Schema.String,
  templates: Schema.Record(Schema.String, ValueSchema),
};

/**
 * The Schema of one item's session; its type is {@link ItemRecord}, and its encoded form the
 * {@link StoredRecord} the host keeps, which adds `version`. Encoding writes {@link storedVersion}
 * and decoding requires it, so the plain record carries no version.
 */
export const ItemRecordSchema = Schema.Struct({
  ...recordFields,
  version: Schema.Literal(storedVersion),
}).pipe(
  Schema.decodeTo(
    Schema.toType(Schema.Struct(recordFields)),
    SchemaTransformation.transform({
      decode: ({ version: _stored, ...record }) => record,
      encode: (record) => ({ ...record, version: storedVersion }),
    }),
  ),
);

/**
 * One item's session in the form the host stores: JSON-safe data that names its version, `4`,
 * with every integer written as its decimal digits, so no integer is rounded on the way through
 * the host, and the floats JSON has no number for written by name: the infinities as `"INF"` and
 * `"-INF"`, NaN as `"NaN"` and negative zero as `"-0"`. A record response's value sits in
 * `records`, beside `responses`, each field written as a value is. It holds the seed, the template
 * values, and the correct responses and defaults template processing set, so it is server data:
 * keep it where only the server reads it, never in the page.
 */
export type StoredRecord = typeof ItemRecordSchema.Encoded;

/**
 * The part of a stored form read before the rest: its `version`, none when it names none.
 */
const Versioned = Schema.Struct({ version: Schema.OptionFromOptionalKey(Schema.Unknown) });

/**
 * Read a stored form's `version`.
 *
 * @param input The stored form, as the host handed it back.
 * @returns The form's `version`, itself none when the form names none; none when `input` is not
 *   an object.
 */
const readVersioned = Schema.decodeUnknownOption(Versioned);

/**
 * Read the version a stored form names.
 *
 * @param input The stored form, as the host handed it back.
 * @returns The value `input` holds under `version`, or none when `input` is not an object or has
 *   no `version`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host hands the stored form back as any value, and this reads it before any other Schema does.
export const versionOf = (input: unknown): Option.Option<unknown> =>
  Option.flatMap(readVersioned(input), ({ version }) => version);

/**
 * Check the version a stored form names before its Schema reads the rest, so a form of another
 * version is refused as that version rather than for the first field that changed.
 *
 * @param input The stored form, as the host handed it back.
 * @returns What is wrong, in words naming the version found, when `input` is an object whose
 *   `version` is missing or is not {@link storedVersion}; none when it is {@link storedVersion},
 *   or when `input` is not an object, which its Schema refuses.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host hands the stored form back as any value, and this is the first check that parses it.
export const versionIssue = (input: unknown): Option.Option<string> =>
  Option.flatMap(readVersioned(input), ({ version }) =>
    Option.match(version, {
      onNone: () =>
        Option.some(
          `it names no version, and this renderer reads only version ${String(storedVersion)}`,
        ),
      onSome: (found) =>
        found === storedVersion
          ? Option.none()
          : Option.some(
              `it is version ${Formatter.format(found)}, and this renderer reads only version ${String(storedVersion)}`,
            ),
    }),
  );

/**
 * Where the record codec failed: reading a record the host handed back, or writing one the
 * renderer produced.
 */
export type RecordStage = "decode" | "encode";

/**
 * What each {@link RecordStage}'s failure means and what to do about it.
 */
const recordRemedies: Readonly<Record<RecordStage, (issue: string) => string>> = {
  decode: (issue) =>
    `The session record is not one the renderer wrote: ${issue}. Pass back, unchanged, the record begin or score returned for this item.`,
  encode: (issue) =>
    `The renderer could not write the session record it produced: ${issue}. This is a renderer defect; report it with the item.`,
};

/**
 * A session record the codec could not read or write: one the host handed back that the renderer
 * could not have written (`stage` `decode`), or one the renderer produced that does not fit the
 * record's Schema (`stage` `encode`).
 */
export class InvalidRecord extends Data.TaggedError("InvalidRecord")<{
  /**
   * What the record's Schema found wrong, with the path to it.
   */
  readonly issue: string;
  /**
   * Whether the record failed on its way in from the host or on its way out to it.
   */
  readonly stage: RecordStage;
}> {
  /**
   * What is wrong and what to do instead, in one line.
   */
  override get message(): string {
    return recordRemedies[this.stage](this.issue);
  }
}

/**
 * Write a session record in the form the host stores, every integer as its decimal digits.
 *
 * @param record The record.
 * @returns The {@link StoredRecord}, which `JSON.stringify` writes without loss and
 *   {@link decodeRecord} reads back to `record`, or {@link InvalidRecord} at stage `encode` naming
 *   a value that does not fit the record's Schema.
 */
export const encodeRecord = (record: ItemRecord): Result.Result<StoredRecord, InvalidRecord> =>
  Result.mapError(
    Schema.encodeResult(ItemRecordSchema)(record),
    (schemaError) => new InvalidRecord({ issue: schemaError.message, stage: "encode" }),
  );

/**
 * Check a session record the host handed back.
 *
 * @param input The stored record, as the host returned it: the {@link StoredRecord}
 *   {@link encodeRecord} wrote, after any JSON round trip. An integer written as a JSON number is
 *   refused, and so is a record that names no version or another version than
 *   {@link storedVersion}, 4: a version-3 record among them, refused for its version before its
 *   fields are read, though it lacks only `records`.
 * @returns The record, or {@link InvalidRecord} at stage `decode` naming what does not fit, the
 *   version found when that is what does not fit.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host stores the record and hands it back as any value, and this is the check that parses it.
export const decodeRecord = (input: unknown): Result.Result<ItemRecord, InvalidRecord> =>
  Option.match(versionIssue(input), {
    onNone: () =>
      Result.mapError(
        Schema.decodeUnknownResult(ItemRecordSchema)(input),
        (schemaError) => new InvalidRecord({ issue: schemaError.message, stage: "decode" }),
      ),
    onSome: (issue) => Result.fail(new InvalidRecord({ issue, stage: "decode" })),
  });
