/*!
 * Plate's own Math is a port of FDLIBM 5.3, https://netlib.org/fdlibm/, from these 21 files:
 * e_rem_pio2.c, k_rem_pio2.c, k_sin.c, k_cos.c, k_tan.c, s_sin.c, s_cos.c, s_tan.c, e_asin.c,
 * e_acos.c, s_atan.c, e_atan2.c, e_exp.c, s_expm1.c, e_log.c, e_log10.c, e_sinh.c, e_cosh.c,
 * s_tanh.c, e_pow.c and s_scalbn.c. They carry these notices.
 *
 * e_rem_pio2.c, k_rem_pio2.c, k_sin.c, k_cos.c, s_sin.c, s_cos.c, s_tan.c, e_asin.c, e_acos.c,
 * s_atan.c, e_atan2.c, e_log.c, e_log10.c, e_sinh.c, e_cosh.c, s_tanh.c and s_scalbn.c:
 *
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * e_exp.c, s_expm1.c and e_pow.c:
 *
 * ====================================================
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * k_tan.c:
 *
 * ====================================================
 * Copyright 2004 Sun Microsystems, Inc.  All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */
/**
 * Every operation the engine approximates, in one leaf: the decimal form of a float
 * ({@link shortestDecimal}), the case folding of a string ({@link foldCase}), and plate's own Math,
 * `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log10`, `sinh`,
 * `cosh`, `tanh` and `pow`.
 *
 * `shortestDecimal` and `foldCase` read an algorithm the JavaScript engine supplies (its
 * number-to-string conversion, its Unicode case tables), so each is a place where two engines
 * could give different results. No other engine file calls `String` on a number, `toFixed` or
 * `toPrecision`: a family that writes a float calls {@link shortestDecimal}.
 *
 * The Math is FDLIBM 5.3's (OD-P7-6), ported routine by routine, because ECMA-262 leaves every
 * transcendental `Math` member, `Math.pow` and `**` implementation-approximated, and the engines
 * differ (P7-MP). The port uses only operations ECMA-262 defines exactly: `+`, `-`, `*`, `/`, the
 * 32-bit integer operators, and of `Math` only `abs`, `floor`, `ceil`, `trunc`, `sign`, `sqrt`,
 * `min`, `max`, `imul`, `PI` and `E`, never `**`. So its results equal themselves in every
 * conforming engine; they need not equal any engine's `Math`, and no test pins `Math`'s bits.
 * Each function returns IEEE results (NaN, ±∞, ±0), as a libm does; the functions family applies
 * QTI's NULLs over them.
 *
 * Three rules keep the port exact:
 *
 * - Fdlibm reads a double's high and low 32-bit words through pointers (`__HI`, `__LO`); here they go
 *   through one 8-byte `DataView`, every access little-endian by its explicit flag.
 * - Every constant is the shortest decimal literal that reads back to the hexadecimal word fdlibm
 *   states, 17 significant digits or fewer, never fdlibm's 21-digit C literal: ECMA-262 rounds a
 *   literal of more than 20 significant digits in an implementation-defined way (RoundMVResult).
 * - A C cast of a double to `int` is `Math.trunc`; fdlibm's `int` arithmetic is the 32-bit operators,
 *   and its `unsigned` words are read unsigned (`>>>`). `if (huge + x > one)`, which raises C's
 *   inexact flag, is always true where fdlibm writes it, so it is not written.
 *
 * The module imports nothing.
 *
 * @module
 */
/* oxlint-disable no-bitwise, oxc/bad-bitwise-operator, complexity, oxc/approx-constant -- a port of FDLIBM: its routines read and write a double's 32-bit words with the bitwise operators, which are the algorithm, not a slip for logical ones; each keeps fdlibm's branches as written, so it can be read beside its source; and each constant is the word fdlibm states, as its shortest literal, where `Math`'s constants other than `PI` and `E` are outside the exact operations. */

/**
 * Write a float in its shortest decimal form: the fewest significant digits that read back as the
 * same double, as `String` writes a number (`1.5`, `100`, `1e+21`, `0.30000000000000004`, and `0`
 * for `-0`).
 *
 * It is the decimal step of the rounding basis and of reading 54's default float form. It
 * delegates to `String` today, so it is exactly what the engine running it writes.
 *
 * @param x The float.
 * @returns Its shortest decimal form.
 */
// oxlint-disable-next-line unicorn/prefer-native-coercion-functions -- `shortestDecimal` names the one float-to-decimal step the engine approximates, so every caller is found in one place and its remedy lands here.
export const shortestDecimal = (x: number): string => String(x);

/**
 * Fold a string's case for a case-insensitive map entry: upper case then lower case, by Unicode's
 * default mappings and independent of locale, so `YORK` and `york`, or `SS` and `ß`, compare
 * equal.
 *
 * @param text The string.
 * @returns Its folded form.
 */
export const foldCase = (text: string): string => text.toUpperCase().toLowerCase();

/**
 * The 8 bytes a double's words are read and written through: the low word at byte 0 and the high
 * word at byte 4, every access little-endian.
 */
const words = new DataView(new ArrayBuffer(8));

/**
 * Read a double's high word, fdlibm's `__HI`: its sign, exponent and first 20 fraction bits.
 *
 * @param x The double.
 * @returns The word, as a signed 32-bit integer.
 */
const highWord = (x: number): number => {
  words.setFloat64(0, x, true);

  return words.getInt32(4, true);
};

/**
 * Read a double's low word, fdlibm's `__LO`: its last 32 fraction bits.
 *
 * @param x The double.
 * @returns The word, as an unsigned 32-bit integer.
 */
const lowWord = (x: number): number => {
  words.setFloat64(0, x, true);

  return words.getUint32(0, true);
};

/**
 * Build the double two words encode.
 *
 * @param high The high word; it is read modulo 2^32.
 * @param low The low word; it is read modulo 2^32.
 * @returns The double.
 */
const fromWords = (high: number, low: number): number => {
  words.setInt32(4, high, true);
  words.setUint32(0, low, true);

  return words.getFloat64(0, true);
};

/**
 * Replace a double's high word, as fdlibm's `__HI(x) = high` does.
 *
 * @param x The double.
 * @param high The new high word.
 * @returns The double with that high word and `x`'s low word.
 */
const withHigh = (x: number, high: number): number => fromWords(high, lowWord(x));

/**
 * Clear a double's low word, as fdlibm's `__LO(x) = 0` does.
 *
 * @param x The double.
 * @returns The double with `x`'s high word and a low word of 0.
 */
const withoutLow = (x: number): number => fromWords(highWord(x), 0);

const zero = 0;

const half = 0.5;

const one = 1;

const two = 2;

const huge = 1e300;

const tiny = 1e-300;

/**
 * 2^24, `0x41700000 00000000`.
 */
const two24 = 16_777_216;

/**
 * 2^-24, `0x3e700000 00000000`.
 */
const twon24 = 5.960464477539063e-8;

/**
 * 2^53, `0x43400000 00000000`.
 */
const two53 = 9_007_199_254_740_992;

/**
 * 2^54, `0x43500000 00000000`.
 */
const two54 = 18_014_398_509_481_984;

/**
 * 2^-54, `0x3c900000 00000000`.
 */
const twom54 = 5.551115123125783e-17;

/**
 * 2^-1000, `0x01700000 00000000`.
 */
const twom1000 = 9.332636185032189e-302;

/**
 * π's double, `0x400921fb 54442d18`.
 */
const pi = 3.141592653589793;

/**
 * π/2's double, `0x3ff921fb 54442d18`.
 */
const pio2_hi = 1.5707963267948966;

/**
 * π/2 less {@link pio2_hi}, `0x3c91a626 33145c07`.
 */
const pio2_lo = 6.123233995736766e-17;

/**
 * π/4's double, `0x3fe921fb 54442d18`.
 */
const pio4_hi = 0.7853981633974483;

/**
 * Ln 2's leading bits, `0x3fe62e42 fee00000`.
 */
const ln2_hi = 0.6931471803691238;

/**
 * Ln 2 less {@link ln2_hi}, `0x3dea39ef 35793c76`.
 */
const ln2_lo = 1.9082149292705877e-10;

/**
 * 1/ln 2, `0x3ff71547 652b82fe`.
 */
const invln2 = 1.4426950408889634;

/**
 * The largest argument whose `exp` is finite, `0x40862e42 fefa39ef`.
 */
const o_threshold = 709.782712893384;

/**
 * Report whether `x` is negative, so a result takes its sign, as C's `copysign(magnitude, x)`.
 *
 * @param magnitude The magnitude.
 * @param x The double whose sign the result takes.
 * @returns `magnitude` with `x`'s sign.
 */
