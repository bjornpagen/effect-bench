/**
 * The Effect versions of the plain API's `Result` functions, {@link redact}, {@link checkResponses}
 * and {@link acceptedItem}, with {@link Refused} and {@link PlateError}.
 *
 * Each mirror calls its plain function and lifts the plain `Result` with `Effect.fromResult`, so it
 * succeeds and fails exactly as the plain function does given the same arguments, and none
 * re-implements one. What a mirror changes is where the arguments a host passes the plain function
 * come from: the configuration from the {@link Configuration} service, and an instance `render`
 * would draw from {@link drawnInstance}. The rest take the plain parameters and read nothing. The
 * session lifecycle (`begin`, `startTest`, `advance`, `results`) is `#plate/effect/session.ts`'s.
 * Nothing outside `src/effect/` imports this module.
 *
 * The mirrors that do an item's or a session's work run in a span named for them, `plate.render`
 * and the rest, whose attributes are identifiers, counts and fixed vocabulary, and log at the debug
 * level, after it, an instance drawn for the caller. No span attribute or log holds a response, a
 * record value, the item's body or HTML, a stored form or a validation message's text, since a
 * program may export its telemetry where the page's data must not go; a failure is recorded by its
 * span, never logged. The short glue (`current`, `itemView`, `permits`, `allowedIntents`,
 * `navigationState`, `renderNavigation`, `decode` and `acceptedItem`) runs in no span of its own.
 *
 * @module
 */
import { Data, Effect, Option } from "effect";
import type { InvalidRecord, StoredRecord } from "#plate/codec/record.ts";
import {
  decodeRedacted as plainDecodeRedacted,
  encodeRedacted as plainEncodeRedacted,
} from "#plate/codec/redacted.ts";
import type { InvalidRedacted, RedactedJson } from "#plate/codec/redacted.ts";
import {
  decodeSession as plainDecodeSession,
  encodeSession as plainEncodeSession,
} from "#plate/codec/session.ts";
import type {
  InvalidSession,
  SessionMismatch,
  SessionTest,
  StoredTestSession,
} from "#plate/codec/session.ts";
import type { InvalidConfiguration } from "#plate/configuration.ts";
import { Configuration } from "#plate/effect/configuration.ts";
import { drawnInstance } from "#plate/effect/randomness.ts";
import type { StatusInput } from "#plate/emit/item.ts";
import type { UnknownPart } from "#plate/emit/parts.ts";
import type { MarkupRefused } from "#plate/emit/serialise.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import type {
  EngineFailure,
  OutcomeMismatchError,
  RecordOperandError,
  UnknownIdentifierError,
  UnmappedResponseError,
} from "#plate/engine/evaluate.ts";
import { decode as plainDecode } from "#plate/form/encoding.ts";
import type {
  Binding,
  DecodeOptions,
  Entry,
  Malformed,
  RecordBinding,
  ValueBinding,
} from "#plate/form/encoding.ts";
import type { RedactRecord, ResponsesRecord } from "#plate/model/record.ts";
import type { RecordValue, ResponseValue, Value } from "#plate/model/values.ts";
import {
  navigationState as plainNavigationState,
  renderNavigation as plainRenderNavigation,
} from "#plate/navigation.ts";
import type { NavigationOptions, NavigationState } from "#plate/navigation.ts";
import type { Redacted, ValidationMessage } from "#plate/payload.ts";
import {
  redact as plainRedact,
  render as plainRender,
  renderStatus as plainRenderStatus,
} from "#plate/render.ts";
import type {
  InvalidHeadingLevel,
  InvalidInstance,
  NotRedacted,
  Options,
  OutputTooLarge,
  Rendered,
} from "#plate/render.ts";
import { checkResponses as plainCheckResponses } from "#plate/responses.ts";
import { restore as plainRestore } from "#plate/restore.ts";
import type { Restored } from "#plate/restore.ts";
import type { InvalidResultContext, ResultItemMissing } from "#plate/results/results.ts";
import { score as plainScore } from "#plate/score.ts";
import type {
  InvalidResponses,
  RecordMismatch,
  RecordRequired,
  ResponsesRefused,
} from "#plate/score.ts";
import type { IntentRefused, StepResponseMisfit } from "#plate/session/advance.ts";
import type { UnknownItemRef } from "#plate/session/control.ts";
import { allowedIntents as plainAllowedIntents } from "#plate/session/intents.ts";
import type { Intent, Responses, TestSession } from "#plate/session/session.ts";
import {
  current as plainCurrent,
  itemView as plainItemView,
  permits as plainPermits,
} from "#plate/session/start.ts";
import type {
  Current,
  InvalidSessionInstance,
  InvalidTime,
  ItemNotInSession,
  ItemView,
  Permits,
  TestNotDeliverable,
} from "#plate/session/start.ts";
import type { Refusal } from "#plate/validate/refusal.ts";
import { acceptedItem as plainAcceptedItem } from "#plate/validate/verdict.ts";
import type { Accepted, AcceptedTest, Verdict, VerdictKind } from "#plate/validate/verdict.ts";

