import { Data, Option, Result } from "effect";
import type { Attributes, Element, Node, PartFunction } from "#plate/emit/node.ts";

/**
 * The part keys of each interaction, of the item chrome and of the test chrome, a part's name with
 * a lower-case first letter.
 */
interface PartsOf {
  "choice-interaction":
    | "choice"
    | "choices"
    | "control"
    | "indicator"
    | "label"
    | "prompt"
    | "root";
  "extended-text-interaction": "control" | "prompt" | "root";
  "inline-choice-interaction": "control" | "label" | "option" | "placeholder" | "root";
  item: "message" | "messages" | "notice" | "root" | "status" | "statusHeading";
  "test-navigation":
    | "end"
    | "item"
    | "itemButton"
    | "items"
    | "next"
    | "previous"
    | "root"
    | "submit";
  "text-entry-interaction": "control" | "root";
}

/**
 * The owner of a group of parts: the item chrome, one of the interactions plate renders, or the
 * test chrome's navigation, `test-navigation`.
 *
 * It is also the first key of {@link PartOverrides}.
 */
export type InteractionKey = keyof PartsOf;

/**
 * The part keys of the interaction `I`, so a part key that `I` has no row for does not type-check.
 */
export type PartOf<I extends InteractionKey> = PartsOf[I];

/**
 * A part of any interaction, the second key of {@link PartOverrides}.
 */
export type PartKey = PartOf<InteractionKey>;

/**
 * Where a part sits in the HTML content model: inside content that takes phrasing content only, or
 * inside content that takes flow content.
 */
export type Position = "flow" | "phrasing";

/**
 * The set of elements a part's root may become under a swap (I3), named for the spec's "May become"
 * column.
 *
 * - `flow-container`, `phrasing-container`: any element of that container class.
 * - `prompt`: a flow or phrasing container, or `p`, so the prompt is valid in any parent.
 * - `li`, `textarea`, `fieldset`, `legend`, `button`: that element only.
 * - `heading`: `h1` to `h6`. `list`: `ul`, `ol` or `menu`.
 * - `choice-list`: `ul`, `ol` or a flow container; a swap to a flow container adds the list roles.
 * - `choice-item`: `li`, or a flow container under a Choices that is not a list.
 * - `native-input`: an `input`, whose `type` I1 writes back, so the native control stays the one the
 *   interaction computed.
 * - `text-input`: an `input` of type `text`, written in any case or by default.
 * - `select`: a `select` with no `multiple` and no `size` other than 1, so it stays a drop-down that
 *   posts one entry (spec §4.9 I2).
 * - `option`: an `option` with no `label`, because a `label` replaces the text the option shows, and
 *   a host supplies none of an item's data (rule `efed9867`).
 * - `inline-label`: a `label`, or a phrasing container, so a Label stays phrasing content inside the
 *   author's sentence. `label` is no phrasing container, and a `div` or `p` there would close the
 *   author's `p` in the HTML parser.
 * - `any`: any element.
 */
export type TagClass =
  | "any"
  | "button"
  | "choice-item"
  | "choice-list"
  | "fieldset"
  | "flow-container"
  | "heading"
  | "inline-label"
  | "legend"
  | "li"
  | "list"
  | "native-input"
  | "option"
  | "phrasing-container"
  | "prompt"
  | "select"
  | "text-input"
  | "textarea";

/**
 * One row of the part table: a part of an interaction, its marker, its default element, what a swap
 * may make it, and the attributes I1 writes onto it.
 */
