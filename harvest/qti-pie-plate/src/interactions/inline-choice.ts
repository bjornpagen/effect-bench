/**
 * Inline Choice (Q-12): its parts, its connect function and its response validation, on the
 * module shape of Choice and Text Entry.
 *
 * {@link renderInlineChoice} emits this structure: a `qti-inline-choice-interaction` Root, a
 * phrasing container that stands inside the author's sentence, holding the Label when the item has
 * a `qti-label`, and one native `select`, the Control. The Control's first option is the
 * Placeholder, `value=""`, which posts as NULL; each choice is an Option after it, in presented
 * order, holding its content's text. The connect function computes every attribute of every part
 * once, and `applyPart` places each one, through the embedder's replacement when there is one. The
 * Control is a native select, so the browser's own keyboard map applies. In review and solution,
 * and when the author finished the item, the Control is `disabled`, since a `select` has no
 * `readonly`.
 *
 * {@link validateInlineChoice} checks a value the caller decoded, in two tiers: tier (a) always,
 * tier (b) only under `validateResponses` (D5).
 *
 * @module
 */
import { Option, Result, pipe } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { emitNodes, nestedInteraction } from "#plate/emit/body.ts";
import { text, when } from "#plate/emit/node.ts";
import type { Attributes, Element } from "#plate/emit/node.ts";
import { rowFor, scopedId } from "#plate/emit/parts.ts";
import type { PartOf, PartRow } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { Malformed } from "#plate/form/encoding.ts";
import { labelAsSpan } from "#plate/interactions/choice.ts";
import { givesText, textControlName } from "#plate/interactions/name.ts";
import { message, numeral } from "#plate/messages.ts";
import type { Locale } from "#plate/messages.ts";
import type { InlineChoiceInteraction } from "#plate/model/item.ts";
import { format, trimXmlSpace } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";
import type {
  EmitState,
  InlineChoicePayload,
  Payload,
  PayloadNode,
  ValidationMessage,
} from "#plate/payload.ts";

/**
 * The owner of every Inline Choice part in the part table.
 */
const owner = "inline-choice-interaction";

/**
 * An Inline Choice part.
 */
type InlineChoicePart = PartOf<typeof owner>;

/**
 * The row of every Inline Choice part, which no placement changes.
 */
type Rows = { readonly [P in InlineChoicePart]: PartRow };

/**
 * One option of the Control as the connect function computes it: its attributes and the one text
 * node it holds.
 */
interface OptionProps {
  readonly props: Attributes;
  readonly text: string;
}

/**
 * The attributes of every part of one Inline Choice, and the text of each option, computed once
 * by {@link connect}.
 */
interface Connected {
  readonly control: Attributes;
  readonly label: Attributes;
  readonly options: readonly OptionProps[];
  readonly placeholder: OptionProps;
  readonly root: Attributes;
}

/**
 * The rows of the Inline Choice parts.
 */
const rows: Rows = {
  control: rowFor(owner, "control"),
  label: rowFor(owner, "label"),
  option: rowFor(owner, "option"),
  placeholder: rowFor(owner, "placeholder"),
  root: rowFor(owner, "root"),
};

/**
 * Collect the text of a choice's content: every text node, at any depth, as written.
 *
 * A native option holds text only, so the content's elements give their text and nothing else. The
 * builder renders an Inline Choice only when its choices hold text and the text-safe elements, so a
 * notice or an interaction never reaches here from a checked item; each gives no text.
 *
 * @param nodes The choice's content, as the payload holds it.
 * @returns The text, concatenated as written.
 */
const textIn = (nodes: readonly PayloadNode[]): string =>
  nodes
    .map((node) => {
      switch (node.kind) {
        case "text": {
          return node.text;
        }
        case "element": {
          return textIn(node.children);
        }
        case "notice":
        case "choice":
        case "extended-text":
        case "inline-choice":
        case "text-entry": {
          return "";
        }
        default: {
          // Only a payload that lost its type on the way here holds another kind.
          node satisfies never;

          return "";
        }
      }
    })
    .join("");

/**
 * Collapse runs of ASCII whitespace to one space and trim the ends, as an option's label is read.
 *
 * @param value The text.
 * @returns The collapsed text.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#concept-option-label
 */
const collapse = (value: string): string =>
  value.replaceAll(/[\t\n\f\r ]+/gu, " ").replaceAll(/^ | $/gu, "");

