/**
 * The expressions of response processing as the item model holds them: the names of the expression
 * kinds, the variants, the types of the attributes that may name a variable, with the one
 * classifier of each, the rules that hold expressions, and the shape of a kind's rule
 * ({@link KindRule}) with the helpers the families build their rules from. The rules themselves
 * live in the families under `#plate/model/expressions/`.
 *
 * It imports from `effect` and `#plate/vocabulary.ts` with `import type` only and value-imports
 * only `#plate/model/values.ts`, so an engine module, which is a browser module, may value-import
 * its names.
 *
 * @module
 */
import type { Option } from "effect";
import { isNcName, parseLexical, trimXmlSpace } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-inside` and names an area's geometry, not a structure.
import type { AreaShape, BaseType, Cardinality } from "#plate/vocabulary.ts";

/**
 * The expression kinds: the local name of each element QTI 3.0's XSD admits as a child of
 * `qti-set-outcome-value`, without its `qti-` prefix, in sorted order.
 *
 * An expression's `kind` is one of them, so the reader, the kind rules and the engine's family
 * tables key every kind by the same name.
 */
export const expressionKinds = [
  "and",
  "any-n",
  "base-value",
  "container-size",
  "contains",
  "correct",
  "custom-operator",
  "default",
  "delete",
  "divide",
  "duration-gte",
  "duration-lt",
  "equal",
  "equal-rounded",
  "field-value",
  "gcd",
  "gt",
  "gte",
  "index",
  "inside",
  "integer-divide",
  "integer-modulus",
  "integer-to-float",
  "is-null",
  "lcm",
  "lt",
  "lte",
  "map-response",
  "map-response-point",
  "match",
  "math-constant",
  "math-operator",
  "max",
  "member",
  "min",
  "multiple",
  "not",
  "null",
  "number-correct",
  "number-incorrect",
  "number-presented",
  "number-responded",
  "number-selected",
  "or",
  "ordered",
  "outcome-maximum",
  "outcome-minimum",
  "pattern-match",
  "power",
  "product",
  "random",
  "random-float",
  "random-integer",
  "repeat",
  "round",
  "round-to",
  "stats-operator",
  "string-match",
  "substring",
  "subtract",
  "sum",
  "test-variables",
  "truncate",
  "variable",
] as const;

/**
 * An expression kind, one of {@link expressionKinds}.
 */
export type ExpressionKind = (typeof expressionKinds)[number];

/**
 * The value of an operator's attribute that holds either a literal or a reference to a variable
 * whose value stands in for it when the operator is evaluated, as the information model's
 * `integerOrVariableRef`, `floatOrVariableRef` and `stringOrVariableRef` admit: a `literal` with
 * its typed value, or a `ref` with the variable's identifier.
 *
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#IT_Use
 */
export type LiteralOrRef<A> =
  | { readonly _tag: "literal"; readonly value: A }
  | { readonly _tag: "ref"; readonly identifier: string };

/**
 * An integer attribute that may name a variable, such as `qti-round-to`'s `figures`: an exact
 * integer at any size (reading 45), or a reference.
 */
export type IntegerOrRef = LiteralOrRef<bigint>;

/**
 * A float attribute that may name a variable, such as `qti-random-float`'s `max` or one token of
 * `qti-equal`'s `tolerance`: an `xs:double`, which may be an infinity or NaN, or a reference.
 */
export type FloatOrRef = LiteralOrRef<number>;

/**
 * A string attribute that may name a variable, `qti-pattern-match`'s `pattern`: the text as
 * written, or a reference written as `{name}`.
 */
export type StringOrRef = LiteralOrRef<string>;

/**
 * An `xs:int` attribute that may name a variable, such as `qti-index`'s `n`: an exact integer,
 * whose range the XSD's `xs:int` member holds, or a reference.
 */
export type IntOrIdentifier = LiteralOrRef<bigint>;

/**
 * Construct the reference to a variable.
 *
 * @param identifier The variable's identifier.
 * @returns The reference.
 */
const reference = (identifier: string): LiteralOrRef<never> => ({ _tag: "ref", identifier });

/**
 * Classify a value of a union of an XSD integer type and a variable's name by the union's order:
 * the integer first, so only text outside the integer's lexical space names a variable.
 *
 * The integer member collapses whitespace and an integer holds no inner whitespace, so its outer
 * XML whitespace goes before it is read. A name holds no whitespace, so the same trim leaves a
 * valid name as written. A value outside both members never reaches a classifier on a checked
 * item; it is a reference to the trimmed text.
 *
 * @param written The attribute's value as written.
 * @returns The exact integer, or the reference.
 */
const integerOrName = (written: string): LiteralOrRef<bigint> => {
  const lexical = trimXmlSpace(written);
  const parsed = parseLexical("integer", lexical);

  return parsed._tag === "Success" && parsed.success.baseType === "integer"
    ? { _tag: "literal", value: parsed.success.value }
    : reference(lexical);
};

/**
 * Classify an integer attribute's value, such as `qti-round-to`'s `figures`, as the XSD's union of
 * `xs:integer` and an NCName reads it: an `xs:integer` is a literal, exact at any size, and
 * anything else is a reference. So `INF` and `NaN`, which are no integer, name variables (ruling
 * R4). The reader and the validator both classify through it, so they never split a value
 * differently.
 *
 * The range of an attribute such as `figures` (reading 46), and its least value (P10), are the
 * structure check's, not this function's.
 *
 * @param written The attribute's value as written.
 * @returns The literal or the reference it holds.
 */
export const integerOrRefOf = (written: string): IntegerOrRef => integerOrName(written);

/**
 * Classify a float attribute's value, such as `qti-random-float`'s `max` or one token of
 * `qti-equal`'s `tolerance`, as the XSD's union of `xs:double` and a variable's name reads it: the
 * double first, so `INF`, `-INF` and `NaN` are literals, and anything else is a reference. A
 * literal beyond the largest finite double names that double, of its sign, by reading 56 ("an
 * `xs:double` literal beyond the largest finite double names the largest finite double of its
 * sign"), as `parseLexical` reads a float. The reader and the validator both classify through it.
 *
 * The double member collapses whitespace and a name holds none, so the outer XML whitespace goes
 * first. A value outside both members never reaches a classifier on a checked item; it is a
 * reference to the trimmed text.
 *
 * @param written The attribute's value, or one token of a list, as written.
 * @returns The literal or the reference it holds.
 */
export const floatOrRefOf = (written: string): FloatOrRef => {
  const lexical = trimXmlSpace(written);
  const parsed = parseLexical("float", lexical);

  return parsed._tag === "Success" && parsed.success.baseType === "float"
    ? { _tag: "literal", value: parsed.success.value }
    : reference(lexical);
};

/**
 * Classify an `xs:int` attribute's value, such as `qti-index`'s `n`, as the XSD's union of `xs:int`
 * and `xs:NCName` reads it: an integer is a literal and anything else is a reference. The two
 * members do not overlap, and the `xs:int` member holds the literal's range, so the literal is not
 * range-checked here. The reader and the validator both classify through it.
 *
 * @param written The attribute's value as written.
 * @returns The literal or the reference it holds.
 */
export const intOrIdentifierOf = (written: string): IntOrIdentifier => integerOrName(written);

/**
 * Classify a string attribute's value, `qti-pattern-match`'s `pattern`, as literal text or a
 * reference.
 *
 * Only a value that is exactly `{name}`, whose name is an NCName that names a variable the item
 * holds, is a reference. Any other value is literal text as written, its whitespace and braces
 * kept (reading 7), a braced name that names no variable included: the information model treats a
 * string attribute that "appears to be a reference to a template or outcome variable but there is
 * no variable with the given name" as a string value (ruling R1). So the split is made at read
 * time, against the declared names, and the engine never meets a name that names nothing.
 *
 * @param written The attribute's value as written.
 * @param declared The names of the variables the item holds: every declaration's identifier and
 *   the built-in variables.
 * @returns The literal or the reference it holds.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#IT_Use
 */
export const stringOrRefOf = (written: string, declared: ReadonlySet<string>): StringOrRef => {
  const name = written.startsWith("{") && written.endsWith("}") ? written.slice(1, -1) : "";

  return isNcName(name) && declared.has(name)
    ? reference(name)
    : { _tag: "literal", value: written };
};

/**
 * The values of a `qti-equal`'s `tolerance-mode`, whose XSD type restricts `xs:string`, so a value
 * is compared as written. The default is `exact`.
 */
export const toleranceModes = ["absolute", "exact", "relative"] as const;

/**
 * The values of `rounding-mode`, which `qti-round-to` requires and `qti-equal-rounded` defaults to
 * `significantFigures`.
 */
export const roundingModes = ["decimalPlaces", "significantFigures"] as const;

/**
 * The functions `qti-math-operator`'s `name` names, in the XSD's order.
 */
export const mathOperatorNames = [
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "asin",
  "acos",
  "atan",
  "atan2",
  "asec",
  "acsc",
  "acot",
  "sinh",
  "cosh",
  "tanh",
  "sech",
  "csch",
  "coth",
  "log",
  "ln",
  "exp",
  "abs",
  "signum",
  "floor",
  "ceil",
  "toDegrees",
  "toRadians",
] as const;

/**
 * The constants `qti-math-constant`'s `name` names, in the XSD's order.
 */
export const mathConstantNames = ["pi", "e"] as const;

/**
 * The statistics `qti-stats-operator`'s `name` names, in the XSD's order.
 */
export const statsOperatorNames = [
  "mean",
  "sampleVariance",
  "sampleSD",
  "popVariance",
  "popSD",
] as const;

/**
 * The filters a test-level count or aggregate takes over the items of a test: the section whose
 * items it reads and the categories it includes and excludes. Each is optional with no default.
 * An XSD list may be empty, so an empty list of categories is written, not absent.
 */
interface TestFilters {
  readonly excludeCategory: Option.Option<readonly string[]>;
  readonly includeCategory: Option.Option<readonly string[]>;
  readonly sectionIdentifier: Option.Option<string>;
}

/**
 * An expression of processing, tagged by `kind`: one variant for each of the 64
 * {@link expressionKinds}, whatever the engine runs of it.
 *
 * Every variant holds its sub-expressions in `operands`, a tuple of the kind's operand count, so a
 * walk recurses over `operands` without knowing the kind, and an evaluator that takes them apart
 * meets no missing operand. A variant holds each attribute of its element: a required one as
 * written, an optional one with a default holding the default when absent, as `equal`'s tolerance
 * mode (`exact`), tolerance (none) and bounds (both included) do, and one with no default as an
 * `Option`, as `variable`'s `weightIdentifier` is, which an item reads and never evaluates. An
 * attribute that may name a variable holds a literal or a reference ({@link IntegerOrRef},
 * {@link FloatOrRef}, {@link StringOrRef}, {@link IntOrIdentifier}).
 */
export type Expression =
  | { readonly kind: "match"; readonly operands: readonly [Expression, Expression] }
  | {
      readonly includeLowerBound: boolean;
      readonly includeUpperBound: boolean;
      readonly kind: "equal";
      readonly operands: readonly [Expression, Expression];
      readonly tolerance: readonly FloatOrRef[];
      readonly toleranceMode: (typeof toleranceModes)[number];
    }
  | {
      readonly identifier: string;
      readonly kind: "variable";
      readonly operands: readonly [];
      readonly weightIdentifier: Option.Option<string>;
    }
  | { readonly identifier: string; readonly kind: "correct"; readonly operands: readonly [] }
  | { readonly kind: "base-value"; readonly operands: readonly []; readonly value: Value }
  | { readonly kind: "is-null"; readonly operands: readonly [Expression] }
  | { readonly identifier: string; readonly kind: "map-response"; readonly operands: readonly [] }
  | {
      readonly identifier: string;
      readonly kind: "map-response-point";
      readonly operands: readonly [];
    }
  // logic
  | { readonly kind: "and"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "or"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "not"; readonly operands: readonly [Expression] }
  | {
      readonly kind: "any-n";
      readonly max: IntegerOrRef;
      readonly min: IntegerOrRef;
      readonly operands: readonly [Expression, ...Expression[]];
    }
  // comparison
  | { readonly kind: "gt"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "gte"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "lt"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "lte"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "duration-lt"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "duration-gte"; readonly operands: readonly [Expression, Expression] }
  // arithmetic
  | { readonly kind: "sum"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "product"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "subtract"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "divide"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "min"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "max"; readonly operands: readonly [Expression, ...Expression[]] }
  // integers
  | { readonly kind: "integer-divide"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "integer-modulus"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "integer-to-float"; readonly operands: readonly [Expression] }
  | { readonly kind: "gcd"; readonly operands: readonly [Expression, ...Expression[]] }
  | { readonly kind: "lcm"; readonly operands: readonly [Expression, ...Expression[]] }
  // rounding
  | { readonly kind: "round"; readonly operands: readonly [Expression] }
  | { readonly kind: "truncate"; readonly operands: readonly [Expression] }
  | {
      readonly figures: IntegerOrRef;
      readonly kind: "round-to";
      readonly operands: readonly [Expression];
      readonly roundingMode: (typeof roundingModes)[number];
    }
  | {
      readonly figures: IntegerOrRef;
      readonly kind: "equal-rounded";
      readonly operands: readonly [Expression, Expression];
      readonly roundingMode: (typeof roundingModes)[number];
    }
  // functions
  | {
      readonly kind: "math-operator";
      readonly name: (typeof mathOperatorNames)[number];
      readonly operands: readonly [Expression, ...Expression[]];
    }
  | {
      readonly kind: "math-constant";
      readonly name: (typeof mathConstantNames)[number];
      readonly operands: readonly [];
    }
  | {
      readonly kind: "stats-operator";
      readonly name: (typeof statsOperatorNames)[number];
      readonly operands: readonly [Expression];
    }
  | { readonly kind: "power"; readonly operands: readonly [Expression, Expression] }
  // containers
  | { readonly kind: "container-size"; readonly operands: readonly [Expression] }
  | { readonly kind: "random"; readonly operands: readonly [Expression] }
  | { readonly kind: "multiple"; readonly operands: readonly Expression[] }
  | { readonly kind: "ordered"; readonly operands: readonly Expression[] }
  | { readonly kind: "member"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "delete"; readonly operands: readonly [Expression, Expression] }
  | { readonly kind: "contains"; readonly operands: readonly [Expression, Expression] }
  | {
      readonly kind: "repeat";
      readonly numberRepeats: IntOrIdentifier;
      readonly operands: readonly [Expression, ...Expression[]];
    }
  | {
      readonly kind: "index";
      readonly n: IntOrIdentifier;
      readonly operands: readonly [Expression];
    }
  | {
      /**
       * The field of the record operand it reads: a name within the record, never a variable.
       */
      readonly fieldIdentifier: string;
      readonly kind: "field-value";
      readonly operands: readonly [Expression];
    }
  // text
  | {
      readonly caseSensitive: boolean;
      readonly kind: "string-match";
      readonly operands: readonly [Expression, Expression];
      readonly substring: boolean;
    }
  | {
      readonly caseSensitive: boolean;
      readonly kind: "substring";
      readonly operands: readonly [Expression, Expression];
    }
  | {
      readonly kind: "pattern-match";
      readonly operands: readonly [Expression];
      readonly pattern: StringOrRef;
    }
  | {
      /**
       * The area's `coords`, in written order. The reader builds no `inside` with a coordinate
       * written with `%`, a percentage of a size the item does not give: it marks the element
       * `area-coords-percent` instead.
       */
      readonly coords: readonly number[];
      readonly kind: "inside";
      readonly operands: readonly [Expression];
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shape` is the QTI attribute of `qti-inside` and names an area's geometry, not a structure.
      readonly shape: AreaShape;
    }
  | {
      /**
       * The `class`, an NCName naming the implementation. Foreign attributes and elements of the
       * operator are not held.
       */
      readonly class: Option.Option<string>;
      /**
       * The `definition`, a URI naming the operator's definition.
       */
      readonly definition: Option.Option<string>;
      readonly kind: "custom-operator";
      readonly operands: readonly Expression[];
    }
  // references
  | { readonly identifier: string; readonly kind: "default"; readonly operands: readonly [] }
  | { readonly kind: "null"; readonly operands: readonly [] }
  | {
      readonly kind: "random-integer";
      readonly max: IntegerOrRef;
      /**
       * The least value; the literal 0 when absent.
       */
      readonly min: IntegerOrRef;
      readonly operands: readonly [];
      /**
       * The step between values; the literal 1 when absent.
       */
      readonly step: IntegerOrRef;
    }
  | {
      readonly kind: "random-float";
      readonly max: FloatOrRef;
      /**
       * The least value; the literal 0 when absent. The kind has no `step`.
       */
      readonly min: FloatOrRef;
      readonly operands: readonly [];
    }
  // test
  | ({ readonly kind: "number-correct"; readonly operands: readonly [] } & TestFilters)
  | ({ readonly kind: "number-incorrect"; readonly operands: readonly [] } & TestFilters)
  | ({ readonly kind: "number-presented"; readonly operands: readonly [] } & TestFilters)
  | ({ readonly kind: "number-responded"; readonly operands: readonly [] } & TestFilters)
  | ({ readonly kind: "number-selected"; readonly operands: readonly [] } & TestFilters)
  | ({
      readonly kind: "outcome-minimum";
      readonly operands: readonly [];
      readonly outcomeIdentifier: string;
      readonly weightIdentifier: Option.Option<string>;
    } & TestFilters)
  | ({
      readonly kind: "outcome-maximum";
      readonly operands: readonly [];
      readonly outcomeIdentifier: string;
      readonly weightIdentifier: Option.Option<string>;
    } & TestFilters)
  | ({
      /**
       * The `base-type` of the variables it collects; all eleven are written, and none when
       * absent.
       */
      readonly baseType: Option.Option<BaseType>;
      readonly kind: "test-variables";
      readonly operands: readonly [];
      readonly variableIdentifier: string;
      readonly weightIdentifier: Option.Option<string>;
    } & TestFilters);