const copysign = (magnitude: number, x: number): number =>
  highWord(x) < 0 ? -magnitude : magnitude;

/**
 * `x · 2^n`, computed from the exponent bits (s_scalbn.c).
 *
 * @param value X.
 * @param n The power of 2.
 * @returns X scaled by 2^n, overflowing to ±∞ and underflowing to ±0 as IEEE does.
 */
const scalbn = (value: number, n: number): number => {
  let x = value;
  let hx = highWord(x);
  const lx = lowWord(x);
  // Extract the exponent.
  let k = (hx & 0x7f_f0_00_00) >> 20;

  if (k === 0) {
    // 0 or a subnormal x.
    if ((lx | (hx & 0x7f_ff_ff_ff)) === 0) {
      return x;
    }

    x *= two54;
    hx = highWord(x);
    k = ((hx & 0x7f_f0_00_00) >> 20) - 54;

    if (n < -50_000) {
      return tiny * x;
    }
  }

  // NaN or ∞.
  if (k === 0x7_ff) {
    return x + x;
  }

  k += n;

  if (k > 0x7_fe) {
    return huge * copysign(huge, x);
  }

  // A normal result.
  if (k > 0) {
    return withHigh(x, (hx & 0x80_0f_ff_ff) | (k << 20));
  }

  if (k <= -54) {
    // n > 50000 guards C's integer overflow in n + k.
    return n > 50_000 ? huge * copysign(huge, x) : tiny * copysign(tiny, x);
  }

  // A subnormal result.
  k += 54;

  return withHigh(x, (hx & 0x80_0f_ff_ff) | (k << 20)) * twom54;
};

/**
 * 2/π in 24-bit chunks, 396 hexadecimal digits (e_rem_pio2.c's `two_over_pi`).
 */
const two_over_pi: readonly number[] = [
  0xa2_f9_83, 0x6e_4e_44, 0x15_29_fc, 0x27_57_d1, 0xf5_34_dd, 0xc0_db_62, 0x95_99_3c, 0x43_90_41,
  0xfe_51_63, 0xab_de_bb, 0xc5_61_b7, 0x24_6e_3a, 0x42_4d_d2, 0xe0_06_49, 0x2e_ea_09, 0xd1_92_1c,
  0xfe_1d_eb, 0x1c_b1_29, 0xa7_3e_e8, 0x82_35_f5, 0x2e_bb_44, 0x84_e9_9c, 0x70_26_b4, 0x5f_7e_41,
  0x39_91_d6, 0x39_83_53, 0x39_f4_9c, 0x84_5f_8b, 0xbd_f9_28, 0x3b_1f_f8, 0x97_ff_de, 0x05_98_0f,
  0xef_2f_11, 0x8b_5a_0a, 0x6d_1f_6d, 0x36_7e_cf, 0x27_cb_09, 0xb7_4f_46, 0x3f_66_9e, 0x5f_ea_2d,
  0x75_27_ba, 0xc7_eb_e5, 0xf1_7b_3d, 0x07_39_f7, 0x8a_52_92, 0xea_6b_fb, 0x5f_b1_1f, 0x8d_5d_08,
  0x56_03_30, 0x46_fc_7b, 0x6b_ab_f0, 0xcf_bc_20, 0x9a_f4_36, 0x1d_a9_e3, 0x91_61_5e, 0xe6_1b_08,
  0x65_99_85, 0x5f_14_a0, 0x68_40_8d, 0xff_d8_80, 0x4d_73_27, 0x31_06_06, 0x15_56_ca, 0x73_a8_c9,
  0x60_e2_7b, 0xc0_8c_6b,
];

/**
 * π/2 in 24-bit chunks (k_rem_pio2.c's `PIo2`), each `0x… 00000000` but its last bits.
 */
const PIo2: readonly number[] = [
  1.570796251296997, 7.549789415861596e-8, 5.390302529957765e-15, 3.282003415807913e-22,
  1.270655753080676e-29, 1.2293330898111133e-36, 2.7337005381646456e-44, 2.1674168387780482e-51,
];

/**
 * Read an entry of an array the loops below index, as C reads it; every index they compute is in
 * range, as fdlibm proves, so the fallback is never taken.
 *
 * @param array The array.
 * @param index The index.
 * @returns The entry.
 */
const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

/**
 * Reduce a large argument by π/2 with Payne-Hanek's method (k_rem_pio2.c, `__kernel_rem_pio2` at
 * `prec` 2, 53 bits, over e_rem_pio2.c's `two_over_pi`).
 *
 * @param x The argument in 24-bit chunks, `x[i] * 2^(e0 - 24 * i)`, its last chunk not zero.
 * @param e0 The exponent of the first chunk, `ilogb(x[0]) - 23`.
 * @param nx The number of chunks, 1 to 3.
 * @returns `[n, y0, y1]`: the last three bits of N in `x - N·π/2`, and the remainder as a head and
 *   a tail.
 */
