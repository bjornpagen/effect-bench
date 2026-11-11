/**
 * Submission in a test session: {@link submitItem} processes the current item's attempt in an
 * individual part, {@link submitPart} processes every presented item of a simultaneous part and
 * ends it, and {@link endPart} ends an individual part and leaves what it holds unprocessed.
 *
 * Each saves the step through `recordStep` first, then enforces the item session control the test
 * sets, then runs `score` over each item's own record, whose instance is the session's instance, a
 * `.` and the item's sequence index. After the items' response processing, and once more when the
 * test closes, the test's outcome processing runs over the session (`runOutcomes`). A refusal is a
 * {@link SubmissionRefused} naming the rule it breaks. Every function is pure: time is the `now`
 * the host passes, and nothing is kept between calls.
 *
 * This is a boundary module, not a browser module: it calls `score`, which reads and writes the
 * stored record through its Schema codec.
 *
 * @module
 */
import { Array as Arr, Data, Option, Result } from "effect";
import { decodeRecord, encodeRecord } from "#plate/codec/record.ts";
import type { InvalidRecord } from "#plate/codec/record.ts";
import type { Configuration } from "#plate/configuration.ts";
import type { EngineFailure } from "#plate/engine/evaluate.ts";
import { runOutcomes, testScopeOf } from "#plate/engine/outcome.ts";
import { drawStream, outcomeLabel } from "#plate/engine/random.ts";
import { own } from "#plate/engine/refs.ts";
import type { Item } from "#plate/model/item.ts";
import { refIdentifiersIn } from "#plate/model/item-refs.ts";
import type { ItemRecord } from "#plate/model/record.ts";
import type { Test, TestPart } from "#plate/model/test.ts";
import { atDefault, isNullResponse } from "#plate/model/values.ts";
import type { ResponseValue } from "#plate/model/values.ts";
import { postingsIn, redactStructure } from "#plate/payload.ts";
import type { ValidationMessage } from "#plate/payload.ts";
import { checkResponses } from "#plate/responses.ts";
import { score } from "#plate/score.ts";
import type {
  InvalidResponses,
  RecordMismatch,
  RecordRequired,
  ResponsesRefused,
} from "#plate/score.ts";
import { attemptLimits, UnknownItemRef } from "#plate/session/control.ts";
import { elapsedSeconds } from "#plate/session/elapsed.ts";
import type { Responses, SessionItem, Step, TestSession } from "#plate/session/session.ts";
import {
  ItemNotInSession,
  TestNotDeliverable,
  itemView,
  partStarted,
  present,
  recordStep,
  valuesOf,
  withItem,
} from "#plate/session/start.ts";
import type { InvalidTime } from "#plate/session/start.ts";
import type { Accepted, AcceptedTest } from "#plate/validate/verdict.ts";

/**
 * The intents this module carries out.
 */
export type SubmissionIntent = "end-part" | "submit-item" | "submit-part";

/**
 * Why a submission is refused.
 *
 * - `test-closed`: the test has closed, so it takes no intent.
 * - `wrong-submission-mode`: the intent is not the current part's: `submit-item` and `end-part`
 *   belong to an individual part, `submit-part` to a simultaneous one.
 * - `attempts-exhausted`: the item's processed attempts have reached its attempt limit.
 * - `item-closed`: the item is closed for another reason.
 * - `skipping-not-allowed`: the item's `allow-skipping` is false and every response a page can post
 *   is NULL or its default: the one the item's template processing set, else its declared one.
 * - `responses-invalid`: the item's `validate-responses` is true and a response breaks a limit of its
 *   interaction; or, for `submit-part`, `score` refuses a presented item's responses, which break a
 *   limit the item sets whatever the configuration (tier (a)). The refusal carries the messages and
 *   names the item they concern.
 */
export type SubmissionRule =
  | "attempts-exhausted"
  | "item-closed"
  | "responses-invalid"
  | "skipping-not-allowed"
  | "test-closed"
  | "wrong-submission-mode";

/**
 * What each intent does in the part it belongs to, as {@link SubmissionRefused}'s message for
 * `wrong-submission-mode` writes it.
 */
