/**
 * The test scope: what a test's outcome processing reads of the test's items, and the lookups it
 * reads them through.
 *
 * A test is not an item, so its processing runs with a declarations holder (the evaluator's
 * `Declarations`: the test's outcome declarations, no response and no template variable) and a
 * {@link TestScope}, which the evaluator's `Variables.test` carries. `#plate/engine/refs.ts` reads
 * a prefixed name through {@link prefixedVariable}, and the outcome-only kinds read the items the
 * filters keep ({@link keptItems}) and each item's variable by name ({@link itemVariable}). The
 * scope is data: a session builds it (`testScopeOf` in `#plate/engine/outcome.ts`), and a test may
 * build one by hand.
 *
 * It is a browser module. It value-imports only `effect`'s `Option` and `Result`, two engine
 * leaves, `#plate/engine/failures.ts` and `#plate/engine/numbers.ts`, and two of the model's,
 * `#plate/model/item-refs.ts` for the occurrence form of a prefixed name's rest and
 * `#plate/model/values.ts` for the NULL record, and reads the model's and the evaluator's types as
 * types: it imports no session value, and none of `#plate/engine/refs.ts`, which reads a prefixed
 * name through it.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Declarations } from "#plate/engine/evaluate.ts";
import { UnknownIdentifierError } from "#plate/engine/failures.ts";
import { integerValue } from "#plate/engine/numbers.ts";
import { occurrenceOf } from "#plate/model/item-refs.ts";
import type { RecordDeclaration } from "#plate/model/item.ts";
import type { ScopeRecord } from "#plate/model/record.ts";
import { nullRecord } from "#plate/model/values.ts";
import type { ModelledBaseType, RecordValue, Value } from "#plate/model/values.ts";

/**
 * A type a declaration may give a variable: any of QTI's base types, `file` included, and any of
 * its cardinalities, `record` included.
 */
export interface DeclaredType {
  readonly baseType: ModelledBaseType | "file";
  readonly cardinality: Value["cardinality"] | "record";
}

/**
 * One item of the session, as the test's processing reads it: its item ref's identifier,
 * categories, weights and variable mappings; its item's declarations, its record responses among
 * them; what its record holds; whether it was presented; and how many of its attempts have started.
 */
export interface ScopeItem {
  /**
   * The item ref's `category` identifiers.
   */
  readonly categories: readonly string[];
  /**
   * The item's response, outcome and template declarations of modelled types, as its item model
   * holds them.
   */
  readonly declarations: Declarations;
  /**
   * The item ref's variable mappings, each `target-identifier` keyed to its `source-identifier`.
   */
  readonly mappings: ReadonlyMap<string, string>;
  /**
   * The number of the item's attempts started ({@link attemptsStarted}), which its built-in
   * `numAttempts` reads: 0 until the item is presented, and at least 1 once it is.
   */
  readonly numAttempts: number;
  /**
   * Whether the candidate has been shown the item.
   */
  readonly presented: boolean;
  /**
   * What the item's record holds: its responses and its record responses' records, its outcomes
   * (the built-in `completionStatus` among them), its template values, and the correct responses
   * and defaults its template processing set.
   */
  readonly record: ScopeRecord;
  /**
   * The item's record response declarations, by identifier, each with its declared correct
   * response and default; absent, as in a scope built by hand, when the item makes none. A read of
   * one gives the record its item's record holds ({@link Reading}), and `qti-number-responded`,
   * `qti-number-correct` and `qti-number-incorrect` judge it against its declared default and
   * correct response.
   */
  readonly records?: ReadonlyMap<string, RecordDeclaration>;
  /**
   * The identifier of the item ref the item delivers.
   */
  readonly ref: string;
  /**
   * The item's declarations of a type the value model holds no value of, by identifier: those of
   * base type `file`, its outcome and template declarations of cardinality `record`, and a record
   * response with a field of base type `file`. The record never holds a value of one, so a read of
   * one gives NULL of its declared type. The record responses the item model holds are
   * {@link ScopeItem.records}, never here.
   */
  readonly unheld: ReadonlyMap<string, DeclaredType>;
  /**
   * The item's response declarations of a type the value model holds no value of, the record
   * responses of {@link ScopeItem.records} not among them, by identifier, each keyed to whether it
   * declares a correct response; absent, as in a scope built by hand, when the item makes none.
   * `qti-number-correct` and `qti-number-incorrect` read it: they do not judge an item one of whose
   * responses declares no correct response, and a judged item's unheld response reads NULL, which
   * matches no correct response.
   */
  readonly unheldResponses?: ReadonlyMap<string, boolean>;
  /**
   * The item ref's weights, each `qti-weight`'s `identifier` keyed to its `value`.
   */
  readonly weights: ReadonlyMap<string, number>;
}