/**
 * One `qti-response-if` or `qti-response-else-if`: its condition and the rules it runs.
 */
export interface Branch {
  readonly then: readonly Rule[];
  readonly when: Expression;
}

/**
 * A response rule: a `qti-response-condition` with its branches in order and its
 * `qti-response-else`, a `qti-set-outcome-value`, a `qti-lookup-outcome-value`, or a
 * `qti-exit-response`.
 *
 * A `qti-response-processing-fragment` has no rule of its own: the reader puts its rules in its
 * place, so a fragment runs as if its rules were written where it stands.
 */
export type Rule =
  | {
      readonly branches: readonly Branch[];
      readonly kind: "condition";
      readonly otherwise: Option.Option<readonly Rule[]>;
    }
  | { readonly expression: Expression; readonly identifier: string; readonly kind: "set-outcome" }
  | {
      /**
       * The expression whose value the target outcome's lookup table maps.
       */
      readonly expression: Expression;
      /**
       * The outcome whose table maps the value and which takes the result.
       */
      readonly identifier: string;
      readonly kind: "lookup-outcome";
    }
  | {
      /**
       * Ends response processing; what the rules before it set stays.
       */
      readonly kind: "exit";
    };

/**
 * One `qti-template-if` or `qti-template-else-if`: its condition and the template rules it runs.
 */
