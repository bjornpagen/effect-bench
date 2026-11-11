/**
 * Choice (Q-2), the discovery interaction: its parts, its connect function and its response
 * validation, the module shape Text Entry and Extended Text copy.
 *
 * {@link renderChoice} emits this structure: a native `fieldset` Root, the Prompt, and a
 * `ul` of Choices, each `li > [Control, Label > [Indicator, …choice content]]`. The connect
 * function computes every attribute of every part once, and `applyPart` places each one, through
 * the embedder's replacement when there is one (ruling `fb4fe744` S1, S2). The Controls are native
 * radios or checkboxes, so the browser's own keyboard map applies: the radios form one
 * native group by their shared `name`. The Prompt and each choice's content go through the body's
 * {@link emitNodes}, so they get the body's id scoping, heading shift, URLs and Notices.
 *
 * {@link validateChoice} checks a value the caller decoded, in two tiers: tier (a) always, tier (b)
 * only under `validateResponses` (D5).
 *
 * @module
 */
import { Option, Result, pipe } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { emitNodes, nestedInteraction } from "#plate/emit/body.ts";
import { h, when } from "#plate/emit/node.ts";
import type { Attributes, Element, Node } from "#plate/emit/node.ts";
import { promptMarkupFor, rowFor, scopedId } from "#plate/emit/parts.ts";
import type { PartOf, PartRow, PromptMarkup, RowContext } from "#plate/emit/parts.ts";
import { applyPart } from "#plate/emit/swap.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { Malformed } from "#plate/form/encoding.ts";
import { authorsName, choiceControlName } from "#plate/interactions/name.ts";
import { message, numeral } from "#plate/messages.ts";
import type { Locale } from "#plate/messages.ts";
import type { ChoiceInteraction } from "#plate/model/item.ts";
import { format } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";
import type {
  ChoicePayload,
  EmitState,
  Payload,
  PayloadNode,
  ValidationMessage,
} from "#plate/payload.ts";

/**
 * The owner of every Choice part in the part table.
 */
const owner = "choice-interaction";

/**
 * A Choice part.
 */
type ChoicePart = PartOf<typeof owner>;

/**
 * The row of every Choice part as placed, the Root's and the Prompt's set by the Prompt's markup.
 */
type Rows = { readonly [P in ChoicePart]: PartRow };

/**
 * The attributes the connect function computes for one choice's parts, beside the content its
 * Label holds.
 */
interface ChoiceItem {
  readonly choice: Attributes;
  readonly content: readonly PayloadNode[];
  readonly control: Attributes;
  readonly indicator: Attributes;
  readonly label: Attributes;
}

/**
 * The attributes of every part of one Choice, computed once by {@link connect}.
 */
interface Connected {
  readonly choices: Attributes;
  /**
   * One per choice, in document order.
   */
  readonly items: readonly ChoiceItem[];
  readonly prompt: Attributes;
  readonly root: Attributes;
}

/**
 * Give the row of every Choice part for a Prompt markup.
 *
 * @param markup The Prompt's markup, none when the Choice has no Prompt.
 * @returns The rows; the Root and Prompt rows follow the markup, the table's when there is none.
 */
const rowsFor = (markup: Option.Option<PromptMarkup>): Rows => {
  const context: RowContext = Option.match(markup, {
    onNone: () => ({}),
    onSome: (promptMarkup) => ({ promptMarkup }),
  });

  return {
    choice: rowFor(owner, "choice"),
    choices: rowFor(owner, "choices"),
    control: rowFor(owner, "control"),
    indicator: rowFor(owner, "indicator"),
    label: rowFor(owner, "label"),
    prompt: rowFor(owner, "prompt", context),
    root: rowFor(owner, "root", context),
  };
};

/**
 * Compute every attribute of every part of one Choice: the connect function.
 *
 * - Root: the marker, the state (`data-mode`, and `data-disabled` when the author disabled every
 *   control), the author's `class`, `data-orientation`, and the group's name, in the text controls'
 *   order of precedence: with a Prompt, the Prompt names it (a `legend` natively, or
 *   `aria-labelledby` → the Prompt's id under the `labelledby` markup) and the author's
 *   `aria-label` and `aria-labelledby` are not written; with none, the author's `aria-label`, and
 *   `aria-labelledby` with each id scoped by the instance, written only when it names an id; with
 *   neither, the group stays unnamed. It carries no `role`: a native `fieldset` is the group.
 * - Prompt: the marker, and its id under the `labelledby` markup; a `legend` names its group natively
 *   and needs none.
 * - Control: a radio when one choice can be posted (`max-choices` 1, or a single response), else a
 *   checkbox; its id, the payload's `formName` and its value; `checked` from the restore;
 *   `disabled` when finished or not `editable` (in `review` and `solution`), which keeps its name
 *   and value but takes it out of the tab order and out of the entries its form posts, unlike a
 *   text Control's `readonly`; no `autocomplete` in any mode, an attribute HTML does not apply to a
 *   radio or a checkbox; its name ({@link choiceControlName}): `aria-labelledby` → its Label, or,
 *   when the choice's content gives no text, the renderer's `aria-label` "Choice n of count", `n`
 *   its position as emitted; `aria-invalid` and `aria-describedby` → the message ids when the
 *   response is invalid; and `autofocus` on the first Control when the payload says.
 * - Indicator: `aria-hidden="true"`. Label: its id, and `for` → its Control.
 *
 * Every id is `scopedId(instance, response, part, index)`.
 *
 * @param interaction The Choice, which gives `editable`.
 * @param payload The payload, which gives the instance, the mode and `finished`.
 * @param rows The rows of the Choice's parts as placed.
 * @param markup The Prompt's markup, none when there is no Prompt.
 * @param locale The locale of the renderer's own text.
 * @returns The attributes of every part.
 * @see https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set
 */
