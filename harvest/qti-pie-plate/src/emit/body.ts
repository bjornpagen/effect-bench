/**
 * Body emission: the item body's HTML subset as nodes of the output tree (I-7, I-8, A-1).
 *
 * {@link emitBody} walks the payload's body. An HTML element renders as itself through `h`, with
 * three changes: `xml:lang` becomes `lang`; an authored `id`, and every reference to one, is scoped
 * by the item instance through {@link authoredId}; and a heading shifts so that the item's
 * shallowest heading sits at the configured heading level, every other heading keeping its distance
 * from it and capped at `h6` ({@link headingOffsetOf}). A `tr` the author placed directly in a
 * `table` gains the `tbody` the HTML parser would insert, so the tree survives a parse. Text
 * becomes text, an interaction goes to its render function, and each notice `check` handed in
 * becomes the Notice part, a `span` at a phrasing position and a `div` where the parent takes flow
 * content.
 *
 * URL attributes are `url.ts`'s, and so is every decision about them: `check` has already dropped
 * each refused value, placed its notice, and written each kept value in its parsed form. The walk
 * classifies a value again only to write it, rebasing a package path onto the asset base and
 * scoping a same-document `#id` as the id it names.
 *
 * The walk does not trust the payload it reads: `render` may run in a browser on a `Redacted` that
 * crossed the network as JSON and lost its type. So it emits only the XSD's HTML subset,
 * {@link htmlSubset}: an element the XSD does not declare is dropped with its subtree, an attribute
 * the XSD does not declare on its element is dropped, and a node of no kind the payload defines is
 * dropped. Names match exactly, so `A` or `HREF` is not `a` or `href`. Valid content loses
 * nothing, since `check` refuses or strips everything outside the subset first.
 *
 * @module
 * @see {@link Payload} for what the walk reads.
 */
import { Data, Option, Result } from "effect";
import { itemPart } from "#plate/emit/item.ts";
import { h, text } from "#plate/emit/node.ts";
import type { Attributes, Element, Node } from "#plate/emit/node.ts";
import { authoredId, authoredIdrefs, headings, positionUnder, rowFor } from "#plate/emit/parts.ts";
import type { Position, Resolved } from "#plate/emit/parts.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { message } from "#plate/messages.ts";
import type { Locale } from "#plate/messages.ts";
import { classifyUrl, formatUrl, urlContextOf } from "#plate/model/url.ts";
import type { KeptUrl, UrlContext } from "#plate/model/url.ts";
import type {
  AttributePayload,
  ElementPayload,
  EmitState,
  InteractionPayload,
  NoticePayload,
  Payload,
  PayloadNode,
} from "#plate/payload.ts";

/**
 * Render one interaction of the body: the interaction module's render function, with the payload
 * and the state already applied.
 *
 * @param interaction The interaction's payload.
 * @returns The interaction's Root, or the refusal of a part swap.
 */
export type RenderInteraction = (
  interaction: InteractionPayload,
) => Result.Result<Element, PartSwapRefused>;

/**
 * Where a nested interaction was met: inside a Choice's Prompt or choice content, an Extended
 * Text's Prompt, or an Inline Choice's Label. An Inline Choice's choice content is written as
 * option text, never as nodes, so its Label is the only content of one the emitter walks.
 */
export type NestedWithin =
  | "choice-interaction"
  | "extended-text-interaction"
  | "inline-choice-interaction";

/**
 * The content each {@link NestedWithin} names, as the message says it.
 */
const nestedPlaces: Readonly<Record<NestedWithin, string>> = {
  "choice-interaction": "a Choice's Prompt or choice content",
  "extended-text-interaction": "an Extended Text's Prompt",
  "inline-choice-interaction": "an Inline Choice's Label",
};

