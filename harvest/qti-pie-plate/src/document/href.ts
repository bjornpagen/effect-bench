/**
 * How a reference names a document: the steps of RFC 3986 section 5.2 by which the package's
 * manifest resolves an `href`, a package test resolves its item refs, and a test session resolves
 * an item ref's `href`, so the three agree on which file a reference names.
 *
 * A path segment's percent escapes are decoded before the dot segments are removed, as a package
 * keys each file by its real name: `items/a%20b.xml` names `items/a b.xml`, and `%2E%2E` climbs a
 * directory as `..` does. The path is split at `/` before it is decoded, so an escaped `/` stays
 * data inside its segment ({@link decodeSegment}), and `openPackage` and `startTest` read that one
 * rule. `openPackage` resolves a document's file references and refs through {@link resolveIn},
 * which names the path {@link resolveInside} names but shares a base's directory instead of copying
 * it. `src/session/start.ts`, a browser module, reads this module, so it value-imports only
 * `Option` and `Result` from effect.
 *
 * @module
 */
import { Option, Result } from "effect";

/**
 * A scheme followed by its colon at the start of a URI reference, which makes the reference an
 * absolute URI (RFC 3986, section 3.1).
 *
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-3.1
 */
export const schemePrefix = /^[A-Za-z][\d+.A-Za-z-]*:/u;

/**
 * Take the part of a URI reference before its query and fragment.
 *
 * @param reference The reference.
 * @returns Its scheme, authority and path, whichever it has.
 */