const connect = (
  interaction: ChoicePayload,
  payload: Payload,
  rows: Rows,
  markup: Option.Option<PromptMarkup>,
  locale: Locale,
): Connected => {
  const { instance } = payload;
  const promptId = scopedId(instance, interaction.response, "prompt");
  const labelledby = Option.contains(markup, "labelledby");
  const type =
    interaction.maxChoices === 1n || interaction.cardinality === "single" ? "radio" : "checkbox";

  return {
    choices: { "data-slot": rows.choices.slot },
    items: interaction.choices.map((choice, index) => {
      const controlId = scopedId(instance, interaction.response, "control", index);
      const labelId = scopedId(instance, interaction.response, "label", index);

      return {
        choice: { "data-slot": rows.choice.slot },
        content: choice.content,
        control: {
          ...choiceControlName(
            choice.content,
            labelId,
            { count: interaction.choices.length, n: index + 1 },
            locale,
          ),
          ...when(interaction.invalid, {
            "aria-describedby": interaction.messageIds.join(" "),
            "aria-invalid": "true",
          }),
          ...when(interaction.autofocus && index === 0, { autofocus: true }),
          ...when(interaction.restore.includes(choice.identifier), { checked: true }),
          "data-slot": rows.control.slot,
          ...when(payload.finished || !interaction.editable, { disabled: true }),
          id: controlId,
          name: interaction.formName,
          type,
          value: choice.identifier,
        },
        indicator: { "aria-hidden": "true", "data-slot": rows.indicator.slot },
        label: { "data-slot": rows.label.slot, for: controlId, id: labelId },
      };
    }),
    prompt: { "data-slot": rows.prompt.slot, ...when(labelledby, { id: promptId }) },
    root: {
      ...when(labelledby, { "aria-labelledby": promptId }),
      ...when(Option.isNone(markup), authorsName(interaction, instance)),
      ...when(interaction.class !== "", { class: interaction.class }),
      ...when(payload.finished, { "data-disabled": true }),
      "data-mode": payload.mode,
      ...Option.match(interaction.orientation, {
        onNone: () => ({}),
        onSome: (orientation) => ({ "data-orientation": orientation }),
      }),
      "data-slot": rows.root.slot,
    },
  };
};

/**
 * Write every `label` element in a node of emitted content that sits inside a Label part, at any
 * depth, as a `span` with the same children and the same attributes, `for` dropped.
 *
 * A `label` never nests a `label`. The XSD admits `label` in `qti-simple-choice`, and a
 * choice's content sits inside its Label part, a `label` by default, which already labels the
 * choice's Control; an Inline Choice's Label content sits inside its Label part, a `label` by
 * default, the same way. So an authored `label` there is written as a `span`, and loses `for`,
 * which is not an attribute of `span`. A subtree that holds no `label` is kept by identity.
 *
 * @param node A node of a choice's content or of an Inline Choice's Label content, as
 *   {@link emitNodes} gave it.
 * @returns The node with no `label` element at or below it.
 */
export const labelAsSpan = (node: Node): Node => {
  if (node.kind === "text") {
    return node;
  }

  const rewritten = node.children.map(labelAsSpan);
  const children = rewritten.every((child, index) => child === node.children[index])
    ? node.children
    : rewritten;

  if (node.tag === "label") {
    return h(
      "span",
      Object.fromEntries(Object.entries(node.attrs).filter(([name]) => name !== "for")),
      children,
    );
  }

  return children === node.children ? node : h(node.tag, node.attrs, children);
};

/**
 * Render a Choice: a `fieldset` Root holding the Prompt, when there is
 * one, then a `ul` of Choices, each `li > [Control, Label > [Indicator, …choice content]]`.
 *
 * The Prompt's markup is picked from its emitted content (rule `efed9867`): a Prompt of phrasing
 * content is the Root's first child, a `legend`; any other is a `qti-prompt` the Root names through
 * `aria-labelledby`. Choices render in the payload's order, seeded when shuffled. Each part goes
 * through `applyPart` with its replacement from `state.parts`, so every swap holds I1 to I4. The
 * Prompt's and each choice's content go through {@link emitNodes}, as the body's do; then every
 * `label` in a choice's content is written as a `span` ({@link labelAsSpan}) before the Label part
 * takes it, so a replacement Label is handed the rewritten children.
 *
 * @param interaction The Choice's payload.
 * @param payload The payload of the whole render, which gives the instance and `finished`.
 * @param state The locale, the heading level and the resolved part overrides.
 * @returns The Choice Root, or {@link PartSwapRefused} when a replacement breaks the swap
 *   invariant.
 * @throws {NestedInteractionDefect} When the Prompt or a choice's content holds an interaction,
 *   which QTI admits nowhere there ({@link nestedInteraction}).
 */
