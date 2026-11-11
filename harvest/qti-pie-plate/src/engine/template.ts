/**
 * The template interpreter: an item's template processing, run from the item's declared state as a
 * pure function of the item, its template rules and one stream of draws.
 *
 * {@link runTemplates} gives the value of each template variable and the correct responses and
 * defaults the rules set, by identifier. The rules run in order, each seeing what the rules before
 * it left, and every expression goes through the evaluator (`evaluateExpression` in
 * `#plate/engine/evaluate.ts`) with the one stream the caller passes, so a seed in gives the same
 * values out. Template processing may read only template variables (`info.txt:65111`), so the
 * evaluator sees the template values and no response or outcome value. A failure of what the
 * caller passed is an {@link EngineFailure} returned in a `Result`, as the evaluator returns it;
 * the first one ends the run.
 *
 * A test may redefine an item's declared state: each `qti-template-default` of the item's ref
 * sets a template variable's default, "evaluated at test-level" before "the templateProcessing
 * rules of the item itself are followed" (`info.txt:46025`). {@link evaluateTemplateDefaults}
 * evaluates an item ref's defaults over the test's names, {@link checkTemplateDefaults} checks them
 * against the item, and {@link runTemplates} starts from them.
 *
 * Value imports point one way: `#plate/engine/attempt.ts` to here, and here to the evaluator.
 *
 * @module
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Root_TemplateProcessing
 */
import { Option, Result } from "effect";
import {
  evaluateExpression,
  isTrue,
  OutcomeMismatchError,
  UnknownIdentifierError,
} from "#plate/engine/evaluate.ts";
import type { Declarations, EngineFailure, Variables } from "#plate/engine/evaluate.ts";
import type { Draw } from "#plate/engine/random.ts";
import type { TestScope } from "#plate/engine/scope.ts";
import type { TemplateRule } from "#plate/model/expression.ts";
import type {
  Expression,
  Item,
  ResponseDeclaration,
  TemplateDeclaration,
} from "#plate/model/item.ts";
import type { TemplateDefault, Test } from "#plate/model/test.ts";
import { isNull, nullOf } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * What template processing leaves, each map by identifier: the value of every template variable,
 * and the correct responses and defaults its rules set.
 *
 * `templates` holds every template variable the item declares. `correct` and `defaults` hold only
 * the variables a `qti-set-correct-response` or a `qti-set-default-value` set; the item's own
 * declarations are never changed, so a variable the rules did not set keeps its declared correct
 * response or default, which the evaluator reads behind these maps (`Variables.correct` and
 * `Variables.defaults` in `#plate/engine/evaluate.ts`). Every value is of its target's declared
 * base type and cardinality, or a built-in's own type for a built-in ({@link builtInTargets}), a
 * NULL included.
 */
export interface TemplateValues {
  readonly correct: Readonly<Record<string, Value>>;
  readonly defaults: Readonly<Record<string, Value>>;
  readonly templates: Readonly<Record<string, Value>>;
}

/**
 * The number of restarts one run of template processing may take, shared by all its
 * `qti-template-constraint`s, so it runs its rules at most 101 times.
 *
 * QTI requires "a finite maximum number of iterations" and assumes 100 (`info.txt:45736`). The
 * budget is G-R2, pending: one shared budget of 100 restarts per run; when it runs out, a failing
 * constraint applies the declared state and processing continues after it.
 */
const restartBudget = 100;

/**
 * A template rule that sets a variable: a `qti-set-template-value`, a `qti-set-correct-response`
 * or a `qti-set-default-value`.
 */
type SetRule = Extract<TemplateRule, { readonly identifier: string }>;

/**
 * The map of {@link TemplateValues} each setting rule writes.
 */
const setMaps = {
  "set-correct-response": "correct",
  "set-default-value": "defaults",
  "set-template-value": "templates",
} as const satisfies Readonly<Record<SetRule["kind"], keyof TemplateValues>>;

/**
 * One run of the rules: the item, the stream, the declared state a restart returns to, and whether
 * the run's restarts are spent.
 */
interface Pass {
  readonly declared: TemplateValues;
  readonly draw: Draw;
  readonly item: Item;
  /**
   * Whether the budget's restarts are all taken, so a failing constraint applies the declared state
   * and processing continues after it instead of restarting.
   */
  readonly spent: boolean;
}

/**
 * How a sequence of rules ended: on its last rule (`next`, so the rules after it run) or at a
 * `qti-exit-template` (`exit`), each with what the rules left; or at a failing constraint that
 * restarts the run (`restart`), which keeps nothing.
 */