export interface TemplateBranch {
  readonly then: readonly TemplateRule[];
  readonly when: Expression;
}

/**
 * A template rule, a child of `qti-template-processing` or of a template condition's part, which
 * QTI 3.0's XSD admits in the same six forms at either depth:
 *
 * - `set-template-value`, a `qti-set-template-value`: sets the template variable `identifier` to the
 *   expression's value.
 * - `set-correct-response`, a `qti-set-correct-response`: sets the correct response of the response
 *   variable `identifier` to the expression's value.
 * - `set-default-value`, a `qti-set-default-value`: sets the default value of the response or outcome
 *   variable `identifier` to the expression's value.
 * - `template-condition`, a `qti-template-condition`: its `qti-template-if` and each
 *   `qti-template-else-if` in order as `branches`, and its `qti-template-else`, when it has one, as
 *   `otherwise`. The first branch whose condition is true runs; a false or NULL condition passes to
 *   the next part, and `otherwise` runs when no condition is true.
 * - `template-constraint`, a `qti-template-constraint`: when its expression is not true (NULL
 *   included), the template variables return to their defaults and template processing starts
 *   again, up to a finite number of times.
 * - `exit-template`, a `qti-exit-template`: ends template processing; what the rules before it set
 *   stays.
 *
 * It is its own union, never a {@link Rule}: response processing holds none of these forms.
 */
