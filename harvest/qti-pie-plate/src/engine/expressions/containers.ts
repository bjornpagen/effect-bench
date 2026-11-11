/**
 * The containers family of the engine: the evaluators of `qti-is-null`, `qti-multiple`,
 * `qti-ordered`, `qti-repeat`, `qti-container-size`, `qti-index`, `qti-random`, `qti-member`,
 * `qti-delete`, `qti-contains` and `qti-field-value`.
 *
 * `qti-field-value` reads one field of a record response, and `qti-is-null` reads a record whole,
 * each through `recordOrValue` (`#plate/engine/refs.ts`), which gives the record an operand names
 * before any value read.
 *
 * A container's values are compared one single at a time as `qti-match` compares two single
 * values (`match` in `#plate/model/values.ts`): of one base type, a `pair` in either order. A
 * container emptied or built of nothing is NULL, since NULL is a value with no values at any
 * cardinality.
 *
 * A container `qti-multiple`, `qti-ordered` or `qti-repeat` builds over an untyped operand, one the
 * item model types with no base type because a `qti-custom-operator` or a `qti-field-value` gives
 * it ({@link untyped}), is NULL: the model types such a container unknown, as the qti package does,
 * so a rule that takes it may need any type, and NULL is the one value of every type. `qti-index`,
 * `qti-random` and `qti-delete` of such a container, or of the operator itself, get a NULL and give
 * one.
 *
 * A container `qti-multiple`, `qti-ordered` or `qti-repeat` builds is held to `containerSizeBound`
 * (`#plate/engine/numbers.ts`, the principle of the operator's ruling `afb7e648`): one of more than
 * 1,000,000 values is the NULL of its base type and cardinality, found before it is built, or, for
 * a `qti-repeat` that draws, before each pass's values are added, so a `number-repeats` of
 * 2147483647 cannot hang scoring. The other kinds build no container larger than an operand, and no
 * container as written or stored is held to the bound.
 *
 * `qti-random` draws from the scope's stream (`drawBelow`, `#plate/engine/random.ts`), once its
 * operand is evaluated and found not NULL, so a NULL operand draws nothing. A `qti-repeat` whose
 * operands hold a random kind evaluates them once per pass, so each pass draws anew.
 *
 * It value-imports only engine leaves, `#plate/engine/refs.ts` among them, `#plate/model/values.ts`
 * and `effect`'s `Option` and `Result`, and reads the evaluator's types from
 * `#plate/engine/evaluate.ts` as types, so the dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluate, Evaluator, FamilyTable, Scope } from "#plate/engine/evaluate.ts";
import type { EngineFailure } from "#plate/engine/failures.ts";
import {
  booleanNull,
  booleanOf,
  integerValue,
  singleValue,
  withinContainerBound,
} from "#plate/engine/numbers.ts";
import { operandValues } from "#plate/engine/operands.ts";
import { drawBelow } from "#plate/engine/random.ts";
import type { Draw } from "#plate/engine/random.ts";
import { recordOrValue, referenceInteger } from "#plate/engine/refs.ts";
import type { Expression, ExpressionKind } from "#plate/model/expression.ts";
import {
  isNull,
  isNullResponse,
  isRecordValue,
  match,
  nullOf,
  sameSingle,
} from "#plate/model/values.ts";
import type { ModelledBaseType, RecordValue, Single, Value } from "#plate/model/values.ts";

/**
 * Give the value of a `qti-is-null`: a single boolean, whether the operand is NULL, a record with
 * no field among them, which the operand gives when it names a record response (`recordOrValue` in
 * `#plate/engine/refs.ts`).
 *
 * @param expression The `qti-is-null`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single boolean, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIsNull
 */
const evaluateIsNull: Evaluator<"is-null"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(recordOrValue(operand, scope, evaluate), (value) =>
    booleanOf(isNullResponse(value)),
  );
};

