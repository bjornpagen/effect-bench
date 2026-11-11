/**
 * The references family of the engine: the evaluators of the expressions that read a variable, a
 * declaration or a literal, `qti-variable`, `qti-correct`, `qti-base-value`, `qti-map-response`,
 * `qti-map-response-point`, `qti-default` and `qti-null`, and of the two that draw from the scope's
 * stream, `qti-random-integer` and `qti-random-float`.
 *
 * In a test's run, a `qti-variable` reads a prefixed name through its item ref and weights it by
 * the item ref's `weight-identifier`; a `qti-correct`, `qti-default`, `qti-map-response` or
 * `qti-map-response-point` of a prefixed name reads the item's declaration and record through the
 * same item ref (`prefixedRead` in `#plate/engine/refs.ts`), and a `qti-correct` or `qti-default`
 * of a variable of base type `file`, or of a record outcome or template variable, reads its NULL.
 * An item's record response is no value: a prefixed name of one, read as a value by any of these,
 * fails, and `qti-field-value`, `qti-is-null` and `qti-match` read its record, its declared correct
 * response or its declared default instead (`recordOrValue` in `#plate/engine/refs.ts`).
 *
 * It value-imports only engine leaves, `#plate/engine/scope.ts` among them,
 * `#plate/model/values.ts` and `effect`'s `Option`, `Array` and `Result`, and reads the
 * evaluator's types from `#plate/engine/evaluate.ts` as types, so the dispatcher's table may
 * import it without a cycle.
 *
 * @module
 */
import { Array as Arr, Option, Result } from "effect";
import type { Declarations, Evaluator, FamilyTable, Variables } from "#plate/engine/evaluate.ts";
import { areaHolds } from "#plate/engine/expressions/shapes.ts";
import { UnknownIdentifierError, UnmappedResponseError } from "#plate/engine/failures.ts";
import type { RecordOperandError } from "#plate/engine/failures.ts";
import { foldCase } from "#plate/engine/math.ts";
import {
  bitLengthOf,
  floatNull,
  floatValue,
  integerBitBound,
  integerNull,
  integerValue,
  numberOf,
  toFloat,
} from "#plate/engine/numbers.ts";
import { drawBelow, drawFloat } from "#plate/engine/random.ts";
import type { Draw } from "#plate/engine/random.ts";
import {
  builtInType,
  own,
  prefixedRead,
  referenceInteger,
  referenceValue,
  variableRead,
} from "#plate/engine/refs.ts";
import type { PrefixedName } from "#plate/engine/refs.ts";
import { weightOf } from "#plate/engine/scope.ts";
import type { FloatOrRef } from "#plate/model/expression.ts";
import type {
  AreaMapping,
  MapEntry,
  Mapping,
  OutcomeDeclaration,
  ResponseDeclaration,
  TemplateDeclaration,
} from "#plate/model/item.ts";
import { format, nullOf, sameSingle } from "#plate/model/values.ts";
import type { Single, Value } from "#plate/model/values.ts";

/**
 * Find the response declaration a `qti-correct`, a `qti-map-response` or a
 * `qti-map-response-point` names.
 *
 * @param item The declarations holder: an item, or a test's outcome declarations, which declare no
 *   response.
 * @param identifier The response's identifier.
 * @returns The declaration, or an {@link UnknownIdentifierError} when the holder declares no
 *   modelled response by that name.
 */
const responseOf = (
  item: Declarations,
  identifier: string,
): Result.Result<ResponseDeclaration, UnknownIdentifierError> =>
  Result.fromOption(
    Option.fromUndefinedOr(item.responses.get(identifier)),
    () => new UnknownIdentifierError({ holder: "item", identifier, role: "response" }),
  );

/**
 * A response of a type the value model holds that a `qti-correct`, a `qti-map-response` or a
 * `qti-map-response-point` names: its declaration; the correct response template processing set
 * for it, if any; its value, if the variables hold one; and whether the name reads the item's one
 * occurrence.
 */
interface HeldResponse {
  readonly correct: Option.Option<Value>;
  readonly declaration: ResponseDeclaration;
  /**
   * Whether the name reads the one occurrence of its item: always for a response the holder
   * declares, and for a prefixed name but `ITEMREF.N.VAR` with `N` other than 1 through an item ref
   * a selection with replacement can repeat, an occurrence that does not exist
   * (`PrefixedName.first` in `#plate/engine/refs.ts`); through any other item ref a numbered name
   * reads no occurrence (reading 88).
   */
  readonly first: boolean;
  readonly kind: "held";
  readonly value: Option.Option<Value>;
}

/**
 * What a `qti-correct`, a `qti-map-response` or a `qti-map-response-point` names: a
 * {@link HeldResponse}; or, in a test's run, `unheld`, a variable a prefixed name reads through its
 * item ref whose declared type the value model does not hold, base type `file`, a record response
 * with a field of it, or a record outcome or template variable, with the NULL a read of it gives
 * (`prefixedRead` in `#plate/engine/refs.ts`); or `built-in`, a built-in variable the run holds,
 * the run's own or an item's through its item ref, with the correct response a `qti-correct` of it
 * reads. The engine holds no declaration of an unheld variable or a built-in, so no mapping or area
 * mapping of it. A prefixed name of an item's record response is none of these: its read fails
 * before ({@link namedResponse}).
 */