const modeRemedies: Readonly<Record<SubmissionIntent, string>> = {
  "end-part":
    "The current part submits its items together, so it takes no end-part. Post submit-part, which processes its items and ends it.",
  "submit-item":
    "The current part submits its items together, so it takes no submit-item. Post submit-part to submit every item of the part.",
  "submit-part":
    "The current part submits each item on its own, so it takes no submit-part. Post submit-item for the current item, or end-part to end the part.",
};

/**
 * A submission the test's rules refuse now, with the rule it breaks.
 *
 * `intent` is the intent refused. `sequenceIndex` names the item the refusal concerns: the current
 * item, except for a `submit-part` whose `score` refuses another item's responses, where it is that
 * item's; none when the test has closed. `messages` holds what the item's interactions say about
 * its responses for `responses-invalid`, ready for `render`'s `messages` option with that item's
 * instance, and is empty for every other rule.
 */
export class SubmissionRefused extends Data.TaggedError("SubmissionRefused")<{
  readonly intent: SubmissionIntent;
  readonly messages: readonly ValidationMessage[];
  readonly rule: SubmissionRule;
  readonly sequenceIndex: Option.Option<number>;
}> {
  /**
   * The rule, the item it concerns, and what to post instead.
   */
  override get message(): string {
    const item = Option.match(this.sequenceIndex, {
      onNone: () => "The current item",
      onSome: (index) => `Item ${index}`,
    });

    switch (this.rule) {
      case "attempts-exhausted": {
        return `${item} has used every attempt its max-attempts allows, so it takes no further submit-item. Move to another item, or end the part.`;
      }
      case "item-closed": {
        return `${item} is closed, so it takes no submit-item. Move to an open item, or end the part.`;
      }
      case "responses-invalid": {
        const said = this.messages.map((entry) => `${entry.response}: ${entry.text}`).join("; ");

        return this.intent === "submit-part"
          ? `${item}'s saved responses break limits the item sets whatever the configuration (${said}), so score refuses them and the part is not submitted. Show these messages on that item, for example through render's messages option with its instance, and submit the part again once its responses are corrected.`
          : `${item} validates its responses (validate-responses is true), and they break its interactions' limits (${said}). Show these messages, for example through render's messages option, and submit the corrected responses.`;
      }
      case "skipping-not-allowed": {
        return `${item} may not be skipped (allow-skipping is false), and every response posted for it is NULL or the default it started with. Give at least one response another value, then submit again.`;
      }
      case "test-closed": {
        return `The test session has closed, so it takes no ${this.intent}. Show the summary current gives instead.`;
      }
      case "wrong-submission-mode": {
        return modeRemedies[this.intent];
      }
      default: {
        return this.rule satisfies never;
      }
    }
  }
}

/**
 * Why `score` and the stored record's codec may fail an item's attempt. It holds `score`'s
 * `RecordRequired`, which a session never meets, since it always passes the item's record.
 */
type ScoreFailure =
  | EngineFailure
  | InvalidRecord
  | InvalidResponses
  | RecordMismatch
  | RecordRequired
  | ResponsesRefused;

/**
 * Why {@link endPart}, or the end of a part, may fail: a refusal, a stored session that does not
 * fit the test or the items passed, or an invalid `now`. An end that closes the test runs its
 * outcome processing, which fails with an `EngineFailure` over a stored session whose item record
 * lacks a value the processing reads. An end that moves on to a part gives template defaults: a
 * nonlinear part's, every item's, as it starts, and a linear part's, its first item's, as that item
 * is presented. Each fails with an `EngineFailure` when a default does not fit its item, which only
 * a test and items checked apart can give, or reads a value the session's records lack.
 *
 * Processing that reads an item's context variable through its item ref (`ITEMREF.VAR` naming the
 * item's `qti-context-declaration`) reads a value the engine never holds, since the item marks
 * that declaration. `openPackage` marks such processing, and it never runs. A test and items
 * checked apart, each `open`ed alone, cannot see an item's context declaration, so there a read of
 * one fails `UnknownIdentifierError`: that is the path of documents checked apart (OD-P9-14).
 */