type Step =
  | { readonly kind: "exit" | "next"; readonly values: TemplateValues }
  | { readonly kind: "restart" };

/**
 * Give the state template processing starts from: each template variable at the default the test
 * gives it, else its declared default, else NULL of its declared base type and cardinality, and no
 * correct response or default set.
 *
 * @param item The item, whose template declarations give each variable's type and default.
 * @param given The test's defaults, checked against the item ({@link checkTemplateDefaults}).
 * @returns The declared state.
 */
const declaredState = (item: Item, given: Readonly<Record<string, Value>>): TemplateValues => ({
  correct: {},
  defaults: {},
  templates: {
    ...Object.fromEntries(
      Array.from(item.templates, ([identifier, declaration]) => [
        identifier,
        Option.getOrElse(declaration.defaultValue, () =>
          nullOf(declaration.baseType, declaration.cardinality),
        ),
      ]),
    ),
    ...given,
  },
});

/**
 * Give the value of an expression of template processing: through the evaluator, with the run's
 * stream and the template values the rules have left, and no response or outcome value, because
 * template processing "may only refer to the values of the template variables" (`info.txt:65111`).
 *
 * So a `qti-variable` of a response or an outcome is the record's gap, and a `qti-equal` whose
 * `tolerance` names an outcome is NULL; the validator refuses the first (P26), and the second
 * stays NULL (OD-P8-20).
 *
 * @param expression The expression.
 * @param pass The run.
 * @param values What the rules before it left.
 * @returns The expression's value, or the evaluator's first failure.
 */
const evaluateIn = (
  expression: Expression,
  pass: Pass,
  values: TemplateValues,
): Result.Result<Value, EngineFailure> =>
  evaluateExpression(
    expression,
    pass.item,
    { outcomes: {}, responses: {}, templates: values.templates },
    pass.draw,
  );

/**
 * The base type and cardinality of a variable a setting rule sets.
 */
type TargetType = Pick<TemplateDeclaration, "baseType" | "cardinality">;

/**
 * The built-in variables the engine holds that each setting rule may set, with their types: the
 * built-in response `numAttempts`, a single integer, for `qti-set-correct-response`, and it and the
 * built-in outcome `completionStatus`, a single identifier, for `qti-set-default-value`. A
 * built-in stands as a declaration of its kind (reading 111, "a processing element's
 * `identifier` names a variable of the kind the element reads or sets"). `duration` is not among
 * them: the engine holds no item's time spent, and the item model marks a template processing that
 * sets it, which then does not run. Written here, not read from `#plate/engine/refs.ts` or
 * `#plate/model/record.ts`, so this module value-imports nothing more.
 */
const builtInTargets: Readonly<Record<SetRule["kind"], ReadonlyMap<string, TargetType>>> = {
  "set-correct-response": new Map([
    ["numAttempts", { baseType: "integer", cardinality: "single" }],
  ]),
  "set-default-value": new Map<string, TargetType>([
    ["completionStatus", { baseType: "identifier", cardinality: "single" }],
    ["numAttempts", { baseType: "integer", cardinality: "single" }],
  ]),
  "set-template-value": new Map(),
};

/**
 * Give the type of the variable a setting rule sets: a template variable for
 * `qti-set-template-value`, a response for `qti-set-correct-response`, and a response or an
 * outcome for `qti-set-default-value`, as the information model names their targets and the
 * validator holds them (`templateTarget` in `#plate/validate/rules.ts`): the item's declaration of
 * it, else, when the item declares no variable by that name, a built-in of that kind
 * ({@link builtInTargets}), typed as the built-in, whose correct response or default is then
 * recorded as a declared variable's is. A declared variable wins over a built-in of the same name.
 *
 * @param item The item.
 * @param rule The setting rule.
 * @returns The target's base type and cardinality, or an {@link UnknownIdentifierError} when the
 *   item declares no variable of that kind by that name and it names no built-in of that kind.
 */
const targetOf = (item: Item, rule: SetRule): Result.Result<TargetType, UnknownIdentifierError> => {
  const { identifier } = rule;
  const declares =
    item.responses.has(identifier) ||
    item.outcomes.has(identifier) ||
    item.templates.has(identifier) ||
    item.records?.has(identifier) === true;
  const found = declares
    ? {
        "set-correct-response": () => item.responses.get(identifier),
        "set-default-value": () => item.responses.get(identifier) ?? item.outcomes.get(identifier),
        "set-template-value": () => item.templates.get(identifier),
      }[rule.kind]()
    : builtInTargets[rule.kind].get(identifier);

  return Result.fromOption(
    Option.fromUndefinedOr(found),
    () =>
      new UnknownIdentifierError({
        holder: "item",
        identifier: rule.identifier,
        role: rule.kind === "set-correct-response" ? "response" : "variable",
      }),
  );
};