type NamedResponse =
  | HeldResponse
  | { readonly correct: Value; readonly kind: "built-in" }
  | { readonly kind: "unheld"; readonly value: Value };

/**
 * Find the response a `qti-correct`, a `qti-map-response` or a `qti-map-response-point` names.
 *
 * A response the holder declares is read from the holder and the variables: the correct response
 * template processing set (`Variables.correct`) and the response's value. A name the holder
 * declares no response by that names a built-in the run holds (`builtInType` in
 * `#plate/engine/refs.ts`) is that built-in, which a `qti-correct` names as a response (reading
 * 111, "a processing element's `identifier` names a variable of the kind the element reads or
 * sets"): its correct response is the one template processing set, else NULL of its type, since no
 * declaration gives it one. In a test's run, whose
 * holder declares no response, a prefixed name is read through its item ref (`prefixedRead` in
 * `#plate/engine/refs.ts`; 0.14 decision 7): the item's declaration of the response it names, the
 * correct response its record's template processing set, and its value in the record. The prefixed
 * read takes the response's value from the record first, so a record that lacks it is the
 * record's gap before the declaration is judged. A prefixed name whose one reading names a
 * variable of base type `file`, or a record outcome or template variable, a mapping target whose
 * source is one included, is `unheld`, with the NULL its read gives (G-R3, pending; G-R4, pending:
 * such a variable reads NULL). One whose reading names an item-session built-in is that built-in,
 * with the correct response its record's template processing set, else NULL of its type, and NULL
 * of its type for `ITEMREF.N.VAR` with `N` other than 1. One that names an item's record response
 * reads a record, no value, and fails as `prefixedRead` fails it.
 *
 * @param item The declarations holder: an item, or a test's outcome declarations, which declare no
 *   response.
 * @param variables The variables of the run.
 * @param identifier The response's identifier, prefixed in a test's run.
 * @returns The response, held or unheld; or an {@link UnknownIdentifierError}: with holder `item`
 *   when the holder, or the item a prefixed name reads through, declares no response by that name
 *   and no variable of a type the value model does not hold, or the one `prefixedRead` gives, with
 *   holder `record`, when no item ref resolves the name or the item's record holds no value of it;
 *   or the {@link RecordOperandError} `prefixedRead` gives when the name reads an item's record
 *   response.
 */
const namedResponse = (
  item: Declarations,
  variables: Variables,
  identifier: string,
): Result.Result<NamedResponse, RecordOperandError | UnknownIdentifierError> => {
  const builtIn = builtInType(variables, identifier);
  if (!item.responses.has(identifier) && Option.isSome(builtIn)) {
    const { baseType, cardinality } = builtIn.value;

    return Result.succeed({
      correct: Option.getOrElse(own(variables.correct, identifier), () =>
        nullOf(baseType, cardinality),
      ),
      kind: "built-in",
    });
  }

  if (item.responses.has(identifier) || variables.test === undefined) {
    return Result.map(responseOf(item, identifier), (declaration) => ({
      correct: own(variables.correct, identifier),
      declaration,
      first: true,
      kind: "held",
      value: own(variables.responses, identifier),
    }));
  }

  return Result.flatMap(
    prefixedRead(variables.test, identifier),
    (read): Result.Result<NamedResponse, RecordOperandError | UnknownIdentifierError> => {
      if (read.named.kind === "unheld") {
        return Result.succeed({ kind: "unheld", value: read.value });
      }

      const { baseType, cardinality } = read.named.type;
      if (read.named.kind === "built-in" && baseType !== "file" && cardinality !== "record") {
        const nothing = nullOf(baseType, cardinality);

        return Result.succeed({
          correct: read.first
            ? Option.getOrElse(own(read.item.record.correct, read.named.identifier), () => nothing)
            : nothing,
          kind: "built-in",
        });
      }

      const declaration =
        read.named.kind === "response"
          ? read.item.declarations.responses.get(read.named.identifier)
          : undefined;

      return declaration === undefined
        ? Result.fail(new UnknownIdentifierError({ holder: "item", identifier, role: "response" }))
        : Result.succeed({
            correct: own(read.item.record.correct, read.named.identifier),
            declaration,
            first: read.first,
            kind: "held",
            value: Option.some(read.value),
          });
    },
  );
};

/**
 * Find the response a `qti-map-response` or a `qti-map-response-point` maps ({@link
 * namedResponse}), which must be held: the engine holds no mapping or area mapping of a variable of
 * base type `file` or cardinality `record`, nor of a built-in, which no declaration gives one, so a
 * name of a built-in, and a prefixed name that reads an unheld variable, fail as a name of no
 * response does, and one that reads an item's record response fails as a value read of it does.
 *
 * @param item The declarations holder.
 * @param variables The variables of the run.
 * @param identifier The response's identifier, prefixed in a test's run.
 * @returns The held response; or an {@link UnknownIdentifierError} with holder `item` when the name
 *   reads an unheld variable or a built-in; or the failure {@link namedResponse} gives.
 */