/**
 * What a test's processing reads of its items: one entry per session item, in sequence order; the
 * test's parts and sections, each with the item refs it holds; the names the test declares whole;
 * and the test's own `duration`.
 */
export interface TestScope {
  /**
   * The identifiers the test declares: its outcome and context declarations. A dotted one is
   * never split into an item ref and a variable.
   */
  readonly declared: ReadonlySet<string>;
  /**
   * The test's own `duration` in seconds; none in a scope that holds no time, such as a template
   * default's (G-R3, pending: a template default reads the test's duration as NULL).
   */
  readonly duration: Option.Option<number>;
  /**
   * One entry per session item, in sequence order: the order the candidate meets them, which an
   * aggregate's float sum depends on.
   */
  readonly items: readonly ScopeItem[];
  /**
   * Each test part's identifier, keyed to the identifiers of the item refs it holds at any depth.
   */
  readonly parts: ReadonlyMap<string, readonly string[]>;
  /**
   * The identifiers of the test's item refs that a selection with replacement can repeat
   * (`Test.repeatable`), through which alone a numbered reading such as `a.2.SCORE` counts (reading
   * 88). Absent, as in a scope built by hand, no item ref is repeatable.
   */
  readonly repeatable?: ReadonlySet<string>;
  /**
   * Each section's identifier, keyed to the identifiers of the item refs it holds, those of its
   * nested sections included.
   */
  readonly sections: ReadonlyMap<string, readonly string[]>;
}

/**
 * The filters a test-level count or aggregate takes over a test's items: the section whose items
 * it reads and the categories it includes and excludes, each optional. It has the shape of the
 * outcome-only kinds' filters in `#plate/model/expression.ts`, so their variants pass as they are.
 */
export interface ItemFilters {
  readonly excludeCategory: Option.Option<readonly string[]>;
  readonly includeCategory: Option.Option<readonly string[]>;
  readonly sectionIdentifier: Option.Option<string>;
}

/**
 * What a test-level read of an item variable gives: `held`, a value of a type the value model
 * holds, NULL included; `record`, the record a record response holds, the NULL record included;
 * or `unheld`, NULL of a declared type the value model does not hold, base type `file` or a record
 * outcome or template variable. A context variable read through an item ref is not read:
 * `openPackage` marks the processing that reads it (repair9-9), and in documents opened apart the
 * read fails {@link UnknownIdentifierError}.
 */
export type Reading =
  | { readonly kind: "held"; readonly value: Value }
  | { readonly kind: "record"; readonly value: RecordValue }
  | { readonly kind: "unheld"; readonly type: DeclaredType };

/**
 * Count the attempts an item session has started, its built-in `numAttempts`, from what a session
 * stores: whether the item was presented, how many of its attempts were processed, and its
 * effective attempt limit.
 *
 * The count "defaults to '0' initially and then increases by '1' at the start of each attempt"
 * (`info.txt:8468`). An attempt starts at the item's first presentation, and again at once after
 * each submission that leaves the item open, so a presented item has started one more attempt than
 * it has processed, unless its processed attempts reached its limit and closed it. The results
 * report writes this count, and a test's processing reads it through the test scope, so the two
 * agree.
 *
 * @example
 *   attemptsStarted(true, 0, 1); // 1: presented, its one attempt not yet submitted
 *   attemptsStarted(true, 1, 2); // 2: one wrong submission, the item still open
 *   attemptsStarted(true, 2, 2); // 2: the limit reached, the item closed
 *
 * @param presented Whether the candidate was shown the item.
 * @param processed The record's count of processed attempts.
 * @param limit The effective attempt limit, 0 for none.
 * @returns The attempts started, 0 when the item was never presented.
 */
