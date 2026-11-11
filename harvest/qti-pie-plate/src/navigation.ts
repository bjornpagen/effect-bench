/**
 * A test session's navigation as data: the current part's modes, where the candidate stands, the
 * state of each item of the part, and the intents the session takes now.
 *
 * {@link navigationState} is what a host builds its navigation from, and what
 * {@link renderNavigation} renders as plate's navigation parts: plain buttons with no submit
 * semantics, which a host swaps for its own to post natively (rule `9af3809b`). Both are pure and
 * keep nothing between calls. This is a browser module: it value-imports from `effect` only
 * `Array`, `Data`, `Option`, `pipe` and `Result`.
 *
 * @module
 */
import { Array as Arr, Data, Option, pipe, Result } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { emitNavigation } from "#plate/emit/navigation.ts";
import type { NavigationPart } from "#plate/emit/navigation.ts";
import { resolveOverrides } from "#plate/emit/parts.ts";
import type { UnknownPart } from "#plate/emit/parts.ts";
import { toHtml } from "#plate/emit/serialise.ts";
import type { MarkupRefused } from "#plate/emit/serialise.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { refIdentifiersIn } from "#plate/model/item-refs.ts";
import type { Test, TestPart } from "#plate/model/test.ts";
import { isNullResponse } from "#plate/model/values.ts";
import type { Options } from "#plate/render.ts";
import type { UnknownItemRef } from "#plate/session/control.ts";
import { allowedIntents } from "#plate/session/intents.ts";
import type { Intent, SessionItem, TestSession } from "#plate/session/session.ts";
import { current, itemViews, readingBase } from "#plate/session/start.ts";
import type { ItemNotInSession } from "#plate/session/start.ts";
import type { AcceptedTest } from "#plate/validate/verdict.ts";
import type { NavigationMode, SubmissionMode } from "#plate/vocabulary.ts";

/**
 * Where an item of the current part stands, in the order {@link navigationState} decides it:
 * `closed` when the item is closed; else `submitted` when it has a processed attempt; else
 * `answered` when its saved responses hold a value that is not NULL; else `not-answered`.
 */
export type NavigationItemState = "answered" | "closed" | "not-answered" | "submitted";

/**
 * One item of the current test part, as a navigation shows it.
 */
export interface NavigationItem {
  /**
   * Whether the item is the one shown now; no item is current once the test has closed.
   */
  readonly current: boolean;
  /**
   * The item's place in the session's sequence, counted from 1.
   */
  readonly sequenceIndex: number;
  readonly state: NavigationItemState;
}

/**
 * A test session's navigation now.
 *
 * While the test is open, `navigation`, `submission`, `position` and `count` are what `current`
 * gives: the current part's modes, the current item's sequence index and the session's item count,
 * and `items` are the current part's, in order. Once the test has closed, `allowed` is empty,
 * `position` is the sequence index of the item the session closed on, and `items` and the modes
 * are those of the part it closed in: the last part that holds an item, since a part with no item
 * ends as the candidate reaches it. A test with no item has no such part, so its `items` are empty,
 * its `position` is 0 and its modes are its last part's.
 */
export interface NavigationState {
  /**
   * The intents the session takes now, as `allowedIntents` lists them and in its order.
   */
  readonly allowed: readonly Intent[];
  readonly count: number;
  readonly items: readonly NavigationItem[];
  readonly navigation: NavigationMode;
  readonly position: number;
  readonly submission: SubmissionMode;
}

/**
 * A broken invariant of the test model {@link navigationState} reads: a test with no test part,
 * which `check` never accepts, since a `qti-assessment-test` holds at least one `qti-test-part`.
 *
 * It cannot occur on a test `check` accepted, only on a hand-built one: a closed session of a test
 * with no part holds no item and so closed in no part, and the navigation has no part to take its
 * modes from. It is thrown, never returned, so {@link navigationState}'s error channel holds only
 * what a session can cause.
 */