const kernel_rem_pio2 = (
  x: readonly number[],
  e0: number,
  nx: number,
): readonly [number, number, number] => {
  // init_jk[prec]: the number of terms of two_over_pi taken at first.
  const jk = 4;
  const jp = jk;
  const f = new Float64Array(20);
  const q = new Float64Array(20);
  const fq = new Float64Array(20);
  const iq = new Int32Array(20);
  // Determine jx, jv and q0; 3 > q0.
  const jx = nx - 1;
  const jv = Math.max(Math.trunc((e0 - 3) / 24), 0);
  let q0 = e0 - 24 * (jv + 1);

  // Set up f[0] to f[jx + jk], where f[jx + jk] = two_over_pi[jv + jk].
  for (let i = 0; i <= jx + jk; i += 1) {
    const j = jv - jx + i;

    f[i] = j < 0 ? zero : at(two_over_pi, j);
  }

  // Compute q[0], q[1], ... q[jk].
  for (let i = 0; i <= jk; i += 1) {
    let fw = 0;

    for (let j = 0; j <= jx; j += 1) {
      fw += at(x, j) * at(f, jx + i - j);
    }

    q[i] = fw;
  }

  let jz = jk;
  let z = 0;
  let n = 0;
  let ih = 0;

  // fdlibm's `recompute:` label: the loop runs again where it jumps back.
  for (;;) {
    // Distill q[] into iq[] reversingly.
    z = at(q, jz);

    for (let i = 0; i < jz; i += 1) {
      const fw = Math.trunc(twon24 * z);

      iq[i] = Math.trunc(z - two24 * fw);
      z = at(q, jz - i - 1) + fw;
    }

    // Compute n.
    z = scalbn(z, q0);
    // Trim off the integer part at 8 and above.
    z -= 8 * Math.floor(z * 0.125);
    n = Math.trunc(z);
    z -= n;
    ih = 0;

    if (q0 > 0) {
      // iq[jz - 1] is needed to determine n.
      const i = at(iq, jz - 1) >> (24 - q0);

      n += i;
      iq[jz - 1] = at(iq, jz - 1) - (i << (24 - q0));
      ih = at(iq, jz - 1) >> (23 - q0);
    } else if (q0 === 0) {
      ih = at(iq, jz - 1) >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    // q > 0.5.
    if (ih > 0) {
      n += 1;

      let carry = 0;

      // Compute 1 - q.
      for (let i = 0; i < jz; i += 1) {
        const j = at(iq, i);

        if (carry !== 0) {
          iq[i] = 0xff_ff_ff - j;
        } else if (j !== 0) {
          carry = 1;
          iq[i] = 0x1_00_00_00 - j;
        }
      }

      // The rare case, a chance of 1 in 12.
      if (q0 === 1) {
        iq[jz - 1] = at(iq, jz - 1) & 0x7f_ff_ff;
      } else if (q0 === 2) {
        iq[jz - 1] = at(iq, jz - 1) & 0x3f_ff_ff;
      }

      if (ih === 2) {
        z = one - z;

        if (carry !== 0) {
          z -= scalbn(one, q0);
        }
      }
    }

    // Check whether recomputation is needed.
    if (z !== zero) {
      break;
    }

    let j = 0;

    for (let i = jz - 1; i >= jk; i -= 1) {
      j |= at(iq, i);
    }

    if (j !== 0) {
      break;
    }

    // k is the number of terms needed.
    let k = 1;

    while (at(iq, jk - k) === 0) {
      k += 1;
    }

    // Add q[jz + 1] to q[jz + k].
    for (let i = jz + 1; i <= jz + k; i += 1) {
      f[jx + i] = at(two_over_pi, jv + i);

      let fw = 0;

      for (let jj = 0; jj <= jx; jj += 1) {
        fw += at(x, jj) * at(f, jx + i - jj);
      }

      q[i] = fw;
    }

    jz += k;
  }

  // Chop off zero terms.
  if (z === 0) {
    jz -= 1;
    q0 -= 24;

    while (at(iq, jz) === 0) {
      jz -= 1;
      q0 -= 24;
    }
  } else {
    // Break z into 24-bit chunks if necessary.
    z = scalbn(z, -q0);

    if (z >= two24) {
      const fw = Math.trunc(twon24 * z);

      iq[jz] = Math.trunc(z - two24 * fw);
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else {
      iq[jz] = Math.trunc(z);
    }
  }

  // Convert the integer chunks to floating-point values.
  let fw = scalbn(one, q0);

  for (let i = jz; i >= 0; i -= 1) {
    q[i] = fw * at(iq, i);
    fw *= twon24;
  }

  // Compute PIo2[0, ..., jp] * q[jz, ..., 0].
  for (let i = jz; i >= 0; i -= 1) {
    let sum = 0;

    for (let k = 0; k <= jp && k <= jz - i; k += 1) {
      sum += at(PIo2, k) * at(q, i + k);
    }

    fq[jz - i] = sum;
  }

  // Compress fq[] into y[], as prec 2 does.
  let head = 0;

  for (let i = jz; i >= 0; i -= 1) {
    head += at(fq, i);
  }

  let tail = at(fq, 0) - head;

  for (let i = 1; i <= jz; i += 1) {
    tail += at(fq, i);
  }

  return ih === 0 ? [n & 7, head, tail] : [n & 7, -head, -tail];
};

/**
 * The high words of n·π/2 for n = 1 to 32 (e_rem_pio2.c's `npio2_hw`).
 */
const npio2_hw: readonly number[] = [
  0x3f_f9_21_fb, 0x40_09_21_fb, 0x40_12_d9_7c, 0x40_19_21_fb, 0x40_1f_6a_7a, 0x40_22_d9_7c,
  0x40_25_fd_bb, 0x40_29_21_fb, 0x40_2c_46_3a, 0x40_2f_6a_7a, 0x40_31_47_5c, 0x40_32_d9_7c,
  0x40_34_6b_9c, 0x40_35_fd_bb, 0x40_37_8f_db, 0x40_39_21_fb, 0x40_3a_b4_1b, 0x40_3c_46_3a,
  0x40_3d_d8_5a, 0x40_3f_6a_7a, 0x40_40_7e_4c, 0x40_41_47_5c, 0x40_42_10_6c, 0x40_42_d9_7c,
  0x40_43_a2_8c, 0x40_44_6b_9c, 0x40_45_34_ac, 0x40_45_fd_bb, 0x40_46_c6_cb, 0x40_47_8f_db,
  0x40_48_58_eb, 0x40_49_21_fb,
];

/**
 * 53 bits of 2/π, `0x3fe45f30 6dc9c883`.
 */
const invpio2 = 0.6366197723675814;

/**
 * The first 33 bits of π/2, `0x3ff921fb 54400000`.
 */
const pio2_1 = 1.5707963267341256;

/**
 * π/2 less {@link pio2_1}, `0x3dd0b461 1a626331`.
 */
const pio2_1t = 6.077100506506192e-11;

/**
 * The second 33 bits of π/2, `0x3dd0b461 1a600000`.
 */
const pio2_2 = 6.077100506303966e-11;

/**
 * π/2 less {@link pio2_1} and {@link pio2_2}, `0x3ba3198a 2e037073`.
 */
const pio2_2t = 2.0222662487959506e-21;

/**
 * The third 33 bits of π/2, `0x3ba3198a 2e000000`.
 */
const pio2_3 = 2.0222662487111665e-21;

/**
 * π/2 less {@link pio2_1}, {@link pio2_2} and {@link pio2_3}, `0x397b839a 252049c1`.
 */
const pio2_3t = 8.4784276603689e-32;

/**
 * Reduce an argument by π/2 (e_rem_pio2.c, `__ieee754_rem_pio2`): Cody-Waite with π/2 in three
 * 33-bit parts up to 2^19·π/2, Payne-Hanek ({@link kernel_rem_pio2}) above it, so every finite
 * double gets its true reduction.
 *
 * @param x The argument.
 * @returns `[n, y0, y1]`: `x - n·π/2` as a head `y0` and a tail `y1`, with |y0 + y1| ≤ π/4 or so.
 */
const rem_pio2 = (x: number): readonly [number, number, number] => {
  const hx = highWord(x);
  const ix = hx & 0x7f_ff_ff_ff;

  // |x| ~<= π/4: no need for reduction.
  if (ix <= 0x3f_e9_21_fb) {
    return [0, x, 0];
  }

  // |x| < 3π/4: n is ±1.
  if (ix < 0x40_02_d9_7c) {
    if (hx > 0) {
      const near = x - pio2_1;

      // 33 + 53 bits of π are good enough.
      if (ix !== 0x3f_f9_21_fb) {
        const y0 = near - pio2_1t;

        return [1, y0, near - y0 - pio2_1t];
      }

      // Near π/2: 33 + 33 + 53 bits of π.
      const nearer = near - pio2_2;
      const y0 = nearer - pio2_2t;

      return [1, y0, nearer - y0 - pio2_2t];
    }

    const near = x + pio2_1;

    if (ix !== 0x3f_f9_21_fb) {
      const y0 = near + pio2_1t;

      return [-1, y0, near - y0 + pio2_1t];
    }

    const nearer = near + pio2_2;
    const y0 = nearer + pio2_2t;

    return [-1, y0, nearer - y0 + pio2_2t];
  }

  // |x| ~<= 2^19·(π/2): medium size.
  if (ix <= 0x41_39_21_fb) {
    const t = Math.abs(x);
    const n = Math.trunc(t * invpio2 + half);
    const fn = n;
    let r = t - fn * pio2_1;
    // The first round, good to 85 bits.
    let w = fn * pio2_1t;
    let y0 = r - w;

    // Unless a quick check shows no cancellation.
    if (n >= 32 || ix === npio2_hw[n - 1]) {
      const j = ix >> 20;
      let i = j - ((highWord(y0) >> 20) & 0x7_ff);

      // A second iteration is needed, good to 118 bits.
      if (i > 16) {
        let before = r;

        w = fn * pio2_2;
        r = before - w;
        w = fn * pio2_2t - (before - r - w);
        y0 = r - w;
        i = j - ((highWord(y0) >> 20) & 0x7_ff);

        // A third iteration is needed, 151 bits, which covers every case.
        if (i > 49) {
          before = r;
          w = fn * pio2_3;
          r = before - w;
          w = fn * pio2_3t - (before - r - w);
          y0 = r - w;
        }
      }
    }

    const y1 = r - y0 - w;

    return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
  }

  // x is ∞ or NaN.
  if (ix >= 0x7f_f0_00_00) {
    const nan = x - x;

    return [0, nan, nan];
  }

  // Every other, large, argument: z = scalbn(|x|, ilogb(x) - 23), then its three 24-bit chunks.
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), lowWord(x));
  const tx0 = Math.trunc(z);

  z = (z - tx0) * two24;

  const tx1 = Math.trunc(z);

  z = (z - tx1) * two24;

  const tx = [tx0, tx1, z];
  let nx = 3;

  // Skip zero terms.
  while (tx[nx - 1] === zero) {
    nx -= 1;
  }

  const [n, y0, y1] = kernel_rem_pio2(tx, e0, nx);

  return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
};

const S1 = -0.16666666666666632;

const S2 = 0.00833333333332249;

const S3 = -0.0001984126982985795;

const S4 = 0.0000027557313707070068;

const S5 = -2.5050760253406863e-8;

const S6 = 1.58969099521155e-10;

/**
 * Sin on [-π/4, π/4] (k_sin.c, `__kernel_sin`): a polynomial of degree 13.
 *
 * @param x The head of the reduced argument.
 * @param y Its tail.
 * @param iy 0 when the tail is zero.
 * @returns Sin(x + y).
 */
const kernel_sin = (x: number, y: number, iy: number): number => {
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // |x| < 2^-27: fdlibm's `(int)x == 0` holds, and it returns x.
  if (ix < 0x3e_40_00_00) {
    return x;
  }

  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));

  if (iy === 0) {
    return x + v * (S1 + z * r);
  }

  return x - (z * (half * y - v * r) - y - v * S1);
};

const C1 = 0.0416666666666666;

const C2 = -0.001388888888887411;

const C3 = 0.00002480158728947673;

const C4 = -2.7557314351390663e-7;

const C5 = 2.087572321298175e-9;

const C6 = -1.1359647557788195e-11;

/**
 * Cos on [-π/4, π/4] (k_cos.c, `__kernel_cos`): a polynomial of degree 14.
 *
 * @param x The head of the reduced argument.
 * @param y Its tail.
 * @returns Cos(x + y).
 */