/**
 * A verdict that holds no accepted item, the failure of {@link acceptedItem}: the `Option` the plain
 * `acceptedItem` gives as none, as a failure a program can handle by tag.
 *
 * `document` and `kind` are the verdict's, and `verdict` its name. A `refused` verdict carries its
 * refusals; an `unchecked` one carries none (the host holds the verdict and its `reasons`); and a
 * verdict that accepts a test, a section or a stimulus carries none, with `kind` naming what it
 * accepted.
 */
export class Refused extends Data.TaggedError("Refused")<{
  readonly document: string;
  readonly kind: VerdictKind;
  readonly refusals: readonly Refusal[];
  readonly verdict: Verdict["verdict"];
}> {
  /**
   * What the verdict holds in place of an item, and what to open instead.
   */
  override get message(): string {
    switch (this.verdict) {
      case "accepted":
      case "accepted-with-unsupported": {
        return `The document ${this.document} was accepted as a ${this.kind}, not an item, so it holds no item to render. Read the ${this.kind} from the verdict's accepted field, or open an item document.`;
      }
      case "refused": {
        const count = this.refusals.length;

        return `The document ${this.document} was refused, so it holds no item to render: its verdict's ${count} ${count === 1 ? "refusal names" : "refusals name"} what breaks a rule and where. Correct the document and open it again.`;
      }
      case "unchecked": {
        return `The document ${this.document} was left unchecked, so it holds no item to render: it holds content plate cannot judge, which the verdict's reasons name. Open a document plate can check in full.`;
      }
      default: {
        return this.verdict satisfies never;
      }
    }
  }
}

/**
 * Every failure the plain API and its `./effect` mirrors return: each error class `src/index.ts`
 * exports, and {@link Refused}, so `Effect.catchTags` can handle each by its tag.
 *
 * `MarkupRefused`'s seven reasons (`VoidElementChildren` and the rest) are not members: each is the
 * `reason` of a `MarkupRefused`, which `Effect.catchReason` reaches.
 */
export type PlateError =
  | IntentRefused
  | InvalidConfiguration
  | InvalidHeadingLevel
  | InvalidInstance
  | InvalidRecord
  | InvalidRedacted
  | InvalidResponses
  | InvalidResultContext
  | InvalidSession
  | InvalidSessionInstance
  | InvalidTime
  | ItemNotInSession
  | Malformed
  | MarkupRefused
  | NotRedacted
  | OutcomeMismatchError
  | OutputTooLarge
  | PartSwapRefused
  | RecordMismatch
  | RecordOperandError
  | RecordRequired
  | Refused
  | ResponsesRefused
  | ResultItemMissing
  | SessionMismatch
  | StepResponseMisfit
  | TestNotDeliverable
  | UnknownIdentifierError
  | UnknownItemRef
  | UnknownPart
  | UnmappedResponseError;

/**
 * Draw an instance through `Randomness`, and log at the debug level that an instance was drawn,
 * under the item's identifier and never the instance.
 *
 * @param identifier The item's `item.identifier` annotation.
 * @returns The drawn instance.
 */
const drawnInstanceOf = (identifier: Readonly<Record<string, string>>): Effect.Effect<string> =>
  Effect.tap(drawnInstance, () =>
    Effect.logDebug("an instance was drawn").pipe(Effect.annotateLogs(identifier)),
  );

