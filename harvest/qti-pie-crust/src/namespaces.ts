import { Option, Result } from "effect";
import { qnameOf } from "#crust/names.ts";
import type { QName } from "#crust/names.ts";
import type { Attribute, Element } from "#crust/tree.ts";
import { isNamespaceName } from "#crust/uri.ts";

/**
 * The namespace name the `xml` prefix is bound to by definition (Namespaces in XML 1.0, section 3).
 */
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/**
 * The namespace name of the namespace declarations themselves, which the `xmlns` prefix is bound
 * to by definition (Namespaces in XML 1.0, section 3).
 */
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/**
 * The edition of Namespaces in XML a document is held to: 1.1 for an XML 1.1 document, 1.0 for any
 * other.
 */
export type NamespacesVersion = "1.0" | "1.1";

/**
 * Give the edition of Namespaces in XML that governs a document of an XML version.
 *
 * Namespaces in XML 1.0 "applies to XML 1.0 documents" and Namespaces in XML 1.1 "applies to XML
 * 1.1 documents" (each section 7). XML 1.1's [26] VersionNum is `1.1` alone, and XML 1.0 section
 * 2.8 has an XML 1.0 processor read a document that "specifies a 1.x version number other than
 * '1.0'" as a 1.0 document; a document that declares no version is 1.0.
 *
 * @param xmlVersion - The XML declaration's version, `1.0` when there is none.
 * @returns `1.1` for version `1.1`, `1.0` for every other.
 * @see {@link https://www.w3.org/TR/2006/REC-xml11-20060816/#NT-VersionNum | XML 1.1 (Second Edition), [26] VersionNum}
 */
export const namespacesVersionOf = (xmlVersion: string): NamespacesVersion =>
  xmlVersion === "1.1" ? "1.1" : "1.0";

/**
 * The namespace bindings in scope at an element: the default namespace, which every scope has, the
 * empty name for none, and each prefix bound, from prefix to namespace name. A prefix with no
 * binding is absent.
 */
export interface Scope {
  readonly defaultNamespace: string;
  readonly prefixes: Readonly<Record<string, string>>;
}

/**
 * The bindings in scope above the root element: no default namespace, and the `xml` and `xmlns`
 * prefixes, bound by definition.
 */
export const rootScope: Scope = {
  defaultNamespace: "",
  prefixes: { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE },
};

/**
 * Check a namespace declaration's binding against Namespaces in XML's constraint Reserved Prefixes
 * and Namespace Names (section 3), its namespace name against the grammar section 3 asks of it,
 * and, under Namespaces in XML 1.0, the constraint No Prefix Undeclaring (section 5).
 *
 * The normalized value must be "either a URI reference — the namespace name identifying the
 * namespace — or an empty string" (Namespaces in XML 1.0, section 3; RFC 3986's `URI-reference`,
 * section 2.1), or an IRI reference (Namespaces in XML 1.1, section 3; RFC 3987's `IRI-reference`).
 * The value is the one attribute-value normalization leaves (section 2.3: "replacement of XML
 * character and entity references has already been done"), so a space a character reference writes
 * is kept, and refused. A value holding a reference the reader did not expand names a namespace no
 * reader knows (XML 1.0 section 4.4.3); its grammar is not judged here.
 *
 * @param prefix - The prefix declared, empty for the default namespace.
 * @param attribute - The declaration.
 * @param attribute.references - The references its value keeps unexpanded.
 * @param attribute.value - Its normalized value.
 * @param namespaces - The edition of Namespaces in XML the document is held to.
 * @returns The violation's description; `None` when the binding is allowed.
 * @see {@link https://www.w3.org/TR/2009/REC-xml-names-20091208/#ns-decl | Namespaces in XML 1.0 (Third Edition), section 3}
 * @see {@link https://www.w3.org/TR/2006/REC-xml-names11-20060816/#ns-decl | Namespaces in XML 1.1 (Second Edition), section 3}
 */
