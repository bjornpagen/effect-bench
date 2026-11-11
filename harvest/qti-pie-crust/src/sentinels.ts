/**
 * The private use area's code points, where an undeclared entity reference borrows a stand-in
 * character (6,400 of them), and the scan for the ones a text already writes out.
 */
import { codePointOf } from "#crust/charset.ts";

/**
 * The first code point of the private use area.
 */
export const SENTINEL_FIRST = 0xe0_00;

/**
 * The last code point of the private use area.
 */
export const SENTINEL_LAST = 0xf8_ff;

/**
 * Every character of the sentinel range, as one class. Each is a character of the Basic
 * Multilingual Plane, and no surrogate code unit (U+D800 to U+DFFF) lies in the range, so neither a
 * lone surrogate nor either half of a surrogate pair matches: the code units the class finds are
 * exactly the range's code points the text holds.
 */
const SENTINELS = new RegExp(
  `[\\u{${SENTINEL_FIRST.toString(16)}}-\\u{${SENTINEL_LAST.toString(16)}}]`,
  "gu",
);

/**
 * The sentinel-range code points a text writes out, found by one native scan of its code units
 * rather than a walk that builds a string for every code point.
 *
 * @param text - The text.
 * @returns Each such code point, once.
 */
export const sentinelsWritten = (text: string): Set<number> => {
  const used = new Set<number>();
  for (const [character] of text.matchAll(SENTINELS)) {
    used.add(codePointOf(character));
  }

  return used;
};
