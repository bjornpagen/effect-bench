import { Array as Arr } from "effect";
import { tour } from "#crust/tour.ts";
import type { Leaf } from "#crust/tour.ts";
import type { Attribute, Element, Misc, XmlDocument } from "#crust/tree.ts";

/**
 * The namespace name that every namespace declaration's attribute is in.
 */
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

/**
 * The namespace declarations in scope, from prefix to namespace name; the default namespace is the
 * empty prefix. A prefix that is absent is not declared, and an empty name is only ever the
 * default.
 */
type Scope = ReadonlyMap<string, string>;

/**
 * Rank a UTF-16 code unit in code point order: a surrogate, half of a code point above U+FFFF,
 * ranks above every unit from U+E000 to U+FFFF, and every other unit keeps its own place.
 *
 * @param unit - The code unit.
 * @returns Its rank.
 */
const codePointRank = (unit: number): number => {
  if (unit >= 0xe0_00) {
    return unit - 0x8_00;
  }

  return unit >= 0xd8_00 ? unit + 0x20_00 : unit;
};

/**
 * Compare two strings by code point, which is the byte order of their UTF-8 form.
 *
 * The strings are read as UTF-16 code units. Two strings first differ at a unit; below U+D800 the
 * units order as their code points do, and only a surrogate, which stands for a code point above
 * U+FFFF, sorts below a unit from U+E000 to U+FFFF where its code point sorts above, which
 * {@link codePointRank} rights.
 */
const compareCodePoints = (left: string, right: string): number => {
  const shared = Math.min(left.length, right.length);

  for (let index = 0; index < shared; index += 1) {
    const difference =
      // oxlint-disable-next-line unicorn/prefer-code-point -- The order is taken unit by unit, a surrogate ranked by `codePointRank`; `codePointAt` would join a pair into a value no unit-wise step compares.
      codePointRank(left.charCodeAt(index)) - codePointRank(right.charCodeAt(index));

    if (difference !== 0) {
      return difference;
    }
  }

  return left.length - right.length;
};

/**
 * Escape `&`, `<`, `>` and CR the way canonical XML writes a text run.
 */
const escapeText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#xD;");

/**
 * Escape `&`, `<`, `"`, TAB, LF and CR the way canonical XML writes an attribute value.
 */
const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#x9;")
    .replaceAll("\n", "&#xA;")
    .replaceAll("\r", "&#xD;");

/**
 * Render an attribute value with each recorded entity reference as `&name;` and the text between
 * them escaped.
 */
const renderValue = (attribute: Attribute): string => {
  let rendered = "";
  let position = 0;

  for (const reference of attribute.references) {
    rendered += escapeAttribute(attribute.value.slice(position, reference.offset));
    rendered += `&${reference.name};`;
    position = reference.offset + reference.name.length + 2;
  }

  return rendered + escapeAttribute(attribute.value.slice(position));
};

/**
 * The scope an element's own declarations make on top of its parent's.
 */
const scopeOf = (element: Element, parent: Scope): Scope => {
  const declared = new Map(parent);

  for (const attribute of element.attributes) {
    if (attribute.namespace === xmlnsNamespace) {
      declared.set(attribute.prefix === "xmlns" ? attribute.local : "", attribute.value);
    }
  }

  return declared;
};

/**
 * The ` xmlns` declarations an element renders: each one in scope that changes its prefix's binding
 * from its parent's, the default first, then by prefix. A prefix the parent's scope holds changes
 * when its name does; one it does not hold is bound to no namespace there, as an empty name binds
 * it, so it changes only to a name that is not empty. So an empty default is rendered only when the
 * parent's default is not empty.
 */
const renderNamespaces = (scope: Scope, parent: Scope): string =>
  [...scope]
    .filter(([prefix, name]) => (parent.has(prefix) ? parent.get(prefix) !== name : name !== ""))
    .toSorted(([left], [right]) => compareCodePoints(left, right))
    .map(([prefix, name]) => (prefix === "" ? ` xmlns="${name}"` : ` xmlns:${prefix}="${name}"`))
    .join("");