const heldResponse = (
  item: Declarations,
  variables: Variables,
  identifier: string,
): Result.Result<HeldResponse, RecordOperandError | UnknownIdentifierError> =>
  Result.flatMap(namedResponse(item, variables, identifier), (named) =>
    named.kind === "held"
      ? Result.succeed(named)
      : Result.fail(new UnknownIdentifierError({ holder: "item", identifier, role: "response" })),
  );

/**
 * Give the key {@link distinct} tells a value apart by: its base type and its value as `format`
 * writes it, so two values share a key exactly when {@link sameSingle} finds them equal, however
 * each was written (`+5` and `05` are one integer, `1.0` and `1e0` one float).
 *
 * Where `sameSingle` and `format` part, the key follows `sameSingle`: a `pair`'s identifiers are
 * written in code-unit order, as `sameSingle` matches a pair in either order, and a float's `-0` is
 * written as `0`, as `sameSingle` compares floats with `===`. That `===` makes a NaN equal to no
 * value, itself included, so a NaN has no key. A base type holds no space, and neither does an
 * identifier or a coordinate, so one space between the parts keeps two keys apart.
 *
 * @param single The value.
 * @returns Its key; none for a NaN.
 */
const distinctKey = (single: Single): Option.Option<string> => {
  if (single.baseType === "float") {
    const value = Object.is(single.value, -0) ? 0 : single.value;

    return Number.isNaN(value)
      ? Option.none()
      : Option.some(`float ${format({ baseType: "float", value })}`);
  }

  if (single.baseType === "pair") {
    const [first, second] = single.value;
    const value: readonly [string, string] = first <= second ? [first, second] : [second, first];

    return Option.some(`pair ${format({ baseType: "pair", value })}`);
  }

  return Option.some(`${single.baseType} ${format(single)}`);
};

/**
 * Drop a response's repeated values: each value is kept at its first occurrence, in order, and a
 * later value {@link sameSingle} finds equal to it is dropped.
 *
 * A `Set` of each value's {@link distinctKey} finds the repeats, so the time is linear in the
 * number of values: a candidate's post of many members costs what its length costs, where comparing
 * every pair would cost its square. A NaN has no key and is always kept, as `sameSingle` finds it
 * equal to nothing.
 *
 * @param values The response's values.
 * @returns The values no earlier value equals, in order.
 */
const distinct = (values: readonly Single[]): readonly Single[] => {
  const seen = new Set<string>();
  const kept: Single[] = [];
  for (const single of values) {
    const key = distinctKey(single);
    if (Option.isNone(key)) {
      kept.push(single);
    } else if (!seen.has(key.value)) {
      seen.add(key.value);
      kept.push(single);
    }
  }

  return kept;
};

/**
 * Report whether a map entry compares its key exactly: a string key when it is `case-sensitive`,
 * and a key of every other base type always, identifiers included.
 *
 * @param entry The map entry.
 * @returns Whether its key compares exactly.
 */
const comparesExactly = (entry: MapEntry): boolean =>
  entry.caseSensitive || entry.key.baseType !== "string";

/**
 * Report whether a map entry's key matches a response value: exactly when the entry compares
 * exactly, else as strings with case folded.
 *
 * @param entry The map entry.
 * @param single The response value.
 * @returns Whether the entry maps it.
 */
const keyMatches = (entry: MapEntry, single: Single): boolean =>
  !comparesExactly(entry) && entry.key.baseType === "string" && single.baseType === "string"
    ? foldCase(entry.key.value) === foldCase(single.value)
    : sameSingle(entry.key, single);

/**
 * Give the value a mapping maps one response value to: the value of the first entry in document
 * order that matches it, else the mapping's default.
 *
 * Overlapping entries are valid, so a value two or more entries match maps by the first of them
 * listed. That is the order QTI gives an area mapping ("each area is tested in turn, with those
 * listed first taking priority in the case where areas overlap"), and reading 165 ("Two string map
 * keys that differ only by case are two keys, and a response that matches several entries takes
 * the first one listed"), which this renderer follows: a mapping that lists `York` then `york`,
 * both compared with case folded, maps `york` by `York`. BG010 lists its case-sensitive `York`
 * before its `york`, so its `York` maps by the first and `YORK` by the second.
 *
 * @param mapping The response's mapping.
 * @param single The response value.
 * @returns The mapped value.
 */
const mappedValue = (mapping: Mapping, single: Single): number =>
  Option.match(
    Arr.findFirst(mapping.entries, (entry) => keyMatches(entry, single)),
    { onNone: () => mapping.defaultValue, onSome: (entry) => entry.value },
  );

/**
 * Give the value a mapping or an area mapping gives its sum: a single float, the sum clamped to
 * the mapping's `lower-bound` and `upper-bound`, each unbounded when absent.
 *
 * @param mapping The mapping's bounds.
 * @param sum The sum of the mapped values.
 * @returns The single float.
 */
const clamped = (
  mapping: Pick<AreaMapping | Mapping, "lowerBound" | "upperBound">,
  sum: number,
): Value => {
  const lower = Option.getOrElse(mapping.lowerBound, () => Number.NEGATIVE_INFINITY);
  const upper = Option.getOrElse(mapping.upperBound, () => Number.POSITIVE_INFINITY);

  return floatValue(Math.min(upper, Math.max(lower, sum)));
};

