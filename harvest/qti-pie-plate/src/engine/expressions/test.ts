/**
 * The test family of the engine: the outcome-only expressions `qti-number-correct`,
 * `qti-number-incorrect`, `qti-number-presented`, `qti-number-responded`, `qti-number-selected`,
 * `qti-outcome-minimum`, `qti-outcome-maximum` and `qti-test-variables`, which a test's outcome
 * processing evaluates over its items.
 *
 * Each reads the test scope a test's run carries (`Variables.test`; `#plate/engine/scope.ts`): the
 * items its filters keep (`keptItems`: a `section-identifier`'s, nested sections' included, and
 * one shared category to include and one to exclude; G-R3, pending), and each item's variable by
 * name through the item ref's variable mappings (`itemName`, `itemVariable`). A run with no test
 * scope holds no item to read, so each kind gives the record's gap there, as a variable the record
 * holds no value of does: an item's own processing never holds one, since reading 23 refuses it
 * there. A count is a single integer. A minimum, a maximum and a collection build at most one value
 * per item, and one of more than `containerSizeBound` values (1,000,000; the operator's ruling
 * `afb7e648`) is NULL instead.
 *
 * It value-imports only `effect`'s `Option` and `Result`, the engine leaves
 * `#plate/engine/failures.ts`, `#plate/engine/numbers.ts`, `#plate/engine/refs.ts` and
 * `#plate/engine/scope.ts`, and `#plate/model/values.ts`, and reads the evaluator's types from
 * `#plate/engine/evaluate.ts` as types only, so the dispatcher's table may import it without a
 * cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluator, FamilyTable, Variables } from "#plate/engine/evaluate.ts";
import { UnknownIdentifierError } from "#plate/engine/failures.ts";
import { containerSizeBound, floatOf, integerValue } from "#plate/engine/numbers.ts";
import { own } from "#plate/engine/refs.ts";
import { itemName, itemVariable, keptItems, weightOf } from "#plate/engine/scope.ts";
import type { DeclaredType, ItemFilters, ScopeItem, TestScope } from "#plate/engine/scope.ts";
import type { RecordDeclaration, ResponseDeclaration } from "#plate/model/item.ts";
import {
  isModelled,
  isNull,
  isNullResponse,
  match,
  nullOf,
  nullRecord,
  sameRecord,
} from "#plate/model/values.ts";
import type { ModelledBaseType, RecordValue, Single, Value } from "#plate/model/values.ts";
import type { BaseType } from "#plate/vocabulary.ts";

/**
 * The five kinds that count the items they read.
 */
type CountKind =
  | "number-correct"
  | "number-incorrect"
  | "number-presented"
  | "number-responded"
  | "number-selected";

/**
 * The family's kinds.
 */
type TestKind = CountKind | "outcome-maximum" | "outcome-minimum" | "test-variables";

/**
 * Give the test scope a run carries.
 *
 * @param variables The variables of the run.
 * @param kind The kind that reads it.
 * @returns The scope, or an {@link UnknownIdentifierError} with holder `record`, naming the kind's
 *   element, when the run carries none.
 */
const heldScope = (
  variables: Variables,
  kind: TestKind,
): Result.Result<TestScope, UnknownIdentifierError> =>
  Result.fromOption(
    Option.fromUndefinedOr(variables.test),
    () =>
      new UnknownIdentifierError({ holder: "record", identifier: `qti-${kind}`, role: "variable" }),
  );

/**
 * Count the items a count's filters keep that a test passes.
 *
 * @param kind The count.
 * @param filters Its filters.
 * @param variables The variables of the run, which carry the test scope.
 * @param counts Whether an item is counted, or the failure reading it gives.
 * @returns The count, a single integer, or the first failure.
 */
