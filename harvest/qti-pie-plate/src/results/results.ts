/**
 * Results Reporting: {@link results} writes one `assessmentResult` document for an item or a test
 * session, in the Results namespace with its camelCase names, through `writeDocument`.
 *
 * Nothing new is stored for a result. The built-in `numAttempts` and `sessionStatus` are derived
 * from whether an item was presented, its record's count of processed attempts and its effective
 * attempt limit; `answeredStatus` from its values, its defaults and `checkResponses`. The built-in
 * `completionStatus` is the record's once an attempt is processed, and derived like the others
 * before. Every value is written in the lexical form `#plate/results/values.ts` fixes, a record
 * response's as one `value` per field, and no `correctResponse` is written. A result names its
 * item's or test's outcomes and each item's template values, so a page that writes one holds the
 * candidate's scores and the values that can give its answers away. A test result resolves every
 * item's session control in one walk of the test, so it takes time linear in the test's item refs.
 *
 * @module
 */
import type { Attribute, Child, Element } from "@qti-pie/crust/tree.ts";
import { Array as Arr, Data, Option, Result } from "effect";
import { decodeRecord, storedVersion } from "#plate/codec/record.ts";
import type { InvalidRecord, StoredRecord } from "#plate/codec/record.ts";
import { decodeSession, InvalidSession } from "#plate/codec/session.ts";
import type { SessionMismatch, StoredTestSession } from "#plate/codec/session.ts";
import type { Configuration } from "#plate/configuration.ts";
import { xmlnsNamespace } from "#plate/document/source.ts";
import { writeDocument } from "#plate/document/write.ts";
import { attemptsStarted } from "#plate/engine/scope.ts";
import { isXmlText } from "#plate/form/encoding.ts";
import { interactionsIn } from "#plate/model/interactions.ts";
import type {
  Interaction,
  Item,
  OutcomeDeclaration,
  OutcomeReporting,
  TemplateDeclaration,
} from "#plate/model/item.ts";
import {
  completionStatus,
  completionValue,
  holdsCompletionStatus,
  startingValue,
} from "#plate/model/record.ts";
import type { ItemRecord } from "#plate/model/record.ts";
import { atDefault, isNcName, isNullResponse, nullOf, nullRecord } from "#plate/model/values.ts";
import type { ModelledBaseType, ResponseValue, Value } from "#plate/model/values.ts";
import { defaultOutputBudget } from "#plate/output-budget.ts";
import { choiceOrder, hiddenOnlyResponses, redactStructure } from "#plate/payload.ts";
import { checkResponses } from "#plate/responses.ts";
import { resultFields, resultValue, resultValues } from "#plate/results/values.ts";
import type { ResultField, ResultSingle } from "#plate/results/values.ts";
import { belonging, fitting, splitResponses } from "#plate/score.ts";
import type { RecordMismatch } from "#plate/score.ts";
import { itemConfiguration, sessionControls } from "#plate/session/control.ts";
import type { SessionControl } from "#plate/session/control.ts";
import { elapsedSeconds } from "#plate/session/elapsed.ts";
import type { SessionItem, TestSession } from "#plate/session/session.ts";
import type { Accepted, AcceptedTest } from "#plate/validate/verdict.ts";
import type { AnsweredStatus, SessionStatus } from "#plate/vocabulary.ts";

/**
 * The namespace of every element a result holds.
 */
const resultNamespace = "http://www.imsglobal.org/xsd/imsqti_result_v3p0";

/**
 * Who the result is about and which sessions it reports: the host's `sourcedId` for the
 * candidate, and one session identifier per entry of `sessions`, each the URI of the system that
 * issued it (`sourceId`) and the identifier it issued.
 *
 * The Results XSD types `sourcedId` and each `identifier` as an NCName, so a bare UUID, which
 * starts with a digit more often than not, does not fit; `s-` followed by a UUID does.
 *
 * Each `sourceId` must be an absolute URI, one `URL.canParse` reads without a base. That is
 * stricter than the XSD, whose `xs:anyURI` admits a relative reference
 * (`imsqti_resultv3p0_v1p0.xsd:603`): Results Reporting describes `sourceID` as a unique
 * identifier of the system that added the session identifier (`rr-bind.txt:3548`), and a relative
 * reference does not name a system on its own. It must also hold only characters XML can carry,
 * which `URL.canParse` does not check: it reads past a leading control character, and an
 * attribute that holds one is not well-formed.
 */
export interface ResultContext {
  readonly sessions?: readonly { readonly identifier: string; readonly sourceId: string }[];
  readonly sourcedId?: string;
}

/**
 * What {@link results} reports: an item delivered alone, with the record its last `score`
 * returned and when that happened, or a test session with the test and the items it was started
 * with, keyed by item ref identifier as `startTest` took them.
 */
export type ResultsInput =
  | {
      readonly context: ResultContext;
      readonly datestamp: Date;
      readonly document: Accepted;
      readonly kind: "item";
      readonly record: StoredRecord;
    }
  | {
      readonly context: ResultContext;
      readonly items: ReadonlyMap<string, Accepted>;
      readonly kind: "test";
      readonly session: StoredTestSession;
      readonly test: AcceptedTest;
    };

