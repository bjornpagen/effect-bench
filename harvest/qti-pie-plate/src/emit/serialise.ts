import { Data, Option, Result } from "effect";
import type { Element, Node } from "#plate/emit/node.ts";

/**
 * A destination for serialised HTML, written to in order, one chunk at a time.
 *
 * The serialiser never buffers, so a sink that forwards each chunk streams the document as it is
 * produced.
 */
export interface Sink {
  /**
   * Append the next run of HTML after every chunk already written.
   *
   * @param chunk Serialised, already escaped HTML.
   */
  readonly write: (chunk: string) => void;
}

/**
 * The refusal of a void element built with children, which HTML cannot write because a void element
 * has no end tag to close them.
 *
 * It is a {@link MarkupRefused}'s reason, returned, never thrown, so a host whose replacement part
 * reaches it recovers. It cannot occur on a checked item: the XSD's HTML
 * subset gives a void element no content, so check refuses one with children, and the content
 * emitter's second line (`htmlSubset` in `#plate/emit/body.ts`) drops what that subset does not
 * hold before the serialiser sees it. A host's replacement part is host code, not a checked item,
 * and can still reach it: I1 to I4 check the replacement's root element and the children handed to
 * it, not the root's own attributes or the rest of the replacement's subtree, so a replacement that
 * adds a `br` holding text below its root reaches it.
 */
export class VoidElementChildren extends Data.TaggedError("VoidElementChildren")<{
  /**
   * The void element's tag.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `<${this.tag}> is a void element and cannot hold children: build it with no children, or put them in a non-void element.`;
  }
}

/**
 * The refusal of an element whose tag is not a lower-case name, which the serialiser cannot write
 * without the tag ending early or reading as another element.
 *
 * Like {@link VoidElementChildren}, it is a {@link MarkupRefused}'s reason, returned, never thrown.
 * It cannot occur on a checked item, because the second line emits only the XSD's
 * lower-case element names. A host's replacement part, which is host code and no checked item, can
 * still reach it with an element I1 to I4 do not check, below its root.
 */
export class MalformedTagName extends Data.TaggedError("MalformedTagName")<{
  /**
   * The tag as the tree spells it.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `Tag ${JSON.stringify(this.tag)} is not an element name the serialiser writes: give the element a lower-case name that starts with a letter and holds only a to z, 0 to 9 and "-".`;
  }
}

/**
 * The refusal of an attribute whose name is empty or holds a character that would end the name or
 * the tag early, so the written attribute would read back as other attributes or other markup.
 *
 * Like {@link VoidElementChildren}, it is a {@link MarkupRefused}'s reason, returned, never thrown.
 * It cannot occur on a checked item, because the second line emits only the
 * attributes the XSD declares by name. A host's replacement part, which is host code and no checked
 * item, can still reach it on its root's own attributes or below its root, which I1 to I4 do not
 * check.
 */
export class MalformedAttributeName extends Data.TaggedError("MalformedAttributeName")<{
  /**
   * The attribute name as the tree spells it.
   */
  readonly attribute: string;

  /**
   * The tag of the element that carries the attribute.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `Attribute name ${JSON.stringify(this.attribute)} on <${this.tag}> cannot be written as HTML: give the attribute a non-empty name with no whitespace, quote, apostrophe, ">", "/", "=" or control character.`;
  }
}

/**
 * The refusal of a raw-text element built with children, whose content HTML reads with no character
 * reference decoded, so no escaping writes a child that reads back as itself.
 *
 * Like {@link VoidElementChildren}, it is a {@link MarkupRefused}'s reason, returned, never thrown.
 * It cannot occur on a checked item, because the XSD's HTML subset holds no raw-text
 * element, so the second line drops them all. A host's replacement part, which is host code and no
 * checked item, can still reach it: one that adds a `script` child holding text below its root,
 * which I1 to I4 do not check, reaches it.
 */
export class RawTextChildren extends Data.TaggedError("RawTextChildren")<{
  /**
   * The raw-text element's tag.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `<${this.tag}> is a raw-text element, whose content HTML reads without decoding character references, so the serialiser cannot escape it: build it with no children.`;
  }
}

/**
 * The refusal of an escapable raw-text element (`textarea`, `title`) built with an element child,
 * which HTML would read back as text rather than as an element.
 *
 * Its text children are written escaped, as anywhere else. Like {@link VoidElementChildren}, it is
 * a {@link MarkupRefused}'s reason, returned, never thrown. It cannot occur on a checked item,
 * because the XSD's HTML subset holds neither element, so the second line drops them, and the parts
 * that build a `textarea` give it text only. A host's replacement part, which is host code and no
 * checked item, can still reach it: one that adds `<textarea><b/></textarea>` below its root, which
 * I1 to I4 do not check, reaches it.
 */
export class EscapableRawTextElementChild extends Data.TaggedError("EscapableRawTextElementChild")<{
  /**
   * The tag of the element child.
   */
  readonly child: string;