/**
 * Render an item, as the plain `render` does, under the {@link Configuration} service, drawing an
 * instance through `Randomness` when the host gives none.
 *
 * A host's instance is used as given, and then nothing is drawn. Absent, it is
 * {@link drawnInstance}'s, a lowercase UUID v4 in `drawInstance`'s format, drawn before the plain
 * call, so a render that fails has still drawn one; the same item, configuration, options and drawn
 * bytes give the HTML the plain `render` gives under that instance. Its span, `plate.render`,
 * carries `item.identifier` and `render.mode`, and a drawn instance is logged at the debug level.
 *
 * @example
 *   render(redacted, { mode: "review" }).pipe(Effect.provide(ConfigurationFromEnv));
 *   // an Effect of the Root's HTML and the instance drawn for it
 *
 * @param item The item `redact` gave, or `decodeRedacted`: that object itself, never a copy.
 * @param options The author's inputs, none by default.
 * @returns The Root's HTML and the instance it used, or the plain `render`'s failure:
 *   {@link NotRedacted}, {@link UnknownPart}, {@link InvalidInstance}, {@link PartSwapRefused},
 *   {@link InvalidHeadingLevel}, {@link MarkupRefused} or {@link OutputTooLarge}.
 */
export const render = Effect.fn("plate.render")(function* render(
  item: Redacted,
  options: Options = {},
): Effect.fn.Return<
  Rendered,
  | InvalidHeadingLevel
  | InvalidInstance
  | MarkupRefused
  | NotRedacted
  | OutputTooLarge
  | PartSwapRefused
  | UnknownPart,
  Configuration
> {
  const identifier = { "item.identifier": item.identifier };
  // The plain render's own default mode, so the attribute names the mode the HTML was written in.
  yield* Effect.annotateCurrentSpan({ ...identifier, "render.mode": options.mode ?? "answering" });

  const configuration = yield* Configuration;
  const instance = options.instance ?? (yield* drawnInstanceOf(identifier));

  return yield* Effect.fromResult(plainRender(item, configuration, { ...options, instance }));
});

/**
 * Render the Status part, as the plain `renderStatus` does, under the {@link Configuration}
 * service. Its span, `plate.renderStatus`, carries `status.heading`, the heading's vocabulary key.
 *
 * @param input The author's Status input.
 * @param options The part overrides, none by default.
 * @returns The region's HTML and `input.instance`, or the plain `renderStatus`'s failure:
 *   {@link InvalidInstance}, {@link UnknownPart}, {@link InvalidHeadingLevel},
 *   {@link PartSwapRefused} or {@link MarkupRefused}.
 */
export const renderStatus = Effect.fn("plate.renderStatus")(function* renderStatus(
  input: StatusInput,
  options: Pick<Options, "parts"> = {},
): Effect.fn.Return<
  Rendered,
  InvalidHeadingLevel | InvalidInstance | MarkupRefused | PartSwapRefused | UnknownPart,
  Configuration
> {
  yield* Effect.annotateCurrentSpan("status.heading", input.heading);

  const configuration = yield* Configuration;

  return yield* Effect.fromResult(plainRenderStatus(input, configuration, options));
});

/**
 * Render a test session's navigation parts, as the plain `renderNavigation` does, under the
 * {@link Configuration} service, which gives the labels' locale.
 *
 * @param state The navigation, as {@link navigationState} gives it.
 * @param options The part overrides and the parts' order, none by default.
 * @returns The Root's HTML, or the plain `renderNavigation`'s failure: {@link UnknownPart},
 *   {@link PartSwapRefused} or {@link MarkupRefused}.
 */
export const renderNavigation = Effect.fnUntraced(function* renderNavigation(
  state: NavigationState,
  options: NavigationOptions = {},
): Effect.fn.Return<string, MarkupRefused | PartSwapRefused | UnknownPart, Configuration> {
  const configuration = yield* Configuration;

  return yield* Effect.fromResult(plainRenderNavigation(state, configuration, options));
});

/**
 * Give what a test session shows now, as the plain `current` does, under the
 * {@link Configuration} service. The item's view is server data, as the plain `ItemView` says.
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @returns The current item's view or the summary, or the plain `current`'s failure:
 *   {@link ItemNotInSession} or {@link UnknownItemRef}.
 */
export const current = Effect.fnUntraced(function* current(
  test: AcceptedTest,
  session: TestSession,
): Effect.fn.Return<Current, ItemNotInSession | UnknownItemRef, Configuration> {
  const configuration = yield* Configuration;

  return yield* Effect.fromResult(plainCurrent(test, session, configuration));
});

