import { Array as Arr, Effect, Option } from "effect";
import { codePointOf } from "#crust/charset.ts";
import { EncodeError } from "#crust/errors.ts";
import { preorder, tour } from "#crust/tour.ts";
import type { Step } from "#crust/tour.ts";
import type { Attribute, Child, Element, XmlDocument, XmlDeclaration } from "#crust/tree.ts";

/**
 * How the writer treats code points above the highest one the label's encoder represents.
 */
interface WriteOptions {
  /**
   * The highest code point the encoder can carry as itself; a code point above it in a text run or
   * an attribute value becomes a numeric character reference.
   */
  readonly threshold: number;
}

/**
 * The characters an attribute value always escapes, with the reference each becomes.
 */
const attributeEscapes: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  ['"', "&quot;"],
  ["\t", "&#x9;"],
  ["\n", "&#xA;"],
  ["\r", "&#xD;"],
]);

/**
 * The text of a numeric character reference to `codePoint`.
 */
const characterReference = (codePoint: number): string =>
  `&#x${codePoint.toString(16).toUpperCase()};`;

/**
 * Whether `character` lies above the threshold; with no threshold nothing does.
 */
const isAbove = (character: string, threshold: number): boolean =>
  codePointOf(character) > threshold;

/**
 * Escape an attribute value, writing each code point above `threshold` as a character reference.
 */
const escapeAttribute = (value: string, threshold: number): string => {
  let escaped = "";

  for (const character of value) {
    escaped += isAbove(character, threshold)
      ? characterReference(codePointOf(character))
      : (attributeEscapes.get(character) ?? character);
  }

  return escaped;
};

/**
 * Render an attribute value with each recorded entity reference as `&name;` and the text between
 * them escaped.
 */
const renderValue = (attribute: Attribute, threshold: number): string => {
  let rendered = "";
  let position = 0;

  for (const reference of attribute.references) {
    rendered += escapeAttribute(attribute.value.slice(position, reference.offset), threshold);
    rendered += `&${reference.name};`;
    position = reference.offset + reference.name.length + 2;
  }

  return rendered + escapeAttribute(attribute.value.slice(position), threshold);
};

/**
 * Escape a plain text run: `&`, `<`, the `>` that ends `]]>`, and CR; code points above `threshold`
 * become character references.
 *
 * XML 1.0 section 2.4 has a `>` escaped "when it appears in the string "]]>" in content", a string
 * the content's characters make whatever text runs hold them, so a `>` that opens a run is escaped
 * after a plain run that ends `]]`.
 *
 * @param value - The run's text.
 * @param threshold - The highest code point the run writes as itself.
 * @param before - The last two characters of the plain text run written just before, empty when
 *   anything else came before.
 * @returns The run's markup.
 * @see {@link https://www.w3.org/TR/2008/REC-xml-20081126/#syntax | XML 1.0 (Fifth Edition), section 2.4}
 */
const escapeText = (value: string, threshold: number, before: string): string => {
  let escaped = "";
  let previous = before;

  for (const character of value) {
    if (isAbove(character, threshold)) {
      escaped += characterReference(codePointOf(character));
    } else if (character === "&") {
      escaped += "&amp;";
    } else if (character === "<") {
      escaped += "&lt;";
    } else if (character === ">" && previous.endsWith("]]")) {
      escaped += "&gt;";
    } else if (character === "\r") {
      escaped += "&#xD;";
    } else {
      escaped += character;
    }

    previous = (previous + character).slice(-2);
  }

  return escaped;
};

/**
 * One CDATA section; a `]]>` inside it is split across two sections so the section does not end
 * early.
 */