  /**
   * The escapable raw-text element's tag.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `<${this.tag}> holds only text, and HTML would read its child <${this.child}> as text: build <${this.tag}> with text children only.`;
  }
}

/**
 * The refusal of a `plaintext` element, whose start tag makes HTML read the whole rest of the
 * document as its text, so nothing written after it reads back as written.
 *
 * It is refused with or without children, because what follows it is out of the serialiser's sight.
 * Like {@link VoidElementChildren}, it is a {@link MarkupRefused}'s reason, returned, never thrown.
 * It cannot occur on a checked item, because the XSD's HTML subset holds no
 * `plaintext` element, so the second line drops it. A host's replacement part, which is host code
 * and no checked item, can still reach it with a `plaintext` element below its root, which I1 to I4
 * do not check.
 */
export class PlaintextElement extends Data.TaggedError("PlaintextElement") {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  // oxlint-disable-next-line eslint/class-methods-use-this -- A field would be an own property of the error; the other refusals' messages read their fields, and this one has none.
  override get message(): string {
    return "<plaintext> makes HTML read the rest of the document as its text, so the serialiser never writes it: build the text in another element, such as <pre>.";
  }
}

/**
 * The refusal of an attribute whose name starts with `on` in any case, which HTML reads as an
 * event-handler attribute and runs as script.
 *
 * No part, emitter or runtime writes one. Like {@link VoidElementChildren}, it is a
 * {@link MarkupRefused}'s reason, returned, never thrown. It cannot occur on a checked item, because
 * the second line emits only the attributes the XSD declares by name, and it declares no event
 * handler. A host's replacement part, which is host code and no checked item, can still reach it:
 * I1 to I4 do not check the root's own attributes, so a replacement that returns `h("div", {
 * onclick: "x" }, children)` reaches it.
 */
export class EventHandlerAttribute extends Data.TaggedError("EventHandlerAttribute")<{
  /**
   * The attribute name as the tree spells it.
   */
  readonly attribute: string;