export const withoutQuery = (reference: string): string => reference.split(/[#?]/u, 1)[0] ?? "";

/**
 * A percent escape of `/`, in either case, captured so a split keeps it.
 */
const escapedSlash = /(?<slash>%2F)/iu;

/**
 * Decode a path segment's percent escapes but those of `/`, which stay as written, and leave a
 * segment whose escapes are malformed as it is written.
 *
 * An escaped `/` is data inside its segment, never a separator (RFC 3986 section 2.2: a
 * percent-encoded reserved character is not equivalent to the character; reading 102). A package
 * keys a file by one text whose segments `/` separates, which cannot hold a `/` inside a segment,
 * so the escape keeps its place in the segment: `a%2Fb.xml` names the key `a%2Fb.xml`, never the
 * file `b.xml` in the directory `a`. Its limit, a case no official package has (rule `db2ef322`):
 * `a%2Fb.xml` and `a%252Fb.xml` name one key, the file whose name is spelled `a%2Fb.xml`.
 *
 * @param segment The segment.
 * @returns The segment decoded.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-2.2
 */
export const decodeSegment = (segment: string): string =>
  Result.getOrElse(
    Result.map(
      Result.all(
        segment
          .split(escapedSlash)
          .map((piece, index) =>
            index % 2 === 1 ? Result.succeed(piece) : Result.try(() => decodeURIComponent(piece)),
          ),
      ),
      (pieces) => pieces.join(""),
    ),
    () => segment,
  );

/**
 * The segments a path leaves once its dot segments are removed, and whether a `..` climbed above
 * the first of them.
 */
export interface Appended {
  /**
   * Whether a `..` met no segment before it to drop.
   */
  readonly climbed: boolean;
  readonly segments: readonly string[];
}

/**
 * Append a path's segments to a directory's, removing the dot segments as RFC 3986 section 5.2.4
 * does: each segment is read through `decode` first, `.` is dropped, `..` drops the segment before
 * it, and a dot segment at the end leaves the path ending in `/`. A `..` with no segment before it
 * drops nothing, and the result says it climbed.
 *
 * @param directory The segments already in place: a base's directory, or none.
 * @param path The path's segments, as written.
 * @param decode How each of the path's segments is read.
 * @returns The segments, and whether a `..` climbed above the first of `directory`.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.2.4
 */
export const appendSegments = (
  directory: readonly string[],
  path: readonly string[],
  decode: (segment: string) => string,
): Appended => {
  const segments = [...directory];
  let climbed = false;
  for (const [index, written] of path.entries()) {
    const segment = decode(written);
    if (segment === "..") {
      climbed ||= segments.length === 0;
      segments.pop();
    }

    if (segment !== "." && segment !== "..") {
      segments.push(segment);
    } else if (index === path.length - 1) {
      segments.push("");
    }
  }

  return { climbed, segments };
};

/**
 * Resolve a relative reference against a path inside a package, as RFC 3986 section 5.2 merges a
 * relative path with its base's directory and removes its dot segments, each segment decoded first.
 * The reference's query and fragment are set aside.
 *
 * A reference that starts with `/` names a path from a host's root, and one whose `..` climbs
 * above the package's root leaves the package: neither is inside, where RFC 3986 would drop the
 * extra `..`. The caller decides first what an absolute URI ({@link schemePrefix}) names.
 *
 * @param base The base's segments from the package's root, its last segment the one the reference
 *   replaces.
 * @param reference The reference as written, not an absolute URI.
 * @returns The segments it names from the package's root, or none when it is not inside.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.2
 */
export const resolveInside = (
  base: readonly string[],
  reference: string,
): Option.Option<readonly string[]> => {
  const path = withoutQuery(reference);
  if (path.startsWith("/")) {
    return Option.none();
  }

  const appended = appendSegments(base.slice(0, -1), path.split("/"), decodeSegment);

  return appended.climbed ? Option.none() : Option.some(appended.segments);
};

/**
 * A directory inside a package: its own name, and the directory it is in, none for the package's
 * root, the one directory with no parent. A directory is shared by reference, never copied, so a
 * reference resolves against a base of any depth with work that grows only with the reference's own
 * length ({@link resolveIn}), and every reference that resolves into the base's directory holds
 * that same value.
 */
export interface Directory {
  /**
   * Its own name, the last segment of its path, as decoded; empty for the package's root.
   */
  readonly name: string;
  readonly parent: Option.Option<Directory>;
}

/**
 * A path inside a package as a directory and the name of the file or directory in it, whose path
 * is the directory's segments and then the name, joined by `/` ({@link pathOf}).
 */
export interface Resolved {
  readonly directory: Directory;
  readonly name: string;
}

/**
 * The package's root, the directory every other one is inside.
 */
const packageRoot: Directory = { name: "", parent: Option.none() };

/**
 * Give a directory's child of a name, a new directory that shares its parent by reference.
 *
 * @param parent The directory.
 * @param name The child's name.
 * @returns The child.
 */
const childOf = (parent: Directory, name: string): Directory => ({
  name,
  parent: Option.some(parent),
});

/**
 * Give the directory a path inside a package is in: its segments but the last, the one a
 * reference against the path replaces, from the package's root.
 *
 * @param path The path, `/` separating its segments.
 * @returns The directory.
 */
export const directoryOf = (path: string): Directory => {
  let directory = packageRoot;
  for (const name of path.split("/").slice(0, -1)) {
    directory = childOf(directory, name);
  }

  return directory;
};

/**
 * Resolve a relative reference against a directory inside a package by the rule of
 * {@link resolveInside}: each segment decoded ({@link decodeSegment}), `.` dropped, `..` climbing to
 * the directory above, a dot segment at the end naming the directory itself, the query and the
 * fragment set aside, and a path that starts with `/` or climbs above the package's root not
 * inside. `resolveInside(segments, reference)` and `resolveIn(directory, reference)` name one path
 * whenever `directory` holds the segments of `segments` but its last.
 *
 * The directory is never copied: a `..` climbs to its parent, and each other segment but the last
 * enters a new child of the one in place. So the work grows with the reference's length alone,
 * however deep the directory is, and a base many references share is resolved once.
 *
 * @param directory The directory the reference's path is relative to.
 * @param reference The reference as written, not an absolute URI.
 * @returns The path it names, or none when it is not inside.
 * @see https://www.rfc-editor.org/rfc/rfc3986#section-5.2
 */
export const resolveIn = (directory: Directory, reference: string): Option.Option<Resolved> => {
  const path = withoutQuery(reference);
  if (path.startsWith("/")) {
    return Option.none();
  }

  const steps = path.split("/").map(decodeSegment);
  const name = steps.at(-1) ?? "";
  const dot = name === "." || name === "..";
  let place = directory;
  for (const step of dot ? steps : steps.slice(0, -1)) {
    if (step === "..") {
      if (Option.isNone(place.parent)) {
        return Option.none();
      }

      place = place.parent.value;
    } else if (step !== ".") {
      place = childOf(place, step);
    }
  }

  return Option.some({ directory: place, name: dot ? "" : name });
};

/**
 * Give the path a {@link Resolved} names, its segments from the package's root joined by `/`, as
 * {@link resolveInside}'s segments are joined.
 *
 * @param resolved The path inside the package.
 * @returns Its text, which takes work that grows with its length.
 */
export const pathOf = ({ directory, name }: Resolved): string => {
  const segments = [name];
  for (let place = directory; Option.isSome(place.parent); place = place.parent.value) {
    segments.push(place.name);
  }

  return segments.toReversed().join("/");
};
