/**
 * Extended Text (Q-5): its parts, its connect function and its response validation, on Choice's
 * module shape.
 *
 * {@link renderExtendedText} emits this structure: a `qti-extended-text-interaction` Root holding
 * the Prompt, when there is one, then the payload's `n` Controls, each a native `textarea` whose
 * only child is the text to restore. A `single` binding has one Control, and so has a record one, a
 * string control whose text gives the record's fields, whatever its `max-strings` and a
 * `min-strings` of 100 or less; a `multiple` or `ordered` one has as many as the payload counts
 * (Q9), every one posting under the response's one name, and with more than one the Root is a
 * group (Q10). The connect function computes every attribute of every part once, and `applyPart`
 * places each one, through the embedder's replacement when there is one (ruling `fb4fe744` S1,
 * S2). The browser's own textarea keys apply: Enter adds a line and Tab leaves, so each Control is
 * one tab stop, in order.
 * In review and solution every Control is `readonly`, so it shows its text, stays a tab stop and
 * posts that text with the form, but takes no input; it is `disabled` only when the author
 * finished the item.
 * The Prompt's content goes through the body's {@link emitNodes}, so it gets the body's id
 * scoping, heading shift, URLs and Notices.
 *
 * An `xhtml` Extended Text is presented the same way, its Control marked `data-format="xhtml"`: a
 * plain textarea whose response is the text typed, a `string`, which plate never renders as
 * markup; a restored value is the textarea's text, which the serialiser escapes (Q21: rich-text
 * editing needs script).
 *
 * {@link validateExtendedText} checks a value the caller decoded. Tier (a): a number binding
 * refuses text that is not a number, every binding refuses a file, a single one refuses a second
 * entry, which a native textarea never posts, and a nonzero `max-strings` caps the entries (D5).
 * Tier (b), under `validateResponses`: `min-strings`, and the `pattern-mask` on each member,
 * through {@link patternMessage}. An Extended Text that renders the cap's notice in place of its
 * Controls is not judged against `min-strings`; tier (a) still holds for it.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { exceedsControlCap } from "#plate/control-cap.ts";
import { emitNodes, nestedInteraction } from "#plate/emit/body.ts";
import { text, when } from "#plate/emit/node.ts";
import type { Attributes, Element } from "#plate/emit/node.ts";
import { rowFor, scopedId } from "#plate/emit/parts.ts";
import type { PartOf, PartRow } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { Malformed } from "#plate/form/encoding.ts";
import { authorsName, textControlName } from "#plate/interactions/name.ts";
import { malformedMessage, patternMessage } from "#plate/interactions/pattern.ts";
import { message, numeral } from "#plate/messages.ts";
import type { Locale } from "#plate/messages.ts";
import type { ExtendedTextInteraction } from "#plate/model/item.ts";
import type { Value } from "#plate/model/values.ts";
import type {
  EmitState,
  ExtendedTextPayload,
  Payload,
  PayloadNode,
  ValidationMessage,
} from "#plate/payload.ts";

/**
 * The owner of every Extended Text part in the part table.
 */
const owner = "extended-text-interaction";

/**
 * An Extended Text part.
 */
type ExtendedTextPart = PartOf<typeof owner>;

/**
 * The row of every Extended Text part.
 */
type Rows = { readonly [P in ExtendedTextPart]: PartRow };

/**
 * The attributes of every part of one Extended Text, computed once by {@link connect}.
 */
interface Connected {
  /**
   * One per Control, in order.
   */
  readonly controls: readonly Attributes[];
  readonly prompt: Attributes;
  readonly root: Attributes;
}

/**
 * The rows of the Extended Text parts, which no placement changes.
 */
const rows: Rows = {
  control: rowFor(owner, "control"),
  prompt: rowFor(owner, "prompt"),
  root: rowFor(owner, "root"),
};

/**
 * A line break the HTML parser turns into a line feed: CRLF, or a lone CR.
 */
const lineBreak = /\r\n?/gu;

