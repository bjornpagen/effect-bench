/**
 * Text Entry (Q-20): its parts, its connect function and its response validation, on the module
 * shape of Choice.
 *
 * {@link renderTextEntry} emits this structure: a `qti-text-entry-interaction` Root, a phrasing
 * container that stands inside the author's sentence, holding one native text `input`, the Control.
 * A Text Entry bound to a record response is this control as a string one: the text typed gives the
 * record's fields. The connect function computes every attribute of both parts once, and
 * `applyPart` places each one, through the embedder's replacement when there is one (ruling
 * `fb4fe744` S1, S2). The Control is a native text input, so the browser's own keyboard map
 * applies, and Enter submits the author's form by implicit submission. In review and solution the
 * Control is `readonly`, so it shows its value, stays a tab stop and posts that value with the
 * form, but takes no input; it is `disabled` only when the author finished the item.
 *
 * {@link validateTextEntry} checks a value the caller decoded. Tier (a) always applies: a posted
 * text that is not a number of the bound base type, or a file or a second entry, which a native
 * text input never posts. Tier (b), under `validateResponses`, adds the `pattern-mask` check
 * ({@link patternMessage}). A record is judged as the string it was typed as, its `stringValue`,
 * which `checkResponses` passes. `expected-length` is never judged, for any binding: it sets the
 * Control's `size` only, as it is not a validity constraint.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { when } from "#plate/emit/node.ts";
import type { Attributes, Element } from "#plate/emit/node.ts";
import { rowFor, scopedId } from "#plate/emit/parts.ts";
import type { PartOf, PartRow } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { Malformed } from "#plate/form/encoding.ts";
import { textControlName } from "#plate/interactions/name.ts";
import { malformedMessage, patternMessage } from "#plate/interactions/pattern.ts";
import type { Locale } from "#plate/messages.ts";
import type { TextEntryInteraction } from "#plate/model/item.ts";
import type { Value } from "#plate/model/values.ts";
import type { EmitState, Payload, TextEntryPayload, ValidationMessage } from "#plate/payload.ts";

/**
 * The owner of every Text Entry part in the part table.
 */
const owner = "text-entry-interaction";

/**
 * A Text Entry part.
 */
type TextEntryPart = PartOf<typeof owner>;

/**
 * The row of every Text Entry part.
 */
type Rows = { readonly [P in TextEntryPart]: PartRow };

/**
 * The attributes of every part of one Text Entry, computed once by {@link connect}.
 */
type Connected = { readonly [P in TextEntryPart]: Attributes };

/**
 * The rows of the Text Entry parts, which no placement changes.
 */
const rows: Rows = {
  control: rowFor(owner, "control"),
  root: rowFor(owner, "root"),
};

/**
 * Give the attributes of an optional value, none when it is absent.
 *
 * @param value The value.
 * @param attributes The attributes the present value gives.
 * @returns The attributes, or none.
 */
const whenSome = <A>(value: Option.Option<A>, attributes: (present: A) => Attributes): Attributes =>
  Option.match(value, { onNone: () => ({}), onSome: attributes });

/**
 * Give the virtual keyboard a Text Entry asks for: digits for an integer in a base whose digits
 * are all decimal, a decimal keypad for a float.
 *
 * An integer in a base above 10 takes letters as digits, which a numeric keypad cannot type, so it
 * asks for none.
 *
 * @param interaction The Text Entry.
 * @returns The `inputmode` attribute, or none.
 */
const inputModeOf = (interaction: TextEntryPayload): Attributes => {
  if (interaction.baseType === "float") {
    return { inputmode: "decimal" };
  }

  return when(interaction.baseType === "integer" && interaction.base <= 10, {
    inputmode: "numeric",
  });
};

/**
 * Compute every attribute of both parts of one Text Entry: the connect function.
 *
 * - Root: the marker, the state (`data-mode`, and `data-disabled` when the author disabled every
 *   control), and the author's `class`.
 * - Control: a text `input`; its id, the payload's `formName` and its restored `value`; `disabled`
 *   when finished; `readonly` when the interaction is not `editable` (review and solution);
 *   `autocomplete="off"` in every mode, so the browser offers no remembered answer; `inputmode` by
 *   the base type; `expected-length` as `size` when above 0, which HTML requires;
 *   `placeholder-text` as `placeholder`; its name ({@link textControlName}); `aria-invalid` and
 *   `aria-describedby` → the message ids when the response is invalid; and `autofocus` when the
 *   payload says.
 *
 * @param interaction The Text Entry, which gives `editable`.
 * @param payload The payload, which gives the instance, the mode and `finished`.
 * @param locale The locale of the renderer's own text.
 * @returns The attributes of both parts.
 * @see https://html.spec.whatwg.org/multipage/input.html#attr-input-readonly
 * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete
 */