export const attemptsStarted = (presented: boolean, processed: number, limit: number): number => {
  if (!presented) {
    return 0;
  }

  return limit > 0 && processed >= limit ? processed : processed + 1;
};

/**
 * The item-session built-ins a test reads through an item ref that the engine holds a value of.
 * A prefix also reaches an item's `QTI_CONTEXT` (reading 106, "a prefixed reference reaches every
 * built-in variable its item ref's item holds, `QTI_CONTEXT` among them"), as the qti package's
 * `BuiltInVariable` holds it under an item's root (`packages/pantry/src/grammar/install.ts`), but
 * the engine holds none: `openPackage` marks the processing that reads one through its item ref,
 * as it marks a read of a declared context variable, so on a checked package the engine never
 * reads it, and in documents opened apart the read fails {@link UnknownIdentifierError}.
 */
type ItemBuiltIn = "completionStatus" | "duration" | "numAttempts";

/**
 * What a name read through an item ref names in its item, with the variable's type: one of its
 * declared variables of a modelled type, by the item's own identifier; one of its record responses
 * ({@link ScopeItem.records}); one of a type the value model does not hold; or an item-session
 * built-in.
 */
export type ItemName =
  | {
      readonly identifier: string;
      readonly kind: "outcome" | "record" | "response" | "template";
      readonly type: DeclaredType;
    }
  | { readonly identifier: string; readonly kind: "unheld"; readonly type: DeclaredType }
  | { readonly identifier: ItemBuiltIn; readonly kind: "built-in"; readonly type: DeclaredType };

/**
 * A prefixed name's one resolving reading: the item it reads through, what its rest names in that
 * item and at which occurrence, and what it reads.
 */
export interface PrefixedRead {
  readonly item: ScopeItem;
  readonly named: ItemName;
  /**
   * The occurrence the name reads, counted from 1 ({@link occurrenceOf}): 1 for `ITEMREF.VAR` and
   * `ITEMREF.1.VAR`.
   */
  readonly occurrence: bigint;
  readonly reading: Reading;
}

/**
 * The type of each item-session built-in, as pantry types it through an item ref (the table
 * `builtInTypes` in `packages/pantry/src/grammar/expression.ts`, over `builtIns` in
 * `packages/pantry/src/grammar/references.ts`): `duration` is a float in an item.
 */
const itemBuiltIns: Readonly<Record<ItemBuiltIn, DeclaredType>> = {
  completionStatus: { baseType: "identifier", cardinality: "single" },
  duration: { baseType: "float", cardinality: "single" },
  numAttempts: { baseType: "integer", cardinality: "single" },
};

/**
 * Report whether a name is an item-session built-in.
 *
 * @param name The name.
 * @returns Whether it is one.
 */
const isItemBuiltIn = (name: string): name is ItemBuiltIn => Object.hasOwn(itemBuiltIns, name);

/**
 * Look up a value by identifier among a record map's own keys, so an inherited member such as
 * `constructor`, a valid identifier, is never read as a value (as `own` in
 * `#plate/engine/refs.ts` reads the variables, which this module may not value-import).
 *
 * @param values The record's responses, record responses' records, outcomes or template values.
 * @param identifier The identifier.
 * @returns The value, or none when the map holds no value by that name.
 */
const ownValue = <A extends RecordValue | Value>(
  values: Readonly<Record<string, A>>,
  identifier: string,
): Option.Option<A> =>
  Object.hasOwn(values, identifier) ? Option.fromUndefinedOr(values[identifier]) : Option.none();

/**
 * Report whether an item ref's categories share one with a list (9.25; G-R3, pending: one shared
 * category is enough to include an item, and one to exclude it).
 *
 * @param item The item.
 * @param categories The list.
 * @returns Whether they share one.
 */
const sharesCategory = (item: ScopeItem, categories: readonly string[]): boolean =>
  item.categories.some((category) => categories.includes(category));