export type PartEndFailure =
  | EngineFailure
  | InvalidTime
  | ItemNotInSession
  | SubmissionRefused
  | TestNotDeliverable
  | UnknownItemRef;

/**
 * Why {@link submitItem} or {@link submitPart} may fail: a refusal, a part end's failures, or an
 * attempt `score` cannot run. The outcome processing {@link submitItem} runs after each submission
 * fails as a closing part end's does ({@link PartEndFailure}): `openPackage` marks processing that
 * reads an item's context variable through its item ref, and it never runs, while a test and items
 * checked apart, each `open`ed alone, cannot see an item's context declaration, so there a read of
 * one fails `UnknownIdentifierError` (OD-P9-14). For responses that break a tier (a) limit,
 * {@link submitItem} passes `score`'s `ResponsesRefused` through, and {@link submitPart} refuses
 * with `responses-invalid` naming the item.
 */
export type SubmissionFailure = PartEndFailure | ScoreFailure;

/**
 * Find the test part that holds an item ref, with its index among the test's parts.
 *
 * @param test The test.
 * @param ref The item ref's identifier.
 * @returns The part and its index, or {@link UnknownItemRef} when no part holds the ref.
 */
const partHolding = (
  test: Test,
  ref: string,
): Result.Result<{ readonly index: number; readonly part: TestPart }, UnknownItemRef> =>
  Result.fromOption(
    Arr.findFirst(test.parts, (part, index) =>
      refIdentifiersIn(part.children).includes(ref) ? Option.some({ index, part }) : Option.none(),
    ),
    () => new UnknownItemRef({ ref, test: test.identifier }),
  );

/**
 * Refuse a submission once the test has closed.
 *
 * @param session The session.
 * @param intent The intent posted.
 * @returns The session while it is open, or {@link SubmissionRefused} `test-closed`.
 */
const stillOpen = (
  session: TestSession,
  intent: SubmissionIntent,
): Result.Result<TestSession, SubmissionRefused> =>
  session.status === "closed"
    ? Result.fail(
        new SubmissionRefused({
          intent,
          messages: [],
          rule: "test-closed",
          sequenceIndex: Option.none(),
        }),
      )
    : Result.succeed(session);

/**
 * Find a session's current item: the item at its position.
 *
 * @param session The session.
 * @returns The item's index in `session.items` and the item, or {@link ItemNotInSession} when the
 *   position is past the items.
 */
const currentItem = (
  session: TestSession,
): Result.Result<readonly [number, SessionItem], ItemNotInSession> => {
  const item = session.items[session.position];

  return item === undefined
    ? Result.fail(
        new ItemNotInSession({ count: session.items.length, sequenceIndex: session.position + 1 }),
      )
    : Result.succeed([session.position, item]);
};

/**
 * Find the accepted item the host passed for a session item, and check it is the item its record
 * belongs to.
 *
 * @param items The accepted items, keyed by item ref identifier.
 * @param session The session.
 * @param item The session item.
 * @returns The accepted item, or {@link TestNotDeliverable}: `item-missing` when the items have no
 *   entry for its ref, `item-mismatch` when its entry is the item of another document.
 */
export const deliveredItem = (
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  item: SessionItem,
): Result.Result<Accepted, TestNotDeliverable> => {
  const accepted = items.get(item.ref);
  const expected = item.record.document;
  if (accepted === undefined) {
    return Result.fail(
      new TestNotDeliverable({
        expected,
        found: Option.none(),
        reason: "item-missing",
        ref: item.ref,
        test: session.test,
      }),
    );
  }

  return accepted.document === expected
    ? Result.succeed(accepted)
    : Result.fail(
        new TestNotDeliverable({
          expected,
          found: Option.some(accepted.document),
          reason: "item-mismatch",
          ref: item.ref,
          test: session.test,
        }),
      );
};

