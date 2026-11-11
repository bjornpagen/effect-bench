/**
 * The Effect versions of the session lifecycle: {@link begin}, {@link startTest}, {@link advance}
 * and {@link results}.
 *
 * Each calls its plain function and lifts the plain `Result` with `Effect.fromResult`, so a mirror
 * succeeds and fails exactly as the plain function does given the same arguments. What a mirror
 * changes is where the arguments the plain function takes from its caller come from: the time from
 * Effect's `Clock`, an absent seed from {@link drawnSeed}, and the configuration from the
 * {@link Configuration} service. A program provides `TestClock` or its own `Randomness` to fix
 * them; the plain functions keep taking `now`, the datestamp and their seeds. Nothing outside
 * `src/effect/` imports this module.
 *
 * Each runs in a span named for it, `plate.begin` and the rest, whose attributes are identifiers
 * and counts, and logs each decision it takes for its caller at the debug level, after it: a seed
 * drawn, a datestamp taken from the `Clock`. No span attribute or log holds a seed, a response, a
 * record value or a stored form, since a program may export its telemetry where the page's data
 * must not go; a failure is recorded by its span, never logged.
 *
 * @module
 */
import { DateTime, Effect } from "effect";
import { begin as plainBegin } from "#plate/begin.ts";
import type { InvalidRecord, StoredRecord } from "#plate/codec/record.ts";
import type { InvalidSession, SessionMismatch } from "#plate/codec/session.ts";
import { Configuration } from "#plate/effect/configuration.ts";
import { drawnSeed } from "#plate/effect/randomness.ts";
import type { EngineFailure } from "#plate/engine/evaluate.ts";
import { results as plainResults } from "#plate/results/results.ts";
import type {
  InvalidResultContext,
  ResultItemMissing,
  ResultsInput as PlainResultsInput,
} from "#plate/results/results.ts";
import type { RecordMismatch } from "#plate/score.ts";
import { advance as plainAdvance } from "#plate/session/advance.ts";
import type { AdvanceFailure } from "#plate/session/advance.ts";
import type { Step, TestSession } from "#plate/session/session.ts";
import { startTest as plainStartTest } from "#plate/session/start.ts";
import type {
  InvalidSessionInstance,
  InvalidTime,
  TestNotDeliverable,
} from "#plate/session/start.ts";
import type { Accepted, AcceptedTest } from "#plate/validate/verdict.ts";

/**
 * What {@link results} reports: the plain `ResultsInput`, but an item's `datestamp` may be left
 * out, and then it is the `Clock`'s now.
 */
type ClockedResultsInput =
  | (Omit<Extract<PlainResultsInput, { readonly kind: "item" }>, "datestamp"> & {
      readonly datestamp?: Date;
    })
  | Extract<PlainResultsInput, { readonly kind: "test" }>;

/**
 * Give the host's seed, or draw one through `Randomness` and log at the debug level that a seed
 * was drawn, under the operation's identifier and `seed.source: "drawn"`, never the seed.
 *
 * @param given The host's seed, used as given, `""` included; none to draw one.
 * @param identifier The operation's identifier annotation, such as `item.identifier`.
 * @returns The seed.
 */
const seedOf = (
  given: string | undefined,
  identifier: Readonly<Record<string, string>>,
): Effect.Effect<string> =>
  given === undefined
    ? Effect.tap(drawnSeed, () =>
        Effect.logDebug("a seed was drawn").pipe(
          Effect.annotateLogs({ ...identifier, "seed.source": "drawn" }),
        ),
      )
    : Effect.succeed(given);

/**
 * Start the stored record of an item's first attempt, as the plain `begin` does, drawing its seed
 * through `Randomness` when the host gives none.
 *
 * A host's seed is used as given, `""` included, and then nothing is drawn. Absent, the seed is
 * {@link drawnSeed}'s, in `drawSeed`'s format, so the same document, instance and drawn bytes give
 * the record the plain `begin` gives under that seed. Its span, `plate.begin`, carries
 * `item.identifier`.
 *
 * @example
 *   begin(accepted, { instance: "q1" });
 *   // an Effect of the record begin(accepted, { instance: "q1", seed }) gives in the plain API,
 *   // under the seed Randomness draws
 *
 * @param document The document `check` accepted.
 * @param start The use of the item the record starts.
 * @param start.instance The host's name for this use of the item, which scopes its ids.
 * @param start.seed The host's seed, which keys every value template processing draws, used as
 *   given; with none, one is drawn through `Randomness`.
 * @returns The record of the first attempt, in the form the host stores, or the plain `begin`'s
 *   failure: {@link InvalidRecord} at stage `encode`, a renderer defect, or an
 *   {@link EngineFailure} from template processing.
 */
export const begin = Effect.fn("plate.begin")(function* begin(
  document: Accepted,
  start: { readonly instance: string; readonly seed?: string },
): Effect.fn.Return<StoredRecord, EngineFailure | InvalidRecord> {
  const identifier = { "item.identifier": document.item.identifier };
  yield* Effect.annotateCurrentSpan(identifier);

  const seed = yield* seedOf(start.seed, identifier);

  return yield* Effect.fromResult(plainBegin(document, { instance: start.instance, seed }));
});

