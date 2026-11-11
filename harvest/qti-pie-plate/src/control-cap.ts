/**
 * The cap on an Extended Text's Controls (Q23), in a module of its own.
 *
 * The payload reads the cap in every render, and the Extended Text module in every response check.
 * It lives apart from `vocabulary.ts` so that `render`, `checkResponses` and `score` load none of
 * the vocabulary's tables, which they have no other use for. `vocabulary.ts` lists it among
 * `renders.controlNotices`, where the model builder reads it.
 *
 * @module
 */
import type { FeatureRule } from "#plate/vocabulary.ts";

/**
 * The cap on an Extended Text's Controls (Q23): at most 100. One whose `min-strings` exceeds 100
 * asks for more strings than 100 Controls hold, so it shows the notice `min-strings>100` in place
 * of its Controls, whatever `max-strings` says; the verdict is then `accepted-with-unsupported`,
 * never a refusal, as the item is valid.
 *
 * The cap bounds a rendered item's tab stops and markup, so one authored attribute cannot exhaust a
 * host that renders it. The payload reads `limit` and `feature` from here, and shows the same
 * notice beside the first 100 Controls when a value it restores holds more members than they do.
 */
export const controlCap = {
  feature: "min-strings>100",
  on: ["qti-extended-text-interaction"],
  when: { kind: "integer-above", limit: 100n, name: "min-strings" },
} as const satisfies FeatureRule;

/**
 * Tell whether an Extended Text's `min-strings` exceeds the cap, so it shows the cap's notice in
 * place of its Controls and response validation does not judge its `min-strings`.
 *
 * @param minStrings The Extended Text's `min-strings`, read exactly.
 * @returns Whether it is greater than {@link controlCap}'s limit of 100.
 */
export const exceedsControlCap = (minStrings: bigint): boolean =>
  minStrings > controlCap.when.limit;
