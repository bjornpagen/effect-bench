/**
 * The attempt: the record an item's first attempt starts with, and one non-adaptive submission of
 * an item, from the record before it to the record after its response processing.
 *
 * {@link firstAttempt} starts the record: it runs the item's template processing under the record's
 * seed, from the declared state with any template defaults the test gives, and sets every response
 * and outcome to its default, a record response's being its declared default or the NULL record.
 * {@link runAttempt} sets the responses, counts the attempt, resets the declared outcomes, carries
 * the built-in `completionStatus` over, and runs the item's rules with the evaluator over the
 * record's template values and overrides. Both are pure and return the engine's failure rather
 * than throw it. The author's flow decides whether an attempt may run (rule `a9d04969`); this
 * module only runs it.
 *
 * Value imports point one way: here to the template interpreter (`#plate/engine/template.ts`), and
 * both to the evaluator.
 *
 * @module
 */
import { Option, Result } from "effect";
import { runRules } from "#plate/engine/evaluate.ts";
import type { EngineFailure, Variables } from "#plate/engine/evaluate.ts";
import { drawStream, responseLabel, templateLabel } from "#plate/engine/random.ts";
import { own } from "#plate/engine/refs.ts";
import { checkTemplateDefaults, runTemplates } from "#plate/engine/template.ts";
import type { TemplateValues } from "#plate/engine/template.ts";
import type { Item } from "#plate/model/item.ts";
import {
  completionStatus,
  completionValue,
  fresh,
  holdsCompletionStatus,
  outcomeDefaults,
  unrunTemplateProcessing,
} from "#plate/model/record.ts";
import type { ItemRecord } from "#plate/model/record.ts";
import { nullOf, nullRecord } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * Give each declared outcome of an item the value it holds before any processing sets it: the
 * default template processing set for it, else its starting value, and the built-in
 * `completionStatus` at `not_attempted` where the item holds it, as {@link outcomeDefaults} gives
 * them. A default set for a response is not an outcome's, so it never joins the outcomes.
 *
 * @param item The item.
 * @param defaults The defaults template processing set, by identifier.
 * @returns The outcomes, keyed by identifier.
 */
const outcomeStart = (item: Item, defaults: ItemRecord["defaults"]): ItemRecord["outcomes"] => ({
  ...outcomeDefaults(item),
  ...Object.fromEntries(
    Object.entries(defaults).filter(([identifier]) => item.outcomes.has(identifier)),
  ),
});

/**
 * Give each response of an item its default (D4-11): the default template processing set for it,
 * else its declared default, else NULL of its declared type.
 *
 * @param item The item.
 * @param defaults The defaults template processing set, by identifier.
 * @returns The responses, keyed by identifier.
 */
const responseStart = (item: Item, defaults: ItemRecord["defaults"]): ItemRecord["responses"] =>
  Object.fromEntries(
    Array.from(item.responses, ([identifier, response]) => [
      identifier,
      Option.getOrElse(
        Option.orElse(own(defaults, identifier), () => response.defaultValue),
        () => nullOf(response.baseType, response.cardinality),
      ),
    ]),
  );

/**
 * Give each record response of an item its default (D4-11 for a record), by identifier: its
 * declared default, else the NULL record. Template processing never sets a record response's
 * default (a rule that would is marked `record-set` and does not run), so the declaration's is the
 * only one. Every record response the item holds then has an entry, so a `qti-field-value`,
 * `qti-is-null` or `qti-match` over one the attempt is not given reads its default, NULL included,
 * as results do, and never fails for want of a value.
 *
 * @param item The item.
 * @returns The record responses' values, keyed by identifier.
 */
const recordStart = (item: Item): ItemRecord["records"] =>
  Object.fromEntries(
    [...(item.records?.values() ?? [])].map((declared) => [
      declared.identifier,
      Option.getOrElse(declared.defaultValue, () => nullRecord),
    ]),
  );

/**
 * Give the value the built-in `completionStatus` holds when an attempt's processing starts. It
 * "starts with the reserved value 'not_attempted'. At the start of the first attempt it changes to
 * the reserved value 'unknown'. It remains with this value for the duration of the item session
 * unless set to a different value by a setOutcomeValue rule" (`info.txt:8488`). So the first
 * attempt, where the record counts none, starts it at `unknown`; every later attempt starts from
 * the record's value, the one the last processing left, `not_attempted` included, adaptive or not,
 * and from `unknown` where the record lacks the built-in, as one written before it was held does.
 * The non-adaptive reset to the declared defaults (`info.txt:8486`) covers declared outcomes, and
 * the built-in has no declaration.
 *
 * @param record The session record before the attempt.
 * @returns The built-in's value as the rules first read it.
 */