/**
 * Give the items a test-level count or aggregate reads: those the `section-identifier` holds, the
 * section's nested sections included, then those with a category of `include-category`, then
 * those with none of `exclude-category` (9.25; G-R3, pending: one shared category is enough to
 * include an item, and one to exclude it).
 *
 * An absent filter keeps every item. A written list may be empty: an empty `include-category`
 * keeps no item and an empty `exclude-category` drops none. A `section-identifier` names a section,
 * as QTI's `sectionIdentifier` does ("the assessmentSection with matching identifier"), so one that
 * names no section of the test keeps no item.
 *
 * @param scope The test scope.
 * @param filters The filters.
 * @returns The items kept, in sequence order.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Derived_Number
 */
export const keptItems = (scope: TestScope, filters: ItemFilters): readonly ScopeItem[] => {
  const inSection = filters.sectionIdentifier.pipe(
    Option.map((identifier) => new Set(scope.sections.get(identifier))),
  );

  return scope.items.filter(
    (item) =>
      Option.match(inSection, { onNone: () => true, onSome: (refs) => refs.has(item.ref) }) &&
      Option.match(filters.includeCategory, {
        onNone: () => true,
        onSome: (categories) => sharesCategory(item, categories),
      }) &&
      !Option.exists(filters.excludeCategory, (categories) => sharesCategory(item, categories)),
  );
};

/**
 * The type a record response is read by. A record has no base type of its own, and the scope's
 * type holds one, so it is read as of base type `file`, which the value model does not hold
 * either: no filter on a modelled base type keeps it, and no kind that reads a single keeps it.
 */
const recordType: DeclaredType = { baseType: "file", cardinality: "record" };

/**
 * Find the declaration an item makes of a variable, of a modelled type or not.
 *
 * Declaration identifiers are unique together, so the order responses, outcomes, template
 * variables, record responses, unheld never decides between two.
 *
 * @param item The item.
 * @param identifier The variable's identifier in the item.
 * @returns What it names, none when the item declares nothing by that name.
 */
const declarationOf = (item: ScopeItem, identifier: string): Option.Option<ItemName> => {
  const { outcomes, responses, templates } = item.declarations;
  const declared = (
    kind: "outcome" | "response" | "template",
    declaration: DeclaredType | undefined,
  ): Option.Option<ItemName> =>
    Option.map(Option.fromUndefinedOr(declaration), (type) => ({
      identifier,
      kind,
      type: { baseType: type.baseType, cardinality: type.cardinality },
    }));

  return Option.firstSomeOf([
    declared("response", responses.get(identifier)),
    declared("outcome", outcomes.get(identifier)),
    declared("template", templates.get(identifier)),
    Option.map(Option.fromUndefinedOr(item.records?.get(identifier)), (): ItemName => ({
      identifier,
      kind: "record",
      type: recordType,
    })),
    Option.map(Option.fromUndefinedOr(item.unheld.get(identifier)), (type): ItemName => ({
      identifier,
      kind: "unheld",
      type,
    })),
  ]);
};

/**
 * Resolve a name an item is read by, in pantry's order (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`, its source declared, mapped or built in): a
 * target of the item ref's variable mappings names the variable its source names, else the item's
 * own declaration of the name, else an item-session built-in.
 *
 * A mapping counts only when the item declares its source, as pantry keeps a mapping in an item
 * ref's scope; one whose source the item does not declare is passed over. A checked package's
 * mapping source names an outcome of its item, so there the passing over never happens.
 *
 * @param item The item.
 * @param name The name, as the test's processing writes it.
 * @returns What it names, none when it names nothing of the item.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Derived_VariableMapping
 */
export const itemName = (item: ScopeItem, name: string): Option.Option<ItemName> =>
  Option.firstSomeOf([
    Option.flatMap(Option.fromUndefinedOr(item.mappings.get(name)), (source) =>
      declarationOf(item, source),
    ),
    declarationOf(item, name),
    isItemBuiltIn(name)
      ? Option.some<ItemName>({ identifier: name, kind: "built-in", type: itemBuiltIns[name] })
      : Option.none<ItemName>(),
  ]);