/**
 * The input a result context check names: the context's `sourcedId`, a session entry's
 * `identifier` or `sourceId`, or an item result's `datestamp`.
 */
export type ContextField = "datestamp" | "identifier" | "sourceId" | "sourcedId";

/**
 * What each {@link ContextField} must be, and what to pass instead.
 */
const contextRemedies: Readonly<Record<ContextField, string>> = {
  datestamp: "is not a valid date. Pass the Date of the item session's last change",
  identifier:
    'is not an NCName, which the Results XSD requires. Pass an identifier that starts with a letter or "_" and holds only letters, digits, "-", "_" and ".", such as "s-" followed by a UUID',
  sourceId:
    'is not an absolute URI made of characters XML can carry. Pass the URI of the system that issued the session identifier, such as "http://localhost:5190/", with no control character, U+FFFE, U+FFFF or lone surrogate',
  sourcedId:
    'is not an NCName, which the Results XSD requires. Pass an identifier that starts with a letter or "_" and holds only letters, digits, "-", "_" and ".", or leave sourcedId out',
};

/**
 * A result input the Results XSD cannot hold: a `sourcedId` or a session `identifier` that is not
 * an NCName, a session `sourceId` that is not an absolute URI made of characters XML can carry, or
 * an item result's `datestamp` that is not a valid date.
 *
 * `session` is the index of the session entry at fault, none for `sourcedId` and `datestamp`;
 * `value` is what was passed.
 */
export class InvalidResultContext extends Data.TaggedError("InvalidResultContext")<{
  readonly field: ContextField;
  readonly session: Option.Option<number>;
  readonly value: string;
}> {
  /**
   * The input, its value, and what to pass instead.
   */
  override get message(): string {
    const where = Option.match(this.session, {
      onNone: () => `The result's ${this.field}`,
      onSome: (index) => `The result context's session ${String(index)} ${this.field}`,
    });

    return `${where} ${JSON.stringify(this.value)} ${contextRemedies[this.field]}.`;
  }
}

/**
 * A test result whose items lack the item a session item's ref names, so it cannot be reported.
 *
 * `ref` is the item ref's identifier and `document` the document its record names.
 */
export class ResultItemMissing extends Data.TaggedError("ResultItemMissing")<{
  readonly document: string;
  readonly ref: string;
}> {
  /**
   * The item ref, the document, and what to pass instead.
   */
  override get message(): string {
    return `The items passed have no entry for the session's item ref ${JSON.stringify(this.ref)}, whose record names ${JSON.stringify(this.document)}. Pass, under the key ${JSON.stringify(this.ref)}, the item open accepted from that document, as startTest took it.`;
  }
}

/**
 * The configuration an answered status is judged under: every limit of both tiers applies, so a
 * response an item's interaction refuses on any count reads as responded and invalid. Only its
 * session-control fields reach {@link itemConfiguration}, which replaces all seven, so it also
 * gives an item's effective attempt limit. A plain literal, so no Schema decode runs.
 */
const judging: Configuration = {
  allowComment: false,
  allowReview: true,
  allowSkipping: true,
  assetBase: "",
  headingLevel: 2,
  locale: "en",
  maxAttempts: 1,
  outputBudget: defaultOutputBudget,
  showFeedback: false,
  showSolution: false,
  validateResponses: true,
};

/**
 * What a result says about one item: where it sits, how its session stands, and the values to
 * report.
 */
interface ItemReport {
  /**
   * The values reported for its responses, by identifier.
   */
  readonly answers: ItemRecord["responses"];
  readonly datestamp: string;
  /**
   * The defaults the item's template processing set, by identifier: its record's, and none for an
   * item never presented in a test, whose record no attempt started.
   */
  readonly defaults: ItemRecord["defaults"];
  /**
   * Its built-in `duration` in seconds, none when it is not known.
   */
  readonly duration: Option.Option<number>;
  readonly identifier: string;
  readonly item: Accepted;
  /**
   * The values reported for its outcomes, by identifier.
   */
  readonly outcomes: ItemRecord["outcomes"];
  readonly presented: boolean;
  /**
   * The attempts processed: its record's `numAttempts`.
   */
  readonly processed: number;
  /**
   * The records reported for its record responses, by identifier.
   */
  readonly records: ItemRecord["records"];
  /**
   * The order each shuffled Choice and Inline Choice was presented in, by response identifier.
   */
  readonly sequences: ReadonlyMap<string, string>;
  readonly sequenceIndex: Option.Option<number>;
  readonly session: Attempts;
  /**
   * The template values of the item's record, by identifier: the ones its first attempt produced,
   * and none for an item never presented in a test, whose record no attempt started.
   */
  readonly templates: ItemRecord["templates"];
}

/**
 * An item session's built-in attempt count and status.
 */
interface Attempts {
  /**
   * The attempts started: the built-in `numAttempts`.
   */
  readonly started: number;
  readonly status: SessionStatus;
}

/**
 * Construct an attribute in no namespace.
 *
 * @param local Its name.
 * @param value Its value.
 * @returns The attribute.
 */
const attribute = (local: string, value: string): Attribute => ({
  local,
  namespace: "",
  prefix: "",
  qname: local,
  references: [],
  value,
});