export class PartlessTestDefect extends Data.TaggedError("PartlessTestDefect")<{
  readonly test: string;
}> {
  /**
   * The test, and what to pass instead.
   */
  override get message(): string {
    return `The test ${this.test} holds no test part, so its navigation has no part to take its modes from. Pass the test check accepted, or build the test with at least one part.`;
  }
}

/**
 * Find the test part that holds an item ref.
 *
 * @param test The test.
 * @param ref The item ref's identifier.
 * @returns The part, or none when no part holds the ref.
 */
const partOf = (test: Test, ref: string): Option.Option<TestPart> =>
  Arr.findFirst(test.parts, (part) => refIdentifiersIn(part.children).includes(ref));

/**
 * List the session items some test parts deliver, in the session's order.
 *
 * @param session The session.
 * @param parts The parts.
 * @returns The items whose item ref one of the parts holds.
 */
const itemsOf = (session: TestSession, parts: readonly TestPart[]): readonly SessionItem[] => {
  const refs = new Set(parts.flatMap((part) => refIdentifiersIn(part.children)));

  return session.items.filter((item) => refs.has(item.ref));
};

/**
 * Say where an item stands.
 *
 * @param item The session item.
 * @param closed Whether the item is closed, as its view gives it.
 * @returns The item's state.
 */
const stateOf = (item: SessionItem, closed: boolean): NavigationItemState => {
  if (closed) {
    return "closed";
  }

  if (item.record.numAttempts > 0) {
    return "submitted";
  }

  return Option.exists(item.saved, (saved) =>
    Object.values(saved).some((value) => !isNullResponse(value)),
  )
    ? "answered"
    : "not-answered";
};

/**
 * The part a navigation shows, and the place in it the session stands at.
 */
interface Shown {
  readonly count: number;
  readonly items: readonly SessionItem[];
  readonly navigation: NavigationMode;
  readonly open: boolean;
  readonly position: number;
  readonly submission: SubmissionMode;
}

/**
 * Give the part a closed session closed in and the item it closed on.
 *
 * The session closed on the item at its position, so the part that holds that item is the last
 * part that holds an item: a later part with no item ended as the candidate reached it, and is
 * never the part a session closes in. A test with no item closed at its start, on no item, and
 * shows its last part, which delivers none.
 *
 * @param test The test.
 * @param session The session, closed.
 * @returns What the navigation shows.
 * @throws {PartlessTestDefect} When the test holds no part, which `check` never accepts.
 */
const closedShown = (test: Test, session: TestSession): Shown => {
  const closedOn = Option.fromUndefinedOr(session.items[session.position]);
  const part = pipe(
    closedOn,
    Option.flatMap((item) => partOf(test, item.ref)),
    Option.orElse(() => Arr.last(test.parts)),
  );
  if (Option.isNone(part)) {
    throw new PartlessTestDefect({ test: test.identifier });
  }

  return {
    count: session.items.length,
    items: itemsOf(session, [part.value]),
    navigation: part.value.navigation,
    open: false,
    position: Option.match(closedOn, { onNone: () => 0, onSome: (item) => item.sequenceIndex }),
    submission: part.value.submission,
  };
};

/**
 * Give a test session's navigation now: the current part's modes, the current item's position,
 * each item of the part with its state, and the intents the session takes.
 *
 * Each item of the part is `closed` when it is closed (its part has ended, the test has closed, or
 * its attempt limit is above 0 and reached); else `submitted` when its record has a processed
 * attempt, since the item's session status is `final` only once the item has closed; else
 * `answered` when its saved responses hold a value that is not NULL; else `not-answered`.
 *
 * @example
 *   navigationState(test, session);
 *   // Result.succeed({ navigation: "nonlinear", submission: "individual", position: 2, count: 6,
 *   //   items: [{ sequenceIndex: 1, state: "answered", current: false }, …], allowed: [...] })
 *
 * @param test The test the session was started from.
 * @param session The session.
 * @returns The navigation; {@link ItemNotInSession} for an open session whose position is past its
 *   items; {@link UnknownItemRef} when the test holds no item ref an item names, as when the
 *   session belongs to another test.
 * @throws {PartlessTestDefect} When the session is closed and the test holds no part, which
 *   `check` never accepts.
 */
