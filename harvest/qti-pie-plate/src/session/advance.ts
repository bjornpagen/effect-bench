/**
 * One entry point over a test session's intents: {@link advance} carries out what a request asks,
 * through the moves of `#plate/session/navigate.ts` and the submissions of
 * `#plate/session/submit.ts`, and refuses what the test's rules forbid now with an
 * {@link IntentRefused}.
 *
 * `allowedIntents` of `#plate/session/intents.ts` lists exactly the intents this accepts now, given
 * responses that pass the item's checks, so a host can offer those and post any of them. Every
 * function is pure: time is the `now` the host passes, and nothing is kept between calls.
 *
 * This is a boundary module, not a browser module: it checks a step's responses with the value
 * Schema, and it calls the submissions, which call `score`, and `score` reads and writes the stored
 * record through its Schema codec.
 *
 * @module
 */
import { Data, Option, Result, Schema } from "effect";
import { encodeRecord } from "#plate/codec/record.ts";
import type { InvalidRecord } from "#plate/codec/record.ts";
import { ResponseValueSchema } from "#plate/codec/values.ts";
import type { Configuration } from "#plate/configuration.ts";
import type { EngineFailure } from "#plate/engine/evaluate.ts";
import type { ResponseValue } from "#plate/model/values.ts";
import type { ValidationMessage } from "#plate/payload.ts";
import { fitting, score, splitResponses } from "#plate/score.ts";
import type {
  InvalidResponses,
  RecordMismatch,
  RecordRequired,
  ResponsesRefused,
} from "#plate/score.ts";
import type { UnknownItemRef } from "#plate/session/control.ts";
import { move, requestOf } from "#plate/session/navigate.ts";
import type { MoveRefused, MoveRule, MoveStep } from "#plate/session/navigate.ts";
import type { Intent, Responses, SessionItem, Step, TestSession } from "#plate/session/session.ts";
import { ItemNotInSession, current, valuesOf } from "#plate/session/start.ts";
import type { InvalidTime, TestNotDeliverable } from "#plate/session/start.ts";
import { deliveredItem, endPart, submitItem, submitPart } from "#plate/session/submit.ts";
import type { SubmissionFailure, SubmissionRefused } from "#plate/session/submit.ts";
import type { Accepted, AcceptedTest } from "#plate/validate/verdict.ts";

/**
 * Why {@link advance} refuses an intent: exactly the rules the test's navigation and submission
 * modes and its item session control give.
 *
 * - `test-closed`: the test has closed, so it takes no intent.
 * - `linear-back`: `previous` in a linear part.
 * - `linear-jump`: `go` to another item than the current one in a linear part, or `end-part` in a
 *   linear, individual part, whose last item's `next` ends it.
 * - `start-of-part`: `previous` from the first item of a nonlinear part.
 * - `end-of-part`: `next` from the last item of a part that `end-part` or `submit-part` ends.
 * - `out-of-range`: `go` to a sequence index that names no item of the current part.
 * - `wrong-submission-mode`: `submit-item` or `end-part` in a simultaneous part, or `submit-part` in
 *   an individual one.
 * - `attempts-exhausted`: the item's processed attempts have reached its attempt limit.
 * - `item-closed`: the item is closed for another reason.
 * - `skipping-not-allowed`: the item's `allow-skipping` is false and every response is NULL or its
 *   declared default.
 * - `responses-invalid`: the item's `validate-responses` is true and a response breaks a limit of its
 *   interaction; or `score` refuses the responses of an item `submit-part` processes, which break a
 *   limit the item sets whatever the configuration (tier (a)); or `score` would refuse the
 *   responses of the item a `next` leaves in a linear, simultaneous part, which the candidate
 *   cannot return to before `submit-part` processes it. The refusal carries the messages and names
 *   the item they concern.
 */
export type IntentRule =
  | "attempts-exhausted"
  | "end-of-part"
  | "item-closed"
  | "linear-back"
  | "linear-jump"
  | "out-of-range"
  | "responses-invalid"
  | "skipping-not-allowed"
  | "start-of-part"
  | "test-closed"
  | "wrong-submission-mode";