/**
 * Give the reading of a value the record holds.
 *
 * @param value The value.
 * @returns It, `held`.
 */
const held = (value: Value): Reading => ({ kind: "held", value });

/**
 * Give NULL of a declared type: a record outcome or template variable reads the `unheld` NULL, as
 * does a variable of base type `file` (G-R4, pending: a record outcome or template variable read
 * through an item ref reads NULL). A context variable read through an item ref is not read:
 * `openPackage` marks the processing that reads it (repair9-9), and in documents opened apart the
 * read fails {@link UnknownIdentifierError}.
 *
 * @param type The type.
 * @returns The `held` NULL of a type the value model holds, else the `unheld` NULL.
 */
const nullReading = (type: DeclaredType): Reading => {
  const { baseType, cardinality } = type;

  return baseType === "file" || cardinality === "record"
    ? { kind: "unheld", type }
    : { kind: "held", value: { baseType, cardinality, values: [] } };
};

/**
 * Give what a name that names an occurrence that does not exist reads: the NULL record of a record
 * response, else NULL of the variable's declared type ({@link nullReading}).
 *
 * @param named What the name names.
 * @returns The reading.
 */
const absentReading = (named: ItemName): Reading =>
  named.kind === "record" ? { kind: "record", value: nullRecord } : nullReading(named.type);

/**
 * Read the value of the variable a name names in an item, from its record.
 *
 * - A response or an outcome reads the record's value; a record that holds none is the record's gap,
 *   as a stored record lacking a value is in an item's own processing.
 * - A record response reads the record its item's record holds of it, the NULL record when it holds
 *   none: an unanswered record response with no declared default holds none.
 * - A template variable reads the record's value; with none, because the item has not been presented
 *   or its template processing does not run, it reads NULL of its declared type (G-R3, pending: an
 *   item variable with no value reads NULL; Admission A3).
 * - A variable of base type `file`, and a record outcome or template variable, reads NULL of its
 *   declared type, which the record never holds (G-R3, pending; G-R4, pending). A context variable
 *   read through an item ref is not read: `openPackage` marks the processing that reads it
 *   (repair9-9), and in documents opened apart the read fails {@link UnknownIdentifierError}.
 * - The built-in `numAttempts` reads the started attempt count ({@link ScopeItem.numAttempts}), a
 *   single integer, and `completionStatus` the record's outcome of that name. The engine holds no
 *   item's `duration`, and the test model marks a processing that reads it, so it is the record's
 *   gap.
 *
 * @param item The item.
 * @param named What the name names.
 * @returns The reading, or an {@link UnknownIdentifierError} with holder `record` when the record
 *   holds no value of a response, an outcome, `completionStatus` or `duration`.
 */
const readingOf = (
  item: ScopeItem,
  named: ItemName,
): Result.Result<Reading, UnknownIdentifierError> => {
  const { record } = item;
  const gap = (role: "outcome" | "response" | "variable") =>
    new UnknownIdentifierError({ holder: "record", identifier: named.identifier, role });

  switch (named.kind) {
    case "response": {
      return Result.fromOption(Option.map(ownValue(record.responses, named.identifier), held), () =>
        gap("response"),
      );
    }
    case "outcome": {
      return Result.fromOption(Option.map(ownValue(record.outcomes, named.identifier), held), () =>
        gap("outcome"),
      );
    }
    case "template": {
      return Result.succeed(
        Option.match(ownValue(record.templates, named.identifier), {
          onNone: () => nullReading(named.type),
          onSome: held,
        }),
      );
    }
    case "record": {
      return Result.succeed({
        kind: "record",
        value: Option.getOrElse(ownValue(record.records, named.identifier), () => nullRecord),
      });
    }
    case "unheld": {
      return Result.succeed(nullReading(named.type));
    }
    case "built-in": {
      if (named.identifier === "numAttempts") {
        return Result.succeed(held(integerValue(BigInt(item.numAttempts))));
      }

      return named.identifier === "completionStatus"
        ? Result.fromOption(Option.map(ownValue(record.outcomes, named.identifier), held), () =>
            gap("outcome"),
          )
        : Result.fail(gap("variable"));
    }
    default: {
      return named satisfies never;
    }
  }
};