const bindingViolation = (
  prefix: string,
  { references, value }: Pick<Attribute, "references" | "value">,
  namespaces: NamespacesVersion,
): Option.Option<string> => {
  const declaring = prefix === "" ? "the default namespace" : `the prefix ${prefix}`;
  if (prefix === "xmlns" || value === XMLNS_NAMESPACE) {
    return Option.some(
      `${declaring} is bound to ${JSON.stringify(value)}, but neither the prefix xmlns nor its namespace name may be declared (Namespaces in XML section 3)`,
    );
  }

  if ((prefix === "xml") !== (value === XML_NAMESPACE)) {
    return Option.some(
      `${declaring} is bound to ${JSON.stringify(value)}, but the prefix xml and the namespace name ${XML_NAMESPACE} are bound only to each other (Namespaces in XML section 3)`,
    );
  }

  if (value !== "" && references.length === 0 && !isNamespaceName(value, namespaces)) {
    return Option.some(
      `${declaring} is bound to ${JSON.stringify(value)}, which is no ${namespaces === "1.0" ? "URI reference (Namespaces in XML 1.0 section 3, RFC 3986)" : "IRI reference (Namespaces in XML 1.1 section 3, RFC 3987)"}; percent-encode its spaces, quotes and other characters a reference may not hold`,
    );
  }

  return prefix !== "" && value === "" && namespaces === "1.0"
    ? Option.some(
        `the prefix ${prefix} is declared empty, but an XML 1.0 document may not undeclare a prefix (Namespaces in XML 1.0 section 5)`,
      )
    : Option.none();
};

/**
 * The prefix a namespace declaration's name declares: empty for `xmlns`, the part after `xmlns:`
 * for a prefixed declaration.
 *
 * @param qname - The attribute's name as written.
 * @returns The prefix; `None` for an attribute that declares no namespace.
 */
const declaredPrefix = (qname: string): Option.Option<string> => {
  if (qname === "xmlns") {
    return Option.some("");
  }

  return qname.startsWith("xmlns:") ? Option.some(qname.slice("xmlns:".length)) : Option.none();
};

/**
 * Apply one declaration to a scope: set the default namespace to its value (an empty value names
 * none), bind its prefix to its value, or undeclare a prefix whose value is empty, which only an
 * XML 1.1 document may.
 *
 * @param scope - The scope so far.
 * @param prefix - The prefix declared, empty for the default namespace.
 * @param name - The declaration's normalized value.
 * @returns The scope with the declaration applied.
 */
const bound = (scope: Scope, prefix: string, name: string): Scope => {
  if (prefix === "") {
    return { ...scope, defaultNamespace: name };
  }

  return {
    ...scope,
    prefixes:
      name === ""
        ? Object.fromEntries(Object.entries(scope.prefixes).filter(([held]) => held !== prefix))
        : { ...scope.prefixes, [prefix]: name },
  };
};

/**
 * The scope an element's children see: its parent's, with each namespace declaration among the
 * element's attributes, written or defaulted, applied in document order.
 *
 * An empty value undeclares the default namespace, and in an XML 1.1 document a prefix
 * (Namespaces in XML 1.1, section 5); a scope no declaration changes is the parent's own object, so
 * a deep document without declarations costs no copy per element.
 *
 * @param attributes - The element's attributes.
 * @param scope - The parent's scope.
 * @param namespaces - The edition of Namespaces in XML the document is held to.
 * @returns The scope, or the first declaration's violation.
 */
const declared = (
  attributes: readonly Attribute[],
  scope: Scope,
  namespaces: NamespacesVersion,
): Result.Result<Scope, string> => {
  let next = scope;
  for (const attribute of attributes) {
    const prefix = declaredPrefix(attribute.qname);
    if (Option.isSome(prefix)) {
      const { value } = attribute;
      const violation = bindingViolation(prefix.value, attribute, namespaces);
      if (Option.isSome(violation)) {
        return Result.fail(violation.value);
      }

      next = bound(next, prefix.value, value);
    }
  }

  return Result.succeed(next);
};

/**
 * Resolve a QName's prefix in a scope, as Namespaces in XML 1.0's constraint Prefix Declared asks:
 * `xml` and `xmlns` are bound by definition, and any other prefix must be declared on the element
 * or an ancestor.
 *
 * @param name - The name's parts.
 * @param scope - The element's scope, its own declarations applied.
 * @param unprefixed - The namespace an unprefixed name is in: the default namespace for an element
 *   name, none for an attribute's.
 * @returns The namespace name; `None` when the prefix is unbound.
 */