/**
 * The failure of {@link advance} for an intent the test's rules forbid now.
 *
 * `rule` says which rule refuses it, and `sequenceIndex` names the item it concerns: the current
 * item, except for a `submit-part` refused for another item's responses, where it is that item's;
 * none once the test has closed. `messages` holds what the item's interactions say about the
 * responses for `responses-invalid`, ready for `render`'s `messages` option with the instance of
 * the item `sequenceIndex` names, and is empty for every other rule.
 *
 * `refusal` is the move's or the submission's own refusal, with what it knows of the place, such as
 * the part's first and last items; it is none for the three refusals `advance` makes itself:
 * `test-closed`, `end-part` in a linear, individual part, and `next` in a linear, simultaneous part
 * whose item's responses `score` would refuse (`responses-invalid`). A refused intent changes
 * nothing, the responses the request carried included.
 */
export class IntentRefused extends Data.TaggedError("IntentRefused")<{
  readonly intent: Intent;
  readonly messages: readonly ValidationMessage[];
  readonly refusal: Option.Option<MoveRefused | SubmissionRefused>;
  readonly rule: IntentRule;
  readonly sequenceIndex: Option.Option<number>;
}> {
  /**
   * The request, the rule that refuses it, and what to post instead.
   */
  override get message(): string {
    const request = requestOf(this.intent);
    const item = Option.match(this.sequenceIndex, {
      onNone: () => "the current item",
      onSome: (index) => `item ${index}`,
    });

    return Option.match(this.refusal, {
      onNone: () => {
        if (this.rule === "test-closed") {
          return `The test session has closed, so it takes no ${request}. Show the summary current gives instead.`;
        }

        if (this.rule === "responses-invalid") {
          const said = this.messages.map((entry) => `${entry.response}: ${entry.text}`).join("; ");

          return `The ${request} from ${item} is refused (${this.rule}) and nothing it posted is saved: its part is linear, so the candidate cannot return to the item, and its responses break limits the item sets whatever the configuration (${said}), so score would refuse them when the part is submitted. Show these messages on that item, for example through render's messages option with its instance, and post ${request} again with corrected responses.`;
        }

        return `The ${request} from ${item} is refused (${this.rule}): its part is linear with individual submission, so the candidate leaves it only with next, which on the part's last item submits that item when it has no processed attempt and ends the part. Offer next instead.`;
      },
      onSome: (refusal) =>
        refusal._tag === "SubmissionRefused" && this.intent.kind === "next"
          ? `The next from ${item} submits it first, since its part is linear with individual submission and it has no processed attempt, and that submission is refused (${this.rule}): ${refusal.message}`
          : refusal.message,
    });
  }
}

/**
 * The failure of {@link advance} for a step whose responses do not fit the current item: a response
 * the item does not score, one that is not a value or a record, one of another base type or
 * cardinality than its declaration, a record for a response that is not a record response, or a
 * value for one that is. A host-caused error, returned through a `Result`.
 *
 * `response` is the first such response's identifier, `issue` what is wrong with it, and
 * `sequenceIndex` the current item's. `decode` gives only responses that fit, so a host meets this
 * when it builds or changes values itself. The step is refused before any transition records it,
 * so the session keeps what it held, the item's saved responses included.
 */
export class StepResponseMisfit extends Data.TaggedError("StepResponseMisfit")<{
  readonly issue: string;
  readonly response: string;
  readonly sequenceIndex: number;
}> {
  /**
   * The response, what is wrong with it, and what to post instead.
   */
  override get message(): string {
    const name = JSON.stringify(this.response);

    return `The step's response ${name} does not fit item ${this.sequenceIndex}, so the step is refused and nothing it carried is saved: ${this.issue}. Post each response as decode gives it from the item's form, a value of its declaration's base type and cardinality, or a record for a record response, or leave ${name} out of the step.`;
  }
}