/**
 * Say whether an item's responses skip it.
 *
 * The information model defines an item as skipped when every response variable is submitted with
 * its default value or is NULL, and an item with no response variable as never skipped (Table
 * 7.19.6, `allow-skipping`; "all responses submitted with their default value or NULL",
 * `info.txt:68904`). A response is at its default when it `match`es the default the attempt starts
 * it with (D4-11): the one the record's `defaults` holds, which the item's template processing set
 * (`qti-set-default-value`, `info.txt:65219`), else its declaration's `qti-default-value`. So a
 * response left at a default template processing set skips the item as one left at a declared
 * default does, and a value equal to the declared default answers it when template processing set
 * another. A record response counts beside the others: it is at its default when it holds the
 * fields of its declared one, in any order (`sameRecord`), since template processing never sets a
 * record, and a NULL record, one with no field, is NULL.
 *
 * Only the responses a rendered page can post count: those `postings` lists for the item redacted
 * under its record (ruling R2 of phase 4's repair, 2026-11-06), read through `redactStructure`,
 * which decides what `redactItem` decides and prints no text, so the template values the page was
 * shown with decide which interactions count, as they decide what `checkResponses` judges. A
 * response no interaction binds, one bound only to an interaction shown as a notice or held by a
 * template block the record hides, or one of a base type no interaction posts never takes another
 * value from the candidate, so counting it would leave an item under `allow-skipping` false that
 * can never be submitted and, in a linear part, never left. An item with no response a page can
 * post is treated as an item with no response variable: never skipped. A value a step carries for
 * a response that is not counted does not answer the item either.
 *
 * @param item The item.
 * @param record The item's record: the template values its page was shown with, the outcomes its
 *   redaction reads, and the defaults its template processing set.
 * @param instance The item's instance, which names its postings.
 * @param values The responses, by identifier; one left out is NULL.
 * @returns Whether the item is skipped.
 */
const skipped = (
  item: Item,
  record: Pick<ItemRecord, "defaults" | "outcomes" | "templates">,
  instance: string,
  values: Responses,
): boolean => {
  const posted = new Set(
    postingsIn(redactStructure(item, record), instance).map(({ identifier }) => identifier),
  );
  const counted: readonly {
    readonly fallback: Option.Option<ResponseValue>;
    readonly identifier: string;
  }[] = [
    ...Array.from(item.responses.values(), ({ defaultValue, identifier }) => ({
      fallback: Option.orElse(own(record.defaults, identifier), () => defaultValue),
      identifier,
    })),
    ...Array.from(item.records?.values() ?? [], ({ defaultValue, identifier }) => ({
      fallback: defaultValue,
      identifier,
    })),
  ].filter(({ identifier }) => posted.has(identifier));

  return (
    counted.length > 0 &&
    counted.every(({ fallback, identifier }) => {
      const value = Object.hasOwn(values, identifier) ? values[identifier] : undefined;

      return (
        value === undefined ||
        isNullResponse(value) ||
        Option.exists(fallback, (declared) => atDefault(value, declared))
      );
    })
  );
};

/**
 * Process one attempt of a session item: run `score` over its record, encoded to the form `score`
 * takes and decoded back, and clear its saved responses.
 *
 * The attempt that processes the item's first attempt writes its outcomes to `firstOutcomes`,
 * which no later attempt changes (F1).
 *
 * @param accepted The item the session item delivers.
 * @param item The session item.
 * @param values The responses to process.
 * @param datestamp The time of the transition, in ISO 8601.
 * @returns The session item after the attempt, or what `score` or the record's codec failed with.
 */
const processed = (
  accepted: Accepted,
  item: SessionItem,
  values: Responses,
  datestamp: string,
): Result.Result<SessionItem, ScoreFailure> =>
  Result.gen(function* processAttempt() {
    const stored = yield* score(accepted, values, yield* encodeRecord(item.record));
    const record = yield* decodeRecord(stored);

    return {
      ...item,
      datestamp,
      firstOutcomes: Option.orElse(item.firstOutcomes, () => Option.some(record.outcomes)),
      record,
      saved: Option.none(),
    };
  });