const kernel_cos = (x: number, y: number): number => {
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // |x| < 2^-27: fdlibm's `(int)x == 0` holds, and it returns 1.
  if (ix < 0x3e_40_00_00) {
    return one;
  }

  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));

  // |x| < 0.3.
  if (ix < 0x3f_d3_33_33) {
    return one - (0.5 * z - (z * r - x * y));
  }

  // qx is 0.28125 above 0.78125, else x/4 with its low word cleared.
  const qx = ix > 0x3f_e9_00_00 ? 0.28125 : fromWords(ix - 0x00_20_00_00, 0);
  const hz = 0.5 * z - qx;
  const a = one - qx;

  return a - (hz - (z * r - x * y));
};

/**
 * K_tan.c's coefficients `T[0]` to `T[12]`.
 */
const T0 = 0.3333333333333341;

const T1 = 0.13333333333320124;

const T2 = 0.05396825397622605;

const T3 = 0.021869488294859542;

const T4 = 0.0088632398235993;

const T5 = 0.0035920791075913124;

const T6 = 0.0014562094543252903;

const T7 = 0.0005880412408202641;

const T8 = 0.0002464631348184699;

const T9 = 0.00007817944429395571;

const T10 = 0.00007140724913826082;

const T11 = -0.000018558637485527546;

const T12 = 0.00002590730518636337;

/**
 * π/4 less {@link pio4_hi}, `0x3c81a626 33145c07`.
 */
const pio4lo = 3.061616997868383e-17;

/**
 * Tan on [-π/4, π/4] (k_tan.c, `__kernel_tan`, 5.3's fixed version): an odd polynomial of degree
 * 27, and tan(π/4 - y) above 0.6744.
 *
 * @param head The head of the reduced argument.
 * @param tail Its tail.
 * @param iy 1 for tan, -1 for -1/tan.
 * @returns Tan(head + tail), or -1/tan(head + tail).
 */
const kernel_tan = (head: number, tail: number, iy: number): number => {
  const hx = highWord(head);
  const ix = hx & 0x7f_ff_ff_ff;

  // |x| < 2^-28: fdlibm's `(int)x == 0` holds.
  if (ix < 0x3e_30_00_00) {
    if ((ix | lowWord(head) | (iy + 1)) === 0) {
      return one / Math.abs(head);
    }

    if (iy === 1) {
      return head;
    }

    // Compute -1 / (x + y) carefully.
    const w = head + tail;
    const z = withoutLow(w);
    const v = tail - (z - head);
    const a = -one / w;
    const t = withoutLow(a);
    const s = one + t * z;

    return t + a * (s + t * v);
  }

  let x = head;
  let y = tail;

  // |x| >= 0.6744: tan(x) = tan(π/4 - y).
  if (ix >= 0x3f_e5_94_28) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }

    const z = pio4_hi - x;
    const w = pio4lo - y;

    x = z + w;
    y = 0;
  }

  const z = x * x;
  const w = z * z;
  // x^5 · (T[1] + x^2·T[2] + ...) as x^5 · (T[1] + x^4·T[3] + ... + x^20·T[11]) plus
  // x^5 · x^2 · (T[2] + x^4·T[4] + ... + x^22·T[12]).
  let r = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
  let v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
  const s = z * x;

  r = y + z * (s * (r + v) + y);
  r += T0 * s;

  const sum = x + r;

  if (ix >= 0x3f_e5_94_28) {
    v = iy;

    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((sum * sum) / (sum + v) - r)));
  }

  if (iy === 1) {
    return sum;
  }

  // Compute -1 / (x + r) accurately.
  const zz = withoutLow(sum);
  const vv = r - (zz - x);
  const a = -1 / sum;
  const t = withoutLow(a);
  const ss = 1 + t * zz;

  return t + a * (ss + t * vv);
};

/**
 * Sin (s_sin.c): reduced by π/2, then {@link kernel_sin} or {@link kernel_cos} by the quadrant.
 *
 * @param x The angle, in radians.
 * @returns Sin(x); NaN for ±∞ and NaN.
 */
export const sin = (x: number): number => {
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // |x| ~<= π/4.
  if (ix <= 0x3f_e9_21_fb) {
    return kernel_sin(x, zero, 0);
  }

  // sin(∞ or NaN) is NaN.
  if (ix >= 0x7f_f0_00_00) {
    return x - x;
  }

  const [n, y0, y1] = rem_pio2(x);

  switch (n & 3) {
    case 0: {
      return kernel_sin(y0, y1, 1);
    }
    case 1: {
      return kernel_cos(y0, y1);
    }
    case 2: {
      return -kernel_sin(y0, y1, 1);
    }
    default: {
      return -kernel_cos(y0, y1);
    }
  }
};

/**
 * Cos (s_cos.c): reduced by π/2, then {@link kernel_cos} or {@link kernel_sin} by the quadrant.
 *
 * @param x The angle, in radians.
 * @returns Cos(x); NaN for ±∞ and NaN.
 */
export const cos = (x: number): number => {
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // |x| ~<= π/4.
  if (ix <= 0x3f_e9_21_fb) {
    return kernel_cos(x, zero);
  }

  // cos(∞ or NaN) is NaN.
  if (ix >= 0x7f_f0_00_00) {
    return x - x;
  }

  const [n, y0, y1] = rem_pio2(x);

  switch (n & 3) {
    case 0: {
      return kernel_cos(y0, y1);
    }
    case 1: {
      return -kernel_sin(y0, y1, 1);
    }
    case 2: {
      return -kernel_cos(y0, y1);
    }
    default: {
      return kernel_sin(y0, y1, 1);
    }
  }
};

/**
 * Tan (s_tan.c): reduced by π/2, then {@link kernel_tan}, as tan for an even quadrant and -1/tan
 * for an odd one.
 *
 * @param x The angle, in radians.
 * @returns Tan(x); NaN for ±∞ and NaN.
 */
export const tan = (x: number): number => {
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // |x| ~<= π/4.
  if (ix <= 0x3f_e9_21_fb) {
    return kernel_tan(x, zero, 1);
  }

  // tan(∞ or NaN) is NaN.
  if (ix >= 0x7f_f0_00_00) {
    return x - x;
  }

  const [n, y0, y1] = rem_pio2(x);

  // 1 when n is even, -1 when it is odd.
  return kernel_tan(y0, y1, 1 - ((n & 1) << 1));
};

const pS0 = 0.16666666666666666;

const pS1 = -0.3255658186224009;

const pS2 = 0.20121253213486293;

const pS3 = -0.04005553450067941;

const pS4 = 0.0007915349942898145;

const pS5 = 0.00003479331075960212;

const qS1 = -2.403394911734414;

const qS2 = 2.0209457602335057;

const qS3 = -0.6882839716054533;

const qS4 = 0.07703815055590194;

/**
 * The numerator of the rational R(t) that {@link asin} and {@link acos} share (e_asin.c, e_acos.c).
 *
 * @param t The square of the reduced argument.
 * @returns T·(pS0 + t·(pS1 + ...)).
 */
const asinP = (t: number): number =>
  t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));

/**
 * The denominator of the rational R(t) that {@link asin} and {@link acos} share.
 *
 * @param t The square of the reduced argument.
 * @returns 1 + t·(qS1 + t·(qS2 + ...)).
 */
const asinQ = (t: number): number => one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));

/**
 * Asin (e_asin.c, `__ieee754_asin`): a rational below 0.5, the half-angle identity through `sqrt`
 * above it.
 *
 * @param x The sine, in [-1, 1].
 * @returns Asin(x) in [-π/2, π/2]; NaN outside [-1, 1] and for NaN.
 */
export const asin = (x: number): number => {
  const hx = highWord(x);
  const ix = hx & 0x7f_ff_ff_ff;

  // |x| >= 1.
  if (ix >= 0x3f_f0_00_00) {
    // asin(±1) is ±π/2.
    if (((ix - 0x3f_f0_00_00) | lowWord(x)) === 0) {
      return x * pio2_hi + x * pio2_lo;
    }

    // asin(|x| > 1) is NaN.
    return (x - x) / (x - x);
  }

  // |x| < 0.5.
  if (ix < 0x3f_e0_00_00) {
    // |x| < 2^-27.
    if (ix < 0x3e_40_00_00) {
      return x;
    }

    const t = x * x;
    const w = asinP(t) / asinQ(t);

    return x + x * w;
  }

  // 1 > |x| >= 0.5.
  const t = (one - Math.abs(x)) * 0.5;
  const p = asinP(t);
  const q = asinQ(t);
  const s = Math.sqrt(t);
  let result = 0;

  // |x| > 0.975.
  if (ix >= 0x3f_ef_33_33) {
    const w = p / q;

    result = pio2_hi - (2 * (s + s * w) - pio2_lo);
  } else {
    const w = withoutLow(s);
    const c = (t - w * w) / (s + w);
    const r = p / q;
    const pp = 2 * s * r - (pio2_lo - 2 * c);
    const qq = pio4_hi - 2 * w;

    result = pio4_hi - (pp - qq);
  }

  return hx > 0 ? result : -result;
};

