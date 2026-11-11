/**
 * The grammar a namespace name is read by: RFC 3986's `URI-reference`, which Namespaces in XML 1.0
 * (Third Edition) asks of an XML 1.0 document's namespace declarations, and RFC 3987's
 * `IRI-reference`, which Namespaces in XML 1.1 (Second Edition) asks of an XML 1.1 document's.
 *
 * Each is one pattern source, built from RFC 3986 Appendix A's productions by {@link referenceOf}:
 * RFC 3987 section 2.2 widens `unreserved` to `iunreserved`, adding `ucschar`, and `query` to
 * `iquery`, adding `iprivate`, and changes no other production. The URI pattern is ASCII alone, so
 * pantry's `NamespaceUri` column pattern reads it as PostgreSQL does.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc3986#appendix-A | RFC 3986, Appendix A}
 * @see {@link https://www.rfc-editor.org/rfc/rfc3987#section-2.2 | RFC 3987, section 2.2}
 */

/**
 * RFC 3986's `unreserved` as the body of a class: `ALPHA / DIGIT / "-" / "." / "_" / "~"`.
 */
const uriUnreserved = "A-Za-z0-9\\-._~";

/**
 * RFC 3986's `sub-delims` as the body of a class.
 */
const uriSubDelims = "!$&'()*+,;=";

/**
 * RFC 3986's `pct-encoded`: `"%" HEXDIG HEXDIG`, a hex digit of either case (RFC 5234 §2.3 reads
 * ABNF's quoted `"A"` to `"F"` without regard to case).
 */
const uriPctEncoded = "%[0-9A-Fa-f]{2}";

/**
 * RFC 3986's `dec-octet`, 0 to 255 with no leading zero.
 */
const uriDecOctet = "(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])";

/**
 * RFC 3986's `h16`, one to four hex digits.
 */
const uriH16 = "[0-9A-Fa-f]{1,4}";

/**
 * RFC 3986's `ls32`: `( h16 ":" h16 ) / IPv4address`.
 */
const uriLs32 = `(?:${uriH16}:${uriH16}|${uriDecOctet}\\.${uriDecOctet}\\.${uriDecOctet}\\.${uriDecOctet})`;

/**
 * RFC 3986's `IPv6address`, its nine alternatives in the Appendix's order.
 */
const uriIpv6 = `(?:(?:${uriH16}:){6}${uriLs32}|::(?:${uriH16}:){5}${uriLs32}|(?:${uriH16})?::(?:${uriH16}:){4}${uriLs32}|(?:(?:${uriH16}:){0,1}${uriH16})?::(?:${uriH16}:){3}${uriLs32}|(?:(?:${uriH16}:){0,2}${uriH16})?::(?:${uriH16}:){2}${uriLs32}|(?:(?:${uriH16}:){0,3}${uriH16})?::${uriH16}:${uriLs32}|(?:(?:${uriH16}:){0,4}${uriH16})?::${uriLs32}|(?:(?:${uriH16}:){0,5}${uriH16})?::${uriH16}|(?:(?:${uriH16}:){0,6}${uriH16})?::)`;

/**
 * Build the pattern source of a reference over an `unreserved` class: RFC 3986's `URI-reference`
 * when the class is RFC 3986's, RFC 3987's `IRI-reference` when it is `iunreserved` and the query
 * also admits `iprivate`.
 *
 * The productions are RFC 3986's, unanchored. `host` is an `IP-literal` (`"[" ( IPv6address /
 * IPvFuture ) "]"`, the `"v"` of `IPvFuture` of either case, its characters RFC 3986's
 * `unreserved` in an IRI too) or a `reg-name`; its third alternative, `IPv4address`, is left out,
 * because every one is a `reg-name` too, of digits and `.`, so the language is the same.
 * `"//" authority path-abempty` is the branch `hier-part` and `relative-part` share. A `URI` is
 * `scheme ":" hier-part` and a `relative-ref` a `relative-part`, each path's empty alternative its
 * group's `?`, then the `[ "?" query ] [ "#" fragment ]` both end with. A `relative-part`'s
 * `path-noscheme` begins with a `segment-nz-nc`, a segment with no `:`, so no relative reference
 * reads as a scheme.
 *
 * @param unreserved - The `unreserved` class's body.
 * @param privateUse - The class body `iquery` adds, empty for a URI.
 * @returns The pattern source, typed as its literal text, so a caller such as grizzle's
 *   `str.regex` checks the pattern when it is compiled.
 */