export type TemplateRule =
  | {
      readonly expression: Expression;
      readonly identifier: string;
      readonly kind: "set-correct-response" | "set-default-value" | "set-template-value";
    }
  | {
      readonly branches: readonly TemplateBranch[];
      readonly kind: "template-condition";
      readonly otherwise: Option.Option<readonly TemplateRule[]>;
    }
  | { readonly expression: Expression; readonly kind: "template-constraint" }
  | { readonly kind: "exit-template" };

/**
 * The type of an expression as the kind rules give it: a base type and a cardinality.
 *
 * `any` is the base type of a value that takes any type, `qti-null`'s NULL; `unknown` is one no
 * rule can say, such as a `qti-custom-operator`'s. A record has no base type of its own, so it is
 * `{ baseType: "unknown", cardinality: "record" }`. A base type of `any` or `unknown`, and a
 * cardinality of `unknown`, satisfy every operand rule, as the qti package's checker reads them
 * (`silentBases` in `packages/pantry/src/qti/expressions.ts`).
 */
export interface ExpressionType {
  readonly baseType: BaseType | "any" | "unknown";
  readonly cardinality: Cardinality | "unknown";
}

/**
 * The attributes of an expression that its result type depends on, as the qti package normalizes
 * them (the relation `ExpressionAttribute` in `packages/pantry/src/qti/expressions.ts`). The caller
 * fills them in from the expression or the declaration it names, and a rule reads an absent one as
 * unknown:
 *
 * - `baseType` and `cardinality`: the type of the declaration the kind's declaration facet names, or
 *   `qti-base-value`'s or `qti-test-variables`' `base-type`.
 * - `name`: the operator name of `qti-math-operator` or `qti-stats-operator`.
 * - `weighted`: true when the expression carries a `weight-identifier`, as a `qti-variable` or a
 *   `qti-test-variables` of a test's outcome processing may. A weighted `qti-test-variables` with
 *   no `base-type` is a float (G-R3 199). A weighted `qti-variable` is typed by its caller, which
 *   alone knows whether the name is a prefixed read of an item variable (G-R3 198).
 * - `collected`: the base type an unweighted `qti-test-variables` with no `base-type` takes from the
 *   test's items (G-R3 199): `integer` when every single integer or float declaration of the
 *   variable it names, in every item of the test, is integer, else `float`. Only a caller that
 *   holds the test's items can fill it in; a test checked alone leaves it absent, so the kind is
 *   unknown there.
 */