/**
 * Acos (e_acos.c, `__ieee754_acos`): π/2 less a rational below 0.5, the half-angle identity through
 * `sqrt` above it.
 *
 * @param x The cosine, in [-1, 1].
 * @returns Acos(x) in [0, π]; NaN outside [-1, 1] and for NaN.
 */
export const acos = (x: number): number => {
  const hx = highWord(x);
  const ix = hx & 0x7f_ff_ff_ff;

  // |x| >= 1.
  if (ix >= 0x3f_f0_00_00) {
    // |x| is 1: acos(1) is 0, and acos(-1) is π.
    if (((ix - 0x3f_f0_00_00) | lowWord(x)) === 0) {
      return hx > 0 ? 0 : pi + 2 * pio2_lo;
    }

    // acos(|x| > 1) is NaN.
    return (x - x) / (x - x);
  }

  // |x| < 0.5.
  if (ix < 0x3f_e0_00_00) {
    // |x| < 2^-57.
    if (ix <= 0x3c_60_00_00) {
      return pio2_hi + pio2_lo;
    }

    const z = x * x;
    const r = asinP(z) / asinQ(z);

    return pio2_hi - (x - (pio2_lo - x * r));
  }

  // x < -0.5.
  if (hx < 0) {
    const z = (one + x) * 0.5;
    const s = Math.sqrt(z);
    const r = asinP(z) / asinQ(z);
    const w = r * s - pio2_lo;

    return pi - 2 * (s + w);
  }

  // x > 0.5.
  const z = (one - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withoutLow(s);
  const c = (z - df * df) / (s + df);
  const r = asinP(z) / asinQ(z);
  const w = r * s + c;

  return 2 * (df + w);
};

/**
 * Atan(0.5), atan(1), atan(1.5) and atan(∞), leading bits (s_atan.c's `atanhi`).
 */
const atanhi = [
  0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966,
] as const;

/**
 * The same four, less their {@link atanhi} (s_atan.c's `atanlo`).
 */
const atanlo = [
  2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17,
] as const;

const aT0 = 0.3333333333333293;

const aT1 = -0.19999999999876483;

const aT2 = 0.14285714272503466;

const aT3 = -0.11111110405462356;

const aT4 = 0.09090887133436507;

const aT5 = -0.0769187620504483;

const aT6 = 0.06661073137387531;

const aT7 = -0.058335701337905735;

const aT8 = 0.049768779946159324;

const aT9 = -0.036531572744216916;

const aT10 = 0.016285820115365782;

/**
 * Atan (s_atan.c): the argument is reduced to one of five intervals, then a polynomial of degree
 * 22 in odd and even halves.
 *
 * @param value The tangent.
 * @returns Atan(x) in [-π/2, π/2]; NaN for NaN.
 */
export const atan = (value: number): number => {
  const hx = highWord(value);
  const ix = hx & 0x7f_ff_ff_ff;
  let x = value;
  let id: -1 | 0 | 1 | 2 | 3 = -1;

  // |x| >= 2^66.
  if (ix >= 0x44_10_00_00) {
    // NaN.
    if (ix > 0x7f_f0_00_00 || (ix === 0x7f_f0_00_00 && lowWord(x) !== 0)) {
      return x + x;
    }

    return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  }

  // |x| < 0.4375.
  if (ix < 0x3f_dc_00_00) {
    // |x| < 2^-29.
    if (ix < 0x3e_20_00_00) {
      return x;
    }
  } else {
    x = Math.abs(x);

    if (ix < 0x3f_f3_00_00) {
      // 7/16 <= |x| < 11/16, then 11/16 <= |x| < 19/16.
      if (ix < 0x3f_e6_00_00) {
        id = 0;
        x = (2 * x - one) / (2 + x);
      } else {
        id = 1;
        x = (x - one) / (x + one);
      }
    } else if (ix < 0x40_03_80_00) {
      // |x| < 2.4375.
      id = 2;
      x = (x - 1.5) / (one + 1.5 * x);
    } else {
      // 2.4375 <= |x| < 2^66.
      id = 3;
      x = -1 / x;
    }
  }

  // The argument is reduced.
  const z = x * x;
  const w = z * z;
  // The sum of aT[i]·z^(i+1) for i = 0 to 10, as odd and even polynomials.
  const s1 = z * (aT0 + w * (aT2 + w * (aT4 + w * (aT6 + w * (aT8 + w * aT10)))));
  const s2 = w * (aT1 + w * (aT3 + w * (aT5 + w * (aT7 + w * aT9))));

  if (id === -1) {
    return x - x * (s1 + s2);
  }

  const result = atanhi[id] - (x * (s1 + s2) - atanlo[id] - x);

  return hx < 0 ? -result : result;
};

/**
 * π less {@link pi}, `0x3ca1a626 33145c07`.
 */
const pi_lo = 1.2246467991473532e-16;

/**
 * Atan2 (e_atan2.c, `__ieee754_atan2`): fdlibm's special cases, the table QTI lists, then
 * atan(|y/x|) placed in its quadrant.
 *
 * @param y The ordinate.
 * @param x The abscissa.
 * @returns The angle of (x, y) in [-π, π]; NaN when either is NaN.
 */
export const atan2 = (y: number, x: number): number => {
  const hx = highWord(x);
  const ix = hx & 0x7f_ff_ff_ff;
  const lx = lowWord(x);
  const hy = highWord(y);
  const iy = hy & 0x7f_ff_ff_ff;
  const ly = lowWord(y);

  // x or y is NaN.
  if ((ix | ((lx | -lx) >>> 31)) > 0x7f_f0_00_00 || (iy | ((ly | -ly) >>> 31)) > 0x7f_f0_00_00) {
    return x + y;
  }

  // x is 1.
  if (((hx - 0x3f_f0_00_00) | lx) === 0) {
    return atan(y);
  }

  // 2·sign(x) + sign(y).
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);

  // y is 0: atan(±0, +anything) is ±0, atan(+0, -anything) is π, atan(-0, -anything) is -π.
  if ((iy | ly) === 0) {
    if (m < 2) {
      return y;
    }

    return m === 2 ? pi + tiny : -pi - tiny;
  }

  // x is 0.
  if ((ix | lx) === 0) {
    return hy < 0 ? -pio2_hi - tiny : pio2_hi + tiny;
  }

  // x is ∞.
  if (ix === 0x7f_f0_00_00) {
    if (iy === 0x7f_f0_00_00) {
      switch (m) {
        case 0: {
          return pio4_hi + tiny;
        }
        case 1: {
          return -pio4_hi - tiny;
        }
        case 2: {
          return 3 * pio4_hi + tiny;
        }
        default: {
          return -3 * pio4_hi - tiny;
        }
      }
    }

    switch (m) {
      case 0: {
        return zero;
      }
      case 1: {
        return -zero;
      }
      case 2: {
        return pi + tiny;
      }
      default: {
        return -pi - tiny;
      }
    }
  }

  // y is ∞.
  if (iy === 0x7f_f0_00_00) {
    return hy < 0 ? -pio2_hi - tiny : pio2_hi + tiny;
  }

  // Compute y/x.
  const k = (iy - ix) >> 20;
  let z = 0;

  if (k > 60) {
    // |y/x| > 2^60.
    z = pio2_hi + 0.5 * pi_lo;
  } else if (hx < 0 && k < -60) {
    // |y|/x < -2^60.
    z = 0;
  } else {
    // Safe to compute y/x.
    z = atan(Math.abs(y / x));
  }

  switch (m) {
    case 0: {
      return z;
    }
    case 1: {
      // fdlibm flips the sign bit: `__HI(z) ^= 0x80000000`.
      return -z;
    }
    case 2: {
      return pi - (z - pi_lo);
    }
    default: {
      return z - pi_lo - pi;
    }
  }
};

/**
 * The argument below which `exp` underflows to 0, `0xc0874910 d52d3051`.
 */
const u_threshold = -745.1332191019411;

/**
 * Ln 2's leading bits, then its negation, by the sign of the argument (e_exp.c's `ln2HI`).
 */
const ln2HI = [ln2_hi, -ln2_hi] as const;

/**
 * Ln 2's tail, then its negation (e_exp.c's `ln2LO`).
 */
const ln2LO = [ln2_lo, -ln2_lo] as const;