/**
 * Give an Option's text: its choice's content text, collapsed ({@link collapse}); for a choice
 * whose text is blank, "Choice n of count", `n` its presented position (Q10).
 *
 * @param content The choice's content.
 * @param position The choice's position `n`, from 1, among the `count` choices as presented.
 * @param locale The locale of the renderer's own text.
 * @returns The Option's text.
 */
const optionText = (
  content: readonly PayloadNode[],
  position: { readonly count: number; readonly n: number },
  locale: Locale,
): string => {
  const written = collapse(textIn(content));

  return written === ""
    ? message(locale, "choiceOf", {
        count: numeral(locale, position.count),
        n: numeral(locale, position.n),
      })
    : written;
};

/**
 * Give the Placeholder's text: the author's `data-prompt`, as written, unless it is blank (empty,
 * or only XML whitespace, as `authorsLabel` treats a blank `aria-label`), else the locale's
 * `selectPrompt`.
 *
 * @param placeholder The author's `data-prompt`.
 * @param locale The locale of the renderer's own text.
 * @returns The Placeholder's text.
 */
const placeholderText = (placeholder: Option.Option<string>, locale: Locale): string =>
  placeholder.pipe(
    Option.filter((prompt) => trimXmlSpace(prompt) !== ""),
    Option.getOrElse(() => message(locale, "selectPrompt")),
  );

/**
 * Compute every attribute of every part of one Inline Choice, and each option's text: the
 * connect function.
 *
 * - Root: the marker, the state (`data-mode`, and `data-disabled` when the author disabled every
 *   control), and the author's `class`.
 * - Label: its id, and `for` → the Control's id.
 * - Control: its id; the payload's `formName`; `autocomplete="off"`, so the browser offers no
 *   remembered answer; `disabled` when finished or not `editable`, since a `select` has no
 *   `readonly`; its name; `aria-invalid` and `aria-describedby` → the message ids when the response
 *   is invalid; and `autofocus` when the payload says. A Label whose content gives text
 *   ({@link givesText}, the one Label check) names the Control through `aria-labelledby`; else
 *   {@link textControlName} does, as it names a Text Entry. `required`, `size` and `multiple` are
 *   never written: the server validates.
 * - Placeholder: `value=""`, `selected` when no choice is restored, and its text
 *   ({@link placeholderText}).
 * - Option: its choice's identifier as `value`, `selected` when it is the one restored, and its text
 *   ({@link optionText}).
 *
 * @param interaction The Inline Choice, which gives `editable`.
 * @param payload The payload, which gives the instance, the mode and `finished`.
 * @param locale The locale of the renderer's own text.
 * @returns The attributes of every part, and the text of each option.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#the-select-element
 */
const connect = (interaction: InlineChoicePayload, payload: Payload, locale: Locale): Connected => {
  const controlId = scopedId(payload.instance, interaction.response, "control");
  const labelId = scopedId(payload.instance, interaction.response, "label");
  const restored = interaction.choices.some((choice) => choice.identifier === interaction.restore);

  return {
    control: {
      ...(Option.exists(interaction.label, givesText)
        ? { "aria-labelledby": labelId }
        : textControlName(interaction.name, payload.instance, locale)),
      ...when(interaction.invalid, {
        "aria-describedby": interaction.messageIds.join(" "),
        "aria-invalid": "true",
      }),
      ...when(interaction.autofocus, { autofocus: true }),
      autocomplete: "off",
      "data-slot": rows.control.slot,
      ...when(payload.finished || !interaction.editable, { disabled: true }),
      id: controlId,
      name: interaction.formName,
    },
    label: { "data-slot": rows.label.slot, for: controlId, id: labelId },
    options: interaction.choices.map((choice, index) => ({
      props: {
        "data-slot": rows.option.slot,
        ...when(choice.identifier === interaction.restore, { selected: true }),
        value: choice.identifier,
      },
      text: optionText(choice.content, { count: interaction.choices.length, n: index + 1 }, locale),
    })),
    placeholder: {
      props: {
        "data-slot": rows.placeholder.slot,
        ...when(!restored, { selected: true }),
        value: "",
      },
      text: placeholderText(interaction.placeholder, locale),
    },
    root: {
      ...when(interaction.class !== "", { class: interaction.class }),
      ...when(payload.finished, { "data-disabled": true }),
      "data-mode": payload.mode,
      "data-slot": rows.root.slot,
    },
  };
};