export interface PartRow {
  /**
   * The attributes the part carries unless something sets them: written onto the default element,
   * and under a replacement's own attributes on a swap, so a replacement may override each one
   * (`type="button"` on a navigation button).
   *
   * A default is never in {@link PartRow.merged}, which I1 writes over a replacement's;
   * `parts.test.ts` holds the two apart.
   */
  readonly defaults: Readonly<Record<string, string>>;
  /**
   * The default element's local name.
   */
  readonly element: string;
  readonly interaction: InteractionKey;
  /**
   * Whether the part's first child is its `legend` Prompt, so a swap must keep that legend the
   * first element child of the returned `fieldset`, the one place a legend names its group.
   */
  readonly legendOwner: boolean;
  /**
   * Whether the part's children are the list items of a list part, so the list joint rule applies
   * to it on every emit, swapped or not.
   */
  readonly listOwner: boolean;
  /**
   * The attributes plate owns on this part, which I1 writes over a replacement's: every one the
   * interaction's connect function computes beyond the `data-slot` marker and the Root state
   * (`data-mode`, `data-disabled`), some only in some states, and on the Inline Choice Option and
   * Placeholder also `disabled` and `hidden`, which plate never writes there.
   *
   * A state attribute among them (`name`, `value`, `type`, `checked`, `selected`, `disabled`,
   * `readonly`, `hidden`) is plate's whether plate writes it or leaves it off: the swap drops a
   * replacement's, in any case, when the props do not carry it, so a host cannot set what plate
   * computed absent. Every other name keeps the replacement's value when plate writes none.
   *
   * `parts.test.ts` renders every row to hold this list equal to what the connect function
   * computes, the Option's and Placeholder's `disabled` and `hidden` aside; the merge itself
   * writes whatever the props carry.
   */
  readonly merged: readonly string[];
  readonly part: PartKey;
  /**
   * The part's `data-slot` marker value, derived from the interaction and the part by
   * {@link slotFor}.
   */
  readonly slot: string;
  readonly tagClass: TagClass;
}

/**
 * A part named by its owner and its own key, as a `data-slot` marker names it.
 */
export type PartName = Pick<PartRow, "interaction" | "part">;

/**
 * The two markups of the Choice Prompt and its Root (operator ruling, rule `efed9867`).
 *
 * - `legend`: the Prompt is a `legend`, the Root `fieldset`'s first child, which names the group
 *   natively. Only a Prompt of phrasing content takes it, because a legend holds phrasing content.
 * - `labelledby`: the Prompt is its own element (`qti-prompt`), and the Root names it through
 *   `aria-labelledby` → the Prompt's `id`.
 */
export type PromptMarkup = "labelledby" | "legend";

/**
 * Where a part is placed, for the rows whose element depends on it.
 */
export interface RowContext {
  /**
   * The configured heading level of the Status heading, 1 by default: an integer from 1 to 6,
   * which `renderStatus` checks before the heading is built, so the row writes `h<level>` as given.
   */
  readonly headingLevel?: number;
  /**
   * The Notice's position, phrasing by default.
   */
  readonly position?: Position;
  /**
   * The Choice Prompt's markup, which sets the Choice Root's and Prompt's rows, `labelledby` by
   * default; {@link promptMarkupFor} picks it from the Prompt's content.
   */
  readonly promptMarkup?: PromptMarkup;
}

/**
 * The form controls: no container class holds one, so a part that must stay a container never
 * becomes a control.
 */
export const controls: ReadonlySet<string> = new Set(["button", "input", "select", "textarea"]);

/**
 * The link elements: no container class holds one, so a container part never becomes a link.
 */
export const links: ReadonlySet<string> = new Set(["a", "area"]);

/**
 * The list elements, whose children are `li` elements.
 */
export const lists: ReadonlySet<string> = new Set(["menu", "ol", "ul"]);

/**
 * The heading elements.
 */
export const headings: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * The elements whose content is phrasing content and which are themselves phrasing content, so
 * they stand at a phrasing or a flow position. Custom elements also count ({@link
 * isPhrasingContainer}).
 *
 * @see https://html.spec.whatwg.org/multipage/dom.html#phrasing-content
 */
const phrasingContainers: ReadonlySet<string> = new Set([
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

/**
 * The phrasing content elements whose own content a Prompt's markup does not depend on: void and
 * embedded elements and the controls, each phrasing content whatever it holds.
 *
 * @see https://html.spec.whatwg.org/multipage/dom.html#phrasing-content
 */
const phrasingLeaves: ReadonlySet<string> = new Set([
  "audio",
  "br",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "object",
  "picture",
  "ruby",
  "select",
  "svg",
  "textarea",
  "video",
  "wbr",
]);

/**
 * The phrasing content elements, beside the phrasing containers, that stay phrasing content only
 * while everything they hold is: the transparent ones (`a`, `del`, `ins`, `map`, `canvas`) and
 * those whose content is phrasing content.
 *
 * @see https://html.spec.whatwg.org/multipage/dom.html#transparent-content-models
 */
const phrasingWhenContentIs: ReadonlySet<string> = new Set([
  "a",
  "button",
  "canvas",
  "del",
  "ins",
  "label",
  "map",
  "meter",
  "output",
  "progress",
]);

/**
 * The containers whose content is flow content and which stand only at a flow position.
 *
 * `p`, the headings and `pre` are left out because their content is phrasing only; a `div` child
 * of one would not round-trip.
 *
 * @see https://html.spec.whatwg.org/multipage/dom.html#flow-content
 */
const blockContainers: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "fieldset",
  "figure",
  "footer",
  "header",
  "main",
  "nav",
  "section",
]);

