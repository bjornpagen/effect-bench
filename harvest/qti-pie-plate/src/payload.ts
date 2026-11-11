/**
 * The payload: the allowlist of what the emitter may know about an item and one render of it.
 *
 * Two copies stand between the item model and the page. {@link redactItem} copies the parts of an
 * item the page may know into a {@link Redacted}, and {@link payload} copies a `Redacted` and the
 * author's {@link View} into the {@link Payload}, the only input the emitter receives. Each copies
 * every field it names one by one and never spreads a model object, so a field the model gains
 * reaches the page only when this file names it. Neither copy holds a correct response, a mapping,
 * a response default, a processing rule, a template rule or feedback content, nor any outcome or
 * template value but the ones the body's printed variables print, as text, and the ones its
 * `param-variable` parameters pass, as their `value`, nor a template visibility: a template block,
 * inline or choice is settled as shown, hidden or withheld before the page sees it. Neither holds a
 * seed: the view's seed only orders a shuffled Choice's or Inline Choice's choices. What the page
 * cannot be given, it cannot leak. A `solution` render shows correct responses only when the author
 * passes them as the view's values; nothing here reads them from the item.
 *
 * @module
 * @see {@link Item} for the model it reads.
 */
import { Array as Arr, Option } from "effect";
import type { Brand } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { controlCap, exceedsControlCap } from "#plate/control-cap.ts";
import { scopedId } from "#plate/emit/parts.ts";
import type { Resolved } from "#plate/emit/parts.ts";
import { formatPrinted, textBound } from "#plate/engine/format.ts";
import type { PrintOptions } from "#plate/engine/format.ts";
import { integerOf } from "#plate/engine/numbers.ts";
import { shuffleOrder } from "#plate/engine/random.ts";
import { own } from "#plate/engine/refs.ts";
import { entryName, isPosted, recordText } from "#plate/form/encoding.ts";
import type { Binding, DecodeOptions } from "#plate/form/encoding.ts";
import { authorsLabel, givesText, resolvedLabelledby } from "#plate/interactions/name.ts";
import type { Locale } from "#plate/messages.ts";
import type { IntegerOrRef } from "#plate/model/expression.ts";
import { interactionsIn } from "#plate/model/interactions.ts";
import type {
  BodyElement,
  BodyNode,
  ChoiceInteraction,
  ExtendedTextInteraction,
  InlineChoiceInteraction,
  Interaction,
  Item,
  PrintedVariable,
  SimpleChoice,
  TemplateContent,
  TemplateDeclaration,
  TemplateVisibility,
  TextEntryInteraction,
  UnsupportedFeature,
} from "#plate/model/item.ts";
import { outcomeDefaults, unrunTemplateProcessing } from "#plate/model/record.ts";
import type { RedactRecord } from "#plate/model/record.ts";
import { format, isRecordValue, nullOf } from "#plate/model/values.ts";
import type { ModelledBaseType, ResponseValue, Single, Value } from "#plate/model/values.ts";
import { clampOutputBudget, defaultOutputBudget } from "#plate/output-budget.ts";

/**
 * A message response validation gives one response, in the locale's text or the author's.
 */
export interface ValidationMessage {
  /**
   * The identifier of the response it concerns.
   */
  readonly response: string;
  readonly text: string;
}

/**
 * The state a render shows an item in, which its Root's `data-mode` names.
 *
 * `answering` lets the candidate change each response. `review` and `solution` show the values the
 * author passes and let the candidate change none: `review` shows a recorded attempt, and
 * `solution` the correct responses, which reach the page only as the author's values.
 */
export type RenderMode = "answering" | "review" | "solution";

/**
 * The author's inputs to one render: the instance, the mode, the seed, the values to show, the
 * entry names, and the messages of a post the author refused.
 *
 * The library decides no flow, so every field is the author's: each map is keyed by response
 * identifier, and a response it omits takes the default the field names. `messages` decides how
 * the controls are filled: when it is not empty, each control shows its `posted` strings, so the
 * candidate sees what they typed, and the first interaction with a message takes `autofocus`;
 * when it is empty, each control shows its value in `values` and `posted` is not read. `locale` is
 * the language of an item that names none.
 */
export interface View {
  /**
   * Whether the author disabled every control.
   */
  readonly finished: boolean;
  /**
   * The item instance key, which scopes every id and each default entry name.
   */
  readonly instance: string;
  readonly locale: Locale;
  readonly messages: readonly ValidationMessage[];
  /**
   * The state the item is shown in, which decides whether the candidate may change a response.
   */
  readonly mode: RenderMode;
  /**
   * The name each response's controls post under, `entryName(instance, response)` when absent.
   */
  readonly names: ReadonlyMap<string, string>;
  readonly posted: Option.Option<ReadonlyMap<string, readonly string[]>>;
  /**
   * The configuration's `seed`, a string written as given, which keys a shuffled Choice's or Inline
   * Choice's order with the instance and the response; keyed as the empty string when absent.
   */
  readonly seed?: string;
  /**
   * The value each response's controls show, such as its `defaultValue` or a value the author's
   * flow recorded; NULL when absent. A record shows its `stringValue`, the text it was typed as,
   * and a record without one shows an empty control.
   */
  readonly values: ReadonlyMap<string, ResponseValue>;
}

/**
 * What the emitter needs beyond the payload: the locale, the base heading level, the base
 * package-relative URLs resolve against, and the resolved part overrides.
 */
export interface EmitState {
  readonly assetBase: string;
  readonly headingLevel: number;
  readonly locale: Locale;
  readonly parts: Resolved;
}

/**
 * A validation message with the id its Message part carries and each Control it concerns names in
 * `aria-describedby`.
 */
export interface MessagePayload extends ValidationMessage {
  /**
   * `scopedId(instance, response, "message", n)`, where `n` counts this response's messages from
   * 0.
   */
  readonly id: string;
}

/**
 * An attribute of a body element, `xml:lang` under the name `xml:lang`.
 */
export interface AttributePayload {
  readonly name: string;
  readonly value: string;
}

/**
 * An HTML element of the item body with its attributes as the model kept them.
 */
export interface ElementPayload {
  readonly attributes: readonly AttributePayload[];
  readonly children: readonly PayloadNode[];
  readonly kind: "element";
  readonly tag: string;
}

/**
 * A run of body text, whitespace included.
 */
export interface TextPayload {
  readonly kind: "text";
  readonly text: string;
}

/**
 * A body part plate does not render, which the emitter shows as the Notice part.
 */
export interface NoticePayload {
  /**
   * The feature's key in QTI's own spelling, such as `qti-hotspot-interaction`.
   */
  readonly feature: string;
  readonly kind: "notice";
}

/**
 * What every interaction payload says about the view's messages for its response.
 *
 * `invalid` holds when its response has a message, and `messageIds` names those messages in order.
 * `autofocus` holds on the first interaction in document order with a message; its connect
 * function writes `autofocus` on that interaction's first Control.
 */
export interface ValidationPayload {
  readonly autofocus: boolean;
  readonly invalid: boolean;
  readonly messageIds: readonly string[];
}

/**
 * What every interaction payload says about the render's mode.
 *
 * `editable` holds exactly when the mode is `answering`. When it is false, in `review` and
 * `solution`, the candidate may change no response, and the interaction's render function is to
 * show its Controls' values without accepting input. It is apart from the payload's `finished`,
 * the author's choice to disable every control, so a Control accepts input only when `editable`
 * holds and `finished` does not.
 */
export interface ModePayload {
  readonly editable: boolean;
}

/**
 * A Choice as the page may know it (Q-2): its binding, its constraints, its Prompt, its choices in
 * the order they are presented, and the identifiers to show as checked.
 */
export interface ChoicePayload extends ModePayload, ValidationPayload {
  /**
   * The author's `aria-label`, which names the group when there is no Prompt.
   */
  readonly ariaLabel: Option.Option<string>;
  /**
   * The ids of the author's `aria-labelledby` that an element of the item carries, unscoped
   * ({@link resolvedLabelledby}), which name the group when there is no Prompt; none when the
   * author wrote none or none of its ids is carried.
   */
  readonly ariaLabelledby: Option.Option<string>;
  readonly cardinality: "multiple" | "single";
  /**
   * The choices in presented order: for a Choice with `shuffle` true, the order the view's seed,
   * the instance and the response key, each fixed choice at its document position; else document
   * order.
   */
  readonly choices: readonly {
    readonly content: readonly PayloadNode[];
    readonly identifier: string;
  }[];
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  /**
   * The name its Controls post under: the view's name for the response, else
   * `entryName(instance, response)`.
   */
  readonly formName: string;
  readonly kind: "choice";
  readonly maxChoices: bigint;
  readonly minChoices: bigint;
  readonly orientation: Option.Option<string>;
  readonly prompt: Option.Option<readonly PayloadNode[]>;
  /**
   * The identifier of the response it binds.
   */
  readonly response: string;
  readonly restore: readonly string[];
}

/**
 * An Inline Choice as the page may know it (Q-12): its binding, its Label, its placeholder, its
 * choices in the order they are presented, how its Control is named and the identifier it restores.
 */
export interface InlineChoicePayload extends ModePayload, ValidationPayload {
  /**
   * The choices in presented order, as {@link ChoicePayload.choices} orders a Choice's.
   */
  readonly choices: readonly {
    readonly content: readonly PayloadNode[];
    readonly identifier: string;
  }[];
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  /**
   * The name its Control posts under: the view's name for the response, else
   * `entryName(instance, response)`.
   */
  readonly formName: string;
  readonly kind: "inline-choice";
  /**
   * The content of the first `qti-label`, none when the interaction has none.
   */
  readonly label: Option.Option<readonly PayloadNode[]>;
  /**
   * How the Control is named for assistive technology when no Label gives it a name, as a text
   * control's is.
   */
  readonly name: TextName;
  /**
   * The author's `data-prompt`, the text of the option that stands for no answer.
   */
  readonly placeholder: Option.Option<string>;
  /**
   * The identifier of the response it binds.
   */
  readonly response: string;
  /**
   * The identifier the Control shows as chosen: the string posted when the view has messages,
   * else the view's value; empty for NULL.
   */
  readonly restore: string;
}

/**
 * Where the first Control of a text control or an Inline Choice stands among the Controls the
 * renderer names (Q10): `n`, from 1, among the `count` of the item.
 */
export interface UnnamedPosition {
  readonly count: number;
  readonly n: number;
}

/**
 * How a text control or an Inline Choice is named.
 *
 * `ariaLabel` is the author's, as written. `ariaLabelledby` holds the ids of the author's that an
 * element of the item carries, unscoped ({@link resolvedLabelledby}), none when none is carried.
 * `unnamed` is set exactly when the renderer names the control's Controls: it has neither of them
 * nor a Prompt, nor, for an Inline Choice, a Label that gives text, a blank `ariaLabel` counting as
 * none, and it renders at least one Control. Every Control the renderer names counts once, in
 * document order across the item, which is the order the Controls are emitted in: a Text Entry's
 * and an Inline Choice's one Control and each Control of an Extended Text. `n` is the position of
 * the control's first Control, an Extended Text's others following at `n + 1` onwards, and `count`
 * is how many there are.
 */
