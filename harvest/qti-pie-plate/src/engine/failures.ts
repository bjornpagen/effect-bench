/**
 * The failures the engine returns, a leaf the evaluator, the reference resolver and the expression
 * families share: the rules name an identifier the item or the variables do not hold, set a
 * variable to a value of another type, map a response that has no mapping, or read a record
 * response as a value.
 *
 * Each is a failure the caller can cause, since the variables come from the record the host hands
 * back, and a test's template defaults from a test checked apart from its items, so the engine
 * returns it in a `Result` and never throws it. `#plate/engine/evaluate.ts` re-exports all four,
 * so the public entry and every other importer reach them there. The module imports only `Data`
 * from `effect`.
 *
 * @module
 */
import { Data } from "effect";

/**
 * The failure of a rule tree that names an identifier the item or the variables do not hold in the
 * role the rule reads it in: a variable or a mapped response with no value, a `qti-correct`, a
 * `qti-map-response` or a `qti-map-response-point` of no declared response, a `qti-default` of
 * no declared or built-in variable, a `qti-set-outcome-value` of no declared outcome, or, in
 * template processing, a `qti-set-template-value`, `qti-set-correct-response` or
 * `qti-set-default-value` of no declared variable of the kind it sets, or a test's
 * `qti-template-default` of no template variable its item declares. A test's outcome processing and
 * its template defaults read the test's outcomes and its items' variables as the stored test
 * session holds them, so a name they read that it holds no value of is the record's gap too.
 *
 * In a valid item every identifier a rule names is declared, but the variables come from the record
 * the host hands back, which may lack a value, so the engine returns it. A test and its items each
 * pass `check` apart, so a template default may name a variable its item does not declare. Its
 * `holder` says which of the two lacks the identifier, and the message names the one to fix.
 */
export class UnknownIdentifierError extends Data.TaggedError("UnknownIdentifierError")<{
  /**
   * What lacks the identifier: `"record"` when the variables, which come from the session record
   * or the stored test session, hold no value of it, and `"item"` when the item declares no
   * modelled variable of the kind the rule or the test's template default reads or sets by that
   * name.
   */
  readonly holder: "item" | "record";

  /**
   * The identifier the rule names.
   */
  readonly identifier: string;

  /**
   * What the rule reads the identifier as.
   */
  readonly role: "outcome" | "response" | "variable";
}> {
  /**
   * The identifier, the role it is read in, what lacks it, and what to pass instead, in one line.
   */
  override get message(): string {
    const identifier = JSON.stringify(this.identifier);

    return this.holder === "record"
      ? `The session record holds no value for ${identifier}, which the rules read as a ${this.role}: pass back, unchanged, the record begin or score returned for this item, or, for a test's outcome processing or template default, the stored test session startTest or advance returned.`
      : `The rules read ${identifier} as a ${this.role}, and the item holds no ${this.role} by that name: run rules built from this item, with the variables its record holds; for a test's qti-template-default, name a template variable the item declares, or open the test and its items together as a package, which checks the two against each other.`;
  }
}

/**
 * The failure of a rule that sets a variable to a value, not NULL, of a base type or cardinality
 * that differs from the variable's declaration: a `qti-set-outcome-value`, which the evaluator
 * returns, or, in template processing, a `qti-set-template-value`, `qti-set-correct-response` or
 * `qti-set-default-value`, which the template interpreter returns; or a test's
 * `qti-template-default` whose value does not fit the template variable it sets, which the
 * template interpreter's check of the defaults returns. A test and its items each pass `check`
 * apart, so a template default may give a value of another type.
 *
 * QTI assigns without conversion: "floating point values can not be assigned to integer variables
 * and vice-versa", and the expression's type must match the target's. A NULL is never checked: it
 * is the absence of a value, so it has no type to differ from the variable's, and the variable
 * takes its own NULL, of its declared base type and cardinality. The engine stores no value of
 * another type, so the record always holds each variable at its declared type. The failure does
 * not say which rule set the value, so its message names the five.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_SetValue
 */
export class OutcomeMismatchError extends Data.TaggedError("OutcomeMismatchError")<{
  /**
   * The base type and cardinality the expression gave.
   */
  readonly actual: string;

  /**
   * The base type and cardinality the variable is declared with.
   */
  readonly expected: string;

  /**
   * The identifier of the variable the rule or the template default sets.
   */
  readonly identifier: string;
}> {
  /**
   * The variable, both types, and the expression to give the rule that sets it, in one line.
   */
  override get message(): string {
    return `The rules set ${JSON.stringify(this.identifier)}, declared ${this.expected}, to a ${this.actual} value: give the rule that sets it (a qti-set-outcome-value, in template processing a qti-set-template-value, qti-set-correct-response or qti-set-default-value, or a test's qti-template-default) an expression of base type and cardinality ${this.expected}.`;
  }
}

/**
 * The failure of a `qti-map-response` whose response is declared without a `qti-mapping`, or of a
 * `qti-map-response-point` whose response is declared without a `qti-area-mapping`.
 *
 * QTI maps a response "using the associated mapping, which must have been declared", and a point
 * response through its "associated areaMapping"; the evaluator returns it.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponse
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMapResponsePoint
 */
export class UnmappedResponseError extends Data.TaggedError("UnmappedResponseError")<{
  /**
   * The response's identifier.
   */
  readonly identifier: string;

  /**
   * The mapping the expression reads and the declaration lacks: `qti-mapping` for
   * `qti-map-response`, `qti-area-mapping` for `qti-map-response-point`.
   */
  readonly mapping: "qti-area-mapping" | "qti-mapping";
}> {
  /**
   * The response, the mapping it lacks and the two ways to score it, in one line.
   */
  override get message(): string {
    const expression =
      this.mapping === "qti-mapping" ? "qti-map-response" : "qti-map-response-point";

    return `The rules map the response ${JSON.stringify(this.identifier)}, and its declaration has no ${this.mapping}: give the declaration a ${this.mapping}, or score it without ${expression}.`;
  }
}

/**
 * The failure of a value read that finds a record response: a `qti-variable`, or an attribute that
 * names a variable, whose name the variables hold a record of (`Variables.records`), anywhere but
 * as the operand of the three kinds that read a record whole, `qti-field-value`, `qti-is-null` and
 * `qti-match`.
 *
 * An evaluator takes and gives a value of a base type and a single, multiple or ordered
 * cardinality, which a record is not. On a checked item no path reaches it: every other kind's rule
 * refuses an operand of cardinality `record`, as the qti package's do (P23), and so does every rule
 * that sets a variable to an expression of another type (P20). Where documents are checked apart, a
 * read the checks never judged together may find a record, and this is that read's typed failure,
 * which the engine returns and never throws.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpFieldValue
 */
export class RecordOperandError extends Data.TaggedError("RecordOperandError")<{
  /**
   * The identifier of the record response the rules read as a value.
   */
  readonly identifier: string;
}> {
  /**
   * The variable, why it cannot be read as a value, and the three kinds that read it, in one line.
   */
  override get message(): string {
    return `The rules read the record response ${JSON.stringify(this.identifier)} as a value, and a record has no value of one base type: read one of its fields with qti-field-value, or read it whole with qti-is-null or qti-match.`;
  }
}

/**
 * A failure the engine returns: the rules name an identifier the item or the variables do not hold,
 * set a variable to a value of another type, map a response that has no mapping, or read a record
 * response as a value.
 */
export type EngineFailure =
  | OutcomeMismatchError
  | RecordOperandError
  | UnknownIdentifierError
  | UnmappedResponseError;