/**
 * Why {@link advance} may fail.
 *
 * {@link IntentRefused} is the test's rules refusing the intent, a `submit-part` whose `score`
 * refuses an item's responses and a `next` in a linear, simultaneous part whose item's responses
 * `score` would refuse among them (`responses-invalid`, naming the item).
 *
 * {@link StepResponseMisfit} is a step whose responses do not fit the current item's declarations,
 * refused before anything is saved. `ResponsesRefused` is `score` refusing the responses
 * `submit-item`, or a `next` that submits first, processes on the current item; `InvalidResponses`
 * is `score` refusing a response an item held before the step that does not fit its declaration,
 * which only a session the host changed holds; and `EngineFailure` is an item's processing
 * failing, or a run of the test's outcome processing, which follows each submission and the test's
 * close, failing over a stored item record that lacks a value it reads. The rest pass through from
 * the moves and the submissions for what a host passes that does not fit: `InvalidTime` for an
 * invalid `now`, `ItemNotInSession` and `UnknownItemRef` for a session that is not the test's,
 * `TestNotDeliverable` for items that lack the one an intent reaches or hold another document's,
 * and `InvalidRecord` and `RecordMismatch` for an item record `score` cannot take.
 * `RecordRequired` is `score`'s, which a session never meets, since it always passes the item's
 * record.
 */
export type AdvanceFailure =
  | EngineFailure
  | IntentRefused
  | InvalidRecord
  | InvalidResponses
  | InvalidTime
  | ItemNotInSession
  | RecordMismatch
  | RecordRequired
  | ResponsesRefused
  | StepResponseMisfit
  | TestNotDeliverable
  | UnknownItemRef;

/**
 * What every transition of one {@link advance} call works with.
 */
interface Advancing {
  readonly configuration: Configuration;
  readonly items: ReadonlyMap<string, Accepted>;
  /**
   * Whether the current part is linear with individual submission: the one combination where
   * `next` submits an item with no processed attempt first, `next` on the last item ends the part,
   * and `end-part` is not offered. A move never leaves its part and a submission keeps it, so this
   * holds for the whole call.
   */
  readonly linearIndividual: boolean;
  /**
   * Whether the current part is linear with simultaneous submission: the combination where `next`
   * leaves an item for good while its attempt waits for `submit-part`, so `next` first checks the
   * item's responses as `score` will.
   */
  readonly linearSimultaneous: boolean;
  readonly now: Date;
  readonly test: AcceptedTest;
}

/**
 * Give the {@link IntentRefused} for a move's refusal.
 *
 * @param intent The intent posted.
 * @param refusal The move's refusal.
 * @param rule Its rule, which {@link advance} never lets be `unsubmitted`.
 * @returns The refusal.
 */
const refusedMove = (
  intent: Intent,
  refusal: MoveRefused,
  rule: Exclude<MoveRule, "unsubmitted">,
): IntentRefused =>
  new IntentRefused({
    intent,
    messages: [],
    refusal: Option.some(refusal),
    rule,
    sequenceIndex: refusal.from.pipe(Option.map((origin) => origin.sequenceIndex)),
  });

/**
 * Give the {@link IntentRefused} for an intent posted once the test has closed.
 *
 * @param intent The intent posted.
 * @returns The `test-closed` refusal.
 */
const closedRefusal = (intent: Intent): IntentRefused =>
  new IntentRefused({
    intent,
    messages: [],
    refusal: Option.none(),
    rule: "test-closed",
    sequenceIndex: Option.none(),
  });

/**
 * Turn a submission's refusal into an {@link IntentRefused} for the intent posted, leaving its other
 * failures as they are, the `EngineFailure` of a run of the test's outcome processing among them.
 *
 * @param intent The intent posted.
 * @param result What the submission returned.
 * @returns The same result, a {@link SubmissionRefused} read as the intent's refusal.
 */
const asIntent = (
  intent: Intent,
  result: Result.Result<TestSession, SubmissionFailure>,
): Result.Result<TestSession, AdvanceFailure> =>
  Result.mapError(result, (failure) =>
    failure._tag === "SubmissionRefused"
      ? new IntentRefused({
          intent,
          messages: failure.messages,
          refusal: Option.some(failure),
          rule: failure.rule,
          sequenceIndex: failure.sequenceIndex,
        })
      : failure,
  );