/**
 * Compute how one Control of an Extended Text is named.
 *
 * - Each Control of a group its Prompt or its author names, a group whose payload has no `unnamed`
 *   position, is the locale's "Answer i of n", `i` its place in the group and `n` the group's
 *   Controls; the group carries the Prompt's or the author's name ({@link groupName}).
 * - A lone Control is named by the Prompt when there is one.
 * - Any other Control is named as any text control is ({@link textControlName}): the author's
 *   `aria-label` and `aria-labelledby`, else the locale's "Answer", or "Answer n of N", `n` its
 *   position among every Control the renderer names in the item.
 *
 * @param interaction The Extended Text.
 * @param instance The item instance key.
 * @param locale The locale of the renderer's own text.
 * @param promptId The Prompt's id, none when there is no Prompt.
 * @param index The Control's index, from 0.
 * @returns The Control's naming attributes.
 */
const controlName = (
  interaction: ExtendedTextPayload,
  instance: string,
  locale: Locale,
  promptId: Option.Option<string>,
  index: number,
): Attributes => {
  if (interaction.n > 1 && Option.isNone(interaction.name.unnamed)) {
    return {
      "aria-label": message(locale, "answerOf", {
        count: numeral(locale, interaction.n),
        n: numeral(locale, index + 1),
      }),
    };
  }

  return Option.match(promptId, {
    onNone: () => textControlName(interaction.name, instance, locale, index),
    onSome: (id) => ({ "aria-labelledby": id }),
  });
};

/**
 * Compute how the group an Extended Text with several Controls makes of its Root is named (Q10):
 * the Prompt when there is one; else the author's `aria-label` and `aria-labelledby`
 * ({@link authorsName}); else nothing, and the group stays unnamed, as a Choice's does.
 *
 * @param interaction The Extended Text.
 * @param instance The item instance key.
 * @param promptId The Prompt's id, none when there is no Prompt.
 * @returns The Root's naming attributes.
 */
const groupName = (
  interaction: ExtendedTextPayload,
  instance: string,
  promptId: Option.Option<string>,
): Attributes =>
  Option.match(promptId, {
    onNone: () => authorsName(interaction.name, instance),
    onSome: (id) => ({ "aria-labelledby": id }),
  });

/**
 * Compute every attribute of every part of one Extended Text: the connect function.
 *
 * - Root: the marker, the state (`data-mode`, and `data-disabled` when the author disabled every
 *   control), the author's `class`, and `data-format="preformatted"` for a preformatted format.
 *   With more than one Control it is a group: `role="group"`, named by {@link groupName}.
 * - Prompt: the marker and its id, which the Control's `aria-labelledby`, or the group's, names.
 * - Each Control: its id, the payload's `formName`, `rows` from `expected-lines` above 0, the
 *   author's `placeholder-text`, `disabled` when finished, `readonly` when the interaction is not
 *   `editable` (review and solution), `autocomplete="off"` in every mode, so the browser offers no
 *   remembered answer, its name, `aria-invalid` and `aria-describedby` → the message ids when the
 *   response is invalid, `autofocus` on the first Control when the payload says, and
 *   `data-format="xhtml"` for the `xhtml` format. Each is named by {@link controlName}.
 *
 * Every id is `scopedId(instance, response, part)`, a Control's with its index from 0 when there
 * are several.
 *
 * @param interaction The Extended Text, which gives `editable`.
 * @param payload The payload, which gives the instance, the mode and `finished`.
 * @param locale The locale of the renderer's own text.
 * @returns The attributes of every part.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#attr-textarea-readonly
 * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-autocomplete
 */