/**
 * Give the value of an item variable by name, as `qti-test-variables`, `qti-outcome-minimum` and
 * `qti-outcome-maximum` read one: the variable {@link itemName} resolves the name to, read from
 * the item's record.
 *
 * A response or an outcome reads the record's value, a template variable the record's value or,
 * with none, NULL of its declared type, a record response its record, the NULL record when the
 * record holds none, a variable of base type `file` or a record outcome or template variable NULL
 * of its declared type, `numAttempts` the started attempt count and `completionStatus` the
 * record's (G-R3, pending: an item variable with no value reads NULL; Admission A3).
 *
 * @param item The item.
 * @param name The name, as the test's processing writes it.
 * @returns The reading; or an {@link UnknownIdentifierError}: with holder `item` when the name
 *   names nothing of the item, or with holder `record` when the record holds no value of a
 *   declared response or outcome.
 */
export const itemVariable = (
  item: ScopeItem,
  name: string,
): Result.Result<Reading, UnknownIdentifierError> =>
  Option.match(itemName(item, name), {
    onNone: () =>
      Result.fail(
        new UnknownIdentifierError({ holder: "item", identifier: name, role: "variable" }),
      ),
    onSome: (named) => readingOf(item, named),
  });

/**
 * One reading of a dotted name that resolves (reading 48, "a dotted reference is accepted when
 * exactly one reading names a real item ref, test part or section and its variable"): through an
 * item ref, the item variable its rest names at an occurrence; or a part's or a section's
 * `duration`.
 */
type Resolved =
  | {
      readonly item: ScopeItem;
      readonly kind: "item";
      readonly named: ItemName;
      readonly occurrence: bigint;
    }
  | { readonly kind: "duration" };

/**
 * Resolve one split or numbered reading of a dotted name, in pantry's order (the relation `Reading`
 * in `packages/pantry/src/qti/expressions.ts`, its source mapped, declared or built in), as the
 * package resolves it (`readingOf` in `#plate/package/open.ts`).
 *
 * After an item ref, the rest names what {@link itemName} resolves it to. Its numbered form `N.VAR`
 * ({@link occurrenceOf}) names occurrence `N` of `VAR` only through an item ref a selection with
 * replacement can repeat ({@link TestScope.repeatable}), as the package counts a numbered reading
 * (reading 88, "a numbered reference such as `Q01.2.SCORE` names an instance of an item ref that a
 * selection with replacement can repeat, and nothing else"; `isCounted` in
 * `#plate/package/open.ts`). Through any other item ref the rest is the variable whole, at
 * occurrence 1, and a numbered rest names nothing there, since an identifier never starts with a
 * digit. After a part or a section, the rest is its `duration`.
 *
 * @param scope The test scope.
 * @param prefix The part before the dot the reading splits at.
 * @param rest The part after it.
 * @returns The reading, none when it does not resolve.
 */
const resolve = (scope: TestScope, prefix: string, rest: string): Option.Option<Resolved> => {
  const item = scope.items.find((each) => each.ref === prefix);
  if (item === undefined) {
    return (scope.parts.has(prefix) || scope.sections.has(prefix)) && rest === "duration"
      ? Option.some({ kind: "duration" })
      : Option.none();
  }

  const { occurrence, variable } =
    scope.repeatable?.has(prefix) === true
      ? occurrenceOf(rest)
      : { occurrence: 1n, variable: rest };

  return Option.map(itemName(item, variable), (named) => ({
    item,
    kind: "item",
    named,
    occurrence,
  }));
};

