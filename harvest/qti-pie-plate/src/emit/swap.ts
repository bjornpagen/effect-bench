import { Data, Result } from "effect";
import { h } from "#plate/emit/node.ts";
import type { Attributes, Element, Node, PartFunction } from "#plate/emit/node.ts";
import { allows, attributeOf, lists, splitTokens } from "#plate/emit/parts.ts";
import type { PartRow, TagClass } from "#plate/emit/parts.ts";

/**
 * The ways a replacement part function can break the swap invariant, one per refusal of I2, I3, the
 * list joint rule, the legend joint rule and the handed-content rule (`select-content`).
 *
 * @see {@link PartSwapRefused}
 */
export const swapCauses = [
  "root-not-allowed",
  "child-missing",
  "child-duplicated",
  "child-reordered",
  "list-item",
  "legend-first",
  "select-content",
] as const;

/**
 * Why a swap was refused: one of {@link swapCauses}.
 */
export type SwapCause = (typeof swapCauses)[number];

/**
 * What each refusal asks the embedder to change, beside the facts its detail names.
 */
const remedies = {
  "child-duplicated":
    "Place each node the part function receives exactly once, and build a new node for anything shown twice.",
  "child-missing":
    "Place every node the part function receives below an element of the replacement's own, in the order given; wrap them, never drop them.",
  "child-reordered": "Keep the nodes the part function receives in the order given.",
  "legend-first":
    "Place the legend Prompt as the <fieldset>'s first element child, unwrapped; wrap only the nodes after it.",
  "list-item": "Swap Choices too, or return an <li> from the Choice replacement.",
  "root-not-allowed": "Return an element the part may become as the replacement's root.",
  "select-content":
    "Place the nodes the part function receives directly under the returned root, in the order given, wrapping none and adding nothing beside them; restyle an option or a textarea through its marker.",
} satisfies { readonly [C in SwapCause]: string };

/**
 * Give what a Control's refusal at I3 asks instead of the generic remedy: a Control stays the
 * native control the interaction computed, so the ruling names the supported ways around it.
 *
 * Only the Choice interaction has an Indicator part, so only its Controls are told to swap it.
 *
 * @param interaction The interaction that owns the Control.
 * @returns The remedy for that interaction's Control.
 */
const controlRemedy = (interaction: string): string =>
  interaction === "choice-interaction"
    ? "To restyle the control use the marker; to replace its look swap Indicator; to replace its behaviour wait for the browser runtime (M3)."
    : "To restyle the control use the marker; to replace its behaviour wait for the browser runtime (M3).";

/**
 * A part's replacement that broke the swap invariant, refused when the part is emitted: `render` or
 * `renderStatus` returns it.
 *
 * The check runs on every emit, not only in development, because a replacement is host code that
 * ships. `detail` names the returned element or the child at fault; the message adds what to
 * change. It is returned through a `Result`, never thrown.
 *
 * Beside I2 and I3 it holds three joint rules: the list rule (`list-item`), the legend rule
 * (`legend-first`) and the handed-content rule (`select-content`), under which a `select`,
 * `option` or `textarea` part's replacement holds exactly the nodes handed to it. The cause keeps
 * the name it had when the rule held only the `select` and its options.
 */
export class PartSwapRefused extends Data.TaggedError("PartSwapRefused")<{
  readonly cause: SwapCause;
  readonly detail: string;
  readonly interaction: string;
  readonly part: string;
}> {
  /**
   * The part, the cause and its facts, and what to change.
   */
  override get message(): string {
    const remedy =
      this.cause === "root-not-allowed" && this.part === "control"
        ? controlRemedy(this.interaction)
        : remedies[this.cause];

    return `A part swap was refused at ${this.interaction} ${this.part} (${this.cause}): ${this.detail}. ${remedy}`;
  }
}

/**
 * The emitter handed a part's replacement the same node twice, a defect of the emitter that no
 * caller can cause.
 *
 * It cannot occur: the emitter builds each child once and hands it to one part. Only an emitter bug
 * repeats one, and identity could not then tell the replacement's fault from the emitter's, so the
 * swap check stops rather than blame the replacement. It is thrown, never returned.
 */
export class HandedNodeDefect extends Data.TaggedError("HandedNodeDefect")<{
  readonly interaction: string;
  readonly part: string;
}> {
  /**
   * The part and what to fix in the emitter.
   */
  override get message(): string {
    return `The emitter handed ${this.interaction} ${this.part} the same node twice; build each child once.`;
  }
}

