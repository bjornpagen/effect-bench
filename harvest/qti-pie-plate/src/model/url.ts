/**
 * URL classification: which URL attributes an item body carries, and whether each value stays,
 * and in what parsed form, or is dropped as an unsupported feature.
 *
 * The WHATWG URL parser decides every case, never a pattern over the raw text, because the browser
 * strips spaces, tabs, newlines and control characters before it reads a scheme: `java\tscript:`
 * is a `javascript:` URL. A kept value is written back in its parsed form, never as written, so
 * the browser reads exactly what was checked. `check` applies {@link classifyUrl} to every
 * attribute {@link urlAttributes} lists, and the body emitter rebases kept values with
 * {@link formatUrl}; neither lists URL attributes of its own.
 *
 * @module
 * @see https://url.spec.whatwg.org/#concept-basic-url-parser
 */
import { Option } from "effect";

/**
 * How a URL attribute is used, which decides what it admits.
 *
 * - `link`: navigated to or cited (`a@href`, `img@longdesc`, `cite`). Package paths, `http`, `https`
 *   and same-document fragments.
 * - `resource`: fetched as passive media (`src`, `poster`). Package paths, `http` and `https`.
 * - `embed`: a nested document (`object@data`). Package paths only.
 * - `srcset`: a list of image candidates, each a `resource`.
 */
export type UrlContext = "embed" | "link" | "resource" | "srcset";

/**
 * One URL-bearing attribute the QTI 3 XSD declares on an item body element, by local name.
 */
export interface UrlAttribute {
  readonly attribute: string;
  readonly context: UrlContext;
  readonly element: string;
}

/**
 * Every URL attribute of an item body: the XSD's `xs:anyURI` and `URLDType` attributes on body
 * elements, and `object@data`, which the XSD types as `xs:string`. `param@value` is not here:
 * `param` feeds plugins, and no browser plate supports runs any.
 *
 * `check` and the body emitter read this table; nothing else lists URL attributes.
 *
 * @see ~/.cache/gr8des/qti3/xsd/imsqti_asiv3p0p1_v1p0.xsd (sha256 `bd82f6df…`), lines 24235 to 33756
 */
export const urlAttributes: readonly UrlAttribute[] = [
  { attribute: "href", context: "link", element: "a" },
  { attribute: "src", context: "resource", element: "audio" },
  { attribute: "cite", context: "link", element: "blockquote" },
  { attribute: "longdesc", context: "link", element: "img" },
  { attribute: "src", context: "resource", element: "img" },
  { attribute: "data", context: "embed", element: "object" },
  { attribute: "cite", context: "link", element: "q" },
  { attribute: "src", context: "resource", element: "source" },
  { attribute: "srcset", context: "srcset", element: "source" },
  { attribute: "src", context: "resource", element: "track" },
  { attribute: "poster", context: "resource", element: "video" },
  { attribute: "src", context: "resource", element: "video" },
];

/**
 * {@link urlAttributes} keyed by `element@attribute`.
 */
const contextIndex: ReadonlyMap<string, UrlContext> = new Map(
  urlAttributes.map((row) => [`${row.element}@${row.attribute}`, row.context]),
);

/**
 * Look up the context of a URL attribute.
 *
 * @param element The body element's local name.
 * @param attribute The attribute's local name.
 * @returns The attribute's context, or none when it is not a URL attribute of that element.
 */
export const urlContextOf = (element: string, attribute: string): Option.Option<UrlContext> =>
  Option.fromUndefinedOr(contextIndex.get(`${element}@${attribute}`));

/**
 * The feature key of a URL that resolves outside the item's directory: a host-absolute path
 * (`/x`), a path that climbs above it (`../x`), a network path (`//host`, `\\host`), or a remote
 * URL where the context admits only package paths.
 */
export const outsidePackageFeature = "url-outside-package";

/**
 * The feature key of a value the URL parser refuses, such as `http://[`, and of a blank value
 * (empty, or only spaces and control characters the parser strips), which would request the
 * item's directory. The XSD's `xs:anyURI` and `URLDType` admit both, so they are dropped, never
 * refused.
 */
export const invalidUrlFeature = "url-invalid";