const countOf = (
  kind: CountKind,
  filters: ItemFilters,
  variables: Variables,
  counts: (item: ScopeItem) => Result.Result<boolean, UnknownIdentifierError>,
): Result.Result<Value, UnknownIdentifierError> =>
  Result.gen(function* countItems() {
    const scope = yield* heldScope(variables, kind);
    let count = 0n;
    for (const item of keptItems(scope, filters)) {
      if (yield* counts(item)) {
        count += 1n;
      }
    }

    return integerValue(count);
  });

/**
 * Give the value an item's record holds of one of its declared responses.
 *
 * @param item The item.
 * @param identifier The response's identifier.
 * @returns The value, or an {@link UnknownIdentifierError} with holder `record` when the record
 *   holds none, as a stored record lacking a response is in an item's own processing.
 */
const responseValue = (
  item: ScopeItem,
  identifier: string,
): Result.Result<Value, UnknownIdentifierError> =>
  Result.fromOption(
    own(item.record.responses, identifier),
    () => new UnknownIdentifierError({ holder: "record", identifier, role: "response" }),
  );

/**
 * Report whether two values are the same: both NULL, or a match as `qti-match` compares them.
 *
 * @param left One value.
 * @param right The other.
 * @returns Whether they are the same.
 */
const sameValue = (left: Value, right: Value): boolean =>
  (isNull(left) && isNull(right)) || match(left, right);

/**
 * Give a response's default: the one the item's template processing set, else the declared one,
 * else NULL of its declared type.
 *
 * @param item The item.
 * @param declaration The response's declaration.
 * @returns The default.
 */
const defaultOf = (item: ScopeItem, declaration: ResponseDeclaration): Value =>
  Option.getOrElse(
    Option.orElse(
      own(item.record.defaults, declaration.identifier),
      () => declaration.defaultValue,
    ),
    () => nullOf(declaration.baseType, declaration.cardinality),
  );

/**
 * The record responses the scope reads of an item that declares none.
 */
const noRecords: ReadonlyMap<string, RecordDeclaration> = new Map();

/**
 * Give the record an item's record holds of one of its record responses: the NULL record when it
 * holds none, as an unanswered record response with no declared default holds none.
 *
 * @param item The item.
 * @param identifier The record response's identifier.
 * @returns The record.
 */
const recordValue = (item: ScopeItem, identifier: string): RecordValue =>
  Option.getOrElse(own(item.record.records, identifier), () => nullRecord);

/**
 * Report whether an item was responded to: some declared response holds a value that differs from
 * its default, the one its template processing set first, else its declared one, else NULL; or
 * some record response holds a record that differs from its declared default, else the NULL
 * record, as {@link sameRecord} compares two records (a record response's default is never set).
 *
 * @param item The item.
 * @returns Whether a response differs, or the record's gap.
 */
const respondedTo = (item: ScopeItem): Result.Result<boolean, UnknownIdentifierError> =>
  Result.map(
    Result.all(
      Array.from(item.declarations.responses.values(), (declaration) =>
        Result.map(
          responseValue(item, declaration.identifier),
          (held) => !sameValue(held, defaultOf(item, declaration)),
        ),
      ),
    ),
    (differs) =>
      differs.includes(true) ||
      [...(item.records ?? noRecords).values()].some(
        (declaration) =>
          !sameRecord(
            recordValue(item, declaration.identifier),
            Option.getOrElse(declaration.defaultValue, () => nullRecord),
          ),
      ),
  );

/**
 * Report whether a record response's record matches its correct response, as `qti-match` compares
 * two records: neither NULL, and the same fields ({@link sameRecord}).
 *
 * @param held The record the item's record holds.
 * @param key The declared correct response.
 * @returns Whether they match.
 */
const recordMatches = (held: RecordValue, key: RecordValue): boolean =>
  !isNullResponse(held) && !isNullResponse(key) && sameRecord(held, key);