/**
 * The parents that take flow content: the block containers, plus the elements whose content is
 * flow content but which no part becomes.
 */
const flowParents: ReadonlySet<string> = new Set([
  ...blockContainers,
  "dd",
  "form",
  "li",
  "td",
  "th",
]);

/**
 * Tell whether a tag names a custom element, which the HTML parser treats as an ordinary element
 * and which counts as both a phrasing and a flow container.
 *
 * @param tag A local name, lower case.
 * @returns Whether `tag` contains a hyphen.
 * @see https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
 */
const isCustomElement = (tag: string): boolean => tag.includes("-");

/**
 * Tell whether a tag names a phrasing container: an element whose content is phrasing content and
 * which stands at a phrasing or a flow position.
 *
 * @param tag A local name, lower case.
 * @returns Whether `tag` is a listed phrasing container or a custom element.
 */
export const isPhrasingContainer = (tag: string): boolean =>
  phrasingContainers.has(tag) || isCustomElement(tag);

/**
 * Tell whether a tag names a flow container: any element that may stand where a flow container
 * stands, phrasing containers included, and never a control, link or list.
 *
 * @param tag A local name, lower case.
 * @returns Whether `tag` is a phrasing container, a block container or a custom element.
 */
export const isFlowContainer = (tag: string): boolean =>
  isPhrasingContainer(tag) || blockContainers.has(tag);

/**
 * Tell whether a node is phrasing content, the content a `legend` holds.
 *
 * A custom element counts while its content does, as its content model is transparent.
 *
 * @param node The node, a Prompt's child or a node below one.
 * @returns Whether `node` is text, a phrasing leaf, or a phrasing element holding phrasing content
 *   only.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#the-legend-element
 */
const isPhrasingContent = (node: Node): boolean =>
  node.kind === "text" ||
  phrasingLeaves.has(node.tag) ||
  ((isPhrasingContainer(node.tag) || phrasingWhenContentIs.has(node.tag)) &&
    node.children.every(isPhrasingContent));

/**
 * Pick the Choice Prompt's markup from its content (rule `efed9867`): the legend when every child
 * is phrasing content, else its own element named through `aria-labelledby`.
 *
 * @param content The Prompt's children, as emitted.
 * @returns `"legend"` when every node of `content` is phrasing content, else `"labelledby"`.
 */
export const promptMarkupFor = (content: readonly Node[]): PromptMarkup =>
  content.every(isPhrasingContent) ? "legend" : "labelledby";

/**
 * Tell whether an `input`'s `type` attribute is the text type, written or by default.
 *
 * @param type The `type` attribute's value, if present.
 * @returns Whether `type` is absent or is `text` in any ASCII case.
 */
const isTextType = (type: string | true | undefined): boolean =>
  type !== true && (type ?? "text").toLowerCase() === "text";

/**
 * Give an element's attribute by name in any ASCII case, as HTML reads attribute names, so a
 * replacement cannot write `TYPE` or `MULTIPLE` past a check that reads `type` or `multiple`.
 *
 * @param attrs The element's attributes.
 * @param name The attribute's name, in lower case.
 * @returns The value of the first attribute whose name matches, or undefined when none does.
 */
export const attributeOf = (attrs: Attributes, name: string): string | true | undefined => {
  const key = Object.keys(attrs).find((candidate) => candidate.toLowerCase() === name);

  return key === undefined ? undefined : attrs[key];
};

/**
 * Tell whether a `select`'s attributes keep it a drop-down that posts one entry: no `multiple`,
 * which lets it post one entry per chosen option, and no `size` other than 1, which draws a list
 * box.
 *
 * A written `size` is 1 only when it is a valid non-negative integer, ASCII digits, of value 1.
 *
 * @param attrs The `select`'s attributes.
 * @returns Whether `multiple` is absent and `size` is absent or 1.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#attr-select-size
 */