/**
 * The elements each tag class admits, in words, for a root-not-allowed detail.
 */
const mayBecome = {
  any: "any element",
  button: 'a <button>, whose "type" the replacement may set',
  "choice-item": "an <li>, or a flow container such as <div> under a Choices that is not a list",
  "choice-list": "a <ul>, an <ol> or a flow container such as <div>",
  fieldset: "a <fieldset>, which groups the choices natively",
  "flow-container":
    "a flow container such as <div>, <section> or <span>, or a custom element, and never a control, link or list",
  heading: "a heading, <h1> to <h6>",
  "inline-label": "a <label>, or a phrasing container such as <span>, or a custom element",
  legend: "a <legend>, which names its <fieldset> natively",
  li: "an <li>",
  list: "a <ul>, <ol> or <menu>",
  "native-input": 'an <input>, whose "type" the interaction writes',
  option: 'an <option> with no "label", so it shows the text it holds',
  "phrasing-container": "a phrasing container such as <span>, or a custom element",
  prompt: "a <p>, or a flow or phrasing container such as <div> or <span>",
  select:
    'a <select> with no "multiple" and no "size" other than 1, a drop-down that posts one entry',
  "text-input": 'an <input> of type "text"',
  textarea: "a <textarea>",
} satisfies { readonly [C in TagClass]: string };

/**
 * Name a node of the output tree for a refusal's detail.
 *
 * @param node The node.
 * @returns The element's tag in angle brackets, with its `type`, read in any case, when it is an
 *   `input`, or the text quoted and cut to 24 characters.
 */
const describeNode = (node: Node): string => {
  if (node.kind === "text") {
    return `text ${JSON.stringify(node.text.length > 24 ? `${node.text.slice(0, 24)}…` : node.text)}`;
  }

  const type = attributeOf(node.attrs, "type");

  return node.tag === "input" && type !== undefined && type !== true
    ? `<input type=${JSON.stringify(type)}>`
    : `<${node.tag}>`;
};

/**
 * Name the child at a position among the nodes handed to a replacement.
 *
 * @param children The nodes the emitter handed over.
 * @param index The child's position, from 0.
 * @returns The child's ordinal, the count and the child's name: `child 2 of 3, <label>`.
 */
const childAt = (children: readonly Node[], index: number): string => {
  const child = children[index];

  return `child ${index + 1} of ${children.length}${child === undefined ? "" : `, ${describeNode(child)}`}`;
};

/**
 * A broken invariant found in a replacement's result, before it becomes a {@link PartSwapRefused}
 * naming the part.
 */
interface Breach {
  readonly cause: SwapCause;
  readonly detail: string;
}

/**
 * Yield, in document order, the position of each handed node found below the given nodes, without
 * entering a handed node.
 *
 * A handed node is the emitter's own by identity, so its subtree is the one the emitter built and
 * the walk stays O(n) in what the replacement added.
 *
 * @param nodes The nodes to walk, the replacement root's children first.
 * @param handed The position of each node the emitter handed over.
 * @yields {number} The position of each handed node, in the pre-order of the walk.
 */
const handedInOrder = function* handedInOrder(
  nodes: readonly Node[],
  handed: ReadonlyMap<Node, number>,
): Generator<number, void, undefined> {
  for (const node of nodes) {
    const index = handed.get(node);
    if (index !== undefined) {
      yield index;
    } else if (node.kind === "element") {
      yield* handedInOrder(node.children, handed);
    }
  }
};

/**
 * Check I3 on a replacement's root: its element is one the part's tag class admits.
 *
 * @param row The part's row.
 * @param root The replacement's root.
 * @returns The breach naming the returned element and what the part may become, or undefined
 *   when the row allows it.
 */
const checkRoot = (row: PartRow, root: Element): Breach | undefined =>
  allows(row, root)
    ? undefined
    : {
        cause: "root-not-allowed",
        detail: `the replacement returned ${describeNode(root)}, and this part may become only ${mayBecome[row.tagClass]}`,
      };

/**
 * Check I2 on a replacement's root: every node the emitter handed over appears below it exactly
 * once, by identity, in the order given.
 *
 * The root itself is not a handed node, because I1 writes onto the root and a copy would lose the
 * child's identity; a replacement that returns a handed node as its root leaves that node missing.
 *
 * @param row The part's row, which names the part a defect reports.
 * @param root The replacement's root.
 * @param children The nodes the emitter handed over.
 * @returns The first duplicated child, else the first missing one, else the first out of order, or
 *   undefined when the children hold.
 * @throws {HandedNodeDefect} When `children` holds one node twice, a defect of the emitter: identity
 *   cannot tell the two places apart, so the replacement would be blamed for the emitter's reuse.
 */