/**
 * Give the value of a dotted name, a prefixed reference of a test's processing, by reading 48 ("a
 * dotted reference is accepted when exactly one reading names a real item ref, test part or
 * section and its variable").
 *
 * A name has one reading for each dot it may split at, from the first, and the name reads its one
 * resolving reading ({@link resolve}): `ITEMREF.VAR` reads the item's variable as
 * {@link itemVariable} does, a mapping target first. A numbered reading counts only through an
 * item ref a selection with replacement can repeat ({@link TestScope.repeatable}), as the package
 * counts it (reading 88, "a numbered reference such as `Q01.2.SCORE` names an instance of an item
 * ref that a selection with replacement can repeat, and nothing else"): through one,
 * `ITEMREF.1.VAR` reads the item's variable as `ITEMREF.VAR` does, and `ITEMREF.N.VAR` with `N`
 * other than 1 names an occurrence that does not exist, since selection with replacement is marked,
 * and reads NULL of the variable's type, the NULL record of a record response (G-R3, pending;
 * Admission A3). So `a.2.SCORE` in a test with item refs `a` and `a.2` reads `a.2`'s `SCORE` when
 * `a` is not repeatable, and nothing when it is, two readings resolving it.
 *
 * A name the test declares whole is never split: it names the test's own variable, its unsplit
 * reading. On a checked package no other reading resolves it, since the package counts the
 * unsplit reading beside the split and numbered ones (reading 48, "the unsplit reading counts
 * among them") and refuses the name as `ambiguous-reference` where another resolves too. A name
 * no reading resolves, or two readings resolve (Admission A4), reads nothing. On a checked package
 * the second is refused `ambiguous-reference`. The first is refused `undeclared-variable`, unless
 * its one resolving reading is a section document's item ref, whose item the scope does not hold:
 * in a test that references a section document, the test model marks a processing that reads a
 * dotted name unless the test's own part, section or item ref reads a variable name holding no dot
 * through it (`isPrefixedHeld` in `#plate/model/test.ts`). Where that own item declares no such
 * variable and a section document's item ref resolves the name, the package, which reads the
 * items, marks the processing that reads it (`judgeTest` in `#plate/package/open.ts`). So a
 * checked package reaches neither; only a test and items checked apart reach either. The engine
 * holds no part's or section's `duration`, and the test model marks a
 * processing that reads one, so that reading reads nothing too.
 *
 * @param scope The test scope.
 * @param name The name, as the test's processing writes it.
 * @returns The item the name reads through, what it names there and at which occurrence, and its
 *   reading; or an {@link UnknownIdentifierError} with holder `record` when the test declares the
 *   name whole, when no reading or more than one resolves it, when it reads a part's or a
 *   section's `duration`, or when the item's record holds no value of the response or outcome it
 *   names.
 */
export const prefixedVariable = (
  scope: TestScope,
  name: string,
): Result.Result<PrefixedRead, UnknownIdentifierError> => {
  const nothing = new UnknownIdentifierError({
    holder: "record",
    identifier: name,
    role: "variable",
  });
  if (scope.declared.has(name)) {
    return Result.fail(nothing);
  }

  const readings: Resolved[] = [];
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    readings.push(...Option.toArray(resolve(scope, name.slice(0, dot), name.slice(dot + 1))));
  }

  const [only, ...more] = readings;
  if (only === undefined || more.length > 0 || only.kind === "duration") {
    return Result.fail(nothing);
  }

  const { item, named, occurrence } = only;
  if (occurrence !== 1n) {
    return Result.succeed({ item, named, occurrence, reading: absentReading(named) });
  }

  return Result.map(readingOf(item, named), (reading) => ({ item, named, occurrence, reading }));
};

/**
 * Give the weight an item ref gives a variable: its `qti-weight` of that identifier, else 1.0
 * (G-R3, pending: a weight the item ref does not define is 1.0).
 *
 * @param item The item.
 * @param identifier The `weight-identifier`.
 * @returns The weight.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#DataCharacteristic_Weight
 */
export const weightOf = (item: ScopeItem, identifier: string): number =>
  item.weights.get(identifier) ?? 1;

/**
 * Give the value of the test's own built-in `duration`: a single duration of its seconds, or NULL
 * of base type duration when the scope holds no time (G-R3, pending: a template default reads the
 * test's duration as NULL).
 *
 * @param scope The test scope.
 * @returns The value.
 */
export const durationOf = (scope: TestScope): Value => ({
  baseType: "duration",
  cardinality: "single",
  values: Option.match(scope.duration, {
    onNone: () => [],
    onSome: (seconds) => [{ baseType: "duration", value: seconds }],
  }),
});
