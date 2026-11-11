/**
 * The areas of a `qti-area-map-entry` and whether each holds a point ({@link areaHolds}), a leaf:
 * M1's area tests, which `qti-map-response-point` reads.
 *
 * Every test is decided exactly, at any size: `rect` only compares floats, and `circle`, `ellipse`
 * and `poly` compute on exact integers ({@link onIntegers}), so no test rounds or overflows. The
 * module value-imports only `Array` from `effect`, and the area's type from the item model.
 *
 * @module
 */
import { Array as Arr } from "effect";
import type { AreaMapEntry } from "#plate/model/item.ts";

/**
 * A test of an area's coordinates against a point, each a number in its own place.
 */
type AreaTest<Coordinate> = (
  coords: readonly Coordinate[],
  x: Coordinate,
  y: Coordinate,
) => boolean;

/**
 * A finite float as an integer over a power of two: `[integer, bits]` is `integer / 2^bits`.
 */
type Dyadic = readonly [bigint, number];

/**
 * Give a finite float exactly as an integer over a power of two, by doubling it until it is an
 * integer: 0 doublings for an integer, at most 1074 (the smallest subnormal). Doubling a float that
 * is not an integer is exact, since it is below 2^52 and cannot overflow.
 *
 * @param value The finite float.
 * @returns The integer and the number of doublings.
 */
const dyadicOf = (value: number): Dyadic => {
  let scaled = value;
  let bits = 0;
  while (!Number.isInteger(scaled)) {
    scaled *= 2;
    bits += 1;
  }

  return [BigInt(scaled), bits];
};

/**
 * Multiply an integer by 2 to a whole power, by doubling, since the source guard refuses `**` here.
 *
 * @param integer The integer.
 * @param power The power, 0 or more.
 * @returns `integer · 2^power`.
 */
const timesTwoTo = (integer: bigint, power: number): bigint => {
  let product = integer;
  for (let doubling = 0; doubling < power; doubling += 1) {
    product *= 2n;
  }

  return product;
};

/**
 * Decide an area test on exact integers: every coordinate and the point, each multiplied by one
 * power of two, the least that makes all of them integers (1 when they are, as QTI's always are:
 * `coords` are digits and a point is two integers). Each test below is homogeneous, its two sides
 * of one degree in the numbers, so multiplying every number by one positive factor keeps its
 * answer, and the integer arithmetic then decides it exactly at any size.
 *
 * A coordinate or point that is not finite holds no point. Neither reaches here: a `coords` beyond
 * the largest float reads as that float, and `toFloat` clamps a point's coordinate.
 *
 * @param test The test on integers.
 * @returns The test on floats.
 */
const onIntegers =
  (test: AreaTest<bigint>): AreaTest<number> =>
  (coords, x, y) => {
    if (![x, y, ...coords].every(Number.isFinite)) {
      return false;
    }

    const pointX = dyadicOf(x);
    const pointY = dyadicOf(y);
    const area = coords.map(dyadicOf);
    let scale = Math.max(pointX[1], pointY[1]);
    for (const [, bits] of area) {
      scale = Math.max(scale, bits);
    }

    const exact = ([integer, bits]: Dyadic): bigint => timesTwoTo(integer, scale - bits);

    return test(area.map(exact), exact(pointX), exact(pointY));
  };

/**
 * Square an integer as a product, which the source guard asks for in place of `**`.
 *
 * @param value The integer.
 * @returns `value * value`.
 */
const square = (value: bigint): bigint => value * value;

/**
 * Report whether an integer lies between two ends, in either order, the ends included.
 *
 * @param value The integer.
 * @param end One end.
 * @param otherEnd The other end.
 * @returns Whether `value` is between them.
 */
const between = (value: bigint, end: bigint, otherEnd: bigint): boolean =>
  end <= otherEnd ? end <= value && value <= otherEnd : otherEnd <= value && value <= end;

/**
 * Report whether a point lies on the segment between two vertices, its ends included: on their line
 * (their cross-product is 0) and within their box.
 *
 * @param x The point's x coordinate.
 * @param y The point's y coordinate.
 * @param from One end, as `[x, y]`.
 * @param to The other end.
 * @returns Whether the point is on the segment.
 */
