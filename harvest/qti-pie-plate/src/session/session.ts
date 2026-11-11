/**
 * The test session as data: what a host stores between requests while a candidate takes a test,
 * and what one request asks the session to do.
 *
 * The library keeps no session of its own. {@link TestSession} is the whole of a test's session,
 * which the host stores, in the form `encodeSession` of `#plate/codec/session.ts` writes, and hands
 * back. These are plain types, with no Schema, so a browser module may import them.
 *
 * @module
 */
import type { Option } from "effect";
import type { ItemRecord } from "#plate/model/record.ts";
import type { ResponseValue, Value } from "#plate/model/values.ts";

/**
 * The values a candidate gave an item, by response identifier, each value of base type integer an
 * exact `bigint`: a {@link Value} for a response of a modelled base type and cardinality, and a
 * `RecordValue` for a record response.
 */
export type Responses = Readonly<Record<string, ResponseValue>>;

/**
 * Where a test part stands: `pending` before the candidate reaches it, `current` while they are
 * in it, and `ended` once it has ended. Parts run in order and an ended part never reopens.
 */
export interface SessionPart {
  /**
   * The test part's identifier.
   */
  readonly identifier: string;
  /**
   * Whether the part is still to come, the one being taken, or over.
   */
  readonly status: "current" | "ended" | "pending";
}

/**
 * One item of a test session: an item ref of the test, at its place in the sequence the candidate
 * meets the items in.
 */
export interface SessionItem {
  /**
   * When the last transition that changed this item happened, in ISO 8601 UTC.
   */
  readonly datestamp: string;
  /**
   * The seconds the item was current in answering mode, truncated to a tenth of a second.
   */
  readonly duration: number;
  /**
   * The outcomes of the first attempt processed, which no later attempt overwrites; none until an
   * attempt is processed. A result reports these for an item with no attempt limit, since QTI asks
   * a delivery engine to report only the first outcomes of a non-adaptive item it does not limit.
   */
  readonly firstOutcomes: Option.Option<ItemRecord["outcomes"]>;
  /**
   * Whether the candidate has been shown the item.
   */
  readonly presented: boolean;
  /**
   * The item's session: fresh until its first attempt starts, at its first presentation in
   * answering mode, then the record `firstAttempt` (`#plate/engine/attempt.ts`) starts that attempt
   * with, then each processed attempt's. Its instance is the session's instance, a `.` and the
   * item's {@link SessionItem.sequenceIndex}.
   */
  readonly record: ItemRecord;
  /**
   * The identifier of the item ref this item delivers.
   */
  readonly ref: string;
  /**
   * The responses posted with a step and not yet processed; none when no step has saved any since
   * the last processed attempt.
   */
  readonly saved: Option.Option<Responses>;
  /**
   * The item's place in the sequence, counted from 1: a result's `sequenceIndex`.
   */
  readonly sequenceIndex: number;
  /**
   * The values its item ref's template defaults took, by template variable identifier, which its
   * first attempt's template processing starts from. Present only on an item of a nonlinear part
   * whose item ref has a template default, computed when that part starts; none on any other item:
   * one whose item ref has no template default, or one of a linear part, which computes its item's
   * defaults when the item is first presented and stores none here.
   */
  readonly templateDefaults: Option.Option<Readonly<Record<string, Value>>>;
}

/**
 * A test's session, everything the library needs to carry a candidate through the test from one
 * request to the next.
 *
 * `test` is the test's identifier and `document` the test document's location. `instance` is the
 * host's name for this sitting, which scopes every item's ids. `seed` is the session's processing
 * seed, always present: the one `startTest`'s context gave, used as given, or the one `startTest`
 * drew when the context gave none, never the configuration's `seed`. It keys every value the
 * session's processing draws, so a restored session holds the values it showed, and it is server
 * data: it never reaches the page. `shuffleSeed` is the configuration's `seed` the session started
 * under, none when the configuration had none; it alone orders a shuffled Choice or Inline Choice,
 * so a restored session presents the order it showed, and with none a shuffle follows the instance
 * alone. `started` and `updated` are ISO 8601 UTC times: when the session started and when its last
 * transition happened. `position` is the index into `items` of the item shown now, counted from 0.
 * `parts` lists the test's parts in order, and `items` its items in the order the candidate meets
 * them.
 *
 * `outcomes` holds the test's outcomes by identifier, each exact as an item's are: at its declared
 * default, else its starting value, when the session starts, and as the last run of the test's
 * outcome processing left them after. `outcomeRuns` counts those runs, 0 when the session starts;
 * the next run is number `outcomeRuns + 1`, and its number keys the values it draws.
 */
export interface TestSession {
  readonly document: string;
  readonly instance: string;
  readonly items: readonly SessionItem[];
  readonly kind: "test";
  readonly outcomeRuns: number;
  readonly outcomes: Readonly<Record<string, Value>>;
  readonly parts: readonly SessionPart[];
  readonly position: number;
  readonly seed: string;
  readonly shuffleSeed: Option.Option<string>;
  readonly started: string;
  readonly status: "closed" | "interacting";
  readonly test: string;
  readonly updated: string;
}

/**
 * What a candidate asks of the test: move to the next or the previous item, go to the item at a
 * sequence index, submit the current item, submit the current part, or end the current part.
 */
export type Intent =
  | { readonly kind: "end-part" }
  | { readonly kind: "go"; readonly sequenceIndex: number }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "submit-item" }
  | { readonly kind: "submit-part" };

/**
 * What one request carries: the intent, and the responses to save on the current item with it,
 * when it carries any.
 *
 * The responses are saved only while the current item is open. A closed item, one whose view is
 * `disabled`, takes no responses: `advance` carries out the step's intent and ignores its
 * responses, so a host may post a closed item's form as rendered, or pass what it decoded from it.
 */
export interface Step {
  readonly intent: Intent;
  readonly responses?: Responses;
}