  /**
   * The tag of the element that carries the attribute.
   */
  readonly tag: string;
}> {
  /**
   * The refusal and what to change in the code that built the tree, in one line.
   */
  override get message(): string {
    return `Attribute ${JSON.stringify(this.attribute)} on <${this.tag}> names an event handler, which the serialiser never writes: remove it, and attach behaviour with addEventListener instead.`;
  }
}

/**
 * Why the serialiser refused an element: one of the seven rules an element must keep for HTML to
 * write it so that it reads back as the same tree.
 */
export type MarkupRefusal =
  | EscapableRawTextElementChild
  | EventHandlerAttribute
  | MalformedAttributeName
  | MalformedTagName
  | PlaintextElement
  | RawTextChildren
  | VoidElementChildren;

/**
 * The failure of a tree that holds an element HTML cannot write so that it reads back as the same
 * tree, which {@link serialise}, {@link toHtml} and {@link toHtmlWithin} return in place of HTML.
 *
 * No checked item reaches it, as each reason's class says. A host's replacement part in the `parts`
 * option of `render`, `renderStatus` or `renderNavigation` is host code and can, so it is returned,
 * never thrown. It names the first refused element in document order.
 */
export class MarkupRefused extends Data.TaggedError("MarkupRefused")<{
  /**
   * The rule the refused element broke, with its tag and the name at fault.
   */
  readonly reason: MarkupRefusal;
}> {
  /**
   * The failure, naming the `parts` option, then the reason's message, which says what to change.
   */
  override get message(): string {
    return `A replacement in the parts option holds markup the serialiser cannot write. ${this.reason.message}`;
  }
}

/**
 * HTML's void elements, which have a start tag and never an end tag.
 *
 * @see https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
const voidElements: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * The elements after whose start tag the HTML parser drops one line feed, so content that starts
 * with a line feed needs one more written before it.
 *
 * @see https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody
 */
const lineFeedDropping: ReadonlySet<string> = new Set(["listing", "pre", "textarea"]);

/**
 * The elements whose content the HTML parser reads as text with no character reference decoded, up
 * to their end tag (`script`, `style`, `xmp`, `iframe`, `noembed`, `noframes`, and `noscript` when
 * scripting is on) or to the end of the document (`plaintext`).
 *
 * No escaping writes their content so that it reads back as written, so the serialiser refuses any
 * child of one.
 *
 * @see https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody
 */
const rawText: ReadonlySet<string> = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "xmp",
]);

/**
 * The escapable raw-text elements, whose content the HTML parser reads as text with character
 * references decoded: escaped text reads back as written, an element child reads back as text.
 *
 * @see https://html.spec.whatwg.org/multipage/syntax.html#elements-2
 */
const escapableRawText: ReadonlySet<string> = new Set(["textarea", "title"]);

/**
 * The tags the serialiser writes: a lower-case ASCII letter, then lower-case ASCII letters, digits
 * and hyphens, so no tag can end early or carry an attribute.
 */
const writableTag = /^[a-z][a-z0-9-]*$/u;

/**
 * The characters no attribute name holds: whitespace, `"`, `'`, `>`, `/`, `=` and the controls
 * (`\p{Cc}`, U+0000 to U+001F and U+007F to U+009F), each of which HTML reads as the end of the
 * name, the attribute or the tag, or which HTML forbids in a name.
 *
 * @see https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
 */
const refusedInAttributeName = /[\s"'/=>\p{Cc}]/u;

/**
 * The attribute names HTML reads as event handlers: any name that starts with `on`, in any case.
 *
 * @see https://html.spec.whatwg.org/multipage/webappapis.html#event-handler-attributes
 */
const eventHandlerName = /^on/iu;

/**
 * Escape character data for an HTML text position.
 *
 * @param value The characters as they read.
 * @returns `value` with `&`, `<` and `>` as character references.
 */
const escapeText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Escape an attribute value for a double-quoted position.
 *
 * @param value The value as it reads.
 * @returns `value` with `&`, `"`, `<` and `>` as character references.
 */
const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * Refuse an element that HTML cannot write so that it reads back as the same tree, before any of
 * its bytes are written.
 *
 * The rules are tried in this order, and the first one broken is the refusal: {@link
 * MalformedTagName} when the tag is not a lower-case letter followed by lower-case letters, digits
 * and hyphens; {@link MalformedAttributeName} when an attribute name is empty or holds whitespace,
 * a quote, an apostrophe, `>`, `/`, `=` or a control; {@link EventHandlerAttribute} when an
 * attribute name starts with `on`, in any case; {@link VoidElementChildren} when a void element has
 * children; {@link RawTextChildren} when a raw-text element has children; {@link PlaintextElement}
 * when the element is a `plaintext` element with no children; {@link EscapableRawTextElementChild}
 * when `textarea` or `title` has an element child.
 *
 * @param element The element about to be written; each descendant is checked when it is written.
 * @returns The first rule `element` breaks, or none when HTML can write it.
 */
const refuseUnwritable = (element: Element): Option.Option<MarkupRefusal> => {
  if (!writableTag.test(element.tag)) {
    return Option.some(new MalformedTagName({ tag: element.tag }));
  }

  const malformed = Object.keys(element.attrs).find(
    (name) => name === "" || refusedInAttributeName.test(name),
  );

  if (malformed !== undefined) {
    return Option.some(new MalformedAttributeName({ attribute: malformed, tag: element.tag }));
  }

  const eventHandler = Object.keys(element.attrs).find((name) => eventHandlerName.test(name));

  if (eventHandler !== undefined) {
    return Option.some(new EventHandlerAttribute({ attribute: eventHandler, tag: element.tag }));
  }

  if (element.children.length > 0 && voidElements.has(element.tag)) {
    return Option.some(new VoidElementChildren({ tag: element.tag }));
  }

  if (element.children.length > 0 && rawText.has(element.tag)) {
    return Option.some(new RawTextChildren({ tag: element.tag }));
  }

  if (element.tag === "plaintext") {
    return Option.some(new PlaintextElement());
  }

  const elementChild = escapableRawText.has(element.tag)
    ? element.children.find((child) => child.kind === "element")
    : undefined;

  return elementChild === undefined
    ? Option.none()
    : Option.some(new EscapableRawTextElementChild({ child: elementChild.tag, tag: element.tag }));
};

/**
 * Write an element's start tag, its attributes in the object's key order.
 *
 * @param element The element whose tag and attributes are written.
 * @returns The start tag, a `true` attribute as its bare name and every value double-quoted.
 */
const startTag = (element: Element): string => {
  const attributes = Object.entries(element.attrs).map(([name, value]) =>
    value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`,
  );

  return `<${element.tag}${attributes.join("")}>`;
};

/**
 * Decide whether an element's content begins with a line feed.
 *
 * An empty text node writes nothing, so the content's first character comes from the first child
 * that is an element or non-empty text.
 *
 * @param children The element's children.
 * @returns Whether the first character written for `children` is a line feed.
 */
const startsWithLineFeed = (children: readonly Node[]): boolean => {
  const first = children.find((child) => child.kind === "element" || child.text !== "");

  return first?.kind === "text" && first.text.startsWith("\n");
};

/**
 * Hand a node of the output tree to `take` as HTML, chunk by chunk, in document order, until
 * `take` refuses a chunk or an element is refused.
 *
 * It is the one walk {@link serialise} and {@link toHtmlWithin} share: each element is checked, as
 * {@link refuseUnwritable} says, before any of its chunks is handed on. Once `take` refuses a
 * chunk, or an element breaks a rule, no further chunk is made and no further node is visited, so
 * a refused element has no byte written and a refusal past the point `take` stopped is never
 * reached.
 *
 * @param node The node to write, with its descendants.
 * @param take Takes the next chunk and says whether the walk goes on.
 * @returns Whether `take` took every chunk of `node`, or the rule the first refused element in
 *   document order broke.
 */
const walk = (
  node: Node,
  take: (chunk: string) => boolean,
): Result.Result<boolean, MarkupRefusal> => {
  if (node.kind === "text") {
    return Result.succeed(take(escapeText(node.text)));
  }

  const refusal = refuseUnwritable(node);

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  if (!take(startTag(node))) {
    return Result.succeed(false);
  }

  if (voidElements.has(node.tag)) {
    return Result.succeed(true);
  }

  if (lineFeedDropping.has(node.tag) && startsWithLineFeed(node.children) && !take("\n")) {
    return Result.succeed(false);
  }

  for (const child of node.children) {
    const walked = walk(child, take);

    if (Result.isFailure(walked) || !walked.success) {
      return walked;
    }
  }

  return Result.succeed(take(`</${node.tag}>`));
};

/**
 * Wrap the rule a refused element broke as the failure the serialiser returns.
 *
 * @param reason The rule the first refused element broke.
 * @returns The {@link MarkupRefused} that carries it.
 */
const refused = (reason: MarkupRefusal): MarkupRefused => new MarkupRefused({ reason });

/**
 * Write a node of the output tree to `sink` as HTML, chunk by chunk, in document order.
 *
 * The same tree always gives the same bytes: no whitespace is added, every non-void element (`svg`,
 * `math` and their descendants included) gets an explicit end tag and nothing is self-closed. Text
 * is written as it reads, escaped. An element HTML cannot write so that it reads back as the same
 * tree is refused before any of its bytes are written; chunks already written for its ancestors
 * stay written.
 *
 * Tag and attribute names are checked, not rewritten, and no attribute or URL is dropped here: an
 * event-handler attribute and a `plaintext` element are refused, never dropped, and what else a
 * part may carry is the emitter's to decide.
 *
 * @param node The node to write, with its descendants.
 * @param sink The destination of the chunks.
 * @returns Success once every chunk is written, or {@link MarkupRefused} for the first element, in
 *   document order, that breaks one of {@link MarkupRefusal}'s rules: a tag that is not a
 *   lower-case name ({@link MalformedTagName}), an attribute name HTML cannot write
 *   ({@link MalformedAttributeName}) or one that starts with `on` in any case
 *   ({@link EventHandlerAttribute}), a void or raw-text element with children
 *   ({@link VoidElementChildren}, {@link RawTextChildren}), a `plaintext` element
 *   ({@link PlaintextElement}), or a `textarea` or `title` with an element child
 *   ({@link EscapableRawTextElementChild}).
 */
export const serialise = (node: Node, sink: Sink): Result.Result<void, MarkupRefused> => {
  const walked = walk(node, (chunk) => {
    sink.write(chunk);

    return true;
  });

  return Result.isFailure(walked) ? Result.fail(refused(walked.failure)) : Result.void;
};

/**
 * Write a node of the output tree as one HTML string.
 *
 * @param node The node to write, with its descendants.
 * @returns The bytes {@link serialise} writes for `node`, joined, or the {@link MarkupRefused}
 *   {@link serialise} returns for it, with none of the HTML.
 */
export const toHtml = (node: Node): Result.Result<string, MarkupRefused> => {
  const chunks: string[] = [];

  return Result.map(
    serialise(node, {
      write: (chunk) => {
        chunks.push(chunk);
      },
    }),
    () => chunks.join(""),
  );
};

/**
 * Write a node of the output tree as one HTML string, unless it passes a budget of characters.
 *
 * It counts the characters of each chunk as a string's `length` counts them (UTF-16 code units),
 * text counted as escaped, and stops at the first chunk that would pass `budget`: that chunk and
 * every node after it are never written, and no chunk past the budget is joined, so a tree too
 * large to hold as one string costs no more than the budget. HTML of exactly `budget` characters is
 * written.
 *
 * An element is checked only when the walk reaches it, so a refusal past the budget is never
 * reached and the HTML too large to hold is none, as for any other tree.
 *
 * @example
 *   toHtmlWithin(h("p", {}, [text("a & b")]), 16); // Result.succeed(Option.some("<p>a &amp; b</p>"))
 *   toHtmlWithin(h("p", {}, [text("a & b")]), 15); // Result.succeed(Option.none())
 *
 * @param node The node to write, with its descendants.
 * @param budget The most characters the HTML may hold.
 * @returns The string {@link toHtml} gives for `node` when it holds at most `budget` characters,
 *   otherwise none, or {@link MarkupRefused} for the first element written before the budget runs
 *   out that breaks one of {@link MarkupRefusal}'s rules, as {@link serialise} lists them.
 */
export const toHtmlWithin = (
  node: Node,
  budget: number,
): Result.Result<Option.Option<string>, MarkupRefused> => {
  const chunks: string[] = [];
  let written = 0;
  const walked = walk(node, (chunk) => {
    written += chunk.length;

    if (written > budget) {
      return false;
    }

    chunks.push(chunk);

    return true;
  });

  return Result.mapBoth(walked, {
    onFailure: refused,
    onSuccess: (within) => (within ? Option.some(chunks.join("")) : Option.none()),
  });
};
