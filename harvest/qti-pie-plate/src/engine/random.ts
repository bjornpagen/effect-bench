/**
 * OD-3's generator: the draws a shuffled Choice's order and the random expression kinds take, from
 * two sources chosen by threat, over one core.
 *
 * - A shuffle's order is public: the candidate sees it. It comes from a SplitMix32 stream seeded with
 *   the 32-bit FNV-1a hash of the shuffle's key ({@link shuffleOrder}).
 * - Template and response processing's values are secret: a template value may be the answer. They
 *   come from an HMAC-SHA-256 counter-mode stream keyed by the record's seed ({@link drawStream}),
 *   so while the seed cannot be guessed, neither the page nor the item's XML predicts one draw from
 *   another.
 * - The core is one: a stream is a {@link Draw}, and {@link drawFloat} and {@link drawBelow} read
 *   floats and integers from either.
 *
 * The algorithms are part of the session contract. A session's presented order and every value a
 * random kind draws are replayed from the stored seed and key alone, so the same seed and key give
 * the same draws in every build, browser and engine. Every step is pinned to the bit, and nothing
 * here may change without a new pin.
 *
 * Arithmetic is modulo 2^32 throughout: `Math.imul` multiplies modulo 2^32 and `>>> 0` reads a
 * result as an unsigned 32-bit integer. The module is pure and synchronous. It holds no stream:
 * every draw comes from a stream its caller passes, so no result depends on an earlier call.
 *
 * @module
 */
/* oxlint-disable no-bitwise -- FNV-1a, the MurmurHash3 finaliser and the float draw are defined by XOR, shifts and modulo-2^32 multiplication; the bitwise operators are the specification, not a slip for logical ones. */
import { hmac, hmacKey } from "#plate/engine/sha256.ts";

/**
 * 2^32, the number of distinct draws; a draw divided by it is a fraction in [0, 1).
 */
const drawCount = 4_294_967_296;

/**
 * One stream's draws: each call gives the stream's next draw, an unsigned 32-bit integer, and
 * advances the stream.
 *
 * Every draw of one processing run comes from one stream, in evaluation order, so the run's values
 * depend only on the stream's seed and label ({@link drawStream}).
 */
export type Draw = () => number;

/**
 * The encoder of a key's, a seed's and a label's UTF-8 bytes. A lone surrogate encodes as U+FFFD,
 * as the Encoding Standard's UTF-8 encoder writes it.
 *
 * @see https://encoding.spec.whatwg.org/#utf-8-encoder
 */
const utf8 = new TextEncoder();

/**
 * Hash a key with 32-bit FNV-1a over its UTF-8 bytes: offset basis `0x811c9dc5`, prime
 * `0x01000193`, each byte XORed in before the multiply, modulo 2^32.
 *
 * @param text The key.
 * @returns The hash, an unsigned 32-bit integer.
 * @see http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-1a
 */
export const fnv1a32 = (text: string): number => {
  let hash = 0x81_1c_9d_c5;

  for (const byte of utf8.encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01_00_01_93);
  }

  return hash >>> 0;
};

/**
 * Construct a SplitMix32 generator from a seed. Each draw adds `0x9e3779b9` to the state, modulo
 * 2^32, and returns the state mixed by MurmurHash3's 32-bit finaliser.
 *
 * The seed is read as an unsigned 32-bit integer (`seed >>> 0`), so {@link fnv1a32}'s hash seeds
 * it exactly. The returned function holds the state: each call advances it.
 *
 * @param seed The initial state.
 * @returns The next draw on each call, an unsigned 32-bit integer.
 * @see https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
 */
export const splitMix32 = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x9e_37_79_b9) >>> 0;

    let mixed = state ^ (state >>> 16);

    mixed = Math.imul(mixed, 0x85_eb_ca_6b);
    mixed ^= mixed >>> 13;
    mixed = Math.imul(mixed, 0xc2_b2_ae_35);
    mixed ^= mixed >>> 16;

    return mixed >>> 0;
  };
};

/**
 * Swap two entries of a list in place.
 *
 * @param list The list.
 * @param left A position in the list.
 * @param right Another position in the list.
 */
const swap = (list: number[], left: number, right: number): void => {
  const leftEntry = list[left];
  const rightEntry = list[right];

  // Both positions are within the list, so neither read is undefined; the check narrows the type.
  if (leftEntry !== undefined && rightEntry !== undefined) {
    list[left] = rightEntry;
    list[right] = leftEntry;
  }
};