/**
 * Process one attempt of a session item as part of a part's submission: as {@link processed}, but
 * `score`'s refusal of the item's responses becomes a {@link SubmissionRefused} that names the
 * item, since the part's other items, the current one among them, are not the item it concerns.
 *
 * @param accepted The item the session item delivers.
 * @param item The session item.
 * @param datestamp The time of the transition, in ISO 8601.
 * @returns The session item after the attempt; `responses-invalid` naming the item with `score`'s
 *   messages; or what `score` or the record's codec failed with otherwise.
 */
const processedInPart = (
  accepted: Accepted,
  item: SessionItem,
  datestamp: string,
): Result.Result<SessionItem, ScoreFailure | SubmissionRefused> =>
  Result.mapError(processed(accepted, item, valuesOf(item), datestamp), (failure) =>
    failure._tag === "ResponsesRefused"
      ? new SubmissionRefused({
          intent: "submit-part",
          messages: failure.messages,
          rule: "responses-invalid",
          sequenceIndex: Option.some(item.sequenceIndex),
        })
      : failure,
  );

/**
 * Run the test's outcome processing over a session once, and store what it leaves.
 *
 * Run `n` is `outcomeRuns + 1`. It starts every test outcome from its declared default, else its
 * starting value (`info.txt:9236`), reads the test's items through the session's test scope, whose
 * `duration` is the seconds from the session's start to `now` and whose items count the attempts
 * they have started under their item refs' limits, as the results report does, and draws from
 * `drawStream(session.seed, outcomeLabel(session.instance, n))`, the processing seed under its own
 * label, never the default key. The session then holds the outcomes it left and `outcomeRuns` `n`.
 * A test whose outcome processing is `absent`, or `marked` because the engine cannot run it, runs
 * nothing: its outcomes stay at their defaults and no run is counted.
 *
 * @param test The test.
 * @param items The accepted items, keyed by item ref identifier.
 * @param session The session, its items' attempts already processed.
 * @param now The time of the transition.
 * @returns The session after the run, or the {@link EngineFailure} the run failed with: a stored
 *   item record that lacks a value the processing reads.
 */
const outcomesProcessed = (
  test: Test,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  now: Date,
): Result.Result<TestSession, EngineFailure> => {
  if (test.outcomeProcessing.kind !== "runs") {
    return Result.succeed(session);
  }

  const run = session.outcomeRuns + 1;
  const elapsed = elapsedSeconds(Date.parse(session.started), now.getTime());
  const scope = testScopeOf(test, items, session, attemptLimits(test), Option.some(elapsed));

  return Result.map(
    runOutcomes(test, scope, drawStream(session.seed, outcomeLabel(session.instance, run))),
    (outcomes) => ({ ...session, outcomeRuns: run, outcomes }),
  );
};

/**
 * End a test part: move to the next part that holds an item, whose first item is presented, or
 * close the test when no such part follows.
 *
 * The parts between, which hold no item, end as the candidate reaches them, as at the start. When
 * the next part is nonlinear, its items' template defaults are evaluated as it starts, before its
 * first item is presented (`partStarted`), over the test's outcomes as the session holds them:
 * after a simultaneous part's submission, those its outcome run left. When the test closes, its
 * outcome processing runs once more, at the same `now` as any run before it in the transition.
 *
 * @param test The test.
 * @param items The accepted items, keyed by item ref identifier.
 * @param session The session, its step already saved.
 * @param ending The index of the part that ends, among the test's parts.
 * @param now The time of the transition.
 * @returns The session after the part's end; {@link UnknownItemRef} when the session holds no item
 *   for the next part's first item ref; a failure of `partStarted` or of `present`; or the
 *   `EngineFailure` of the closing outcome run.
 */
