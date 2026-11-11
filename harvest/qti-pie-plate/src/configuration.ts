/**
 * The renderer's configuration: the settings a host chooses once, decoded and defaulted by one
 * Schema, and {@link configure}, which reads them.
 *
 * @module
 */
import type { SchemaIssue } from "effect";
import { Config, ConfigProvider, Effect, Match, Option, Schema } from "effect";
import { locales } from "#plate/messages.ts";
import { defaultOutputBudget, maximumOutputBudget } from "#plate/output-budget.ts";

/**
 * The Schema of the renderer's configuration, which owns every field's constraint and default.
 *
 * Every key is optional in the input and takes its default when left out, so `{}` decodes to the
 * whole default configuration. The seven session-control fields are QTI's
 * `qti-item-session-control` settings; `maxAttempts` 0 means unlimited. `headingLevel` is the level
 * the item's shallowest heading takes, every other heading keeping its distance from it, capped at
 * `h6`; it starts at 2 because the host owns `h1`. `assetBase` `""` resolves asset URLs relative to
 * the package. `outputBudget` bounds the characters of HTML one `render` returns, counted as a
 * string's `length` counts them (UTF-16 code units), and is 16,777,216 (16 MiB of ASCII) by
 * default; past it `render` fails. `redact` takes the same budget as its last argument and stops
 * printing an item's printed variables once their text passes it, so `render` fails then too. Its
 * maximum, 536,870,888, is V8's longest string, the smallest of the engines' limits, so no budget
 * asks an engine for a string it cannot build. `seed` is a string, used as given: it keys a
 * shuffled Choice's order with the instance and the response, and nothing else. `startTest` keeps
 * it as the session's shuffle seed, which keys only the session's shuffles; with none, a session's
 * shuffle, like `render`'s, keys an absent seed as the empty string, so the order then follows the
 * instance alone. Processing never reads it: `begin` draws a record's seed when its own
 * `start.seed` is absent, and `startTest` draws a session's processing seed when its context's
 * `seed` is absent. So an item and a test session each have two seeds: the configuration's keys the
 * shuffle, and the record's or the session's keys the processing. {@link configure} reads an empty
 * `seed` as no seed.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `Configuration` is the Schema and the type of a configuration under one name, the interface the phase's slice list fixes, so a decoder and a signature read as one thing.
export const Configuration = Schema.Struct({
  allowComment: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  allowReview: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  allowSkipping: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  assetBase: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  headingLevel: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 2 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(2)),
  ),
  locale: Schema.Literals(locales).pipe(Schema.withDecodingDefaultKey(Effect.succeed("en"))),
  maxAttempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(1)),
  ),
  outputBudget: Schema.Int.check(
    Schema.isBetween({ maximum: maximumOutputBudget, minimum: 1 }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultOutputBudget))),
  seed: Schema.optionalKey(Schema.String),
  showFeedback: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  showSolution: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  validateResponses: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});

/**
 * The renderer's configuration, every field present except the optional `seed`.
 */
export type Configuration = typeof Configuration.Type;

/**
 * A field of the configuration.
 */
type Field = keyof Configuration;

/**
 * What each field admits, as {@link InvalidConfiguration}'s message writes it.
 */
const allowedValues: Readonly<Record<Field, string>> = {
  allowComment: "true or false",
  allowReview: "true or false",
  allowSkipping: "true or false",
  assetBase: "a string, the base the package's asset URLs resolve against",
  headingLevel: "an integer from 2 to 6",
  locale: `a supported locale: ${locales.map((locale) => `"${locale}"`).join(", ")}`,
  maxAttempts: "an integer of at least 0, where 0 means unlimited",
  outputBudget:
    "an integer from 1 to 536,870,888, the most characters of HTML one render may write",
  seed: 'a string, such as "7"',
  showFeedback: "true or false",
  showSolution: "true or false",
  validateResponses: "true or false",
};

/**
 * What the whole input admits when it is not an object of fields at all.
 */
const allowedInput = "an object of configuration fields, such as {} for every default";