/**
 * The NULL `qti-field-value` gives where no field is read, `qti-null`'s, a single string's
 * (`evaluateNull` in `#plate/engine/expressions/references.ts`): the kind's rule types it unknown,
 * so its base type says nothing.
 */
const noField: Value = nullOf("string", "single");

/**
 * Give the single value of a record's field: its first field of that identifier, as a record keeps
 * the first written; none when it has no such field, a NULL record among them.
 *
 * @param record The record.
 * @param identifier The field's identifier.
 * @returns The field's value as a single, or none.
 */
const fieldOf = (record: RecordValue, identifier: string): Option.Option<Value> =>
  Option.map(
    Option.fromUndefinedOr(record.fields.find((field) => field.identifier === identifier)),
    (field) => singleValue(field.value),
  );

/**
 * Give the value of a `qti-field-value`: the field of its record operand that `field-identifier`
 * names, a single of the field's base type.
 *
 * It is NULL, `qti-null`'s ({@link noField}), when the record has no field of that identifier, as
 * the information model says ("If there is no field with that identifier then the result of the
 * operator is NULL"), when the record is NULL, and when the operand gives a value that is not a
 * record, which on a checked item only `qti-null` and `qti-custom-operator` can, each a NULL of no
 * known cardinality, since the kind's rule refuses an operand of any other known cardinality (P23;
 * G-R4, pending: a lacking field, a NULL record and an operand that is not a record each give
 * NULL).
 *
 * @param expression The `qti-field-value`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value when it names no record.
 * @returns The field's value or the NULL, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpFieldValue
 */
const evaluateFieldValue: Evaluator<"field-value"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(recordOrValue(operand, scope, evaluate), (value) =>
    isRecordValue(value)
      ? Option.getOrElse(fieldOf(value, expression.fieldIdentifier), () => noField)
      : noField,
  );
};

/**
 * The kinds whose rule gives no base type when one of its operands has none, each operand counted
 * but `qti-delete`'s first: the three constructors, `qti-index`, `qti-random` and the numerical
 * aggregates.
 */
const passesUnknownUp: ReadonlySet<ExpressionKind> = new Set([
  "index",
  "max",
  "min",
  "multiple",
  "ordered",
  "product",
  "random",
  "repeat",
  "subtract",
  "sum",
]);

/**
 * Give the operands whose base type an expression's kind rule passes up as its own when they have
 * none: `qti-delete`'s second, every operand of a kind {@link passesUnknownUp} names, and none of
 * any other kind.
 *
 * @param expression The expression.
 * @returns Those operands.
 */
const typeSourcesOf = (expression: Expression): readonly Expression[] => {
  if (expression.kind === "delete") {
    return [expression.operands[1]];
  }

  return passesUnknownUp.has(expression.kind) ? expression.operands : [];
};

/**
 * Report whether the item model types an expression's values with no base type (`unknown`), as its
 * kind's rule gives over its operands' types (`kindRules` in `#plate/model/expressions/read.ts`;
 * the qti package types them alike, by the typings of `expressionTypings` in
 * `packages/pantry/src/grammar/expression.ts`). On a checked item whose processing runs, that is a
 * `qti-custom-operator`, whose value plate never knows (9.21), a `qti-field-value`, whose value is
 * of its field's base type, and the kinds whose rule passes an unknown operand's base type up:
 * `qti-multiple`, `qti-ordered` and `qti-repeat` (`sharedBase`), `qti-index` and `qti-random`
 * (their operand's), `qti-delete` (its second operand's) and the numerical aggregates `qti-sum`,
 * `qti-product`, `qti-subtract`, `qti-min` and `qti-max` (`numericalAggregate` in
 * `#plate/model/expressions/arithmetic.ts`). A variable of a `record` declaration is typed unknown
 * too, but no kind this reads takes a record operand (P23 refuses one), and a kind that names a
 * variable the engine does not hold is marked, so its processing never runs.
 *
 * A container built over such an expression is NULL ({@link containerOf}, {@link evaluateRepeat}),
 * though a `qti-field-value` holds a value: the model types the container unknown, so a rule that
 * takes it may need any base type, and the field's may be another. The operator always gives NULL,
 * an aggregate does when an operand is NULL, and `qti-index`, `qti-random` and `qti-delete` do when
 * their container is NULL, so the NULL's base type says nothing. The containers family's tests
 * hold this list to the kind rules.
 *
 * @param expression The expression.
 * @returns Whether the model types it unknown.
 */