const connect = (interaction: ExtendedTextPayload, payload: Payload, locale: Locale): Connected => {
  const { instance } = payload;
  const promptId = scopedId(instance, interaction.response, "prompt");
  const prompted = interaction.prompt.pipe(Option.as(promptId));
  const grouped = interaction.n > 1;
  const placeholder = Option.match(interaction.placeholder, {
    onNone: () => ({}),
    onSome: (written) => ({ placeholder: written }),
  });
  const lines = interaction.expectedLines.pipe(
    Option.filter((expected) => expected > 0n),
    Option.match({
      onNone: () => ({}),
      onSome: (expected) => ({ rows: String(expected) }),
    }),
  );

  return {
    controls: Array.from({ length: interaction.n }, (_, index) => ({
      ...controlName(interaction, instance, locale, prompted, index),
      ...when(interaction.invalid, {
        "aria-describedby": interaction.messageIds.join(" "),
        "aria-invalid": "true",
      }),
      ...when(interaction.autofocus && index === 0, { autofocus: true }),
      autocomplete: "off",
      ...when(interaction.format === "xhtml", { "data-format": "xhtml" }),
      "data-slot": rows.control.slot,
      ...when(payload.finished, { disabled: true }),
      id: grouped
        ? scopedId(instance, interaction.response, "control", index)
        : scopedId(instance, interaction.response, "control"),
      name: interaction.formName,
      ...when(!interaction.editable, { readonly: true }),
      ...placeholder,
      ...lines,
    })),
    prompt: { "data-slot": rows.prompt.slot, id: promptId },
    root: {
      ...when(grouped, { role: "group", ...groupName(interaction, instance, prompted) }),
      ...when(interaction.class !== "", { class: interaction.class }),
      ...when(payload.finished, { "data-disabled": true }),
      ...when(interaction.format === "preformatted", { "data-format": "preformatted" }),
      "data-mode": payload.mode,
      "data-slot": rows.root.slot,
    },
  };
};

/**
 * Render an Extended Text: a `qti-extended-text-interaction` Root
 * holding the Prompt, when there is one, then the cap's notice, when the payload holds it, then
 * the payload's `n` Controls, each a `textarea`.
 *
 * Each Control's only child is the text it restores, its line breaks written as line feeds, as the
 * HTML parser reads them; it has no child when that text is empty. That child is text in every
 * format, `xhtml` included, so markup an author or candidate typed is written escaped. An
 * Extended Text over the cap (Q23) holds the notice `min-strings>100` and no Control, or beside
 * its first 100 Controls the notice that a restored value held more. Each part goes through
 * `applyPart` with its replacement from `state.parts`, so every swap holds I1 to I4. The Prompt's
 * content and the notice go through {@link emitNodes}, as the body's do, so the notice is the
 * Notice part at a phrasing position.
 *
 * @param interaction The Extended Text's payload.
 * @param payload The payload of the whole render, which gives the instance and `finished`.
 * @param state The locale, the heading level and the resolved part overrides.
 * @returns The Extended Text Root, or {@link PartSwapRefused} when a replacement breaks the swap
 *   invariant.
 * @throws {NestedInteractionDefect} When the Prompt holds an interaction, which QTI admits nowhere
 *   there ({@link nestedInteraction}).
 */
export const renderExtendedText = (
  interaction: ExtendedTextPayload,
  payload: Payload,
  state: EmitState,
): Result.Result<Element, PartSwapRefused> =>
  Result.gen(function* extendedTextRoot() {
    const replacement = (part: ExtendedTextPart) =>
      Option.getOrUndefined(state.parts.replacementFor(owner, part));
    const props = connect(interaction, payload, state.locale);
    const emitContent = (nodes: readonly PayloadNode[]) =>
      emitNodes(nodes, payload, state, nestedInteraction(owner));

    const prompt = yield* Result.transposeOption(
      interaction.prompt.pipe(
        Option.map((content) =>
          Result.flatMap(emitContent(content), (nodes) =>
            applyPart(rows.prompt, props.prompt, nodes, replacement("prompt")),
          ),
        ),
      ),
    );
    const notice = yield* emitContent(Option.toArray(interaction.notice));
    const controls = yield* Result.all(
      props.controls.map((attributes, index) => {
        const restore = (interaction.restores[index] ?? "").replaceAll(lineBreak, "\n");

        return applyPart(
          rows.control,
          attributes,
          restore === "" ? [] : [text(restore)],
          replacement("control"),
        );
      }),
    );

    return yield* applyPart(
      rows.root,
      props.root,
      [...Option.toArray(prompt), ...notice, ...controls],
      replacement("root"),
    );
  });