export const renderChoice = (
  interaction: ChoicePayload,
  payload: Payload,
  state: EmitState,
): Result.Result<Element, PartSwapRefused> => {
  const emitContent = (
    nodes: readonly PayloadNode[],
  ): Result.Result<readonly Node[], PartSwapRefused> =>
    emitNodes(nodes, payload, state, nestedInteraction(owner));
  const replacement = (part: ChoicePart) =>
    Option.getOrUndefined(state.parts.replacementFor(owner, part));

  return Result.gen(function* choiceRoot() {
    const promptContent = yield* Result.transposeOption(
      interaction.prompt.pipe(Option.map(emitContent)),
    );
    const markup = promptContent.pipe(Option.map(promptMarkupFor));
    const rows = rowsFor(markup);
    const props = connect(interaction, payload, rows, markup, state.locale);

    const choices = yield* pipe(
      props.items.map((item) =>
        Result.gen(function* choiceItem() {
          const nodes = (yield* emitContent(item.content)).map(labelAsSpan);
          const indicator = yield* applyPart(
            rows.indicator,
            item.indicator,
            [],
            replacement("indicator"),
          );
          const label = yield* applyPart(
            rows.label,
            item.label,
            [indicator, ...nodes],
            replacement("label"),
          );
          const control = yield* applyPart(rows.control, item.control, [], replacement("control"));

          return yield* applyPart(
            rows.choice,
            item.choice,
            [control, label],
            replacement("choice"),
          );
        }),
      ),
      Result.all,
    );
    const list = yield* applyPart(rows.choices, props.choices, choices, replacement("choices"));
    const prompt = yield* Result.transposeOption(
      promptContent.pipe(
        Option.map((content) =>
          applyPart(rows.prompt, props.prompt, content, replacement("prompt")),
        ),
      ),
    );

    return yield* applyPart(
      rows.root,
      props.root,
      [...Option.toArray(prompt), list],
      replacement("root"),
    );
  });
};

/**
 * Check a Choice's response, which the caller decoded, in two tiers.
 *
 * The caller decodes the posted entries with `decode`, under the entry name its form gave the
 * Controls and the Choice's binding (identifiers of its cardinality), and passes the value, or the
 * {@link Malformed} `decode` gave. So the entry name stays the caller's, while the messages and the
 * author's overrides stay here.
 *
 * - A {@link Malformed} input: `atMost` 1 when a single response was posted more than once, else
 *   `unknownChoice`.
 * - Tier (a), always: every identifier names a presented choice and none repeats (`unknownChoice`),
 *   and `max-choices` above 0 caps the count whatever `validateResponses` says (D5; `atMost`).
 * - Tier (b), only under `validateResponses`: `min-choices` (`atLeast`).
 *
 * The author's `data-max-selections-message` and `data-min-selections-message` replace the
 * renderer's text for `atMost` and `atLeast`.
 *
 * @param interaction The Choice.
 * @param input The decoded value, or why the entries did not decode.
 * @param configuration The configuration, which gives the locale and `validateResponses`.
 * @returns One message per problem, none when the response is accepted.
 */
export const validateChoice = (
  interaction: ChoiceInteraction,
  input: Value | Malformed,
  configuration: Configuration,
): readonly ValidationMessage[] => {
  const { locale } = configuration;
  const say = (words: string): ValidationMessage => ({
    response: interaction.response,
    text: words,
  });
  const tooMany = (n: bigint) =>
    say(
      Option.getOrElse(interaction.messages.max, () =>
        message(locale, "atMost", { n: numeral(locale, n) }),
      ),
    );
  const tooFew = (n: bigint) =>
    say(
      Option.getOrElse(interaction.messages.min, () =>
        message(locale, "atLeast", { n: numeral(locale, n) }),
      ),
    );
  const unknown = say(message(locale, "unknownChoice"));

  if (input instanceof Malformed) {
    return [input.reason === "single-many" ? tooMany(1n) : unknown];
  }

  const presented = new Set(interaction.choices.map((choice) => choice.identifier));
  const chosen = input.values.map(format);
  const stray = chosen.some((identifier) => !presented.has(identifier));
  const repeated = new Set(chosen).size < chosen.length;

  return [
    ...(stray || repeated ? [unknown] : []),
    ...(interaction.maxChoices > 0n && BigInt(chosen.length) > interaction.maxChoices
      ? [tooMany(interaction.maxChoices)]
      : []),
    ...(configuration.validateResponses && BigInt(chosen.length) < interaction.minChoices
      ? [tooFew(interaction.minChoices)]
      : []),
  ];
};
