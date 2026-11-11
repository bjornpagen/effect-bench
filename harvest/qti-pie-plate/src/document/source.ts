/**
 * The source view: an XML document as the renderer reads it, the namespaces its readers compare
 * against, and the walk that gives every element its path.
 *
 * The validator, the item model and the table generator read a {@link SourceDocument}. The
 * validator and the item model locate what they find with the paths {@link walk} and
 * {@link attributePath} build, so every refusal and every unsupported feature names a place the
 * same way. The shared reader's own types stay inside the adapter that builds the view. The module
 * also exports small constructors with which a test hand-builds a document.
 *
 * @module
 */
import { Option } from "effect";

/**
 * The namespace of QTI 3.0's assessment content, whose elements a path names by local name alone.
 */
export const qtiNamespace = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The namespace the `xml` prefix is bound to, which an attribute path spells `@xml:<local>`.
 */
export const xmlNamespace = "http://www.w3.org/XML/1998/namespace";

/**
 * The namespace of namespace declarations, which the shared reader keeps as attributes.
 */
export const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

/**
 * The XML Schema instance namespace of `xsi:schemaLocation` and `xsi:type`.
 */
export const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";

/**
 * The XML Schema namespace the QTI XSD's own elements are in.
 */
export const xsdNamespace = "http://www.w3.org/2001/XMLSchema";

/**
 * The MathML namespace, which QTI imports for `math` in an item body.
 */
export const mathmlNamespace = "http://www.w3.org/1998/Math/MathML";

/**
 * The SSML 1.1 namespace, which QTI imports for speech markup.
 */
export const ssmlNamespace = "http://www.w3.org/2001/10/synthesis";

/**
 * The XInclude namespace, which QTI imports for `xi:include`.
 */
export const xincludeNamespace = "http://www.w3.org/2001/XInclude";

/**
 * An XML document as the renderer reads it: where it came from and its root element.
 *
 * This is the renderer's own input view, which the validator, the model builder and the table
 * generator walk; the shared reader's types stay inside the adapter that builds it.
 */
export interface SourceDocument {
  /**
   * The document's location as the host named it, which every refusal of it carries.
   */
  readonly location: string;
  readonly root: SourceElement;
}

/**
 * An element of a source document with its name parts, attributes and children in document order.
 */
export interface SourceElement {
  readonly attributes: readonly SourceAttribute[];
  readonly children: readonly SourceChild[];
  readonly kind: "element";
  readonly local: string;
  /**
   * The resolved namespace name, or `""` when the element is in no namespace.
   */
  readonly namespace: string;
}

/**
 * An attribute of a source element, namespace declarations included, with its value as written.
 */
export interface SourceAttribute {
  readonly local: string;
  /**
   * The resolved namespace name, or `""` when the attribute is in no namespace.
   */
  readonly namespace: string;
  /**
   * The names of the unexpanded entity references in `value`, in order, empty when it has none.
   */
  readonly references: readonly string[];
  /**
   * The value in its source spelling, an unexpanded entity reference staying in its form `&name;`.
   */
  readonly value: string;
}

/**
 * A run of character data in a source element, written as plain text or as a CDATA section.
 */
export interface SourceText {
  readonly kind: "text";
  readonly text: string;
}

/**
 * A reference to an entity the document does not declare, kept by name and never expanded.
 */
export interface SourceEntity {
  readonly kind: "entity";
  readonly name: string;
}

/**
 * Anything a source element holds that the renderer reads; comments and processing instructions
 * are not part of the view.
 */
export type SourceChild = SourceElement | SourceText | SourceEntity;

/**
 * One element of a document as {@link walk} reaches it, with its element path and its parent.
 */
export interface Visit {
  readonly element: SourceElement;
  readonly parent: Option.Option<SourceElement>;
  /**
   * The element's path from the root, the location a content refusal names.
   */
  readonly path: string;
}

/**
 * Name an element as a path step, before any sibling index.
 *
 * The name is the local name for a QTI element and `{<namespace>}<local>` otherwise, an element in
 * no namespace included, so equal names mean the same namespace and local name.
 *
 * @param element The element to name.
 * @returns The element's step name.
 */
const stepName = (element: SourceElement): string =>
  element.namespace === qtiNamespace ? element.local : `{${element.namespace}}${element.local}`;

/**
 * Report whether a child of a source element is itself an element.
 *
 * @param child A child of a source element.
 * @returns Whether `child` is an element.
 */