export interface TextName {
  readonly ariaLabel: Option.Option<string>;
  readonly ariaLabelledby: Option.Option<string>;
  readonly unnamed: Option.Option<UnnamedPosition>;
}

/**
 * What a Text Entry and an Extended Text share: the binding, the integer `base`, the placeholder,
 * the entry name and the accessible name.
 */
export interface TextControlPayload extends ModePayload, ValidationPayload {
  readonly base: number;
  readonly baseType: "float" | "integer" | "string";
  /**
   * The author's `class` value, empty when absent.
   */
  readonly class: string;
  /**
   * The name its Control posts under: the view's name for the response, else
   * `entryName(instance, response)`.
   */
  readonly formName: string;
  /**
   * How the Control is named for assistive technology, not the entry name.
   */
  readonly name: TextName;
  /**
   * `placeholder-text`.
   */
  readonly placeholder: Option.Option<string>;
  /**
   * The identifier of the response it binds.
   */
  readonly response: string;
}

/**
 * A Text Entry as the page may know it (Q-20).
 */
export interface TextEntryPayload extends TextControlPayload {
  readonly expectedLength: Option.Option<bigint>;
  readonly kind: "text-entry";
  /**
   * The text the Control shows: the string posted when the view has messages, else the view's
   * value written in its lexical form, an integer in `base`; empty for NULL.
   */
  readonly restore: string;
}

/**
 * An Extended Text as the page may know it (Q-5): a text control with `expected-lines`, a
 * `format`, a Prompt, its binding's cardinality, and its `n` Controls with the text each restores,
 * or the notice that stands in their place.
 */
export interface ExtendedTextPayload extends TextControlPayload {
  readonly cardinality: ExtendedTextInteraction["cardinality"];
  readonly expectedLines: Option.Option<bigint>;
  readonly format: ExtendedTextInteraction["format"];
  readonly kind: "extended-text";
  /**
   * The number of Controls (Q9): 1 for a `single` or a `record` binding; for a container,
   * `max-strings` when it is from 1 to 10, else the greater of 10 and `min-strings`, so
   * `max-strings="0"` and an absent one give at least 10 (reading 53). It also covers every member
   * of the value or post it restores, up to a nonzero `max-strings`. At most 100 (Q23), and 0 when
   * `min-strings` exceeds 100.
   */
  readonly n: number;
  /**
   * The cap's notice, `min-strings>100` (Q23): in place of the Controls when `min-strings` exceeds
   * 100, `n` then 0, or beside the first 100 Controls when the value or post restored holds more
   * members than they do; none otherwise.
   */
  readonly notice: Option.Option<NoticePayload>;
  readonly prompt: Option.Option<readonly PayloadNode[]>;
  /**
   * The text each Control shows, one per Control in order: the strings posted when the view has
   * messages, else the view's values, each written as {@link TextEntryPayload.restore} writes one;
   * empty for a Control with none.
   */
  readonly restores: readonly string[];
}

/**
 * An interaction payload, which the emitter hands to its interaction's render function.
 */
export type InteractionPayload =
  | ChoicePayload
  | ExtendedTextPayload
  | InlineChoicePayload
  | TextEntryPayload;

/**
 * A node of the payload's body.
 */
export type PayloadNode = ElementPayload | InteractionPayload | NoticePayload | TextPayload;

/**
 * Everything the emitter may know about one render of an item.
 *
 * `lang` is the item's `xml:lang`, else the view's locale. `finished` is the view's: the author
 * disabled every control. `mode` is the view's, the state the Root's and each interaction Root's
 * `data-mode` name. `notices` names the unsupported features the body shows as notices.
 */
export interface Payload {
  readonly body: readonly PayloadNode[];
  readonly finished: boolean;
  /**
   * The item instance key, which scopes every id and entry name.
   */
  readonly instance: string;
  readonly lang: string;
  readonly messages: readonly MessagePayload[];
  readonly mode: RenderMode;
  readonly notices: readonly string[];
  readonly title: string;
}

/**
 * A response's binding as the page may know it, with no correct response, mapping or default: for
 * a response of a base type its identifier, base type and cardinality, and for a record response
 * its identifier and the cardinality `record`, since a record has no base type of its own.
 */
export type ResponseBinding =
  | {
      readonly baseType: ModelledBaseType;
      readonly cardinality: Value["cardinality"];
      readonly identifier: string;
    }
  | { readonly cardinality: "record"; readonly identifier: string };

/**
 * The fields of an item the page may know, which {@link redactItem} copies by name.
 *
 * `responses` lists the response bindings, every response but those only content the page does not
 * see binds ({@link hiddenOnlyResponses}): those of a base type in document order, then the record
 * responses in document order. `notices` lists the features the body shows as notices. Exported for
 * the codec of {@link Redacted}'s JSON form, whose Schema's type it is; `src/index.ts` does not
 * export it.
 */
export interface RedactedFields {
  readonly body: readonly BodyNode[];
  /**
   * The document's location as the host named it.
   */
  readonly document: string;
  readonly identifier: string;
  /**
   * The root's `xml:lang`.
   */
  readonly lang: Option.Option<string>;
  readonly notices: readonly string[];
  readonly responses: readonly ResponseBinding[];
  readonly title: string;
  /**
   * The first printed variable, or `param-variable` parameter, on content the page sees whose text
   * passed a bound and so printed nothing: the bound in characters, the variable's identifier (a
   * parameter's template variable), which limit the bound is, and its path. `limit` is `"text"`
   * with the bound 1,000,000, the most one text may hold, or `"budget"` with the output budget the
   * redaction ran under, when the item's printed text passed it at that variable. It names the
   * limit, not the cause, so it tells the two apart when the budget is 1,000,000 too. None when
   * every text fits. `render` fails `OutputTooLarge` naming it, so no page shows the slot blank.
   */
  readonly unprinted: Option.Option<{
    readonly bound: number;
    readonly identifier: string;
    readonly limit: "budget" | "text";
    readonly path: string;
  }>;
}

/**
 * An item with every part the page may not know removed: the only item {@link payload} takes.
 *
 * The brand is checked twice. In the type, a full {@link Item}, or any object built by hand, does
 * not type-check where a `Redacted` is expected. At run time, {@link isRedacted} is true only for
 * the very object a producer marked, which `render` asks first, since a copy (a spread, a JSON
 * round trip) or a cast type-checks. {@link redactItem} makes one from an item, and the codec's
 * `decodeRedacted` from its checked JSON form, each through {@link brandRedacted}; the value either
 * returns holds exactly the fields of {@link RedactedFields}.
 */
export type Redacted = Brand.Branded<RedactedFields, "Redacted">;

/**
 * The objects {@link brandRedacted} returned: the run-time half of the `Redacted` brand.
 *
 * A `WeakSet` rather than a field or a symbol on the item: it holds the mark outside the object, so
 * no copy, spread or JSON round trip carries it, the item's fields stay exactly
 * {@link RedactedFields} (the codec writes and the page reads no extra one), and a marked item a
 * host drops is still collected. It is module-private, so only {@link brandRedacted} adds to it.
 */
const marked = new WeakSet<object>();

/**
 * Brand redacted fields as a {@link Redacted}: a cast in the type, so that no run-time import of
 * effect's `Brand` reaches the browser (the OD-6 ruling, rule `e2bd87f2`), and a mark at run time,
 * which {@link isRedacted} reads.
 *
 * Only {@link redactItem}'s allowlisted copy and the codec's `decodeRedacted`, after its Schema has
 * checked every field, call it; `src/index.ts` does not export it. Any other caller would make a
 * `Redacted` the allowlist never saw.
 *
 * @param fields The fields the allowlist copied, or the codec checked.
 * @returns The same object, marked and typed as a `Redacted`.
 */
export const brandRedacted = (fields: RedactedFields): Redacted => {
  marked.add(fields);

  // SAFETY: `fields` comes from redactItem's allowlisted copy or decodeRedacted's checked decode, the only two callers, and is now marked; the brand is type-only, so the cast adds no run-time field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SAFETY note above: the brand exists only in the type, and these two callers are the allowlist's only ways in.
  return fields as Redacted;
};

/**
 * Whether a value is an object {@link brandRedacted} marked: one that `redactItem` or the codec's
 * `decodeRedacted` returned, not a copy of one, an object built by hand, or a cast.
 *
 * `render` asks it before it reads anything else of its item. It reads only the mark, never a
 * field, so it is true for the producer's object even after a caller mutates it (the item is
 * readonly in the type), and false for any copy, however exact. `src/index.ts` does not export it.
 *
 * @example
 *   isRedacted(redactItem(item)); // true
 *   isRedacted({ ...redactItem(item) }); // false
 *
 * @param value Anything.
 * @returns Whether `value` is a marked `Redacted`.
 */
export const isRedacted = (value: unknown): value is Redacted =>
  typeof value === "object" && value !== null && marked.has(value);

/**
 * What one payload build knows about the whole item while it copies one node.
 */
interface Build {
  /**
   * The interaction whose first Control takes `autofocus`, if any.
   */
  readonly autofocus: Option.Option<Interaction>;
  /**
   * Whether the view's mode lets the candidate change a response ({@link ModePayload}).
   */
  readonly editable: boolean;
  /**
   * The ids the author gave the item's elements, unscoped ({@link authoredIdsIn}).
   */
  readonly ids: ReadonlySet<string>;
  readonly instance: string;
  readonly messages: readonly MessagePayload[];
  readonly names: View["names"];
  /**
   * The posted strings to restore, set only when the view has messages.
   */
  readonly posted: Option.Option<ReadonlyMap<string, readonly string[]>>;
  /**
   * The view's seed, none when the view has none.
   */
  readonly seed: Option.Option<string>;
  /**
   * Each interaction the renderer names, with where its first Control stands among the Controls
   * the renderer names ({@link TextName}).
   */
  readonly unnamed: ReadonlyMap<Interaction, UnnamedPosition>;
  readonly values: View["values"];
}

/**
 * Collect the ids the author gave the elements of body nodes, in document order: the `id` of
 * every element, below elements, in Prompts and Labels and in a Choice's choice content, the places
 * the emitter writes as elements, so each one is an id an element of the rendered item carries. An
 * Inline Choice's choice content gives none: each of its choices is written as the one text of an
 * `option`, so an id inside one is never emitted.
 *
 * @param nodes The body nodes.
 * @returns The ids, unscoped.
 */