/**
 * An interaction met inside a Prompt, a choice's content or an Inline Choice's Label, a defect
 * that no checked item can cause.
 *
 * It cannot occur through the library: QTI's schema admits no interaction inside a Prompt, a
 * choice's content or an Inline Choice's Label, `check` refuses one, `redact` copies only what
 * `check` accepted, and `decodeRedacted` refuses JSON that holds one. Only a payload built by hand
 * can hold one. It is thrown, never returned.
 */
export class NestedInteractionDefect extends Data.TaggedError("NestedInteractionDefect")<{
  readonly kind: InteractionPayload["kind"];
  readonly response: string;
  readonly within: NestedWithin;
}> {
  /**
   * The nested interaction, where it sits, and what to change.
   */
  override get message(): string {
    return `A ${this.kind} interaction for the response ${JSON.stringify(this.response)} sits inside ${nestedPlaces[this.within]}, where QTI's schema admits no interaction; move it out to the item body, or render an item that check accepted.`;
  }
}

/**
 * Give the render function for content where QTI's schema admits no interaction, a Prompt's, a
 * choice's or an Inline Choice's Label's: meeting one is a defect, since only a payload built by
 * hand can hold one.
 *
 * @param within Where the content sits.
 * @returns A render function that throws {@link NestedInteractionDefect}, naming the interaction
 *   and `within`, for any interaction it is handed.
 */
export const nestedInteraction =
  (within: NestedWithin): RenderInteraction =>
  (nested) => {
    throw new NestedInteractionDefect({ kind: nested.kind, response: nested.response, within });
  };

/**
 * The attributes the XSD declares as references to ids (`xs:IDREF`, `xs:IDREFS`, and `headers`, a
 * list of identifiers), each value one id or a whitespace-separated list of them.
 *
 * `for` is not among them: the XSD does not declare it on `label`.
 */
const idReferences: ReadonlySet<string> = new Set([
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "headers",
]);

/**
 * The attributes the XSD declares by name on every HTML element of the item body but `param` and
 * `template`: ARIA's states and properties, the global attributes, and QTI's
 * `data-catalog-idref` and `data-qti-suppress-tts`.
 */
const globalAttributes: readonly string[] = [
  "aria-activedescendant",
  "aria-atomic",
  "aria-autocomplete",
  "aria-busy",
  "aria-checked",
  "aria-colcount",
  "aria-colindex",
  "aria-colspan",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-details",
  "aria-disabled",
  "aria-errormessage",
  "aria-expanded",
  "aria-flowto",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-label",
  "aria-labelledby",
  "aria-level",
  "aria-live",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-owns",
  "aria-placeholder",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-relevant",
  "aria-required",
  "aria-roledescription",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowspan",
  "aria-selected",
  "aria-setsize",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
  "class",
  "data-catalog-idref",
  "data-qti-suppress-tts",
  "dir",
  "id",
  "label",
  "lang",
  "role",
  "xml:lang",
];

/**
 * ARIA's name for the keyboard shortcuts attribute, which every element but the empty ones
 * declares.
 */
const keyShortcuts = "aria-keyshortcuts";

/**
 * The XSD's misspelling of {@link keyShortcuts}, which it declares on the empty elements in its
 * place. Reading 10 accepts both spellings there, and the walk writes either as ARIA's, so screen
 * readers announce it (operator ruling `96840ced`).
 */
const keyShortcutsMisspelt = "aria-keyshorts";

/**
 * The attributes of the XSD's sectioning, grouping, ruby and table elements.
 */
const structural: readonly string[] = [...globalAttributes, keyShortcuts];

/**
 * The attributes of the XSD's text-level and block elements, which add SSML and `xml:base`.
 */
const textual: readonly string[] = [...structural, "data-ssml", "xml:base"];

/**
 * The attributes of the XSD's empty elements, with the misspelt shortcuts attribute.
 */
const empty: readonly string[] = [...globalAttributes, keyShortcutsMisspelt];

/**
 * The attributes of `audio`, which `video` extends.
 */