const isDropDown = (attrs: Attributes): boolean => {
  const size = attributeOf(attrs, "size");

  return (
    attributeOf(attrs, "multiple") === undefined &&
    (size === undefined || (size !== true && /^0*1$/u.test(size)))
  );
};

/**
 * I3's test of each tag class, on the element a replacement returned.
 */
const admits = {
  any: () => true,
  button: ({ tag }) => tag === "button",
  "choice-item": ({ tag }) => tag === "li" || isFlowContainer(tag),
  "choice-list": ({ tag }) => tag === "ol" || tag === "ul" || isFlowContainer(tag),
  fieldset: ({ tag }) => tag === "fieldset",
  "flow-container": ({ tag }) => isFlowContainer(tag),
  heading: ({ tag }) => headings.has(tag),
  "inline-label": ({ tag }) => tag === "label" || isPhrasingContainer(tag),
  legend: ({ tag }) => tag === "legend",
  li: ({ tag }) => tag === "li",
  list: ({ tag }) => lists.has(tag),
  "native-input": ({ tag }) => tag === "input",
  option: ({ attrs, tag }) => tag === "option" && attributeOf(attrs, "label") === undefined,
  "phrasing-container": ({ tag }) => isPhrasingContainer(tag),
  prompt: ({ tag }) => tag === "p" || isFlowContainer(tag),
  select: ({ attrs, tag }) => tag === "select" && isDropDown(attrs),
  "text-input": ({ attrs, tag }) => tag === "input" && isTextType(attributeOf(attrs, "type")),
  textarea: ({ tag }) => tag === "textarea",
} satisfies { readonly [C in TagClass]: (element: Element) => boolean };

/**
 * The rows of the part table, the item chrome's, then each interaction's, then the test chrome's
 * navigation rows, before {@link partTable} derives each marker.
 *
 * The five navigation buttons are plain buttons (rule `9af3809b`): each defaults `type` to
 * `button`, and no navigation row merges `type`, `name`, `value` or a `form*` attribute, so a
 * host's replacement may give a button its own submit semantics while every attribute plate
 * computes still stands. Each merges `disabled`, so a button's replacement cannot disable the
 * button plate leaves enabled; disabling it through an ancestor, such as a `fieldset disabled`, is
 * the host's.
 *
 * The Inline Choice Option and Placeholder merge `disabled` and `hidden`, which plate never writes
 * on them, so plate owns their absence: a replacement cannot disable or hide a choice, or the way
 * back to no answer, on the option's own element; disabling the select through an ancestor, such
 * as a `fieldset disabled`, is the host's.
 */