/**
 * The prefix of the feature key of a URL dropped for its scheme, as {@link schemeFeature} writes
 * it.
 */
export const schemeFeaturePrefix = "url-scheme:";

/**
 * Construct the feature key of a URL dropped for its scheme.
 *
 * @param scheme The scheme as the URL parser reads it: lower case, without the colon.
 * @returns `url-scheme:<scheme>`, for example `url-scheme:javascript`.
 */
export const schemeFeature = (scheme: string): string => `${schemeFeaturePrefix}${scheme}`;

/**
 * A kept URL inside the item's directory.
 */
export interface PackageUrl {
  readonly kind: "package";
  /**
   * The parsed path below the item's directory, with its query and fragment, percent-encoded as
   * the parser writes it (`images/a%20b.png`). It is a relative reference that resolves to the
   * same place against any directory: when the bare path would read as a scheme, a host, an
   * absolute path or a fragment (`javascript:x`, `//evil.com/x`, `#q1`), it starts with `./`, and
   * the item's directory itself is `./`, never the empty value {@link classifyUrl} drops. The
   * prefix is load-bearing: the default asset base is `""`, so the path can reach the page as the
   * whole attribute value.
   */
  readonly path: string;
}

/**
 * A kept absolute `http` or `https` URL outside the package, as its parsed href.
 */
export interface RemoteUrl {
  readonly href: string;
  readonly kind: "remote";
}

/**
 * A kept same-document reference (`#q1`) in the link context.
 */
export interface FragmentUrl {
  /**
   * The parsed fragment without its `#`, percent-encoded as the parser writes it; empty for `#`.
   */
  readonly fragment: string;
  readonly kind: "fragment";
}

/**
 * One image candidate of a kept `srcset`: its URL and its width, density or height descriptors.
 */
export interface SrcsetCandidate {
  readonly descriptors: readonly string[];
  readonly url: PackageUrl | RemoteUrl;
}

/**
 * A kept `srcset`: the candidates a browser reads from it, in order, at least one. A candidate
 * with invalid descriptors, which a browser skips, is classified but left out.
 */
export interface SrcsetUrl {
  readonly candidates: readonly SrcsetCandidate[];
  readonly kind: "srcset";
}

/**
 * A URL attribute value that stays, in its parsed form.
 */
export type KeptUrl = FragmentUrl | PackageUrl | RemoteUrl | SrcsetUrl;

/**
 * A URL attribute value that is dropped: the attribute goes, the element and its content stay,
 * and the feature is recorded as unsupported with a notice.
 */
export interface DroppedUrl {
  /**
   * {@link outsidePackageFeature}, {@link invalidUrlFeature} or a {@link schemeFeature} key.
   */
  readonly feature: string;
  readonly kind: "dropped";
}

/**
 * The classification of one URL attribute value.
 */
export type ClassifiedUrl = DroppedUrl | KeptUrl;

/**
 * The base every value is resolved against: a directory under a host that cannot exist, standing
 * for the item's own directory. A value is package-relative when it resolves to this origin and
 * stays under {@link packageRoot}.
 */
const packageBase = "https://package.invalid/root/";

/**
 * The origin of {@link packageBase}.
 */
const packageOrigin = "https://package.invalid";

/**
 * The path of {@link packageBase}: the item's directory.
 */
const packageRoot = "/root/";

/**
 * A base with an opaque path. Against it the parser resolves only an absolute URL or a fragment
 * (`#q1`); every other relative reference fails, so it tells a fragment-only reference apart from
 * `./#q1`, which resolves to the same place against {@link packageBase}.
 *
 * @see https://url.spec.whatwg.org/#no-scheme-state
 */
const opaqueBase = "about:blank";

/**
 * Construct a dropped classification.
 *
 * @param feature The feature key it is dropped with.
 * @returns The classification.
 */
const dropped = (feature: string): DroppedUrl => ({ feature, kind: "dropped" });

/**
 * Write the part of a URL that locates it on its origin.
 *
 * @param url A parsed URL.
 * @returns Its path, query and fragment. An empty query or fragment (`x?`, `x#`) is written as
 *   none.
 */