/**
 * Give the messages a decoded value's number of entries earns: more than a nonzero `max-strings`
 * always (tier (a); D5, a hard cap), fewer than `min-strings` only under `validateResponses` (tier
 * (b)). `decode` drops the empty entries, so the value's members are the non-empty ones.
 * `max-strings="0"` limits nothing (reading 53). Each count reads in the singular at 1.
 *
 * An Extended Text whose `min-strings` exceeds the cap of 100 renders the cap's notice in place of
 * its Controls (Q23), so it is unsupported and earns no `atLeastStrings`; a nonzero `max-strings`
 * still caps its entries.
 *
 * @param interaction The Extended Text.
 * @param value The decoded value.
 * @param configuration The configuration, which gives `validateResponses` and the locale.
 * @returns `atMostStrings` or `atLeastStrings`, or none.
 */
const countMessages = (
  interaction: ExtendedTextInteraction,
  value: Value,
  configuration: Configuration,
): readonly string[] => {
  const { locale } = configuration;
  const entries = BigInt(value.values.length);
  const tooMany = interaction.maxStrings.pipe(
    Option.filter((maxStrings) => maxStrings > 0n && entries > maxStrings),
    Option.map((maxStrings) =>
      maxStrings === 1n
        ? message(locale, "atMostOneString")
        : message(locale, "atMostStrings", { n: numeral(locale, maxStrings) }),
    ),
  );
  const tooFew = Option.some(interaction.minStrings).pipe(
    Option.filter(
      (minStrings) =>
        configuration.validateResponses && !exceedsControlCap(minStrings) && entries < minStrings,
    ),
    Option.map((minStrings) =>
      minStrings === 1n
        ? message(locale, "atLeastOneString")
        : message(locale, "atLeastStrings", { n: numeral(locale, minStrings) }),
    ),
  );

  return [...Option.toArray(tooMany), ...Option.toArray(tooFew)];
};

/**
 * Check an Extended Text's response, which the caller decoded.
 *
 * The caller decodes the posted entries with `decode`, under the entry name its form gave the
 * Controls and the Extended Text's binding (a value of its base type and cardinality, an integer
 * read in its `base`), and passes the value, or the {@link Malformed} `decode` gave. For a record
 * binding, `checkResponses` passes the record's `stringValue` as a single string, NULL when it has
 * none.
 *
 * - A {@link Malformed} input of any binding, by its reason ({@link malformedMessage}):
 *   `malformedFile` for a file and `malformedSingleMany` for a second entry, which a native form
 *   never posts; for a text that is not a number of an `integer` or `float` binding, the author's
 *   `data-patternmask-message` when set, else `malformedNumber`; `notAccepted` for any other
 *   reason.
 * - A decoded value with more entries than a nonzero `max-strings` gives `atMostStrings`, whatever
 *   `validateResponses` says. Under `validateResponses`, one with fewer than `min-strings` gives
 *   `atLeastStrings`, and each member is checked against the `pattern-mask`
 *   ({@link patternMessage}): a mismatch gives the author's `data-patternmask-message`, else
 *   `patternMismatch`. NULL is not checked against the pattern.
 *
 * An Extended Text whose `min-strings` exceeds 100 renders the cap's notice in place of its
 * Controls (Q23). It is unsupported, so tier (b) does not judge its `min-strings` and its item can
 * still be submitted. Tier (a) holds: the value posted for it, which no Control sends, still gets
 * `atMostStrings` over a nonzero `max-strings`, and every other check above.
 *
 * An item whose `min-strings` exceeds a `max-strings` of 10 or less renders `max-strings` Controls
 * (Q9), so under `validateResponses` every post of it meets `atLeastStrings`. That is recorded, not
 * handled: the information model forbids the item, and neither package refuses it.
 *
 * @param interaction The Extended Text.
 * @param input The decoded value, or why the entries did not decode.
 * @param configuration The configuration, which gives `validateResponses` and the locale.
 * @returns One message per problem, none when the response is accepted.
 */
export const validateExtendedText = (
  interaction: ExtendedTextInteraction,
  input: Value | Malformed,
  configuration: Configuration,
): readonly ValidationMessage[] => {
  if (!(input instanceof Malformed)) {
    return [
      ...countMessages(interaction, input, configuration),
      ...Option.toArray(patternMessage(interaction, input, configuration)),
    ].map((words) => ({ response: interaction.response, text: words }));
  }

  return [
    {
      response: interaction.response,
      text: malformedMessage(interaction, input.reason, configuration.locale),
    },
  ];
};