const rows: readonly Omit<PartRow, "legendOwner" | "slot">[] = [
  {
    defaults: {},
    element: "qti-assessment-item",
    interaction: "item",
    listOwner: false,
    merged: ["lang", "id"],
    part: "root",
    tagClass: "flow-container",
  },
  {
    defaults: {},
    element: "section",
    interaction: "item",
    listOwner: false,
    merged: ["id", "role", "aria-labelledby", "tabindex", "autofocus"],
    part: "status",
    tagClass: "flow-container",
  },
  {
    defaults: {},
    element: "h1",
    interaction: "item",
    listOwner: false,
    merged: ["id"],
    part: "statusHeading",
    tagClass: "heading",
  },
  {
    defaults: {},
    element: "ul",
    interaction: "item",
    listOwner: false,
    merged: [],
    part: "messages",
    tagClass: "list",
  },
  {
    defaults: {},
    element: "li",
    interaction: "item",
    listOwner: false,
    merged: ["id"],
    part: "message",
    tagClass: "li",
  },
  {
    defaults: {},
    element: "span",
    interaction: "item",
    listOwner: false,
    merged: ["role"],
    part: "notice",
    tagClass: "phrasing-container",
  },
  {
    defaults: {},
    element: "fieldset",
    interaction: "choice-interaction",
    listOwner: false,
    merged: ["aria-labelledby", "aria-label", "class", "data-orientation"],
    part: "root",
    tagClass: "fieldset",
  },
  {
    defaults: {},
    element: "qti-prompt",
    interaction: "choice-interaction",
    listOwner: false,
    merged: ["id"],
    part: "prompt",
    tagClass: "prompt",
  },
  {
    defaults: {},
    element: "ul",
    interaction: "choice-interaction",
    listOwner: true,
    merged: [],
    part: "choices",
    tagClass: "choice-list",
  },
  {
    defaults: {},
    element: "li",
    interaction: "choice-interaction",
    listOwner: false,
    merged: [],
    part: "choice",
    tagClass: "choice-item",
  },
  {
    defaults: {},
    element: "input",
    interaction: "choice-interaction",
    listOwner: false,
    merged: [
      "id",
      "name",
      "type",
      "value",
      "checked",
      "disabled",
      "aria-labelledby",
      "aria-invalid",
      "aria-describedby",
      "autofocus",
    ],
    part: "control",
    tagClass: "native-input",
  },
  {
    defaults: {},
    element: "span",
    interaction: "choice-interaction",
    listOwner: false,
    merged: ["aria-hidden"],
    part: "indicator",
    tagClass: "any",
  },
  {
    defaults: {},
    element: "label",
    interaction: "choice-interaction",
    listOwner: false,
    merged: ["id", "for"],
    part: "label",
    tagClass: "any",
  },
  {
    defaults: {},
    element: "qti-text-entry-interaction",
    interaction: "text-entry-interaction",
    listOwner: false,
    merged: ["class"],
    part: "root",
    tagClass: "phrasing-container",
  },
  {
    defaults: {},
    element: "input",
    interaction: "text-entry-interaction",
    listOwner: false,
    merged: [
      "id",
      "name",
      "type",
      "value",
      "disabled",
      "readonly",
      "inputmode",
      "size",
      "placeholder",
      "autocomplete",
      "aria-label",
      "aria-labelledby",
      "aria-invalid",
      "aria-describedby",
      "autofocus",
    ],
    part: "control",
    tagClass: "text-input",
  },
  {
    defaults: {},
    element: "qti-inline-choice-interaction",
    interaction: "inline-choice-interaction",
    listOwner: false,
    merged: ["class"],
    part: "root",
    tagClass: "phrasing-container",
  },
  {
    defaults: {},
    element: "label",
    interaction: "inline-choice-interaction",
    listOwner: false,
    merged: ["id", "for"],
    part: "label",
    tagClass: "inline-label",
  },
  {
    defaults: {},
    element: "select",
    interaction: "inline-choice-interaction",
    listOwner: false,
    merged: [
      "id",
      "name",
      "autocomplete",
      "disabled",
      "aria-label",
      "aria-labelledby",
      "aria-invalid",
      "aria-describedby",
      "autofocus",
    ],
    part: "control",
    tagClass: "select",
  },
  {
    defaults: {},
    element: "option",
    interaction: "inline-choice-interaction",
    listOwner: false,
    merged: ["value", "selected", "disabled", "hidden"],
    part: "placeholder",
    tagClass: "option",
  },
  {
    defaults: {},
    element: "option",
    interaction: "inline-choice-interaction",
    listOwner: false,
    merged: ["value", "selected", "disabled", "hidden"],
    part: "option",
    tagClass: "option",
  },
  {
    defaults: {},
    element: "qti-extended-text-interaction",
    interaction: "extended-text-interaction",
    listOwner: false,
    merged: ["role", "aria-labelledby", "aria-label", "class", "data-format"],
    part: "root",
    tagClass: "flow-container",
  },
  {
    defaults: {},
    element: "qti-prompt",
    interaction: "extended-text-interaction",
    listOwner: false,
    merged: ["id"],
    part: "prompt",
    tagClass: "prompt",
  },
  {
    defaults: {},
    element: "textarea",
    interaction: "extended-text-interaction",
    listOwner: false,
    merged: [
      "id",
      "name",
      "rows",
      "placeholder",
      "autocomplete",
      "disabled",
      "readonly",
      "aria-label",
      "aria-labelledby",
      "aria-invalid",
      "aria-describedby",
      "autofocus",
      "data-format",
    ],
    part: "control",
    tagClass: "textarea",
  },
  {
    defaults: {},
    element: "nav",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["aria-label", "data-navigation", "data-submission"],
    part: "root",
    tagClass: "flow-container",
  },
  {
    defaults: { type: "button" },
    element: "button",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["disabled", "data-intent"],
    part: "previous",
    tagClass: "button",
  },
  {
    defaults: { type: "button" },
    element: "button",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["disabled", "data-intent"],
    part: "next",
    tagClass: "button",
  },
  {
    defaults: {},
    element: "ol",
    interaction: "test-navigation",
    listOwner: false,
    merged: [],
    part: "items",
    tagClass: "list",
  },
  {
    defaults: {},
    element: "li",
    interaction: "test-navigation",
    listOwner: false,
    merged: [],
    part: "item",
    tagClass: "li",
  },
  {
    defaults: { type: "button" },
    element: "button",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["disabled", "data-intent", "aria-current"],
    part: "itemButton",
    tagClass: "button",
  },
  {
    defaults: { type: "button" },
    element: "button",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["disabled", "data-intent"],
    part: "submit",
    tagClass: "button",
  },
  {
    defaults: { type: "button" },
    element: "button",
    interaction: "test-navigation",
    listOwner: false,
    merged: ["disabled", "data-intent"],
    part: "end",
    tagClass: "button",
  },
];