const onSegment = (
  x: bigint,
  y: bigint,
  from: readonly [bigint, bigint],
  to: readonly [bigint, bigint],
): boolean => {
  const [x1, y1] = from;
  const [x2, y2] = to;

  return (x2 - x1) * (y - y1) === (y2 - y1) * (x - x1) && between(x, x1, x2) && between(y, y1, y2);
};

/**
 * Report whether a polygon holds a point: on an edge, or inside by the even-odd rule, as HTML's
 * polygon area is. The last vertex joins the first, so a polygon that is not closed is closed.
 *
 * An edge that spans the point's y crosses the ray to the point's right when the point is left of
 * the edge, `x - x1 < (x2 - x1)(y - y1) / (y2 - y1)`; multiplied through by `y2 - y1`, whose sign
 * turns the comparison, that is the sign of one cross-product, so nothing divides.
 *
 * @param vertices The polygon's vertices, in order.
 * @param x The point's x coordinate.
 * @param y The point's y coordinate.
 * @returns Whether the polygon holds the point.
 * @see https://html.spec.whatwg.org/multipage/image-maps.html#attr-area-shape-poly
 */
const polygonHolds = (
  vertices: readonly (readonly [bigint, bigint])[],
  x: bigint,
  y: bigint,
): boolean => {
  let inside = false;
  for (const [index, to] of vertices.entries()) {
    const from = vertices.at(index - 1) ?? to;
    if (onSegment(x, y, from, to)) {
      return true;
    }

    const [x1, y1] = from;
    const [x2, y2] = to;
    if (y1 > y !== y2 > y) {
      const left = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
      if (y2 > y1 ? left > 0n : left < 0n) {
        inside = !inside;
      }
    }
  }

  return inside;
};

/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure. */
/**
 * Report whether an area of each shape holds a point, its boundary included (9.15's default,
 * reading 52), from the area's coordinates and the point's, as floats.
 *
 * The coordinates are QTI's, which are HTML's: `rect` is left-x, top-y, right-x, bottom-y;
 * `circle` is center-x, center-y, radius; `ellipse` is center-x, center-y, h-radius, v-radius;
 * `poly` is x1, y1, …, xN, yN; `default` holds every point. Where QTI says nothing, HTML's
 * image-map rules decide: an area with fewer coordinates than its shape needs holds no point,
 * coordinates beyond them are ignored (a `poly`'s odd last one too), a `rect`'s corners may come
 * in either order, and a radius of zero or less holds no point.
 *
 * Every test is exact, a boundary point's included, at any size: `rect` only compares, and
 * `circle`, `ellipse` and `poly` compare products of integers ({@link onIntegers}), never a
 * quotient, so nothing rounds and nothing overflows.
 *
 * @see https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model
 */
export const areaHolds: Readonly<Record<AreaMapEntry["shape"], AreaTest<number>>> = {
  circle: onIntegers(
    ([centerX, centerY, radius], x, y) =>
      centerX !== undefined &&
      centerY !== undefined &&
      radius !== undefined &&
      radius > 0n &&
      square(x - centerX) + square(y - centerY) <= square(radius),
  ),
  default: () => true,
  ellipse: onIntegers(
    ([centerX, centerY, across, down], x, y) =>
      centerX !== undefined &&
      centerY !== undefined &&
      across !== undefined &&
      down !== undefined &&
      across > 0n &&
      down > 0n &&
      // (dx / across)² + (dy / down)² <= 1, multiplied through by (across · down)² so nothing
      // divides: in floats (12 / 13)² + (5 / 13)² is 1.0000000000000002, though 12,5 is on the
      // boundary.
      square((x - centerX) * down) + square((y - centerY) * across) <= square(across * down),
  ),
  poly: onIntegers((coords, x, y) => {
    const vertices = Arr.chunksOf(coords, 2).flatMap(([vertexX, vertexY]) =>
      vertexY === undefined ? [] : [[vertexX, vertexY] as const],
    );

    return vertices.length >= 3 && polygonHolds(vertices, x, y);
  }),
  rect: ([left, top, right, bottom], x, y) =>
    left !== undefined &&
    top !== undefined &&
    right !== undefined &&
    bottom !== undefined &&
    Math.min(left, right) <= x &&
    x <= Math.max(left, right) &&
    Math.min(top, bottom) <= y &&
    y <= Math.max(top, bottom),
};
/* oxlint-enable anti-slop/no-shape-in-symbol-names */
