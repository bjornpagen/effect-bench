/**
 * The test chrome's navigation parts (rule `9af3809b`): the component
 * `test-navigation`, a `nav` Root holding plain buttons and the item list, built from a
 * {@link NavigationState}.
 *
 * Every button is a plain button with no submit semantics: its row defaults `type` to `button`, and
 * nothing here writes `name`, `value`, a `form*` attribute, an `action` or a script. What a click
 * does is the host's composition (rule `a9d04969`); a host that posts natively swaps the buttons
 * for its own submit buttons, and each button's `data-intent` is the value such a button posts.
 * Every part is built through `applyPart`, so a replacement holds the swap invariant. This is a
 * browser module: it value-imports from `effect` only `Option` and `Result`.
 *
 * @module
 */
import { Option, Result } from "effect";
import { text, when } from "#plate/emit/node.ts";
import type { Attributes, Element, Node } from "#plate/emit/node.ts";
import { rowFor } from "#plate/emit/parts.ts";
import type { PartOf, Resolved } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { encodeIntent } from "#plate/form/intent.ts";
import { message, numeral } from "#plate/messages.ts";
import type { MessageKey } from "#plate/messages.ts";
import type { NavigationItem, NavigationItemState, NavigationState } from "#plate/navigation.ts";
import type { EmitState } from "#plate/payload.ts";
import type { Intent } from "#plate/session/session.ts";

/**
 * A part an author places in the navigation Root, in the order they list them: the Previous, Next,
 * Submit and End buttons, and the item list.
 */
export type NavigationPart = "end" | "items" | "next" | "previous" | "submit";

/**
 * What the navigation parts read beside the data: the locale their labels are written in and the
 * resolved part overrides.
 */
export type NavigationEmit = Pick<EmitState, "locale" | "parts">;

/**
 * Build one navigation part through its row and the embedder's replacement, if any, with its
 * `data-slot` marker beside the attributes it is given.
 *
 * @param parts The resolved part overrides.
 * @param part The navigation part.
 * @param props The attributes the part carries, beside its marker.
 * @param children The nodes the part holds.
 * @returns The part's root element, refused when a replacement breaks the swap invariant.
 */
const navigationPart = (
  parts: Resolved,
  part: PartOf<"test-navigation">,
  props: Attributes,
  children: readonly Node[],
): Result.Result<Element, PartSwapRefused> => {
  const row = rowFor("test-navigation", part);

  return applyPart(
    row,
    { ...props, "data-slot": row.slot },
    children,
    Option.getOrUndefined(parts.replacementFor("test-navigation", part)),
  );
};

/**
 * Give the parts a navigation Root holds when the author names none: the parts its part's modes
 * admit, in reading order.
 *
 * Previous and the item list stand only in a nonlinear part, which alone lets the candidate move
 * back or jump; Next and Submit stand in every part; End stands only in a nonlinear, individual
 * part, the one part that `next` never ends and no part submission closes.
 *
 * @param state The navigation, whose modes decide the parts.
 * @returns Previous and the item list (nonlinear), Next, Submit, then End (nonlinear and
 *   individual).
 */
export const defaultOrder = (
  state: Pick<NavigationState, "navigation" | "submission">,
): readonly NavigationPart[] => {
  const nonlinear = state.navigation === "nonlinear";

  return [
    ...(nonlinear ? (["previous", "items"] as const) : []),
    "next",
    "submit",
    ...(nonlinear && state.submission === "individual" ? (["end"] as const) : []),
  ];
};

/**
 * The locale key of each item state's words, which an item's button names after the item, so a
 * state never reads by colour alone (WCAG 1.4.1).
 *
 * @see https://www.w3.org/TR/WCAG22/#use-of-color
 */
const stateWords = {
  answered: "itemAnswered",
  closed: "itemClosed",
  "not-answered": "itemNotAnswered",
  submitted: "itemSubmitted",
} as const satisfies Readonly<Record<NavigationItemState, MessageKey>>;

/**
 * Give the values the intents a navigation allows post, so a button's intent is tested against
 * them by membership: a search of `state.allowed` for each item's button grows with the square of
 * the item count.
 *
 * @param state The navigation.
 * @returns Each intent of `state.allowed` as `encodeIntent` writes it.
 */
const allowedValues = (state: NavigationState): ReadonlySet<string> =>
  new Set(state.allowed.map((intent) => encodeIntent(intent)));

/**
 * Tell whether a navigation allows an intent, by the value each posts, so `go` matches only `go`
 * to the same item.
 *
 * @param allowed The values the navigation's allowed intents post, from {@link allowedValues}.
 * @param intent The intent.
 * @returns Whether the navigation's allowed intents hold `intent`.
 */
const allows = (allowed: ReadonlySet<string>, intent: Intent): boolean =>
  allowed.has(encodeIntent(intent));

/**
 * Give the attributes a navigation button computes from its intent: `data-intent`, and `disabled`
 * when the navigation does not allow the intent.
 *
 * @param state The navigation.
 * @param intent The button's intent.
 * @param allowed The values the navigation's allowed intents post, which the item list computes
 *   once for all its buttons; computed from `state` by default.
 * @returns The button's attributes beside its marker.
 */
const intentProps = (
  state: NavigationState,
  intent: Intent,
  allowed: ReadonlySet<string> = allowedValues(state),
): Attributes => ({
  "data-intent": encodeIntent(intent),
  ...when(!allows(allowed, intent), { disabled: true }),
});