const untyped = (expression: Expression): boolean =>
  expression.kind === "custom-operator" ||
  expression.kind === "field-value" ||
  typeSourcesOf(expression).some((operand) => untyped(operand));

/**
 * Give the base type of a container built from values: the first value's that is not NULL, else
 * the first value's, since a NULL keeps the type of the expression that gave it. A container of no
 * operand has no base type to keep; its rule types it `any`, and its NULL is a string's, as
 * `qti-custom-operator`'s untyped NULL is.
 *
 * @param values The values, in order.
 * @returns The base type.
 */
const baseOf = (values: readonly Value[]): ModelledBaseType =>
  (values.find((value) => !isNull(value)) ?? values[0])?.baseType ?? "string";

/**
 * Give how many values some values hold together: one for a single value, each value of a
 * container, and none for a NULL.
 *
 * @param values The values.
 * @returns Their count.
 */
const sizeOf = (values: readonly Value[]): number => {
  let size = 0;
  for (const value of values) {
    size += value.values.length;
  }

  return size;
};

/**
 * Add the values' values to a container's, in order, one at a time, never as `push(...values)`,
 * whose spread throws a `RangeError` for a large container even within the bound.
 *
 * @param held The container's values so far, which it extends.
 * @param values The values to add, in order.
 */
const appendTo = (held: Single[], values: readonly Value[]): void => {
  for (const value of values) {
    for (const single of value.values) {
      held.push(single);
    }
  }
};

/**
 * Give the container of a cardinality that holds the operands' values in order: a single value
 * adds itself, a container adds each of its values, and a NULL adds nothing, whatever its base
 * type, so the container is NULL when every value is or there is none. It is NULL too when an
 * operand is {@link untyped}, and when it would hold more than 1,000,000 values, found from the
 * values' sizes before it is built.
 *
 * @param cardinality The container's cardinality.
 * @param operands The operands, in order.
 * @param values Their values, in order.
 * @returns The container, of the values' base type ({@link baseOf}).
 */
const containerOf = (
  cardinality: "multiple" | "ordered",
  operands: readonly Expression[],
  values: readonly Value[],
): Value => {
  if (
    operands.some((operand) => untyped(operand)) ||
    !withinContainerBound(BigInt(sizeOf(values)))
  ) {
    return nullOf(baseOf(values), cardinality);
  }

  const held: Single[] = [];
  appendTo(held, values);

  return { baseType: baseOf(values), cardinality, values: held };
};

/**
 * Give the value of a `qti-multiple`: a multiple container of its operands' values, a multiple
 * operand's added one by one and a NULL one ignored; NULL when there is no operand or every one is
 * NULL, when an operand is {@link untyped}, and when it would hold more than 1,000,000 values.
 * Applied to A, B and {C,D} it gives {A,B,C,D}.
 *
 * @param expression The `qti-multiple`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMultiple
 */
const evaluateMultiple: Evaluator<"multiple"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    containerOf("multiple", expression.operands, values),
  );

/**
 * Give the value of a `qti-ordered`: an ordered container of its operands' values, an ordered
 * operand's added in order and a NULL one ignored; NULL when there is no operand or every one is
 * NULL, so it never gives an empty container, when an operand is {@link untyped}, and when it would
 * hold more than 1,000,000 values.
 *
 * @param expression The `qti-ordered`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpOrdered
 */
