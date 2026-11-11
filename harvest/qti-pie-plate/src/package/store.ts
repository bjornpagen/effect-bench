/**
 * A QTI 3.0 content package's files, keyed by their paths from its root, and the rules that need
 * them beside its manifest: {@link normalisePath}, {@link packageFiles} and {@link checkFiles}.
 *
 * A package reaches plate as its files keyed by path, as an archive lists its entries or a
 * directory walk finds them, each mapped to whatever the caller holds for it. Every key is brought
 * to one normal form, the form the manifest gives each resolved `href` (`ManifestHref.path`), so a
 * held file and a listed file are the same file exactly when their paths are equal strings. The
 * rules are Content Packaging 1.2's for an interchange package (section 6.3, Table 6.2): the
 * package holds its manifest at its root, as `imsmanifest.xml` (`package-manifest-missing`); every
 * file the manifest lists by a relative reference is held (b, `package-file-missing`); every file
 * held is listed (c, `package-file-unlisted`); and no file lies above the manifest
 * (`package-path-outside`), nor has a key with a backslash or a drive prefix (reading 138). Reading
 * each file and what its document holds belongs to the package reader.
 *
 * @module
 * @see https://www.imsglobal.org/content/packaging/cpv1p2pd2/imscp_infov1p2pd2.html
 */
import { Option, Result } from "effect";
import type { Array as Arr } from "effect";
import { appendSegments } from "#plate/document/href.ts";
import type { Manifest } from "#plate/package/manifest.ts";
import { Refusal } from "#plate/validate/refusal.ts";
import type { Location, RefusalRule } from "#plate/validate/refusal.ts";

/**
 * The manifest's path in every package: `imsmanifest.xml` at its root, the one name Content
 * Packaging gives the root manifest document. It is the one held file no resource lists.
 */
export const manifestFile = "imsmanifest.xml";

/**
 * Name one file of a package as a refusal's `document` names it: the package's location, then the
 * file's path from its root.
 *
 * The package reader reads the manifest at `fileLocation(location, manifestFile)`, so a refusal of
 * the manifest from `readManifest` and a `package-file-missing` from {@link checkFiles}, which is
 * located at the resource that lists the file, name one document.
 *
 * @param location The package's location, as the caller gave it.
 * @param path The file's path from the package's root, in normal form.
 * @returns The file's location.
 */
export const fileLocation = (location: string, path: string): string => `${location}/${path}`;

/**
 * The location of a refusal of a whole package, which no element of a document owns.
 */
const wholePackage: Location = { kind: "document" };

/**
 * Construct a refusal of a package or its manifest.
 *
 * @param document The location of the package, or of its manifest.
 * @param rule The rule it breaks.
 * @param location Where in that document.
 * @param detail The facts the verdict's wording reads.
 * @returns The refusal.
 */
const refuse = (
  document: string,
  rule: RefusalRule,
  location: Location,
  detail: Readonly<Record<string, string>>,
): Refusal =>
  new Refusal({
    detail,
    document,
    location,
    readerRule: Option.none(),
    rule,
    suggestion: Option.none(),
  });

/**
 * A drive prefix at the start of a key, a letter and a colon, as a Windows path begins `C:`.
 */
const drivePrefix = /^[A-Za-z]:/u;

/**
 * Bring a key of a package's files to its normal form: segments separated by `/`, with no `.` or
 * `..` segment and no leading `/`.
 *
 * A key that holds a backslash or begins with a drive prefix names no entry of the package and is
 * refused, in a zip and in a directory alike (reading 138): the ZIP format stores a path with
 * forward slashes and no drive letter (APPNOTE 6.3.10, section 4.4.17.1), and a manifest's `href`,
 * an RFC 3986 reference, holds no `\` and parses a leading `C:` as a scheme. A `.` segment is
 * removed and a `..` segment removes the segment before it, as RFC 3986 section 5.2.4 removes dot
 * segments ({@link appendSegments}), so `items/sub/../a.xml` is `items/a.xml`, and a key that ends
 * in a dot segment names a directory, ending in `/`. A key is a file's name, not a URI reference: a
 * `%`, a `?` and a `#` are characters of the name and are never decoded or set aside, which is what
 * the manifest's resolved `href` paths are compared with.
 *
 * @param path The key as the package's reader found it.
 * @param location The package's location, which a refusal carries as its `document`.
 * @returns The path from the package's root, or the `package-path-outside` refusal, its detail the
 *   key as written: with `check: "entry-key"` and the `reading` when the key holds a backslash or
 *   begins with a drive prefix, and alone when a `..` climbs above the root or the key is rooted,
 *   starting with `/` after its dot segments are removed.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.2.4
 */
export const normalisePath = (path: string, location: string): Result.Result<string, Refusal> => {
  if (path.includes("\\") || drivePrefix.test(path)) {
    return Result.fail(
      refuse(location, "package-path-outside", wholePackage, {
        check: "entry-key",
        path,
        reading: "138",
      }),
    );
  }

  const { climbed, segments } = appendSegments([], path.split("/"), (segment) => segment);
  const normal = segments.join("/");

  return climbed || normal.startsWith("/")
    ? Result.fail(refuse(location, "package-path-outside", wholePackage, { path }))
    : Result.succeed(normal);
};

