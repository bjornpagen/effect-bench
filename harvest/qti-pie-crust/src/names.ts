import { Option } from "effect";

/**
 * The characters that may start an XML name (XML 1.0 section 2.3, `NameStartChar`), as the inside
 * of a `u`-mode character class.
 */
export const NAME_START = String.raw`:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\u{10000}-\u{EFFFF}`;

/**
 * The characters that may continue an XML name (`NameChar`), as the inside of a `u`-mode character
 * class.
 */
export const NAME_CHAR = String.raw`${NAME_START}\-.0-9·̀-ͯ‿⁀`;

/**
 * The first character of a name, as XML 1.0's [4] NameStartChar admits it.
 */
const nameStart = new RegExp(`^[${NAME_START}]`, "u");

/**
 * A name's two parts, by Namespaces in XML 1.0's [7] QName: the prefix, empty for an unprefixed
 * name, and the local part.
 */
export interface QName {
  readonly local: string;
  readonly prefix: string;
}

/**
 * Split a name the parser has read as an XML Name into its QName parts.
 *
 * A Name is a QName when it holds at most one colon, which neither begins nor ends it, and the
 * local part after it begins with a NameStartChar other than the colon ([7] to [9] and [4]
 * NCName): `a:1b` is a Name and no QName, its local part beginning with a digit.
 *
 * @param name - The name, an XML Name.
 * @returns The parts; `None` when the name is no QName.
 */
export const qnameOf = (name: string): Option.Option<QName> => {
  const colon = name.indexOf(":");
  const prefix = colon === -1 ? "" : name.slice(0, colon);
  const local = colon === -1 ? name : name.slice(colon + 1);

  return !local.includes(":") &&
    local !== "" &&
    nameStart.test(local) &&
    (colon === -1 || prefix !== "")
    ? Option.some({ local, prefix })
    : Option.none();
};

/**
 * Test whether a name the parser has read as an XML Name is an NCName: a Name with no colon.
 *
 * @param name - The name, an XML Name.
 * @returns Whether it holds no colon.
 */
export const isNCName = (name: string): boolean => !name.includes(":");

/**
 * The production a name must match where it stands, in a document Namespaces in XML governs:
 *
 * - `QName`: an element type or attribute name, in a start or end tag and in the DOCTYPE, ELEMENT and
 *   ATTLIST declarations that name one (section 5, [12] to [21]);
 * - `NCName`: every other token XML 1.0 requires to be a Name, which section 7 asks to "match this
 *   specification's production for NCName": an entity's name, declared or referenced, a notation's
 *   name, declared or listed in a NOTATION type, and a processing instruction's target;
 * - `Name`: a keyword XML 1.0 reads as a Name, an attribute type's, which neither section names.
 *
 * @see {@link https://www.w3.org/TR/2009/REC-xml-names-20091208/#Conformance | Namespaces in XML 1.0 (Third Edition), section 7}
 */
export type Production = "Name" | "NCName" | "QName";

/**
 * How each production judges a name: the violation's description, `None` for a name it admits.
 */
const productions: Readonly<Record<Production, (name: string) => Option.Option<string>>> = {
  NCName: (name) =>
    isNCName(name)
      ? Option.none()
      : Option.some(
          `the name "${name}" holds a colon, which Namespaces in XML section 7 forbids in every entity name, notation name and processing instruction target`,
        ),
  Name: () => Option.none(),
  QName: (name) =>
    Option.isSome(qnameOf(name))
      ? Option.none()
      : Option.some(
          `the name "${name}" is not a qualified name, which Namespaces in XML section 5 asks of every element and attribute name`,
        ),
};

/**
 * Judge a name the parser has read as an XML Name by the production it must match where it stands.
 *
 * @param name - The name, an XML Name.
 * @param production - The production.
 * @returns The violation's description; `None` when the name matches.
 */
export const productionViolation = (name: string, production: Production): Option.Option<string> =>
  productions[production](name);