/**
 * Submit the current item with the request's responses, its refusal read as the intent's.
 *
 * @param advancing What the call works with.
 * @param session The session.
 * @param step The request: `submit-item`, or a `next` that submits first.
 * @returns The session with the attempt processed, or an {@link AdvanceFailure}.
 */
const submitted = (
  advancing: Advancing,
  session: TestSession,
  step: Step,
): Result.Result<TestSession, AdvanceFailure> =>
  asIntent(
    step.intent,
    submitItem(advancing.test, advancing.items, session, step, advancing.configuration, {
      now: advancing.now,
    }),
  );

/**
 * Check the item a `next` left in a linear, simultaneous part the way `submit-part` will process
 * it: `score` over its record with its saved responses, the attempt it gives discarded.
 *
 * The candidate cannot return to an item of a linear part, and `submit-part` processes it with the
 * responses it holds when it is left. So responses `score` refuses (tier (a)) would refuse the
 * part's submission with no way to correct them; they refuse the `next` instead, as
 * `responses-invalid` naming the item, with `score`'s messages. Tier (b), `validate-responses`,
 * does not apply in a simultaneous part.
 *
 * @param advancing What the call works with.
 * @param session The session the `next` was posted on.
 * @param moved The session after the move, whose item at `session`'s position holds the step.
 * @param intent The intent posted.
 * @returns `moved` when `score` takes the item's responses; {@link IntentRefused}
 *   `responses-invalid` when it refuses them; what `score` or the record's codec fails with
 *   otherwise, which `submit-part` would meet.
 */
const leftScoreable = (
  advancing: Advancing,
  session: TestSession,
  moved: TestSession,
  intent: Intent,
): Result.Result<TestSession, AdvanceFailure> =>
  Result.gen(function* checkLeftItem() {
    const left = yield* Result.fromOption(
      Option.fromUndefinedOr(moved.items[session.position]),
      () =>
        new ItemNotInSession({ count: moved.items.length, sequenceIndex: session.position + 1 }),
    );
    const accepted = yield* deliveredItem(advancing.items, moved, left);
    const attempt = score(accepted, valuesOf(left), yield* encodeRecord(left.record));
    if (Result.isFailure(attempt) && attempt.failure._tag === "ResponsesRefused") {
      return yield* Result.fail(
        new IntentRefused({
          intent,
          messages: attempt.failure.messages,
          refusal: Option.none(),
          rule: "responses-invalid",
          sequenceIndex: Option.some(left.sequenceIndex),
        }),
      );
    }

    yield* attempt;

    return moved;
  });

/**
 * Carry out `next`, `previous` or `go`.
 *
 * The move decides through `moveTarget`. Where it refuses `next` from a linear, individual item
 * with no processed attempt (`unsubmitted`), the item is submitted with the request's responses
 * first and the move is made again from there. Where it refuses `next` from the last item of a
 * linear, individual part (`end-of-part`), the part ends instead, as its last item's `next` does.
 * Any other refusal is the intent's. In a linear, simultaneous part, a `next` the move takes is
 * refused when `score` would refuse the responses of the item it leaves (`responses-invalid`).
 *
 * @param advancing What the call works with.
 * @param session The session.
 * @param step The move, and the responses posted with it.
 * @returns The session after the move, or the part's end; an {@link AdvanceFailure}.
 */