const namespaceOf = (name: QName, scope: Scope, unprefixed: string): Option.Option<string> =>
  name.prefix === ""
    ? Option.some(unprefixed)
    : Option.fromUndefinedOr(scope.prefixes[name.prefix]);

/**
 * Resolve an element's names and its attributes' names against the scope its parent gives it,
 * every attribute it holds, written or defaulted from the attribute-list declarations, taking part.
 *
 * Namespaces in XML 1.0 section 3 says namespace declarations, "like any other XML attributes, may
 * be provided directly or by default", and XML 1.0 section 3.3.2 has a processor "behave as though
 * the attribute were present with the declared default value", so each constraint holds over the
 * attributes written and defaulted alike: the declarations bind for the element itself and its
 * content; every element and attribute name is a QName (section 7) whose prefix is declared
 * (Prefix Declared, section 5); no element is named with the prefix `xmlns` (section 3); and no two
 * attributes share an expanded name (Attributes Unique, section 6.3). A declaration is in the
 * namespace `http://www.w3.org/2000/xmlns/`, and an unprefixed attribute in none.
 *
 * Crust's reader refuses a namespace-well-formedness violation (Namespaces in XML, section 7) as a
 * well-formedness error, so a document either reader of the specifications would call not
 * well-formed is one refusal class, and pantry's rule table names one rule for a document that is
 * not readable XML.
 *
 * @param element - The element as the parser read it, its names unresolved and its attributes
 *   complete.
 * @param scope - The scope its parent gives it.
 * @param namespaces - The edition of Namespaces in XML the document is held to.
 * @returns The element with its names resolved and the scope its children see, or the first
 *   violation's description.
 * @see {@link https://www.w3.org/TR/2009/REC-xml-names-20091208/#ns-decl | Namespaces in XML 1.0 (Third Edition), section 3}
 */
export const resolved = (
  element: Element,
  scope: Scope,
  namespaces: NamespacesVersion,
): Result.Result<{ readonly element: Element; readonly scope: Scope }, string> =>
  Result.flatMap(declared(element.attributes, scope, namespaces), (inner) => {
    const name = qnameOf(element.qname);
    if (Option.isNone(name)) {
      return Result.fail(
        `the element name ${element.qname} is not a qualified name (Namespaces in XML section 7)`,
      );
    }

    if (name.value.prefix === "xmlns") {
      return Result.fail(
        `the element ${element.qname} has the prefix xmlns, which no element may have (Namespaces in XML section 3)`,
      );
    }

    const namespace = namespaceOf(name.value, inner, inner.defaultNamespace);
    if (Option.isNone(namespace)) {
      return Result.fail(
        `the prefix of element ${element.qname} is not declared (Namespaces in XML section 5)`,
      );
    }

    const attributes: Attribute[] = [];
    const expanded = new Set<string>();
    for (const attribute of element.attributes) {
      const parts = qnameOf(attribute.qname);
      if (Option.isNone(parts)) {
        return Result.fail(
          `the attribute name ${attribute.qname} of element ${element.qname} is not a qualified name (Namespaces in XML section 7)`,
        );
      }

      const uri =
        attribute.qname === "xmlns"
          ? Option.some(XMLNS_NAMESPACE)
          : namespaceOf(parts.value, inner, "");
      if (Option.isNone(uri)) {
        return Result.fail(
          `the prefix of attribute ${attribute.qname} of element ${element.qname} is not declared (Namespaces in XML section 5)`,
        );
      }

      const key = `{${uri.value}}${parts.value.local}`;
      if (expanded.has(key)) {
        return Result.fail(
          `element ${element.qname} holds two attributes named ${key} (Namespaces in XML section 6.3)`,
        );
      }

      expanded.add(key);
      attributes.push({
        ...attribute,
        local: parts.value.local,
        namespace: uri.value,
        prefix: parts.value.prefix,
      });
    }

    return Result.succeed({
      element: {
        ...element,
        attributes,
        local: name.value.local,
        namespace: namespace.value,
        prefix: name.value.prefix,
      },
      scope: inner,
    });
  });