const media: readonly string[] = [
  ...structural,
  "autoplay",
  "controls",
  "crossorigin",
  "loop",
  "mediagroup",
  "muted",
  "preload",
  "src",
];

/**
 * The attributes of a table cell, `td` or `th`.
 */
const cell: readonly string[] = [
  ...structural,
  "abbr",
  "align",
  "axis",
  "colspan",
  "headers",
  "rowspan",
  "scope",
  "valign",
];

/**
 * The elements whose attributes are {@link textual}.
 */
const textualTags: readonly string[] = [
  "abbr",
  "acronym",
  "address",
  "b",
  "big",
  "cite",
  "code",
  "dd",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "kbd",
  "ol",
  "p",
  "pre",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "tt",
  "ul",
  "var",
];

/**
 * The elements whose attributes are {@link structural}.
 */
const structuralTags: readonly string[] = [
  "article",
  "aside",
  "bdi",
  "caption",
  "figcaption",
  "figure",
  "footer",
  "header",
  "label",
  "li",
  "nav",
  "picture",
  "rb",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "section",
  "summary",
  "tbody",
  "tfoot",
  "thead",
  "tr",
];

/**
 * The rows of {@link htmlSubset}: each element with the attributes the XSD declares on it.
 */
const subsetRows: readonly (readonly [tag: string, attributes: readonly string[]])[] = [
  ...textualTags.map((tag) => [tag, textual] as const),
  ...structuralTags.map((tag) => [tag, structural] as const),
  ["a", [...textual, "href", "type"]],
  ["audio", media],
  ["bdo", [...structural, "title"]],
  ["blockquote", [...textual, "cite"]],
  ["br", [...empty, "xml:base"]],
  ["col", [...empty, "span", "xml:base"]],
  ["colgroup", [...structural, "span"]],
  ["details", [...structural, "open"]],
  ["hr", [...empty, "xml:base"]],
  ["img", [...empty, "alt", "height", "longdesc", "src", "width", "xml:base"]],
  ["object", [...textual, "data", "height", "type", "width"]],
  ["param", ["name", "type", "value", "valuetype"]],
  ["q", [...textual, "cite"]],
  ["source", [...empty, "media", "sizes", "src", "srcset", "type"]],
  ["table", [...textual, "summary"]],
  ["td", cell],
  ["template", []],
  ["th", cell],
  ["track", [...empty, "default", "kind", "src", "srclang"]],
  ["video", [...media, "height", "poster", "width"]],
];

/**
 * The XSD's HTML subset, the content emitter's second line: each element the XSD declares whose
 * name does not begin with `qti-`, mapped to the attributes the XSD declares on it by name, the
 * attribute wildcard excluded. The walk emits nothing else.
 *
 * Transcribed by hand from the cached XSD, and kept small so a browser render does not carry the
 * generated tables. Every name is lower case, as the XSD writes it. `xml:lang` and `xml:base` are
 * named as the model names attributes in the XML namespace. The tables' test pins this map to the
 * tables generated from the same XSD.
 *
 * @see ~/.cache/gr8des/qti3/xsd/imsqti_asiv3p0p1_v1p0.xsd (sha256 `bd82f6df…`), its 76 elements
 *   from `a` to `video`
 */
export const htmlSubset: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  subsetRows.map(([tag, attributes]) => [tag, new Set(attributes)]),
);

/**
 * Tell whether the second line admits an attribute on an element: the XSD declares it there by
 * name, or it is ARIA's shortcuts attribute on an element that declares the misspelling.
 *
 * @param declared The attributes the XSD declares on the element.
 * @param name The attribute's name as the payload holds it.
 * @returns Whether the attribute is emitted.
 */
const admits = (declared: ReadonlySet<string>, name: string): boolean =>
  declared.has(name) || (name === keyShortcuts && declared.has(keyShortcutsMisspelt));

/**
 * Text that holds whitespace only, which the HTML parser keeps in place between table rows.
 */