const evaluateOrdered: Evaluator<"ordered"> = (expression, scope, evaluate) =>
  Result.map(operandValues(expression.operands, scope, evaluate), (values) =>
    containerOf("ordered", expression.operands, values),
  );

/**
 * The kinds that draw from the scope's stream.
 */
const drawingKinds: ReadonlySet<ExpressionKind> = new Set([
  "random",
  "random-float",
  "random-integer",
]);

/**
 * Report whether an expression's subtree holds a kind that draws from the scope's stream
 * ({@link drawingKinds}), at any depth among its operands.
 *
 * @param expression The expression.
 * @returns Whether it or an operand at any depth is a `qti-random`, `qti-random-integer` or
 *   `qti-random-float`.
 */
const drawsFrom = (expression: Expression): boolean => {
  const operands: readonly Expression[] = expression.operands;

  return drawingKinds.has(expression.kind) || operands.some((operand) => drawsFrom(operand));
};

/**
 * The stream a drawing `qti-repeat`'s operands are typed against ({@link staticBaseOf}): every draw
 * is 0, so it holds no state and takes nothing from the scope's stream. `drawBelow` accepts its
 * first candidate, 0, and `drawFloat` gives 0, so every draw against it ends.
 *
 * @returns 0.
 */
const typingDraw: Draw = () => 0;

/**
 * Give the base type of the NULL a drawing `qti-repeat` gives before any pass: the model's static
 * type of the `qti-repeat`, its kind's rule over its operands' types (`typeOf` in
 * `#plate/model/item.ts`), else `string`, {@link baseOf}'s fallback, where that type is unknown.
 *
 * An {@link untyped} operand makes it unknown. Otherwise the operands are evaluated once against
 * {@link typingDraw}, not the scope's stream, and the base type of their values is read: each
 * family's evaluators are held to their kinds' rules and a NULL keeps the type of the expression
 * that gave it, so the base type is the rule's whatever the draws. The values are discarded, the
 * scope's stream is left where it was, and a failure gives the fallback, so the evaluation is
 * seen only in the NULL's base type. The engine reads no rule itself: the registry
 * (`#plate/model/expressions/read.ts`) value-imports `effect`'s `Effect`, which no browser module
 * may.
 *
 * @param operands The `qti-repeat`'s operands.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The base type.
 */
const staticBaseOf = (
  operands: readonly Expression[],
  scope: Scope,
  evaluate: Evaluate,
): ModelledBaseType =>
  operands.some((operand) => untyped(operand))
    ? "string"
    : Result.match(operandValues(operands, { ...scope, draw: typingDraw }, evaluate), {
        onFailure: (): ModelledBaseType => "string",
        onSuccess: baseOf,
      });

/**
 * Give the value of a `qti-repeat` none of whose operands holds a random kind: its operands
 * evaluated once, and that pass's values added `number-repeats` times.
 *
 * This is exact: an operand's value depends only on the scope, which a pass does not change, so
 * every pass would give the first pass's values. One evaluation keeps a costly operand, such as a
 * product of two 500,000-bit integers, from being computed a million times.
 *
 * `number-repeats` is resolved first, then the operands are evaluated once, left to right; the
 * first failure is the result. That pass runs even when `number-repeats` is below 1, so the NULL
 * keeps the operands' base type. Its values are then added `number-repeats` times, one at a time.
 *
 * The bound is checked before any value is added: the pass's size times `number-repeats` past the
 * bound gives NULL, and a pass that gives no value gives NULL at once, however many passes
 * `number-repeats` asks for, which keeps a nested `qti-repeat` of nothing from running a million
 * passes a million times. The running size is checked again before each pass is added, which
 * cannot fail while one pass's values are repeated.
 *
 * @param expression The `qti-repeat`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first failure of `number-repeats` or an operand.
 */