/**
 * Render the attribute axis: the non-declaration attributes by namespace name, then local name.
 */
const renderAttributes = (element: Element): string =>
  element.attributes
    .filter((attribute) => attribute.namespace !== xmlnsNamespace)
    .toSorted(
      (left, right) =>
        compareCodePoints(left.namespace, right.namespace) ||
        compareCodePoints(left.local, right.local),
    )
    .map((attribute) => ` ${attribute.qname}="${renderValue(attribute)}"`)
    .join("");

/**
 * Render a comment or a processing instruction.
 */
const renderMisc = (item: Misc): string =>
  item.kind === "comment"
    ? `<!--${item.text}-->`
    : `<?${item.target}${item.data === "" ? "" : ` ${item.data}`}?>`;

/**
 * Render a node that holds no other node: a text run escaped, an entity reference as `&name;`, or
 * a comment or a processing instruction.
 *
 * @param node - The node to render.
 * @returns The node's canonical form.
 */
const renderLeaf = (node: Leaf): string => {
  if (node.kind === "text") {
    return escapeText(node.value);
  }

  if (node.kind === "entityRef") {
    return `&${node.name};`;
  }

  return renderMisc(node);
};

/**
 * The scope above the root element: the `xml` prefix, which Namespaces in XML 1.0 section 3 binds
 * to its namespace by definition, and nothing else. So an element's written declaration of `xml`
 * to that name gives no name its parent's scope lacks, and is never rendered, as Canonical XML 1.0
 * section 2.3 omits the namespace node "with local name xml, which defines the xml prefix, if its
 * string value is http://www.w3.org/XML/1998/namespace".
 */
const outermost: Scope = new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);

/**
 * Render an element, its namespace axis, its attribute axis and its children, always with a
 * separate end tag.
 *
 * The element is rendered by its {@link tour}, so a tree of any depth or width renders without
 * recursion. The scopes start from the {@link outermost} one, each open pushes the scope the element
 * makes and each close pops it, so every element renders its namespace axis against the scope on
 * top, its parent's, or the outermost for the root. The tour closes each element it opens, so the
 * outermost scope is never popped.
 *
 * @param root - The element to render.
 * @returns The element's canonical form.
 */
const renderElement = (root: Element): string => {
  const rendered: string[] = [];
  const opened: Arr.NonEmptyArray<Scope> = [outermost];
  for (const step of tour(root)) {
    if (step.kind === "leaf") {
      rendered.push(renderLeaf(step.node));
    } else if (step.kind === "close") {
      opened.pop();
      rendered.push(`</${step.element.qname}>`);
    } else {
      const parent = Arr.lastNonEmpty(opened);
      const scope = scopeOf(step.element, parent);
      opened.push(scope);
      rendered.push(
        `<${step.element.qname}${renderNamespaces(scope, parent)}${renderAttributes(step.element)}>`,
      );
    }
  }

  return rendered.join("");
};

/**
 * Canonicalize a document as Canonical XML 1.0 with comments, in UTF-8.
 *
 * One extension of the specification: an entity the document never declares stays a reference, so
 * an `EntityRef` child renders as `&name;` and an attribute's recorded references render as
 * `&name;` unescaped at their offsets. The XML declaration and the DOCTYPE are dropped, and every
 * prolog item is followed, and every epilog item preceded, by a line feed.
 *
 * @param doc - The document to canonicalize.
 * @returns The canonical form's bytes.
 */
export const canonicalize = (doc: XmlDocument): Uint8Array => {
  const prolog = doc.prolog.map((item) => `${renderMisc(item)}\n`).join("");
  const epilog = doc.epilog.map((item) => `\n${renderMisc(item)}`).join("");

  return new TextEncoder().encode(`${prolog}${renderElement(doc.root)}${epilog}`);
};