/**
 * The part table broke one of its own rules, a defect of this module that no caller can cause.
 *
 * It cannot occur: the table is a constant, its rows are unique by construction and checked once
 * when the module loads, and {@link rowFor}'s types admit only the keys it holds. It is thrown,
 * never returned.
 */
export class PartTableDefect extends Data.TaggedError("PartTableDefect")<{
  readonly detail: string;
}> {
  /**
   * The rule the table broke, and where to correct it.
   */
  override get message(): string {
    return `The part table is inconsistent: ${this.detail}. Correct its rows in emit/parts.ts.`;
  }
}

/**
 * Derive a part's `data-slot` marker (operator ruling, rule `0e767b8d`): a Root carries its
 * component's name, and every other part `<component>-<part>`, the part key in kebab case.
 *
 * Every marker the emitter writes and every check reads comes from here through the part table, so
 * no code spells one by hand.
 *
 * @param interaction The component: an interaction, `item` for the host chrome, or
 *   `test-navigation` for the test chrome.
 * @param part The part.
 * @returns The marker: `choice-interaction`, `choice-interaction-indicator`, `item-status-heading`,
 *   `test-navigation-item-button`.
 */
const slotFor = (interaction: InteractionKey, part: PartKey): string =>
  part === "root"
    ? interaction
    : `${interaction}-${part.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * The part table, one row per part of the item chrome, each interaction and the test chrome's
 * navigation, in {@link rows}' order, each with its derived marker.
 *
 * The Notice, the StatusHeading and the Choice Root and Prompt hold their context-free defaults: a
 * phrasing `span`, `h1`, and the `labelledby` markup with no legend. {@link rowFor} gives the row
 * for a placement.
 */
export const partTable: readonly PartRow[] = rows.map((row) => ({
  ...row,
  legendOwner: false,
  slot: slotFor(row.interaction, row.part),
}));

/**
 * Give the key of a part in the lookups: the interaction and the part, which neither key's spelling
 * can make ambiguous because neither holds a space.
 *
 * @param interaction The interaction key.
 * @param part The part key.
 * @returns The two keys joined by a space.
 */
const rowKey = (interaction: string, part: string): string => `${interaction} ${part}`;

/**
 * The part table's rows by interaction and part.
 */
const rowIndex: ReadonlyMap<string, PartRow> = new Map(
  partTable.map((row) => [rowKey(row.interaction, row.part), row]),
);

if (rowIndex.size !== partTable.length) {
  throw new PartTableDefect({ detail: "it holds two rows for the same interaction and part" });
}

/**
 * The part each `data-slot` marker names.
 */
const slotIndex: ReadonlyMap<string, PartName> = new Map(
  partTable.map((row) => [row.slot, { interaction: row.interaction, part: row.part }]),
);

if (slotIndex.size !== partTable.length) {
  throw new PartTableDefect({ detail: "two of its rows derive the same data-slot marker" });
}

/**
 * Find the part a `data-slot` marker names, so a reader of an emitted tree asks the part table
 * rather than comparing marker strings.
 *
 * @param slot A `data-slot` attribute's value.
 * @returns The interaction and the part, or none when no row carries the marker.
 */
export const partForSlot = (slot: string): Option.Option<PartName> =>
  Option.fromUndefinedOr(slotIndex.get(slot));

/**
 * The part keys of each interaction, in the table's order, for checking overrides and naming the
 * keys an unknown one should have been.
 */
const knownParts: ReadonlyMap<string, readonly string[]> = new Map(
  [...new Set(partTable.map((row) => row.interaction))].map((interaction) => [
    interaction,
    partTable.filter((row) => row.interaction === interaction).map((row) => row.part),
  ]),
);

/**
 * Give the row of a part as placed: the table's row, with the Notice's element and class set by its
 * position, the StatusHeading's element by the heading level, and the Choice Root's and Prompt's
 * rows by the Prompt's markup.
 *
 * Under the `legend` markup the Prompt is a `legend` that stays one under a swap, and the Root, a
 * `fieldset`, owns it as its first child and names no Prompt id. Under `labelledby` the rows are
 * the table's: the Prompt keeps the `id` the Root's `aria-labelledby` names.
 *
 * @param interaction The interaction that owns the part.
 * @param part The part.
 * @param context Where the part is placed: the Notice's position, phrasing by default; the
 *   StatusHeading's level, 1 by default; and the Choice Prompt's markup, `labelledby` by default.
 * @returns The part's row.
 * @throws {PartTableDefect} When the table has no row for the keys, which its types rule out.
 */
export const rowFor = <I extends InteractionKey>(
  interaction: I,
  part: PartOf<I>,
  context: RowContext = {},
): PartRow => {
  const row = rowIndex.get(rowKey(interaction, part));
  if (row === undefined) {
    throw new PartTableDefect({ detail: `it has no row for ${interaction} ${part}` });
  }

  if (row.interaction === "item" && row.part === "notice" && context.position === "flow") {
    return { ...row, element: "div", tagClass: "flow-container" };
  }

  if (row.interaction === "choice-interaction" && context.promptMarkup === "legend") {
    if (row.part === "root") {
      return { ...row, legendOwner: true, merged: ["class", "data-orientation"] };
    }

    if (row.part === "prompt") {
      return { ...row, element: "legend", merged: [], tagClass: "legend" };
    }
  }

  if (row.interaction === "item" && row.part === "statusHeading") {
    return { ...row, element: `h${context.headingLevel ?? 1}` };
  }

  return row;
};

/**
 * Tell whether a replacement's root element may stand for a part (I3), by its tag and, for the
 * text input class its `type`, for the select class its `multiple` and `size`, and for the option
 * class its `label`.
 *
 * @param row The part's row, as {@link rowFor} gives it for the placement.
 * @param element The root element the replacement returned.
 * @returns Whether `element` is in the row's tag class.
 */
export const allows = (row: PartRow, element: Element): boolean => admits[row.tagClass](element);

/**
 * Give the position of a part placed under a parent: flow only when the parent takes flow content
 * and no `p` is open above it, since a `div` start tag closes an open `p` and would not round-trip.
 *
 * @param parentTag The parent's local name, lower case.
 * @param insideParagraph Whether a `p` is open above the parent.
 * @returns `"flow"` or `"phrasing"`.
 */
export const positionUnder = (parentTag: string, insideParagraph: boolean): Position =>
  !insideParagraph && (flowParents.has(parentTag) || isCustomElement(parentTag))
    ? "flow"
    : "phrasing";

/**
 * Construct an id scoped by the item instance, so two instances on one page never share an id.
 * Every id the emitter writes is built here.
 *
 * @param instance The item instance's id.
 * @param segments The id's further parts, such as the response identifier, a part and an index.
 * @returns The instance and the segments joined by `-`: `<instance>-<response>-control-0`.
 */
export const scopedId = (instance: string, ...segments: readonly (number | string)[]): string =>
  [instance, ...segments].join("-");

/**
 * Scope an id the author wrote by the item instance, so it meets no other instance's ids and none
 * of the ids the renderer writes for its own parts.
 *
 * The renderer's ids are `<instance>-<segment>-…` ({@link scopedId}), where the first segment is a
 * response identifier or a part name and so starts with a letter or an underscore. The empty
 * segment here gives `<instance>--<id>`: the double hyphen is a prefix no renderer id has, so an
 * authored `RESPONSE-control-0`, `item` or `status` stays distinct from the Control, Root and
 * Status ids. The `id` attribute, every IDREF attribute and every same-document `#id` fragment use
 * this one helper, so a reference still finds its target.
 *
 * @param instance The item instance key.
 * @param id The id as the author wrote it.
 * @returns `<instance>--<id>`.
 */