/**
 * Judge an item's responses against their correct responses, as `qti-number-correct` and
 * `qti-number-incorrect` read them: only an item whose every declared response has a correct
 * response is judged (info.txt:9332, "Only items for which all declared response variables have
 * correct responses defined are considered"), and an item that declares no response is not (G-R3,
 * pending). Every declared response counts, those of base type `file` or cardinality `record` among
 * them: a response the value model holds has the correct response its item's template processing
 * set first, else the declared one; a record response (`ScopeItem.records`) its declared one, which
 * template processing never sets; an unheld response has one when it declares one
 * (`ScopeItem.unheldResponses`). A record response matches its correct response as `qti-match`
 * compares two records ({@link recordMatches}), so an item whose record response declares no
 * correct response is not judged (G-R4, pending). In a judged item an unheld response reads NULL,
 * as every read of one does, and NULL matches no correct response, so that item is never correct.
 *
 * @param item The item.
 * @returns Whether every response matches its correct response as `qti-match` compares them, none
 *   when the item is not judged, or the record's gap.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberCorrect
 */
const judged = (item: ScopeItem): Result.Result<Option.Option<boolean>, UnknownIdentifierError> => {
  const responses = [...item.declarations.responses.values()];
  const records = [...(item.records ?? noRecords).values()];
  const unheld = [...(item.unheldResponses ?? new Map<string, boolean>()).values()];
  const keys = Option.all(
    responses.map((declaration) =>
      Option.map(
        Option.orElse(own(item.record.correct, declaration.identifier), () => declaration.correct),
        (key) => [declaration.identifier, key] as const,
      ),
    ),
  );
  const recordKeys = Option.all(
    records.map((declaration) =>
      declaration.correct.pipe(Option.map((key) => [declaration.identifier, key] as const)),
    ),
  );
  if (
    responses.length + records.length + unheld.length === 0 ||
    Option.isNone(keys) ||
    Option.isNone(recordKeys) ||
    unheld.includes(false)
  ) {
    return Result.succeed(Option.none());
  }

  const recordsMatch = recordKeys.value.every(([identifier, key]) =>
    recordMatches(recordValue(item, identifier), key),
  );

  return Result.map(
    Result.all(
      keys.value.map(([identifier, key]) =>
        Result.map(responseValue(item, identifier), (held) => match(held, key)),
      ),
    ),
    (matches) => Option.some(unheld.length === 0 && recordsMatch && !matches.includes(false)),
  );
};

/**
 * Give the value of a `qti-number-selected`: the number of items its filters keep. Selection is
 * marked, so every item of the session is selected.
 *
 * @param expression The `qti-number-selected`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The count, a single integer, or the record's gap with no test scope.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberSelected
 */
const evaluateNumberSelected: Evaluator<"number-selected"> = (expression, scope) =>
  countOf(expression.kind, expression, scope.variables, () => Result.succeed(true));

/**
 * Give the value of a `qti-number-presented`: the number of items its filters keep that the
 * candidate has been shown.
 *
 * @param expression The `qti-number-presented`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The count, a single integer, or the record's gap with no test scope.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberPresented
 */
const evaluateNumberPresented: Evaluator<"number-presented"> = (expression, scope) =>
  countOf(expression.kind, expression, scope.variables, (item) => Result.succeed(item.presented));

/**
 * Give the value of a `qti-number-responded`: the number of items its filters keep that were
 * presented and hold a response, a record response among them, that differs from its default
 * (`respondedTo`).
 *
 * @param expression The `qti-number-responded`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The count, a single integer, or the record's gap: with no test scope, or when a
 *   presented item's record holds no value of a declared response.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberResponded
 */
const evaluateNumberResponded: Evaluator<"number-responded"> = (expression, scope) =>
  countOf(expression.kind, expression, scope.variables, (item) =>
    item.presented ? respondedTo(item) : Result.succeed(false),
  );

/**
 * Give the value of a `qti-number-correct`: the number of items its filters keep whose every
 * declared response, of a type the value model holds or not, a record response among them, has a
 * correct response and matches it ({@link judged}).
 *
 * @param expression The `qti-number-correct`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The count, a single integer, or the record's gap: with no test scope, or when a judged
 *   item's record holds no value of a declared response.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberCorrect
 */