const partEnded = (
  test: Test,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  ending: number,
  now: Date,
): Result.Result<TestSession, PartEndFailure> => {
  const next = Arr.findFirst(test.parts, (part, index) =>
    index > ending
      ? Option.map(Arr.head(refIdentifiersIn(part.children)), (ref) => ({ index, part, ref }))
      : Option.none(),
  );
  const reached = Option.match(next, {
    onNone: () => test.parts.length,
    onSome: ({ index }) => index,
  });
  const parts = session.parts.map((part, index) => {
    if (index < ending || index > reached) {
      return part;
    }

    return {
      identifier: part.identifier,
      status: index === reached ? "current" : "ended",
    } as const;
  });

  return Option.match(next, {
    onNone: () => outcomesProcessed(test, items, { ...session, parts, status: "closed" }, now),
    onSome: ({ part, ref }) =>
      Result.gen(function* startNextPart() {
        const [position, item] = yield* Result.fromOption(
          Arr.findFirst(session.items, (each, index) =>
            each.ref === ref ? Option.some([index, each] as const) : Option.none(),
          ),
          () => new UnknownItemRef({ ref, test: test.identifier }),
        );
        const begun = yield* partStarted(test, items, { ...session, parts, position }, part);

        return yield* present(test, items, begun, item.sequenceIndex, now);
      }),
  });
};

/**
 * Submit the current item of an individual part: process one attempt over its responses.
 *
 * The step is saved first. Then, in order: a closed test is `test-closed`; a simultaneous part is
 * `wrong-submission-mode`; an item whose processed attempts, the record's `numAttempts`, have
 * reached its effective attempt limit above 0 is `attempts-exhausted`, and an item closed otherwise
 * `item-closed`; under `allow-skipping` false an item whose every response a page can post is NULL
 * or its default, the one its record's template processing set or else its declared one, is
 * `skipping-not-allowed`, a record response counted beside the others; under `validate-responses`
 * true, responses `checkResponses` gives messages for, a record response's typed text among them,
 * are `responses-invalid`. `checkResponses` judges them under the item's record, the template
 * values its page was shown with, so a choice its template hides is refused and one it shows is
 * judged as the page showed it, and an interaction a hidden template block holds is not judged.
 * Otherwise `score` runs over the item's record with its saved responses, and its failures,
 * `ResponsesRefused` among them, pass through. The test's outcome processing then runs over the
 * session, and its `EngineFailure` passes through. The item stays current: moving on is a move's.
 *
 * @example
 *   submitItem(test, items, session, { intent: { kind: "submit-item" }, responses }, configuration, {
 *   now: new Date(),
 *   });
 *
 * @param test The test the session was started from.
 * @param items The test's items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The request: the responses it posts are saved and processed; its intent is not read,
 *   so a step of another intent can submit the item first.
 * @param configuration The host's configuration, whose locale the messages take.
 * @param context The transition.
 * @param context.now When it happens.
 * @returns The session with the attempt processed, or a {@link SubmissionFailure}.
 */
export const submitItem = (
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
  configuration: Configuration,
  context: { readonly now: Date },
): Result.Result<TestSession, SubmissionFailure> =>
  Result.gen(function* submitCurrentItem() {
    const saved = yield* stillOpen(yield* recordStep(session, step, context.now), "submit-item");
    const [index, item] = yield* currentItem(saved);
    const view = yield* itemView(test, saved, configuration, item.sequenceIndex);
    const refuse = (rule: SubmissionRule, messages: readonly ValidationMessage[] = []) =>
      Result.fail(
        new SubmissionRefused({
          intent: "submit-item",
          messages,
          rule,
          sequenceIndex: Option.some(item.sequenceIndex),
        }),
      );
    if (view.submission === "simultaneous") {
      return yield* refuse("wrong-submission-mode");
    }

    const limit = view.configuration.maxAttempts;
    if (limit > 0 && item.record.numAttempts >= limit) {
      return yield* refuse("attempts-exhausted");
    }

    if (view.disabled) {
      return yield* refuse("item-closed");
    }

    const accepted = yield* deliveredItem(items, saved, item);
    const values = valuesOf(item);
    if (
      !view.configuration.allowSkipping &&
      skipped(accepted.item, item.record, view.instance, values)
    ) {
      return yield* refuse("skipping-not-allowed");
    }

    const messages = view.configuration.validateResponses
      ? checkResponses(accepted, values, view.configuration, item.record)
      : [];
    if (messages.length > 0) {
      return yield* refuse("responses-invalid", messages);
    }

    const done = yield* processed(accepted, item, values, saved.updated);

    return yield* outcomesProcessed(
      test.test,
      items,
      { ...saved, items: withItem(saved, index, done) },
      context.now,
    );
  });