/**
 * Give the value a variable stores when it is set to a value.
 *
 * QTI assigns without conversion, as `qti-set-outcome-value` does (`setOutcome` in
 * `#plate/engine/evaluate.ts`): a value of another base type or cardinality fails, and a NULL,
 * which has no type to differ, is stored as the target's own NULL. So every value stored is of its
 * target's declared type.
 *
 * @param target The variable's declared base type and cardinality.
 * @param identifier The variable's identifier.
 * @param value The value it is set to.
 * @returns The value stored; or an {@link OutcomeMismatchError} when the value is not NULL and its
 *   type differs from the target's.
 */
const fitted = (
  target: Pick<TemplateDeclaration, "baseType" | "cardinality">,
  identifier: string,
  value: Value,
): Result.Result<Value, OutcomeMismatchError> => {
  if (isNull(value)) {
    return Result.succeed(nullOf(target.baseType, target.cardinality));
  }

  return value.baseType === target.baseType && value.cardinality === target.cardinality
    ? Result.succeed(value)
    : Result.fail(
        new OutcomeMismatchError({
          actual: `${value.baseType} ${value.cardinality}`,
          expected: `${target.baseType} ${target.cardinality}`,
          identifier,
        }),
      );
};

/**
 * Set the variable a setting rule names to a value, in the map the rule writes ({@link setMaps}),
 * without conversion ({@link fitted}).
 *
 * @param item The item, whose declaration gives the target's type.
 * @param values What the rules before it left.
 * @param rule The setting rule.
 * @param value The expression's value.
 * @returns What the rules leave with the variable set; or an {@link UnknownIdentifierError} when
 *   the item declares no variable of the rule's kind by that name, or an
 *   {@link OutcomeMismatchError} when the value is not NULL and its type differs from the target's.
 */
const assign = (
  item: Item,
  values: TemplateValues,
  rule: SetRule,
  value: Value,
): Result.Result<TemplateValues, OutcomeMismatchError | UnknownIdentifierError> =>
  Result.gen(function* assignOneVariable() {
    const target = yield* targetOf(item, rule);
    const stored = yield* fitted(target, rule.identifier, value);
    const map = setMaps[rule.kind];

    return { ...values, [map]: { ...values[map], [rule.identifier]: stored } };
  });

/**
 * Check an item ref's template defaults against the item, where the engine applies them.
 *
 * Each key must name a template variable the item declares, and each value is set to it as
 * template processing sets one ({@link fitted}): without conversion, a NULL stored as the
 * variable's own NULL. A test and its items each pass `check` apart, so a default that does not fit
 * is caller input, returned and never thrown. A session checks the defaults before the item's
 * first attempt (`firstAttempt` in `#plate/engine/attempt.ts`), so a failure of that attempt after
 * a checked default is the item's own template processing; {@link runTemplates} checks them again
 * where it applies them.
 *
 * @param item The item the defaults set: its template declarations.
 * @param defaults The defaults, by template identifier, as {@link evaluateTemplateDefaults} gives
 *   them.
 * @returns The defaults as the item stores them, each a value of its variable's declared type; or
 *   the first that does not fit, in the defaults' order: an {@link UnknownIdentifierError} (holder
 *   `item`, role `variable`) when its key names no template variable of the item, or an
 *   {@link OutcomeMismatchError} when its value is not NULL and its type differs from the
 *   variable's.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_TemplateDefault
 */
export const checkTemplateDefaults = (
  item: Pick<Item, "templates">,
  defaults: Readonly<Record<string, Value>>,
): Result.Result<Readonly<Record<string, Value>>, OutcomeMismatchError | UnknownIdentifierError> =>
  Result.gen(function* checkEachTemplateDefault() {
    const checked: (readonly [string, Value])[] = [];
    for (const [identifier, value] of Object.entries(defaults)) {
      const target = yield* Result.fromOption(
        Option.fromUndefinedOr(item.templates.get(identifier)),
        () => new UnknownIdentifierError({ holder: "item", identifier, role: "variable" }),
      );
      checked.push([identifier, yield* fitted(target, identifier, value)]);
    }

    return Object.fromEntries(checked);
  });

/**
 * The declarations a test's holder makes of responses: none, since a test is not an item.
 */
const noResponses: ReadonlyMap<string, ResponseDeclaration> = new Map();