const repeatOnce: Evaluator<"repeat"> = (expression, scope, evaluate) =>
  Result.gen(function* repeatOperands() {
    const repeats = yield* referenceInteger(scope.variables, expression.numberRepeats);
    const pass = yield* operandValues(expression.operands, scope, evaluate);
    const count = Option.getOrElse(repeats, () => 0n);
    const unset = nullOf(baseOf(pass), "ordered");
    const passSize = sizeOf(pass);
    if (
      count < 1n ||
      passSize === 0 ||
      expression.operands.some((operand) => untyped(operand)) ||
      !withinContainerBound(BigInt(passSize) * count)
    ) {
      return unset;
    }

    const held: Single[] = [];
    for (let added = 0n; added < count; added += 1n) {
      if (!withinContainerBound(BigInt(held.length + passSize))) {
        return unset;
      }

      appendTo(held, pass);
    }

    return { baseType: baseOf(pass), cardinality: "ordered", values: held };
  });

/**
 * Give the value of a `qti-repeat` an operand of which holds a random kind ({@link drawsFrom}): its
 * operands evaluated once per pass, left to right, `number-repeats` passes in all, each pass's
 * values added before the next pass runs, so each pass draws anew from the scope's stream.
 *
 * `number-repeats` is resolved first; then the first failure of a pass is the result. Three rules
 * bound what a seed's draws give and how many passes run:
 *
 * - The pass budget: a `number-repeats` above 1,000,000 (`containerSizeBound`) gives NULL before any
 *   pass, and the running size is checked before each pass's values are added, so a pass whose size
 *   is known only once it has run never grows the container past 1,000,000 values.
 * - A pass that gives no value gives NULL at once and runs no later pass, so it draws nothing more.
 * - A `number-repeats` below 1, or naming a variable that holds NULL, or an {@link untyped} operand
 *   gives NULL with no pass at all, so it draws nothing. That NULL, and the budget's, is of the
 *   model's static base type of the `qti-repeat` ({@link staticBaseOf}).
 *
 * The container is of the first pass's base type ({@link baseOf}), and the NULL of a pass that
 * gives no value or would pass the bound is of that pass's.
 *
 * The size of the container is bounded and the number of passes with it; the time the passes take,
 * a nested drawing `qti-repeat`'s included, is the host's (the operator's ruling `afb7e648`).
 *
 * @param expression The `qti-repeat`.
 * @param scope The item, the variables of the attempt and the stream its operands draw from.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first failure of `number-repeats` or a pass.
 */
const repeatPerPass: Evaluator<"repeat"> = (expression, scope, evaluate) =>
  Result.gen(function* repeatPasses() {
    const repeats = yield* referenceInteger(scope.variables, expression.numberRepeats);
    const count = Option.getOrElse(repeats, () => 0n);
    if (
      count < 1n ||
      !withinContainerBound(count) ||
      expression.operands.some((operand) => untyped(operand))
    ) {
      return nullOf(staticBaseOf(expression.operands, scope, evaluate), "ordered");
    }

    const held: Single[] = [];
    let baseType = baseOf([]);
    for (let passed = 0n; passed < count; passed += 1n) {
      const pass = yield* operandValues(expression.operands, scope, evaluate);
      const passSize = sizeOf(pass);
      if (passSize === 0 || !withinContainerBound(BigInt(held.length + passSize))) {
        return nullOf(baseOf(pass), "ordered");
      }

      if (passed === 0n) {
        baseType = baseOf(pass);
      }

      appendTo(held, pass);
    }

    return { baseType, cardinality: "ordered", values: held };
  });

/**
 * Give the value of a `qti-repeat`: an ordered container filled by evaluating each operand in turn
 * and adding its values, a NULL one ignored, `number-repeats` times in all; NULL when every operand
 * is NULL, when an operand is {@link untyped}, when `number-repeats` is below 1 or names a variable
 * that holds NULL, and when the container would hold more than 1,000,000 values.
 *
 * The information model fills the container pass by pass. When no operand's subtree holds a random
 * kind ({@link drawsFrom}), the operands are evaluated once, as every pass would give the first
 * pass's values ({@link repeatOnce}). When one does, they are evaluated once per pass, left to
 * right, so each pass draws anew, under a budget on the passes ({@link repeatPerPass}).
 *
 * @param expression The `qti-repeat`.
 * @param scope The item, the variables of the attempt and the stream its operands draw from.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first failure of `number-repeats` or an operand.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRepeat
 */
