/**
 * Moving through a test session: {@link move} carries out `next`, `previous` and `go`, and
 * {@link moveTarget} says, without moving, where one would go or why it is refused.
 *
 * A move stays inside the current test part, since parts run in order and an ended part never
 * reopens: leaving a part is its end, which a submission carries out. In a linear part the
 * candidate only moves forward, one item at a time. In a nonlinear part they move to any item of
 * the part, and leaving an item keeps its attempt open. `go` to the current item saves and stays in
 * every mode. Every function is pure and keeps nothing between calls. A read of many moves, as
 * `allowedIntents` makes, decides them through {@link moveTargets}, which reads the test once. This
 * is a browser module: it value-imports from `effect` only `Option`, `Array`, `Data` and `Result`.
 *
 * @module
 */
import { Array as Arr, Data, Option, Result } from "effect";
import type { EngineFailure } from "#plate/engine/evaluate.ts";
import { refIdentifiersIn } from "#plate/model/item-refs.ts";
import type { Test, TestPart } from "#plate/model/test.ts";
import { UnknownItemRef } from "#plate/session/control.ts";
import type { Intent, SessionItem, Step, TestSession } from "#plate/session/session.ts";
import { ItemNotInSession, present, recordStep } from "#plate/session/start.ts";
import type { InvalidTime, TestNotDeliverable } from "#plate/session/start.ts";
import type { Accepted, AcceptedTest } from "#plate/validate/verdict.ts";

/**
 * The intents that move the candidate between items of a part: `next`, `previous` and `go`.
 */
export type MoveIntent = Extract<Intent, { readonly kind: "go" | "next" | "previous" }>;

/**
 * A request that moves: a {@link MoveIntent}, and the responses to save on the current item before
 * it moves, when the request carries any.
 */
export interface MoveStep extends Step {
  readonly intent: MoveIntent;
}

/**
 * Why a move is refused.
 *
 * - `test-closed`: the test has closed, so no item is current.
 * - `linear-back`: `previous` in a linear part.
 * - `linear-jump`: `go` to another item than the current one in a linear part.
 * - `start-of-part`: `previous` from the first item of a nonlinear part.
 * - `end-of-part`: `next` from the last item of a part; the part's end moves on.
 * - `out-of-range`: `go` to a sequence index that names no item of the current part.
 * - `unsubmitted`: `next` from an item with no processed attempt in a linear, individual part, which
 *   must be submitted before the candidate leaves it.
 */
export type MoveRule =
  | "end-of-part"
  | "linear-back"
  | "linear-jump"
  | "out-of-range"
  | "start-of-part"
  | "test-closed"
  | "unsubmitted";

/**
 * Where a refused move started: the current item's sequence index, and the identifier of its part
 * with the sequence indices of the part's first and last items.
 */
export interface MoveOrigin {
  readonly first: number;
  readonly last: number;
  readonly part: string;
  readonly sequenceIndex: number;
}

/**
 * Name an intent as a candidate's request, as a refusal's message names it.
 *
 * @param intent The intent.
 * @returns Its kind, or for `go`, `go to item <n>`.
 */
export const requestOf = (intent: Intent): string =>
  intent.kind === "go" ? `go to item ${intent.sequenceIndex}` : intent.kind;

/**
 * What each {@link MoveRule} says about a refused move from an item, and what to offer instead.
 */
const reasons: Readonly<Record<Exclude<MoveRule, "test-closed">, (origin: MoveOrigin) => string>> =
  {
    "end-of-part": ({ part, sequenceIndex }) =>
      `item ${sequenceIndex} is the last item of the part ${JSON.stringify(part)}, and a move never leaves its part. End the part to move on.`,
    "linear-back": ({ part }) =>
      `the part ${JSON.stringify(part)} is linear, so the candidate never goes back. Offer next instead.`,
    "linear-jump": ({ part, sequenceIndex }) =>
      `the part ${JSON.stringify(part)} is linear, so the candidate moves only with next. Offer next, or go to item ${sequenceIndex} to save and stay.`,
    "out-of-range": ({ first, last, part }) =>
      `the current part ${JSON.stringify(part)} holds items ${first} to ${last}, and a move never leaves its part. Go to a sequence index from ${first} to ${last}.`,
    "start-of-part": ({ part, sequenceIndex }) =>
      `item ${sequenceIndex} is the first item of the part ${JSON.stringify(part)}, and an ended part never reopens. Offer previous only from a later item of the part.`,
    unsubmitted: ({ part, sequenceIndex }) =>
      `item ${sequenceIndex} has no processed attempt, and the part ${JSON.stringify(part)} is linear with individual submission, so the item is submitted before the candidate leaves it. Submit the item, then move with next.`,
  };

/**
 * The failure of {@link move} and {@link moveTarget} for a move the test's rules forbid now.
 * `rule` says which rule refuses it, and `from` where the move started, none once the test has
 * closed. A refused move changes nothing, the responses the request carried included.
 */
