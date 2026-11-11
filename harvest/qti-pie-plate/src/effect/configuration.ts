/**
 * The renderer's configuration as an Effect service: {@link Configuration}, provided from the
 * `PLATE_` environment by {@link ConfigurationFromEnv} or from settings in hand by
 * {@link configurationLayer}.
 *
 * Both layers decode through the plain module's one Schema, so a setting means the same thing
 * however it arrives, and both refuse with the plain `InvalidConfiguration`.
 *
 * @module
 */
import { ConfigProvider, Context, Effect, Layer } from "effect";
import type {
  InvalidConfiguration,
  Configuration as PlainConfiguration,
} from "#plate/configuration.ts";
import { configuration, configure, invalidConfiguration } from "#plate/configuration.ts";

/**
 * The renderer's configuration, every field decoded and defaulted, as a service an Effect program
 * requires.
 *
 * It has no default: a program that reads it states, in its requirements, that some layer chose
 * the configuration, so a forgotten setting is a type error rather than a silent default.
 */
export class Configuration extends Context.Service<Configuration, PlainConfiguration>()(
  "@qti-pie/plate/effect/Configuration",
) {}

/**
 * Prefix a provider's lookups so that a field reads its `PLATE_` variable.
 *
 * A field's path is put in constant case (`String.configCase`, so `headingLevel` becomes
 * `HEADING_LEVEL`) and nested under `PLATE`, which the environment provider joins with `_` into
 * `PLATE_HEADING_LEVEL`. When the provider holds nothing under `PLATE`, the fallback's empty record
 * stands in for it, so every field takes its default instead of the whole configuration being
 * missing. Struct decoding reads only the configuration's own fields, so the tooling's other
 * `PLATE_` variables (`PLATE_CORPUS_DIR` and the like) are never read. `orElse` falls back per
 * path and only on a path that is absent (`effect/src/ConfigProvider.ts`, Effect 4.1.2), so it sits
 * outside the prefix: the fallback answers the unprefixed path, never `PLATE` under it.
 *
 * @param current The provider in effect, the process environment unless a layer replaced it.
 * @returns The provider the configuration is decoded from.
 */
const plateVariables = (current: ConfigProvider.ConfigProvider): ConfigProvider.ConfigProvider =>
  ConfigProvider.orElse(
    current.pipe(ConfigProvider.constantCase, ConfigProvider.nested("PLATE")),
    ConfigProvider.fromUnknown({}),
  );

/**
 * Provide {@link Configuration} from the `PLATE_` variables of the provider in effect.
 *
 * Each field reads the variable named for it, `PLATE_` and its name in constant case
 * (`PLATE_HEADING_LEVEL` for `headingLevel`), and takes its default when the variable is absent or
 * empty. A program with no provider of its own reads the process environment; a test provides one
 * with `ConfigProvider.layer`. It runs under the span `plate.configure`, as `configure` does.
 *
 * @example
 *   program.pipe(Effect.provide(ConfigurationFromEnv)); // PLATE_HEADING_LEVEL=3 gives level 3
 */
export const ConfigurationFromEnv: Layer.Layer<Configuration, InvalidConfiguration> = Layer.effect(
  Configuration,
  Effect.gen(function* readPlateVariables() {
    const current = yield* ConfigProvider.ConfigProvider;

    return yield* configuration.parse(plateVariables(current));
  }).pipe(Effect.mapError(invalidConfiguration), Effect.withSpan("plate.configure")),
);

/**
 * Provide {@link Configuration} from settings in hand, as `configure` reads them.
 *
 * @example
 *   program.pipe(Effect.provide(configurationLayer({ headingLevel: 3 })));
 *
 * @param input The host's settings, an object keyed by field name.
 * @returns A layer providing the decoded configuration, or failing with `InvalidConfiguration`
 *   naming the first field outside its allowed values.
 */
export const configurationLayer = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host's settings arrive untyped, and `configure`, which this layer runs, is the parsing boundary that decodes them.
  input: unknown,
): Layer.Layer<Configuration, InvalidConfiguration> =>
  Layer.effect(Configuration, configure(input));