/**
 * Construct an unprefixed element in the Results namespace.
 *
 * @param local Its local name.
 * @param attributes Its attributes, in order.
 * @param children Its children, in order.
 * @returns The element.
 */
const element = (
  local: string,
  attributes: readonly Attribute[],
  children: readonly Child[] = [],
): Element => ({
  attributes,
  children,
  kind: "element",
  local,
  namespace: resultNamespace,
  prefix: "",
  qname: local,
});

/**
 * Construct one `value` element.
 *
 * @param lexical The value's lexical form.
 * @returns The element.
 */
const valueElement = (lexical: string): Element =>
  element("value", [], [{ cdata: false, kind: "text", value: lexical }]);

/**
 * Construct the `value` element of one field of a record: its text the field's lexical form, with
 * the `fieldIdentifier` and `baseType` the Results XSD gives a value of a variable of cardinality
 * record, which declares no base type of its own.
 *
 * @param field The field as written.
 * @returns The element.
 */
const fieldElement = (field: ResultField): Element =>
  element(
    "value",
    [attribute("fieldIdentifier", field.identifier), attribute("baseType", field.baseType)],
    [{ cdata: false, kind: "text", value: field.lexical }],
  );

/**
 * Give an optional attribute, none when it has no value.
 *
 * @param local Its name.
 * @param value Its value, if any.
 * @returns The attribute in a list, or an empty list.
 */
const optional = (local: string, value: Option.Option<string>): readonly Attribute[] =>
  Option.match(value, { onNone: () => [], onSome: (text) => [attribute(local, text)] });

/**
 * The attributes that name a variable and its type.
 *
 * @param identifier The variable's identifier.
 * @param cardinality Its cardinality.
 * @param baseType Its base type.
 * @returns The `identifier`, `cardinality` and `baseType` attributes.
 */
const declared = (
  identifier: string,
  cardinality: Value["cardinality"],
  baseType: ModelledBaseType,
): readonly Attribute[] => [
  attribute("identifier", identifier),
  attribute("cardinality", cardinality),
  attribute("baseType", baseType),
];

/**
 * Write a built-in single response variable.
 *
 * @param identifier The built-in's identifier.
 * @param single Its value.
 * @returns The `responseVariable`.
 */
const builtInResponse = (identifier: string, single: ResultSingle): Element =>
  element("responseVariable", declared(identifier, "single", single.baseType), [
    element("candidateResponse", [], [valueElement(resultValue(single))]),
  ]);

/**
 * Give the own entry for an identifier in values keyed by identifier.
 *
 * @param values The values, by identifier.
 * @param identifier The identifier.
 * @returns Its value, none when `values` has no own entry for it.
 */
const own = <V>(values: Readonly<Record<string, V>>, identifier: string): Option.Option<V> =>
  Object.hasOwn(values, identifier) ? Option.fromUndefinedOr(values[identifier]) : Option.none();

/**
 * Write a double in the form a float value takes.
 *
 * @param value The double.
 * @returns Its lexical form.
 */
const doubleText = (value: number): string => resultValue({ baseType: "float", value });

/**
 * The reporting attributes an outcome declaration carries, as its `outcomeVariable` writes them:
 * `view` its views joined by spaces, `interpretation` and `longInterpretation` as the model holds
 * them, and the three doubles in the form a float value takes. One the declaration lacks is not
 * written.
 *
 * @param outcome The outcome's declaration.
 * @returns The attributes, in the Results XSD's order.
 */
const reportingAttributes = (outcome: OutcomeReporting): readonly Attribute[] => [
  ...optional("view", outcome.view.pipe(Option.map((views) => views.join(" ")))),
  ...optional("interpretation", outcome.interpretation),
  ...optional("longInterpretation", outcome.longInterpretation),
  ...optional("normalMaximum", outcome.normalMaximum.pipe(Option.map(doubleText))),
  ...optional("normalMinimum", outcome.normalMinimum.pipe(Option.map(doubleText))),
  ...optional("masteryValue", outcome.masteryValue.pipe(Option.map(doubleText))),
];

/**
 * Write the outcome variables of some declarations.
 *
 * Each is written with its declaration's identifier, cardinality and base type, then each of the
 * six reporting attributes the declaration carries.
 *
 * @param declarations The outcome declarations, in document order.
 * @param values The values to report, by identifier; an outcome they lack is at its starting
 *   value.
 * @returns One `outcomeVariable` per declaration, in order.
 */
const outcomeVariables = (
  declarations: ReadonlyMap<string, OutcomeDeclaration>,
  values: ItemRecord["outcomes"],
): readonly Element[] =>
  Array.from(declarations.values(), (outcome) =>
    element(
      "outcomeVariable",
      [
        ...declared(outcome.identifier, outcome.cardinality, outcome.baseType),
        ...reportingAttributes(outcome),
      ],
      resultValues(
        Option.getOrElse(own(values, outcome.identifier), () => startingValue(outcome)),
      ).map(valueElement),
    ),
  );

/**
 * Write the template variables of some declarations.
 *
 * Each is written with its declaration's identifier, cardinality and base type, and the value the
 * record holds for it. One the record holds no value of is written with no `value`, which the
 * Results XSD admits (`ContextTemplateVariableDType` holds zero or more): nobody computed it, as
 * for an item never presented in a test, or one whose template processing the engine does not
 * run, and no value is filled in from its declaration.
 *
 * @param declarations The template declarations, in document order.
 * @param values The template values the record holds, by identifier.
 * @returns One `templateVariable` per declaration, in order.
 */