const blank = /^[\t\n\f\r ]*$/u;

/**
 * What the walk carries from the payload and the state into every node, and where those nodes
 * stand.
 */
interface Walk {
  readonly assetBase: string;
  /**
   * The amount added to an authored heading's level, from {@link headingOffsetOf}.
   */
  readonly headingOffset: number;
  readonly instance: string;
  readonly locale: Locale;
  readonly parts: Resolved;
  /**
   * Whether no node below may stand at a flow position: a `p` is open above, whose content a `div`
   * would close, or the caller placed the nodes where only phrasing content stands.
   */
  readonly phrasingOnly: boolean;
  /**
   * The position a Notice among the nodes stands at.
   */
  readonly position: Position;
  readonly renderInteraction: RenderInteraction;
}

/**
 * Give the level an authored heading renders at: its level shifted by the offset and capped at 6.
 *
 * {@link tagFor} writes this level and {@link writesMalformedHeading} judges it, so the tag the
 * emitter writes and the check `render` makes before writing it cannot disagree.
 *
 * @param level The authored heading's level, 1 to 6.
 * @param headingOffset The amount added to a heading's level, from {@link headingOffsetOf}.
 * @returns The level to write, an integer for every heading level `configure` gives.
 */
const shiftedLevel = (level: number, headingOffset: number): number =>
  Math.min(6, level + headingOffset);

/**
 * Give the tag an authored element renders as: a heading shifted by the offset and capped at `h6`
 * ({@link shiftedLevel}); any other tag unchanged.
 *
 * @param tag The authored local name.
 * @param headingOffset The amount added to a heading's level, from {@link headingOffsetOf}.
 * @returns The tag to emit.
 */
const tagFor = (tag: string, headingOffset: number): string =>
  headings.has(tag) ? `h${shiftedLevel(Number(tag.slice(1)), headingOffset)}` : tag;

/**
 * Scope a kept same-document reference as the id it names, so `#q1` still finds the authored
 * `id="q1"` after both are scoped.
 *
 * The fragment is percent-encoded as the URL parser writes it; a browser decodes it before it
 * looks for the id, so it still meets an id with characters the parser encodes. A bare `#`, which
 * names no id and takes the reader to the top of the page, stays as written.
 *
 * @param url The kept value.
 * @param instance The item instance key.
 * @returns The value with its fragment scoped, or the value itself when it is not a fragment.
 */
const scopedFragment = (url: KeptUrl, instance: string): KeptUrl =>
  url.kind === "fragment" && url.fragment !== ""
    ? { fragment: authoredId(instance, url.fragment), kind: "fragment" }
    : url;

/**
 * Write a URL attribute's value as it renders, through `url.ts` alone.
 *
 * `check` has written every value it kept in its parsed form, so classifying it again gives the
 * same classification; it is done only so {@link formatUrl} can rebase a package path onto the
 * asset base. A value `url.ts` refuses, which only a payload `check` did not secure can hold, is
 * never written; `check` places the notice for each one it drops, so none is added here.
 *
 * @param context The attribute's context, from `urlContextOf`.
 * @param value The value as the payload holds it.
 * @param walk What the walk carries: the asset base and the item instance key.
 * @returns The value to write, or none when the attribute is dropped.
 */
const urlFor = (context: UrlContext, value: string, walk: Walk): Option.Option<string> => {
  const url = classifyUrl(context, value);

  return url.kind === "dropped"
    ? Option.none()
    : Option.some(formatUrl(scopedFragment(url, walk.instance), walk.assetBase));
};

/**
 * Give one authored attribute as it renders.
 *
 * @param attribute The attribute as the model kept it.
 * @param tag The authored element's local name, which says whether the attribute is a URL.
 * @param walk What the walk carries.
 * @returns The attribute's name and value as emitted, or nothing when it is dropped: `xml:lang` as
 *   `lang`, `aria-keyshorts` as `aria-keyshortcuts`, an `id` and each id an IDREF attribute names
 *   through {@link authoredId} (an IDREF attribute that names no id is dropped), a URL through
 *   {@link urlFor}, and any other value as written.
 */