const authoredIdsIn = (nodes: readonly BodyNode[]): readonly string[] =>
  nodes.flatMap((node): readonly string[] => {
    switch (node.kind) {
      case "element": {
        return [
          ...node.attributes.flatMap(({ name, value }) => (name === "id" ? [value] : [])),
          ...authoredIdsIn(node.children),
        ];
      }
      case "choice": {
        return [
          ...authoredIdsIn(Option.getOrElse(node.prompt, () => [])),
          ...node.choices.flatMap((choice) => authoredIdsIn(choice.content)),
        ];
      }
      case "extended-text": {
        return authoredIdsIn(Option.getOrElse(node.prompt, () => []));
      }
      case "inline-choice": {
        return authoredIdsIn(Option.getOrElse(node.label, () => []));
      }
      case "template-block":
      case "template-inline": {
        return authoredIdsIn(node.content);
      }
      case "printed-variable":
      case "text-entry":
      case "text":
      case "unsupported": {
        return [];
      }
      default: {
        return node satisfies never;
      }
    }
  });

/**
 * Report whether the renderer names an interaction's Controls (Q10): a Text Entry with no authored
 * name, an Extended Text with no authored name and no Prompt, or an Inline Choice with no authored
 * name and no Label whose content gives text ({@link givesText}, the one Label check the emitter
 * also reads). A Choice never: its Controls are named by their choices. A blank `aria-label`
 * ({@link authorsLabel}) and an `aria-labelledby` none of whose ids an element of the item carries
 * ({@link resolvedLabelledby}) are no authored names.
 *
 * @param interaction The interaction.
 * @param ids The ids the author gave the item's elements.
 * @returns Whether the renderer must name it.
 */
const isUnnamed = (interaction: Interaction, ids: ReadonlySet<string>): boolean => {
  const unauthored =
    Option.isNone(authorsLabel(interaction)) && Option.isNone(resolvedLabelledby(interaction, ids));
  switch (interaction.kind) {
    case "choice": {
      return false;
    }
    case "text-entry": {
      return unauthored;
    }
    case "extended-text": {
      return unauthored && Option.isNone(interaction.prompt);
    }
    case "inline-choice": {
      return unauthored && !Option.exists(interaction.label, givesText);
    }
    default: {
      return interaction satisfies never;
    }
  }
};

/**
 * Give each validation message the id its Message part carries, so a Control's
 * `aria-describedby` and the Status part's Message agree.
 *
 * @param instance The item instance key.
 * @param messages The messages, in the order validation gave them.
 * @returns The messages with ids, `n` counting each response's messages from 0.
 */
export const identifyMessages = (
  instance: string,
  messages: readonly ValidationMessage[],
): readonly MessagePayload[] =>
  messages.map(({ response, text }, index) => ({
    id: scopedId(
      instance,
      response,
      "message",
      messages.slice(0, index).filter((earlier) => earlier.response === response).length,
    ),
    response,
    text,
  }));

/**
 * Give the values the view shows for a response.
 *
 * A record shows its `stringValue` field ({@link recordText}), the text it was typed as, in the
 * string control a text interaction binds to it, so the text the candidate typed comes back as
 * typed. A record without that field, such as the NULL record or a correct response that declares
 * none, leaves the control empty. Restored text counts toward the output budget as any other.
 *
 * @param build The build.
 * @param response The response identifier.
 * @returns Its values, a record's `stringValue` alone; none when it is NULL, a record without a
 *   `stringValue`, or the view gives none.
 */
const shown = (build: Pick<Build, "values">, response: string): readonly Single[] => {
  const value = build.values.get(response);
  if (value === undefined) {
    return [];
  }

  return isRecordValue(value) ? recordText(value) : value.values;
};

/**
 * Give the name a response's controls post under.
 *
 * @param build The build.
 * @param response The response identifier.
 * @returns The view's name for it, else `entryName(instance, response)`.
 */
const formNameOf = (build: Build, response: string): string =>
  build.names.get(response) ?? entryName(build.instance, response);

/**
 * Write a value as the text a text control shows.
 *
 * An integer is written in the control's `base`, the base its posted text is read in, so a
 * restored value posts back unchanged. A base outside 2 to 36, which no posted text can be read in,
 * writes base 10.
 *
 * @param single The value.
 * @param base The control's number base.
 * @returns The value's text.
 */
const writeIn = (single: Single, base: number): string =>
  single.baseType === "integer" && Number.isInteger(base) && base >= 2 && base <= 36
    ? single.value.toString(base)
    : format(single);

/**
 * Copy what an interaction's response validation says into its payload fields.
 *
 * @param interaction The interaction.
 * @param build The build.
 * @returns Its message ids, whether it is invalid, and whether it takes `autofocus`.
 */
const validationOf = (interaction: Interaction, build: Build): ValidationPayload => {
  const messageIds = build.messages.flatMap((entry) =>
    entry.response === interaction.response ? [entry.id] : [],
  );

  return {
    autofocus: Option.exists(build.autofocus, (first) => first === interaction),
    invalid: messageIds.length > 0,
    messageIds,
  };
};

/**
 * Copy body nodes into payload nodes, in order.
 *
 * @param nodes The body nodes.
 * @param build The build.
 * @returns The payload nodes.
 */
const copyNodes = (nodes: readonly BodyNode[], build: Build): readonly PayloadNode[] =>
  // oxlint-disable-next-line eslint/no-use-before-define -- `copyNodes` and `copyNode` are mutually recursive, as elements, Prompts, Labels and choices nest; the call runs only after both are defined.
  nodes.map((node) => copyNode(node, build));

/**
 * The separator of a shuffle key's three fields, U+001F INFORMATION SEPARATOR ONE, which no
 * checked instance token or identifier holds. A seed is the host's string and may hold it, but the
 * fields after it never do, so a key still splits from the right.
 */
const keySeparator = "\u001F";

/**
 * Give the identifiers of a Choice's or an Inline Choice's choices in the order a render presents
 * them: the one function that presents both kinds and reports their order.
 *
 * An interaction with `shuffle` true is presented in {@link shuffleOrder}'s order under the key
 * `<seed>\u001F<instance>\u001F<response>`, where the seed is written as given and an absent seed
 * is the empty string: its non-fixed choices are permuted among the non-fixed positions, and each
 * fixed choice keeps its document position. Any other keeps document order. The same interaction,
 * seed and instance always give the same order, the one `render` presents, so a host can report
 * it, such as a result's `choiceSequence`. The order is presentation only: scores, records and
 * validation read identifiers, never positions.
 *
 * @example
 *   // A shuffled Choice of choices A, B and C, none fixed, bound to RESPONSE:
 *   choiceOrder(interaction, Option.some("7"), "_r_1_"); // ["B", "A", "C"]
 *   choiceOrder(interaction, Option.none(), "_r_1_"); // ["A", "C", "B"]
 *
 * @param interaction The Choice or Inline Choice: its choices, its response and its `shuffle`.
 * @param seed The configuration's `seed`, none when it has none.
 * @param instance The item instance key the interaction is rendered under.
 * @returns The choice identifiers, in presented order.
 */
export const choiceOrder = (
  interaction: Pick<ChoiceInteraction, "choices" | "response" | "shuffle">,
  seed: Option.Option<string>,
  instance: string,
): readonly string[] =>
  interaction.shuffle
    ? shuffleOrder(
        [Option.getOrElse(seed, () => ""), instance, interaction.response].join(keySeparator),
        interaction.choices.map((choice) => choice.fixed),
      ).flatMap((index) => interaction.choices[index]?.identifier ?? [])
    : interaction.choices.map((choice) => choice.identifier);

/**
 * Give a Choice's or an Inline Choice's choices in the order they are presented,
 * {@link choiceOrder}'s, so the payload presents the order `choiceOrder` reports.
 *
 * A checked interaction's choice identifiers are unique (`duplicate-identifier`, info.txt:42411),
 * so each identifier names exactly one choice.
 *
 * @param interaction The Choice or Inline Choice: its choices, its response and its `shuffle`.
 * @param build The build, which gives the seed and the instance.
 * @returns The choices, in presented order.
 */
const presentedChoices = (
  interaction: Pick<ChoiceInteraction, "choices" | "response" | "shuffle">,
  build: Build,
): readonly SimpleChoice[] => {
  const byIdentifier = new Map(interaction.choices.map((choice) => [choice.identifier, choice]));

  return choiceOrder(interaction, build.seed, build.instance).flatMap(
    (identifier) => byIdentifier.get(identifier) ?? [],
  );
};

/**
 * Copy a Choice into its payload.
 *
 * @param interaction The Choice.
 * @param build The build.
 * @returns Its payload; `restore` holds the posted identifiers when the view has messages, else
 *   the view's value.
 */
const choicePayload = (interaction: ChoiceInteraction, build: Build): ChoicePayload => ({
  ...validationOf(interaction, build),
  ariaLabel: interaction.ariaLabel,
  ariaLabelledby: resolvedLabelledby(interaction, build.ids),
  cardinality: interaction.cardinality,
  choices: presentedChoices(interaction, build).map((choice) => ({
    content: copyNodes(choice.content, build),
    identifier: choice.identifier,
  })),
  class: interaction.class,
  editable: build.editable,
  formName: formNameOf(build, interaction.response),
  kind: "choice",
  maxChoices: interaction.maxChoices,
  minChoices: interaction.minChoices,
  orientation: interaction.orientation,
  prompt: interaction.prompt.pipe(Option.map((prompt) => copyNodes(prompt, build))),
  response: interaction.response,
  restore: Option.match(build.posted, {
    onNone: () => shown(build, interaction.response).map(format),
    onSome: (posted) => posted.get(interaction.response) ?? [],
  }),
});

/**
 * Give how a text control or an Inline Choice is named: the author's `aria-label` as written, the
 * ids of the author's `aria-labelledby` an element carries, and where the renderer numbers it.
 *
 * @param interaction The interaction.
 * @param build The build.
 * @returns Its name.
 */
const textNameOf = (
  interaction: ExtendedTextInteraction | InlineChoiceInteraction | TextEntryInteraction,
  build: Build,
): TextName => ({
  ariaLabel: interaction.ariaLabel,
  ariaLabelledby: resolvedLabelledby(interaction, build.ids),
  unnamed: Option.fromNullishOr(build.unnamed.get(interaction)),
});

/**
 * Copy the fields a Text Entry and an Extended Text share into their payload.
 *
 * @param interaction The text control.
 * @param build The build.
 * @returns The shared fields.
 */
const textControlPayload = (
  interaction: ExtendedTextInteraction | TextEntryInteraction,
  build: Build,
): TextControlPayload => ({
  ...validationOf(interaction, build),
  base: interaction.base,
  baseType: interaction.baseType,
  class: interaction.class,
  editable: build.editable,
  formName: formNameOf(build, interaction.response),
  name: textNameOf(interaction, build),
  placeholder: interaction.placeholder,
  response: interaction.response,
});