/**
 * 0.5, then -0.5 (e_exp.c's `halF`).
 */
const halF = [0.5, -0.5] as const;

const P1 = 0.16666666666666602;

const P2 = -0.0027777777777015593;

const P3 = 0.00006613756321437934;

const P4 = -0.0000016533902205465252;

const P5 = 4.1381367970572385e-8;

/**
 * Exp (e_exp.c, `__ieee754_exp`): x = k·ln2 + r with ln 2 in two parts, a rational of r, then k
 * added to the result's exponent.
 *
 * @param value The exponent.
 * @returns E^x; +∞ above 709.78..., +0 below -745.13..., NaN for NaN.
 */
export const exp = (value: number): number => {
  let x = value;
  const word = highWord(x);
  // The sign bit of x.
  const xsb = word < 0 ? 1 : 0;
  // The high word of |x|.
  const hx = word & 0x7f_ff_ff_ff;

  // Filter out the non-finite argument: |x| >= 709.78...
  if (hx >= 0x40_86_2e_42) {
    if (hx >= 0x7f_f0_00_00) {
      // NaN.
      if (((hx & 0xf_ff_ff) | lowWord(x)) !== 0) {
        return x + x;
      }

      // exp(±∞) is ∞ or 0.
      return xsb === 0 ? x : 0;
    }

    if (x > o_threshold) {
      return huge * huge;
    }

    if (x < u_threshold) {
      return twom1000 * twom1000;
    }
  }

  let k = 0;
  let hi = 0;
  let lo = 0;

  // The argument reduction, when |x| > 0.5·ln2.
  if (hx > 0x3f_d6_2e_42) {
    // And |x| < 1.5·ln2.
    if (hx < 0x3f_f0_a2_b2) {
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(invln2 * x + halF[xsb]);

      const t = k;

      // t·ln2HI is exact here.
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }

    x = hi - lo;
  } else if (hx < 0x3e_30_00_00) {
    // |x| < 2^-28.
    return one + x;
  }

  // x is now in the primary range.
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));

  if (k === 0) {
    return one - ((x * c) / (c - 2) - x);
  }

  const y = one - (lo - (x * c) / (2 - c) - hi);

  // Add k to y's exponent.
  if (k >= -1021) {
    return withHigh(y, highWord(y) + (k << 20));
  }

  return withHigh(y, highWord(y) + ((k + 1000) << 20)) * twom1000;
};

const Q1 = -0.03333333333333313;

const Q2 = 0.0015873015872548146;

const Q3 = -0.0000793650757867488;

const Q4 = 0.000004008217827329362;

const Q5 = -2.0109921818362437e-7;

/**
 * E^x - 1 (s_expm1.c), accurate near 0, where `exp(x) - 1` cancels: the helper `sinh`, `cosh` and
 * `tanh` run.
 *
 * @param value The exponent.
 * @returns E^x - 1; +∞ above 709.78..., -1 below -56·ln2, NaN for NaN.
 */
export const expm1 = (value: number): number => {
  let x = value;
  const word = highWord(x);
  const negative = word < 0;
  // The high word of |x|.
  const hx = word & 0x7f_ff_ff_ff;

  // Filter out the huge and non-finite argument: |x| >= 56·ln2.
  if (hx >= 0x40_43_68_7a) {
    // |x| >= 709.78...
    if (hx >= 0x40_86_2e_42) {
      if (hx >= 0x7f_f0_00_00) {
        // NaN.
        if (((hx & 0xf_ff_ff) | lowWord(x)) !== 0) {
          return x + x;
        }

        // expm1(±∞) is ∞ or -1.
        return negative ? -1 : x;
      }

      if (x > o_threshold) {
        return huge * huge;
      }
    }

    // x < -56·ln2: -1, where fdlibm's `x + tiny < 0` holds.
    if (negative) {
      return tiny - one;
    }
  }

  let k = 0;
  let c = 0;

  // The argument reduction, when |x| > 0.5·ln2.
  if (hx > 0x3f_d6_2e_42) {
    let hi = 0;
    let lo = 0;

    // And |x| < 1.5·ln2.
    if (hx < 0x3f_f0_a2_b2) {
      if (negative) {
        hi = x + ln2_hi;
        lo = -ln2_lo;
        k = -1;
      } else {
        hi = x - ln2_hi;
        lo = ln2_lo;
        k = 1;
      }
    } else {
      k = Math.trunc(invln2 * x + (negative ? -0.5 : 0.5));

      const t = k;

      // t·ln2_hi is exact here.
      hi = x - t * ln2_hi;
      lo = t * ln2_lo;
    }

    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 0x3c_90_00_00) {
    // |x| < 2^-54: x.
    const t = huge + x;

    return x - (t - (huge + x));
  }

  // x is now in the primary range.
  const hfx = 0.5 * x;
  const hxs = x * hfx;
  const r1 = one + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  const t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));

  // c is 0.
  if (k === 0) {
    return x - (x * e - hxs);
  }

  e = x * (e - c) - c;
  e -= hxs;

  if (k === -1) {
    return 0.5 * (x - e) - 0.5;
  }

  if (k === 1) {
    return x < -0.25 ? -2 * (e - (x + 0.5)) : one + 2 * (x - e);
  }

  // exp(x) - 1 is enough.
  if (k <= -2 || k > 56) {
    const y = one - (e - x);

    // Add k to y's exponent.
    return withHigh(y, highWord(y) + (k << 20)) - one;
  }

  if (k < 20) {
    // 1 - 2^-k.
    const scale = fromWords(0x3f_f0_00_00 - (0x20_00_00 >> k), 0);
    const y = scale - (e - x);

    return withHigh(y, highWord(y) + (k << 20));
  }

  // 2^-k.
  const scale = fromWords((0x3_ff - k) << 20, 0);
  const y = x - (e + scale) + one;

  return withHigh(y, highWord(y) + (k << 20));
};

const Lg1 = 0.6666666666666735;

const Lg2 = 0.3999999999940942;

const Lg3 = 0.2857142874366239;

const Lg4 = 0.22222198432149784;

const Lg5 = 0.1818357216161805;

const Lg6 = 0.15313837699209373;

const Lg7 = 0.14798198605116586;

/**
 * The natural logarithm (e_log.c, `__ieee754_log`): the exponent is split from the bits, then a
 * polynomial of s = f/(2 + f) over the fraction f.
 *
 * @param value The argument.
 * @returns Ln x; -∞ for ±0, NaN below 0 and for NaN.
 */
export const log = (value: number): number => {
  let x = value;
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;

  // x < 2^-1022.
  if (hx < 0x00_10_00_00) {
    // log(±0) is -∞.
    if (((hx & 0x7f_ff_ff_ff) | lx) === 0) {
      return -two54 / zero;
    }

    // log(-#) is NaN.
    if (hx < 0) {
      return (x - x) / zero;
    }

    // A subnormal number: scale x up.
    k -= 54;
    x *= two54;
    hx = highWord(x);
  }

  if (hx >= 0x7f_f0_00_00) {
    return x + x;
  }

  k += (hx >> 20) - 1023;
  hx &= 0x00_0f_ff_ff;

  const i = (hx + 0x9_5f_64) & 0x10_00_00;

  // Normalize x or x/2.
  x = withHigh(x, hx | (i ^ 0x3f_f0_00_00));
  k += i >> 20;

  const f = x - 1;
  const dk = k;

  // |f| < 2^-20.
  if ((0x00_0f_ff_ff & (2 + hx)) < 3) {
    if (f === zero) {
      return k === 0 ? zero : dk * ln2_hi + dk * ln2_lo;
    }

    const R = f * f * (0.5 - 0.3333333333333333 * f);

    return k === 0 ? f - R : dk * ln2_hi - (R - dk * ln2_lo - f);
  }

  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  const R = t2 + t1;

  if (((hx - 0x6_14_7a) | (0x6_b8_51 - hx)) > 0) {
    const hfsq = 0.5 * f * f;

    return k === 0
      ? f - (hfsq - s * (hfsq + R))
      : dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
  }

  return k === 0 ? f - s * (f - R) : dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
};

/**
 * 1/ln 10, `0x3fdbcb7b 1526e50e`.
 */
const ivln10 = 0.4342944819032518;

/**
 * Log10(2)'s leading bits, `0x3fd34413 509f6000`.
 */
const log10_2hi = 0.30102999566361177;

/**
 * Log10(2) less {@link log10_2hi}, `0x3d59fef3 11f12b36`.
 */
const log10_2lo = 3.694239077158931e-13;

/**
 * The base-10 logarithm (e_log10.c, `__ieee754_log10`): n·log10(2) + log10(x/2^n), so log10(10^n)
 * is n for n = 0 to 22.
 *
 * @param value The argument.
 * @returns Log10(x); -∞ for ±0, NaN below 0 and for NaN.
 */