export interface ResultAttributes {
  readonly baseType?: ExpressionType["baseType"];
  readonly cardinality?: ExpressionType["cardinality"];
  readonly collected?: ExpressionType["baseType"];
  readonly name?: string;
  readonly weighted?: boolean;
}

/**
 * One operand a kind does not accept, as its rule's `operandsAccept` gives it: its position and
 * what the kind accepts there, so a refusal can say both.
 */
export interface OperandMismatch {
  /**
   * The base types the kind accepts at the operand, in the rule's order, or `any` when it accepts
   * every base type and judges the cardinality alone.
   */
  readonly baseTypes: readonly BaseType[] | "any";
  /**
   * The cardinalities the kind accepts at the operand, in the rule's order.
   */
  readonly cardinalities: readonly Cardinality[];
  /**
   * The operand's position among the expression's operands, counted from 1.
   */
  readonly position: number;
}

/**
 * One attribute of a kind that may name a variable, an entry of the kind rule's reference facet.
 */
export interface ReferenceEntry {
  /**
   * The attribute's name in the document, such as `number-repeats`.
   */
  readonly attribute: string;
  /**
   * The base type a variable the attribute names must have: `string` for `pattern`, `float` for
   * `qti-random-float`'s `min` and `max`, `integer` for every other one, as the qti package's
   * `referencedBaseType` gives it.
   */
  readonly baseType: "float" | "integer" | "string";
  /**
   * Whether a reference there is checked. One that is not, `qti-equal`'s `tolerance`, is never
   * refused and gives NULL when it names no variable the attempt holds.
   */
  readonly checked: boolean;
  /**
   * The attribute's field in the kind's variant, such as `numberRepeats`.
   */
  readonly field: string;
  /**
   * Whether the attribute is a list of values, each a literal or a reference, as `tolerance` is.
   */
  readonly list: boolean;
}

