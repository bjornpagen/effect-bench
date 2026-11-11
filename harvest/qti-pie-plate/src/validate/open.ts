/**
 * `open`, the host's one entry from a document's bytes to its verdict: parse, then validate.
 *
 * It reads the bytes with the shared reader's adapter and checks the source against the committed
 * XSD tables. Its verdict is the only way a host reaches an `Accepted`, which `redact` and `score`
 * take. It stays server-side: the tables load from a committed JSON module through `Schema`, and
 * the reader is crust's.
 *
 * @module
 */
import { Effect, Option, Result } from "effect";
import { readSource } from "#plate/document/read.ts";
import { tables } from "#plate/validate/tables.ts";
import { check } from "#plate/validate/verdict.ts";
import type { Verdict } from "#plate/validate/verdict.ts";

/**
 * Judge one document under the `plate.check` span, which carries the document's location, and the
 * verdict's kind and verdict once the judgement returns.
 *
 * The judgement stays the synchronous function it is; the span only wraps the call, so the verdict
 * is the one the judgement gives. The attributes are the location and the verdict's two names,
 * never a refusal's detail or anything the document holds.
 *
 * @param location The document's location as the host named it.
 * @param judge The judgement: `check`, or a package's judgement of a document it read.
 * @returns The judgement's verdict.
 */
export const judgedInSpan = (location: string, judge: () => Verdict): Effect.Effect<Verdict> =>
  Effect.sync(judge).pipe(
    Effect.tap((verdict) =>
      Effect.annotateCurrentSpan({
        "document.kind": verdict.kind,
        "document.verdict": verdict.verdict,
      }),
    ),
    Effect.withSpan("plate.check", { attributes: { "document.location": location } }),
  );

/**
 * Open a document: read its bytes into the source view, then judge it with `check` against the
 * committed tables, under the `plate.check` span.
 *
 * It never fails, because a refusal is a verdict. A document the reader cannot build a tree from
 * is `refused`, of kind `none`, with the reader's one refusal (`not-well-formed` or
 * `reader-refused`); any other is `check`'s verdict. Nothing but its two inputs decides the result.
 *
 * A document opened alone states no QTI version, which only a package's manifest gives, so `check`
 * judges it with none (OD-A54-3): no refusal that turns on the version applies, and a
 * `qti-custom-interaction` that a 3.0.0 package refuses stays accepted here.
 *
 * @param location The document's location as the host named it, which the verdict and every
 *   refusal carry as `document`.
 * @param bytes The document as read from storage.
 * @returns The verdict on the document.
 */
export const open = Effect.fn("plate.open")(function* open(
  location: string,
  bytes: Uint8Array,
): Effect.fn.Return<Verdict> {
  yield* Effect.annotateCurrentSpan("document.location", location);

  const read = yield* Effect.result(readSource(location, bytes));
  const verdict: Verdict = Result.isFailure(read)
    ? { document: location, kind: "none", refusals: [read.failure], verdict: "refused" }
    : yield* judgedInSpan(location, () => check(read.success, tables, Option.none()));

  yield* Effect.annotateCurrentSpan("document.verdict", verdict.verdict);
  yield* Effect.annotateCurrentSpan("document.kind", verdict.kind);

  return verdict;
});