/**
 * Give the value of a `qti-map-response`: a single float.
 *
 * The value is the sum of the mapped values of the response's distinct values, as {@link distinct}
 * finds them in time linear in their number, keyed by {@link distinctKey}: so a `single` value maps
 * to its one value's, `{B,B,C}` counts `B` once, and a NULL response maps to 0. The mapping's
 * `lower-bound` and `upper-bound` then clamp the sum, a single value's and a NULL's included
 * (reading 9.13).
 *
 * In a test's run a prefixed name maps the response of the item it reads through, by that item's
 * declaration ({@link heldResponse}).
 *
 * @param item The declarations holder, whose declaration gives the mapping.
 * @param variables The variables of the run.
 * @param identifier The response's identifier, prefixed in a test's run.
 * @returns The mapped value; or an {@link UnknownIdentifierError} when the item declares no
 *   modelled response by that name, an {@link UnmappedResponseError} when its declaration has no
 *   mapping, or an {@link UnknownIdentifierError} when the variables hold no value of it, checked
 *   in that order ({@link namedResponse} reads a prefixed response's value first). A prefixed name
 *   of a `file` variable or a record outcome or template variable is a name of no modelled
 *   response; one of an item's record response fails {@link RecordOperandError}.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponse
 */
const mapResponse = (
  item: Declarations,
  variables: Variables,
  identifier: string,
): Result.Result<Value, RecordOperandError | UnknownIdentifierError | UnmappedResponseError> =>
  Result.gen(function* mapOneResponse() {
    const named = yield* heldResponse(item, variables, identifier);
    const mapping = yield* Result.fromOption(
      named.declaration.mapping,
      () => new UnmappedResponseError({ identifier, mapping: "qti-mapping" }),
    );
    const response = yield* Result.fromOption(
      named.value,
      () => new UnknownIdentifierError({ holder: "record", identifier, role: "response" }),
    );
    let sum = 0;
    for (const single of distinct(response.values)) {
      sum += mappedValue(mapping, single);
    }

    return clamped(mapping, sum);
  });

/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-area-map-entry` and names an area's geometry, not a structure. */
/**
 * Find the first area, in document order, that holds a point.
 *
 * @param mapping The area mapping.
 * @param x The point's x coordinate, as a float.
 * @param y The point's y coordinate, as a float.
 * @returns The area's index among the mapping's entries, or -1 when no area holds the point.
 */
const firstArea = (mapping: AreaMapping, x: number, y: number): number =>
  mapping.entries.findIndex((entry) => areaHolds[entry.shape](entry.coords, x, y));
/* oxlint-enable anti-slop/no-shape-in-symbol-names */

/**
 * Sum what an area mapping maps a response's points to, before the bounds.
 *
 * QTI tests the points "against each area in turn, with those listed first taking priority in the
 * case where areas overlap", and "each area can be mapped once only". The rest is open (9.15), and
 * these defaults (reading 52) hold until a ruling changes this function and its tests:
 *
 * - A point on a shape's boundary is inside (`rect`, `circle`, `ellipse` and `poly`, edges included;
 *   `default` holds every point), as {@link areaHolds} reads it.
 * - Areas are tried in document order and the first that holds a point maps it; each area is mapped
 *   at most once.
 * - Each distinct point that falls in no area adds `default-value` once, as `map_response` treats an
 *   unmapped value. Points are told apart as {@link distinct} tells values apart, by their two
 *   exact coordinates, in time linear in their number.
 *
 * A coordinate is compared after the one conversion, {@link toFloat}.
 *
 * @param mapping The response's area mapping.
 * @param points The response's values, a point each.
 * @returns The sum.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponsePoint
 */
const areaSum = (mapping: AreaMapping, points: readonly Single[]): number => {
  const mapped = new Set<number>();
  let sum = 0;
  for (const single of distinct(points)) {
    const area =
      single.baseType === "point"
        ? firstArea(mapping, toFloat(single.value[0]), toFloat(single.value[1]))
        : -1;
    const entry = mapping.entries[area];
    if (entry === undefined) {
      sum += mapping.defaultValue;
    } else if (!mapped.has(area)) {
      mapped.add(area);
      sum += entry.mappedValue;
    }
  }

  return sum;
};

/**
 * Give the value of a `qti-map-response-point`: a single float.
 *
 * The value is {@link areaSum} of the response's points, so a NULL response maps to 0. The sum is
 * clamped to the area mapping's `lower-bound` and `upper-bound`, a NULL's 0 included (9.13's rule,
 * as `qti-map-response` applies it).
 *
 * In a test's run a prefixed name maps the points of the item it reads through, by that item's
 * declaration ({@link heldResponse}).
 *
 * @param item The declarations holder, whose declaration gives the area mapping.
 * @param variables The variables of the run.
 * @param identifier The response's identifier, prefixed in a test's run.
 * @returns The mapped value; or an {@link UnknownIdentifierError} when the item declares no
 *   modelled response by that name, an {@link UnmappedResponseError} when its declaration has no
 *   area mapping, or an {@link UnknownIdentifierError} when the variables hold no value of it,
 *   checked in that order ({@link namedResponse} reads a prefixed response's value first). A
 *   prefixed name of a `file` variable or a record outcome or template variable is a name of no
 *   modelled response; one of an item's record response fails {@link RecordOperandError}.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponsePoint
 */
const mapResponsePoint = (
  item: Declarations,
  variables: Variables,
  identifier: string,
): Result.Result<Value, RecordOperandError | UnknownIdentifierError | UnmappedResponseError> =>
  Result.gen(function* mapOnePointResponse() {
    const named = yield* heldResponse(item, variables, identifier);
    const mapping = yield* Result.fromOption(
      named.declaration.areaMapping,
      () => new UnmappedResponseError({ identifier, mapping: "qti-area-mapping" }),
    );
    const response = yield* Result.fromOption(
      named.value,
      () => new UnknownIdentifierError({ holder: "record", identifier, role: "response" }),
    );

    return clamped(mapping, areaSum(mapping, response.values));
  });

/**
 * Weight one value of an integer or float variable: the value, a float, times the weight, an
 * integer promoted to a float first ({@link toFloat}).
 *
 * @param single The value.
 * @param weight The weight.
 * @returns The weighted float; any other value as it is, which an integer or float variable never
 *   holds.
 */
const weightedSingle = (single: Single, weight: number): Single => {
  if (single.baseType === "float") {
    return { baseType: "float", value: single.value * weight };
  }

  return single.baseType === "integer"
    ? { baseType: "float", value: toFloat(single.value) * weight }
    : single;
};

/**
 * Apply a weight to the value of an item variable a test's run read through its item ref: "Weights
 * only apply to item variables with base-types integer and float. If the item variable is of any
 * other type the weight is ignored. All weights are treated as having base-type float and the
 * resulting value is obtained by multiplying the variable's value by the associated weight"
 * (`info.txt:72139`).
 *
 * An integer or float value is a float of its cardinality, each of its values times the weight, so
 * a single one is a single float and a NULL is NULL of a float. A value of any other base type is
 * unweighted.
 *
 * @param value The variable's value.
 * @param weight The weight.
 * @returns The weighted value.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#DataCharacteristic_Weight
 */
const weighted = (value: Value, weight: number): Value =>
  value.baseType === "integer" || value.baseType === "float"
    ? {
        baseType: "float",
        cardinality: value.cardinality,
        values: value.values.map((single) => weightedSingle(single, weight)),
      }
    : value;

/**
 * Give the value of a `qti-variable`: the response's, the outcome's or the template variable's
 * current value, else the built-in variable's, else in a test's run the item variable a prefixed
 * name reads through its item ref, as {@link variableRead} reads it.
 *
 * A `weight-identifier` weights a read through an item ref ({@link weighted}) by that item ref's
 * weight of that identifier, 1.0 when it defines none (`weightOf` in `#plate/engine/scope.ts`). A
 * name the run's own variables hold, an unprefixed one among them, reads unweighted (G-R3,
 * pending: a weight applies only to a prefixed read of an item variable), as an item's processing
 * reads every name, since weights are "defined only in the test context".
 *
 * @param expression The `qti-variable`.
 * @param scope The holder and the variables of the run.
 * @returns The variable's value; or the {@link RecordOperandError} {@link variableRead} gives for a
 *   record response, the run's own or an item's through its item ref; or an
 *   {@link UnknownIdentifierError} when the variables hold no value of it.
 */
