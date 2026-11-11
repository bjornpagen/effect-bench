/**
 * The item chrome the library emits: the item Root around the emitted body, and the Status part.
 *
 * The library emits parts, not a page: the Root holds the body and nothing else, and the Status
 * part decides no placement and no focus, so the form, its submit control, where the Status part
 * goes, where focus moves and the page's title are the host's composition (rule `a9d04969`). Each
 * part's attributes are computed here, once, and each part is built through `applyPart`, so an
 * embedder's replacement holds the swap invariant.
 *
 * @module
 */
import { Option, Result } from "effect";
import { h, text, when } from "#plate/emit/node.ts";
import type { Attributes, Element, Node } from "#plate/emit/node.ts";
import { rowFor, scopedId } from "#plate/emit/parts.ts";
import type { PartOf, Resolved, RowContext } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { message } from "#plate/messages.ts";
import { identifyMessages } from "#plate/payload.ts";
import type { EmitState, Payload, ValidationMessage } from "#plate/payload.ts";

/**
 * Build one item part through its row and the embedder's replacement, if any, with its
 * `data-slot` marker beside the attributes it is given: the Root, the Status parts here, and the
 * body's Notice.
 *
 * @param parts The resolved part overrides.
 * @param part The item part.
 * @param props The attributes the part carries, beside its marker.
 * @param children The nodes the part holds.
 * @param context Where the part is placed, such as the StatusHeading's level or a Notice's
 *   position; none by default.
 * @returns The part's root element, refused when a replacement breaks the swap invariant.
 */
export const itemPart = (
  parts: Resolved,
  part: PartOf<"item">,
  props: Attributes,
  children: readonly Node[],
  context?: RowContext,
): Result.Result<Element, PartSwapRefused> => {
  const row = rowFor("item", part, context);

  return applyPart(
    row,
    { ...props, "data-slot": row.slot },
    children,
    Option.getOrUndefined(parts.replacementFor("item", part)),
  );
};

/**
 * Emit the item Root around an emitted body.
 *
 * The Root (`qti-assessment-item`) carries `lang`, its scoped `id`, `data-mode` naming the
 * payload's mode, and `data-disabled` when the author disabled every control. It holds the body's
 * nodes by identity, in order, and nothing else: no form, no submit control, no attempt state.
 *
 * @example
 *   Result.map(emitItem(payload, state, body), toHtml);
 *   // a qti-assessment-item element, its id `<instance>-item`, holding the body's HTML
 *
 * @param payload The render's payload, which gives the language, the instance, the mode and
 *   `finished`.
 * @param state The emit state, which holds the part overrides.
 * @param body The emitted body, which the Root holds.
 * @returns The item Root, or the refusal of a replacement that breaks the swap invariant.
 */
export const emitItem = (
  payload: Payload,
  state: EmitState,
  body: readonly Node[],
): Result.Result<Element, PartSwapRefused> =>
  itemPart(
    state.parts,
    "root",
    {
      "data-mode": payload.mode,
      id: scopedId(payload.instance, "item"),
      lang: payload.lang,
      ...when(payload.finished, { "data-disabled": true }),
    },
    body,
  );

/**
 * The data the results box shows: the instance, the state its heading names, and what
 * the region shows under the heading.
 *
 * Each heading names one state, in the text `messages.ts` keys it by:
 *
 * - `notAccepted`: the author refused a post, and `messages` says why.
 * - `responseRecorded`: the author recorded a post that no processing scores.
 * - `scored`: the author recorded a post and scored it, and `score` holds the score.
 * - `review`: the item is shown for review, its values the attempt the author recorded.
 * - `solution`: the item is shown with its correct responses as the values.
 * - `partSubmitted`: the test part holding the item was submitted.
 * - `testFinished`: the test holding the item was finished.
 *
 * The results box is a part plate keeps: `renderStatus` emits the Status region from this input,
 * and the author places it and feeds it what `score` or `checkResponses` gave. The part has no
 * submit semantics, owns no state and moves no focus. The region shows the score when `score` is
 * set; else one Message per entry of `messages`, when there are any; else nothing under the
 * heading, which names the state on its own.
 *
 * To build your own results box, read the same input and write what `renderStatus` writes: a
 * region with the id `<instance>-status` and `role="status"`, named by its heading through
 * `aria-labelledby`, with `tabindex="-1"`, and with `autofocus` when the author moves focus there
 * after a submit. Each Message carries the id the Controls' `aria-describedby` already names when
 * `render` was given the same `messages`: `<instance>-<response>-message-<n>`, where `n` counts the
 * earlier messages for the same response from 0.
 *
 * A host without script can end its form's `action` with the region's id as the fragment,
 * `#<instance>-status`, so the page that answers the post starts at the result: the browser
 * scrolls to the region and focuses it, as the playground does. HTML then skips `autofocus`: a page
 * whose URL's fragment names an element processes none.
 *
 * @see https://html.spec.whatwg.org/multipage/interaction.html#flush-autofocus-candidates
 */
