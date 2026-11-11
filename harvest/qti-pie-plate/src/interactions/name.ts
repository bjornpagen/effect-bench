/**
 * How the interactions name their groups and controls for assistive technology (§4.3, §4.8, Q10):
 * the names the author wrote, and the renderer's own for a control the author left unnamed.
 *
 * A Choice, a Text Entry, an Extended Text and an Inline Choice each read the author's
 * `aria-label` and `aria-labelledby` here, so every interaction scopes the author's ids the same
 * way.
 *
 * An id of the author's `aria-labelledby` counts only when an element of the item carries it
 * ({@link resolvedLabelledby}); the payload keeps those ids alone, so no reference the renderer
 * writes names nothing.
 *
 * The renderer names a control only when the author gave it no name, by Q10's rule. The text
 * controls Q10 counts are a Text Entry's `input`, an Extended Text's `textarea`s and an Inline
 * Choice's `select`: each Control of a text control with no Prompt, no Label whose content gives
 * text (an Inline Choice's), and no `aria-label` or `aria-labelledby` (a blank `aria-label`, and an
 * `aria-labelledby` none of whose ids an element of the item carries, each counting as none) is
 * "Answer", or "Answer n of count", `n` its position among every Control the renderer names in the
 * item and `count` their number ({@link textControlName}); a Choice whose content gives no text is
 * "Choice n of count", `n` its position among the Choices as emitted and `count` their number
 * ({@link choiceControlName}). A Choice's content gives text when its text nodes, an `img`'s
 * `alt`, an element's `aria-label` or a notice hold anything but whitespace, `aria-hidden="true"`
 * content left out ({@link givesText}).
 *
 * @module
 */
import { Option } from "effect";
import type { Attributes } from "#plate/emit/node.ts";
import { authoredIdrefs, splitTokens } from "#plate/emit/parts.ts";
import { message, numeral } from "#plate/messages.ts";
import type { Locale } from "#plate/messages.ts";
import type { BodyAttribute, BodyNode } from "#plate/model/item.ts";
import { trimXmlSpace } from "#plate/model/values.ts";
import type { AttributePayload, PayloadNode, TextName } from "#plate/payload.ts";

/**
 * Decide whether a text holds anything but ASCII whitespace, the whitespace a name collapses.
 *
 * @param text The text.
 * @returns Whether it is not blank.
 */
const isWritten = (text: string): boolean => /[^\t\n\f\r ]/u.test(text);

/**
 * Read an attribute of a body element, none when the element does not carry it.
 *
 * @param attributes The element's attributes, as the model or the payload holds them.
 * @param name The attribute's name.
 * @returns Its value, or none.
 */
const attributeOf = (
  attributes: readonly (AttributePayload | BodyAttribute)[],
  name: string,
): Option.Option<string> =>
  Option.fromNullishOr(attributes.find((attribute) => attribute.name === name)?.value);

/**
 * Decide whether nodes give a reader any text, as `checkTree`'s `textOf` reads a subtree: a text
 * node, an `img`'s `alt` and an element's `aria-label`, each counting when it holds anything but
 * whitespace, and a notice, which the renderer writes as text. An element with
 * `aria-hidden="true"` gives none, nor does anything below it.
 *
 * It reads body nodes as well as payload nodes, so the payload's naming (`isUnnamed`, over the
 * model) and the emitter's (over the payload) apply this one rule to the same content. An
 * unsupported part, and a printed variable, count as the notice the payload copies each into. A
 * template block or inline, which a redacted body never holds, counts as its content.
 *
 * @param nodes The nodes: a Choice's content or an Inline Choice's Label, as the model or the
 *   payload holds it.
 * @returns Whether any of them gives text.
 */
export const givesText = (nodes: readonly (BodyNode | PayloadNode)[]): boolean =>
  nodes.some((node) => {
    switch (node.kind) {
      case "text": {
        return isWritten(node.text);
      }
      case "element": {
        const read = (name: string) => Option.exists(attributeOf(node.attributes, name), isWritten);

        return (
          !Option.contains(attributeOf(node.attributes, "aria-hidden"), "true") &&
          (read("aria-label") || (node.tag === "img" && read("alt")) || givesText(node.children))
        );
      }
      case "notice":
      case "printed-variable":
      case "unsupported": {
        return true;
      }
      case "template-block":
      case "template-inline": {
        // Only the model holds one; `redact` replaces it by its content, nothing or its notice.
        return givesText(node.content);
      }
      case "choice":
      case "extended-text":
      case "inline-choice":
      case "text-entry": {
        // No content holds an interaction: the emitter refuses one there (`nestedInteraction`).
        return false;
      }
      default: {
        // Only nodes that lost their type on the way here hold another kind.
        node satisfies never;

        return false;
      }
    }
  });

/**
 * Give the author's `aria-label`, none when the author wrote none or wrote one that is blank:
 * empty, or only XML whitespace. The accessible-name computation skips a blank `aria-label`
 * (accname 1.2, step 2D), so a Control that carried one would have no name at all; it is no name,
 * and is not written. A label that is not blank is given as written.
 *
 * @param names The author's names.
 * @returns The `aria-label` as written, or none.
 * @see https://www.w3.org/TR/accname-1.2/#comp_label
 */
export const authorsLabel = (names: Pick<TextName, "ariaLabel">): Option.Option<string> =>
  names.ariaLabel.pipe(Option.filter((label) => trimXmlSpace(label) !== ""));