const evaluateVariable: Evaluator<"variable"> = (expression, scope) =>
  Result.map(variableRead(scope.variables, expression.identifier), (read) =>
    Option.getOrElse(
      Option.zipWith(read.item, expression.weightIdentifier, (item, weight) =>
        weighted(read.value, weightOf(item, weight)),
      ),
      () => read.value,
    ),
  );

/**
 * Give the value of a `qti-correct`: the correct response template processing set for the response
 * (`Variables.correct`), else its declaration's correct response, else NULL of its declared type.
 *
 * The response must be declared or be a built-in the run holds, so an override map never makes an
 * undeclared name readable; `qti-set-correct-response` names only a declared response or a built-in
 * response on a checked item. A built-in, `numAttempts`, reads the correct response template
 * processing set for it, else NULL of its own type, a single integer, since it declares none
 * (reading 111; OD-A54-15), and never the attempt count. In a
 * test's run a prefixed name reads the item's correct response through its item ref
 * ({@link namedResponse}; 0.14 decision 7): the one its record's template processing set, else
 * its declaration's, else NULL of its declared type; through an item ref a selection with
 * replacement can repeat, the only one through which a numbered name reads an occurrence (reading
 * 88), `ITEMREF.N.VAR` with `N` other than 1 names an occurrence that does not exist and reads NULL
 * of the response's type (G-R3, pending). A
 * prefixed name of a response of base type `file`, or of a record response with a field of it,
 * which the value model holds no value of, reads the NULL `qti-variable` reads of it (G-R3,
 * pending: such a variable reads NULL). A prefixed name of an item's record response reads a
 * record, no value, so its `qti-correct` read as a value fails; as the operand of
 * `qti-field-value`, `qti-is-null` or `qti-match` it reads the item's declared correct response
 * (`recordOrValue` in `#plate/engine/refs.ts`), never through here.
 *
 * @param expression The `qti-correct`.
 * @param scope The holder, whose declaration gives the correct response, and the variables, whose
 *   override comes first.
 * @returns The correct response or the NULL, or the {@link RecordOperandError} or
 *   {@link UnknownIdentifierError} {@link namedResponse} gives.
 */