const templateVariables = (
  declarations: ReadonlyMap<string, TemplateDeclaration>,
  values: ItemRecord["templates"],
): readonly Element[] =>
  Array.from(declarations.values(), (template) =>
    element(
      "templateVariable",
      declared(template.identifier, template.cardinality, template.baseType),
      Option.match(own(values, template.identifier), {
        onNone: () => [],
        onSome: (value) => resultValues(value).map(valueElement),
      }),
    ),
  );

/**
 * Derive an item session's built-in attempt count and status, with nothing stored for either.
 *
 * The count is `attemptsStarted`'s in `#plate/engine/scope.ts`, the one a test's outcome
 * processing reads through the test scope, so the report and the processing cannot disagree: an
 * attempt starts at the item's first presentation, and again at once after each submission that
 * leaves the item open, so a presented item has started one more attempt than it has processed,
 * unless its last submission reached its effective limit and closed it. Results Reporting 2.7.7:
 * `initial` exactly when none has started, `final` when the item closed at a submission, and
 * `pendingSubmission` while a started attempt is unprocessed.
 *
 * @param presented Whether the candidate was shown the item.
 * @param processed The record's count of processed attempts.
 * @param limit The effective attempt limit, 0 for none.
 * @returns The attempts started and the session status.
 */
const attemptsOf = (presented: boolean, processed: number, limit: number): Attempts => {
  const started = attemptsStarted(presented, processed, limit);
  if (!presented) {
    return { started, status: "initial" };
  }

  return { started, status: limit > 0 && processed >= limit ? "final" : "pendingSubmission" };
};

/**
 * Give a response's answered status by Results Reporting 2.7.1's criteria.
 *
 * A response at its default is skipped, as `allow-skipping` reads it ("all responses submitted
 * with their default value or NULL", `info.txt:68904`), so its default is the one the attempt
 * starts it with (D4-11): the one the item's template processing set, else its declared one. A
 * record response's is its declared one, since template processing never sets a record.
 *
 * @param responseDefault The response's default, if any: the one template processing set, else
 *   its declared one.
 * @param value The value reported, a record for a record response.
 * @param presented Whether the candidate was shown the item.
 * @param invalid Whether the item's interaction refuses the value, on any limit of either tier.
 * @returns `notpresented` for an item never shown; `presented` for NULL (a record with no field
 *   among them) or the response's default ({@link atDefault}), which is skipping it; `attempted`
 *   for a value the interaction refuses; else `answered`.
 */
const answeredStatusOf = (
  responseDefault: Option.Option<ResponseValue>,
  value: ResponseValue,
  presented: boolean,
  invalid: boolean,
): AnsweredStatus => {
  if (!presented) {
    return "notpresented";
  }

  if (
    isNullResponse(value) ||
    Option.exists(responseDefault, (fallback) => atDefault(value, fallback))
  ) {
    return "presented";
  }

  return invalid ? "attempted" : "answered";
};

/**
 * Give the value an item result reports for the built-in `completionStatus`.
 *
 * Once an attempt is processed, where the item holds the built-in ({@link holdsCompletionStatus})
 * and the reported outcomes hold it as a single identifier, it is that identifier: `unknown`, which
 * the first attempt starts it at and later ones keep, or the one processing set. Otherwise it is
 * derived: `not_attempted` until an attempt starts and `unknown` after. So a presented item whose
 * attempt is not processed reports `unknown`, though its record still holds `not_attempted`, and a
 * record written before the item held the built-in reads as derived.
 *
 * @param report What the result says about the item.
 * @returns The single identifier to report.
 */
const completionOf = (report: ItemReport): Value => {
  const derived = completionValue(report.session.started === 0 ? "not_attempted" : "unknown");
  if (report.processed === 0 || !holdsCompletionStatus(report.item.item)) {
    return derived;
  }

  return own(report.outcomes, completionStatus).pipe(
    Option.filter((value) => value.baseType === "identifier" && value.cardinality === "single"),
    Option.getOrElse(() => derived),
  );
};

/**
 * Write an item result.
 *
 * The built-ins come first: `numAttempts`, `duration` when it is known and `completionStatus`
 * ({@link completionOf}). Then one response variable per declared response with its answered
 * status, then one per record response the item holds (`Item.records`), one template variable per
 * declared template variable ({@link templateVariables}), and one outcome variable per declared
 * outcome, in the order the Results XSD lists the three. A record response's variable has
 * cardinality `record` and no base type, and its candidate response one `value` per field of the
 * record reported, in the record's order, each with its `fieldIdentifier` and `baseType`: none for
 * a NULL record, which a record response the values reported lack holds. An answered status judges
 * only the interactions the page showed under the record's template values, as `checkResponses`
 * does, a record response's typed text among them, and reads a response's default as the record's
 * template processing set it, else as declared ({@link answeredStatusOf}).
 *
 * @param report What the result says about the item.
 * @returns The `itemResult`.
 */