export class MoveRefused extends Data.TaggedError("MoveRefused")<{
  readonly from: Option.Option<MoveOrigin>;
  readonly intent: MoveIntent;
  readonly rule: MoveRule;
}> {
  /**
   * The request, the rule that refuses it, and what to offer instead.
   */
  override get message(): string {
    const request = requestOf(this.intent);
    const { from, rule } = this;
    if (rule === "test-closed" || Option.isNone(from)) {
      return `The test session is closed, so ${request} has no item to move from. Read what it shows with current, which gives its summary.`;
    }

    return `The move ${request} from item ${from.value.sequenceIndex} is refused (${rule}): ${reasons[rule](from.value)}`;
  }
}

/**
 * The current item of an open session, with its part and the part's items.
 */
interface Standing {
  /**
   * The current item.
   */
  readonly item: SessionItem;
  /**
   * The session items the part delivers, in sequence: a run of the session's items, since the
   * sequence walks parts in order.
   */
  readonly items: readonly SessionItem[];
  /**
   * The sequence indices of {@link Standing.items}, so a `go` finds its target without a search.
   */
  readonly sequenceIndices: ReadonlySet<number>;
  /**
   * The current item's index among {@link Standing.items}.
   */
  readonly offset: number;
  /**
   * The current item's part.
   */
  readonly part: TestPart;
}

/**
 * Find where an open session stands: its current item, that item's part, and the part's items.
 *
 * @param test The test.
 * @param session The session, open.
 * @returns Where it stands; {@link ItemNotInSession} for a position past its items;
 *   {@link UnknownItemRef} when the test holds no item ref the current item names.
 */
const standingOf = (
  test: Test,
  session: TestSession,
): Result.Result<Standing, ItemNotInSession | UnknownItemRef> => {
  const item = session.items[session.position];
  if (item === undefined) {
    return Result.fail(
      new ItemNotInSession({ count: session.items.length, sequenceIndex: session.position + 1 }),
    );
  }

  return Result.map(
    Result.fromOption(
      Arr.findFirst(test.parts, (part) => refIdentifiersIn(part.children).includes(item.ref)),
      () => new UnknownItemRef({ ref: item.ref, test: test.identifier }),
    ),
    (part) => {
      const refs = new Set(refIdentifiersIn(part.children));
      const items = session.items.filter((candidate) => refs.has(candidate.ref));

      return {
        item,
        items,
        offset: items.indexOf(item),
        part,
        sequenceIndices: new Set(items.map((candidate) => candidate.sequenceIndex)),
      };
    },
  );
};

/**
 * Give the place a refused move started from.
 *
 * @param standing Where the session stands.
 * @returns The origin.
 */
const originOf = ({ item, items, part }: Standing): MoveOrigin => ({
  first: items[0]?.sequenceIndex ?? item.sequenceIndex,
  last: items.at(-1)?.sequenceIndex ?? item.sequenceIndex,
  part: part.identifier,
  sequenceIndex: item.sequenceIndex,
});

/**
 * Give the sequence index `go` reaches: the current item's, which saves and stays in every mode,
 * else another item of the part, which only a nonlinear part allows.
 *
 * @param standing Where the session stands.
 * @param sequenceIndex The sequence index asked for.
 * @returns The target's sequence index, or the refusing rule.
 */
const goTarget = (
  { item, part, sequenceIndices }: Standing,
  sequenceIndex: number,
): Result.Result<number, MoveRule> => {
  if (sequenceIndex === item.sequenceIndex) {
    return Result.succeed(sequenceIndex);
  }

  if (!sequenceIndices.has(sequenceIndex)) {
    return Result.fail("out-of-range");
  }

  return part.navigation === "linear" ? Result.fail("linear-jump") : Result.succeed(sequenceIndex);
};

/**
 * Give the sequence index `next` reaches: the part's following item, once a linear, individual
 * part's current item has a processed attempt.
 *
 * @param standing Where the session stands.
 * @returns The target's sequence index, or the refusing rule.
 */
const nextTarget = ({ item, items, offset, part }: Standing): Result.Result<number, MoveRule> =>
  part.navigation === "linear" && part.submission === "individual" && item.record.numAttempts === 0
    ? Result.fail("unsubmitted")
    : Result.fromOption(
        Option.map(Arr.get(items, offset + 1), (following) => following.sequenceIndex),
        (): MoveRule => "end-of-part",
      );

/**
 * Give the sequence index `previous` reaches: the part's preceding item, in a nonlinear part.
 *
 * @param standing Where the session stands.
 * @returns The target's sequence index, or the refusing rule.
 */
const previousTarget = ({ items, offset, part }: Standing): Result.Result<number, MoveRule> =>
  part.navigation === "linear"
    ? Result.fail("linear-back")
    : Result.fromOption(
        Option.map(Arr.get(items, offset - 1), (preceding) => preceding.sequenceIndex),
        (): MoveRule => "start-of-part",
      );

/**
 * Give the sequence index a move goes to from where a session stands, or the rule that refuses it.
 *
 * @param standing Where the session stands.
 * @param intent The intent.
 * @returns The target's sequence index, or the refusing rule.
 */