const attributeFor = (
  { name, value }: AttributePayload,
  tag: string,
  walk: Walk,
): readonly (readonly [string, string])[] => {
  if (name === "xml:lang") {
    return [["lang", value]];
  }

  if (name === keyShortcutsMisspelt) {
    return [[keyShortcuts, value]];
  }

  if (name === "id") {
    return [[name, authoredId(walk.instance, value)]];
  }

  if (idReferences.has(name)) {
    return Option.match(authoredIdrefs(walk.instance, value), {
      onNone: () => [],
      onSome: (ids) => [[name, ids]],
    });
  }

  return Option.match(urlContextOf(tag, name), {
    onNone: () => [[name, value]],
    onSome: (context) =>
      Option.match(urlFor(context, value, walk), {
        onNone: () => [],
        onSome: (url) => [[name, url]],
      }),
  });
};

/**
 * Give an authored element's attributes as they render.
 *
 * Only the attributes the second line admits are emitted, so an event handler, `style`, an
 * authored `data-slot` or `data-mode`, and any other undeclared name is dropped; `check` already
 * removes and marks every attribute only the XSD's wildcard admits, so this drop is the emitter's
 * own guard. When the author wrote both `lang` and `xml:lang`, `xml:lang` wins, as it does in HTML,
 * and when they wrote both shortcut spellings, ARIA's wins.
 *
 * @param element The element as the model kept it.
 * @param declared The attributes the XSD declares on the element, from {@link htmlSubset}.
 * @param walk What the walk carries.
 * @returns The attributes to emit.
 */
const attributesFor = (
  { attributes, tag }: ElementPayload,
  declared: ReadonlySet<string>,
  walk: Walk,
): Attributes => {
  const admitted = attributes.filter(({ name }) => admits(declared, name));
  const names = new Set(admitted.map(({ name }) => name));
  const shadowed = (name: string): boolean =>
    (name === "lang" && names.has("xml:lang")) ||
    (name === keyShortcutsMisspelt && names.has(keyShortcuts));

  return Object.fromEntries(
    admitted
      .filter(({ name }) => !shadowed(name))
      .flatMap((attribute) => attributeFor(attribute, tag, walk)),
  );
};

/**
 * Tell whether a node is a table row.
 *
 * @param node The node.
 * @returns Whether it is a `tr` element.
 */
const isRow = (node: Node): node is Element => node.kind === "element" && node.tag === "tr";

/**
 * Wrap each run of rows a `table` holds directly in a `tbody`, as the HTML parser would, so the
 * emitted table parses back to itself.
 *
 * A run is consecutive `tr` elements with only whitespace text between them; whitespace before the
 * first row and after the last stays outside the `tbody`.
 *
 * @param children The `table`'s emitted children.
 * @returns The children with every run of rows in its own `tbody`.
 */
const withBodies = (children: readonly Node[]): readonly Node[] => {
  const result: Node[] = [];
  let rows: Node[] = [];
  let gap: Node[] = [];
  const close = (): void => {
    if (rows.length > 0) {
      result.push(h("tbody", {}, rows));
    }

    // A gap holds one node per comment the reader dropped, so it can outgrow a spread's arguments.
    for (const node of gap) {
      result.push(node);
    }

    rows = [];
    gap = [];
  };

  for (const child of children) {
    if (isRow(child)) {
      for (const node of gap) {
        rows.push(node);
      }

      rows.push(child);
      gap = [];
    } else if (rows.length > 0 && child.kind === "text" && blank.test(child.text)) {
      gap.push(child);
    } else {
      close();
      result.push(child);
    }
  }

  close();

  return result;
};