const itemResult = (report: ItemReport): Element => {
  const { item } = report.item;
  const invalid = new Set(
    checkResponses(report.item, { ...report.answers, ...report.records }, judging, {
      templates: report.templates,
    }).map((message) => message.response),
  );
  const responses = Array.from(item.responses.values(), (declaration) => {
    const value = Option.getOrElse(own(report.answers, declaration.identifier), () =>
      nullOf(declaration.baseType, declaration.cardinality),
    );
    const answered = answeredStatusOf(
      Option.orElse(own(report.defaults, declaration.identifier), () => declaration.defaultValue),
      value,
      report.presented,
      invalid.has(declaration.identifier),
    );

    return element(
      "responseVariable",
      [
        ...declared(declaration.identifier, declaration.cardinality, declaration.baseType),
        ...optional(
          "choiceSequence",
          Option.fromUndefinedOr(report.sequences.get(declaration.identifier)),
        ),
        attribute("answeredStatus", answered),
      ],
      [element("candidateResponse", [], resultValues(value).map(valueElement))],
    );
  });
  const records = Array.from(item.records?.values() ?? [], (declaration) => {
    const value = Option.getOrElse(own(report.records, declaration.identifier), () => nullRecord);
    const answered = answeredStatusOf(
      declaration.defaultValue,
      value,
      report.presented,
      invalid.has(declaration.identifier),
    );

    return element(
      "responseVariable",
      [
        attribute("identifier", declaration.identifier),
        attribute("cardinality", "record"),
        attribute("answeredStatus", answered),
      ],
      [element("candidateResponse", [], resultFields(value).map(fieldElement))],
    );
  });

  return element(
    "itemResult",
    [
      attribute("identifier", report.identifier),
      ...optional("sequenceIndex", report.sequenceIndex.pipe(Option.map(String))),
      attribute("datestamp", report.datestamp),
      attribute("sessionStatus", report.session.status),
    ],
    [
      builtInResponse("numAttempts", {
        baseType: "integer",
        value: BigInt(report.session.started),
      }),
      ...Option.match(report.duration, {
        onNone: () => [],
        onSome: (seconds) => [builtInResponse("duration", { baseType: "float", value: seconds })],
      }),
      element(
        "outcomeVariable",
        declared(completionStatus, "single", "identifier"),
        resultValues(completionOf(report)).map(valueElement),
      ),
      ...responses,
      ...records,
      ...templateVariables(item.templates, report.templates),
      ...outcomeVariables(item.outcomes, report.outcomes),
    ],
  );
};

/**
 * Check the result context and write its element.
 *
 * @param context The host's context.
 * @returns The `context` element, or {@link InvalidResultContext} for the first input that does not
 *   fit.
 */
const contextElement = (context: ResultContext): Result.Result<Element, InvalidResultContext> =>
  Result.gen(function* checkContext() {
    const sourcedId = Option.fromUndefinedOr(context.sourcedId);
    if (Option.isSome(sourcedId) && !isNcName(sourcedId.value)) {
      return yield* Result.fail(
        new InvalidResultContext({
          field: "sourcedId",
          session: Option.none(),
          value: sourcedId.value,
        }),
      );
    }

    const sessions = context.sessions ?? [];
    for (const [index, entry] of sessions.entries()) {
      if (!isNcName(entry.identifier)) {
        return yield* Result.fail(
          new InvalidResultContext({
            field: "identifier",
            session: Option.some(index),
            value: entry.identifier,
          }),
        );
      }

      if (!URL.canParse(entry.sourceId) || !isXmlText(entry.sourceId)) {
        return yield* Result.fail(
          new InvalidResultContext({
            field: "sourceId",
            session: Option.some(index),
            value: entry.sourceId,
          }),
        );
      }
    }

    return element(
      "context",
      optional("sourcedId", sourcedId),
      sessions.map((entry) =>
        element("sessionIdentifier", [
          attribute("sourceID", entry.sourceId),
          attribute("identifier", entry.identifier),
        ]),
      ),
    );
  });

/**
 * Write the whole document.
 *
 * @param children The context, then the test result if any, then the item results.
 * @returns The document's text.
 */
const documentOf = (children: readonly Element[]): string =>
  writeDocument(
    element(
      "assessmentResult",
      [
        {
          local: "xmlns",
          namespace: xmlnsNamespace,
          prefix: "",
          qname: "xmlns",
          references: [],
          value: resultNamespace,
        },
      ],
      children,
    ),
  );

/**
 * Write the result of an item delivered alone.
 *
 * The host holds the item's presentation and its attempt limit, so the result reads the record
 * alone: each processed attempt is one started and finished, a record with none is an item not yet
 * presented, its outcomes, template values and defaults are the record's, and its duration is not
 * known. No `choiceSequence` is written, since the record's instance need not be the one the item
 * was rendered with.
 *
 * @param input The item, its record, when it last changed and the context.
 * @returns The document's text, or the failure of its context, its datestamp or its record: a
 *   record of another item, or one that does not fit the item's declarations (`fitting`).
 */