const evaluateNumberCorrect: Evaluator<"number-correct"> = (expression, scope) =>
  countOf(expression.kind, expression, scope.variables, (item) =>
    Result.map(judged(item), (matched) => Option.exists(matched, (each) => each)),
  );

/**
 * Give the value of a `qti-number-incorrect`: the number of items its filters keep that were
 * attempted at least once (`info.txt:9336`), whose every declared response, of a type the value
 * model holds or not, a record response among them, has a correct response, and at least one of
 * which does not match it ({@link judged}): an unheld response reads NULL, which matches none.
 *
 * An item is attempted once an attempt has started, which is once it is presented ("items with
 * which the user has interacted, whether or not they provided a response", `info.txt:9340`): its
 * started attempt count (`ScopeItem.numAttempts`) is above 0. So a presented item left unanswered
 * counts when its NULL response does not match its correct response.
 *
 * @param expression The `qti-number-incorrect`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The count, a single integer, or the record's gap: with no test scope, or when a judged
 *   item's record holds no value of a declared response.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutNumberIncorrect
 */
const evaluateNumberIncorrect: Evaluator<"number-incorrect"> = (expression, scope) =>
  countOf(expression.kind, expression, scope.variables, (item) =>
    item.numAttempts > 0
      ? Result.map(judged(item), (matched) => Option.exists(matched, (each) => !each))
      : Result.succeed(false),
  );

/**
 * Give a number weighted by an item ref's weight, when a `weight-identifier` is given: the number
 * times the weight, 1.0 when the item ref defines none (G-R3, pending).
 *
 * @param item The item.
 * @param weightIdentifier The `weight-identifier`, none when absent.
 * @param value The number.
 * @returns The number, weighted.
 */
const weighted = (
  item: ScopeItem,
  weightIdentifier: Option.Option<string>,
  value: number,
): number =>
  Option.match(weightIdentifier, {
    onNone: () => value,
    onSome: (identifier) => value * weightOf(item, identifier),
  });

/**
 * Give the multiple float of numbers, NULL past the container bound.
 *
 * @param numbers The numbers, in order.
 * @returns The value; NULL when there is none or more than `containerSizeBound`.
 */
const floatsOf = (numbers: readonly number[]): Value =>
  numbers.length > containerSizeBound
    ? nullOf("float", "multiple")
    : {
        baseType: "float",
        cardinality: "multiple",
        values: numbers.map((value): Single => ({ baseType: "float", value })),
      };

/**
 * Give the `normal-minimum` or `normal-maximum` an item declares of the variable a name names,
 * through its item ref's mappings ({@link itemName}). Only a variable of single cardinality is
 * considered. A name that names no outcome of the item, a response, a template variable or an
 * item-session built-in among them, names nothing that declares either (G-R3, pending).
 *
 * @param item The item.
 * @param name The `outcome-identifier`.
 * @param bound Which of the two.
 * @returns None when the variable is not of single cardinality, else the declared bound, none when
 *   none is declared.
 */
const declaredBound = (
  item: ScopeItem,
  name: string,
  bound: "normalMaximum" | "normalMinimum",
): Option.Option<Option.Option<number>> =>
  Option.match(itemName(item, name), {
    onNone: () => Option.some(Option.none()),
    onSome: (named) => {
      if (named.type.cardinality !== "single") {
        return Option.none();
      }

      return Option.some(
        named.kind === "outcome"
          ? Option.flatMap(
              Option.fromUndefinedOr(item.declarations.outcomes.get(named.identifier)),
              (declaration) => declaration[bound],
            )
          : Option.none(),
      );
    },
  });

/**
 * Give the value of a `qti-outcome-minimum`: a multiple float of each item's `normal-minimum` of
 * the named single outcome, weighted when a `weight-identifier` is given, an item with no declared
 * minimum ignored.
 *
 * @param expression The `qti-outcome-minimum`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The minimums, NULL when there is none or past the container bound, or the record's gap
 *   with no test scope.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutOutcomeMin
 */