/**
 * Copy a Text Entry into its payload.
 *
 * @param interaction The Text Entry.
 * @param build The build.
 * @returns Its payload; `restore` holds the posted string when the view has messages, else the
 *   view's value in its lexical form.
 */
const textEntryPayload = (interaction: TextEntryInteraction, build: Build): TextEntryPayload => ({
  ...textControlPayload(interaction, build),
  expectedLength: interaction.expectedLength,
  kind: "text-entry",
  restore: Option.match(build.posted, {
    onNone: () =>
      Option.match(Arr.head(shown(build, interaction.response)), {
        onNone: () => "",
        onSome: (single) => writeIn(single, interaction.base),
      }),
    onSome: (posted) => posted.get(interaction.response)?.[0] ?? "",
  }),
});

/**
 * Copy an Inline Choice into its payload (Q-12).
 *
 * @param interaction The Inline Choice.
 * @param build The build.
 * @returns Its payload: its choices in presented order, its Label, and `restore`, the string posted
 *   when the view has messages, else the view's identifier, else empty.
 */
const inlineChoicePayload = (
  interaction: InlineChoiceInteraction,
  build: Build,
): InlineChoicePayload => ({
  ...validationOf(interaction, build),
  choices: presentedChoices(interaction, build).map((choice) => ({
    content: copyNodes(choice.content, build),
    identifier: choice.identifier,
  })),
  class: interaction.class,
  editable: build.editable,
  formName: formNameOf(build, interaction.response),
  kind: "inline-choice",
  label: interaction.label.pipe(Option.map((label) => copyNodes(label, build))),
  name: textNameOf(interaction, build),
  placeholder: interaction.placeholder,
  response: interaction.response,
  restore: Option.match(build.posted, {
    onNone: () =>
      Option.match(Arr.head(shown(build, interaction.response)), {
        onNone: () => "",
        onSome: format,
      }),
    onSome: (posted) => posted.get(interaction.response)?.[0] ?? "",
  }),
});

/**
 * The number of Controls a container renders when `max-strings` does not fix it (Q9).
 */
const defaultControls = 10n;

/**
 * Give the larger of two counts.
 *
 * @param left One count.
 * @param right The other.
 * @returns The larger.
 */
const larger = (left: bigint, right: bigint): bigint => (left > right ? left : right);

/**
 * Give the smaller of two counts.
 *
 * @param left One count.
 * @param right The other.
 * @returns The smaller.
 */
const smaller = (left: bigint, right: bigint): bigint => (left < right ? left : right);

/**
 * How many Controls an Extended Text renders, and whether the cap's notice shows.
 */
interface Controls {
  readonly n: number;
  /**
   * Whether the cap (Q23) holds back what the item or its value asks for: `min-strings` above
   * 100, or a value with more members than 100 Controls hold.
   */
  readonly overCap: boolean;
}

/**
 * Count the Controls an Extended Text renders.
 *
 * A `single` binding and a record one have one Control, the string control a record's text is
 * typed in. Q9 gives a container `max-strings` Controls when it is from 1 to 10, else the greater
 * of 10 and `min-strings`; `max-strings="0"` restricts nothing (reading 53). So restoring drops no
 * answer silently, `n` also covers each member the restored or posted value holds, up to
 * `max-strings` when it restricts and up to the cap of 100 (Q23). Over the cap, the first 100 show
 * beside the cap's notice; a `min-strings` above 100 leaves no Control, the notice in their place,
 * for any binding.
 *
 * @param interaction The Extended Text.
 * @param members How many members the value or post to restore holds.
 * @returns The count, from 0 to 100, and whether the cap's notice shows.
 */
const controlsOf = (interaction: ExtendedTextInteraction, members: number): Controls => {
  if (exceedsControlCap(interaction.minStrings)) {
    return { n: 0, overCap: true };
  }

  if (interaction.cardinality === "single" || interaction.cardinality === "record") {
    return { n: 1, overCap: false };
  }

  const limit = interaction.maxStrings.pipe(Option.filter((maxStrings) => maxStrings > 0n));
  const asked = Option.getOrElse(
    limit.pipe(Option.filter((maxStrings) => maxStrings <= defaultControls)),
    () => larger(defaultControls, interaction.minStrings),
  );
  const held = Option.match(limit, {
    onNone: () => BigInt(members),
    onSome: (maxStrings) => smaller(BigInt(members), maxStrings),
  });
  const cap = controlCap.when.limit;

  return { n: Number(larger(asked, smaller(held, cap))), overCap: held > cap };
};

/**
 * Give the texts an Extended Text's Controls restore: the strings posted when the view has
 * messages, else the view's values, each written in the control's `base`.
 *
 * @param interaction The Extended Text.
 * @param build The build, which gives the posted strings and the values.
 * @returns The texts, in order; none for NULL or an empty post.
 */
const entriesOf = (
  interaction: ExtendedTextInteraction,
  build: Pick<Build, "posted" | "values">,
): readonly string[] =>
  Option.match(build.posted, {
    onNone: () =>
      shown(build, interaction.response).map((single) => writeIn(single, interaction.base)),
    onSome: (posted) => posted.get(interaction.response) ?? [],
  });

/**
 * Copy an Extended Text into its payload.
 *
 * @param interaction The Extended Text.
 * @param build The build.
 * @returns Its payload: `n` Controls, each restoring the posted string or value at its place, and
 *   the cap's notice when the cap holds back what the item or its value asks for.
 */
const extendedTextPayload = (
  interaction: ExtendedTextInteraction,
  build: Build,
): ExtendedTextPayload => {
  const entries = entriesOf(interaction, build);
  const { n, overCap } = controlsOf(interaction, entries.length);

  return {
    ...textControlPayload(interaction, build),
    cardinality: interaction.cardinality,
    expectedLines: interaction.expectedLines,
    format: interaction.format,
    kind: "extended-text",
    n,
    notice: overCap ? Option.some({ feature: controlCap.feature, kind: "notice" }) : Option.none(),
    prompt: interaction.prompt.pipe(Option.map((prompt) => copyNodes(prompt, build))),
    restores: Array.from({ length: n }, (_, index) => entries[index] ?? ""),
  };
};

/**
 * Count the Controls an interaction renders: an Extended Text's `n`, and one for each other kind.
 *
 * @param interaction The interaction.
 * @param build The build's posted strings and values, which give an Extended Text its Controls.
 * @returns How many Controls it renders.
 */
const controlCount = (
  interaction: Interaction,
  build: Pick<Build, "posted" | "values">,
): number => {
  switch (interaction.kind) {
    case "extended-text": {
      return controlsOf(interaction, entriesOf(interaction, build).length).n;
    }
    case "choice":
    case "inline-choice":
    case "text-entry": {
      return 1;
    }
    default: {
      return interaction satisfies never;
    }
  }
};

/**
 * Number the Controls the renderer names (Q10), in document order across the item: a Text Entry's
 * and an Inline Choice's one Control and each Control of an Extended Text, for each interaction
 * {@link isUnnamed} says the renderer names. An Extended Text that renders no Control, over the
 * cap, takes no position.
 *
 * @param interactions The item's interactions, in document order.
 * @param build The build's ids, which say whether an `aria-labelledby` names an element, and its
 *   posted strings and values, which give an Extended Text its Controls.
 * @returns Each interaction the renderer names, with where its first Control stands.
 */
const unnamedPositions = (
  interactions: readonly Interaction[],
  build: Pick<Build, "ids" | "posted" | "values">,
): ReadonlyMap<Interaction, UnnamedPosition> => {
  const firsts: (readonly [Interaction, number])[] = [];
  let next = 1;
  for (const interaction of interactions.filter((each) => isUnnamed(each, build.ids))) {
    const controls = controlCount(interaction, build);
    if (controls > 0) {
      firsts.push([interaction, next]);
      next += controls;
    }
  }

  return new Map(firsts.map(([interaction, n]) => [interaction, { count: next - 1, n }]));
};

/**
 * The feature a printed variable's notice names: its element's name, as for any `qti-*` element
 * the body shows as a notice.
 */
const printedNotice = "qti-printed-variable";

/**
 * The feature a template block's or inline's notice names: its element's name, as for a printed
 * variable.
 */
const templateNotice: Readonly<Record<TemplateContent["kind"], string>> = {
  "template-block": "qti-template-block",
  "template-inline": "qti-template-inline",
};

/**
 * The feature the notices name, once, when a choice is withheld: the attribute that gives a choice
 * its template visibility, as `string-identifier` names a text interaction's mark. A withheld
 * choice has no place of its own to show a notice in.
 */
const choiceNotice = "template-identifier";

/**
 * The feature a withheld `param`'s notice names: its element's name, as for a printed variable.
 */
const parameterNotice = "param";

/**
 * What a walk of {@link printBody} writes in place of a printed variable and of a `param-variable`
 * parameter the values cover: `"text"` writes the text each prints or passes, through
 * `formatPrinted`, as {@link redactItem} gives the page, at most `budget` characters of it in all;
 * `"structure"` writes none, for the callers that read only which parts the page shows
 * ({@link redactStructure}). Either decides every visibility, binding and notice the same way.
 * Content the page does not see is walked as `"structure"` under either, so it formats nothing and
 * spends none of the budget.
 */
type Writing = { readonly budget: number; readonly kind: "text" } | { readonly kind: "structure" };

/**
 * The walk that writes no text.
 */
const structureOnly: Writing = { kind: "structure" };

/**
 * The text of one printed variable or `param-variable` parameter, not yet formatted: given the most
 * characters it may hold, `formatPrinted`'s text, none when it would pass that or {@link textBound}.
 */
type Printer = (bound: number) => Option.Option<string>;

/**
 * Copy one body node into its payload node.
 *
 * A printed variable becomes its notice. {@link redactItem} leaves none in a redacted body, so the
 * case is reached only by a body built by hand, which is given the notice the variable stands for.
 * A template block or inline becomes its notice too ({@link templateNotice}): `redactItem` leaves
 * none either, and the payload holds no template value to show a hand-built one's content by.
 *
 * @param node The body node.
 * @param build The build.
 * @returns The payload node: an unsupported part, a printed variable, or a template block or
 *   inline becomes its notice.
 */
const copyNode = (node: BodyNode, build: Build): PayloadNode => {
  switch (node.kind) {
    case "element": {
      return {
        attributes: node.attributes.map(({ name, value }) => ({ name, value })),
        children: copyNodes(node.children, build),
        kind: "element",
        tag: node.tag,
      };
    }
    case "text": {
      return { kind: "text", text: node.text };
    }
    case "unsupported": {
      return { feature: node.feature, kind: "notice" };
    }
    case "printed-variable": {
      return { feature: printedNotice, kind: "notice" };
    }
    case "template-block":
    case "template-inline": {
      return { feature: templateNotice[node.kind], kind: "notice" };
    }
    case "choice": {
      return choicePayload(node, build);
    }
    case "text-entry": {
      return textEntryPayload(node, build);
    }
    case "extended-text": {
      return extendedTextPayload(node, build);
    }
    case "inline-choice": {
      return inlineChoicePayload(node, build);
    }
    default: {
      return node satisfies never;
    }
  }
};