/**
 * A configuration the renderer cannot run with: a field outside its allowed values, or an input
 * that is not an object of fields.
 *
 * `field` names the first field that fails, or is none when the input itself is not an object.
 * `allowed` says what that field, or the input, admits.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError<Self>()` is a class factory that is called once and extended, never thrown, so the rule's "call without new" reading does not apply.
export class InvalidConfiguration extends Schema.TaggedError<InvalidConfiguration>()(
  "InvalidConfiguration",
  {
    allowed: Schema.String,
    field: Schema.Option(Schema.String),
  },
) {
  /**
   * The field, what it admits, and what to change.
   */
  override get message(): string {
    return Option.match(this.field, {
      onNone: () => `The configuration is not an object. Pass ${this.allowed}.`,
      onSome: (field) =>
        `The configuration's ${field} is not allowed. Set it to ${this.allowed}, or leave it out.`,
    });
  }
}

/**
 * The configuration as an Effect `Config`, read from a provider at its root.
 *
 * {@link configure} reads it from a host's object, and the `./effect` layer `ConfigurationFromEnv`
 * from the `PLATE_` variables of the provider in effect, so both decode through one Schema.
 *
 * `Config.schema` (`effect/src/Config.ts`, Effect 4.1.2) decodes through the Schema's string-tree
 * form, so a field given as a number or a boolean and the same field given as its string, as an
 * environment holds it, decode alike.
 */
export const configuration = Config.schema(Configuration);

/**
 * Decide whether a property key names a configuration field.
 *
 * @param key The first segment of a failing path.
 * @returns Whether `key` is one of the configuration's fields.
 */
const isField = (key: PropertyKey): key is Field => Object.hasOwn(allowedValues, key);

/**
 * Find the key a decoding issue points at: the first segment of its first pointer.
 *
 * A struct reports a failing field as a `Composite` holding a `Pointer` whose path starts with the
 * field's key; the decode stops at the first failing field, so the first pointer names it.
 *
 * @param issue The issue `Config.schema` reported.
 * @returns The key of the first failing property, or none when the issue points at no property.
 */
const failingKey = (issue: SchemaIssue.Issue): Option.Option<PropertyKey> =>
  Match.value(issue).pipe(
    Match.tagsExhaustive({
      AnyOf: (anyOf) => Option.firstSomeOf(anyOf.issues.map(failingKey)),
      Composite: (composite) => Option.firstSomeOf(composite.issues.map(failingKey)),
      Encoding: (encoding) => failingKey(encoding.issue),
      Filter: (filter) => failingKey(filter.issue),
      Forbidden: () => Option.none(),
      InvalidType: () => Option.none(),
      InvalidValue: () => Option.none(),
      MissingKey: () => Option.none(),
      OneOf: () => Option.none(),
      Pointer: (pointer) => Option.fromNullishOr(pointer.path[0]),
      UnexpectedKey: () => Option.none(),
    }),
  );

/**
 * Turn a configuration that does not decode into {@link InvalidConfiguration}.
 *
 * An issue that points at no field, and a provider failure, which `ConfigProvider.fromUnknown`
 * never raises, are refusals of the input as a whole.
 *
 * @param error The failure `Config.schema` raised.
 * @returns The refusal naming the failing field and what it admits.
 */
export const invalidConfiguration = (error: Config.ConfigError): InvalidConfiguration => {
  const field = Schema.isSchemaError(error.cause)
    ? failingKey(error.cause.issue).pipe(Option.filter(isField))
    : Option.none();

  return Option.match(field, {
    onNone: () => new InvalidConfiguration({ allowed: allowedInput, field }),
    onSome: (key) => new InvalidConfiguration({ allowed: allowedValues[key], field }),
  });
};

/**
 * Read a configuration, filling every field the input leaves out with its default.
 *
 * The input is read as a `ConfigProvider.fromUnknown` provider, so a host that keeps the same
 * settings in its environment decodes them through the same {@link Configuration} Schema.
 *
 * @example
 *   configure({ headingLevel: 3 }); // succeeds with headingLevel 3 and every other default
 *
 * @param input The host's settings, an object keyed by field name.
 * @returns The decoded configuration, or {@link InvalidConfiguration} naming the first field outside
 *   its allowed values.
 */
export const configure = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host's settings arrive untyped, and this function is the parsing boundary that decodes them.
  input: unknown,
): Effect.Effect<Configuration, InvalidConfiguration> =>
  configuration
    .parse(ConfigProvider.fromUnknown(input))
    .pipe(Effect.mapError(invalidConfiguration), Effect.withSpan("plate.configure"));