const itemResults = (
  input: Extract<ResultsInput, { readonly kind: "item" }>,
): Result.Result<string, InvalidRecord | InvalidResultContext | RecordMismatch> =>
  Result.gen(function* writeItem() {
    const context = yield* contextElement(input.context);
    if (Number.isNaN(input.datestamp.getTime())) {
      return yield* Result.fail(
        new InvalidResultContext({
          field: "datestamp",
          session: Option.none(),
          value: String(input.datestamp),
        }),
      );
    }

    const record = yield* fitting(
      input.document.item,
      yield* belonging(input.document.item, yield* decodeRecord(input.record)),
    );
    const presented = record.numAttempts > 0;

    return documentOf([
      context,
      itemResult({
        answers: record.responses,
        datestamp: input.datestamp.toISOString(),
        defaults: record.defaults,
        duration: Option.none(),
        identifier: input.document.item.identifier,
        item: input.document,
        outcomes: record.outcomes,
        presented,
        processed: record.numAttempts,
        records: record.records,
        sequenceIndex: Option.none(),
        sequences: new Map(),
        session: attemptsOf(presented, record.numAttempts, 1),
        templates: record.templates,
      }),
    ]);
  });

/**
 * The form of a time a session stores, as `Date.prototype.toISOString` writes it, and the
 * offsets `xs:dateTime` also admits.
 */
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Check that a session's times are times, since a result writes them as `xs:dateTime` and
 * measures the test's duration between two of them.
 *
 * @param session The decoded session.
 * @returns The session, or {@link InvalidSession} naming the first field that is not an ISO 8601
 *   time.
 */
const timed = (session: TestSession): Result.Result<TestSession, InvalidSession> => {
  const fields: readonly (readonly [string, string])[] = [
    ["started", session.started],
    ["updated", session.updated],
    ...session.items.map(
      (item, index) => [`items[${String(index)}].datestamp`, item.datestamp] as const,
    ),
  ];
  const wrong = Arr.findFirst(
    fields,
    ([, text]) => !isoTime.test(text) || Number.isNaN(Date.parse(text)),
  );

  return Option.match(wrong, {
    onNone: () => Result.succeed(session),
    onSome: ([field, text]) =>
      Result.fail(
        new InvalidSession({
          issue: `its ${field} is ${JSON.stringify(text)}, not an ISO 8601 time such as "2026-11-05T10:00:00.000Z"`,
          stage: "decode",
          version: Option.some(storedVersion),
        }),
      ),
  });
};

/**
 * Give the order a shuffled Choice or a shuffled Inline Choice was presented in, as `render`
 * presents it ({@link choiceOrder}), and none for any other interaction: a Choice or an Inline
 * Choice not shuffled keeps document order, and a Text Entry or an Extended Text has no choices.
 *
 * @param interaction The interaction as the page showed it, holding only the choices shown.
 * @param seed The seed its shuffle was keyed by, none when it had none.
 * @param instance The item instance it was rendered under.
 * @returns The choice identifiers, space-separated, or none.
 */
const choiceSequence = (
  interaction: Interaction,
  seed: Option.Option<string>,
  instance: string,
): Option.Option<string> => {
  switch (interaction.kind) {
    case "choice":
    case "inline-choice": {
      return interaction.shuffle
        ? Option.some(choiceOrder(interaction, seed, instance).join(" "))
        : Option.none();
    }
    case "extended-text":
    case "text-entry": {
      return Option.none();
    }
    default: {
      return interaction satisfies never;
    }
  }
};

/**
 * Give the order each shuffled Choice and each shuffled Inline Choice the page showed was presented
 * in, as `render` presents it.
 *
 * The interactions are the item's as `redactItem` shows it under the record's template values, the
 * redaction the page is built from, as `checkResponses` finds them, read through `redactStructure`,
 * which decides the same and prints no text. So a choice its template hides, or withholds because
 * the record holds no value of its template variable, is not listed, and the choices shown are
 * listed in the order `choiceOrder` gives them, which shuffles only those. An interaction a hidden
 * or withheld template block, inline or choice holds reports no order.
 *
 * @param item The item.
 * @param templates The template values of the record the page was shown under.
 * @param seed The session's shuffle seed, which keyed the page's shuffles as `itemView`'s
 *   configuration does: none when it has none, so the order followed the instance alone. Never the
 *   session's processing seed.
 * @param instance The item instance it was rendered under.
 * @returns The choice identifiers, space-separated, by the interaction's response identifier.
 */
const choiceSequences = (
  item: Item,
  templates: ItemRecord["templates"],
  seed: Option.Option<string>,
  instance: string,
): ReadonlyMap<string, string> =>
  new Map(
    interactionsIn(redactStructure(item, { outcomes: {}, templates }).body).flatMap((interaction) =>
      Option.match(choiceSequence(interaction, seed, instance), {
        onNone: () => [],
        onSome: (sequence) => [[interaction.response, sequence] as const],
      }),
    ),
  );

/**
 * Find the item a session item delivers, and check that its record is that item's and that its
 * record and its saved responses fit it.
 *
 * The values reported for a response are the saved ones over the record's, so both must be
 * values the item declares, as `fitting` checks a record: a response the item scores, of its
 * declaration's base type and cardinality, and a record under a record response's identifier and
 * nowhere else. The saved map is split as the record holds it (`splitResponses`), its records
 * under `records`, so a saved record under its declaration fits.
 *
 * @param items The items the session was started with, by item ref identifier.
 * @param entry The session item.
 * @returns The item; {@link ResultItemMissing} when `items` has none for its ref;
 *   {@link RecordMismatch} when its record names another item or document; or
 *   {@link InvalidSession} naming the session item when its record, then its saved responses, do
 *   not fit the item's declarations (`fitting`).
 */