/**
 * A redacted body, the features it shows as notices, and the responses only content the page does
 * not see binds.
 */
interface RedactedBody {
  readonly body: readonly BodyNode[];
  /**
   * The responses some interaction binds that no interaction of `body` binds, in the order the
   * walk first meets them: {@link hiddenOnlyResponses}' set.
   */
  readonly hiddenOnly: ReadonlySet<string>;
  readonly notices: readonly string[];
  /**
   * The first printed variable or `param-variable` parameter on content the page sees whose text
   * passed its bound: {@link RedactedFields.unprinted}. Always none under `"structure"`.
   */
  readonly unprinted: RedactedFields["unprinted"];
}

/**
 * One step of {@link printBody}'s walk that bears on the notices: a notice the walk puts in a
 * withheld part's place on content the page sees (`made`), or the walk reaching the node a listed
 * notice stands for (`reached`, the notice's index among the item's listed notices).
 */
type NoticeStep =
  | { readonly feature: string; readonly kind: "made" }
  | { readonly index: number; readonly kind: "reached" };

/**
 * Decide whether a path sits at or below one of the paths given: whether it equals one, or starts
 * with one and a `/`. It looks up each of the path's own prefixes that ends before a `/`, so the
 * cost follows the path's length, not the number of paths given.
 *
 * @param path The path.
 * @param above The paths.
 * @returns Whether `path` is one of `above` or lies inside one.
 */
const beneath = (path: string, above: ReadonlySet<string>): boolean => {
  if (above.has(path)) {
    return true;
  }

  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
    if (above.has(path.slice(0, slash))) {
      return true;
    }
  }

  return false;
};

/**
 * Give the value a record holds for a variable: its template value, else its outcome value (an
 * item's identifiers are unique across both), read from the record's own keys only.
 *
 * @param record The record.
 * @param identifier The variable's identifier.
 * @returns The value, or none when the record holds no value by that name.
 */
const heldValue = (record: RedactRecord, identifier: string): Option.Option<Value> =>
  Option.orElse(own(record.templates, identifier), () => own(record.outcomes, identifier));

/**
 * Resolve a printed variable's `base` or `index`: a literal as written, or the integer the record
 * holds for the variable it names.
 *
 * @param written The attribute's value.
 * @param record The record.
 * @returns Some integer; some none when the named variable is NULL or not a single integer, which
 *   the validator refuses (`printed-variable-ref`) on a checked item, so the formatter's default
 *   applies; none when the record holds no value by that name.
 */
const resolvedInteger = (
  written: IntegerOrRef,
  record: RedactRecord,
): Option.Option<Option.Option<bigint>> =>
  written._tag === "literal"
    ? Option.some(Option.some(written.value))
    : Option.map(heldValue(record, written.identifier), integerOf);

/**
 * Give a printed variable's attributes as the formatter takes them, its `base` and `index` read
 * from the record where written as names.
 *
 * @param node The printed variable.
 * @param record The record.
 * @returns The options, or none when the record holds no value of a name `base` or `index` names.
 */
const printOptionsOf = (node: PrintedVariable, record: RedactRecord): Option.Option<PrintOptions> =>
  Option.map(
    Option.all([
      resolvedInteger(node.base, record),
      Option.match(node.index, {
        onNone: () => Option.some(Option.none<bigint>()),
        onSome: (index) => resolvedInteger(index, record),
      }),
    ]),
    ([base, index]): PrintOptions => ({
      ...Option.match(base, { onNone: () => ({}), onSome: (radix) => ({ base: radix }) }),
      delimiter: node.delimiter,
      ...Option.match(node.format, { onNone: () => ({}), onSome: (code) => ({ format: code }) }),
      ...Option.match(index, { onNone: () => ({}), onSome: (member) => ({ index: member }) }),
      mappingIndicator: node.mappingIndicator,
      powerForm: node.powerForm,
    }),
  );

/**
 * Give the text a printed variable prints from a record, unformatted: `formatPrinted` over the
 * value of the variable it names, through its attributes. The formatter runs only when the walk
 * calls the printer, which it does only where it writes text.
 *
 * @param node The printed variable.
 * @param record The record.
 * @returns The printer, whose text is empty for NULL; or none when the record holds no value of
 *   the variable, or of a name its `base` or `index` names.
 */
const printedText = (node: PrintedVariable, record: RedactRecord): Option.Option<Printer> =>
  Option.flatMap(heldValue(record, node.identifier), (value) =>
    Option.map(
      printOptionsOf(node, record),
      (options): Printer =>
        (bound) =>
          formatPrinted(value, options, bound),
    ),
  );

/**
 * Give the values a redaction prints from: the record given; or, with none, for an item whose
 * template processing does not run, the values its first attempt starts with (H3): each template
 * variable at its declared default, else NULL, and none where the item has a template processing
 * the engine does not run; and each outcome at its starting value ({@link outcomeDefaults}). An
 * item whose template processing runs has no such values without its record.
 *
 * @param item The item.
 * @param record The record, if any.
 * @returns The values, or none for an item whose template processing runs and no record.
 */
const printingOf = (item: Item, record?: RedactRecord): Option.Option<RedactRecord> => {
  if (record !== undefined) {
    return Option.some(record);
  }

  if (Option.isSome(item.templateProcessing)) {
    return Option.none();
  }

  const templates: RedactRecord["templates"] = unrunTemplateProcessing(item)
    ? {}
    : Object.fromEntries(
        Array.from(item.templates, ([identifier, declaration]) => [
          identifier,
          Option.getOrElse(declaration.defaultValue, () =>
            nullOf(declaration.baseType, declaration.cardinality),
          ),
        ]),
      );

  return Option.some({ outcomes: outcomeDefaults(item), templates });
};

/**
 * Decide whether a template value shows a choice, a template block or a template inline: `show`
 * shows it when the template variable matches, or contains, its identifier, and `hide` shows it
 * unless the variable does (the information model's TemplateBlock, `info.txt:44963`, and
 * SimpleChoice's `template-identifier`, `info.txt:42441-42494`). A NULL value, a value of another
 * base type, and a variable the values do not hold, match nothing.
 *
 * It is the one visibility function: `redactItem` shows the body by it, and a host's report of the
 * choices shown reads the same answer.
 *
 * @example
 *   // A choice with template-identifier="SHOWN" and show-hide="show", identifier A:
 *   templateShows({ showHide: "show", templateIdentifier: "SHOWN" }, "A", record.templates);
 *   // true when SHOWN holds A, or is a multiple value with A among its members
 *
 * @param visibility The part's `template-identifier` and `show-hide`.
 * @param identifier The part's `identifier`.
 * @param templates The template values, such as a record's `templates`.
 * @returns Whether the part is shown.
 */
export const templateShows = (
  visibility: TemplateVisibility,
  identifier: string,
  templates: RedactRecord["templates"],
): boolean => {
  const matches = Option.exists(own(templates, visibility.templateIdentifier), (value) =>
    value.values.some((single) => single.baseType === "identifier" && single.value === identifier),
  );

  return visibility.showHide === "show" ? matches : !matches;
};

/**
 * Decide what the page sees of a part with a template visibility: whether the values show it, or
 * none when they cannot say, because there are no values or they hold no value of its template
 * variable, so the part is withheld.
 *
 * @param printing The values the redaction reads, none when it has none.
 * @param visibility The part's `template-identifier` and `show-hide`.
 * @param identifier The part's `identifier`.
 * @returns Some whether the part is shown, or none when it is withheld.
 */
const shownBy = (
  printing: Option.Option<RedactRecord>,
  visibility: TemplateVisibility,
  identifier: string,
): Option.Option<boolean> =>
  printing.pipe(
    Option.flatMap((record) =>
      Option.map(own(record.templates, visibility.templateIdentifier), () =>
        templateShows(visibility, identifier, record.templates),
      ),
    ),
  );

/**
 * Give the template variable a body element stands in for as a parameter: the declaration a
 * `param`'s `value` names, when it is declared `param-variable="true"` (the information model's
 * Param `value`, `info.txt:69978`, and TemplateDeclaration's `param-variable`, `info.txt:45899`).
 *
 * @param item The item, whose template declarations the `value` is looked up among.
 * @param node The body element.
 * @returns The declaration; none for an element other than `param`, and for a `param` whose
 *   `value` names no template variable or one not declared `param-variable`.
 */
const parameterOf = (item: Item, node: BodyElement): Option.Option<TemplateDeclaration> =>
  node.tag === "param"
    ? Arr.findFirst(node.attributes, (attribute) => attribute.name === "value").pipe(
        Option.flatMap(({ value }) => Option.fromUndefinedOr(item.templates.get(value))),
        Option.filter((declaration) => declaration.paramVariable),
      )
    : Option.none();

/**
 * Write a template value as the `value` a parameter passes, converted as the information model's
 * Param `value` says (`info.txt:69978`): an integer by `%i` and a float by `%G`, both through
 * `formatPrinted`; a boolean as `true` or `false`; a point as its two coordinates, horizontal
 * first, and a pair or a directed pair as its two identifiers, each two separated by one space; an
 * identifier, a string and a URI as they are. A `file` value cannot be expanded, and the value
 * model holds none. The standard gives no form for a container or for NULL, so they take the
 * printed variable's default (G-R2, pending): a container's members joined by `;`, and NULL as the
 * empty string.
 *
 * @param value The template variable's value.
 * @param bound The most characters the text may hold, as `formatPrinted` takes it.
 * @returns The text the parameter passes, or none when it would pass `bound` or `formatPrinted`'s
 *   bound ({@link textBound}), so it is not passed.
 */
const parameterText = (value: Value, bound: number): Option.Option<string> =>
  formatPrinted(value, { format: value.baseType === "float" ? "%G" : "%i" }, bound);

/**
 * A `param-variable` parameter the values expand: the template variable it names, and the value
 * the values hold for it, whose text ({@link parameterText}) the parameter passes.
 */
interface Expanded {
  readonly identifier: string;
  readonly value: Value;
}

/**
 * Decide what the page sees of a body element's `value` as a parameter: the value the values hold
 * for the `param-variable` template variable it names ({@link parameterOf}), whose text the walk
 * writes ({@link parameterText}), or none when they cannot give it, because there are no values or
 * they hold no value of that variable, so the `param` is withheld. It formats nothing: when the
 * walk writes no text, a parameter the values expand keeps its `value` as written, the variable's
 * name, and the formatter never runs.
 *
 * @param item The item.
 * @param printing The values the redaction reads, none when it has none.
 * @param node The body element.
 * @returns None for an element that stands in for no template variable, which is copied as written;
 *   some {@link Expanded} for a parameter the values expand; some none for one they withhold.
 */