const checkChildren = (
  row: PartRow,
  root: Element,
  children: readonly Node[],
): Breach | undefined => {
  const handed = new Map(children.map((child, index) => [child, index]));
  if (handed.size !== children.length) {
    throw new HandedNodeDefect({ interaction: row.interaction, part: row.part });
  }

  const seen = new Set<number>();
  let latest = -1;
  let reordered: Breach | undefined;
  for (const index of handedInOrder(root.children, handed)) {
    if (seen.has(index)) {
      return {
        cause: "child-duplicated",
        detail: `${childAt(children, index)}, appears more than once below the returned root`,
      };
    }

    seen.add(index);
    if (index < latest && reordered === undefined) {
      reordered = {
        cause: "child-reordered",
        detail: `${childAt(children, index)}, comes after ${childAt(children, latest)}`,
      };
    }

    latest = Math.max(latest, index);
  }

  const missing = children.findIndex((_child, index) => !seen.has(index));
  if (missing !== -1) {
    return {
      cause: "child-missing",
      detail: `${childAt(children, missing)}, is not below the returned root`,
    };
  }

  return reordered;
};

/**
 * Check the legend joint rule on a replacement's root: the legend Prompt the emitter handed first
 * is the root's first element child, where a `legend` names its `fieldset`.
 *
 * I3 has already kept the root a `fieldset` and the Prompt a `legend`, and I2 has placed every
 * handed node; this rule adds that the legend sits directly under the root, before any other
 * element.
 *
 * @param root The replacement's root.
 * @param children The nodes the emitter handed over, the legend Prompt first.
 * @returns The breach naming the legend and the returned root, or undefined when the legend leads.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#the-legend-element
 */
const checkLegendFirst = (root: Element, children: readonly Node[]): Breach | undefined => {
  const [legend] = children;
  const first = root.children.find((child) => child.kind === "element");

  return legend === undefined || first === legend
    ? undefined
    : {
        cause: "legend-first",
        detail: `${childAt(children, 0)}, the legend Prompt, is not the first element child of the returned ${describeNode(root)}`,
      };
};

/**
 * The tag classes whose replacement holds exactly the nodes handed to it, as its own children in
 * order, under the handed-content rule: a `select` holds only the item's `option`s, an `option`
 * only its text, and a `textarea` only the restored answer, since a textarea's text is the value
 * it posts. A host supplies none of an item's data and none of the candidate's answer.
 */
const holdsHandedOnly: ReadonlySet<TagClass> = new Set(["option", "select", "textarea"]);

/**
 * Say where a root's child at fault sits against the nodes handed to the replacement.
 *
 * @param children The nodes the emitter handed over.
 * @param index The child's position under the returned root, from 0.
 * @returns The handed child it stands in for, or that it stands beside them, or that none were
 *   handed.
 */
const placementOf = (children: readonly Node[], index: number): string => {
  if (index < children.length) {
    return `where ${childAt(children, index)}, belongs`;
  }

  if (children.length === 0) {
    return "though it was handed no nodes";
  }

  return `beside the ${children.length} ${children.length === 1 ? "node" : "nodes"} it was handed`;
};

/**
 * Check the handed-content rule on a replacement's root: its children are the nodes handed to it,
 * by identity, in order, none wrapped (in an `optgroup`, a `div` or a `span`) and nothing beside
 * them.
 *
 * I3 has already kept the root a `select`, an `option` or a `textarea`, and I2 has placed every
 * handed node below it; this rule adds that each sits directly under the root and that the root
 * holds nothing else, so the `select` holds only the item's options, each `option` only its text,
 * and the `textarea` only the restored answer, or nothing when none is restored.
 *
 * @param root The replacement's root.
 * @param children The nodes the emitter handed over: the Placeholder and the Options, an option's
 *   text, or the restored answer's text (none when nothing is restored).
 * @returns The breach naming the root's first child at fault, or undefined when the root holds
 *   exactly the handed nodes.
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#the-select-element
 * @see https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element
 */