const locationOf = (url: URL): string => `${url.pathname}${url.search}${url.hash}`;

/**
 * Construct the package classification of a URL under {@link packageRoot}, in the form that reads
 * back as the same URL.
 *
 * @param url A URL on {@link packageOrigin} whose path starts with {@link packageRoot}.
 * @returns Its path below the root, with `./` before it when the bare path would read otherwise
 *   or is empty.
 */
const packageUrl = (url: URL): PackageUrl => {
  const path = locationOf(url).slice(packageRoot.length);
  const reread = URL.parse(path, packageBase);
  const plain =
    path !== "" &&
    !URL.canParse(path, opaqueBase) &&
    reread !== null &&
    reread.origin === packageOrigin &&
    locationOf(reread) === locationOf(url);

  return { kind: "package", path: plain ? path : `./${path}` };
};

/**
 * Report whether a value is empty once the URL parser strips it: nothing but spaces and C0
 * control characters, tab and newline among them. It would resolve to the item's directory.
 *
 * @param value The attribute value as written.
 * @returns Whether every character is a C0 control or a space.
 * @see https://url.spec.whatwg.org/#c0-control-or-space
 */
const isBlank = (value: string): boolean => {
  for (const character of value) {
    if (character > " ") {
      return false;
    }
  }

  return true;
};

/**
 * Classify one fetched URL: a package path, an absolute `http` or `https` URL where remote URLs
 * are admitted, or dropped.
 *
 * `https:evil.com/x` resolves against the `https` base as the package path `evil.com/x`, so it
 * is kept and written as that path, never as `https://evil.com/x`. A network path (`//host`) is
 * dropped even when it resolves to an `http` origin, because it inherits the page's scheme; only
 * a value that reads as the same URL with no base at all is remote. A blank value is dropped as
 * {@link invalidUrlFeature}: kept, it would request the item's directory, and an object would lose
 * its fallback content.
 *
 * @param value The attribute value as written.
 * @param remoteAdmitted Whether the context keeps remote URLs.
 * @returns The classification.
 */
const classifyFetched = (
  value: string,
  remoteAdmitted: boolean,
): DroppedUrl | PackageUrl | RemoteUrl => {
  const url = isBlank(value) ? null : URL.parse(value, packageBase);
  if (url === null) {
    return dropped(invalidUrlFeature);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return dropped(schemeFeature(url.protocol.slice(0, -1)));
  }

  if (url.origin === packageOrigin) {
    return url.pathname.startsWith(packageRoot) ? packageUrl(url) : dropped(outsidePackageFeature);
  }

  return remoteAdmitted && URL.parse(value)?.href === url.href
    ? { href: url.href, kind: "remote" }
    : dropped(outsidePackageFeature);
};

/**
 * Read a same-document reference: a value that is not an absolute URL and resolves against
 * {@link opaqueBase}, which only a fragment-only reference does.
 *
 * @param value The attribute value as written.
 * @returns The parsed fragment without its `#`, or none when the value is not fragment-only.
 */
const fragmentOf = (value: string): Option.Option<string> =>
  URL.canParse(value)
    ? Option.none()
    : Option.map(Option.fromNullOr(URL.parse(value, opaqueBase)), (url) => url.hash.slice(1));

/**
 * Report whether a character is ASCII whitespace, as the HTML `srcset` parser splits on it.
 *
 * @param character One character of the attribute value, or `""` past its end.
 * @returns Whether it is a tab, line feed, form feed, carriage return or space.
 */
const isAsciiWhitespace = (character: string): boolean =>
  character === " " ||
  character === "\t" ||
  character === "\n" ||
  character === "\f" ||
  character === "\r";

/**
 * One image candidate as the `srcset` parser splits it, before its URL is classified.
 */
interface SplitCandidate {
  readonly descriptors: readonly string[];
  readonly url: string;
}

/**
 * A candidate's descriptors, and the position in the `srcset` value after them.
 */
interface Descriptors {
  readonly descriptors: readonly string[];
  readonly next: number;
}