const expandedParameter = (
  item: Item,
  printing: Option.Option<RedactRecord>,
  node: BodyElement,
): Option.Option<Option.Option<Expanded>> =>
  Option.map(parameterOf(item, node), (declaration) =>
    printing.pipe(
      Option.flatMap((record) => own(record.templates, declaration.identifier)),
      Option.map((value): Expanded => ({ identifier: declaration.identifier, value })),
    ),
  );

/**
 * Show an item's body from the values given, and list the features it shows as notices: the
 * item's notice-shown features in their order, with each notice the walk puts in a withheld part's
 * place where the item would list it were the notice one of its unsupported features.
 *
 * A printed variable whose value, and whose `base`'s and `index`'s where they name variables, the
 * values hold becomes a text node of what it prints, or nothing when that is empty (a NULL value).
 * One the values do not cover, and every one when there are no values, is withheld behind its
 * notice, `qti-printed-variable` at the variable's path.
 *
 * A template block or inline the values show ({@link templateShows}) leaves its content in its
 * place, and one they hide leaves nothing. One whose template variable the values do not hold, and
 * every one when there are no values, is withheld behind its notice, `qti-template-block` or
 * `qti-template-inline` at its path. A choice the values show keeps its identifier, its content
 * and `fixed`, and no template visibility; one they hide is absent from its interaction. One whose
 * template variable they do not hold, and every choice with a template visibility when there are
 * no values, is absent too, and the notices name `template-identifier` once for them all, where the
 * walk meets the first.
 *
 * A `param` whose `value` names a `param-variable` template variable the values hold passes that
 * value, written as {@link parameterText} writes it, in place of the name; its other attributes
 * stay as written. One whose variable the values do not hold, and every one when there are no
 * values, is withheld behind its notice, `param` at its path. A `param` naming anything else keeps
 * its `value` as written.
 *
 * The item lists its notices in the order of the elements they sit at: in document order once
 * `check` has accepted it, and in the order the model read the body when the item was built by
 * hand. Whether a listed notice is named follows from where it sits, never from when the walk meets
 * it: one whose path is at or below the path of content the page does not see (a template block or
 * inline the values hide or withhold, or a `param` withheld behind its notice), or that stands for
 * a node inside such content or inside a choice the values hide or leave out, is never named, since
 * the page shows none of it; every other is named once. A path is at or below another when it
 * equals it or starts with it and a `/`.
 *
 * The walk goes through the body, content the page does not see included, and reaches each listed
 * notice at the node it stands for: a notice node by its feature and path, and an element or an
 * interaction, on entering it, the notices listed at its own path that no node it holds stands for,
 * as `check` lists them (the notices of URLs dropped from it, and an Extended Text's notice in
 * place of its Controls). The named notices keep the item's order: reaching a notice names it after
 * every listed notice before it that the walk reaches later, so where the walk meets a part before
 * one the item lists first, as it meets a Choice's prompt written after its choices, both are named
 * in the item's order. A notice the walk puts in a part's place goes down where the walk stands. A
 * listed notice no node stands for is named after the rest, in the item's order.
 *
 * The same walk tells which responses only content the page does not see binds. A rendered
 * interaction binds its response on content the page sees or on content it does not; a template
 * block or inline whose content the page does not see (hidden, withheld, or inside content it does
 * not see) binds, on content it does not see, every response its source content binds, a notice's
 * interaction included ({@link TemplateContent.responses}). A response bound on content the page
 * does not see and by no interaction it sees is hidden-only. A notice's interaction on content the
 * page sees binds nothing here, so a response only such notices bind, like one no interaction
 * binds, is never hidden-only.
 *
 * Under `"text"`, a printed variable or a `param-variable` parameter on content the page sees whose
 * text passed `formatPrinted`'s bound ({@link textBound}) leaves its slot empty, as NULL's does:
 * the printed variable writes nothing and the parameter passes the empty value. The walk records
 * the first such one it meets, a printed variable by its identifier and a parameter by its template
 * variable's, with the bound, the limit `"text"` and its path, so `render` fails rather than show
 * the blank. Content the page does not see is walked as under `"structure"`, so it formats nothing
 * and records nothing.
 *
 * Under `"text"` the walk also counts, in walk order, the characters each printed variable and
 * `param-variable` parameter on content the page sees writes, against the budget, and gives the
 * formatter what remains as its bound, so it stops building a text as soon as it would pass it. The
 * first text that would pass what remains, when less than {@link textBound} remains, leaves its
 * slot empty and is recorded as above with the budget as its bound and the limit `"budget"`; from
 * there the walk formats nothing more and records nothing more, every later printed variable
 * writing nothing and every later parameter passing the empty value. A text past {@link textBound}
 * with at least that much budget left is recorded with {@link textBound}, spends nothing, and the
 * walk goes on. So the walk builds at most the budget's characters of printed text, and one member
 * more.
 *
 * Under `"structure"` the walk writes no text: a printed variable the values cover leaves nothing
 * in its place, and a `param-variable` parameter they expand keeps its `value` as written. Every
 * other decision, the notices, the hidden-only responses and every interaction and choice shown, is
 * the same as under `"text"`, since none of them reads a printed text.
 *
 * @param item The item.
 * @param printing The values the body is shown by, none to withhold every printed variable, every
 *   template block and inline, every choice with a template visibility and every `param-variable`
 *   parameter.
 * @param writing Whether the walk writes each printed variable's and parameter's text (`"text"`),
 *   within its budget, or none (`"structure"`).
 * @returns The body, every printed variable its text (nothing under `"structure"`) or its notice,
 *   every template block and inline its content, nothing or its notice, and every `param-variable`
 *   parameter its value (as written under `"structure"`) or its notice; the features shown as
 *   notices; the responses only content the page does not see binds; and the first text on content
 *   the page sees that passed its bound, none under `"structure"`.
 */