const evaluateCorrect: Evaluator<"correct"> = (expression, scope) =>
  Result.map(namedResponse(scope.item, scope.variables, expression.identifier), (named) => {
    if (named.kind === "unheld") {
      return named.value;
    }

    if (named.kind === "built-in") {
      return named.correct;
    }

    const { baseType, cardinality } = named.declaration;

    return named.first
      ? Option.getOrElse(
          Option.orElse(named.correct, () => named.declaration.correct),
          () => nullOf(baseType, cardinality),
        )
      : nullOf(baseType, cardinality);
  });

/**
 * Give the value of a `qti-base-value`: the value as the item model parsed it.
 *
 * @param expression The `qti-base-value`.
 * @returns Its value.
 */
const evaluateBaseValue: Evaluator<"base-value"> = (expression) => Result.succeed(expression.value);

/**
 * Give the value of a `qti-map-response`: a single float, the response's value through its
 * declaration's mapping ({@link mapResponse}).
 *
 * @param expression The `qti-map-response`.
 * @param scope The item, whose declaration gives the mapping, and the variables.
 * @returns The mapped value, or the failure {@link mapResponse} gives.
 */
const evaluateMapResponse: Evaluator<"map-response"> = (expression, scope) =>
  mapResponse(scope.item, scope.variables, expression.identifier);

/**
 * Give the value of a `qti-map-response-point`: a single float, the response's points through its
 * declaration's area mapping ({@link mapResponsePoint}).
 *
 * @param expression The `qti-map-response-point`.
 * @param scope The item, whose declaration gives the area mapping, and the variables.
 * @returns The mapped value, or the failure {@link mapResponsePoint} gives.
 */
const evaluateMapResponsePoint: Evaluator<"map-response-point"> = (expression, scope) =>
  mapResponsePoint(scope.item, scope.variables, expression.identifier);

/**
 * Find the declaration an item makes of the variable a prefixed name names in it.
 *
 * @param read The prefixed name, read through its item ref.
 * @returns The response, outcome or template declaration; none for an item-session built-in, for
 *   a record response and for a declaration of a type the value model does not hold.
 */
const prefixedDeclaration = (
  read: PrefixedName,
): ResponseDeclaration | OutcomeDeclaration | TemplateDeclaration | undefined => {
  const { declarations } = read.item;
  const { identifier, kind } = read.named;
  switch (kind) {
    case "response": {
      return declarations.responses.get(identifier);
    }
    case "outcome": {
      return declarations.outcomes.get(identifier);
    }
    case "template": {
      return declarations.templates.get(identifier);
    }
    case "built-in":
    case "record":
    case "unheld": {
      return undefined;
    }
    default: {
      return kind satisfies never;
    }
  }
};

/**
 * Give the default of the item variable a prefixed name reads through its item ref (0.14 decision
 * 7): the default its record's template processing set, else its declared default, else NULL of
 * its declared type, as a `qti-default` reads its own item's.
 *
 * An item-session built-in (`numAttempts`, `completionStatus`) has no declaration and so no
 * declared default: it gives the default its record's template processing set (reading 111), else
 * NULL of its own type. Through an item ref a selection with replacement can repeat, the only one
 * through which a numbered name reads an occurrence (reading 88), `ITEMREF.N.VAR` with `N` other
 * than 1 names an occurrence that does not exist and gives NULL of the variable's type (G-R3,
 * pending). A variable
 * of base type `file`, or a record outcome or template variable, whose default the item model does
 * not hold, gives the NULL `qti-variable` reads of it (G-R3, pending: such a variable reads NULL).
 * An item's record response never reaches here: `prefixedRead` fails its value read first, and
 * `qti-field-value`, `qti-is-null` and `qti-match` read its declared default
 * (`recordOrValue` in `#plate/engine/refs.ts`).
 *
 * @param read The prefixed name, read through its item ref.
 * @returns The default or the NULL; none only when the item's declarations hold no declaration of
 *   the response, outcome or template variable the name names.
 */
const prefixedDefault = (read: PrefixedName): Option.Option<Value> => {
  const declaration = prefixedDeclaration(read);
  if (declaration !== undefined) {
    const { baseType, cardinality } = declaration;

    return Option.some(
      read.first
        ? Option.getOrElse(
            Option.orElse(
              own(read.item.record.defaults, read.named.identifier),
              () => declaration.defaultValue,
            ),
            () => nullOf(baseType, cardinality),
          )
        : nullOf(baseType, cardinality),
    );
  }

  if (read.named.kind === "unheld") {
    return Option.some(read.value);
  }

  const { baseType, cardinality } = read.named.type;
  if (read.named.kind !== "built-in" || baseType === "file" || cardinality === "record") {
    return Option.none();
  }

  const nothing = nullOf(baseType, cardinality);

  return Option.some(
    read.first
      ? Option.getOrElse(own(read.item.record.defaults, read.named.identifier), () => nothing)
      : nothing,
  );
};

