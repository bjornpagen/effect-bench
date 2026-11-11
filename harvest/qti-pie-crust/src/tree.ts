import type { Option } from "effect";

/**
 * A parsed XML document: the decode label, the optional declaration and doctype, the comments and
 * processing instructions around the root element, and the root itself.
 *
 * Every `xml/` module reads and writes this one immutable shape, and none of its nodes carries a
 * source position: errors report the line and column instead.
 */
export interface XmlDocument {
  /**
   * The label the bytes were decoded under, exactly as read.
   */
  readonly charset: string;
  readonly declaration: Option.Option<XmlDeclaration>;
  /**
   * The whole `<!DOCTYPE ... >` text, kept verbatim.
   */
  readonly doctype: Option.Option<string>;
  readonly epilog: readonly Misc[];
  readonly prolog: readonly Misc[];
  readonly root: Element;
}

/**
 * An XML declaration whose pseudo-attributes are kept as written, each absent one as `None`.
 */
export interface XmlDeclaration {
  readonly encoding: Option.Option<string>;
  readonly standalone: Option.Option<string>;
  readonly version: string;
}

/**
 * An element with its name parts, its attributes and its children, all in document order.
 *
 * The tree keeps no empty-element form, because canonical XML erases it: the writer emits `<x/>`
 * for every childless element.
 */
export interface Element {
  /**
   * The attributes in document order, namespace declarations included; a declaration's `namespace`
   * is `http://www.w3.org/2000/xmlns/`.
   */
  readonly attributes: readonly Attribute[];
  readonly children: readonly Child[];
  readonly kind: "element";
  readonly local: string;
  /**
   * The resolved namespace name, or `""` when the element is in no namespace.
   */
  readonly namespace: string;
  /**
   * The namespace prefix, or `""` when the name has none.
   */
  readonly prefix: string;
  readonly qname: string;
}

/**
 * An attribute, or a namespace declaration, with its name parts and its normalized value.
 */
export interface Attribute {
  readonly local: string;
  /**
   * The resolved namespace name, or `""` when the attribute is in no namespace.
   */
  readonly namespace: string;
  /**
   * The namespace prefix, or `""` when the name has none.
   */
  readonly prefix: string;
  readonly qname: string;
  /**
   * The offset in `value` of each unexpanded entity reference, empty when the value holds none.
   */
  readonly references: readonly AttributeReference[];
  /**
   * The value as the parser left it after normalization, an unexpanded entity reference staying in
   * its lexical form `&name;`.
   */
  readonly value: string;
}

/**
 * The position and name of one unexpanded entity reference inside an attribute value.
 */
export interface AttributeReference {
  readonly name: string;
  /**
   * The offset in the attribute's `value` of the reference's `&`.
   */
  readonly offset: number;
}

/**
 * A run of character data, whether written as plain text or as a CDATA section.
 *
 * The canonicalizer and the importer treat both forms as text; `cdata` only lets the writer give
 * the run back in the form it was read.
 */
export interface Text {
  readonly cdata: boolean;
  readonly kind: "text";
  readonly value: string;
}

/**
 * A comment, holding the text between `<!--` and `-->`.
 */
export interface Comment {
  readonly kind: "comment";
  readonly text: string;
}

/**
 * A processing instruction, holding its target and the data that follows it.
 */
export interface Pi {
  readonly data: string;
  readonly kind: "pi";
  readonly target: string;
}

/**
 * A reference to an entity that the document does not declare, kept by name so the writer can give
 * it back as `&name;`.
 */
export interface EntityRef {
  readonly kind: "entityRef";
  readonly name: string;
}

/**
 * Anything an element can contain.
 */
export type Child = Element | Text | Comment | Pi | EntityRef;

/**
 * Anything allowed in the prolog or the epilog of a document, around the root element.
 */
export type Misc = Comment | Pi;