const isElement = (child: SourceChild): child is SourceElement => child.kind === "element";

/**
 * Build the visits of an element's element children, each with its path step appended.
 *
 * A child's step takes a 1-based `[n]` only when another child of the same parent has the same
 * step name, so a path stays readable where an element is unique and exact where it is not.
 *
 * @param visit The visit of the parent element.
 * @returns One visit per element child, in document order.
 */
const childVisits = (visit: Visit): readonly Visit[] => {
  const elements = visit.element.children.filter(isElement);
  const totals = new Map<string, number>();
  for (const element of elements) {
    const name = stepName(element);
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const positions = new Map<string, number>();
  const parent = Option.some(visit.element);

  return elements.map((element) => {
    const name = stepName(element);
    const position = (positions.get(name) ?? 0) + 1;
    positions.set(name, position);

    const step = (totals.get(name) ?? 0) > 1 ? `${name}[${position}]` : name;

    return { element, parent, path: `${visit.path}/${step}` };
  });
};

/**
 * Visit every element of a document in document order.
 *
 * A path has one step per element from the root: the local name for a QTI element and
 * `{<namespace>}<local>` otherwise, with a 1-based `[n]` only when the element has same-named
 * siblings. The walk keeps its own stack, so a deeply nested document cannot exhaust the call
 * stack.
 *
 * @param document The document to walk.
 * @yields {Visit} Each element with its path and its parent, the root first and with no parent.
 * @see {@link attributePath} for the path of one of an element's attributes.
 */
export const walk = function* walk(document: SourceDocument): Generator<Visit, void, undefined> {
  const pending: Visit[] = [
    { element: document.root, parent: Option.none(), path: stepName(document.root) },
  ];
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    yield visit;
    for (const child of childVisits(visit).toReversed()) {
      pending.push(child);
    }
  }
};

/**
 * Build the path of an attribute of the element at `elementPath`.
 *
 * The attribute's step is `@<local>` in no namespace, `@xml:<local>` in the XML namespace and
 * `@{<namespace>}<local>` otherwise.
 *
 * @param elementPath The path {@link walk} gave the attribute's element.
 * @param attribute The attribute's name parts.
 * @returns The element path followed by `/` and the attribute's step.
 */
export const attributePath = (
  elementPath: string,
  attribute: Pick<SourceAttribute, "local" | "namespace">,
): string => {
  if (attribute.namespace === "") {
    return `${elementPath}/@${attribute.local}`;
  }

  if (attribute.namespace === xmlNamespace) {
    return `${elementPath}/@xml:${attribute.local}`;
  }

  return `${elementPath}/@{${attribute.namespace}}${attribute.local}`;
};

/**
 * Construct a source document, for tests that hand-build their input.
 *
 * @param location The document's location.
 * @param root The root element.
 * @returns The document holding `root` at `location`.
 */
export const doc = (location: string, root: SourceElement): SourceDocument => ({ location, root });

/**
 * Construct a source element, in the QTI namespace unless another is given.
 *
 * @param local The element's local name.
 * @param attributes The element's attributes, none by default.
 * @param children The element's children, none by default.
 * @param namespace The element's namespace, QTI's by default.
 * @returns The element holding exactly the given name, attributes and children.
 */
export const el = (
  local: string,
  attributes: readonly SourceAttribute[] = [],
  children: readonly SourceChild[] = [],
  namespace: string = qtiNamespace,
): SourceElement => ({ attributes, children, kind: "element", local, namespace });

/**
 * Construct a source attribute, in no namespace unless another is given.
 *
 * @param local The attribute's local name.
 * @param value The value in its source spelling.
 * @param namespace The attribute's namespace, none by default.
 * @param references The entity references the value holds unexpanded, none by default.
 * @returns The attribute holding exactly the given name, value and references.
 */
export const attr = (
  local: string,
  value: string,
  namespace = "",
  references: readonly string[] = [],
): SourceAttribute => ({ local, namespace, references, value });

/**
 * Construct a run of character data.
 *
 * @param value The characters as the document holds them.
 * @returns The text node holding `value`.
 */
export const text = (value: string): SourceText => ({ kind: "text", text: value });

/**
 * Construct a reference to an undeclared entity.
 *
 * @param name The entity's name, without `&` and `;`.
 * @returns The entity node naming `name`.
 */
export const entity = (name: string): SourceEntity => ({ kind: "entity", name });