/**
 * Give the value of a `qti-default`: the default template processing set for the variable it names
 * (`Variables.defaults`), else the default value declared for it, else NULL of that variable's
 * type, as the information model says: it "returns the associated defaultValue or NULL if no
 * default value was declared".
 *
 * It reads the defaults and the declaration, never the attempt's value. A response, an outcome or a
 * template variable with no `qti-default-value` and no default set gives NULL of its base type and
 * cardinality, a single integer or float outcome included: the 0 an attempt starts such an outcome
 * at is not a declared default, and a template variable's current value is not its default either.
 * The variable must be declared, or be a built-in the run holds, for a set default to be read, so
 * an override map never makes an undeclared name readable; `qti-set-default-value` names only a
 * declared response or outcome, or a built-in of either kind, on a checked item. A declared
 * variable wins over a built-in of the same name, as `qti-variable` reads it. A built-in the run
 * holds, `numAttempts` or `completionStatus`, and in a test's run the test's own `duration`, has no
 * declaration and so declares no default: it gives the default template processing set for it
 * (reading 111; OD-A54-15), else NULL of the built-in's own type ({@link builtInType}), a single
 * integer, a single identifier or a single duration, never what the attempt holds of it, and
 * whether or not the test's scope holds a time. In a test's run a prefixed name reads the default
 * of the item variable it names through its item ref ({@link prefixedDefault}), a variable of base
 * type `file` or a record outcome or template variable its NULL; a prefixed name of an item's
 * record response reads a record, no value, and fails, while `qti-field-value`, `qti-is-null` and
 * `qti-match` read its declared default (`recordOrValue` in `#plate/engine/refs.ts`).
 *
 * @param expression The `qti-default`.
 * @param scope The holder, whose declarations give the defaults, and the variables, whose set
 *   defaults come first.
 * @returns The set or declared default or the NULL; or an {@link UnknownIdentifierError}: with
 *   holder `item` when the holder, or the item a prefixed name reads through, declares no response,
 *   outcome or template variable by that name and it names no built-in the run holds, which the
 *   item model marks in an item (an item's `duration` among them); or the one `prefixedRead` gives,
 *   with holder `record`, when no item ref resolves a prefixed name or the item's record holds no
 *   value of it; or the {@link RecordOperandError} `prefixedRead` gives when a prefixed name names
 *   an item's record response.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpDefault
 */
const evaluateDefault: Evaluator<"default"> = (expression, scope) => {
  const declaration =
    scope.item.responses.get(expression.identifier) ??
    scope.item.outcomes.get(expression.identifier) ??
    scope.item.templates.get(expression.identifier);
  if (declaration !== undefined) {
    return Result.succeed(
      Option.getOrElse(
        Option.orElse(
          own(scope.variables.defaults, expression.identifier),
          () => declaration.defaultValue,
        ),
        () => nullOf(declaration.baseType, declaration.cardinality),
      ),
    );
  }

  const builtIn = builtInType(scope.variables, expression.identifier);
  if (Option.isSome(builtIn)) {
    return Result.succeed(
      Option.getOrElse(own(scope.variables.defaults, expression.identifier), () =>
        nullOf(builtIn.value.baseType, builtIn.value.cardinality),
      ),
    );
  }

  const unknown = new UnknownIdentifierError({
    holder: "item",
    identifier: expression.identifier,
    role: "variable",
  });

  return scope.variables.test === undefined
    ? Result.fail(unknown)
    : Result.flatMap(prefixedRead(scope.variables.test, expression.identifier), (read) =>
        Result.fromOption(prefixedDefault(read), () => unknown),
      );
};

/**
 * Give the value of a `qti-null`: NULL, "treated as if it is of any desired base-type".
 *
 * A value carries a base type and a cardinality, so this NULL carries a single string's, the type
 * of an empty string, which the information model also treats as NULL. No check reads them: the
 * kind's rule types it any base type, which every operand rule and every check of a type accepts,
 * and an outcome set to it stores its own typed NULL (`setOutcome` in
 * `#plate/engine/evaluate.ts`).
 *
 * @returns The NULL.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-null
 */
const evaluateNull: Evaluator<"null"> = () => Result.succeed(nullOf("string", "single"));

/**
 * Draw a `qti-random-integer`'s value from its resolved attributes: `min + step × j`, with `j`
 * drawn by `drawBelow` among the `⌊(max − min) / step⌋ + 1` values the range holds, so with `min`
 * 2, `max` 11 and `step` 3 the values 2, 5, 8 and 11 are equally likely.
 *
 * Every NULL is settled before the first draw, so a NULL draws nothing and leaves the stream where
 * it was for every later draw:
 *
 * - `max` below `min`, or a `step` of 0 or below: "the range holds no value and the result is NULL"
 *   (G-R1 draft 148).
 * - `min` or `max` of more than {@link integerBitBound} bits (1,000,000): the drawn integer is a
 *   computed result, held to that bound by the operator's ruling `afb7e648`, and within the bound
 *   every value the range holds is too, so the draw is never past it (G-R2, pending).
 *
 * A range of one value, `step` beyond `max − min` among them, draws nothing and gives `min`.
 *
 * @param draw The scope's stream.
 * @param min The least value.
 * @param max The greatest value.
 * @param step The step between values.
 * @returns The single integer, or NULL of a single integer.
 */