/**
 * Build one of the four buttons that stand outside the item list.
 *
 * @param state The navigation.
 * @param emit The locale and the part overrides.
 * @param part The button's part.
 * @param intent The button's intent.
 * @param label The locale key of the button's label.
 * @returns The button, refused when a replacement breaks the swap invariant.
 */
const button = (
  state: NavigationState,
  emit: NavigationEmit,
  part: "end" | "next" | "previous" | "submit",
  intent: Intent,
  label: "endPart" | "nextItem" | "previousItem" | "submitAnswer" | "submitPart",
): Result.Result<Element, PartSwapRefused> =>
  navigationPart(emit.parts, part, intentProps(state, intent), [text(message(emit.locale, label))]);

/**
 * Write an item button's label: the item's place among the session's items, then its state in
 * words, joined as the locale joins them.
 *
 * Item titles are not shown, since a title may reveal an item's content.
 *
 * @param state The navigation, which gives the session's item count.
 * @param emit The locale.
 * @param item The item.
 * @returns "Item {n} of {count}" and the state, such as `Item 2 of 6, not answered`.
 */
const itemLabel = (state: NavigationState, emit: NavigationEmit, item: NavigationItem): string =>
  message(emit.locale, "itemState", {
    item: message(emit.locale, "itemOf", {
      count: numeral(emit.locale, state.count),
      n: numeral(emit.locale, item.sequenceIndex),
    }),
    state: message(emit.locale, stateWords[item.state]),
  });

/**
 * Build the item list: an Item per item of the part, in order, each holding its button, whose
 * intent is `go` to the item and which carries `aria-current="step"` when the item is current.
 *
 * @param state The navigation.
 * @param emit The locale and the part overrides.
 * @returns The Items list, refused when a replacement breaks the swap invariant.
 */
const itemList = (
  state: NavigationState,
  emit: NavigationEmit,
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* navigationItems() {
    const allowed = allowedValues(state);
    const entries: Element[] = [];
    for (const item of state.items) {
      const itemButton = yield* navigationPart(
        emit.parts,
        "itemButton",
        {
          ...intentProps(state, { kind: "go", sequenceIndex: item.sequenceIndex }, allowed),
          ...when(item.current, { "aria-current": "step" }),
        },
        [text(itemLabel(state, emit, item))],
      );
      entries.push(yield* navigationPart(emit.parts, "item", {}, [itemButton]));
    }

    return yield* navigationPart(emit.parts, "items", {}, entries);
  });

/**
 * Build a part an author places in the Root.
 *
 * Submit's intent and label follow the part's submission mode: `submit-item` and "Submit answer"
 * when it is individual, `submit-part` and "Submit part" when it is simultaneous.
 *
 * @param state The navigation.
 * @param emit The locale and the part overrides.
 * @param part The part.
 * @returns The part, refused when a replacement breaks the swap invariant.
 */
const placedPart = (
  state: NavigationState,
  emit: NavigationEmit,
  part: NavigationPart,
): Result.Result<Element, PartSwapRefused> => {
  switch (part) {
    case "end": {
      return button(state, emit, "end", { kind: "end-part" }, "endPart");
    }
    case "items": {
      return itemList(state, emit);
    }
    case "next": {
      return button(state, emit, "next", { kind: "next" }, "nextItem");
    }
    case "previous": {
      return button(state, emit, "previous", { kind: "previous" }, "previousItem");
    }
    case "submit": {
      return state.submission === "individual"
        ? button(state, emit, "submit", { kind: "submit-item" }, "submitAnswer")
        : button(state, emit, "submit", { kind: "submit-part" }, "submitPart");
    }
    default: {
      return part satisfies never;
    }
  }
};

/**
 * Emit the navigation Root, holding the parts `order` names, in that order.
 *
 * The Root (`nav`) is a landmark named by `aria-label`, the locale's "Test navigation", and
 * carries the part's two modes as `data-navigation` and `data-submission`. Each entry of `order` is
 * emitted as given, a repeat included, each time as new nodes. Each button is a plain button: it
 * carries `data-intent`, its intent as `encodeIntent` writes it, and `disabled` exactly when
 * `state.allowed` lacks that intent, so a part the modes never admit is disabled wherever the
 * author places it. Its label comes from the locale, an item's naming its state in words; the
 * current item's button carries `aria-current="step"`. The output is a function of its arguments
 * alone.
 *
 * @example
 *   Result.map(emitNavigation(state, { locale: "en", parts }), toHtml);
 *   // '<nav aria-label="Test navigation" data-navigation="nonlinear" …><button type="button" …>…</nav>'
 *
 * @param state The navigation, as `navigationState` gives it.
 * @param emit The locale and the part overrides.
 * @param order The parts the Root holds, {@link defaultOrder}'s by default.
 * @returns The navigation Root, or the refusal of a replacement that breaks the swap invariant.
 */
export const emitNavigation = (
  state: NavigationState,
  emit: NavigationEmit,
  order: readonly NavigationPart[] = defaultOrder(state),
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* navigation() {
    const children: Element[] = [];
    for (const part of order) {
      children.push(yield* placedPart(state, emit, part));
    }

    return yield* navigationPart(
      emit.parts,
      "root",
      {
        "aria-label": message(emit.locale, "testNavigation"),
        "data-navigation": state.navigation,
        "data-submission": state.submission,
      },
      children,
    );
  });