const evaluateOutcomeMinimum: Evaluator<"outcome-minimum"> = (expression, scope) =>
  Result.map(heldScope(scope.variables, expression.kind), (test) =>
    floatsOf(
      keptItems(test, expression).flatMap((item) =>
        Option.toArray(
          Option.flatten(declaredBound(item, expression.outcomeIdentifier, "normalMinimum")),
        ).map((minimum) => weighted(item, expression.weightIdentifier, minimum)),
      ),
    ),
  );

/**
 * Give the value of a `qti-outcome-maximum`: a multiple float of each item's `normal-maximum` of
 * the named single outcome, weighted when a `weight-identifier` is given; NULL when any item it
 * considers has no declared maximum.
 *
 * @param expression The `qti-outcome-maximum`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The maximums, NULL when an item has none, when there is none or past the container
 *   bound, or the record's gap with no test scope.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutOutcomeMax
 */
const evaluateOutcomeMaximum: Evaluator<"outcome-maximum"> = (expression, scope) =>
  Result.map(heldScope(scope.variables, expression.kind), (test) => {
    const maximums: number[] = [];
    for (const item of keptItems(test, expression)) {
      const declared = declaredBound(item, expression.outcomeIdentifier, "normalMaximum");
      if (Option.isSome(declared)) {
        if (Option.isNone(declared.value)) {
          return nullOf("float", "multiple");
        }

        maximums.push(weighted(item, expression.weightIdentifier, declared.value.value));
      }
    }

    return floatsOf(maximums);
  });

/**
 * Report whether `qti-test-variables` collects a variable of a declared base type: one of the
 * written `base-type`, or, with none written, one declared integer or float (Admission A7: "If
 * omitted, variables declared with base-type integer or float are matched").
 *
 * @param written The `base-type`, none when absent.
 * @param declared The variable's declared base type.
 * @returns Whether it is collected.
 */
const collects = (written: Option.Option<BaseType>, declared: DeclaredType["baseType"]): boolean =>
  Option.match(written, {
    onNone: () => declared === "integer" || declared === "float",
    onSome: (baseType) => baseType === declared,
  });

/**
 * One value `qti-test-variables` collected, with the item it came from, whose weight it takes.
 */
interface Collected {
  readonly item: ScopeItem;
  readonly single: Single;
}

/**
 * Report whether an item of the test declares, as a single float, the variable a
 * `qti-test-variables` with no `base-type` names: any item of the test scope, whatever the kind's
 * filters, read through its item ref's mappings ({@link itemName}), its built-ins among what it
 * declares (`numAttempts` an integer).
 *
 * G-R3 199 decides an unweighted collection's base type by these declarations, not by the values
 * collected (`info.txt:71484` words it by "all matching values"), so the validator, which knows the
 * declarations alone, types it as the run does (`resultAttributes` in `#plate/validate/rules.ts`),
 * even when every float value collected is NULL.
 *
 * @param test The test scope.
 * @param name The `variable-identifier`.
 * @returns Whether some item declares it a single float.
 */
const declaresFloat = (test: TestScope, name: string): boolean =>
  test.items.some((item) =>
    Option.exists(
      itemName(item, name),
      ({ type }) => type.cardinality === "single" && type.baseType === "float",
    ),
  );

/**
 * Give the base type of what `qti-test-variables` collects: a written base type that is not
 * numerical; else float when a weight is given, float is written, or, with none written, an item
 * of the test declares the variable a single float ({@link declaresFloat}; G-R3 199); else
 * integer, every declaration it may match an integer and unweighted (`info.txt:71484`).
 *
 * @param written The `base-type`, none when absent or not one the value model holds.
 * @param isWeighted Whether a `weight-identifier` is given.
 * @param floatDeclared Whether no `base-type` is written and an item declares the variable a
 *   single float.
 * @returns The base type.
 */