const integerDraw = (draw: Draw, min: bigint, max: bigint, step: bigint): Value => {
  if (
    max < min ||
    step <= 0n ||
    bitLengthOf(min) > integerBitBound ||
    bitLengthOf(max) > integerBitBound
  ) {
    return integerNull;
  }

  return integerValue(min + step * drawBelow(draw, (max - min) / step + 1n));
};

/**
 * Give the value of a `qti-random-integer`: a single integer drawn from its range
 * ({@link integerDraw}).
 *
 * Its `min`, `max` and `step` are resolved first, in that order, each its literal or the value of
 * the variable it names ({@link referenceInteger}); a NULL there gives NULL, before any draw.
 *
 * @param expression The `qti-random-integer`.
 * @param scope The variables of the attempt and the stream it draws from.
 * @returns The single integer or its NULL, or an {@link UnknownIdentifierError} when an attribute
 *   names a variable the variables hold no value of, which a checked item never reaches.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-random-integer
 */
const evaluateRandomInteger: Evaluator<"random-integer"> = (expression, scope) =>
  Result.gen(function* drawRandomInteger() {
    const min = yield* referenceInteger(scope.variables, expression.min);
    const max = yield* referenceInteger(scope.variables, expression.max);
    const step = yield* referenceInteger(scope.variables, expression.step);

    return Option.match(Option.all([min, max, step]), {
      onNone: () => integerNull,
      onSome: ([least, greatest, by]) => integerDraw(scope.draw, least, greatest, by),
    });
  });

/**
 * Give the float a `qti-random-float`'s `min` or `max` stands for: its literal, or the value of the
 * float variable it names, through {@link referenceValue} with the kind's checked float facet.
 *
 * @param variables The variables of the attempt.
 * @param reference The attribute's value.
 * @returns The float; none when the named variable holds NULL or a value that is not a single
 *   float, which the validator refuses (P24) on a checked item; or the failure
 *   {@link referenceValue} gives: a {@link RecordOperandError} for a record response, which P24
 *   refuses on a checked item, or an {@link UnknownIdentifierError} when it names a variable the
 *   variables hold no value of.
 */
const referenceFloat = (
  variables: Variables,
  reference: FloatOrRef,
): Result.Result<Option.Option<number>, RecordOperandError | UnknownIdentifierError> =>
  Result.map(referenceValue(variables, { baseType: "float", checked: true, reference }), (value) =>
    Option.flatMap(numberOf(value), (single) =>
      single.baseType === "float" ? Option.some(single.value) : Option.none(),
    ),
  );

/**
 * Draw a `qti-random-float`'s value from its resolved bounds, with `u` the stream's next float in
 * [0, 1) (`drawFloat`, two draws): `min + u × (max − min)`, or `min × (1 − u) + max × u` when
 * `max − min` is not finite, so a range across the whole double line gives a finite float; the
 * result is then clamped to `[min, max]`, which a rounding of either form can step past.
 *
 * A bound that is NaN or infinite, or a `max` below `min`, gives NULL before the draw, so it draws
 * nothing (G-R2, pending). Each operation is one IEEE 754 addition, subtraction or multiplication,
 * correctly rounded, so every engine gives the same float for the same draws.
 *
 * @param draw The scope's stream.
 * @param min The least value.
 * @param max The greatest value.
 * @returns The single float, or NULL of a single float.
 */
const floatDraw = (draw: Draw, min: number, max: number): Value => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return floatNull;
  }

  const u = drawFloat(draw);
  const span = max - min;
  const drawn = Number.isFinite(span) ? min + u * span : min * (1 - u) + max * u;
  if (drawn < min) {
    return floatValue(min);
  }

  return floatValue(drawn > max ? max : drawn);
};

/**
 * Give the value of a `qti-random-float`: a single float drawn from `[min, max]`
 * ({@link floatDraw}).
 *
 * Its `min` and `max` are resolved first, in that order, each its literal or the value of the
 * variable it names ({@link referenceFloat}); a NULL there gives NULL, before any draw.
 *
 * @param expression The `qti-random-float`.
 * @param scope The variables of the attempt and the stream it draws from.
 * @returns The single float or its NULL, or an {@link UnknownIdentifierError} when a bound names a
 *   variable the variables hold no value of, which a checked item never reaches.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#AbstractAttribute_ExpressionGroup_qti-random-float
 */
const evaluateRandomFloat: Evaluator<"random-float"> = (expression, scope) =>
  Result.gen(function* drawRandomFloat() {
    const min = yield* referenceFloat(scope.variables, expression.min);
    const max = yield* referenceFloat(scope.variables, expression.max);

    return Option.match(Option.all([min, max]), {
      onNone: () => floatNull,
      onSome: ([least, greatest]) => floatDraw(scope.draw, least, greatest),
    });
  });

/**
 * The references family's evaluators by kind.
 */
export const referencesEvaluators: FamilyTable<
  | "base-value"
  | "correct"
  | "default"
  | "map-response"
  | "map-response-point"
  | "null"
  | "random-float"
  | "random-integer"
  | "variable"
> = {
  "base-value": evaluateBaseValue,
  correct: evaluateCorrect,
  default: evaluateDefault,
  "map-response": evaluateMapResponse,
  "map-response-point": evaluateMapResponsePoint,
  null: evaluateNull,
  "random-float": evaluateRandomFloat,
  "random-integer": evaluateRandomInteger,
  variable: evaluateVariable,
};