/**
 * The declarations a test's holder makes of template variables: none, since a test is not an item.
 */
const noTemplates: ReadonlyMap<string, TemplateDeclaration> = new Map();

/**
 * Evaluate an item ref's template defaults.
 *
 * Each expression is evaluated "at test-level" (`info.txt:46025`): over the test's declarations
 * holder (its outcome declarations, no response and no template variable), with the test's
 * outcomes at their current values, so a default reads an unprefixed test outcome as the session
 * holds it, and the scope as `Variables.test`, so it reads a prefixed name through the item it
 * names. The defaults are evaluated in document order from the one stream given, so two drawing
 * defaults take its draws in turn. A later default of the same template variable replaces an
 * earlier one. The values are the expressions' own; {@link checkTemplateDefaults} checks them
 * against the item they set.
 *
 * @param defaults The item ref's template defaults, in document order (`ItemRef.templateDefaults`).
 * @param test The test: its outcome declarations, the holder the expressions read.
 * @param outcomes The test's outcome values as the session holds them (`TestSession.outcomes`).
 * @param scope What the expressions read of the test's items. A template default's scope holds no
 *   time, so the test's `duration` reads NULL.
 * @param draw The one stream every random kind of the item ref's defaults draws from, in
 *   evaluation order. A session passes `drawStream(session.seed, defaultLabel(session.instance,
 *   sequenceIndex))` (`defaultLabel` in `#plate/engine/random.ts`) for the item at that place in
 *   the sequence; the default key would draw the same numbers for every session.
 * @returns Each default's value, by template identifier; or the first {@link EngineFailure}, after
 *   which no default is evaluated: an {@link UnknownIdentifierError} (holder `record`) when an
 *   expression reads a name the test's processing holds no value of, as in an outcome run, or any
 *   other failure of the evaluator.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_TemplateDefault
 */
export const evaluateTemplateDefaults = (
  defaults: readonly TemplateDefault[],
  test: Pick<Test, "outcomes">,
  outcomes: Readonly<Record<string, Value>>,
  scope: TestScope,
  draw: Draw,
): Result.Result<Readonly<Record<string, Value>>, EngineFailure> => {
  const holder: Declarations = {
    outcomes: test.outcomes,
    responses: noResponses,
    templates: noTemplates,
  };
  const variables: Variables = { outcomes, responses: {}, test: scope };

  return Result.gen(function* evaluateEachTemplateDefault() {
    const evaluated: (readonly [string, Value])[] = [];
    for (const { expression, templateIdentifier } of defaults) {
      evaluated.push([
        templateIdentifier,
        yield* evaluateExpression(expression, holder, variables, draw),
      ]);
    }

    return Object.fromEntries(evaluated);
  });
};

/**
 * Choose the rules a `qti-template-condition` runs: those of its first branch whose condition is
 * true, else its `otherwise`, else none. Branch conditions are evaluated in order, and none after
 * the chosen branch or a failing one, so a branch after it draws nothing.
 *
 * @param condition The `qti-template-condition`.
 * @param pass The run.
 * @param values What the rules before it left.
 * @returns The chosen rules, or the first failure of a branch condition.
 */
const chosenRules = (
  condition: Extract<TemplateRule, { readonly kind: "template-condition" }>,
  pass: Pass,
  values: TemplateValues,
): Result.Result<readonly TemplateRule[], EngineFailure> =>
  Result.gen(function* chooseTemplateBranch() {
    for (const branch of condition.branches) {
      if (isTrue(yield* evaluateIn(branch.when, pass, values))) {
        return branch.then;
      }
    }

    return Option.getOrElse(condition.otherwise, () => []);
  });

/**
 * Run one template rule.
 *
 * A setting rule sets its variable ({@link assign}); a condition runs the rules it chooses
 * ({@link chosenRules}); a `qti-exit-template` ends the run, at any depth, keeping what is set. A
 * `qti-template-constraint` whose condition is true lets the rules after it run; one that is false
 * or NULL restarts the run, or, once the run's restarts are spent, applies the declared state and
 * lets the rules after it run.
 *
 * @param rule The rule.
 * @param pass The run.
 * @param values What the rules before it left.
 * @returns How the rule ended, or its first failure.
 */