export const authoredId = (instance: string, id: string): string => scopedId(instance, "", id);

/**
 * The ASCII whitespace that separates the tokens of an HTML token list.
 */
const tokenSeparator = /[\t\n\f\r ]+/u;

/**
 * Split a value of tokens separated by ASCII whitespace, as HTML splits one: an IDREFS value, such
 * as `aria-labelledby` or `headers`, into its ids, or a `class` value into its classes.
 *
 * @param value The attribute's value.
 * @returns The tokens in order, with no empty token from leading, trailing or repeated whitespace.
 * @see https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#space-separated-tokens
 */
export const splitTokens = (value: string): readonly string[] =>
  value.split(tokenSeparator).filter((token) => token !== "");

/**
 * Scope every id of an IDREFS value the author wrote through {@link authoredId}, so each still
 * names its scoped target.
 *
 * A value that names no id, being empty or only whitespace, is no reference at all, as the
 * accessible-name computation reads an `aria-labelledby` that names nothing: it gives none, and
 * the caller writes no attribute and treats the author as having given none.
 *
 * @param instance The item instance key.
 * @param value The attribute's value as the author wrote it.
 * @returns The scoped ids, in order, joined by one space; none when the value names no id.
 */
export const authoredIdrefs = (instance: string, value: string): Option.Option<string> => {
  const ids = splitTokens(value);

  return ids.length === 0
    ? Option.none()
    : Option.some(ids.map((id) => authoredId(instance, id)).join(" "));
};

