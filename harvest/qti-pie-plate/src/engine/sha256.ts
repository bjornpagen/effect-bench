/**
 * SHA-256 (FIPS 180-4) and HMAC-SHA-256 (RFC 2104) over bytes, the primitive of the stream template
 * and response processing draw from (`drawStream` in `#plate/engine/random.ts`).
 *
 * The code is plain and synchronous and imports nothing: WebCrypto's digest is asynchronous, and a
 * dependency would change the lockfile. Every step is a 32-bit integer operation (addition read
 * modulo 2^32 with `>>> 0`, XOR, AND, NOT, shifts and rotations) or a `DataView` read or write, so
 * the bytes are the same in every engine. The module holds no mutable state: the round constants
 * and the initial hash value are constant data, and each compression builds its own message
 * schedule.
 *
 * @module
 */
/* oxlint-disable no-bitwise -- SHA-256 is defined by XOR, AND, NOT, shifts, rotations and addition modulo 2^32; the bitwise operators are the specification, not a slip for logical ones. */

/**
 * A SHA-256 chaining value, or a digest: eight 32-bit words.
 */
type Words = readonly [number, number, number, number, number, number, number, number];

/**
 * The bytes of one SHA-256 block.
 */
const blockLength = 64;

/**
 * SHA-256's round constants K0 to K63 (FIPS 180-4 §4.2.2).
 */
const roundConstants: readonly number[] = [
  0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b, 0x59_f1_11_f1,
  0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01, 0x24_31_85_be, 0x55_0c_7d_c3,
  0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7, 0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86,
  0x0f_c1_9d_c6, 0x24_0c_a1_cc, 0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da,
  0x98_3e_51_52, 0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
  0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc, 0x53_38_0d_13,
  0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85, 0xa2_bf_e8_a1, 0xa8_1a_66_4b,
  0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19, 0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70,
  0x19_a4_c1_16, 0x1e_37_6c_08, 0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a,
  0x5b_9c_ca_4f, 0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
  0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
];

/**
 * SHA-256's initial hash value H(0) (FIPS 180-4 §5.3.3).
 */
const initialHash: Words = [
  0x6a_09_e6_67, 0xbb_67_ae_85, 0x3c_6e_f3_72, 0xa5_4f_f5_3a, 0x51_0e_52_7f, 0x9b_05_68_8c,
  0x1f_83_d9_ab, 0x5b_e0_cd_19,
];

/**
 * Read an entry of an array the compression indexes; every index it computes is in range, so the
 * fallback is never taken.
 *
 * @param array The array.
 * @param index The index.
 * @returns The entry.
 */
const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

/**
 * Rotate a 32-bit word right (FIPS 180-4's ROTR).
 *
 * @param word The word.
 * @param count The places, 1 to 31.
 * @returns The rotated word's 32 bits, as a signed 32-bit integer.
 */
const rotate = (word: number, count: number): number => (word >>> count) | (word << (32 - count));

/**
 * Compress one 64-byte block into a chaining value (FIPS 180-4 §6.2.2): the message schedule, the
 * 64 rounds, and the sum of the working variables with the chaining value, modulo 2^32.
 *
 * @param chain The chaining value before the block.
 * @param bytes The bytes holding the block.
 * @param offset Where the block starts in `bytes`.
 * @returns The chaining value after the block.
 */
const compress = (chain: Words, bytes: Uint8Array, offset: number): Words => {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, blockLength);
  const schedule = new Uint32Array(64);

  for (let round = 0; round < 16; round += 1) {
    schedule[round] = view.getUint32(4 * round);
  }

  for (let round = 16; round < 64; round += 1) {
    const early = at(schedule, round - 15);
    const late = at(schedule, round - 2);
    const sigma0 = rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3);
    const sigma1 = rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10);

    schedule[round] = (at(schedule, round - 16) + sigma0 + at(schedule, round - 7) + sigma1) >>> 0;
  }

  let [a, b, c, d, e, f, g, h] = chain;

  for (let round = 0; round < 64; round += 1) {
    const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choose = (e & f) ^ (~e & g);
    const first = (h + sum1 + choose + at(roundConstants, round) + at(schedule, round)) >>> 0;
    const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const second = (sum0 + majority) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + first) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (first + second) >>> 0;
  }

  return [
    (chain[0] + a) >>> 0,
    (chain[1] + b) >>> 0,
    (chain[2] + c) >>> 0,
    (chain[3] + d) >>> 0,
    (chain[4] + e) >>> 0,
    (chain[5] + f) >>> 0,
    (chain[6] + g) >>> 0,
    (chain[7] + h) >>> 0,
  ];
};