const printBody = (
  item: Item,
  printing: Option.Option<RedactRecord>,
  writing: Writing,
): RedactedBody => {
  const listed = item.unsupported.filter((entry) => entry.shown === "notice");
  const listedAt = new Map<string, number[]>();
  for (const [index, entry] of listed.entries()) {
    const indices = listedAt.get(entry.path);
    if (indices === undefined) {
      listedAt.set(entry.path, [index]);
    } else {
      indices.push(index);
    }
  }

  // Whether the page sees where each reached listed notice sits, by its index; the paths of the
  // content it does not see; the walk's steps, in order; and whether the one notice for withheld
  // choices is down.
  const seenAt = new Map<number, boolean>();
  const unseen = new Set<string>();
  const steps: NoticeStep[] = [];
  let choiceWithheld = false;
  // The responses an interaction the page sees binds, and those content it does not see binds.
  const shownBound = new Set<string>();
  const unseenBound = new Set<string>();
  // The first printed variable or parameter on content the page sees whose text passed its bound;
  // the characters of text the walk has printed there; and whether a text passed what remained of
  // the budget, after which the walk prints nothing more.
  let unprinted: RedactedFields["unprinted"] = Option.none();
  let spent = 0;
  let exhausted = false;

  /**
   * Give the text a printed variable or a parameter writes, formatted within what remains of the
   * budget and spent from it, or the empty text when it passed its bound, recording the first that
   * did: with the budget as the bound and the limit `"budget"` when less than {@link textBound}
   * remained, which ends the printing, and with {@link textBound} and the limit `"text"` otherwise.
   * The walk asks for text only on content the page sees, so nothing is formatted, spent or
   * recorded for content it does not see; under `"structure"`, and once the budget is spent, it
   * gives the empty text without formatting.
   *
   * @param print The printer of the text.
   * @param identifier The printed variable's identifier, or the parameter's template variable's.
   * @param path The printed variable's or the `param`'s path.
   * @returns The text, or the empty text past its bound.
   */
  const written = (print: Printer, identifier: string, path: string): string => {
    if (writing.kind === "structure" || exhausted) {
      return "";
    }

    const remaining = writing.budget - spent;
    const text = print(remaining);
    if (Option.isSome(text)) {
      spent += text.value.length;

      return text.value;
    }

    exhausted = remaining < textBound;
    if (Option.isNone(unprinted)) {
      unprinted = Option.some({
        bound: exhausted ? writing.budget : textBound,
        identifier,
        limit: exhausted ? "budget" : "text",
        path,
      });
    }

    return "";
  };

  /**
   * Record responses as bound on content the page sees, or on content it does not.
   *
   * @param responses The responses.
   * @param seen Whether the page sees the content that binds them.
   */
  const bind = (responses: readonly string[], seen: boolean): void => {
    for (const response of responses) {
      (seen ? shownBound : unseenBound).add(response);
    }
  };

  /**
   * Put down a notice the walk makes in a withheld part's place, where the walk stands, when the
   * page sees that place.
   *
   * @param feature The notice's feature.
   * @param seen Whether the page sees the withheld part's place.
   */
  const note = (feature: string, seen: boolean): void => {
    if (seen) {
      steps.push({ feature, kind: "made" });
    }
  };

  /**
   * Reach each listed notice at a node's path that the node stands for and the walk has not yet
   * reached, recording whether the page sees where it sits.
   *
   * @param path The node's path.
   * @param standsFor Whether the node stands for a listed notice at its path.
   * @param seen Whether the page sees the node.
   */
  const reach = (
    path: string,
    standsFor: (entry: UnsupportedFeature) => boolean,
    seen: boolean,
  ): void => {
    for (const index of listedAt.get(path) ?? []) {
      const entry = listed[index];
      if (entry !== undefined && !seenAt.has(index) && standsFor(entry)) {
        seenAt.set(index, seen);
        steps.push({ index, kind: "reached" });
      }
    }
  };

  /**
   * Show body nodes from the values, walking content the page does not see as well, so its notices
   * are reached and its responses bound.
   *
   * @param nodes The body nodes.
   * @param seen Whether the page sees them.
   * @returns The nodes the page is given in their place.
   */
  const nodesOf = (nodes: readonly BodyNode[], seen: boolean): readonly BodyNode[] =>
    nodes.flatMap((node): readonly BodyNode[] => {
      switch (node.kind) {
        case "element": {
          const parameter = expandedParameter(item, printing, node);
          const withheld = Option.exists(parameter, Option.isNone);
          const held = new Set(
            node.children.flatMap((child) =>
              child.kind === "unsupported" && child.path === node.path ? [child.feature] : [],
            ),
          );
          if (withheld) {
            unseen.add(node.path);
          }

          reach(node.path, (entry) => !held.has(entry.feature), seen && !withheld);

          const children = nodesOf(node.children, seen && !withheld);
          if (withheld) {
            note(parameterNotice, seen);

            return [{ feature: parameterNotice, kind: "unsupported", path: node.path }];
          }

          const attributes = Option.match(Option.flatten(parameter), {
            onNone: () => node.attributes,
            onSome: (expanded) => {
              const value =
                seen && writing.kind === "text"
                  ? written(
                      (bound) => parameterText(expanded.value, bound),
                      expanded.identifier,
                      node.path,
                    )
                  : expanded.identifier;

              return node.attributes.map((attribute) =>
                attribute.name === "value" ? { name: attribute.name, value } : attribute,
              );
            },
          });

          return [{ ...node, attributes, children }];
        }
        case "unsupported": {
          reach(node.path, (entry) => entry.feature === node.feature, seen);

          return [node];
        }
        case "printed-variable": {
          return Option.match(
            printing.pipe(Option.flatMap((record) => printedText(node, record))),
            {
              onNone: (): readonly BodyNode[] => {
                note(printedNotice, seen);

                return [{ feature: printedNotice, kind: "unsupported", path: node.path }];
              },
              onSome: (print): readonly BodyNode[] => {
                const printed = seen ? written(print, node.identifier, node.path) : "";

                return printed === "" ? [] : [{ kind: "text", text: printed }];
              },
            },
          );
        }
        case "template-block":
        case "template-inline": {
          return Option.match(shownBy(printing, node.templateVisibility, node.identifier), {
            onNone: (): readonly BodyNode[] => {
              const feature = templateNotice[node.kind];
              note(feature, seen);
              unseen.add(node.path);
              bind(node.responses, false);
              nodesOf(node.content, false);

              return [{ feature, kind: "unsupported", path: node.path }];
            },
            onSome: (visible) => {
              if (!visible) {
                unseen.add(node.path);
              }

              if (!(seen && visible)) {
                bind(node.responses, false);
              }

              const content = nodesOf(node.content, seen && visible);

              return visible ? content : [];
            },
          });
        }
        case "choice": {
          reach(node.path, () => true, seen);
          bind([node.response], seen);

          const prompt = node.prompt.pipe(Option.map((lead) => nodesOf(lead, seen)));
          // oxlint-disable-next-line eslint/no-use-before-define -- `nodesOf` and `choicesOf` are mutually recursive, as a choice's content holds body nodes; the call runs only after both are defined.
          const choices = choicesOf(node.choices, seen);

          return [{ ...node, choices, prompt }];
        }
        case "extended-text": {
          reach(node.path, () => true, seen);
          bind([node.response], seen);

          return [{ ...node, prompt: node.prompt.pipe(Option.map((lead) => nodesOf(lead, seen))) }];
        }
        case "inline-choice": {
          reach(node.path, () => true, seen);
          bind([node.response], seen);

          const label = node.label.pipe(Option.map((lead) => nodesOf(lead, seen)));
          // oxlint-disable-next-line eslint/no-use-before-define -- `nodesOf` and `choicesOf` are mutually recursive, as a choice's content holds body nodes; the call runs only after both are defined.
          const choices = choicesOf(node.choices, seen);

          return [{ ...node, choices, label }];
        }
        case "text-entry": {
          bind([node.response], seen);

          return [node];
        }
        case "text": {
          return [node];
        }
        default: {
          return node satisfies never;
        }
      }
    });

  /**
   * Show a Choice's or an Inline Choice's choices from the values: each one they show, with no
   * template visibility, and none they hide or withhold. The first choice withheld where the page
   * sees its interaction puts down the one `template-identifier` notice.
   *
   * @param choices The choices.
   * @param seen Whether the page sees their interaction.
   * @returns The choices the page is given.
   */
  const choicesOf = (choices: readonly SimpleChoice[], seen: boolean): readonly SimpleChoice[] =>
    choices.flatMap((choice): readonly SimpleChoice[] => {
      const decided = Option.match(choice.templateVisibility, {
        onNone: () => Option.some(true),
        onSome: (visibility) => shownBy(printing, visibility, choice.identifier),
      });
      if (Option.isNone(decided) && seen && !choiceWithheld) {
        choiceWithheld = true;
        note(choiceNotice, true);
      }

      const visible = Option.getOrElse(decided, () => false);
      const content = nodesOf(choice.content, seen && visible);

      return visible
        ? [
            {
              content,
              fixed: choice.fixed,
              identifier: choice.identifier,
              templateVisibility: Option.none(),
            },
          ]
        : [];
    });
  const body = nodesOf(item.body, true);

  /**
   * Decide whether a listed notice is named: it was not reached where the page does not see it,
   * and it does not sit at or below content the page does not see ({@link beneath}).
   *
   * @param index The notice's index among the listed notices.
   * @param entry The notice.
   * @returns Whether `notices` names it.
   */
  const named = (index: number, entry: UnsupportedFeature): boolean =>
    seenAt.get(index) !== false && !beneath(entry.path, unseen);
  const notices: string[] = [];
  let next = 0;
  for (const step of steps) {
    if (step.kind === "made") {
      notices.push(step.feature);
    } else {
      // Name, in the item's order, every reached notice up to this one not yet named.
      while (next <= step.index) {
        const entry = listed[next];
        if (entry !== undefined && seenAt.has(next) && named(next, entry)) {
          notices.push(entry.feature);
        }

        next += 1;
      }
    }
  }

  for (const [index, entry] of listed.entries()) {
    if (!seenAt.has(index) && named(index, entry)) {
      notices.push(entry.feature);
    }
  }

  const hiddenOnly = new Set([...unseenBound].filter((response) => !shownBound.has(response)));

  return { body, hiddenOnly, notices, unprinted };
};

/**
 * Give the response bindings a redaction lists: each response the item declares but the
 * hidden-only ones, those of a base type in document order, then the record responses in document
 * order. The item keeps the two kinds in two maps, so their order across the two is not kept.
 *
 * @param item The item.
 * @param hiddenOnly The responses only content the page does not see binds.
 * @returns The bindings.
 */
const bindingsShown = (item: Item, hiddenOnly: ReadonlySet<string>): readonly ResponseBinding[] => [
  ...[...item.responses.values()].flatMap(
    ({ baseType, cardinality, identifier }): readonly ResponseBinding[] =>
      hiddenOnly.has(identifier) ? [] : [{ baseType, cardinality, identifier }],
  ),
  ...[...(item.records?.values() ?? [])].flatMap(({ identifier }): readonly ResponseBinding[] =>
    hiddenOnly.has(identifier) ? [] : [{ cardinality: "record", identifier }],
  ),
];

/**
 * Copy the parts of an item the page may know: the allowlist, and the only way to make a
 * {@link Redacted} from an item.
 *
 * It copies, each by name, the document location, the identifier, the title, `lang`, the body, each
 * response's binding but the ones {@link hiddenOnlyResponses} gives, the features shown as notices,
 * and the first text past its bound (`unprinted`). Each printed variable of the body is copied as
 * the text it prints: the value the record holds for the variable it names, its template value else
 * its outcome value, written by `formatPrinted` (`#plate/engine/format.ts`) through its `format`,
 * `base`, `index`, `power-form` and `delimiter`, a `base` or `index` written as a name read from
 * the record too. A NULL value prints nothing. A printed variable whose value, or whose named
 * `base`'s or `index`'s, the record does not hold stays its notice, `qti-printed-variable`, which
 * `notices` names in document order among the item's notice-shown features.
 *
 * Each template block and inline, and each choice with a `template-identifier`, is shown or hidden
 * by the template value the record holds ({@link templateShows}): a block or inline shown leaves
 * its content in its place, a hidden one nothing; a choice shown keeps its identifier, content and
 * `fixed`, a hidden one is absent from its interaction, so a shuffled interaction presents the
 * choices that remain under the same key, and its postings name none of it. One whose template
 * variable the record does not hold is withheld: a block or inline stays its notice,
 * `qti-template-block` or `qti-template-inline`, and a choice is absent, `notices` naming
 * `template-identifier` once for all such choices. Content the page does not see adds no notice:
 * a notice listed at or below the path of a block or inline hidden or withheld, or inside a choice
 * hidden or absent, is never named, whatever order the item lists it in, and every other is named
 * once, in the item's order. Nor does it list a response only such content binds: `responses`
 * keeps, in document order, every response but those, so a response one interaction binds in a
 * hidden block and another the page sees binds stays, and so does one only a notice on content the
 * page sees binds, or no interaction binds.
 *
 * Each `param` whose `value` names a template variable declared `param-variable="true"` passes the
 * value the record holds for it in place of the name, converted as the information model's Param
 * `value` says: an integer by `%i` and a float by `%G` through `formatPrinted`, a boolean as `true`
 * or `false`, a point as its coordinates and a pair or a directed pair as its identifiers, each
 * two separated by one space. One whose variable the record does not hold stays its notice,
 * `param`, which `notices` names in document order. Any other `param` keeps its `value` as written.
 *
 * A printed variable, or a `param-variable` parameter, on content the page sees whose text would
 * pass `formatPrinted`'s bound of 1,000,000 characters (a conversion wider than that, or a whole
 * text longer) prints nothing, and `unprinted` names the first the walk meets: the bound, the
 * printed variable's identifier (a parameter's template variable's), the limit `"text"` and its
 * path. `render` fails `OutputTooLarge` on such an item rather than show the slot blank. Content
 * the page does not see formats nothing and is never named there. `unprinted` is none when every
 * text fits.
 *
 * The printed text is held to an output budget: `limits.outputBudget`, else the configuration's
 * default, 16,777,216 characters, counted as a string's `length` counts them, and held to 1 to
 * 536,870,888 by `clampOutputBudget`, so the bound holds whatever number a host passes. It counts
 * the text each printed variable and `param-variable` parameter on content the page sees writes, in
 * document order, and stops printing at the first whose text would pass what remains: that one and
 * every one after it print nothing, and `unprinted` names it with the budget as its bound and the
 * limit `"budget"`, so `render` fails `OutputTooLarge` rather than show the page with its slots
 * blank. So a redaction never builds more printed text than the budget, and one member more,
 * however much the item would print. Pass the configuration `render` takes, which `configure` holds
 * between 1 and 536,870,888. A budget outside that range is clamped, not refused: `NaN` runs under
 * the default, a fraction under its floor, anything above 536,870,888 (`Infinity` included) under
 * 536,870,888, and anything below 1 (0 and `-Infinity` included) under 1, which is the bound
 * `unprinted` then names.
 *
 * With no record, an item whose template processing does not run reads as the record its first
 * attempt starts with: each template variable at its declared default, else NULL (none where the
 * item has a `qti-template-processing` the engine does not run, since nothing computed them), and
 * each outcome at its starting value. An item whose template processing runs has no values
 * without its record, so each of its printed variables, template blocks, template inlines and
 * `param-variable` parameters stays its notice and each of its choices with a template visibility
 * is absent (H3).
 *
 * It never copies an outcome declaration, a correct response, a mapping, a response default, a
 * processing rule, a template rule, a template value or an outcome value it does not print or pass
 * to a parameter, a block's, inline's or choice's template visibility, the seed or an override
 * template processing set (the record's part it reads holds neither), or a field it does not name.
 *
 * @param item The item.
 * @param record The template values and outcome values of the attempt shown, which its printed
 *   variables print, its `param-variable` parameters pass, and which show or hide its template
 *   blocks, inlines and choices; none to show the item as it reads with no record.
 * @param limits The output budget its printed text is held to, clamped to 1 to 536,870,888, such
 *   as the configuration `render` takes; none for the configuration's default, 16,777,216.
 * @returns The redacted item.
 */