/**
 * Give what an item of a test session renders with, as the plain `itemView` does, under the
 * {@link Configuration} service. The view is server data, as the plain `ItemView` says.
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @param sequenceIndex The item's sequence index, counted from 1.
 * @returns The item's view, or the plain `itemView`'s failure: {@link ItemNotInSession} or
 *   {@link UnknownItemRef}.
 */
export const itemView = Effect.fnUntraced(function* itemView(
  test: AcceptedTest,
  session: TestSession,
  sequenceIndex: number,
): Effect.fn.Return<ItemView, ItemNotInSession | UnknownItemRef, Configuration> {
  const configuration = yield* Configuration;

  return yield* Effect.fromResult(plainItemView(test, session, configuration, sequenceIndex));
});

/**
 * Read a redacted item from its JSON form, as the plain `decodeRedacted` does. Its span,
 * `plate.decodeRedacted`, carries the item's `item.identifier` once the form is read; a form it
 * refuses names none.
 *
 * @param input The JSON form, as the page received it.
 * @returns The redacted item, marked as `render` requires, or {@link InvalidRedacted} at stage
 *   `decode`.
 */
export const decodeRedacted = Effect.fn("plate.decodeRedacted")(function* decodeRedacted(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The page receives the JSON form as any value, and the plain decodeRedacted this lifts is the check that parses it.
  input: unknown,
): Effect.fn.Return<Redacted, InvalidRedacted> {
  const item = yield* Effect.fromResult(plainDecodeRedacted(input));
  yield* Effect.annotateCurrentSpan("item.identifier", item.identifier);

  return item;
});

/**
 * Write a redacted item in the JSON form a host sends to a page, as the plain `encodeRedacted`
 * does. Its span, `plate.encodeRedacted`, carries `item.identifier`.
 *
 * @param item The item `redact` gave.
 * @returns The JSON form, or {@link InvalidRedacted} at stage `encode`.
 */
export const encodeRedacted = Effect.fn("plate.encodeRedacted")(function* encodeRedacted(
  item: Redacted,
): Effect.fn.Return<RedactedJson, InvalidRedacted> {
  yield* Effect.annotateCurrentSpan("item.identifier", item.identifier);

  return yield* Effect.fromResult(plainEncodeRedacted(item));
});

/**
 * Read a stored test session back, as the plain `decodeSession` does. Its span,
 * `plate.decodeSession`, carries the test's `test.identifier`.
 *
 * @param input The stored session, as the host returned it.
 * @param test The test the session must belong to: the `AcceptedTest` `check` gave.
 * @returns The session, or the plain `decodeSession`'s failure: {@link SessionMismatch} or
 *   {@link InvalidSession} at stage `decode`.
 */
export const decodeSession = Effect.fn("plate.decodeSession")(function* decodeSession(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host stores the session and hands it back as any value, and the plain decodeSession this lifts is the check that parses it.
  input: unknown,
  test: SessionTest,
): Effect.fn.Return<TestSession, InvalidSession | SessionMismatch> {
  yield* Effect.annotateCurrentSpan("test.identifier", test.test.identifier);

  return yield* Effect.fromResult(plainDecodeSession(input, test));
});

/**
 * Write a test session in the form the host stores, as the plain `encodeSession` does. Its span,
 * `plate.encodeSession`, carries `test.identifier`.
 *
 * @param session The session.
 * @returns The stored session, or {@link InvalidSession} at stage `encode`.
 */
export const encodeSession = Effect.fn("plate.encodeSession")(function* encodeSession(
  session: TestSession,
): Effect.fn.Return<StoredTestSession, InvalidSession> {
  yield* Effect.annotateCurrentSpan("test.identifier", session.test);

  return yield* Effect.fromResult(plainEncodeSession(session));
});

/**
 * The shape of {@link decode}: the plain `decode`'s three overloads, each returning an Effect.
 */
interface Decode {
  /**
   * A value binding's entries decode to a value of its base type and cardinality.
   */
  (
    entries: readonly Entry[],
    binding: ValueBinding,
    options?: DecodeOptions,
  ): Effect.Effect<Value, Malformed>;
  /**
   * A record binding's entries decode to a record.
   */
  (
    entries: readonly Entry[],
    binding: RecordBinding,
    options?: DecodeOptions,
  ): Effect.Effect<RecordValue, Malformed>;
  /**
   * A binding of either kind decodes to either kind of value.
   */
  (
    entries: readonly Entry[],
    binding: Binding,
    options?: DecodeOptions,
  ): Effect.Effect<ResponseValue, Malformed>;
}