const moved = (
  advancing: Advancing,
  session: TestSession,
  step: MoveStep,
): Result.Result<TestSession, AdvanceFailure> =>
  Result.orElse(
    Result.flatMap(
      move(advancing.test, advancing.items, session, step, advancing.now),
      (after): Result.Result<TestSession, AdvanceFailure> =>
        step.intent.kind === "next" && advancing.linearSimultaneous
          ? leftScoreable(advancing, session, after, step.intent)
          : Result.succeed(after),
    ),
    (failure): Result.Result<TestSession, AdvanceFailure> => {
      if (failure._tag !== "MoveRefused") {
        return Result.fail(failure);
      }

      const { rule } = failure;
      if (rule === "unsubmitted") {
        return Result.flatMap(submitted(advancing, session, step), (after) =>
          moved(advancing, after, { intent: step.intent }),
        );
      }

      if (rule === "end-of-part" && advancing.linearIndividual) {
        return asIntent(
          step.intent,
          endPart(advancing.test, advancing.items, session, step, { now: advancing.now }),
        );
      }

      return Result.fail(refusedMove(step.intent, failure, rule));
    },
  );

/**
 * Say what is wrong with one response a step carries, as the current item declares it.
 *
 * The response must be a value or a record, as the response value Schema checks one, then fit the
 * item's declarations as `fitting` checks a record's responses: a response the item scores, of its
 * declaration's base type and cardinality, and a record under a record response's identifier and
 * nowhere else. `fitting` reads a whole record, so it is handed the current record with this
 * response as its only response or record and no outcomes, and judges nothing else. It judges a
 * record's shape only, as `score` does, never its fields' values.
 *
 * @param accepted The current item.
 * @param entry The current session item.
 * @param identifier The response's identifier.
 * @param value The value the step carries for it.
 * @returns The issue, in words that name the response, or none when it fits.
 */
const responseMisfit = (
  accepted: Accepted,
  entry: SessionItem,
  identifier: string,
  value: ResponseValue,
): Option.Option<string> =>
  Result.match(Schema.encodeResult(ResponseValueSchema)(value), {
    onFailure: (error) =>
      Option.some(
        `its response ${JSON.stringify(identifier)} is not a value or a record: ${error.message.replaceAll(/\s*\n\s*/gu, " ")}`,
      ),
    onSuccess: () =>
      Option.map(
        Result.getFailure(
          fitting(accepted.item, {
            ...entry.record,
            outcomes: {},
            ...splitResponses({ [identifier]: value }),
          }),
        ),
        ({ issue }) => issue,
      ),
  });

/**
 * Check that the responses a step carries fit the current item's declarations, before any
 * transition records them.
 *
 * A step that carries no responses, as one for a closed item does once {@link advance} has left
 * them out, has nothing to check, and needs no item. Otherwise the current item is looked up among
 * the items, as a submission looks it up.
 *
 * @param items The test's items, keyed by item ref identifier.
 * @param session The session, whose current item takes the responses.
 * @param step The step as it will be carried out.
 * @returns The step; {@link StepResponseMisfit} for the first response that does not fit;
 *   `ItemNotInSession` for a session whose position is past its items; `TestNotDeliverable` when
 *   the items lack the current item or hold another document's.
 */
const fittingStep = (
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
): Result.Result<Step, ItemNotInSession | StepResponseMisfit | TestNotDeliverable> =>
  Result.gen(function* checkStep() {
    const responses: Responses = step.responses ?? {};
    const entries = Object.entries(responses);
    if (entries.length === 0) {
      return step;
    }

    const entry = yield* Result.fromOption(
      Option.fromUndefinedOr(session.items[session.position]),
      () =>
        new ItemNotInSession({ count: session.items.length, sequenceIndex: session.position + 1 }),
    );
    const accepted = yield* deliveredItem(items, session, entry);
    for (const [identifier, value] of entries) {
      const issue = responseMisfit(accepted, entry, identifier, value);
      if (Option.isSome(issue)) {
        return yield* Result.fail(
          new StepResponseMisfit({
            issue: issue.value,
            response: identifier,
            sequenceIndex: entry.sequenceIndex,
          }),
        );
      }
    }

    return step;
  });

/**
 * Carry out a step's intent through the transition that owns it, which saves the step first.
 *
 * @param advancing What the call works with.
 * @param session The session.
 * @param step The step: its responses checked, or left out when the current item is closed.
 * @param sequenceIndex The current item's sequence index, which an `end-part` refusal names.
 * @returns The session after the intent, or an {@link AdvanceFailure}.
 */