export const redactItem = (
  item: Item,
  record?: RedactRecord,
  limits?: Pick<Configuration, "outputBudget">,
): Redacted => {
  const { body, hiddenOnly, notices, unprinted } = printBody(item, printingOf(item, record), {
    budget: clampOutputBudget(limits?.outputBudget ?? defaultOutputBudget),
    kind: "text",
  });

  return brandRedacted({
    body,
    document: item.document,
    identifier: item.identifier,
    lang: item.lang,
    notices,
    responses: bindingsShown(item, hiddenOnly),
    title: item.title,
    unprinted,
  });
};

/**
 * What the page is shown of an item's structure under a record: what {@link redactItem} decides,
 * with no printed text. Plate's own, for the callers that read only which interactions, choices
 * and responses the page shows; `src/index.ts` does not export it, and it is no {@link Redacted},
 * so `payload` and `render` never take one.
 */
export interface RedactedStructure {
  /**
   * The body as `redactItem` gives it, but that a printed variable the record covers leaves
   * nothing in its place and a `param-variable` parameter it expands keeps its `value` as written.
   */
  readonly body: readonly BodyNode[];
  /**
   * The responses only content the page does not see binds: {@link hiddenOnlyResponses}' set.
   */
  readonly hiddenOnly: ReadonlySet<string>;
  /**
   * The features the body shows as notices, as `redactItem` lists them.
   */
  readonly notices: readonly string[];
  /**
   * The response bindings, as `redactItem` lists them.
   */
  readonly responses: readonly ResponseBinding[];
}

/**
 * Decide what the page is shown of an item under a record without printing it: the walk
 * {@link redactItem} makes, with every visibility, binding and notice decided as it decides them,
 * that formats no printed variable and no `param-variable` parameter's value. So the interactions
 * and choices of its body, its responses, its notices and its hidden-only responses are
 * `redactItem`'s, and its cost does not follow the length of what the item prints.
 *
 * It is for plate's own callers that read only what the page shows, such as `checkResponses`,
 * `results` and a session's skip rule; `src/index.ts` does not export it.
 *
 * @example
 *   interactionsIn(redactStructure(item, record).body);
 *   // the interactions redactItem(item, record).body holds, each with the same choices
 *
 * @param item The item.
 * @param record The template values and outcome values of the attempt shown, as `redactItem` takes
 *   them; none to read the item as it reads with no record.
 * @returns The item's structure as the page is shown it, with no printed text.
 */
export const redactStructure = (item: Item, record?: RedactRecord): RedactedStructure => {
  const { body, hiddenOnly, notices } = printBody(item, printingOf(item, record), structureOnly);

  return { body, hiddenOnly, notices, responses: bindingsShown(item, hiddenOnly) };
};

/**
 * Give the responses only content the page does not see binds: those some interaction binds, a
 * rendered interaction anywhere in the body or any interaction, rendered or a notice, inside a
 * template block or inline the record hides or withholds (or one inside content the page does not
 * see), and that no interaction of `redactItem(item, record).body` binds. {@link redactItem} lists
 * none of them in `responses`.
 *
 * A response bound only to a notice on content the page sees, or bound by no interaction, is not
 * among them, so a caller that passes such a response through keeps doing so (D8-3). The set comes
 * from the same walk `redactItem` makes, so the two never disagree, made as
 * {@link redactStructure} makes it: it formats no printed variable and no parameter's value.
 *
 * @example
 *   // A block shown when T holds A binds SHOWN; a block shown when T holds B binds HIDDEN.
 *   hiddenOnlyResponses(item, { outcomes: {}, templates: { T: identifierA } });
 *   // Set { "HIDDEN" }
 *
 * @param item The item.
 * @param record The template values and outcome values of the attempt shown, as `redactItem` takes
 *   them; none to read the item as it reads with no record.
 * @returns The responses, in the order the walk first meets them.
 */
export const hiddenOnlyResponses = (item: Item, record?: RedactRecord): ReadonlySet<string> =>
  printBody(item, printingOf(item, record), structureOnly).hiddenOnly;

/**
 * How one response travels through a host's form: its identifier, its binding, and the options
 * `decode` reads its entries with.
 *
 * The binding's `name` is the entry name `render` gives the response's Controls by default,
 * `entryName(instance, identifier)`. {@link postings} does not see `render`'s `names` option, so a
 * host that passes `names` to `render` must decode each response under the name it passed there,
 * not under the binding's `name`.
 */
export interface Posting {
  readonly binding: Binding;
  readonly identifier: string;
  /**
   * The number base its integer is written in: the `base` of the first Text Entry or Extended
   * Text, in document order, that binds the response, and 10 when only a Choice or an Inline
   * Choice binds it. `decode` does not apply it to a record.
   */
  readonly options: DecodeOptions;
}

/**
 * Give the binding a response travels through the form under: a `RecordBinding` for a record
 * response, a `ValueBinding` for a response of a base type a phase-1 interaction posts, and
 * none for a response of any other base type, which no Control posts.
 *
 * @param response The response's binding as the page knows it.
 * @param name The entry name its Controls post under.
 * @returns Its form binding, or none.
 */
const formBinding = (response: ResponseBinding, name: string): Option.Option<Binding> => {
  if (response.cardinality === "record") {
    return Option.some({ cardinality: "record", name });
  }

  const { baseType, cardinality } = response;

  return isPosted(baseType) ? Option.some({ baseType, cardinality, name }) : Option.none();
};

/**
 * Give the number base an interaction's posted text is read in: a Text Entry's or an Extended
 * Text's `base`, and none for a Choice or an Inline Choice, which post identifiers.
 *
 * @param interaction The interaction.
 * @returns Its base, or none.
 */
const baseOf = (interaction: Interaction): Option.Option<number> => {
  switch (interaction.kind) {
    case "extended-text":
    case "text-entry": {
      return Option.some(interaction.base);
    }
    case "choice":
    case "inline-choice": {
      return Option.none();
    }
    default: {
      return interaction satisfies never;
    }
  }
};

/**
 * Give the postings of a body and its response bindings in one instance, as {@link postings} gives
 * a redacted item's: plate's own, so a caller that holds a {@link RedactedStructure} learns which
 * responses a page posts without printing the item. `src/index.ts` does not export it.
 *
 * @param redaction The body and the response bindings, of a `Redacted` or a `RedactedStructure`.
 * @param instance The instance token the render used.
 * @returns The postings, as `postings` gives them.
 */
export const postingsIn = (
  redaction: Pick<RedactedFields, "body" | "responses">,
  instance: string,
): readonly Posting[] => {
  const byResponse = new Map<string, Interaction[]>();
  for (const interaction of interactionsIn(redaction.body)) {
    const others = byResponse.get(interaction.response);
    if (others === undefined) {
      byResponse.set(interaction.response, [interaction]);
    } else {
      others.push(interaction);
    }
  }

  return redaction.responses.flatMap((response): readonly Posting[] => {
    const { identifier } = response;
    const bound = byResponse.get(identifier) ?? [];
    const binding = formBinding(response, entryName(instance, identifier));
    if (Option.isNone(binding) || bound.length === 0) {
      return [];
    }

    return [
      {
        binding: binding.value,
        identifier,
        options: { base: Option.getOrElse(Arr.findFirst(bound, baseOf), () => 10) },
      },
    ];
  });
};

/**
 * Give the postings of a redacted item in one instance: one for each record response, and each
 * response of a posted base type, that an interaction in the body binds, in the order of the
 * item's `responses`, so a host decodes each from its form with the base its interaction declares
 * instead of assuming base 10. A record response's binding is a `RecordBinding`, which
 * `decode` reads as a record.
 *
 * A declared response that no interaction binds has no posting. The form has no Control for it,
 * so a post never carries it, and decoding it would give NULL. A host that saved that NULL would
 * replace the value the response holds in its record, the declared default a test session writes
 * when the item is first presented, and processing would read NULL instead.
 *
 * It reads only a {@link Redacted}, so a host needs no type of the item's body to decode a post.
 * It walks the body once and indexes its interactions by the response each binds, keeping
 * document order, so its time grows with the item, not with its responses times its interactions.
 *
 * @example
 *   const values = postings(redact(accepted), instance).map(({ binding, options }) =>
 *     decode(entries, binding, options),
 *   );
 *
 * @param redacted The item, through `redact`.
 * @param instance The instance token the render used, one `checkInstance` passes.
 * @returns The postings: a response no interaction binds, or of a base type no phase-1
 *   interaction posts, has none.
 */
export const postings = (redacted: Redacted, instance: string): readonly Posting[] =>
  postingsIn(redacted, instance);

/**
 * Compute the payload of one render: the allowlist of what the emitter may know about a redacted
 * item and the author's inputs.
 *
 * @param redacted The item, through {@link redactItem}.
 * @param view The author's inputs: the instance, the mode, the seed, values, names, messages and
 *   posted strings.
 * @returns The payload. It holds no correct response, mapping, default, processing rule, seed,
 *   template value or feedback content of the item, whatever the view; the seed only orders a
 *   shuffled Choice's or Inline Choice's choices, and a value it shows is one the view gave.
 */
export const payload = (redacted: Redacted, view: View): Payload => {
  const messages = identifyMessages(view.instance, view.messages);
  const interactions = interactionsIn(redacted.body);
  const restoring = {
    ids: new Set(authoredIdsIn(redacted.body)),
    posted: messages.length > 0 ? view.posted : Option.none(),
    values: view.values,
  };
  const build: Build = {
    ...restoring,
    autofocus: Arr.findFirst(interactions, (interaction) =>
      messages.some((entry) => entry.response === interaction.response),
    ),
    editable: view.mode === "answering",
    instance: view.instance,
    messages,
    names: view.names,
    seed: Option.fromUndefinedOr(view.seed),
    unnamed: unnamedPositions(interactions, restoring),
  };

  return {
    body: copyNodes(redacted.body, build),
    finished: view.finished,
    instance: view.instance,
    lang: Option.getOrElse(redacted.lang, () => view.locale),
    messages,
    mode: view.mode,
    notices: redacted.notices,
    title: redacted.title,
  };
};