/**
 * Keep the ids of the author's `aria-labelledby` that an element of the item carries, in the
 * author's order, joined by one space; none when the author wrote none, or wrote one none of whose
 * ids an element carries. The accessible-name computation follows only an id that names an
 * element (accname 1.2, step 2B), so a Control whose every id names nothing would have no name at
 * all: such an `aria-labelledby` is no name, and is not written.
 *
 * @param names The author's names, the ids unscoped.
 * @param ids The ids the author gave the item's elements, unscoped.
 * @returns The ids that name an element, unscoped, or none.
 * @see https://www.w3.org/TR/accname-1.2/#comp_labelledby
 */
export const resolvedLabelledby = (
  names: Pick<TextName, "ariaLabelledby">,
  ids: ReadonlySet<string>,
): Option.Option<string> =>
  names.ariaLabelledby.pipe(
    Option.map((value) => splitTokens(value).filter((id) => ids.has(id))),
    Option.filter((kept) => kept.length > 0),
    Option.map((kept) => kept.join(" ")),
  );

/**
 * Give the author's `aria-labelledby` with each id scoped by the instance through
 * `authoredIdrefs`, none when the author wrote none or wrote one that names no id. The payload
 * holds only the ids an element of the item carries ({@link resolvedLabelledby}).
 *
 * @param names The author's names, the ids unscoped.
 * @param instance The item instance key, which scopes the author's ids.
 * @returns The scoped ids joined by one space, or none.
 */
const authorsLabelledby = (
  names: Pick<TextName, "ariaLabelledby">,
  instance: string,
): Option.Option<string> =>
  names.ariaLabelledby.pipe(Option.flatMap((ids) => authoredIdrefs(instance, ids)));

/**
 * Give the names the author wrote: `aria-label` as written, and `aria-labelledby` with each id
 * scoped by the instance through `authoredIdrefs`, joined by one space. A blank `aria-label`
 * ({@link authorsLabel}) and an `aria-labelledby` that names no id an element of the item carries
 * ({@link resolvedLabelledby}) are no names, and are not written.
 *
 * @param names The author's `aria-label` and `aria-labelledby`, the ids unscoped.
 * @param instance The item instance key, which scopes the author's ids.
 * @returns The attributes the author gave, none when they gave neither.
 */
export const authorsName = (
  names: Pick<TextName, "ariaLabel" | "ariaLabelledby">,
  instance: string,
): Attributes => ({
  ...Option.match(authorsLabel(names), {
    onNone: () => ({}),
    onSome: (label) => ({ "aria-label": label }),
  }),
  ...Option.match(authorsLabelledby(names, instance), {
    onNone: () => ({}),
    onSome: (ids) => ({ "aria-labelledby": ids }),
  }),
});

/**
 * Name a Control of a text control that no Prompt or Label names (§4.8, Q10): a Text Entry's
 * `input`, an Extended Text's `textarea` or an Inline Choice's `select`.
 *
 * The author's `aria-label` and `aria-labelledby` win ({@link authorsName}). A control with
 * neither, a blank `aria-label` and an `aria-labelledby` that names no id an element of the item
 * carries each counting as none, is named by the renderer: "Answer", or "Answer n of count" when
 * the item holds more than one Control the renderer names, `n` the Control's position among them
 * ({@link TextName}).
 *
 * @param name How the control is named, from the payload.
 * @param instance The item instance key, which scopes the author's ids.
 * @param locale The locale of the renderer's own text.
 * @param index The Control's index, from 0, among its text control's Controls: 0 for a Text Entry
 *   and an Inline Choice, which have one.
 * @returns The naming attributes.
 */
export const textControlName = (
  name: TextName,
  instance: string,
  locale: Locale,
  index = 0,
): Attributes => {
  if (Option.isSome(authorsLabel(name)) || Option.isSome(authorsLabelledby(name, instance))) {
    return authorsName(name, instance);
  }

  return {
    "aria-label": Option.match(name.unnamed.pipe(Option.filter((position) => position.count > 1)), {
      onNone: () => message(locale, "answer"),
      onSome: (position) =>
        message(locale, "answerOf", {
          count: numeral(locale, position.count),
          n: numeral(locale, position.n + index),
        }),
    }),
  };
};

/**
 * Name a Choice's Control (§4.3, Q10).
 *
 * A Control whose content gives text ({@link givesText}) is named by its Label: `aria-labelledby`
 * names the Label's id. One whose content gives none is named by the renderer: `aria-label` is
 * "Choice n of count", and it carries no `aria-labelledby`, since a reference to an empty Label
 * would name it nothing rather than fall back.
 *
 * @param content The Choice's content, as the payload holds it.
 * @param labelId The id of the Choice's Label.
 * @param position The Choice's position `n`, from 1, among the `count` Choices as emitted.
 * @param locale The locale of the renderer's own text.
 * @returns The naming attributes.
 */
export const choiceControlName = (
  content: readonly PayloadNode[],
  labelId: string,
  position: { readonly count: number; readonly n: number },
  locale: Locale,
): Attributes =>
  givesText(content)
    ? { "aria-labelledby": labelId }
    : {
        "aria-label": message(locale, "choiceOf", {
          count: numeral(locale, position.count),
          n: numeral(locale, position.n),
        }),
      };