/**
 * Replacement part functions keyed by interaction, then by part: the goal's tier-2 swap, such as
 * `parts["choice-interaction"].indicator`.
 *
 * The keys are strings so that a caller's misspelt key reaches {@link resolveOverrides} and fails
 * with {@link UnknownPart}.
 */
export type PartOverrides = Readonly<
  Record<string, Readonly<Record<string, PartFunction<Attributes>>>>
>;

/**
 * The part overrides, checked against the part table.
 */
export interface Resolved {
  /**
   * Give the replacement for a part.
   *
   * @param interaction The interaction that owns the part.
   * @param part The part.
   * @returns The replacement part function, or none when the part keeps its default.
   */
  readonly replacementFor: <I extends InteractionKey>(
    interaction: I,
    part: PartOf<I>,
  ) => Option.Option<PartFunction<Attributes>>;
}

/**
 * A part override keyed by an interaction or a part the part table does not have.
 *
 * `part` is none when the interaction itself is unknown. It is returned through a `Result`, never
 * thrown.
 */
export class UnknownPart extends Data.TaggedError("UnknownPart")<{
  readonly interaction: string;
  readonly part: Option.Option<string>;
}> {
  /**
   * The unknown key and the keys allowed at its level.
   */
  override get message(): string {
    const parts = knownParts.get(this.interaction);
    if (parts === undefined || Option.isNone(this.part)) {
      return `parts has no interaction "${this.interaction}". Key it by one of: ${[...knownParts.keys()].join(", ")}.`;
    }

    return `parts["${this.interaction}"] has no part "${this.part.value}". Key it by one of: ${parts.join(", ")}.`;
  }
}

/**
 * Check part overrides against the part table, failing on the first unknown interaction or part.
 *
 * @param overrides The replacement part functions, none by default.
 * @returns The overrides, resolvable by interaction and part, or the first {@link UnknownPart}.
 */
export const resolveOverrides = (
  overrides: PartOverrides = {},
): Result.Result<Resolved, UnknownPart> => {
  const replacements = new Map<string, PartFunction<Attributes>>();
  for (const [interaction, parts] of Object.entries(overrides)) {
    const known = knownParts.get(interaction);
    if (known === undefined) {
      return Result.fail(new UnknownPart({ interaction, part: Option.none() }));
    }

    for (const [part, replacement] of Object.entries(parts)) {
      if (!known.includes(part)) {
        return Result.fail(new UnknownPart({ interaction, part: Option.some(part) }));
      }

      replacements.set(rowKey(interaction, part), replacement);
    }
  }

  return Result.succeed({
    replacementFor: (interaction, part) =>
      Option.fromUndefinedOr(replacements.get(rowKey(interaction, part))),
  });
};