const deliveredItem = (
  items: ReadonlyMap<string, Accepted>,
  entry: SessionItem,
): Result.Result<Accepted, InvalidSession | RecordMismatch | ResultItemMissing> =>
  Result.gen(function* deliverItem() {
    const document = yield* Result.fromOption(
      Option.fromUndefinedOr(items.get(entry.ref)),
      () => new ResultItemMissing({ document: entry.record.document, ref: entry.ref }),
    );
    yield* belonging(document.item, entry.record);

    const place = `its item ${String(entry.sequenceIndex)}, of the item ref ${JSON.stringify(entry.ref)}`;
    const record = yield* Result.mapError(
      fitting(document.item, entry.record),
      ({ issue }) =>
        new InvalidSession({
          issue: `the record of ${place} does not fit the item: ${issue}`,
          stage: "decode",
          version: Option.some(storedVersion),
        }),
    );
    if (Option.isSome(entry.saved)) {
      yield* Result.mapError(
        fitting(document.item, { ...record, ...splitResponses(entry.saved.value) }),
        ({ issue }) =>
          new InvalidSession({
            issue: `the responses saved on ${place} do not fit the item: ${issue}`,
            stage: "decode",
            version: Option.some(storedVersion),
          }),
      );
    }

    return document;
  });

/**
 * Give the values a test result reports for some responses of a session item: each the value saved
 * and not yet processed, else the record's, but the record's for a response bound only by content
 * the page does not see, as `score` keeps it. A response neither holds is left out.
 *
 * @param identifiers The responses' identifiers.
 * @param hidden The responses bound only by content the page does not see under the record.
 * @param saved The values saved and not yet processed, by identifier.
 * @param recorded The record's values, by identifier.
 * @returns The values to report, by identifier.
 */
const reportedOf = <V>(
  identifiers: Iterable<string>,
  hidden: ReadonlySet<string>,
  saved: Readonly<Record<string, V>>,
  recorded: Readonly<Record<string, V>>,
): Readonly<Record<string, V>> =>
  Object.fromEntries(
    [...identifiers].flatMap((identifier) =>
      Option.toArray(
        Option.map(
          Option.orElse(hidden.has(identifier) ? Option.none() : own(saved, identifier), () =>
            own(recorded, identifier),
          ),
          (value) => [identifier, value] as const,
        ),
      ),
    ),
  );

/**
 * Report one item of a test session.
 *
 * The values reported are the responses saved and not yet processed, else the record's, a record
 * response's among them ({@link reportedOf}); a response bound only by content the page does not
 * see under the record ({@link hiddenOnlyResponses}) reports the record's value and never the saved
 * one, as `score` keeps it, so its answered status is judged on that value. Its outcomes are the
 * first processed attempt's when its effective limit is 0, since a delivery engine that does not
 * limit attempts reports only the first outcomes of a non-adaptive item, and the record's
 * otherwise: the last processed, or the starting values before any. A presented shuffled Choice or
 * Inline Choice carries the order it was presented in, under the session's shuffle seed (none when
 * it has none) and the item's instance `<session instance>.<sequenceIndex>`, listing only the
 * choices the record's template values showed. Its template values, and the defaults its answered
 * status reads, are its record's.
 *
 * @param test The test.
 * @param controls The session control of each of the test's item refs, by identifier, as
 *   `sessionControls` resolves them once for the whole result.
 * @param items The items the session was started with.
 * @param session The session.
 * @param entry The session item.
 * @returns The report, or the failure of its ref in the test, then of its item.
 */
const sessionItemReport = (
  test: AcceptedTest,
  controls: ReadonlyMap<string, SessionControl>,
  items: ReadonlyMap<string, Accepted>,
  session: TestSession,
  entry: SessionItem,
): Result.Result<ItemReport, InvalidSession | RecordMismatch | ResultItemMissing> =>
  Result.gen(function* reportItem() {
    const control = yield* Result.fromOption(
      Option.fromUndefinedOr(controls.get(entry.ref)),
      () =>
        new InvalidSession({
          issue: `its item ${String(entry.sequenceIndex)} names the item ref ${JSON.stringify(entry.ref)}, which the test ${JSON.stringify(test.test.identifier)} does not hold`,
          stage: "decode",
          version: Option.some(storedVersion),
        }),
    );
    const document = yield* deliveredItem(items, entry);
    const limit = itemConfiguration(judging, control).maxAttempts;
    const saved = splitResponses(Option.getOrElse(entry.saved, () => ({})));
    const hidden = hiddenOnlyResponses(document.item, entry.record);

    return {
      answers: reportedOf(
        document.item.responses.keys(),
        hidden,
        saved.responses,
        entry.record.responses,
      ),
      datestamp: entry.datestamp,
      defaults: entry.record.defaults,
      duration: Option.some(entry.duration),
      identifier: entry.ref,
      item: document,
      outcomes:
        limit === 0
          ? Option.getOrElse(entry.firstOutcomes, () => entry.record.outcomes)
          : entry.record.outcomes,
      presented: entry.presented,
      processed: entry.record.numAttempts,
      records: reportedOf(
        document.item.records?.keys() ?? [],
        hidden,
        saved.records,
        entry.record.records,
      ),
      sequenceIndex: Option.some(entry.sequenceIndex),
      sequences: entry.presented
        ? choiceSequences(
            document.item,
            entry.record.templates,
            session.shuffleSeed,
            `${session.instance}.${String(entry.sequenceIndex)}`,
          )
        : new Map(),
      session: attemptsOf(entry.presented, entry.record.numAttempts, limit),
      templates: entry.record.templates,
    };
  });