/**
 * Give the presented order of a list whose entries may be fixed, shuffled under a key.
 *
 * The key's {@link fnv1a32} hash seeds {@link splitMix32}. Fisher-Yates runs over the list of
 * non-fixed positions, from the last down to the second: the entry at index `i` of that list
 * swaps with the one at `floor(draw * (i + 1) / 2^32)`. A fixed position keeps its own entry. The
 * product of a draw and `i + 1` is exact below 2^53, so the index is exact for any list shorter
 * than 2^21.
 *
 * @param key The key the order is drawn under; the same key gives the same order.
 * @param fixed For each position in document order, whether its entry is fixed.
 * @returns The presented order: at each position, the document index of the entry shown there.
 *   A fixed index is at its own position; an empty or one-element list is the identity.
 */
export const shuffleOrder = (key: string, fixed: readonly boolean[]): readonly number[] => {
  const draw = splitMix32(fnv1a32(key));
  const shuffled = fixed.flatMap((isFixed, index) => (isFixed ? [] : [index]));

  for (let last = shuffled.length - 1; last > 0; last -= 1) {
    swap(shuffled, last, Math.floor((draw() * (last + 1)) / drawCount));
  }

  const presented = shuffled.values();

  // `shuffled` holds one entry per non-fixed position, so the iterator never runs dry here.
  return fixed.map((isFixed, index) => (isFixed ? index : (presented.next().value ?? index)));
};

/**
 * The bytes of one HMAC-SHA-256 tag, and so of one block of {@link drawStream}'s draws.
 */
const tagLength = 32;

/**
 * Construct the stream template or response processing draws from: HMAC-SHA-256 in counter mode,
 * keyed by the seed.
 *
 * The key K is the seed's UTF-8 bytes. Block b, for b = 0, 1, 2, …, is HMAC-SHA-256(K, UTF-8(label)
 * ‖ b as four big-endian bytes), and draw j is the unsigned big-endian 32-bit word (j mod 8) of
 * block ⌊j / 8⌋. The construction is part of OD-3's contract. While the seed cannot be guessed,
 * the draws of one label tell nothing of another's, nor of a later draw of the same label.
 *
 * Each call starts a fresh stream, so the same seed and label give the same draws in every call.
 * The stream keeps the key's HMAC states, and computes a block when its first word is drawn. The
 * counter wraps after 2^32 blocks, 2^35 draws, and the stream then repeats from its first draw, so
 * its draws stay a function of the seed and label alone; nothing bounds the draws of one run, but
 * reaching the wrap takes hours.
 *
 * @param seed The record's seed, the HMAC key: the caller's, used as given.
 * @param label What the stream draws for, such as {@link templateLabel}'s,
 *   {@link responseLabel}'s, {@link outcomeLabel}'s or {@link defaultLabel}'s.
 * @returns The stream's draws.
 * @see https://www.rfc-editor.org/rfc/rfc2104
 */
export const drawStream = (seed: string, label: string): Draw => {
  const key = hmacKey(utf8.encode(seed));
  const labelBytes = utf8.encode(label);
  const message = new Uint8Array(labelBytes.length + 4);
  const counter = new DataView(message.buffer, labelBytes.length, 4);
  let block = 0;
  let words: DataView = new DataView(new ArrayBuffer(tagLength));
  let next = tagLength;

  message.set(labelBytes);

  return () => {
    if (next === tagLength) {
      counter.setUint32(0, block);

      const tag = hmac(key, message);

      words = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
      block += 1;
      next = 0;
    }

    const word = words.getUint32(next);

    next += 4;

    return word;
  };
};

/**
 * Draw a float in [0, 1) from two draws `a` and `b`, taken in that order:
 * `((a >>> 5) × 67_108_864 + (b >>> 6)) / 9_007_199_254_740_992`, that is, the top 27 bits of `a`
 * above the top 26 bits of `b`, over 2^53.
 *
 * The 53-bit numerator is exact in a `number` and the division by 2^53 is exact, so the float is
 * the same in every engine: one of the 2^53 multiples of 2^-53 below 1, each equally likely. The
 * formula is part of OD-3's contract.
 *
 * @param draw The stream; the float takes its next two draws.
 * @returns The float, at least 0 and below 1.
 */
export const drawFloat = (draw: Draw): number => {
  const high = draw() >>> 5;
  const low = draw() >>> 6;

  return (high * 67_108_864 + low) / 9_007_199_254_740_992;
};

/**
 * Read one candidate of {@link drawBelow}: ⌈bits / 32⌉ draws as one big-endian number, the first
 * draw the most significant 32-bit word and the last the least, masked to its low `bits` bits.
 *
 * @param draw The stream.
 * @param bits The number of low bits kept, 1 or more.
 * @returns The candidate, below 2^bits.
 */
