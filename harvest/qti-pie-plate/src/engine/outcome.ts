/**
 * The outcome interpreter: one run of a test's outcome processing, as a pure function of the test,
 * the test scope and the stream the run draws from.
 *
 * {@link runOutcomes} starts every test outcome at its declared default, else its starting value,
 * and runs the test's rules through the evaluator's `runRules` with the test's declarations holder
 * (its outcome declarations, no response and no template variable) and the test scope, so each run
 * starts afresh whatever an earlier run left. {@link testScopeOf} builds that scope from a session:
 * what the test's processing reads of the test's items. When a run happens, its number and its
 * stream are the caller's: run `n` of a session draws from
 * `drawStream(session.seed, outcomeLabel(session.instance, n))`, never from the default key.
 *
 * It is a browser module. It value-imports only `effect`'s `Option` and `Result`, the evaluator,
 * the scope's `attemptsStarted` and the record's `startingValue`, and reads the session's and the
 * models' types as types: the engine imports no session value, so a session's caller passes each
 * item ref's attempt limit.
 *
 * @module
 */
import { Option, Result } from "effect";
import { runRules } from "#plate/engine/evaluate.ts";
import type { Declarations, EngineFailure } from "#plate/engine/evaluate.ts";
import type { Draw } from "#plate/engine/random.ts";
import { attemptsStarted } from "#plate/engine/scope.ts";
import type { DeclaredType, ScopeItem, TestScope } from "#plate/engine/scope.ts";
import type {
  Item,
  RecordDeclaration,
  ResponseDeclaration,
  TemplateDeclaration,
  UnheldDeclaration,
} from "#plate/model/item.ts";
import { startingValue } from "#plate/model/record.ts";
import type { ItemRef, SectionChild, Test } from "#plate/model/test.ts";
import type { Value } from "#plate/model/values.ts";
import type { SessionItem, TestSession } from "#plate/session/session.ts";

/**
 * The declarations a test's holder makes of responses: none, since a test is not an item.
 */
const noResponses: ReadonlyMap<string, ResponseDeclaration> = new Map();

/**
 * The declarations a test's holder makes of template variables: none, since a test is not an item.
 */
const noTemplates: ReadonlyMap<string, TemplateDeclaration> = new Map();

/**
 * Give each of a test's outcomes the value it holds before a run's rules: its declared default,
 * else its starting value (0 for a single integer or float, else NULL).
 *
 * @param test The test.
 * @returns Each outcome's starting value, keyed by identifier.
 */
const startingOutcomes = (test: Pick<Test, "outcomes">): Readonly<Record<string, Value>> =>
  Object.fromEntries(
    Array.from(test.outcomes, ([identifier, outcome]) => [identifier, startingValue(outcome)]),
  );

/**
 * Run a test's outcome processing once.
 *
 * Every outcome starts at its declared default, else its starting value, whatever an earlier run
 * left, since outcome processing runs from the declared defaults each time
 * (`info.txt:9236`). An `absent` processing and a `marked` one, which the engine cannot run, run
 * nothing and give the starting outcomes. A `runs` processing runs its rules in order through
 * `runRules`, with the test's outcome declarations as the declarations holder, no response, no
 * template variable, and the scope as `Variables.test`, so a prefixed name and the outcome-only
 * kinds read the test's items through it. A `qti-exit-test` ends that run, keeping what the rules
 * before it set, and the next run runs the rules again (G-R3, pending: `qti-exit-test` ends the run
 * of outcome processing, not the test).
 *
 * @param test The test: its outcome declarations and its outcome processing.
 * @param scope What the run reads of the test's items, and the test's own duration.
 * @param draw The one stream every random kind of the run draws from, in evaluation order. A
 *   session passes `drawStream(session.seed, outcomeLabel(session.instance, n))` for run `n`; the
 *   default key would draw the same numbers for every session.
 * @returns The outcomes after the run, keyed by identifier; or the first {@link EngineFailure} of
 *   a rule, after which no rule runs.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Root_OutcomeProcessing
 */