const runRule = (
  rule: TemplateRule,
  pass: Pass,
  values: TemplateValues,
): Result.Result<Step, EngineFailure> =>
  Result.gen(function* runOneTemplateRule() {
    switch (rule.kind) {
      case "exit-template": {
        return { kind: "exit", values };
      }
      case "template-condition": {
        const then = yield* chosenRules(rule, pass, values);

        // oxlint-disable-next-line eslint/no-use-before-define -- `runRule` and `runSequence` are mutually recursive, as conditions nest; the call runs only after both are defined.
        return yield* runSequence(then, pass, values);
      }
      case "template-constraint": {
        if (isTrue(yield* evaluateIn(rule.expression, pass, values))) {
          return { kind: "next", values };
        }

        return pass.spent ? { kind: "next", values: pass.declared } : { kind: "restart" };
      }
      case "set-correct-response":
      case "set-default-value":
      case "set-template-value": {
        const value = yield* evaluateIn(rule.expression, pass, values);

        return { kind: "next", values: yield* assign(pass.item, values, rule, value) };
      }
      default: {
        return rule satisfies never;
      }
    }
  });

/**
 * Run template rules in order until one exits or restarts, each seeing what the rules before it
 * left.
 *
 * @param rules The rules.
 * @param pass The run.
 * @param values What the rules before them left.
 * @returns How the sequence ended, or the first failure.
 */
const runSequence = (
  rules: readonly TemplateRule[],
  pass: Pass,
  values: TemplateValues,
): Result.Result<Step, EngineFailure> =>
  Result.gen(function* runTemplateRulesInOrder() {
    let current = values;
    for (const rule of rules) {
      const step = yield* runRule(rule, pass, current);
      if (step.kind !== "next") {
        return step;
      }

      current = step.values;
    }

    return { kind: "next", values: current };
  });

/**
 * Run an item's template processing.
 *
 * The run starts from the declared state: each template variable at the default the test gives
 * it, else its declared default, else NULL of its type, and no correct response or default set.
 * The test's defaults are checked first, where they are applied ({@link checkTemplateDefaults}).
 * The rules run in order, each seeing what the rules before it left; `qti-set-template-value` sets
 * its template variable, and `qti-set-correct-response` and `qti-set-default-value` write the
 * result's `correct` and `defaults`, never the item. A `qti-template-condition` runs its first
 * branch whose condition is a single boolean `true`, else its `qti-template-else`; a
 * `qti-exit-template` ends the run, nested or not, keeping what is set.
 *
 * A `qti-template-constraint` that is false or NULL restarts the run from the declared state, the
 * test's defaults included, since the test redefines the declared state for this item, both
 * override maps emptied, "repeatedly until the expression is 'true' or the maximum number of
 * iterations is reached" (`info.txt:45736`). The run's constraints share one budget of 100
 * restarts (G-R2, pending). When it runs out, the declared state applies and processing continues
 * after the constraint, and a later failing constraint applies it again and continues. The stream
 * is never reset, so each restart draws new values.
 *
 * Every expression reads the template values and no response or outcome value, as template
 * processing "may only refer to the values of the template variables" (`info.txt:65111`).
 *
 * @param item The item, whose declarations give each variable's type and default.
 * @param rules The item's template rules, as the item model built them (`Item.templateProcessing`).
 * @param draw The one stream every random kind of the run draws from, in the order the rules
 *   evaluate them, restarts included: the caller's, keyed by the record's seed under the item's
 *   template label (`templateLabel` in `#plate/engine/random.ts`).
 * @param templateDefaults The defaults the test's item ref gives the item's template variables, by
 *   template identifier ({@link evaluateTemplateDefaults}); none by default.
 * @returns The template values and the correct responses and defaults set; or the first failure,
 *   after which no rule runs: an {@link UnknownIdentifierError} when a test's default names no
 *   template variable of the item (holder `item`), an expression reads a variable template
 *   processing holds no value of, or a rule sets a variable the item does not declare in the kind
 *   the rule sets, an {@link OutcomeMismatchError} when a test's default or a rule sets a variable
 *   to a value of another type that is not NULL, or any other failure of the evaluator.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_TemplateConstraint
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_TemplateDefault
 */
export const runTemplates = (
  item: Item,
  rules: readonly TemplateRule[],
  draw: Draw,
  templateDefaults: Readonly<Record<string, Value>> = {},
): Result.Result<TemplateValues, EngineFailure> =>
  Result.gen(function* runFromDeclaredState() {
    const declared = declaredState(item, yield* checkTemplateDefaults(item, templateDefaults));
    let restarts = 0;
    let step = yield* runSequence(rules, { declared, draw, item, spent: false }, declared);
    while (step.kind === "restart") {
      restarts += 1;
      step = yield* runSequence(
        rules,
        { declared, draw, item, spent: restarts === restartBudget },
        declared,
      );
    }

    return step.values;
  });