const collectedBaseType = (
  written: Option.Option<ModelledBaseType>,
  isWeighted: boolean,
  floatDeclared: boolean,
): ModelledBaseType => {
  if (Option.isSome(written) && written.value !== "integer" && written.value !== "float") {
    return written.value;
  }

  return isWeighted || Option.exists(written, (baseType) => baseType === "float") || floatDeclared
    ? "float"
    : "integer";
};

/**
 * Give one collected value as the collection holds it: a number as a float, weighted, when the
 * collection is float, integers promoted; any other value as it is.
 *
 * @param baseType The collection's base type.
 * @param weightIdentifier The `weight-identifier`, none when absent.
 * @param collected The value and its item.
 * @returns The value.
 */
const collectedSingle = (
  baseType: ModelledBaseType,
  weightIdentifier: Option.Option<string>,
  { item, single }: Collected,
): Single =>
  baseType === "float" && (single.baseType === "integer" || single.baseType === "float")
    ? { baseType: "float", value: weighted(item, weightIdentifier, floatOf(single)) }
    : single;

/**
 * Give the value of a `qti-test-variables`: a multiple of each item's value of the named single
 * variable, read through its item ref's mappings as a prefixed reference reads it (`numAttempts`
 * the started attempt count, `completionStatus` the record's), NULLs ignored. It collects a
 * variable of the written `base-type`, or, with none written, one declared integer or float
 * (Admission A7), from the items its filters keep. With none written it is a multiple integer
 * when it is unweighted and no item of the test, kept or not, declares the variable a single float
 * (G-R3 199, {@link collectedBaseType}), else a multiple float, integers promoted, each number
 * weighted when a `weight-identifier` is given; of a written base type that is not numerical, a
 * multiple of it, unweighted.
 *
 * @param expression The `qti-test-variables`.
 * @param scope The holder and the variables of the run, which carry the test scope.
 * @returns The values, NULL when there is none or past the container bound; or the record's gap,
 *   with no test scope or when an item's record holds no value of the response or outcome named.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OutTestVariables
 */
const evaluateTestVariables: Evaluator<"test-variables"> = (expression, scope) =>
  Result.gen(function* collectVariables() {
    const test = yield* heldScope(scope.variables, expression.kind);
    const written = expression.baseType.pipe(Option.filter(isModelled));
    const isWeighted = Option.isSome(expression.weightIdentifier);
    const floatDeclared =
      Option.isNone(expression.baseType) && declaresFloat(test, expression.variableIdentifier);
    const collected: Collected[] = [];
    for (const item of keptItems(test, expression)) {
      const named = itemName(item, expression.variableIdentifier);
      if (
        Option.isSome(named) &&
        named.value.type.cardinality === "single" &&
        collects(expression.baseType, named.value.type.baseType)
      ) {
        const reading = yield* itemVariable(item, expression.variableIdentifier);
        const [single] = reading.kind === "held" ? reading.value.values : [];
        if (single !== undefined) {
          collected.push({ item, single });
        }

        if (collected.length > containerSizeBound) {
          return nullOf(collectedBaseType(written, isWeighted, floatDeclared), "multiple");
        }
      }
    }

    const baseType = collectedBaseType(written, isWeighted, floatDeclared);

    return {
      baseType,
      cardinality: "multiple",
      values: collected.map((each) => collectedSingle(baseType, expression.weightIdentifier, each)),
    } satisfies Value;
  });

/**
 * The test family's evaluators by kind.
 */
export const testEvaluators: FamilyTable<TestKind> = {
  "number-correct": evaluateNumberCorrect,
  "number-incorrect": evaluateNumberIncorrect,
  "number-presented": evaluateNumberPresented,
  "number-responded": evaluateNumberResponded,
  "number-selected": evaluateNumberSelected,
  "outcome-maximum": evaluateOutcomeMaximum,
  "outcome-minimum": evaluateOutcomeMinimum,
  "test-variables": evaluateTestVariables,
};