/**
 * Collect a candidate's descriptors with the HTML descriptor tokenizer, from just after its URL.
 * A parenthesised descriptor runs to its `)`, commas and spaces included, or to the end of the
 * value.
 *
 * @param input The whole `srcset` value.
 * @param start The position after the candidate's URL.
 * @returns The descriptors, and the position the splitting loop resumes from.
 * @see https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 */
const tokenizeDescriptors = (input: string, start: number): Descriptors => {
  const descriptors: string[] = [];
  let position = start;
  while (isAsciiWhitespace(input.charAt(position))) {
    position += 1;
  }

  let current = "";
  let inParens = false;
  while (position < input.length) {
    const character = input.charAt(position);
    if (inParens) {
      current += character;
      inParens = character !== ")";
    } else if (isAsciiWhitespace(character)) {
      if (current !== "") {
        descriptors.push(current);
        current = "";
      }
    } else if (character === ",") {
      return {
        descriptors: current === "" ? descriptors : [...descriptors, current],
        next: position + 1,
      };
    } else {
      current += character;
      inParens = character === "(";
    }

    position += 1;
  }

  return { descriptors: current === "" ? descriptors : [...descriptors, current], next: position };
};

/**
 * Split a `srcset` value into its image candidates with the HTML splitting loop: a URL is a run
 * of non-whitespace, trailing commas removed, and descriptors follow it up to the next top-level
 * comma.
 *
 * @param input The attribute value as written.
 * @returns The candidates, in order, with their descriptors unvalidated.
 * @see https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 */
const splitSrcset = (input: string): readonly SplitCandidate[] => {
  const candidates: SplitCandidate[] = [];
  let position = 0;
  for (;;) {
    while (isAsciiWhitespace(input.charAt(position)) || input.charAt(position) === ",") {
      position += 1;
    }

    if (position >= input.length) {
      return candidates;
    }

    const start = position;
    while (position < input.length && !isAsciiWhitespace(input.charAt(position))) {
      position += 1;
    }

    const token = input.slice(start, position);
    let end = token.length;
    while (token.charAt(end - 1) === ",") {
      end -= 1;
    }

    if (end < token.length) {
      candidates.push({ descriptors: [], url: token.slice(0, end) });
    } else {
      const { descriptors, next } = tokenizeDescriptors(input, position);
      candidates.push({ descriptors, url: token });
      position = next;
    }
  }
};

/**
 * A valid non-negative integer of HTML: one or more ASCII digits.
 *
 * @see https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-non-negative-integer
 */
const nonNegativeInteger = /^[0-9]+$/u;

/**
 * A valid floating-point number of HTML: an optional `-`, digits with an optional fraction or a
 * fraction alone, and an optional exponent.
 *
 * @see https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-floating-point-number
 */
const floatingPoint = /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$/u;

/**
 * Report whether a candidate's descriptors pass the HTML descriptor parser: at most one width
 * (`480w`, above zero) or one density (`2x`, not negative), and a height (`200h`, above zero)
 * only beside a width. A browser skips a candidate that fails.
 *
 * @param descriptors The candidate's descriptors, as tokenized.
 * @returns Whether the browser keeps the candidate.
 * @see https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 */
const validDescriptors = (descriptors: readonly string[]): boolean => {
  let width = false;
  let density = false;
  let height = false;
  for (const descriptor of descriptors) {
    const number = descriptor.slice(0, -1);
    const unit = descriptor.slice(-1);
    if (unit === "w" && nonNegativeInteger.test(number) && !width && !density) {
      width = Number(number) > 0;
      if (!width) {
        return false;
      }
    } else if (unit === "x" && floatingPoint.test(number) && !width && !density && !height) {
      density = Number(number) >= 0;
      if (!density) {
        return false;
      }
    } else if (unit === "h" && nonNegativeInteger.test(number) && !height && !density) {
      height = Number(number) > 0;
      if (!height) {
        return false;
      }
    } else {
      return false;
    }
  }

  return width || !height;
};

