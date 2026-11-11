/**
 * Give an item's record and values back from the record the host stored, so the host can render
 * the item again as the candidate left it: {@link restore}.
 *
 * This module decodes the stored record through Schema, so no browser module imports it.
 *
 * @module
 */
import { pipe, Result } from "effect";
import { decodeRecord } from "#plate/codec/record.ts";
import type { InvalidRecord, StoredRecord } from "#plate/codec/record.ts";
import type { ItemRecord } from "#plate/model/record.ts";
import { belonging, fitting, templatesHeld } from "#plate/score.ts";
import type { RecordMismatch } from "#plate/score.ts";
import type { Responses } from "#plate/session/session.ts";
import type { Accepted } from "#plate/validate/verdict.ts";

/**
 * What {@link restore} gives back for an item: the decoded record, and the values its controls
 * show again.
 */
export interface Restored {
  /**
   * The record, decoded, its template values and the correct responses and defaults its template
   * processing set included. The host passes it to `redact`, `checkResponses` and `solution`,
   * each of which reads only the part it needs and none the seed.
   *
   * It is server data: its template values and correct responses can give the answers away, so the
   * host keeps it where only the server reads it and never sends it to the page.
   */
  readonly record: ItemRecord;
  /**
   * The record's responses by identifier, NULL included, to pass to `render` as its `values`: its
   * `responses`, and each record response's record from its `records`, which the control bound to
   * it shows as its `stringValue`.
   */
  readonly values: Responses;
}

/**
 * Give back an item's decoded record and the values its controls showed, from the record the host
 * stored for it.
 *
 * The record is checked against the item as `results` checks it: it belongs to the item, and each
 * response it holds is one the item scores, and each outcome one the item declares, each of its
 * declaration's base type and cardinality, and each record it holds one of a record response the
 * item declares, so another item's record, or values the item's controls cannot hold, are refused
 * rather than given back. Then, as `score` checks it, a record of an item whose template processing
 * runs must hold a value for each template variable the item declares, as every record `begin` or
 * `score` writes for it does (`templatesHeld` in `#plate/score.ts`).
 *
 * The record alone does not say how to render the item again. Its `instance` is the one `begin`
 * started it with, or `""` for a record `score` started for an item scored without one, and need
 * not be the instance the item was rendered with. So for an item delivered on its own the host
 * keeps, beside the record, the instance it passed to `render` and the configuration it rendered
 * with, whose `seed` keys a shuffled Choice's order, and renders the restored values with both, so
 * the ids and the choice order are the ones the candidate saw.
 *
 * @example
 *   const restored = restore(accepted, stored);
 *   // Result.succeed({ record, values }); render(redacted, configuration, { instance, values })
 *
 * @param document The document `check` accepted, the item the record is for.
 * @param record The record `begin` or the last `score` of the item returned, as the host stored it
 *   and handed it back.
 * @returns The decoded record and its responses, record responses among them, as {@link Restored};
 *   {@link InvalidRecord} at stage `decode` for a record the renderer could not have written: the
 *   version found when that is what does not fit, the first response, then the first outcome, then
 *   the first template value, correct response or default, that does not fit its declaration, or,
 *   for an item whose template processing runs, the first declared template variable it holds no
 *   value for; or {@link RecordMismatch} for another item's record.
 */
export const restore = (
  document: Accepted,
  record: StoredRecord,
): Result.Result<Restored, InvalidRecord | RecordMismatch> =>
  pipe(
    decodeRecord(record),
    Result.flatMap((decoded) => belonging(document.item, decoded)),
    Result.flatMap((decoded) => fitting(document.item, decoded)),
    Result.flatMap((decoded) => templatesHeld(document.item, decoded)),
    Result.map((decoded) => ({
      record: decoded,
      values: { ...decoded.responses, ...decoded.records },
    })),
  );