const candidateOf = (draw: Draw, bits: number): bigint => {
  let whole = 0n;
  for (let read = 0; read < bits; read += 32) {
    whole = whole * BigInt(drawCount) + BigInt(draw());
  }

  return BigInt.asUintN(bits, whole);
};

/**
 * Draw an integer below a count, each equally likely, by rejection: with `k` the bit length of
 * `count − 1`, read ⌈k / 32⌉ draws as one big-endian number (the first draw the most significant
 * 32-bit word, the last the least), mask it to its low `k` bits, and draw again while the result is
 * not below `count`.
 *
 * A candidate is below 2^k, which is less than twice `count`, so each candidate is accepted with
 * probability above one half. A count of 1 has `k` 0: it draws nothing and gives 0. The procedure
 * is part of OD-3's contract.
 *
 * @param draw The stream; each candidate takes its next ⌈k / 32⌉ draws.
 * @param count The number of values to draw among, 1 or more. A count below 1 is read as 1, so the
 *   draw always ends.
 * @returns The integer, at least 0 and below `count`.
 */
export const drawBelow = (draw: Draw, count: bigint): bigint => {
  if (count <= 1n) {
    return 0n;
  }

  const bits = (count - 1n).toString(2).length;
  let candidate = candidateOf(draw, bits);
  while (candidate >= count) {
    candidate = candidateOf(draw, bits);
  }

  return candidate;
};

/**
 * The separator of a label's fields, U+001F INFORMATION SEPARATOR ONE, as a shuffled Choice's key
 * joins its fields (`choiceOrder` in `#plate/payload.ts`).
 */
const labelSeparator = "\u001F";

/**
 * Construct the label an item's template processing draws under:
 * `<instance>\u001Ftemplate\u001F<item>`.
 *
 * The seed is no field: it is the stream's key ({@link drawStream}). The label is injective: every
 * field after the instance is free of U+001F (a fixed word and an XML identifier), so a label
 * splits from the right into its fields.
 *
 * @param instance The item's instance.
 * @param item The item's identifier.
 * @returns The label, for {@link drawStream}.
 */
export const templateLabel = (instance: string, item: string): string =>
  [instance, "template", item].join(labelSeparator);

/**
 * Construct the label an attempt's response processing draws under:
 * `<instance>\u001Fresponse\u001F<numAttempts>`, the count written with `String`.
 *
 * The seed is no field: it is the stream's key ({@link drawStream}). The label is injective: every
 * field after the instance is free of U+001F (a fixed word and decimal digits), so a label splits
 * from the right into its fields.
 *
 * @param instance The item's instance.
 * @param numAttempts The attempt's count, the built-in `numAttempts` its processing reads.
 * @returns The label, for {@link drawStream}.
 */
export const responseLabel = (instance: string, numAttempts: number): string =>
  [instance, "response", String(numAttempts)].join(labelSeparator);

/**
 * Construct the label one run of a test's outcome processing draws under:
 * `<instance>\u001Foutcome\u001F<run>`, the run's number written with `String`.
 *
 * The seed is no field: it is the stream's key ({@link drawStream}), the session's processing
 * seed, so a run never draws under the default key. The label is injective: every field after the
 * instance is free of U+001F (a fixed word and decimal digits), so a label splits from the right
 * into its fields, and two runs of one session draw apart.
 *
 * @param instance The test session's instance.
 * @param run The run's number, counted from 1: the session's run count before the run, plus 1.
 * @returns The label, for {@link drawStream}.
 */
export const outcomeLabel = (instance: string, run: number): string =>
  [instance, "outcome", String(run)].join(labelSeparator);

/**
 * Construct the label an item ref's template defaults draw under:
 * `<instance>\u001Fdefault\u001F<sequenceIndex>`, the index written with `String`.
 *
 * The seed is no field: it is the stream's key ({@link drawStream}), the session's processing
 * seed, so the defaults never draw under the default key. The label is injective: every field
 * after the instance is free of U+001F (a fixed word and decimal digits), so a label splits from
 * the right into its fields, and two items of one session draw apart. One stream serves all of an
 * item ref's defaults, in document order.
 *
 * @param instance The test session's instance.
 * @param sequenceIndex The item's place in the session's sequence, counted from 1
 *   (`SessionItem.sequenceIndex`).
 * @returns The label, for {@link drawStream}.
 */
export const defaultLabel = (instance: string, sequenceIndex: number): string =>
  [instance, "default", String(sequenceIndex)].join(labelSeparator);
