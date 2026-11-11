/**
 * The five Schemas a host of the `./effect` entry reads plate's data with, and a JSON Schema
 * document of each: the stored item record, the stored test session, the redacted item's JSON
 * form, the configuration and the refusal.
 *
 * Each Schema is the one plate itself decodes with, under the name a host reads it by, and each
 * checks shape only. The full checks stay where they are: `decodeSession` also checks that a stored
 * session belongs to its test and fits it, and `decodeRedacted` also bounds the form's depth,
 * checks where each interaction sits, and brands the item. None of these Schemas mints a brand: a
 * `Redacted` comes only from `redact` and `decodeRedacted`, and an `Accepted` only from `check`, so
 * the types refuse a value one of these decodes where `render` or `redact` wants one.
 *
 * Each document is built once, when the module loads, with `Schema.toJsonSchemaDocument`, in JSON
 * Schema draft 2020-12, and describes the JSON form `Schema.toCodecJson` writes for its Schema. A
 * document is for preliminary validation, by a form or in another language; JSON Schema's checks
 * and Effect's do not always agree, so where they part, the Schema decides.
 *
 * @module
 */
import type { JsonSchema } from "effect";
import { Schema } from "effect";
import { ItemRecordSchema } from "#plate/codec/record.ts";
import { RedactedSchema } from "#plate/codec/redacted.ts";
import { TestSessionSchema } from "#plate/codec/session.ts";
import { Configuration } from "#plate/configuration.ts";
import { Refusal } from "#plate/validate/refusal.ts";

/**
 * The Schema of one item's session record as the host stores it, the `StoredRecord` `begin` and
 * `score` return; it decodes to the record plate keeps, the plain `ItemRecord` of
 * `#plate/model/record.ts`, and encodes back. It checks the record's shape and its version, 4.
 */
export const StoredRecordSchema = ItemRecordSchema;

/**
 * The Schema of a test session as the host stores it, the `StoredTestSession` `encodeSession`
 * writes; it decodes to the plain `TestSession`. It checks shape only: a stored session of another
 * test, or one whose items do not fit its test, still decodes. Read a session the host hands back
 * with `decodeSession`, which checks both.
 */
export const StoredTestSessionSchema = TestSessionSchema;

/**
 * The Schema of a redacted item's JSON form, the `RedactedJson` `encodeRedacted` writes; it
 * decodes to the item's fields, never to a `Redacted`. It checks shape only and brands nothing:
 * read the form a page receives with `decodeRedacted`, which also bounds its depth, checks where
 * each interaction sits, and gives the `Redacted` `render` takes.
 */
export const RedactedJsonSchema = RedactedSchema;

/**
 * The Schema of the renderer's configuration, which owns every field's constraint and default:
 * each key is optional in the input, so `{}` decodes to the whole default configuration.
 */
export const ConfigurationSchema = Configuration;

/**
 * The Schema of a refusal, the data a refused document's verdict carries: the rule it breaks, one
 * of `refusalRules`, and where in the document.
 */
export const RefusalSchema = Refusal;

/**
 * The JSON Schema document of {@link StoredRecordSchema}: the stored record, every integer its
 * decimal digits.
 */
export const StoredRecordJsonSchema: JsonSchema.Document<"draft-2020-12"> =
  Schema.toJsonSchemaDocument(StoredRecordSchema);

/**
 * The JSON Schema document of {@link StoredTestSessionSchema}: the stored test session, each
 * item's record a stored record. It checks shape only, as its Schema does.
 */
export const StoredTestSessionJsonSchema: JsonSchema.Document<"draft-2020-12"> =
  Schema.toJsonSchemaDocument(StoredTestSessionSchema);

/**
 * The JSON Schema document of {@link RedactedJsonSchema}: the redacted item's JSON form, its body
 * nodes a recursive definition.
 */
export const RedactedJsonJsonSchema: JsonSchema.Document<"draft-2020-12"> =
  Schema.toJsonSchemaDocument(RedactedJsonSchema);

/**
 * The JSON Schema document of {@link ConfigurationSchema}: the input a host configures with, every
 * key optional.
 */
export const ConfigurationJsonSchema: JsonSchema.Document<"draft-2020-12"> =
  Schema.toJsonSchemaDocument(ConfigurationSchema);

/**
 * The JSON Schema document of {@link RefusalSchema}: a refusal in the JSON form
 * `Schema.toCodecJson` writes, its optional `readerRule` and `suggestion` each an object tagged
 * `Some` with its `value`, or `None`.
 */
export const RefusalJsonSchema: JsonSchema.Document<"draft-2020-12"> =
  Schema.toJsonSchemaDocument(RefusalSchema);