/**
 * Decode the entries a form posted for a binding of either kind, as the plain `decode`'s widest
 * overload does.
 *
 * @param entries The posted entries.
 * @param binding The response's binding.
 * @param options The number base of an integer, which a record binding ignores.
 * @returns The value, or {@link Malformed}.
 */
const decodeResponse = Effect.fnUntraced(function* decodeResponse(
  entries: readonly Entry[],
  binding: Binding,
  options?: DecodeOptions,
): Effect.fn.Return<ResponseValue, Malformed> {
  return yield* Effect.fromResult(plainDecode(entries, binding, options));
});

/**
 * Decode the entries a form posted as a value of one binding, as the plain `decode` does, with
 * each of its overloads: a value of the binding's base type for a value binding, a record for a
 * record binding.
 *
 * @example
 *   decode([["q1.RESPONSE", "A"]], { baseType: "identifier", cardinality: "single", name: "q1.RESPONSE" });
 *   // an Effect of the single identifier A
 */
export const decode =
  // SAFETY: decodeResponse succeeds with the plain decode's value, which is a record exactly when the binding's cardinality is `record`, which only a RecordBinding has, and a Value of the binding's base type otherwise, as each overload of the plain decode states.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SAFETY note above: one body cannot state the overloads to TypeScript, as the plain decode's cannot.
  decodeResponse as Decode;

/**
 * Give a test session's navigation now, as the plain `navigationState` does.
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @returns The navigation, or the plain `navigationState`'s failure: {@link ItemNotInSession} or
 *   {@link UnknownItemRef}.
 */
export const navigationState = Effect.fnUntraced(function* navigationState(
  test: AcceptedTest,
  session: TestSession,
): Effect.fn.Return<NavigationState, ItemNotInSession | UnknownItemRef> {
  return yield* Effect.fromResult(plainNavigationState(test, session));
});

/**
 * Read an item's stored record back, as the plain `restore` does. Its span, `plate.restore`,
 * carries `item.identifier`.
 *
 * @param document The document `check` accepted, the item the record is for.
 * @param record The record `begin` or the last `score` returned, as the host stored it.
 * @returns The decoded record and its responses, or the plain `restore`'s failure:
 *   {@link InvalidRecord} at stage `decode` or {@link RecordMismatch}.
 */
export const restore = Effect.fn("plate.restore")(function* restore(
  document: Accepted,
  record: StoredRecord,
): Effect.fn.Return<Restored, InvalidRecord | RecordMismatch> {
  yield* Effect.annotateCurrentSpan("item.identifier", document.item.identifier);

  return yield* Effect.fromResult(plainRestore(document, record));
});

/**
 * Score an attempt at an item, as the plain `score` does. Its span, `plate.score`, carries
 * `item.identifier` and `responses.count`, how many responses were posted, never their values.
 *
 * @param document The document `check` accepted.
 * @param responses The candidate's responses by identifier.
 * @param record The record `begin` or the last `score` of this item returned, passed back
 *   unchanged; it may be left out for an item whose template processing does not run.
 * @returns The record after the attempt, or the plain `score`'s failure: {@link InvalidRecord},
 *   {@link RecordMismatch}, {@link RecordRequired}, {@link InvalidResponses},
 *   {@link ResponsesRefused} or an {@link EngineFailure}.
 */
export const score = Effect.fn("plate.score")(function* score(
  document: Accepted,
  responses: Responses,
  record?: StoredRecord,
): Effect.fn.Return<
  StoredRecord,
  | EngineFailure
  | InvalidRecord
  | InvalidResponses
  | RecordMismatch
  | RecordRequired
  | ResponsesRefused
> {
  yield* Effect.annotateCurrentSpan({
    "item.identifier": document.item.identifier,
    "responses.count": Object.keys(responses).length,
  });

  return yield* Effect.fromResult(plainScore(document, responses, record));
});

