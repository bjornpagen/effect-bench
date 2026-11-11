/**
 * The attributes of an element, keyed by name as HTML spells them (`class`, `for`).
 *
 * A string is the attribute's value and `true` is a boolean attribute present; an absent key is an
 * absent attribute. There are no style objects, functions or event handlers, so the serialiser and
 * a React projection both map every value one to one.
 */
export type Attributes = Readonly<Record<string, string | true>>;

/**
 * An HTML, MathML or SVG element of the emitter's output tree: the one node shape every part
 * function returns, the serialiser writes and the swap merge inspects.
 */
export interface Element {
  readonly attrs: Attributes;
  readonly children: readonly Node[];
  readonly kind: "element";
  /**
   * The local name, lower case.
   */
  readonly tag: string;
}

/**
 * A run of character data in the output tree.
 *
 * Text is an object, not a string, so a swap's children check compares every child by identity.
 */
export interface Text {
  readonly kind: "text";
  /**
   * The characters as they read; the serialiser escapes them.
   */
  readonly text: string;
}

/**
 * A node of the emitter's output tree.
 *
 * There is no raw-HTML node: nothing reaches the output without the serialiser's escaping.
 */
export type Node = Element | Text;

/**
 * A part of an interaction or of the item chrome, which places the attributes its connect function
 * computed onto exactly one element, so a swap has one root to merge onto.
 *
 * @param props The attributes the part carries, computed once by its interaction.
 * @param children The nodes the part holds, which a replacement must keep.
 * @returns The part's root element.
 */
export type PartFunction<Props> = (props: Props, children: readonly Node[]) => Element;

/**
 * Construct an element of the output tree.
 *
 * `props` and `children` are kept as given, by identity, because the swap's children check (I2)
 * compares them by identity.
 *
 * @param tag The element's local name, lower case.
 * @param props The element's attributes.
 * @param children The element's child nodes, none by default.
 * @returns The element holding exactly the given tag, attributes and children.
 */
export const h = (tag: string, props: Attributes, children: readonly Node[] = []): Element => ({
  attrs: props,
  children,
  kind: "element",
  tag,
});

/**
 * Construct a text node of the output tree.
 *
 * @param value The characters, unescaped.
 * @returns The text node holding `value`.
 */
export const text = (value: string): Text => ({ kind: "text", text: value });

/**
 * Give attributes only when a condition holds, so a part's attributes read as one object literal.
 *
 * @example
 *   h("input", { type: "radio", ...when(checked, { checked: true }) });
 *   // an input carrying `checked` exactly when `checked` is true
 *
 * @param condition Whether the attributes apply.
 * @param attributes The attributes the element carries when `condition` holds.
 * @returns `attributes`, or none when `condition` is false.
 */
export const when = (condition: boolean, attributes: Attributes): Attributes =>
  condition ? attributes : {};