const targetOf = (standing: Standing, intent: MoveIntent): Result.Result<number, MoveRule> => {
  if (intent.kind === "go") {
    return goTarget(standing, intent.sequenceIndex);
  }

  return intent.kind === "next" ? nextTarget(standing) : previousTarget(standing);
};

/**
 * Read where a test session stands once, and give the function that says where each move would
 * take it from there, without moving it: the sequence index of the item {@link move} would make
 * current, or why it refuses the move.
 *
 * {@link moveTarget} decides one move through this, and a list of the moves allowed now decides
 * each of its moves through one call of it: asking {@link moveTarget} for each would read the test
 * and the session again for every move, which grows with the square of the item count.
 *
 * @example
 *   Result.map(moveTargets(test, session), (decide) => decide({ kind: "next" }));
 *   // Result.succeed(Result.succeed(2)) from item 1 of a part of three
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @returns The function that decides a move, failing with {@link MoveRefused} when the test's
 *   rules forbid it now and, once the test has closed, for every move; {@link ItemNotInSession} for
 *   an open session whose position is past its items; {@link UnknownItemRef} when the test holds
 *   no item ref the current item names.
 */
export const moveTargets = (
  test: AcceptedTest,
  session: TestSession,
): Result.Result<
  (intent: MoveIntent) => Result.Result<number, MoveRefused>,
  ItemNotInSession | UnknownItemRef
> => {
  if (session.status === "closed") {
    return Result.succeed((intent) =>
      Result.fail(new MoveRefused({ from: Option.none(), intent, rule: "test-closed" })),
    );
  }

  return Result.map(
    standingOf(test.test, session),
    (standing) => (intent) =>
      Result.mapError(
        targetOf(standing, intent),
        (rule) => new MoveRefused({ from: Option.some(originOf(standing)), intent, rule }),
      ),
  );
};

/**
 * Say where a move would take a test session, without moving it: the sequence index of the item
 * {@link move} would make current, or why it refuses the move.
 *
 * {@link move} decides through this, and this through {@link moveTargets}, so the move, this and a
 * list of the moves allowed now always agree, and a host can ask it without the items or a time.
 *
 * @example
 *   moveTarget(test, session, { kind: "next" }); // Result.succeed(2) from item 1 of a part of three
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @param intent The move.
 * @returns The sequence index the move goes to, the current item's for `go` to it;
 *   {@link MoveRefused} when the test's rules forbid the move now; {@link ItemNotInSession} for an
 *   open session whose position is past its items; {@link UnknownItemRef} when the test holds no
 *   item ref the current item names.
 */
export const moveTarget = (
  test: AcceptedTest,
  session: TestSession,
  intent: MoveIntent,
): Result.Result<number, ItemNotInSession | MoveRefused | UnknownItemRef> =>
  Result.flatMap(moveTargets(test, session), (decide) => decide(intent));

/**
 * Move a test session with `next`, `previous` or `go`.
 *
 * The request's responses are saved on the current item first, through `recordStep`, which adds the
 * time the item was shown to its duration and makes `now` the item's datestamp and the session's
 * `updated`. The item the move reaches becomes current and is presented, which starts its first
 * attempt and writes its response defaults when the candidate meets it for the first time, after
 * the item ref's template defaults in a linear part, as `present` gives them. `go` to the current
 * item saves and stays. A refused move returns no session, so it saves nothing.
 *
 * In a linear, individual part, `next` from an item with no processed attempt is refused
 * (`unsubmitted`): the item is submitted first, which a submission does, and then the move is
 * allowed. On a part's last item, `next` is refused (`end-of-part`): the part's end moves on.
 *
 * @example
 *   move(test, items, session, { intent: { kind: "next" }, responses }, new Date());
 *
 * @param test The test the session was started from.
 * @param items The accepted items, keyed by item ref identifier, as `startTest` took them.
 * @param session The session.
 * @param step The move, and the responses posted with it.
 * @param now The time of the move.
 * @returns The session after the move; {@link MoveRefused} when the test's rules forbid it now;
 *   `InvalidTime` for an invalid `now`; {@link ItemNotInSession} for a session whose position is
 *   past its items; {@link UnknownItemRef} when the test holds no item ref the current item names;
 *   `TestNotDeliverable` when the items have no entry for the item reached, or one from another
 *   document; an `EngineFailure` when a template default of the item reached does not fit it, or
 *   reads a value the session's records lack.
 */
export const move = (
  test: AcceptedTest,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  step: MoveStep,
  now: Date,
): Result.Result<
  TestSession,
  EngineFailure | InvalidTime | ItemNotInSession | MoveRefused | TestNotDeliverable | UnknownItemRef
> =>
  Result.gen(function* moveOne() {
    const target = yield* moveTarget(test, session, step.intent);
    const saved = yield* recordStep(session, step, now);
    const position = yield* Result.fromOption(
      Arr.findFirstIndex(saved.items, (item) => item.sequenceIndex === target),
      () => new ItemNotInSession({ count: saved.items.length, sequenceIndex: target }),
    );
    if (position === saved.position) {
      return saved;
    }

    return yield* present(test.test, items, { ...saved, position }, target, now);
  });