const checkHandedOnly = (root: Element, children: readonly Node[]): Breach | undefined => {
  const count = Math.max(root.children.length, children.length);
  let index = 0;
  while (index < count && root.children[index] === children[index]) {
    index += 1;
  }

  if (index === count) {
    return undefined;
  }

  const held = root.children[index];
  if (held === undefined) {
    return {
      cause: "select-content",
      detail: `${childAt(children, index)}, is not a child of the returned ${describeNode(root)}`,
    };
  }

  return {
    cause: "select-content",
    detail: `the returned ${describeNode(root)} holds ${describeNode(held)} as its child ${index + 1}, ${placementOf(children, index)}`,
  };
};

/**
 * Split a `class` value into its tokens, at ASCII whitespace as HTML does ({@link splitTokens}).
 *
 * @param value The attribute's value, if present.
 * @returns The tokens, none for an absent or boolean attribute.
 * @see https://html.spec.whatwg.org/multipage/dom.html#classes
 */
const classTokens = (value: string | true | undefined): readonly string[] =>
  value === undefined || value === true ? [] : splitTokens(value);

/**
 * Lower-case an attribute name's ASCII letters, as the HTML tokenizer does and nothing more.
 *
 * @param name The attribute's name as the tree spells it.
 * @returns `name` with A to Z lowered.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#attribute-name-state
 */
const asciiLower = (name: string): string =>
  name.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());

/**
 * Lay sets of attributes over one another, each later set winning, with names compared in ASCII
 * lower case, so exactly one attribute of each name survives.
 *
 * The HTML parser keeps the first of two attributes whose names match that way and drops the
 * rest, so a replacement's `NAME` written beside plate's `name` would otherwise post under the
 * replacement's name. Within one set the first spelling of a name wins, as the parser reads it and
 * as the tag classes read it; across sets a later set's attribute takes the earlier one's place,
 * under the later set's spelling.
 *
 * @param layers The sets, lowest precedence first.
 * @returns One attribute of each name, in the order each name first appears.
 */
const overlay = (...layers: readonly Attributes[]): Attributes => {
  const named = new Map<string, readonly [string, string | true]>();
  for (const layer of layers) {
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(layer)) {
      const key = asciiLower(name);
      if (!seen.has(key)) {
        seen.add(key);
        named.set(key, [name, value]);
      }
    }
  }

  return Object.fromEntries(named.values());
};

/**
 * Write a row's defaults under the attributes set over them, those attributes winning a conflict.
 *
 * @param defaults The row's defaulted attributes.
 * @param attrs The attributes written over the defaults.
 * @returns `attrs` itself when the row has no defaults, so the fast path keeps the props by
 *   identity; otherwise the defaults overlaid by `attrs`, names compared in ASCII lower case.
 */
const overDefaults = (defaults: PartRow["defaults"], attrs: Attributes): Attributes =>
  Object.keys(defaults).length === 0 ? attrs : overlay(defaults, attrs);

/**
 * The state attributes: the names whose presence is what a control posts, shows chosen or lets
 * the candidate change. Where a row's `merged` list names one, it is plate's whether plate writes
 * it or leaves it off, so a replacement cannot set that state on the part's own element: it neither
 * pre-answers a control nor takes a choice or the Placeholder away there. The rule covers a
 * control's own element, not its ancestors: a host that disables controls through a container (a
 * `fieldset disabled`, an `inert` subtree) does so as the owner of everything around them, and
 * `render`'s `disabled` option is the supported way to disable every control.
 *
 * `hidden` is merged only on the Inline Choice Option and Placeholder, where hiding an option
 * would take it from the candidate as `disabled` does.
 */
const stateAttributes: ReadonlySet<string> = new Set([
  "checked",
  "disabled",
  "hidden",
  "name",
  "readonly",
  "selected",
  "type",
  "value",
]);

/**
 * Name the attributes a swapped part must not carry beyond what its props write: each state
 * attribute the row merges that the props leave off, and, on a Label whose root is not a `label`,
 * `for`, which HTML gives a `label` alone (as the Choice's `labelAsSpan` leaves it off).
 *
 * @param row The part's row.
 * @param root The replacement's root.
 * @param props The attributes the part's connect function computed.
 * @returns The names, in lower case; the props' names are compared in ASCII lower case.
 * @see https://html.spec.whatwg.org/multipage/forms.html#attr-label-for
 */
const unwritten = (row: PartRow, root: Element, props: Attributes): ReadonlySet<string> => {
  const written = new Set(Object.keys(props).map((name) => asciiLower(name)));
  const names = row.merged.filter((name) => stateAttributes.has(name) && !written.has(name));

  return new Set(
    row.part === "label" && asciiLower(root.tag) !== "label" ? [...names, "for"] : names,
  );
};