/**
 * Render an Inline Choice: a `qti-inline-choice-interaction` Root holding the Label, when the item
 * has a `qti-label`, then a `select` Control holding the Placeholder and one Option per choice, in
 * presented order.
 *
 * Each part goes through `applyPart` with its replacement from `state.parts`, so every swap holds
 * I1 to I4. The Label's content goes through {@link emitNodes}, as the body's does, and then every
 * `label` in it is written as a `span` ({@link labelAsSpan}), as Choice writes its choices'
 * content, since the Label part is a `label` by default and a `label` never nests one; each option
 * holds one text node, its content's text.
 *
 * @param interaction The Inline Choice's payload.
 * @param payload The payload of the whole render, which gives the instance and `finished`.
 * @param state The locale, the heading level and the resolved part overrides.
 * @returns The Inline Choice Root, or {@link PartSwapRefused} when a replacement breaks the swap
 *   invariant.
 * @throws {NestedInteractionDefect} When the Label's content holds an interaction, which QTI admits
 *   nowhere there ({@link nestedInteraction}).
 */
export const renderInlineChoice = (
  interaction: InlineChoicePayload,
  payload: Payload,
  state: EmitState,
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* inlineChoiceRoot() {
    const replacement = (part: InlineChoicePart) =>
      Option.getOrUndefined(state.parts.replacementFor(owner, part));
    const props = connect(interaction, payload, state.locale);
    const placeOption = (part: "option" | "placeholder", option: OptionProps) =>
      applyPart(rows[part], option.props, [text(option.text)], replacement(part));

    const placeholder = yield* placeOption("placeholder", props.placeholder);
    const options = yield* pipe(
      props.options.map((option) => placeOption("option", option)),
      Result.all,
    );
    const control = yield* applyPart(
      rows.control,
      props.control,
      [placeholder, ...options],
      replacement("control"),
    );
    const label = yield* Result.transposeOption(
      interaction.label.pipe(
        Option.map((content) =>
          Result.flatMap(emitNodes(content, payload, state, nestedInteraction(owner)), (nodes) =>
            applyPart(rows.label, props.label, nodes.map(labelAsSpan), replacement("label")),
          ),
        ),
      ),
    );

    return yield* applyPart(
      rows.root,
      props.root,
      [...Option.toArray(label), control],
      replacement("root"),
    );
  });

/**
 * Check an Inline Choice's response, which the caller decoded, in two tiers.
 *
 * The caller decodes the posted entry with `decode`, under the entry name its form gave the
 * Control and the Inline Choice's binding (one identifier), and passes the value, or the
 * {@link Malformed} `decode` gave. The Placeholder posts `""`, which decodes to NULL. So the entry
 * name stays the caller's, while the messages and the author's override stay here.
 *
 * - A {@link Malformed} input: `atMost` 1 when the response was posted more than once, else
 *   `unknownChoice`.
 * - Tier (a), always: an identifier that names no choice gives `unknownChoice`. Identifiers compare
 *   exactly, so `a` does not name a choice `A`.
 * - Tier (b), only under `validateResponses`: fewer identifiers than needed gives `atLeast` with the
 *   count needed. That count is `min-choices`, raised to 1 when `required` is true; NULL is
 *   accepted when it is 0. A `min-choices` above 1 is validated as written, so then every response
 *   is refused (R-P6-1).
 *
 * The author's `data-min-selections-message` replaces the renderer's text for `atLeast`.
 *
 * @param interaction The Inline Choice.
 * @param input The decoded value, or why the entries did not decode.
 * @param configuration The configuration, which gives the locale and `validateResponses`.
 * @returns One message per problem, none when the response is accepted.
 */
export const validateInlineChoice = (
  interaction: InlineChoiceInteraction,
  input: Value | Malformed,
  configuration: Configuration,
): readonly ValidationMessage[] => {
  const { locale } = configuration;
  const say = (words: string): ValidationMessage => ({
    response: interaction.response,
    text: words,
  });

  if (input instanceof Malformed) {
    return [
      say(
        input.reason === "single-many"
          ? message(locale, "atMost", { n: numeral(locale, 1n) })
          : message(locale, "unknownChoice"),
      ),
    ];
  }

  const presented = new Set(interaction.choices.map((choice) => choice.identifier));
  const chosen = input.values.map(format);
  const needed = interaction.required && interaction.minChoices < 1n ? 1n : interaction.minChoices;

  return [
    ...(chosen.some((identifier) => !presented.has(identifier))
      ? [say(message(locale, "unknownChoice"))]
      : []),
    ...(configuration.validateResponses && BigInt(chosen.length) < needed
      ? [
          say(
            Option.getOrElse(interaction.messages.min, () =>
              message(locale, "atLeast", { n: numeral(locale, needed) }),
            ),
          ),
        ]
      : []),
  ];
};