export const runOutcomes = (
  test: Pick<Test, "outcomeProcessing" | "outcomes">,
  scope: TestScope,
  draw: Draw,
): Result.Result<Readonly<Record<string, Value>>, EngineFailure> => {
  const outcomes = startingOutcomes(test);
  const processing = test.outcomeProcessing;

  switch (processing.kind) {
    case "absent":
    case "marked": {
      return Result.succeed(outcomes);
    }
    case "runs": {
      const holder: Declarations = {
        outcomes: test.outcomes,
        responses: noResponses,
        templates: noTemplates,
      };

      return Result.map(
        runRules(processing.rules, holder, { outcomes, responses: {}, test: scope }, draw),
        (variables) => variables.outcomes,
      );
    }
    default: {
      return processing satisfies never;
    }
  }
};

/**
 * An item the host passed for an item ref, as the scope reads it: the item's declarations, its
 * record responses, and its declarations of a type the value model does not hold. An accepted item
 * passes as it is.
 */
interface DeliveredItem {
  readonly item: Declarations & Pick<Item, "records" | "unheld">;
}

/**
 * The test's structure as the scope reads it: each item ref by identifier, and each part's and
 * each section's item refs at any depth.
 */
interface Structure {
  readonly parts: Map<string, readonly string[]>;
  readonly refs: Map<string, ItemRef>;
  readonly sections: Map<string, readonly string[]>;
}

/**
 * Give the identifiers of the item refs a part's or a section's children hold, those of nested
 * sections included, in document order, recording each item ref and each section's own item refs
 * in the structure as it goes.
 *
 * @param children The children.
 * @param structure The structure being built.
 * @returns The item refs' identifiers.
 */
const refsIn = (children: readonly SectionChild[], structure: Structure): readonly string[] => {
  const held: string[] = [];
  for (const child of children) {
    if (child.kind === "item-ref") {
      structure.refs.set(child.identifier, child);
      held.push(child.identifier);
    } else {
      const nested = refsIn(child.children, structure);
      structure.sections.set(child.identifier, nested);
      held.push(...nested);
    }
  }

  return held;
};

/**
 * Give a test's structure: its item refs, and each part's and each section's item refs.
 *
 * @param test The test.
 * @returns The structure.
 */
const structureOf = (test: Pick<Test, "parts">): Structure => {
  const structure: Structure = { parts: new Map(), refs: new Map(), sections: new Map() };
  for (const part of test.parts) {
    structure.parts.set(part.identifier, refsIn(part.children, structure));
  }

  return structure;
};

/**
 * Give the type the scope reads a declaration of an unheld type by. A record's `base-type` is
 * optional, and the scope's type holds a base type, so a record that writes none is read as of
 * base type `file`, which the value model does not hold either: no filter on a modelled base type
 * keeps it.
 *
 * @param declaration The declaration.
 * @returns Its base type and cardinality.
 */
const declaredTypeOf = (declaration: UnheldDeclaration): DeclaredType => ({
  baseType: Option.getOrElse(declaration.baseType, (): DeclaredType["baseType"] => "file"),
  cardinality: declaration.cardinality,
});

/**
 * What the scope reads of an item ref the test does not hold: no category, weight or mapping.
 */
const unreferenced: Pick<ItemRef, "category" | "mappings" | "weights"> = {
  category: [],
  mappings: new Map(),
  weights: new Map(),
};

/**
 * What the scope reads of an item the host did not pass: no declaration.
 */
const undelivered: DeliveredItem["item"] = {
  outcomes: new Map(),
  responses: noResponses,
  templates: noTemplates,
};

/**
 * The record responses the scope reads of an item that declares none.
 */
const noRecords: ReadonlyMap<string, RecordDeclaration> = new Map();

/**
 * The declarations of a type the value model does not hold that the scope reads of an item that
 * makes none.
 */
const noUnheld: ReadonlyMap<string, UnheldDeclaration> = new Map();

/**
 * Give one session item's entry in the scope.
 *
 * @param sessionItem The session item.
 * @param ref Its item ref, none when the test holds no item ref by its `ref`.
 * @param delivered The item the host passed for its ref, none when it passed none.
 * @param limit Its item ref's effective attempt limit, 0 for none.
 * @returns The entry.
 */