/**
 * Submit the current part when it is simultaneous: process every presented item of it, then end
 * it.
 *
 * The step is saved first. A closed test is `test-closed`; an individual part is
 * `wrong-submission-mode`. Each presented item of the part is processed once, in sequence, with its
 * saved responses over its record's; `allow-skipping` and `validate-responses` do not apply in a
 * simultaneous part. An item the candidate never saw is not processed: it closes as it is, with
 * NULL responses, its default outcomes and `numAttempts` 0. The test's outcome processing then runs
 * once, over every item the part processed, and the part ends as {@link endPart} ends one, which
 * runs it once more when the test closes. An attempt `score` cannot run, or an outcome run's
 * `EngineFailure`, fails the whole submission: where `score` refuses an item's responses (tier
 * (a)), the refusal is `responses-invalid` naming that item, which need not be the current one,
 * with `score`'s messages.
 *
 * @param test The test the session was started from.
 * @param items The test's items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The request, whose responses are saved on the current item first.
 * @param context The transition.
 * @param context.now When it happens.
 * @returns The session after the part's end, or a {@link SubmissionFailure}.
 */
export const submitPart = (
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
  context: { readonly now: Date },
): Result.Result<TestSession, SubmissionFailure> =>
  Result.gen(function* submitCurrentPart() {
    const saved = yield* stillOpen(yield* recordStep(session, step, context.now), "submit-part");
    const [, item] = yield* currentItem(saved);
    const { index, part } = yield* partHolding(test.test, item.ref);
    if (part.submission !== "simultaneous") {
      return yield* Result.fail(
        new SubmissionRefused({
          intent: "submit-part",
          messages: [],
          rule: "wrong-submission-mode",
          sequenceIndex: Option.some(item.sequenceIndex),
        }),
      );
    }

    const members = new Set(refIdentifiersIn(part.children));
    const after = yield* Result.all(
      saved.items.map((entry) =>
        members.has(entry.ref) && entry.presented
          ? Result.flatMap(deliveredItem(items, saved, entry), (accepted) =>
              processedInPart(accepted, entry, saved.updated),
            )
          : Result.succeed(entry),
      ),
    );

    const afterRun = yield* outcomesProcessed(
      test.test,
      items,
      { ...saved, items: after },
      context.now,
    );

    return yield* partEnded(test.test, items, afterRun, index, context.now);
  });

/**
 * End the current part when it is individual, leaving its items as they are.
 *
 * The step is saved first. A closed test is `test-closed`; a simultaneous part, which ends only by
 * {@link submitPart}, is `wrong-submission-mode`. No item is processed: an item with saved,
 * unsubmitted responses keeps them, unscored, and every item of the part closes. The next part
 * that holds an item becomes current and its first item is presented, the parts between ending as
 * the candidate passes them; when none follows, the test closes and its outcome processing runs,
 * its `duration` read at the close.
 *
 * @param test The test the session was started from.
 * @param items The test's items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The request, whose responses are saved on the current item first.
 * @param context The transition.
 * @param context.now When it happens.
 * @returns The session after the part's end, or a {@link PartEndFailure}.
 */
export const endPart = (
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
  context: { readonly now: Date },
): Result.Result<TestSession, PartEndFailure> =>
  Result.gen(function* endCurrentPart() {
    const saved = yield* stillOpen(yield* recordStep(session, step, context.now), "end-part");
    const [, item] = yield* currentItem(saved);
    const { index, part } = yield* partHolding(test.test, item.ref);
    if (part.submission === "simultaneous") {
      return yield* Result.fail(
        new SubmissionRefused({
          intent: "end-part",
          messages: [],
          rule: "wrong-submission-mode",
          sequenceIndex: Option.some(item.sequenceIndex),
        }),
      );
    }

    return yield* partEnded(test.test, items, saved, index, context.now);
  });