/**
 * Construct the Notice part for a notice `check` handed in: a note naming the feature in the
 * locale's text, through the embedder's replacement when there is one.
 *
 * @param notice The notice's payload.
 * @param walk What the walk carries: the position, the locale and the part overrides.
 * @returns The Notice, a `span` at a phrasing position and a `div` at a flow position by default,
 *   or the refusal of its replacement.
 */
const noticeOf = (notice: NoticePayload, walk: Walk): Result.Result<Element, PartSwapRefused> =>
  itemPart(
    walk.parts,
    "notice",
    { role: "note" },
    [text(message(walk.locale, "notice", { feature: notice.feature }))],
    { position: walk.position },
  );

/**
 * Give the walk below an authored element: its children stand where the element's content stands.
 *
 * @param walk The walk at the element.
 * @param tag The element's authored local name.
 * @returns The walk for the element's children.
 */
const below = (walk: Walk, tag: string): Walk => ({
  ...walk,
  phrasingOnly: walk.phrasingOnly || tag === "p",
  position: positionUnder(tag, walk.phrasingOnly),
});

/**
 * Emit body nodes, in order.
 *
 * @param nodes The payload nodes.
 * @param walk What the walk carries.
 * @returns The emitted nodes, without those the second line drops, or the first refusal of a part
 *   swap.
 */
const nodesOf = (
  nodes: readonly PayloadNode[],
  walk: Walk,
): Result.Result<readonly Node[], PartSwapRefused> =>
  Result.map(
    // oxlint-disable-next-line eslint/no-use-before-define -- `nodesOf` and `nodeOf` are mutually recursive, as elements nest; the call runs only after both are defined.
    Result.all(nodes.map((node) => nodeOf(node, walk))),
    (emitted) => emitted.flat(),
  );

/**
 * Emit an authored HTML element and its subtree.
 *
 * @param element The element's payload.
 * @param declared The attributes the XSD declares on the element, from {@link htmlSubset}.
 * @param walk What the walk carries.
 * @returns The element as it renders, or the first refusal of a part swap.
 */
const elementOf = (
  element: ElementPayload,
  declared: ReadonlySet<string>,
  walk: Walk,
): Result.Result<Element, PartSwapRefused> =>
  Result.map(nodesOf(element.children, below(walk, element.tag)), (children) =>
    h(
      tagFor(element.tag, walk.headingOffset),
      attributesFor(element, declared, walk),
      element.tag === "table" ? withBodies(children) : children,
    ),
  );

/**
 * Emit one body node.
 *
 * @param node The payload node.
 * @param walk What the walk carries.
 * @returns The node as it renders, none when the second line drops it (an element outside
 *   {@link htmlSubset}, or a node of no kind the payload defines), or the refusal of a part swap.
 */
const nodeOf = (node: PayloadNode, walk: Walk): Result.Result<readonly Node[], PartSwapRefused> => {
  switch (node.kind) {
    case "element": {
      return Option.match(Option.fromUndefinedOr(htmlSubset.get(node.tag)), {
        onNone: () => Result.succeed([]),
        onSome: (declared) => Result.map(elementOf(node, declared, walk), (element) => [element]),
      });
    }
    case "text": {
      return Result.succeed([text(node.text)]);
    }
    case "notice": {
      return Result.map(noticeOf(node, walk), (notice) => [notice]);
    }
    case "choice":
    case "extended-text":
    case "inline-choice":
    case "text-entry": {
      return Result.map(walk.renderInteraction(node), (root) => [root]);
    }
    default: {
      // Only a payload that lost its type on the way here holds another kind.
      node satisfies never;

      return Result.succeed([]);
    }
  }
};

/**
 * Collect the levels of the headings the emitter writes among payload nodes, in document order: a
 * heading the HTML subset keeps, below elements it keeps, and in an interaction's Prompt, choice
 * content or Inline Choice Label, which {@link emitNodes} writes with the same shift. An Inline
 * Choice's choice content is written as option text, never as nodes, so it gives none. A heading
 * below an element outside {@link htmlSubset} is dropped with that element, so it is left out.
 *
 * @param nodes The payload nodes.
 * @returns Each written heading's authored level, 1 to 6.
 */