export const log10 = (value: number): number => {
  let x = value;
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;

  // x < 2^-1022.
  if (hx < 0x00_10_00_00) {
    // log10(±0) is -∞.
    if (((hx & 0x7f_ff_ff_ff) | lx) === 0) {
      return -two54 / zero;
    }

    // log10(-#) is NaN.
    if (hx < 0) {
      return (x - x) / zero;
    }

    // A subnormal number: scale x up.
    k -= 54;
    x *= two54;
    hx = highWord(x);
  }

  if (hx >= 0x7f_f0_00_00) {
    return x + x;
  }

  k += (hx >> 20) - 1023;

  // 1 when k < 0.
  const i = k >>> 31;
  const y = k + i;

  hx = (hx & 0x00_0f_ff_ff) | ((0x3_ff - i) << 20);
  x = withHigh(x, hx);

  const z = y * log10_2lo + ivln10 * log(x);

  return z + y * log10_2hi;
};

/**
 * A magnitude past every finite `sinh`, 1e307.
 */
const shuge = 1e307;

/**
 * Sinh (e_sinh.c, `__ieee754_sinh`): through {@link expm1} below 22, {@link exp} above it, and as
 * a product of two halves near the overflow threshold.
 *
 * @param x The argument.
 * @returns Sinh(x); ±∞ for ±∞, NaN for NaN.
 */
export const sinh = (x: number): number => {
  const jx = highWord(x);
  // The high word of |x|.
  const ix = jx & 0x7f_ff_ff_ff;

  // x is ∞ or NaN.
  if (ix >= 0x7f_f0_00_00) {
    return x + x;
  }

  const h = jx < 0 ? -0.5 : 0.5;

  // |x| in [0, 22]: sign(x)·0.5·(E + E/(E + 1)).
  if (ix < 0x40_36_00_00) {
    // sinh(tiny) is tiny: |x| < 2^-28.
    if (ix < 0x3e_30_00_00) {
      return x;
    }

    const t = expm1(Math.abs(x));

    if (ix < 0x3f_f0_00_00) {
      return h * (2 * t - (t * t) / (t + one));
    }

    return h * (t + t / (t + one));
  }

  // |x| in [22, log(maxdouble)]: 0.5·exp(|x|).
  if (ix < 0x40_86_2e_42) {
    return h * exp(Math.abs(x));
  }

  // |x| in [log(maxdouble), the overflow threshold].
  if (ix < 0x40_86_33_ce || (ix === 0x40_86_33_ce && lowWord(x) <= 0x8f_b9_f8_7d)) {
    const w = exp(0.5 * Math.abs(x));
    const t = h * w;

    return t * w;
  }

  // |x| above the overflow threshold: sinh(x) overflows.
  return x * shuge;
};

/**
 * Cosh (e_cosh.c, `__ieee754_cosh`): through {@link expm1} below 0.5·ln2, {@link exp} above it,
 * and as a product of two halves near the overflow threshold.
 *
 * @param x The argument.
 * @returns Cosh(x); +∞ for ±∞, NaN for NaN.
 */
export const cosh = (x: number): number => {
  // The high word of |x|.
  const ix = highWord(x) & 0x7f_ff_ff_ff;

  // x is ∞ or NaN.
  if (ix >= 0x7f_f0_00_00) {
    return x * x;
  }

  // |x| in [0, 0.5·ln2]: 1 + expm1(|x|)^2 / (2·exp(|x|)).
  if (ix < 0x3f_d6_2e_43) {
    const t = expm1(Math.abs(x));
    const w = one + t;

    // cosh(tiny) is 1.
    if (ix < 0x3c_80_00_00) {
      return w;
    }

    return one + (t * t) / (w + w);
  }

  // |x| in [0.5·ln2, 22]: (exp(|x|) + 1/exp(|x|)) / 2.
  if (ix < 0x40_36_00_00) {
    const t = exp(Math.abs(x));

    return half * t + half / t;
  }

  // |x| in [22, log(maxdouble)]: half·exp(|x|).
  if (ix < 0x40_86_2e_42) {
    return half * exp(Math.abs(x));
  }

  // |x| in [log(maxdouble), the overflow threshold].
  if (ix < 0x40_86_33_ce || (ix === 0x40_86_33_ce && lowWord(x) <= 0x8f_b9_f8_7d)) {
    const w = exp(half * Math.abs(x));
    const t = half * w;

    return t * w;
  }

  // |x| above the overflow threshold: cosh(x) overflows.
  return huge * huge;
};

/**
 * Tanh (s_tanh.c): through {@link expm1} below 22, ±1 above it.
 *
 * @param x The argument.
 * @returns Tanh(x); ±1 for ±∞, NaN for NaN.
 */
export const tanh = (x: number): number => {
  const jx = highWord(x);
  // The high word of |x|.
  const ix = jx & 0x7f_ff_ff_ff;

  // x is ∞ or NaN: tanh(±∞) is ±1, tanh(NaN) is NaN.
  if (ix >= 0x7f_f0_00_00) {
    return jx >= 0 ? one / x + one : one / x - one;
  }

  let z = 0;

  // |x| < 22.
  if (ix < 0x40_36_00_00) {
    // tanh(small) is small: |x| < 2^-55.
    if (ix < 0x3c_80_00_00) {
      return x * (one + x);
    }

    // |x| >= 1.
    if (ix >= 0x3f_f0_00_00) {
      const t = expm1(two * Math.abs(x));

      z = one - two / (t + two);
    } else {
      const t = expm1(-two * Math.abs(x));

      z = -t / (t + two);
    }
  } else {
    // |x| >= 22: ±1.
    z = one - tiny;
  }

  return jx >= 0 ? z : -z;
};

/**
 * 1, then 1.5 (e_pow.c's `bp`).
 */
const bp = [1, 1.5] as const;

/**
 * 0, then log2(1.5)'s leading bits, `0x3fe2b803 40000000` (e_pow.c's `dp_h`).
 */
const dp_h = [0, 0.5849624872207642] as const;

/**
 * 0, then log2(1.5) less its leading bits, `0x3e4cfdeb 43cfd006` (e_pow.c's `dp_l`).
 */
const dp_l = [0, 1.350039202129749e-8] as const;

const L1 = 0.5999999999999946;

const L2 = 0.4285714285785502;

const L3 = 0.33333332981837743;

const L4 = 0.272728123808534;

const L5 = 0.23066074577556175;

const L6 = 0.20697501780033842;

/**
 * Ln 2, `0x3fe62e42 fefa39ef`.
 */
const lg2 = 0.6931471805599453;

/**
 * Ln 2's leading bits, `0x3fe62e43 00000000`.
 */
const lg2_h = 0.6931471824645996;

/**
 * Ln 2 less {@link lg2_h}, `0xbe205c61 0ca86c39`.
 */
const lg2_l = -1.904654299957768e-9;

/**
 * -(1024 - log2(the overflow threshold + 0.5 ulp)), e_pow.c's `ovt`.
 */
const ovt = 8.008566259537294e-17;

/**
 * 2/(3·ln 2), `0x3feec709 dc3a03fd`.
 */
const cp = 0.9617966939259756;

/**
 * {@link cp} as a float, `0x3feec709 e0000000`.
 */
const cp_h = 0.9617967009544373;

/**
 * {@link cp} less {@link cp_h}, `0xbe3e2fe0 145b01f5`.
 */
const cp_l = -7.028461650952758e-9;

/**
 * 1/ln 2's leading 24 bits, `0x3ff71547 60000000`.
 */
const ivln2_h = 1.4426950216293335;

/**
 * 1/ln 2 less {@link ivln2_h}, `0x3e54ae0b f85ddf44`.
 */
const ivln2_l = 1.9259629911266175e-8;

/**
 * Classify y as fdlibm's `pow` does when x < 0 (e_pow.c's `yisint`).
 *
 * @param iy The high word of |y|.
 * @param ly The low word of y.
 * @returns 0 when y is not an integer, 1 when it is odd, 2 when it is even.
 */
const yisintOf = (iy: number, ly: number): number => {
  // An even integer.
  if (iy >= 0x43_40_00_00) {
    return 2;
  }

  if (iy < 0x3f_f0_00_00) {
    return 0;
  }

  // The exponent.
  const k = (iy >> 20) - 0x3_ff;

  if (k > 20) {
    const j = ly >>> (52 - k);

    return (j << (52 - k)) >>> 0 === ly ? 2 - (j & 1) : 0;
  }

  if (ly !== 0) {
    return 0;
  }

  const j = iy >> (20 - k);

  return j << (20 - k) === iy ? 2 - (j & 1) : 0;
};