export const navigationState = (
  test: AcceptedTest,
  session: TestSession,
): Result.Result<NavigationState, ItemNotInSession | UnknownItemRef> =>
  Result.gen(function* navigate() {
    const shownNow = yield* current(test, session, readingBase);
    const allowed = yield* allowedIntents(test, session);
    const shown: Shown =
      shownNow.kind === "item"
        ? {
            count: shownNow.count,
            items: itemsOf(session, Option.toArray(partOf(test.test, shownNow.ref))),
            navigation: shownNow.navigation,
            open: true,
            position: shownNow.sequenceIndex,
            submission: shownNow.submission,
          }
        : closedShown(test.test, session);
    const views = yield* itemViews(
      test,
      session,
      readingBase,
      shown.items.map((item) => item.sequenceIndex),
    );
    const items = Arr.zipWith(shown.items, views, (item, view): NavigationItem => ({
      current: shown.open && item.sequenceIndex === shown.position,
      sequenceIndex: item.sequenceIndex,
      state: stateOf(item, view.disabled),
    }));

    return {
      allowed,
      count: shown.count,
      items,
      navigation: shown.navigation,
      position: shown.position,
      submission: shown.submission,
    };
  });

export type { NavigationPart } from "#plate/emit/navigation.ts";

/**
 * The author's inputs to one {@link renderNavigation}, each optional.
 *
 * `parts` replaces navigation parts through the swap invariant, keyed
 * `parts["test-navigation"][<part>]`, as `render` takes them. `order` lists the parts the Root
 * holds, in order, a repeat included; without it the Root holds the parts the current part's
 * modes admit: Previous and the item list (nonlinear), Next, Submit, then End (nonlinear and
 * individual).
 */
export interface NavigationOptions extends Pick<Options, "parts"> {
  readonly order?: readonly NavigationPart[];
}

/**
 * Render a test session's navigation as plate's navigation parts: the `test-navigation` Root and
 * the parts it holds, as HTML.
 *
 * Every button is a plain button, `type="button"` with no `name`, `value`, `form*` attribute,
 * `action` or script, so it does nothing on its own. Its `disabled` follows `state.allowed`, its
 * `data-intent` is its intent as `encodeIntent` writes it, and its label comes from the
 * configuration's locale, an item's naming its state in words. A host that posts natively swaps a
 * button for its own submit button, whose `type`, `name` and `value` are the host's and whose
 * value is the `data-intent` it is handed; everything else plate computes survives the swap. Two
 * renders of one input are byte-equal.
 *
 * @example
 *   const submitting = (props: Attributes, children: readonly Node[]) =>
 *     h(
 *       "button",
 *       { name: intentName("s-1"), type: "submit", value: props["data-intent"] ?? "" },
 *       children,
 *     );
 *   renderNavigation(state, configuration, { parts: { "test-navigation": { next: submitting } } });
 *   // Result.succeed('<nav aria-label="Test navigation" …>…<button type="submit" name="s-1.intent" value="next" …>Next item</button>…</nav>')
 *
 * @param state The navigation, as {@link navigationState} gives it.
 * @param configuration The configuration, which gives the locale.
 * @param options The part overrides and the parts' order, none by default.
 * @returns The Root's HTML, or {@link UnknownPart} for an override the part table lacks,
 *   {@link PartSwapRefused} for a replacement that breaks the swap invariant, or
 *   {@link MarkupRefused} for a replacement holding markup the serialiser cannot write.
 */
export const renderNavigation = (
  state: NavigationState,
  configuration: Configuration,
  options: NavigationOptions = {},
): Result.Result<string, MarkupRefused | PartSwapRefused | UnknownPart> =>
  Result.gen(function* renderNavigationParts() {
    const parts = yield* resolveOverrides(options.parts);
    const root = yield* emitNavigation(
      state,
      { locale: configuration.locale, parts },
      options.order,
    );

    return yield* toHtml(root);
  });