/**
 * Leave out of a set of attributes those whose names, in ASCII lower case, are among `names`.
 *
 * @param attrs The attributes.
 * @param names The names to leave out, in lower case.
 * @returns `attrs` itself when `names` is empty, else a copy without them.
 */
const without = (attrs: Attributes, names: ReadonlySet<string>): Attributes =>
  names.size === 0
    ? attrs
    : Object.fromEntries(Object.entries(attrs).filter(([name]) => !names.has(asciiLower(name))));

/**
 * Apply I1: write every attribute of `props` onto the replacement's root, `props` winning a
 * conflict, and join `class`; under both, write the row's defaults the root leaves out.
 *
 * Every attribute the connect function computes is in `props`, so "required" means everything in
 * `props`; whatever else the root carries (`data-*`, `title`, further classes, a `type` over a
 * defaulted one, an `aria-describedby` plate writes only when invalid) stands. Absence is a prop
 * for the state attributes: a root attribute that names one of {@link stateAttributes} the row
 * merges is dropped when the props leave it off, so plate's unchecked radio, unselected option,
 * editable field and enabled button stay so on their own elements; disabling them through an
 * ancestor is the host's ({@link stateAttributes}). A Label whose root is not a `label` carries no
 * `for`, from the props or its own. Names are compared in ASCII lower case, so a root attribute
 * spelled `NAME` or `SELECTED` gives way to the props' or is dropped, rather than standing beside
 * them.
 *
 * @param root The replacement's root.
 * @param props The attributes the part carries.
 * @param row The part's row: its defaults, which the root's own attributes override, and the
 *   `merged` list whose state attributes the props own by their absence.
 * @returns A copy of `root` with the defaults, then its own attributes, then the props, one
 *   attribute of each name and none of those {@link unwritten} names, and the same children:
 *   `class` holds the props' tokens and then the root's (its `class` in any case), each once, and
 *   is absent when neither side has one.
 */
const mergeRequired = (root: Element, props: Attributes, row: PartRow): Element => {
  const dropped = unwritten(row, root, props);
  const merged = overlay(row.defaults, without(root.attrs, dropped), without(props, dropped));
  const rootClass = attributeOf(root.attrs, "class");
  if (props["class"] === undefined && rootClass === undefined) {
    return h(root.tag, merged, root.children);
  }

  const tokens = new Set([...classTokens(props["class"]), ...classTokens(rootClass)]);

  return h(root.tag, overlay(merged, { class: [...tokens].join(" ") }), root.children);
};

/**
 * Write a role onto a node, when it is an element, over a `role` it names in any case.
 *
 * @param node The node.
 * @param role The role's value.
 * @returns A copy of the element with one `role`, set to `role`, or the text node unchanged.
 */
const withRole = (node: Node, role: string): Node =>
  node.kind === "element" ? h(node.tag, overlay(node.attrs, { role }), node.children) : node;

/**
 * Copy an element's subtree with `role="listitem"` written onto each handed node, wherever the
 * replacement placed it.
 *
 * @param element The element whose children to rebuild.
 * @param handed The nodes the emitter handed over, the Choice roots.
 * @returns The rebuilt children, each handed node replaced by its updated copy.
 */
const markListItems = (element: Element, handed: ReadonlySet<Node>): readonly Node[] =>
  element.children.map((child) => {
    if (handed.has(child)) {
      return withRole(child, "listitem");
    }

    return child.kind === "element"
      ? h(child.tag, child.attrs, markListItems(child, handed))
      : child;
  });

/**
 * Check the list joint rule under a list: every Choice root is an `li`.
 *
 * @param list The list owner's root, a list element.
 * @param children The nodes the emitter handed over, the Choice roots.
 * @returns The breach naming the first Choice root that is not an `li`, or undefined.
 */
const checkListItems = (list: Element, children: readonly Node[]): Breach | undefined => {
  const stray = children.findIndex((child) => child.kind !== "element" || child.tag !== "li");

  return stray === -1
    ? undefined
    : {
        cause: "list-item",
        detail: `${childAt(children, stray)}, is a Choice root under a <${list.tag}>, which holds only <li> children`,
      };
};