/**
 * A kind rule's declaration facet: the kind's `identifier` names a declaration whose type it takes
 * or reads, and the kind of variable it expects there.
 *
 * `qti-variable` and `qti-default` expect any variable; `qti-correct`, `qti-map-response` and
 * `qti-map-response-point` a response.
 */
export interface DeclarationFacet {
  readonly attribute: "identifier";
  readonly expected: "response" | "variable";
}

/**
 * The typing of one expression kind, the data the model, the validator and the engine read
 * generically in place of a case per kind:
 *
 * - `resultType`: the type the kind gives from its operands' types and its {@link ResultAttributes}.
 * - `operandsAccept`: every operand the kind does not accept, each with its position and what the
 *   kind accepts there, as the qti package's operand rules (P23) judge them; a rule that relates
 *   its operands computes what it accepts from the others, the first operand setting the base
 *   type.
 * - `references`: the reference facet, one entry per attribute that may name a variable.
 * - `declaration`: the declaration facet, absent for a kind whose `identifier` names no declaration.
 */
export interface KindRule {
  readonly declaration?: DeclarationFacet;
  readonly operandsAccept: (operands: readonly ExpressionType[]) => readonly OperandMismatch[];
  readonly references: readonly ReferenceEntry[];
  readonly resultType: (
    operands: readonly ExpressionType[],
    attributes: ResultAttributes,
  ) => ExpressionType;
}