const startingCompletion = (record: ItemRecord): Value =>
  record.numAttempts === 0
    ? completionValue("unknown")
    : (record.outcomes[completionStatus] ?? completionValue("unknown"));

/**
 * Give the outcomes an attempt's processing starts from: each declared outcome at its default, the
 * one the record's template processing set, else its starting value ({@link outcomeStart}),
 * because a non-adaptive item resets them before each response processing run, and the built-in
 * `completionStatus`, where the item holds it, as {@link startingCompletion} gives it. So no
 * declared outcome the record holds reaches the rules.
 *
 * @param item The item.
 * @param record The session record before the attempt.
 * @returns The outcomes, keyed by identifier.
 */
const startingOutcomes = (item: Item, record: ItemRecord): ItemRecord["outcomes"] => {
  const defaults = outcomeStart(item, record.defaults);

  return holdsCompletionStatus(item)
    ? { ...defaults, [completionStatus]: startingCompletion(record) }
    : defaults;
};

/**
 * Run one non-adaptive attempt of an item.
 *
 * In order: the given responses replace the record's values of the same identifiers, and every
 * other response keeps the record's value; `numAttempts` goes up by one; the declared outcomes
 * reset to their defaults, each the one the record's template processing set, else its starting
 * value, because a non-adaptive item resets them before each response processing run, and the
 * built-in `completionStatus` starts at `unknown` at the first attempt and at the record's value
 * at every later one ({@link startingCompletion}); the item's rules run over those variables, and
 * with no processing the outcomes stay where they started; `attempt` becomes `submitted`. The
 * rules read the built-in `numAttempts` as the raised count, this attempt included, because QTI
 * raises it at the start of each attempt, and may read and set `completionStatus`, which the
 * record then keeps into the next attempt. They read the record's template values, and a
 * `qti-correct` or a `qti-default` reads the correct response or default the record's template
 * processing set before the declaration's. They are given each record response's value from the
 * record's `records`, beside the responses. The record's seed, template values, correct responses,
 * defaults and record responses' values are copied unchanged, since a stored value always wins
 * over recomputation. The record passed in is not changed, on success or on failure.
 *
 * The rules draw from one stream, keyed by the record's seed under the attempt's response label
 * (`responseLabel`): `<instance>\u001Fresponse\u001F<numAttempts>`, with the record's instance and
 * the raised count the rules read, so each attempt draws its own values and the same record and
 * responses give the same values every run. Every operand of an expression is evaluated, left
 * to right, and a condition's branches until the first true one, so each random kind takes its
 * draws in that order; `qti-custom-operator` evaluates none of its operands, so a random kind
 * inside it never draws.
 *
 * @param item The item the record belongs to.
 * @param record The session record before the attempt.
 * @param responses The candidate's responses, by identifier, each a value of its declaration's
 *   base type and cardinality.
 * @returns The record after the attempt, or the evaluator's first failure, an
 *   {@link EngineFailure}: a rule names an identifier the item or the variables do not hold, sets
 *   an outcome to a value of another type, or maps a response that has no mapping.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#IV_Outcome
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#IV_Response
 */
export const runAttempt = (
  item: Item,
  record: ItemRecord,
  responses: ItemRecord["responses"],
): Result.Result<ItemRecord, EngineFailure> => {
  const numAttempts = record.numAttempts + 1;
  const before: Variables = {
    correct: record.correct,
    defaults: record.defaults,
    numAttempts: BigInt(numAttempts),
    outcomes: startingOutcomes(item, record),
    records: record.records,
    responses: { ...record.responses, ...responses },
    templates: record.templates,
  };
  const after: Result.Result<Variables, EngineFailure> = Option.match(item.processing, {
    onNone: () => Result.succeed(before),
    onSome: (rules) =>
      runRules(
        rules,
        item,
        before,
        drawStream(record.seed, responseLabel(record.instance, numAttempts)),
      ),
  });

  return after.pipe(
    Result.map((variables): ItemRecord => ({
      ...record,
      attempt: "submitted",
      numAttempts,
      outcomes: variables.outcomes,
      responses: before.responses,
    })),
  );
};