/**
 * Start a test session, as the plain `startTest` does, at the `Clock`'s now, under the
 * {@link Configuration} service, drawing the processing seed through `Randomness` when the host
 * gives none.
 *
 * The configuration's `seed` stays the session's shuffle seed and never its processing seed. A
 * host's processing seed is used as given, and then nothing is drawn. Its span, `plate.startTest`,
 * carries `test.identifier` and `items.count`.
 *
 * @example
 *   startTest(test, items, { instance: "sitting-42" }).pipe(Effect.provide(ConfigurationFromEnv));
 *
 * @param test The test, as `check` accepted it.
 * @param items The test's items, each as `check` accepted it, keyed by the identifier of the item
 *   ref that names its document.
 * @param context The sitting.
 * @param context.instance The host's name for this sitting, which scopes every item's ids: a token
 *   `checkInstance` passes, such as a lowercase UUID.
 * @param context.seed The processing seed, which keys every value the session's processing draws,
 *   used as given; with none, one is drawn through `Randomness`. Server data: keep it from the
 *   page.
 * @returns The session, or the plain `startTest`'s failure: {@link TestNotDeliverable},
 *   {@link InvalidSessionInstance}, an {@link EngineFailure} of the first part's template defaults,
 *   or {@link InvalidTime}, which only a `Clock` whose time is not a number gives.
 */
export const startTest = Effect.fn("plate.startTest")(function* startTest(
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  context: { readonly instance: string; readonly seed?: string },
): Effect.fn.Return<
  TestSession,
  EngineFailure | InvalidSessionInstance | InvalidTime | TestNotDeliverable,
  Configuration
> {
  const identifier = { "test.identifier": test.test.identifier };
  yield* Effect.annotateCurrentSpan({ ...identifier, "items.count": items.size });

  const configuration = yield* Configuration;
  const now = yield* DateTime.nowAsDate;
  const seed = yield* seedOf(context.seed, identifier);

  return yield* Effect.fromResult(
    plainStartTest(test, items, configuration, { instance: context.instance, now, seed }),
  );
});

/**
 * Carry out what one request asks of a test session, as the plain `advance` does, at the
 * `Clock`'s now and under the {@link Configuration} service. Its span, `plate.advance`, carries
 * `test.identifier` and `intent.kind`, never the step's responses.
 *
 * @example
 *   advance(test, items, session, { intent: { kind: "next" }, responses }).pipe(
 *     Effect.provide(ConfigurationFromEnv),
 *   );
 *
 * @param test The test the session was started from.
 * @param items The test's items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The intent, and the responses posted with it, which are checked and saved only on an
 *   open item.
 * @returns The session after the intent, or the plain `advance`'s {@link AdvanceFailure}; its
 *   `InvalidTime` only a `Clock` whose time is not a number gives.
 */
export const advance = Effect.fn("plate.advance")(function* advance(
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
): Effect.fn.Return<TestSession, AdvanceFailure, Configuration> {
  yield* Effect.annotateCurrentSpan({
    "intent.kind": step.intent.kind,
    "test.identifier": test.test.identifier,
  });

  const configuration = yield* Configuration;
  const now = yield* DateTime.nowAsDate;

  return yield* Effect.fromResult(plainAdvance(test, items, session, step, configuration, { now }));
});

/**
 * Take an item's datestamp from the `Clock`'s now, and log at the debug level that it came from
 * the `Clock`, under the item's identifier and never the time.
 *
 * @param identifier The item's `item.identifier` annotation.
 * @returns The `Clock`'s now.
 */
const clockedDatestamp = (identifier: Readonly<Record<string, string>>): Effect.Effect<Date> =>
  Effect.tap(DateTime.nowAsDate, () =>
    Effect.logDebug("the datestamp came from the Clock").pipe(Effect.annotateLogs(identifier)),
  );

/**
 * Write the Results Reporting document for an item or a test session, as the plain `results`
 * does, where an item's `datestamp` left out is the `Clock`'s now.
 *
 * The plain `datestamp` is the `Date` of the item session's last change, so a host that writes an
 * item's result as that change happens leaves it out; one that writes it later passes the time of
 * the change. A test session's result reads its times from the stored session, never the `Clock`.
 * Its span, `plate.results`, carries `results.kind` and the item's `item.identifier` or the test's
 * `test.identifier`, and a datestamp taken from the `Clock` is logged at the debug level.
 *
 * @example
 *   results({ context: { sourcedId: "candidate-1" }, document: accepted, kind: "item", record });
 *   // its itemResult's datestamp is the Clock's now
 *
 * @param input The item or the test session to report, and the context; an item's `datestamp` may
 *   be left out.
 * @returns The document's text, or the plain `results`' failure: {@link InvalidResultContext},
 *   {@link InvalidRecord}, {@link InvalidSession}, {@link SessionMismatch}, {@link RecordMismatch}
 *   or {@link ResultItemMissing}.
 */
export const results = Effect.fn("plate.results")(function* results(
  input: ClockedResultsInput,
): Effect.fn.Return<
  string,
  | InvalidRecord
  | InvalidResultContext
  | InvalidSession
  | RecordMismatch
  | ResultItemMissing
  | SessionMismatch
> {
  if (input.kind === "test") {
    yield* Effect.annotateCurrentSpan({
      "results.kind": "test",
      "test.identifier": input.test.test.identifier,
    });

    return yield* Effect.fromResult(plainResults(input));
  }

  const identifier = { "item.identifier": input.document.item.identifier };
  yield* Effect.annotateCurrentSpan({ ...identifier, "results.kind": "item" });

  const datestamp = input.datestamp ?? (yield* clockedDatestamp(identifier));

  return yield* Effect.fromResult(plainResults({ ...input, datestamp }));
});