const evaluateRepeat: Evaluator<"repeat"> = (expression, scope, evaluate) =>
  expression.operands.some((operand) => drawsFrom(operand))
    ? repeatPerPass(expression, scope, evaluate)
    : repeatOnce(expression, scope, evaluate);

/**
 * Give the value of a `qti-container-size`: a single integer, the number of values its operand
 * holds, repeats counted; 0 for NULL.
 *
 * @param expression The `qti-container-size`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single integer, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpContainerSize
 */
const evaluateContainerSize: Evaluator<"container-size"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) => integerValue(BigInt(value.values.length)));
};

/**
 * Give the value of a `qti-index`: a single value of its operand's base type, the `n`th value of
 * the container, counting from 1; NULL when the operand is NULL, when `n` is below 1 or beyond the
 * container's size (9.20), and when `n` names a variable that holds NULL.
 *
 * `n` is resolved first, then the operand is evaluated; the first failure is the result.
 *
 * @param expression The `qti-index`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single value, or the first failure of `n` or the operand.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpIndex
 */
const evaluateIndex: Evaluator<"index"> = (expression, scope, evaluate) =>
  Result.gen(function* pickIndex() {
    const n = yield* referenceInteger(scope.variables, expression.n);
    const [operand] = expression.operands;
    const container = yield* evaluate(operand, scope);
    const picked = n.pipe(
      Option.flatMap((position) =>
        position >= 1n && position <= BigInt(container.values.length)
          ? Option.fromUndefinedOr(container.values[Number(position) - 1])
          : Option.none(),
      ),
    );

    return Option.match(picked, {
      onNone: () => nullOf(container.baseType, "single"),
      onSome: singleValue,
    });
  });

/**
 * Give the value of a `qti-random`: a single value of its operand's base type, the member of the
 * container at the position `drawBelow` draws from the scope's stream among the container's size,
 * counting from 0, so each member, a repeated one counted each time, is equally likely; NULL when
 * the operand is NULL.
 *
 * The operand is evaluated first; its failure is the result. A NULL operand gives NULL before any
 * draw, so it leaves the stream where it was for every later draw, and a container of one member
 * gives it with no draw (`drawBelow` of 1).
 *
 * @param expression The `qti-random`.
 * @param scope The item, the variables of the attempt and the stream it draws from.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The single value, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpRandom
 */
const evaluateRandom: Evaluator<"random"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (container): Value => {
    if (isNull(container)) {
      return nullOf(container.baseType, "single");
    }

    const picked = container.values[Number(drawBelow(scope.draw, BigInt(container.values.length)))];

    return picked === undefined ? nullOf(container.baseType, "single") : singleValue(picked);
  });
};

/**
 * Evaluate the two operands of a kind that relates them, left to right; the first failure is the
 * result.
 *
 * @param operands The two operands.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The two values, or the first operand's failure.
 */
const pairOf = (
  [first, second]: readonly [Expression, Expression],
  scope: Scope,
  evaluate: Evaluate,
): Result.Result<readonly [Value, Value], EngineFailure> =>
  Result.all([evaluate(first, scope), evaluate(second, scope)] as const);

/**
 * Report whether a container holds a single value: whether one of its values matches it, as
 * `qti-match` compares two single values.
 *
 * @param container The container.
 * @param value The single value.
 * @returns Whether the container holds it; false when the value is not a single one.
 */
const holds = (container: Value, value: Value): boolean =>
  container.values.some((held) => match(value, singleValue(held)));

