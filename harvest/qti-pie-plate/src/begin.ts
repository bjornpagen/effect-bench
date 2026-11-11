/**
 * Start the stored record of an item's first attempt: {@link begin}.
 *
 * This module encodes the record through the record's Schema codec, so it sits on the Schema side
 * beside `score` and `restore`, and no browser module imports it.
 *
 * @module
 */
import { Result } from "effect";
import { encodeRecord } from "#plate/codec/record.ts";
import type { InvalidRecord, StoredRecord } from "#plate/codec/record.ts";
import { firstAttempt } from "#plate/engine/attempt.ts";
import type { EngineFailure } from "#plate/engine/evaluate.ts";
import { drawSeed } from "#plate/seed.ts";
import type { Accepted } from "#plate/validate/verdict.ts";

/**
 * Start the stored record of an item's first attempt: run its template processing under a seed
 * and set every response and outcome to its default, in the form the host stores.
 *
 * The seed is the host's, used as given (`""` included), or, when the host gives none, one
 * `begin` draws: 128 random bits written as 32 lowercase hex digits. It keys every value template
 * and response processing draw, so it is their secret: a guessable seed, such as `"7"` or `""`,
 * lets anyone who sees the page and the item recompute them. `begin` never reads the
 * configuration's `seed`, which keys a shuffled Choice's order.
 *
 * The record holds the seed, the template values template processing drew under it, the instance
 * and the item, the correct responses and defaults it set, and each response and outcome at its
 * default. The same document, instance and seed give the same record every run. An item that
 * declares no template variable holds no template value, correct response or default.
 *
 * The record is server data: its seed keys every value it draws, and its template values and
 * correct responses can give the answers away. The host stores it where only the server reads it,
 * renders the first page from what `restore(document, record)` gives back, and passes it to
 * `score` with the first responses.
 *
 * @example
 *   const stored = begin(accepted, { instance: "q1" });
 *   // Result.succeed(record) under a drawn seed; store it, then restore(accepted, record) to
 *   // render the first page. begin(accepted, { instance: "q1", seed: "7" }) gives the same record
 *   // every run.
 *
 * @param document The document `check` accepted.
 * @param start The use of the item the record starts.
 * @param start.instance The host's name for this use of the item, which scopes its ids.
 * @param start.seed The host's seed, which keys every value template processing draws, used as
 *   given; with none, `begin` draws one.
 * @returns The record of the first attempt, in the form the host stores, or {@link InvalidRecord}
 *   at stage `encode`, a renderer defect, or an {@link EngineFailure} from template processing.
 *   The engine's failure cannot occur on a checked item: the validator refuses, or the item model
 *   marks, every cause on an accepted item (a read of a variable template processing holds no
 *   value of, a rule setting a variable the item does not declare in the kind the rule sets, a
 *   value of another type), so a host writes no handling for it. A built-in named as the kind it
 *   stands as is no such cause (E22a, reading 111): a `qti-set-correct-response` of `numAttempts`
 *   and a `qti-set-default-value` of `completionStatus` or `numAttempts` run, and the record holds
 *   the built-in's correct response or default they set. An item whose template processing
 *   the model marks, because it holds an element the engine does not run or names a variable the
 *   engine does not hold (such as `QTI_CONTEXT`, a context variable or a template variable of a
 *   type plate does not model), does not run it: its record begins with each response and outcome
 *   at its declared default and no template value, correct response or default, and `check`'s
 *   verdict tells the host, `accepted-with-unsupported` with each mark (`variable:<identifier>` at
 *   `qti-template-processing` for a name the engine does not hold).
 */
export const begin = (
  document: Accepted,
  start: { readonly instance: string; readonly seed?: string },
): Result.Result<StoredRecord, EngineFailure | InvalidRecord> =>
  Result.flatMap(
    firstAttempt(document.item, { instance: start.instance, seed: start.seed ?? drawSeed() }),
    encodeRecord,
  );