const section = (value: string): string =>
  `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

/**
 * Write a CDATA run. A section cannot hold a character reference, so each code point above
 * `threshold`, and each CR (a re-read turns a raw CR into a line feed, XML 1.0 section 2.11),
 * closes the section, is written as a reference, and the section reopens after it; an empty
 * section is omitted, except that a run with no characters is still one empty section.
 */
const renderCdata = (value: string, threshold: number): string => {
  let rendered = "";
  let current = "";

  for (const character of value) {
    if (isAbove(character, threshold) || character === "\r") {
      rendered += current === "" ? "" : section(current);
      rendered += characterReference(codePointOf(character));
      current = "";
    } else {
      current += character;
    }
  }

  return current === "" && rendered !== "" ? rendered : rendered + section(current);
};

/**
 * Render a node that holds no other node: a text run, a comment, a processing instruction or an
 * entity reference.
 *
 * @param node - The node to render.
 * @param threshold - The highest code point a text run writes as itself.
 * @returns The node's markup.
 */
const renderLeaf = (node: Exclude<Child, Element>, threshold: number): string => {
  if (node.kind === "text") {
    return node.cdata ? renderCdata(node.value, threshold) : escapeText(node.value, threshold, "");
  }

  if (node.kind === "comment") {
    return `<!--${node.text}-->`;
  }

  if (node.kind === "pi") {
    return `<?${node.target}${node.data === "" ? "" : ` ${node.data}`}?>`;
  }

  return `&${node.name};`;
};

/**
 * Render an element's attributes in stored order, each led by a space.
 *
 * @param element - The element whose attributes to render.
 * @param threshold - The highest code point an attribute value writes as itself.
 * @returns The attributes' markup, empty when the element has none.
 */
const renderAttributes = (element: Element, threshold: number): string =>
  element.attributes
    .map((attribute) => ` ${attribute.qname}="${renderValue(attribute, threshold)}"`)
    .join("");

/**
 * Render one step of a tour: an element's start tag with its attributes in stored order, as `<x/>`
 * when it has no children and with nothing at its close, else its end tag at its close; or a leaf.
 *
 * @param step - The step.
 * @param threshold - The highest code point a text run or an attribute value writes as itself.
 * @returns The step's markup.
 */
const renderStep = (step: Step, threshold: number): string => {
  if (step.kind === "leaf") {
    return renderLeaf(step.node, threshold);
  }

  const { element } = step;
  if (step.kind === "close") {
    return element.children.length === 0 ? "" : `</${element.qname}>`;
  }

  return `<${element.qname}${renderAttributes(element, threshold)}${element.children.length === 0 ? "/" : ""}>`;
};

/**
 * Render a node and everything below it, in document order, by its {@link tour}, so a tree of any
 * depth or width renders without recursion.
 *
 * Adjacent plain text runs are one stretch of content, so each run is escaped knowing the last two
 * characters of the plain run just before it ({@link escapeText}).
 *
 * @param node - The node to render.
 * @param threshold - The highest code point a text run or an attribute value writes as itself.
 * @returns The node's markup.
 */
const renderNode = (node: Child, threshold: number): string => {
  const parts: string[] = [];
  let before = "";
  for (const step of tour(node)) {
    if (step.kind === "leaf" && step.node.kind === "text" && !step.node.cdata) {
      parts.push(escapeText(step.node.value, threshold, before));
      before = (before + step.node.value).slice(-2);
    } else {
      parts.push(renderStep(step, threshold));
      before = "";
    }
  }

  return parts.join("");
};

/**
 * Render the XML declaration with only the pseudo-attributes it has, in the order version,
 * encoding, standalone.
 */
const renderDeclaration = (declaration: XmlDeclaration): string => {
  const encoding = Option.match(declaration.encoding, {
    onNone: () => "",
    onSome: (value) => ` encoding="${value}"`,
  });
  const standalone = Option.match(declaration.standalone, {
    onNone: () => "",
    onSome: (value) => ` standalone="${value}"`,
  });

  return `<?xml version="${declaration.version}"${encoding}${standalone}?>`;
};

/**
 * The first code point of `value` above `threshold`, or none when there is none.
 */
const firstAbove = (value: string, threshold: number): Option.Option<number> =>
  Option.map(
    Arr.findFirst(value, (character) => isAbove(character, threshold)),
    codePointOf,
  );

/**
 * An `EncodeError` for the first code point of `value` above `threshold`, or none.
 */
const unwritable = (
  value: string,
  where: EncodeError["where"],
  threshold: number,
): Option.Option<EncodeError> =>
  Option.map(
    firstAbove(value, threshold),
    (codePoint) => new EncodeError({ codePoint, threshold, where }),
  );

/**
 * The first construct of `node` itself, its children aside, that cannot carry a character
 * reference and holds a code point above `threshold`: an element's name, then each attribute's
 * name and recorded reference names in stored order.
 *
 * @param node - The node to search.
 * @param threshold - The highest code point the encoder carries as itself.
 * @returns The failure for the first such construct, or none when there is none.
 */
const findInOwn = (node: Child, threshold: number): Option.Option<EncodeError> => {
  if (node.kind === "text") {
    return Option.none();
  }

  if (node.kind === "comment") {
    return unwritable(node.text, "comment", threshold);
  }

  if (node.kind === "pi") {
    return Option.orElse(unwritable(node.target, "pi", threshold), () =>
      unwritable(node.data, "pi", threshold),
    );
  }

  if (node.kind === "entityRef") {
    return unwritable(node.name, "name", threshold);
  }

  return Option.orElse(unwritable(node.qname, "name", threshold), () =>
    Arr.findFirst(node.attributes, (attribute) =>
      Option.orElse(unwritable(attribute.qname, "name", threshold), () =>
        Arr.findFirst(attribute.references, (reference) =>
          unwritable(reference.name, "name", threshold),
        ),
      ),
    ),
  );
};

/**
 * The first construct under `node`, itself included, that cannot carry a character reference and
 * holds a code point above `threshold`, in document order.
 *
 * The node is visited by its {@link preorder}, so a tree of any depth or width is searched without
 * recursion, and the search stops at the first failure.
 *
 * @param node - The node to search.
 * @param threshold - The highest code point the encoder carries as itself.
 * @returns The failure for the first such construct, or none when there is none.
 */
const findInNode = (node: Child, threshold: number): Option.Option<EncodeError> =>
  Arr.findFirst(preorder(node), (visited) => findInOwn(visited, threshold));

/**
 * The first unwritable construct in the doctype, the prolog, the root and the epilog, in writing
 * order.
 */
const findUnwritable = (doc: XmlDocument, threshold: number): Option.Option<EncodeError> =>
  Option.orElse(
    doc.doctype.pipe(Option.flatMap((doctype) => unwritable(doctype, "doctype", threshold))),
    () =>
      Arr.findFirst([...doc.prolog, doc.root, ...doc.epilog], (node) =>
        findInNode(node, threshold),
      ),
  );

/**
 * Serialize a document: the declaration as stored, the doctype text as stored, the prolog, the root
 * and the epilog, each prolog item followed by a newline and each epilog item preceded by one.
 *
 * Without `options` every character is written as itself. With a `threshold`, a code point above it
 * in a text run or an attribute value becomes a numeric character reference (a CDATA run is closed
 * around it), and one anywhere else, the doctype text included, cannot be written, because no
 * reference can carry it there. A CR in a CDATA run is closed around and written `&#xD;`, as in a
 * text run, so a re-read keeps it.
 *
 * @param doc - The tree to serialize.
 * @param options - The threshold of the encoder that will carry the string, when it has one.
 * @returns The XML text, or an `EncodeError` naming the first construct, in document order, that
 *   holds a code point above the threshold where no character reference is possible.
 */
export const writeXml = (
  doc: XmlDocument,
  options?: WriteOptions,
): Effect.Effect<string, EncodeError> => {
  const threshold = options?.threshold ?? Number.POSITIVE_INFINITY;
  const failure = findUnwritable(doc, threshold);

  if (Option.isSome(failure)) {
    return Effect.fail(failure.value);
  }

  const declaration = Option.match(doc.declaration, {
    onNone: () => "",
    onSome: (value) => `${renderDeclaration(value)}\n`,
  });
  const doctype = Option.match(doc.doctype, {
    onNone: () => "",
    onSome: (value) => `${value}\n`,
  });
  const prolog = doc.prolog.map((misc) => `${renderNode(misc, threshold)}\n`).join("");
  const epilog = doc.epilog.map((misc) => `\n${renderNode(misc, threshold)}`).join("");

  return Effect.succeed(
    `${declaration}${doctype}${prolog}${renderNode(doc.root, threshold)}${epilog}`,
  );
};