/**
 * Finish a SHA-256 computation over a message's last bytes (FIPS 180-4 §5.1.1 and §6.2.2): append
 * the byte 0x80, then zeros, then the message's length in bits as a 64-bit big-endian number, so
 * the whole fills a multiple of 64 bytes, and compress each block.
 *
 * @param chain The chaining value after the message's first `absorbed` bytes.
 * @param absorbed How many bytes `chain` has compressed, a multiple of 64.
 * @param rest The message's remaining bytes.
 * @returns The digest's words.
 */
const finish = (chain: Words, absorbed: number, rest: Uint8Array): Words => {
  const padded = new Uint8Array((((rest.length + 8) >>> 6) + 1) * blockLength);

  padded.set(rest);
  padded[rest.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(padded.length - 8, BigInt(absorbed + rest.length) * 8n);

  let digest = chain;

  for (let offset = 0; offset < padded.length; offset += blockLength) {
    digest = compress(digest, padded, offset);
  }

  return digest;
};

/**
 * Write words as their big-endian bytes.
 *
 * @param words The words.
 * @returns The 32 bytes.
 */
const bytesOf = (words: Words): Uint8Array => {
  const bytes = new Uint8Array(4 * words.length);
  const view = new DataView(bytes.buffer);

  for (const [index, word] of words.entries()) {
    view.setUint32(4 * index, word);
  }

  return bytes;
};

/**
 * Hash a message with SHA-256.
 *
 * @param message The message's bytes.
 * @returns The 32-byte digest.
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 */
export const sha256 = (message: Uint8Array): Uint8Array => bytesOf(finish(initialHash, 0, message));

/**
 * One key's HMAC-SHA-256 states: the chaining values after the key's inner and outer padded blocks,
 * so every message under the key starts from them and its tag costs one inner computation and one
 * outer compression.
 *
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 * @see https://www.rfc-editor.org/rfc/rfc2104
 */
export interface HmacKey {
  /**
   * The chaining value after the key XORed with the inner pad, 0x36 in every byte.
   */
  readonly inner: Words;
  /**
   * The chaining value after the key XORed with the outer pad, 0x5c in every byte.
   */
  readonly outer: Words;
}

/**
 * Prepare a key for HMAC-SHA-256: a key longer than a 64-byte block is hashed first, the key is
 * padded with zeros to a block, and the block XORed with each pad is compressed once.
 *
 * @param key The key's bytes, of any length.
 * @returns The key's states.
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 * @see https://www.rfc-editor.org/rfc/rfc2104
 */
export const hmacKey = (key: Uint8Array): HmacKey => {
  const block = new Uint8Array(blockLength);

  block.set(key.length > blockLength ? sha256(key) : key);

  return {
    inner: compress(
      initialHash,
      block.map((byte) => byte ^ 0x36),
      0,
    ),
    outer: compress(
      initialHash,
      block.map((byte) => byte ^ 0x5c),
      0,
    ),
  };
};

/**
 * Compute a message's HMAC-SHA-256 tag under a prepared key: SHA-256 of the outer padded key
 * followed by the inner digest, which is SHA-256 of the inner padded key followed by the message.
 *
 * @param key The key's states, from {@link hmacKey}.
 * @param message The message's bytes.
 * @returns The 32-byte tag.
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 * @see https://www.rfc-editor.org/rfc/rfc2104
 */
export const hmac = (key: HmacKey, message: Uint8Array): Uint8Array =>
  bytesOf(finish(key.outer, blockLength, bytesOf(finish(key.inner, blockLength, message))));

/**
 * Compute a message's HMAC-SHA-256 tag under a key.
 *
 * @param key The key's bytes, of any length.
 * @param message The message's bytes.
 * @returns The 32-byte tag.
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 * @see https://www.rfc-editor.org/rfc/rfc2104
 */
export const hmacSha256 = (key: Uint8Array, message: Uint8Array): Uint8Array =>
  hmac(hmacKey(key), message);