const entryOf = (
  sessionItem: SessionItem,
  ref: Option.Option<ItemRef>,
  delivered: Option.Option<DeliveredItem>,
  limit: number,
): ScopeItem => {
  const { category, mappings, weights } = Option.getOrElse(ref, () => unreferenced);
  const item = Option.match(delivered, { onNone: () => undelivered, onSome: (each) => each.item });
  const { record } = sessionItem;
  const unheld = item.unheld ?? noUnheld;

  return {
    categories: category,
    declarations: { outcomes: item.outcomes, responses: item.responses, templates: item.templates },
    mappings,
    numAttempts: attemptsStarted(sessionItem.presented, record.numAttempts, limit),
    presented: sessionItem.presented,
    record: {
      correct: record.correct,
      defaults: record.defaults,
      outcomes: record.outcomes,
      records: record.records,
      responses: record.responses,
      templates: record.templates,
    },
    records: item.records ?? noRecords,
    ref: sessionItem.ref,
    unheld: new Map(
      Array.from(unheld, ([identifier, declaration]) => [identifier, declaredTypeOf(declaration)]),
    ),
    unheldResponses: new Map(
      [...unheld.values()].flatMap((declaration) =>
        declaration.kind === "response"
          ? [[declaration.identifier, declaration.declaresCorrect] as const]
          : [],
      ),
    ),
    weights,
  };
};

/**
 * Give the test scope of a session: what the test's outcome processing reads of the test's items.
 *
 * The entries follow the session's items, in the order the candidate meets them, whatever order the
 * items map was built in, since an aggregate's float sum depends on the order of its operands: two
 * hosts that build the map apart get one scope. Each entry holds its item ref's categories, weights
 * and variable mappings, its item's declarations, its record responses (`ScopeItem.records`) and
 * those of a type the value model does not hold among them (with whether each unheld response
 * declares a correct response), its record's responses, record responses' records, outcomes,
 * template values, and the correct responses and defaults its template processing set (no seed),
 * whether it was presented, and the attempts it has started under its item ref's limit
 * (`attemptsStarted`, the count the results report writes). The scope holds every part's and every
 * section's item refs at any depth, the names the test declares: its outcomes' identifiers and
 * every identifier its outcome and context declarations declare (`Test.declared`), and the item
 * refs a selection with replacement can repeat (`Test.repeatable`), through which alone a numbered
 * name reads; a test that gives none, as one built by hand may, has none.
 *
 * A session and items that do not fit the test meet three fallbacks: an entry whose `ref` names no
 * item ref of the test has no category, weight or mapping, one whose item the map lacks declares
 * nothing, so a read through it names nothing of the item, and one whose `ref` the limits lack
 * counts its attempts as under no limit.
 *
 * @param test The test: its parts, its outcome declarations, the identifiers it declares, and its
 *   repeatable item refs.
 * @param items The items the host passed, keyed by item ref identifier, as the session's
 *   transitions take them.
 * @param session The session.
 * @param limits Each item ref's effective attempt limit, 0 for none, keyed by its identifier, as
 *   `attemptLimits` in `#plate/session/control.ts` derives them: the engine imports no session
 *   value, so the caller passes them.
 * @param duration The test's own `duration` in seconds, from the session's start to the
 *   transition's time; none in a scope that holds no time, such as a template default's.
 * @returns The scope.
 */
export const testScopeOf = (
  test: Pick<Test, "declared" | "outcomes" | "parts" | "repeatable">,
  items: ReadonlyMap<string, DeliveredItem>,
  session: Pick<TestSession, "items">,
  limits: ReadonlyMap<string, number>,
  duration: Option.Option<number>,
): TestScope => {
  const { parts, refs, sections } = structureOf(test);
  const scope: TestScope = {
    declared: new Set([...test.outcomes.keys(), ...(test.declared ?? [])]),
    duration,
    items: session.items.map((sessionItem) =>
      entryOf(
        sessionItem,
        Option.fromUndefinedOr(refs.get(sessionItem.ref)),
        Option.fromUndefinedOr(items.get(sessionItem.ref)),
        limits.get(sessionItem.ref) ?? 0,
      ),
    ),
    parts,
    sections,
  };

  return test.repeatable === undefined ? scope : { ...scope, repeatable: test.repeatable };
};