const carriedOut = (
  advancing: Advancing,
  session: TestSession,
  step: Step,
  sequenceIndex: number,
): Result.Result<TestSession, AdvanceFailure> => {
  const { intent } = step;
  const context = { now: advancing.now };
  switch (intent.kind) {
    case "go":
    case "next":
    case "previous": {
      return moved(advancing, session, { ...step, intent });
    }
    case "submit-item": {
      return submitted(advancing, session, step);
    }
    case "submit-part": {
      return asIntent(intent, submitPart(advancing.test, advancing.items, session, step, context));
    }
    case "end-part": {
      return advancing.linearIndividual
        ? Result.fail(
            new IntentRefused({
              intent,
              messages: [],
              refusal: Option.none(),
              rule: "linear-jump",
              sequenceIndex: Option.some(sequenceIndex),
            }),
          )
        : asIntent(intent, endPart(advancing.test, advancing.items, session, step, context));
    }
    default: {
      return intent satisfies never;
    }
  }
};

/**
 * Carry out what one request asks of a test session: move, submit the current item or part, or end
 * the current part, after saving the responses it posts on the current item while that item is
 * open.
 *
 * Each intent goes to the transition that owns it, which saves the step first. When the current
 * item is closed (its view is `disabled`), the step goes on with its intent alone: the responses it
 * carries are ignored, nothing is refused for them, and the item keeps the values it closed with,
 * which `itemView` shows and `results` reports. So a host may post a closed item's form as
 * rendered, whose disabled controls post nothing, or pass whatever it decoded. On an open item,
 * each response the step carries must first fit the item's declarations, as a value of a response
 * the item scores, of its declaration's base type and cardinality; a step holding one that does not
 * is refused with {@link StepResponseMisfit} before its intent is tried, and nothing is saved. In a
 * linear part with individual submission, `next` from an item with no processed attempt submits it
 * first and then moves, and `next` on the part's last item ends the part; `end-part` is not offered
 * there and is refused (`linear-jump`). In a linear part with simultaneous submission, `next` is
 * refused (`responses-invalid`) when `score` would refuse the responses of the item it leaves,
 * which the candidate cannot return to before `submit-part` processes it. A refused intent returns
 * no session, so nothing it carried is saved. `allowedIntents` lists exactly the intents this
 * accepts now, given responses that pass the item's `allow-skipping`, `validate-responses` and
 * `score`'s own checks.
 *
 * @example
 *   advance(test, items, session, { intent: { kind: "next" }, responses }, configuration, {
 *     now: new Date(),
 *   });
 *
 * @param test The test the session was started from.
 * @param items The test's items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The intent, and the responses posted with it, which are checked and saved only on an
 *   open item.
 * @param configuration The host's configuration, whose locale a submission's messages take.
 * @param context The transition.
 * @param context.now When it happens.
 * @returns The session after the intent; {@link StepResponseMisfit} when a response the step
 *   carries does not fit the current item; {@link IntentRefused} when the test's rules forbid it
 *   now; another {@link AdvanceFailure} when `score` refuses the responses or the host's arguments
 *   do not fit.
 */
export const advance = (
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: Step,
  configuration: Configuration,
  context: { readonly now: Date },
): Result.Result<TestSession, AdvanceFailure> => {
  if (session.status === "closed") {
    return Result.fail(closedRefusal(step.intent));
  }

  return Result.flatMap(
    current(test, session, configuration),
    (shown): Result.Result<TestSession, AdvanceFailure> => {
      const { intent } = step;
      if (shown.kind === "summary") {
        return Result.fail(closedRefusal(intent));
      }

      const carried: Step = shown.disabled ? { intent } : step;
      const advancing: Advancing = {
        configuration,
        items,
        linearIndividual: shown.navigation === "linear" && shown.submission === "individual",
        linearSimultaneous: shown.navigation === "linear" && shown.submission === "simultaneous",
        now: context.now,
        test,
      };

      return Result.flatMap(fittingStep(items, session, carried), (checked) =>
        carriedOut(advancing, session, checked, shown.sequenceIndex),
      );
    },
  );
};