const connect = (interaction: TextEntryPayload, payload: Payload, locale: Locale): Connected => ({
  control: {
    ...textControlName(interaction.name, payload.instance, locale),
    ...when(interaction.invalid, {
      "aria-describedby": interaction.messageIds.join(" "),
      "aria-invalid": "true",
    }),
    ...when(interaction.autofocus, { autofocus: true }),
    autocomplete: "off",
    "data-slot": rows.control.slot,
    ...when(payload.finished, { disabled: true }),
    id: scopedId(payload.instance, interaction.response, "control"),
    ...inputModeOf(interaction),
    name: interaction.formName,
    ...when(!interaction.editable, { readonly: true }),
    ...whenSome(interaction.placeholder, (placeholder) => ({ placeholder })),
    ...whenSome(
      interaction.expectedLength.pipe(Option.filter((expected) => expected > 0n)),
      (expected) => ({ size: String(expected) }),
    ),
    type: "text",
    value: interaction.restore,
  },
  root: {
    ...when(interaction.class !== "", { class: interaction.class }),
    ...when(payload.finished, { "data-disabled": true }),
    "data-mode": payload.mode,
    "data-slot": rows.root.slot,
  },
});

/**
 * Render a Text Entry: a `qti-text-entry-interaction` Root holding one
 * text `input` Control.
 *
 * Each part goes through `applyPart` with its replacement from `state.parts`, so every swap holds
 * I1 to I4.
 *
 * @param interaction The Text Entry's payload.
 * @param payload The payload of the whole render, which gives the instance and `finished`.
 * @param state The locale and the resolved part overrides.
 * @returns The Text Entry Root, or {@link PartSwapRefused} when a replacement breaks the swap
 *   invariant.
 */
export const renderTextEntry = (
  interaction: TextEntryPayload,
  payload: Payload,
  state: EmitState,
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* textEntryRoot() {
    const replacement = (part: TextEntryPart) =>
      Option.getOrUndefined(state.parts.replacementFor(owner, part));
    const props = connect(interaction, payload, state.locale);
    const control = yield* applyPart(rows.control, props.control, [], replacement("control"));

    return yield* applyPart(rows.root, props.root, [control], replacement("root"));
  });

/**
 * Check a Text Entry's response, which the caller decoded.
 *
 * The caller decodes the posted entry with `decode`, under the entry name its form gave the
 * Control, the Text Entry's binding (a single value of its base type) and its `base`, and passes
 * the value, or the {@link Malformed} `decode` gave. So the entry name stays the caller's, while
 * the message and the author's override stay here. For a record binding, `checkResponses` passes
 * the record's `stringValue` as a single string, NULL when it has none.
 *
 * - A {@link Malformed} input of any binding, by its reason ({@link malformedMessage}):
 *   `malformedFile` for a file and `malformedSingleMany` for a second entry; for a text that is not
 *   a number of an `integer` or `float` binding, the author's `data-patternmask-message` when set,
 *   else `malformedNumber`; `notAccepted` for any other reason.
 * - A decoded value, under `validateResponses`: one message when it mismatches the Text Entry's
 *   `pattern-mask` ({@link patternMessage}), the author's `data-patternmask-message` or else
 *   `patternMismatch`. NULL, a Text Entry without a `pattern-mask`, and every value without
 *   `validateResponses` give none, and so does a text longer than `expected-length`.
 *
 * @param interaction The Text Entry.
 * @param input The decoded value, or why the entry did not decode.
 * @param configuration The configuration, which gives `validateResponses` and the locale.
 * @returns One message per problem, none when the response is accepted.
 */
export const validateTextEntry = (
  interaction: TextEntryInteraction,
  input: Value | Malformed,
  configuration: Configuration,
): readonly ValidationMessage[] => {
  if (!(input instanceof Malformed)) {
    return Option.toArray(
      Option.map(patternMessage(interaction, input, configuration), (text) => ({
        response: interaction.response,
        text,
      })),
    );
  }

  return [
    {
      response: interaction.response,
      text: malformedMessage(interaction, input.reason, configuration.locale),
    },
  ];
};