/**
 * Apply the list joint rule to a list owner that is not a list: give it `role="list"` and each
 * Choice root `role="listitem"`, wherever the replacement placed them.
 *
 * @param owner The list owner's root, after I1.
 * @param children The nodes the emitter handed over, the Choice roots.
 * @returns A copy of `owner` with the list roles written over any `role` named in another case.
 */
const withListRoles = (owner: Element, children: readonly Node[]): Element =>
  h(owner.tag, overlay(owner.attrs, { role: "list" }), markListItems(owner, new Set(children)));

/**
 * Construct the refusal of a breach at a part.
 *
 * @param row The part's row, which names the interaction and the part.
 * @param breach The broken invariant.
 * @returns The refusal.
 */
const refuse = (row: PartRow, breach: Breach): PartSwapRefused =>
  new PartSwapRefused({ ...breach, interaction: row.interaction, part: row.part });

/**
 * Construct a swapped part's root: the replacement's, checked against I3, I2, for a legend owner
 * the legend joint rule, and for a `select`, `option` or `textarea` part the handed-content rule,
 * with I1 applied over the row's defaults.
 *
 * @param row The part's row.
 * @param props The attributes the part's connect function computed.
 * @param children The nodes the part holds.
 * @param replacement The embedder's part function.
 * @returns The replacement's root with `props` written over it, or the refusal of the first breach.
 * @throws {HandedNodeDefect} When `children` holds one node twice, a defect of the emitter.
 */
const swapIn = (
  row: PartRow,
  props: Attributes,
  children: readonly Node[],
  replacement: PartFunction<Attributes>,
): Result.Result<Element, PartSwapRefused> => {
  const root = replacement(props, children);
  const breach =
    checkRoot(row, root) ??
    checkChildren(row, root, children) ??
    (row.legendOwner ? checkLegendFirst(root, children) : undefined) ??
    (holdsHandedOnly.has(row.tagClass) ? checkHandedOnly(root, children) : undefined);

  return breach === undefined
    ? Result.succeed(mergeRequired(root, props, row))
    : Result.fail(refuse(row, breach));
};

/**
 * Construct a part's root, through its replacement when the embedder swapped it, holding the swap
 * invariant I1 to I4.
 *
 * Without a replacement the part takes the fast path: its default element, holding the row's
 * defaults and then `props`, and `children` by identity, with no walk. With one, the replacement's
 * root must be an element of the row's tag class (I3) and hold every handed child once, in order
 * (I2); the row's defaults go under its attributes and `props` over them (I1), so a replacement may
 * override a default but never a prop, nor set a state attribute the row merges and the props leave
 * off (`checked`, `selected`, `disabled`, `readonly`, an Option's `hidden`), and a Label whose root
 * is not a `label` carries no `for`. A legend owner (the Choice Root under the `legend` markup)
 * must keep the legend Prompt its first element child; the fast path holds it as handed. A
 * `select`, `option` or `textarea` part (the Inline Choice Control, Placeholder and Option, and the
 * Extended Text Control) must hold exactly the nodes handed to it, directly and in order, wrapping
 * none and adding nothing beside them; the fast path holds them as handed. A list owner (Choices)
 * also applies the list joint rule on either path. Every breach is a {@link PartSwapRefused} (I4),
 * returned as the `Result`'s failure.
 *
 * @example
 *   Result.map(applyPart(rowFor("item", "root"), props, body), toHtml);
 *   // the default qti-assessment-item element holding `body`, as HTML
 *
 * @param row The part's row, as `rowFor` gives it for the placement.
 * @param props The attributes the part's connect function computed, written over a replacement's.
 * @param children The nodes the part holds, which a replacement must keep.
 * @param replacement The embedder's part function, none for the default element.
 * @returns The part's root element, or the refusal of a replacement that breaks the invariant.
 * @throws {HandedNodeDefect} When a replacement is given and `children` holds one node twice, a
 *   defect of the emitter.
 */
export const applyPart = (
  row: PartRow,
  props: Attributes,
  children: readonly Node[],
  replacement?: PartFunction<Attributes>,
): Result.Result<Element, PartSwapRefused> => {
  const placed =
    replacement === undefined
      ? Result.succeed(h(row.element, overDefaults(row.defaults, props), children))
      : swapIn(row, props, children, replacement);
  if (Result.isFailure(placed) || !row.listOwner) {
    return placed;
  }

  if (!lists.has(placed.success.tag)) {
    return Result.succeed(withListRoles(placed.success, children));
  }

  const breach = checkListItems(placed.success, children);

  return breach === undefined ? placed : Result.fail(refuse(row, breach));
};