/**
 * Write a kept URL as the attribute value, rebasing a package path onto the asset base.
 *
 * `check` writes each kept value with no base, so the item holds the parsed form; the body
 * emitter classifies that value again, which gives the same classification, and writes it with
 * the asset base. A fragment is written as `#<fragment>`; the emitter rewrites it to its scoped id
 * itself.
 *
 * @param url The kept value.
 * @param assetBase The prefix for package paths: `""` keeps them relative to the page, and a
 *   directory URL places them under it. A base without its closing `/` gets one, so an
 *   authority-only base (`https://cdn.example`) cannot read a path such as `@evil.com/x` or
 *   `:8080/x` as another host or port.
 * @returns The attribute value. A `srcset` is its candidates, each URL written the same way and
 *   followed by its descriptors, joined by `, `.
 */
export const formatUrl = (url: KeptUrl, assetBase = ""): string => {
  switch (url.kind) {
    case "fragment": {
      return `#${url.fragment}`;
    }

    case "package": {
      const directory = assetBase === "" || assetBase.endsWith("/") ? assetBase : `${assetBase}/`;

      return `${directory}${url.path}`;
    }

    case "remote": {
      return url.href;
    }

    case "srcset": {
      return url.candidates
        .map((candidate) =>
          [formatUrl(candidate.url, assetBase), ...candidate.descriptors].join(" "),
        )
        .join(", ");
    }

    default: {
      return url satisfies never;
    }
  }
};

/**
 * Report whether a candidate URL written into a `srcset` would split back as the same URL. One
 * that starts or ends with a comma would not; the parser makes one only from a control character
 * beside a comma. A written URL is never empty: a blank candidate is dropped before it is written.
 *
 * @param written The candidate's URL as {@link formatUrl} writes it.
 * @returns Whether the `srcset` parser reads it back unchanged.
 */
const splitsBack = (written: string): boolean => !written.startsWith(",") && !written.endsWith(",");

/**
 * Classify a `srcset`: every candidate's URL as a resource, kept whole or dropped whole.
 *
 * @param value The attribute value as written.
 * @returns The candidates a browser reads, or the first candidate's reason to drop the attribute.
 *   A value a browser reads no candidate from, a blank one included, would be written empty, so it
 *   is dropped as {@link invalidUrlFeature}, as an empty value is in every context.
 */
const classifySrcset = (value: string): DroppedUrl | SrcsetUrl => {
  const candidates: SrcsetCandidate[] = [];
  for (const split of splitSrcset(value)) {
    const url = classifyFetched(split.url, true);
    if (url.kind === "dropped") {
      return url;
    }

    if (!splitsBack(formatUrl(url))) {
      return dropped(invalidUrlFeature);
    }

    if (validDescriptors(split.descriptors)) {
      candidates.push({ descriptors: split.descriptors, url });
    }
  }

  return candidates.length === 0 ? dropped(invalidUrlFeature) : { candidates, kind: "srcset" };
};

/**
 * Classify a URL attribute value in its context.
 *
 * The value is resolved against a sentinel directory standing for the item's own directory. It is
 * kept when it is a package path (it stays inside that directory), an absolute `http` or `https`
 * URL where the context admits remote URLs, or a same-document fragment in the link context.
 * Everything else is dropped with its feature key: {@link schemeFeature} for any other scheme
 * (`javascript:`, `data:`, `mailto:`, `tel:`), {@link outsidePackageFeature} for `/x`, `../x`,
 * `//host` and `\\host`, and {@link invalidUrlFeature} for a value the parser refuses and for a
 * blank one (empty, or only spaces and control characters).
 *
 * Classifying a kept value's {@link formatUrl} form gives the same classification.
 *
 * @param context The attribute's context, from {@link urlContextOf}.
 * @param value The attribute value as written.
 * @returns The kept value in its parsed form, or the reason it is dropped.
 * @see https://url.spec.whatwg.org/#concept-basic-url-parser
 */
export const classifyUrl = (context: UrlContext, value: string): ClassifiedUrl => {
  switch (context) {
    case "embed": {
      return classifyFetched(value, false);
    }

    case "link": {
      return Option.match(fragmentOf(value), {
        onNone: () => classifyFetched(value, true),
        onSome: (fragment): FragmentUrl => ({ fragment, kind: "fragment" }),
      });
    }

    case "resource": {
      return classifyFetched(value, true);
    }

    case "srcset": {
      return classifySrcset(value);
    }

    default: {
      return context satisfies never;
    }
  }
};