/**
 * Give the value of a `qti-member`: a single boolean, whether the container its second operand
 * gives holds the value its first gives; NULL when either is NULL.
 *
 * @param expression The `qti-member`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMember
 */
const evaluateMember: Evaluator<"member"> = (expression, scope, evaluate) =>
  Result.map(pairOf(expression.operands, scope, evaluate), ([value, container]) =>
    isNull(value) || isNull(container) ? booleanNull : booleanOf(holds(container, value)),
  );

/**
 * Give the value of a `qti-delete`: the container its second operand gives, of the same base type
 * and cardinality, with every value that matches the value its first gives removed, so applied to
 * A and {B,A,C,A} it gives {B,C}; NULL when either is NULL, and when no value is left.
 *
 * @param expression The `qti-delete`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The container, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpDelete
 */
const evaluateDelete: Evaluator<"delete"> = (expression, scope, evaluate) =>
  Result.map(pairOf(expression.operands, scope, evaluate), ([value, container]): Value => ({
    baseType: container.baseType,
    cardinality: container.cardinality,
    values: isNull(value)
      ? []
      : container.values.filter((held) => !match(value, singleValue(held))),
  }));

/**
 * Report whether a container holds every value of another, repeats counted: each value of the part
 * pairs with its own matching value of the container, so {A,B,C} holds {C,A} and not {B,B}, and
 * {A,B,B,C} holds {B,B}.
 *
 * @param container The container's values.
 * @param part The other container's values.
 * @returns Whether the container holds them all.
 */
const holdsAll = (container: readonly Single[], part: readonly Single[]): boolean => {
  const unmatched = [...container];

  return part.every((single) => {
    const index = unmatched.findIndex((held) => sameSingle(single, held));
    if (index === -1) {
      return false;
    }

    unmatched.splice(index, 1);

    return true;
  });
};

/**
 * Report whether a sequence holds another as a contiguous run (9.16): the part's values, in order
 * and with nothing between them, start at some value of the sequence, so [A,B,C] holds [B,C] and
 * not [C,A] or [A,C].
 *
 * @param sequence The ordered container's values.
 * @param part The other container's values.
 * @returns Whether the sequence holds the run.
 */
const holdsRun = (sequence: readonly Single[], part: readonly Single[]): boolean =>
  sequence.some(
    (_, start) =>
      start + part.length <= sequence.length &&
      part.every((single, offset) => {
        const held = sequence[start + offset];

        return held !== undefined && sameSingle(single, held);
      }),
  );

/**
 * Give the value of a `qti-contains`: a single boolean, whether the container its first operand
 * gives contains the one its second gives; NULL when either is NULL. An ordered first operand
 * contains a contiguous run of its values ({@link holdsRun}); any other, its values without regard
 * to order, repeats counted ({@link holdsAll}).
 *
 * @param expression The `qti-contains`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The single boolean, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpContains
 */
const evaluateContains: Evaluator<"contains"> = (expression, scope, evaluate) =>
  Result.map(pairOf(expression.operands, scope, evaluate), ([container, part]) => {
    if (isNull(container) || isNull(part)) {
      return booleanNull;
    }

    return booleanOf(
      container.cardinality === "ordered"
        ? holdsRun(container.values, part.values)
        : holdsAll(container.values, part.values),
    );
  });

/**
 * The containers family's evaluators by kind.
 */
export const containersEvaluators: FamilyTable<
  | "container-size"
  | "contains"
  | "delete"
  | "field-value"
  | "index"
  | "is-null"
  | "member"
  | "multiple"
  | "ordered"
  | "random"
  | "repeat"
> = {
  "container-size": evaluateContainerSize,
  contains: evaluateContains,
  delete: evaluateDelete,
  "field-value": evaluateFieldValue,
  index: evaluateIndex,
  "is-null": evaluateIsNull,
  member: evaluateMember,
  multiple: evaluateMultiple,
  ordered: evaluateOrdered,
  random: evaluateRandom,
  repeat: evaluateRepeat,
};