export interface StatusInput {
  /**
   * The author's focus choice: the region carries `autofocus` exactly when it is true.
   */
  readonly autofocus?: boolean;
  /**
   * The state, one of those listed above; the heading shows its text in the configuration's
   * locale.
   */
  readonly heading:
    | "notAccepted"
    | "partSubmitted"
    | "responseRecorded"
    | "review"
    | "scored"
    | "solution"
    | "testFinished";
  /**
   * The item instance key `render` used, which scopes the region's ids and its Messages' ids.
   */
  readonly instance: string;
  /**
   * The messages of a refused post, in the order validation gave them: what `checkResponses`
   * returns, or the `messages` of the `ResponsesRefused` that `score` fails with.
   */
  readonly messages?: readonly ValidationMessage[];
  /**
   * The score, already written as the candidate reads it. The author writes it, not plate, for
   * example from the `SCORE` outcome of the record `score` returns. The region shows it in the
   * locale's score text, such as `Score: 1`.
   */
  readonly score?: string;
}

/**
 * Emit what the Status region shows under its heading: the score or the Messages, by
 * {@link StatusInput}'s precedence.
 *
 * @param input The author's Status input.
 * @param state The emit state, which gives the locale and the part overrides.
 * @returns The region's nodes after the heading, empty when the input gives nothing to show.
 */
const statusDetail = (
  input: StatusInput,
  state: EmitState,
): Result.Result<readonly Node[], PartSwapRefused> => {
  const { locale } = state;
  const messages = input.messages ?? [];
  if (input.score !== undefined) {
    return Result.succeed([h("p", {}, [text(message(locale, "score", { score: input.score }))])]);
  }

  if (messages.length > 0) {
    return Result.gen(function* statusMessages() {
      const items: Element[] = [];
      for (const entry of identifyMessages(input.instance, messages)) {
        items.push(yield* itemPart(state.parts, "message", { id: entry.id }, [text(entry.text)]));
      }

      return [yield* itemPart(state.parts, "messages", {}, items)];
    });
  }

  return Result.succeed([]);
};

/**
 * Emit the Status part: the status region, its heading at the base level, then the score or the
 * Messages, if any.
 *
 * The region (`section`) carries its scoped `id`, `role="status"`, `aria-labelledby` naming its
 * heading, `tabindex="-1"`, and `autofocus` only when `input.autofocus` is true. Each Message `li`
 * carries the id {@link identifyMessages} gives its message, the id the payload writes into each
 * Control's `aria-describedby`, so the two agree. It places the region nowhere and moves no focus:
 * both are the author's composition.
 *
 * @example
 *   Result.map(emitStatus({ heading: "scored", instance: "i1", score: "1" }, state), toHtml);
 *   // a section, id `i1-status`, holding the heading "Scored" and "Score: 1"
 *
 * @param input The author's Status input.
 * @param state The emit state, which gives the locale, the base heading level and the part
 *   overrides.
 * @returns The Status region, or the refusal of a replacement that breaks the swap invariant.
 */
export const emitStatus = (
  input: StatusInput,
  state: EmitState,
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* statusRegion() {
    const headingId = scopedId(input.instance, "status", "heading");
    const heading = yield* itemPart(
      state.parts,
      "statusHeading",
      { id: headingId },
      [text(message(state.locale, input.heading))],
      { headingLevel: state.headingLevel },
    );
    const detail = yield* statusDetail(input, state);

    return yield* itemPart(
      state.parts,
      "status",
      {
        "aria-labelledby": headingId,
        id: scopedId(input.instance, "status"),
        role: "status",
        tabindex: "-1",
        ...when(input.autofocus === true, { autofocus: true }),
      },
      [heading, ...detail],
    );
  });