const headingLevelsIn = (nodes: readonly PayloadNode[]): readonly number[] =>
  nodes.flatMap((node): readonly number[] => {
    switch (node.kind) {
      case "element": {
        if (!htmlSubset.has(node.tag)) {
          return [];
        }

        const nested = headingLevelsIn(node.children);

        return headings.has(node.tag) ? [Number(node.tag.slice(1)), ...nested] : nested;
      }
      case "choice": {
        return headingLevelsIn([
          ...Option.getOrElse(node.prompt, () => []),
          ...node.choices.flatMap(({ content }) => content),
        ]);
      }
      case "extended-text": {
        return headingLevelsIn(Option.getOrElse(node.prompt, () => []));
      }
      case "inline-choice": {
        return headingLevelsIn(Option.getOrElse(node.label, () => []));
      }
      case "notice":
      case "text":
      case "text-entry": {
        return [];
      }
      default: {
        // Only a payload that lost its type on the way here holds another kind.
        node satisfies never;

        return [];
      }
    }
  });

/**
 * The level of each payload body's shallowest written heading, kept from the first walk over the
 * body for every later one.
 *
 * One render starts a walk for the body and one for each Prompt and each choice's content, and
 * each needs this level. Reading the whole body for each walk would make a render's time grow with
 * the square of its choices and Prompts, so the body is read once.
 *
 * An entry never goes stale. It is keyed by the body array's identity, and a body never changes
 * once built: `payload` builds a fresh body for every render, every payload field is `readonly`,
 * and the emitter writes to none of them. So the level read from a body stays that body's level
 * for as long as the body lives, and the weak key lets the entry go with it.
 */
const shallowestLevels = new WeakMap<readonly PayloadNode[], number>();

/**
 * Give the level of a body's shallowest written heading, 1 when it writes none: read from the
 * body on the first call for it, and from {@link shallowestLevels} after.
 *
 * @param body The payload's body, which holds every heading the emitter writes for the item.
 * @returns The least level {@link headingLevelsIn} gives for the body, or 1 when it gives none.
 */
const shallowestLevelOf = (body: readonly PayloadNode[]): number => {
  const known = shallowestLevels.get(body);

  if (known !== undefined) {
    return known;
  }

  const levels = headingLevelsIn(body);
  let shallowest = levels[0] ?? 1;

  for (const level of levels) {
    shallowest = Math.min(shallowest, level);
  }

  shallowestLevels.set(body, shallowest);

  return shallowest;
};

/**
 * Give the amount every authored heading of an item shifts by: the item's shallowest written
 * heading lands at the configured heading level, and every other heading keeps its distance from
 * it, so an item that starts at `h2` or `h3` (a delivery page owns `h1`) still starts at the
 * heading level. An item that starts at `h1` shifts as it always did, by the heading level less
 * one; an item with no heading has none to shift. The body is read once, however many walks of
 * one render ask ({@link shallowestLevelOf}).
 *
 * @param body The payload's body, which holds every heading the emitter writes for the item.
 * @param headingLevel The configured heading level, 1 to 6.
 * @returns The offset {@link tagFor} adds to an authored level.
 */
const headingOffsetOf = (body: readonly PayloadNode[], headingLevel: number): number =>
  headingLevel - shallowestLevelOf(body);