/**
 * Start the record of an item's first attempt: template processing, then the response, record
 * response and outcome defaults (D4-11).
 *
 * The record is {@link fresh}'s for the instance, under the given seed, with:
 *
 * - `templates`, `correct` and `defaults`, in one of three cases:
 *
 *   - Where the item's template processing runs (`Item.templateProcessing` is some), what it leaves
 *     (`runTemplates` in `#plate/engine/template.ts`), run from the declared state with one stream,
 *     keyed by the seed under the item's template label, `<instance>\u001Ftemplate\u001F<item>`
 *     (`templateLabel`), so the same seed, instance and item give the same values every run. The
 *     declared state holds each template variable at the default the test gives it, else its declared
 *     default, else NULL, and a constraint's restart returns to it.
 *   - Where the item has no `qti-template-processing`, each declared template variable at the default
 *     the test gives it, else its declared default, else NULL, the values no processing changes, and
 *     no override; an item that declares none holds three empty maps.
 *   - Where it has a `qti-template-processing` the item model marks, because it holds an element the
 *     engine does not run or names a variable the engine does not hold while it runs (such as
 *     `QTI_CONTEXT`, a context variable, or a template variable, response or outcome of a type plate
 *     does not model, read or set), no override, and no template value but the defaults the test
 *     gives, since nothing else computed them. Each response and outcome begins at its declared
 *     default, and `check`'s verdict tells the host, `accepted-with-unsupported` with each mark
 *     (`variable:<identifier>` at `qti-template-processing` for a name the engine does not hold).
 * - `responses`: each at its default, the one template processing set, else the declared one, else
 *   NULL of its type, before any response is given.
 * - `records`: each record response at its declared default, else the NULL record, before any
 *   response is given ({@link recordStart}).
 * - `outcomes`: each declared outcome at its default, the one template processing set, else its
 *   starting value (`startingValue` in `#plate/model/record.ts`), and the built-in
 *   `completionStatus` at `not_attempted`, as {@link fresh} writes it.
 *
 * The values are drawn once, here: {@link runAttempt} reads them from the record and never runs
 * template processing again.
 *
 * @param item The item.
 * @param start The use of the item the record starts.
 * @param start.instance The host's name for this use of the item, which scopes its ids.
 * @param start.seed The key of the stream template processing draws from: the caller's, used as
 *   given.
 * @param start.templateDefaults The defaults the test's item ref gives the item's template
 *   variables, by template identifier, as `evaluateTemplateDefaults` in
 *   `#plate/engine/template.ts` gives them; none by default. Each is checked where it is applied
 *   (`checkTemplateDefaults`), in every one of the three cases.
 * @returns The record, or the first failure, an {@link EngineFailure}: a test's default names no
 *   template variable of the item (an {@link UnknownIdentifierError}, holder `item`) or is a value
 *   of another type (an {@link OutcomeMismatchError}); or template processing's own: an expression
 *   reads a variable template processing holds no value of, a rule sets a variable the item does
 *   not declare in the kind the rule sets, or sets one to a value of another type. A test and its
 *   items each pass `check` apart, so a default that does not fit is caller input; a caller that
 *   checks the defaults first (`checkTemplateDefaults`) knows a failure after it is the item's
 *   own. None of the item's own occurs on a checked item: the validator refuses each, or the item
 *   model marks the template processing that would cause it, which then does not run.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_TemplateDefault
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Root_TemplateProcessing
 */
export const firstAttempt = (
  item: Item,
  start: {
    readonly instance: string;
    readonly seed: string;
    readonly templateDefaults?: Readonly<Record<string, Value>>;
  },
): Result.Result<ItemRecord, EngineFailure> => {
  const draw = drawStream(start.seed, templateLabel(start.instance, item.identifier));
  const given = start.templateDefaults ?? {};
  const set: Result.Result<TemplateValues, EngineFailure> = Option.match(item.templateProcessing, {
    onNone: () =>
      unrunTemplateProcessing(item)
        ? Result.map(checkTemplateDefaults(item, given), (templates): TemplateValues => ({
            correct: {},
            defaults: {},
            templates,
          }))
        : runTemplates(item, [], draw, given),
    onSome: (rules) => runTemplates(item, rules, draw, given),
  });

  return set.pipe(
    Result.map((values): ItemRecord => ({
      ...fresh(item, start.instance),
      correct: values.correct,
      defaults: values.defaults,
      outcomes: outcomeStart(item, values.defaults),
      records: recordStart(item),
      responses: responseStart(item, values.defaults),
      seed: start.seed,
      templates: values.templates,
    })),
  );
};