/**
 * Give the intents a test session takes now, as the plain `allowedIntents` does.
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @returns The intents, or the plain `allowedIntents`' failure: {@link ItemNotInSession} or
 *   {@link UnknownItemRef}.
 */
export const allowedIntents = Effect.fnUntraced(function* allowedIntents(
  test: AcceptedTest,
  session: TestSession,
): Effect.fn.Return<readonly Intent[], ItemNotInSession | UnknownItemRef> {
  return yield* Effect.fromResult(plainAllowedIntents(test, session));
});

/**
 * Say whether an item of a test session may be shown in review or in solution, as the plain
 * `permits` does.
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @param sequenceIndex The item's sequence index, counted from 1.
 * @returns The item's permissions, or the plain `permits`' failure: {@link ItemNotInSession} or
 *   {@link UnknownItemRef}.
 */
export const permits = Effect.fnUntraced(function* permits(
  test: AcceptedTest,
  session: TestSession,
  sequenceIndex: number,
): Effect.fn.Return<Permits, ItemNotInSession | UnknownItemRef> {
  return yield* Effect.fromResult(plainPermits(test, session, sequenceIndex));
});

/**
 * Copy an accepted item into the form the page may know, as the plain `redact` does, holding its
 * printed text to the {@link Configuration} service's `outputBudget`, the budget {@link render}
 * holds its HTML to. It never fails. Its span, `plate.redact`, carries `item.identifier`.
 *
 * @param document The document `check` accepted.
 * @param record The attempt's template values and outcome values, such as the `record` of the
 *   plain `Restored`; none to show the item as it reads with no record.
 * @returns The redacted item, the one input {@link render} takes.
 */
export const redact = Effect.fn("plate.redact")(function* redact(
  document: Accepted,
  record?: RedactRecord,
): Effect.fn.Return<Redacted, never, Configuration> {
  yield* Effect.annotateCurrentSpan("item.identifier", document.item.identifier);

  const configuration = yield* Configuration;

  return plainRedact(document, record, configuration);
});

/**
 * Validate responses as the item's interactions do, without scoring them, as the plain
 * `checkResponses` does, under the {@link Configuration} service, which gives the locale and
 * `validateResponses`. It never fails: a response it refuses is a message in its value. Its span,
 * `plate.checkResponses`, carries `item.identifier` and `messages.count`, never a message's text.
 *
 * @param document The document `check` accepted.
 * @param responses The responses by identifier, each a value, a record or the `Malformed` `decode`
 *   gave.
 * @param record The template values of the attempt the page showed, the record `redact` took; none
 *   to judge the item as it reads with no record.
 * @returns Every message of the interactions shown, in their document order; none when all are
 *   accepted.
 */
export const checkResponses = Effect.fn("plate.checkResponses")(function* checkResponses(
  document: Accepted,
  responses: Readonly<Record<string, Malformed | ResponseValue>>,
  record?: ResponsesRecord,
): Effect.fn.Return<readonly ValidationMessage[], never, Configuration> {
  yield* Effect.annotateCurrentSpan("item.identifier", document.item.identifier);

  const configuration = yield* Configuration;
  const messages = plainCheckResponses(document, responses, configuration, record);
  yield* Effect.annotateCurrentSpan("messages.count", messages.length);

  return messages;
});

/**
 * Read the accepted item out of a verdict, as the plain `acceptedItem` does, failing
 * {@link Refused} where it gives none.
 *
 * @example
 *   Effect.flatMap(open(location, bytes), acceptedItem);
 *   // an Effect of the accepted item, or Refused naming what the verdict holds instead
 *
 * @param verdict The verdict, as `check` gave it.
 * @returns The accepted item of an `accepted` or `accepted-with-unsupported` verdict of kind
 *   `item`, or {@link Refused} for any other verdict: with its refusals when it is `refused`, and
 *   with none when it is `unchecked` or accepts a test, a section or a stimulus.
 */
export const acceptedItem = Effect.fnUntraced(function* acceptedItem(
  verdict: Verdict,
): Effect.fn.Return<Accepted, Refused> {
  const accepted = plainAcceptedItem(verdict);

  if (Option.isSome(accepted)) {
    return accepted.value;
  }

  return yield* new Refused({
    document: verdict.document,
    kind: verdict.kind,
    refusals: verdict.verdict === "refused" ? verdict.refusals : [],
    verdict: verdict.verdict,
  });
});