/**
 * Report whether a path in normal form names a directory, as an archive lists one: the root, or a
 * path that ends in `/`. A directory holds no file, so the file rules pass over it.
 *
 * @param path The path.
 * @returns Whether it names a directory.
 */
const isDirectory = (path: string): boolean => path === "" || path.endsWith("/");

/**
 * A package's files keyed by their normal form, with the refusals of the keys.
 */
interface Holding<Content> {
  readonly files: ReadonlyMap<string, Content>;
  readonly refusals: readonly Refusal[];
}

/**
 * Key a package's files by their normal form, and refuse each key outside the root and a package
 * without its manifest.
 *
 * @param files The package's files, keyed as its reader found them.
 * @param location The package's location.
 * @returns The files in their normal form, directories passed over and, of two keys with one normal
 *   form, the first held kept; and the refusals, each key's in the order held, then
 *   `package-manifest-missing`.
 */
const hold = <Content>(files: ReadonlyMap<string, Content>, location: string): Holding<Content> => {
  const normal = new Map<string, Content>();
  const refusals: Refusal[] = [];
  for (const [key, content] of files) {
    const path = normalisePath(key, location);
    if (Result.isFailure(path)) {
      refusals.push(path.failure);
    } else if (!isDirectory(path.success) && !normal.has(path.success)) {
      normal.set(path.success, content);
    }
  }

  if (!normal.has(manifestFile)) {
    refusals.push(refuse(location, "package-manifest-missing", wholePackage, {}));
  }

  return { files: normal, refusals };
};

/**
 * Report a check's refusals, or its value when there are none.
 *
 * @param value The checked value.
 * @param refusals The refusals, in order.
 * @returns The value, or every refusal.
 */
const verdictOf = <A>(
  value: A,
  refusals: readonly Refusal[],
): Result.Result<A, Arr.NonEmptyReadonlyArray<Refusal>> => {
  const [first, ...rest] = refusals;

  return first === undefined ? Result.succeed(value) : Result.fail([first, ...rest]);
};

/**
 * Key a package's files by their paths from its root, the rules that need no manifest checked: each
 * key through {@link normalisePath}, and `imsmanifest.xml` held at the root.
 *
 * This is how the package reader finds the manifest it then reads: the manifest is the result's
 * {@link manifestFile} entry. {@link checkFiles} runs the same rules first, so the package reader
 * that has read the manifest needs only that.
 *
 * @param files The package's files, keyed as its reader found them.
 * @param location The package's location, which every refusal carries as its `document`.
 * @returns The files keyed by normal form, a directory entry passed over and, of two keys with one
 *   normal form, the first held kept; or every refusal: `package-path-outside` for each key that
 *   leaves the root or names no entry, in the order held, then `package-manifest-missing`, both at
 *   the whole package.
 */
export const packageFiles = <Content>(
  files: ReadonlyMap<string, Content>,
  location: string,
): Result.Result<ReadonlyMap<string, Content>, Arr.NonEmptyReadonlyArray<Refusal>> => {
  const holding = hold(files, location);

  return verdictOf(holding.files, holding.refusals);
};

/**
 * Check a package's files against its manifest: the rules of {@link packageFiles}, then every held
 * file listed and every listed file held.
 *
 * A held file other than the manifest that no resource's `file` entry names is
 * `package-file-unlisted` at the whole package. A path a resource's `file` entry names that the
 * package does not hold is `package-file-missing`, once for each resource that lists it, located at
 * that resource in the manifest (`ManifestResource.location`) of the document
 * `fileLocation(location, manifestFile)`. A file the manifest names by an external link, an
 * absolute URI (reading 35) or a path that leads outside the package (reading 102), is never
 * looked for. Refusals come in that order: the keys', the manifest's absence, the unlisted files
 * in the order held, then the missing ones in the manifest's order.
 *
 * @param manifest The package's manifest, as `readManifest` read it.
 * @param files The package's files, keyed as its reader found them.
 * @param location The package's location.
 * @returns The files keyed by normal form, as {@link packageFiles} gives them, or every refusal.
 */
export const checkFiles = <Content>(
  manifest: Manifest,
  files: ReadonlyMap<string, Content>,
  location: string,
): Result.Result<ReadonlyMap<string, Content>, Arr.NonEmptyReadonlyArray<Refusal>> => {
  const holding = hold(files, location);
  const listed = new Set(
    manifest.resources.flatMap((resource) =>
      resource.files.flatMap((file) => Option.toArray(file.path)),
    ),
  );
  const unlisted = [...holding.files.keys()]
    .filter((path) => path !== manifestFile && !listed.has(path))
    .map((path) => refuse(location, "package-file-unlisted", wholePackage, { path }));
  const manifestLocation = fileLocation(location, manifestFile);
  const missing = manifest.resources.flatMap((resource) =>
    [...new Set(resource.files.flatMap((file) => Option.toArray(file.path)))]
      .filter((path) => !holding.files.has(path))
      .map((path) =>
        refuse(
          manifestLocation,
          "package-file-missing",
          { kind: "path", path: resource.location },
          { path, resource: resource.identifier },
        ),
      ),
  );

  return verdictOf(holding.files, [...holding.refusals, ...unlisted, ...missing]);
};