/**
 * Write a test's own outcome variables by the state of its outcome processing: each at its
 * starting value when the test has none (`absent`); each as the session holds it when the engine
 * runs it (`runs`), which is as the last run left it, or at its starting value before the first;
 * and none when the engine cannot run it (`marked`), so no default reads as a score. Nothing here
 * runs the processing: the session's transitions do.
 *
 * @param test The test.
 * @param session The session, whose outcomes `decodeSession` checked against the test's
 *   declarations.
 * @returns The `outcomeVariable` elements, one per declared outcome in declaration order, or none.
 */
const testOutcomes = (test: AcceptedTest["test"], session: TestSession): readonly Element[] => {
  switch (test.outcomeProcessing.kind) {
    case "absent": {
      return outcomeVariables(test.outcomes, {});
    }
    case "marked": {
      return [];
    }
    case "runs": {
      return outcomeVariables(test.outcomes, session.outcomes);
    }
    default: {
      return test.outcomeProcessing satisfies never;
    }
  }
};

/**
 * Write the result of a test session.
 *
 * The test result holds the built-in `duration`, from the session's start to its last change in
 * seconds, of base type duration (reading 29). The test's own outcomes follow ({@link
 * testOutcomes}): as the last run of its outcome processing left them when the engine runs it, at
 * their starting values when it has none, and not at all when the engine cannot run it, so no
 * default reads as a score. Then one item result per session item, in sequence order. Every item
 * ref's session control is resolved in one walk of the test (`sessionControls`), since resolving
 * each item's alone walks the test up to its ref again, which grows with the square of the item
 * count.
 *
 * @param input The test, its items, the stored session and the context.
 * @returns The document's text, or the failure of its context, its session or an item.
 */
const testResults = (
  input: Extract<ResultsInput, { readonly kind: "test" }>,
): Result.Result<
  string,
  InvalidResultContext | InvalidSession | RecordMismatch | ResultItemMissing | SessionMismatch
> =>
  Result.gen(function* writeTest() {
    const context = yield* contextElement(input.context);
    const session = yield* timed(yield* decodeSession(input.session, input.test));
    const controls = sessionControls(input.test.test);
    const reports: Element[] = [];
    for (const entry of session.items) {
      reports.push(
        itemResult(yield* sessionItemReport(input.test, controls, input.items, session, entry)),
      );
    }

    const { test } = input.test;
    const outcomes = testOutcomes(test, session);

    return documentOf([
      context,
      element(
        "testResult",
        [attribute("identifier", test.identifier), attribute("datestamp", session.updated)],
        [
          builtInResponse("duration", {
            baseType: "duration",
            value: elapsedSeconds(Date.parse(session.started), Date.parse(session.updated)),
          }),
          ...outcomes,
        ],
      ),
      ...reports,
    ]);
  });

/**
 * Write the Results Reporting document for an item or a test session.
 *
 * A test result holds a `testResult` and one `itemResult` per session item, in sequence order; an
 * item result holds the item's `itemResult`. Each item result reports the built-ins
 * `numAttempts`, `duration` (in a test) and `completionStatus`, the session status, every
 * declared response with its answered status (a record response with cardinality `record`, no base
 * type and one `value` per field, each with its `fieldIdentifier` and `baseType`), every declared
 * template variable with the value its record holds (none where it holds none) and every declared
 * outcome, never a correct response. In a test, a presented shuffled Choice's or Inline Choice's
 * response carries the order it was presented in as `choiceSequence`, the choices its template
 * values hid left out.
 *
 * @example
 *   results({ context: { sourcedId: "candidate-1" }, datestamp: new Date(), document, kind: "item", record });
 *   // Result.succeed('<?xml version="1.0" encoding="utf-8"?>\n<assessmentResult …>…</assessmentResult>')
 *
 * @param input The item or the test session to report, and the context.
 * @returns The document's text; {@link InvalidResultContext} for a context or datestamp the
 *   Results XSD cannot hold; {@link InvalidRecord}, {@link InvalidSession} or
 *   {@link SessionMismatch} for a stored record or session this renderer did not write, or one of
 *   another test, a record or a session item's saved responses that do not fit its item's
 *   declarations included;
 *   {@link RecordMismatch} for a record of another item than the one it is reported for; or
 *   {@link ResultItemMissing} when the items lack a session item's item.
 */
export const results = (
  input: ResultsInput,
): Result.Result<
  string,
  | InvalidRecord
  | InvalidResultContext
  | InvalidSession
  | RecordMismatch
  | ResultItemMissing
  | SessionMismatch
> => (input.kind === "item" ? itemResults(input) : testResults(input));