/**
 * Tell whether a body writes a heading whose tag names no heading level, because its level, shifted
 * to the configured heading level and capped at 6 as {@link tagFor} computes it, is not an
 * integer.
 *
 * `render` asks it before it writes an item (`InvalidHeadingLevel` in `#plate/render.ts`), so a
 * hand-built configuration's heading level of `NaN`, `-Infinity` or a fraction below 6 is refused
 * where the emitter would write a tag such as `h5.5`. It reads the headings
 * {@link headingLevelsIn} gives (the body's, a Prompt's, a choice's content and an Inline Choice's
 * Label, never one below an element the second line drops) and applies {@link shiftedLevel}, the
 * function `tagFor` writes with, rather than a second expression for the rule, so the two cannot
 * disagree. So a level above 6 and `Infinity` are not refused, since they cap at `h6`, and a body
 * with no heading is never refused. At its corners it follows `tagFor`, not a test of the capped
 * heading level alone: where floating-point rounding makes the shifted level an integer (a heading
 * level of `1e-17` writes `h0`, as 0 does) it is false, and so it is for an integer level at or
 * below -10^21, whose tag `h-1e+21` the serialiser then refuses as a `MalformedTagName`.
 *
 * @param body The payload's body, which holds every heading the emitter writes for the item.
 * @param headingLevel The configured heading level, as the emit state holds it.
 * @returns Whether a heading the body writes would get a level that is not an integer.
 */
export const writesMalformedHeading = (
  body: readonly PayloadNode[],
  headingLevel: number,
): boolean => {
  const headingOffset = headingOffsetOf(body, headingLevel);

  return headingLevelsIn(body).some(
    (level) => !Number.isInteger(shiftedLevel(level, headingOffset)),
  );
};

/**
 * Start a walk over nodes that stand at a position.
 *
 * @param payload The payload, which gives the item instance key and the body the heading offset is
 *   read from.
 * @param state The emit state, which gives the locale, the heading level, the asset base and the
 *   part overrides.
 * @param renderInteraction The render function for an interaction among the nodes.
 * @param position Where the nodes stand. At a phrasing position nothing below them stands at a
 *   flow position either, since the walk cannot see whether a `p` is open above.
 * @returns The walk.
 */
const walkOf = (
  payload: Payload,
  state: EmitState,
  renderInteraction: RenderInteraction,
  position: Position,
): Walk => ({
  assetBase: state.assetBase,
  headingOffset: headingOffsetOf(payload.body, state.headingLevel),
  instance: payload.instance,
  locale: state.locale,
  parts: state.parts,
  phrasingOnly: position === "phrasing",
  position,
  renderInteraction,
});

/**
 * Emit payload nodes from anywhere in the body, such as a Prompt's or a choice's content, with the
 * same id scoping, heading shift, URLs and Notice part as the body itself.
 *
 * The nodes stand at a phrasing position, so a Notice among them, or anywhere below them, is a
 * `span`: content inside a Label or a `legend` holds phrasing content only.
 *
 * @param nodes The payload nodes.
 * @param payload The payload, which gives the item instance key.
 * @param state The emit state.
 * @param renderInteraction The render function for an interaction among the nodes.
 * @returns The emitted nodes, in order, or the first refusal of a part swap.
 */
export const emitNodes = (
  nodes: readonly PayloadNode[],
  payload: Payload,
  state: EmitState,
  renderInteraction: RenderInteraction,
): Result.Result<readonly Node[], PartSwapRefused> =>
  nodesOf(nodes, walkOf(payload, state, renderInteraction, "phrasing"));

/**
 * Emit the item body: the payload's body nodes as the output tree's nodes, in order.
 *
 * The body stands in the item Root, which takes flow content, so a Notice directly in the body is
 * a `div`.
 *
 * @param payload The payload, whose body the walk reads.
 * @param state The emit state.
 * @param renderInteraction The render function each interaction of the body is handed to.
 * @returns The body's nodes, or the first refusal of a part swap.
 */
export const emitBody = (
  payload: Payload,
  state: EmitState,
  renderInteraction: RenderInteraction,
): Result.Result<readonly Node[], PartSwapRefused> =>
  nodesOf(
    payload.body,
    walkOf(payload, state, renderInteraction, positionUnder(rowFor("item", "root").element, false)),
  );