const referenceOf = <U extends string, P extends string>(unreserved: U, privateUse: P) => {
  const pchar = `(?:[${unreserved}${uriSubDelims}:@]|${uriPctEncoded})` as const;
  const host =
    `(?:\\[(?:${uriIpv6}|[Vv][0-9A-Fa-f]+\\.[${uriUnreserved}${uriSubDelims}:]+)\\]|(?:[${unreserved}${uriSubDelims}]|${uriPctEncoded})*)` as const;
  const networkPath =
    `//(?:(?:[${unreserved}${uriSubDelims}:]|${uriPctEncoded})*@)?${host}(?::[0-9]*)?(?:/${pchar}*)*` as const;
  const pathAbsolute = `/(?:${pchar}+(?:/${pchar}*)*)?` as const;

  return `(?:[A-Za-z][A-Za-z0-9+\\-.]*:(?:${networkPath}|${pathAbsolute}|${pchar}+(?:/${pchar}*)*)?|(?:${networkPath}|${pathAbsolute}|(?:[${unreserved}${uriSubDelims}@]|${uriPctEncoded})+(?:/${pchar}*)*)?)(?:\\?(?:${pchar}|[/?${privateUse}])*)?(?:#(?:${pchar}|[/?])*)?` as const;
};

/**
 * RFC 3987's `ucschar` as the body of a class, for a pattern read with the `u` flag.
 */
const ucschar =
  "\\u{A0}-\\u{D7FF}\\u{F900}-\\u{FDCF}\\u{FDF0}-\\u{FFEF}\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}";

/**
 * RFC 3987's `iprivate` as the body of a class, for a pattern read with the `u` flag.
 */
const iprivate = "\\u{E000}-\\u{F8FF}\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}";

/**
 * RFC 3986's `URI-reference`, unanchored, of US-ASCII alone: the one source of the pattern
 * crust's reader holds an XML 1.0 namespace name to and pantry's `NamespaceUri` column holds a
 * stored one to.
 */
export const uriReference = referenceOf(uriUnreserved, "");

/**
 * The namespace-name grammar of each edition of Namespaces in XML, anchored: RFC 3986's
 * `URI-reference` for 1.0 ("An XML namespace is identified by a URI reference [RFC3986]", section
 * 2.1), RFC 3987's `IRI-reference` for 1.1 ("The attribute's normalized value MUST be either an IRI
 * reference ... or an empty string", section 3).
 */
const namespaceNames = {
  "1.0": new RegExp(`^${uriReference}$`, "u"),
  "1.1": new RegExp(`^${referenceOf(`${uriUnreserved}${ucschar}`, iprivate)}$`, "u"),
} as const;

/**
 * Test whether a namespace declaration's normalized value is a namespace name: a URI reference
 * under Namespaces in XML 1.0, an IRI reference under 1.1.
 *
 * The empty value is no reference this tests for; it undeclares the default namespace, or, in an
 * XML 1.0 document, breaks Namespaces' No Prefix Undeclaring, which the reader judges apart.
 *
 * @param value - The normalized value, character references replaced and white space kept as
 *   section 3.3.3's normalization leaves it.
 * @param namespaces - The edition of Namespaces in XML the document is held to.
 * @returns Whether the value is a non-empty reference of the edition's grammar.
 * @see {@link https://www.w3.org/TR/2009/REC-xml-names-20091208/#ns-decl | Namespaces in XML 1.0 (Third Edition), section 3}
 * @see {@link https://www.w3.org/TR/2006/REC-xml-names11-20060816/#ns-decl | Namespaces in XML 1.1 (Second Edition), section 3}
 */
export const isNamespaceName = (value: string, namespaces: "1.0" | "1.1"): boolean =>
  value !== "" && namespaceNames[namespaces].test(value);