/**
 * Pow (e_pow.c, `__ieee754_pow`): log2|x| as a head and a tail, y·log2|x| = n + y' with
 * |y'| ≤ 0.5, then 2^n·exp(y'·ln 2). Its special cases are Number::exponentiate's (ECMA-262
 * 6.1.6.1.3), and pow(integer, integer) is exact whenever the result is representable.
 *
 * @param x The base.
 * @param y The exponent.
 * @returns X^y.
 */
export const pow = (x: number, y: number): number => {
  const hx = highWord(x);
  const lx = lowWord(x);
  const hy = highWord(y);
  const ly = lowWord(y);
  const ix = hx & 0x7f_ff_ff_ff;
  const iy = hy & 0x7f_ff_ff_ff;

  // y is ±0: x^0 is 1.
  if ((iy | ly) === 0) {
    return one;
  }

  // ±NaN: x + y.
  if (
    ix > 0x7f_f0_00_00 ||
    (ix === 0x7f_f0_00_00 && lx !== 0) ||
    iy > 0x7f_f0_00_00 ||
    (iy === 0x7f_f0_00_00 && ly !== 0)
  ) {
    return x + y;
  }

  // Whether y is an odd or even integer, when x < 0.
  const yisint = hx < 0 ? yisintOf(iy, ly) : 0;

  // The special values of y.
  if (ly === 0) {
    // y is ±∞.
    if (iy === 0x7f_f0_00_00) {
      // (±1)^±∞ is NaN.
      if (((ix - 0x3f_f0_00_00) | lx) === 0) {
        return y - y;
      }

      // (|x| > 1)^±∞ is ∞ or 0.
      if (ix >= 0x3f_f0_00_00) {
        return hy >= 0 ? y : zero;
      }

      // (|x| < 1)^∓∞ is ∞ or 0.
      return hy < 0 ? -y : zero;
    }

    // y is ±1.
    if (iy === 0x3f_f0_00_00) {
      return hy < 0 ? one / x : x;
    }

    // y is 2.
    if (hy === 0x40_00_00_00) {
      return x * x;
    }

    // y is 0.5 and x >= +0.
    if (hy === 0x3f_e0_00_00 && hx >= 0) {
      return Math.sqrt(x);
    }
  }

  // The special values of x: ±0, ±∞ and ±1.
  if (lx === 0 && (ix === 0x7f_f0_00_00 || ix === 0 || ix === 0x3f_f0_00_00)) {
    // z is 1/|x| when y < 0.
    const z = hy < 0 ? one / Math.abs(x) : Math.abs(x);

    if (hx >= 0) {
      return z;
    }

    // (-1)^non-integer is NaN.
    if (((ix - 0x3f_f0_00_00) | yisint) === 0) {
      return (z - z) / (z - z);
    }

    // (x < 0)^odd is -(|x|^odd).
    return yisint === 1 ? -z : z;
  }

  const n0 = (hx >> 31) + 1;

  // (x < 0)^non-integer is NaN.
  if ((n0 | yisint) === 0) {
    return (x - x) / (x - x);
  }

  // The sign of the result: -1 for (-x)^odd, else 1.
  const s = (n0 | (yisint - 1)) === 0 ? -one : one;
  let t1 = 0;
  let t2 = 0;

  // |y| > 2^31.
  if (iy > 0x41_e0_00_00) {
    // |y| > 2^64 must overflow or underflow.
    if (iy > 0x43_f0_00_00) {
      if (ix <= 0x3f_ef_ff_ff) {
        return hy < 0 ? huge * huge : tiny * tiny;
      }

      if (ix >= 0x3f_f0_00_00) {
        return hy > 0 ? huge * huge : tiny * tiny;
      }
    }

    // Overflow or underflow when x is not close to 1.
    if (ix < 0x3f_ef_ff_ff) {
      return hy < 0 ? s * huge * huge : s * tiny * tiny;
    }

    if (ix > 0x3f_f0_00_00) {
      return hy > 0 ? s * huge * huge : s * tiny * tiny;
    }

    // Now |1 - x| <= 2^-20 is tiny, so log(x) is x - x^2/2 + x^3/3 - x^4/4.
    // t has 20 trailing zeros.
    const t = Math.abs(x) - one;
    const w = t * t * (0.5 - t * (0.3333333333333333 - t * 0.25));
    // ivln2_h has 21 significant bits.
    const u = ivln2_h * t;
    const v = t * ivln2_l - w * invln2;

    t1 = withoutLow(u + v);
    t2 = v - (t1 - u);
  } else {
    let ax = Math.abs(x);
    let n = 0;
    let jx = ix;

    // Take care of a subnormal number.
    if (jx < 0x00_10_00_00) {
      ax *= two53;
      n -= 53;
      jx = highWord(ax);
    }

    n += (jx >> 20) - 0x3_ff;

    const j = jx & 0x00_0f_ff_ff;
    // Determine the interval: k is 1 when sqrt(3/2) <= |x| < sqrt(3), else 0.
    const k = j > 0x3_98_8e && j < 0xb_b6_7a ? 1 : 0;

    // Normalize the high word, halving |x| at sqrt(3) and above.
    jx = j | 0x3f_f0_00_00;

    if (j >= 0xb_b6_7a) {
      n += 1;
      jx -= 0x00_10_00_00;
    }

    ax = withHigh(ax, jx);

    // ss = s_h + s_l = (x - 1)/(x + 1) or (x - 1.5)/(x + 1.5).
    let u = ax - bp[k];
    let v = one / (ax + bp[k]);
    const ss = u * v;
    const s_h = withoutLow(ss);
    // t_h = ax + bp[k], high.
    let t_h = fromWords(((jx >> 1) | 0x20_00_00_00) + 0x00_08_00_00 + (k << 18), 0);
    let t_l = ax - (t_h - bp[k]);
    const s_l = v * (u - s_h * t_h - s_h * t_l);
    // Compute log(ax).
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));

    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = withoutLow(3 + s2 + r);
    t_l = r - (t_h - 3 - s2);
    // u + v = ss·(1 + ...).
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;

    // 2/(3·log2)·(ss + ...).
    const p_h = withoutLow(u + v);
    const p_l = v - (p_h - u);
    // cp_h + cp_l = 2/(3·log2).
    const z_h = cp_h * p_h;
    const z_l = cp_l * p_h + p_l * cp + dp_l[k];
    // log2(ax) = (ss + ...)·2/(3·log2) = n + dp_h + z_h + z_l.
    const t = n;

    t1 = withoutLow(z_h + z_l + dp_h[k] + t);
    t2 = z_l - (t1 - t - dp_h[k] - z_h);
  }

  // Split y into y1 + y2 and compute (y1 + y2)·(t1 + t2).
  const y1 = withoutLow(y);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  let j = highWord(z);
  const i = lowWord(z);

  // z >= 1024.
  if (j >= 0x40_90_00_00) {
    // z > 1024: overflow.
    if (((j - 0x40_90_00_00) | i) !== 0) {
      return s * huge * huge;
    }

    if (p_l + ovt > z - p_h) {
      return s * huge * huge;
    }
  } else if ((j & 0x7f_ff_ff_ff) >= 0x40_90_cc_00) {
    // z <= -1075, and z < -1075: underflow.
    if (((j - 0xc0_90_cc_00) | i) !== 0) {
      return s * tiny * tiny;
    }

    if (p_l <= z - p_h) {
      return s * tiny * tiny;
    }
  }

  // Compute 2^(p_h + p_l).
  const iz = j & 0x7f_ff_ff_ff;
  let k = (iz >> 20) - 0x3_ff;
  let n = 0;

  // |z| > 0.5: n = [z + 0.5].
  if (iz > 0x3f_e0_00_00) {
    n = j + (0x00_10_00_00 >> (k + 1));
    // The new k for n.
    k = ((n & 0x7f_ff_ff_ff) >> 20) - 0x3_ff;

    const t = fromWords(n & ~(0x00_0f_ff_ff >> k), 0);

    n = ((n & 0x00_0f_ff_ff) | 0x00_10_00_00) >> (20 - k);

    if (j < 0) {
      n = -n;
    }

    p_h -= t;
  }

  const t = withoutLow(p_l + p_h);
  const u = t * lg2_h;
  const v = (p_l - (t - p_h)) * lg2 + t * lg2_l;

  z = u + v;

  const w = v - (z - u);
  const tt = z * z;
  const t1z = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * t1z) / (t1z - two) - (w + z * w);

  z = one - (r - z);
  j = highWord(z) + (n << 20);

  // A subnormal output, else add n to z's exponent.
  return s * (j >> 20 <= 0 ? scalbn(z, n) : withHigh(z, j));
};