/**
 * A family's kind rules: one entry per kind of the family.
 */
export type FamilyRules<K extends ExpressionKind> = { readonly [P in K]: KindRule };

/**
 * Construct the `single` type of a base type.
 *
 * @param baseType The base type.
 * @returns The type.
 */
export const singleOf = (baseType: ExpressionType["baseType"]): ExpressionType => ({
  baseType,
  cardinality: "single",
});

/**
 * Report whether a type is one a kind accepts at an operand: a base type of the list, or any when
 * the list is `any`, and a cardinality of the list. A base type of `any` or `unknown`, and a
 * cardinality of `unknown`, say nothing yet, so they are accepted.
 *
 * @param type The operand's type.
 * @param baseTypes The base types accepted, or `any`.
 * @param cardinalities The cardinalities accepted.
 * @returns Whether the type is accepted.
 */
export const accepts = (
  type: ExpressionType,
  baseTypes: readonly BaseType[] | "any",
  cardinalities: readonly Cardinality[],
): boolean =>
  (baseTypes === "any" ||
    type.baseType === "any" ||
    type.baseType === "unknown" ||
    baseTypes.includes(type.baseType)) &&
  (type.cardinality === "unknown" || cardinalities.includes(type.cardinality));

/**
 * Construct the operand rule of a kind whose every operand is judged alone, by the same base types
 * and cardinalities.
 *
 * @param baseTypes The base types accepted at every operand, in the rule's order, or `any`.
 * @param cardinalities The cardinalities accepted at every operand, in the rule's order.
 * @returns The rule, which gives each operand of another type.
 */
export const everyOperand =
  (
    baseTypes: readonly BaseType[] | "any",
    cardinalities: readonly Cardinality[],
  ): KindRule["operandsAccept"] =>
  (operands) =>
    operands.flatMap((operand, index) =>
      accepts(operand, baseTypes, cardinalities)
        ? []
        : [{ baseTypes, cardinalities, position: index + 1 }],
    );

/**
 * The operand rule of a kind that judges none of its operands.
 *
 * @returns No mismatch.
 */
export const acceptsAnyOperands: KindRule["operandsAccept"] = () => [];
