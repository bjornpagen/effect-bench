/**
 * Draw a seed or an instance when the host gives none: {@link drawSeed} and {@link drawInstance}.
 *
 * This is the one place plate draws, at a boundary: `begin` and `startTest` call `drawSeed` when
 * the host passes no seed, `score` when it starts an item with no record, and `render` calls
 * `drawInstance` when the author passes no instance. The engine never calls either: it takes the
 * seed it is given. The module imports nothing; `crypto` is the global Web Crypto object, which
 * Node and every browser page give.
 *
 * @module
 */

/**
 * The number of random bytes a drawn seed holds: 16, so 128 bits.
 */
const seedBytes = 16;

/**
 * Draw a fresh seed: 16 bytes from `crypto.getRandomValues`, written as 32 lowercase hex digits.
 *
 * A seed keys every value template and response processing draw (the HMAC-SHA-256 stream of
 * `#plate/engine/random.ts`), so it is the secret behind them: 128 random bits leave nothing to
 * guess. `crypto.randomUUID` is not used, here or in {@link drawInstance}, because a browser gives
 * it only in a secure context, and the session modules and `render` run in pages.
 *
 * @example
 *   drawSeed(); // "3f9c0a1be47d52c6908e1f2a7b3d4c5e", another every call
 *
 * @returns 32 lowercase hex digits.
 */
export const drawSeed = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(seedBytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * The number of random bytes a drawn instance holds: 16, the bytes of one UUID.
 */
const instanceBytes = 16;

/**
 * Draw a fresh instance token: a lowercase UUID v4 from 16 bytes of `crypto.getRandomValues`.
 *
 * It sets the version nibble to 4 and the variant's top two bits to `10`, so the 13th hex digit is
 * `4` and the 17th is one of `8`, `9`, `a` or `b`, and writes the bytes as
 * `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`, the form `checkInstance` admits. `crypto.randomUUID` is
 * not used, because a browser gives it only in a secure context, and `render` runs in pages served
 * over plain HTTP too.
 *
 * @example
 *   drawInstance(); // "4c7e1a2b-9d3f-4e8a-b6c5-0f1e2d3c4b5a", another every call
 *
 * @returns A lowercase UUID v4.
 */
export const drawInstance = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(instanceBytes));
  // Byte 6's high nibble is the version, 4: keep its low nibble and add 0x40. Byte 8's top two bits
  // are the variant, 10: keep its low six bits and add 0x80.
  bytes[6] = ((bytes[6] ?? 0) % 0x10) + 0x40;
  bytes[8] = ((bytes[8] ?? 0) % 0x40) + 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};
