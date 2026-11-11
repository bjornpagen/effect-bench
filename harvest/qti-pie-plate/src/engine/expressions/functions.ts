/**
 * The functions family of the engine: the evaluators of `qti-math-operator`, `qti-math-constant`,
 * `qti-stats-operator` and `qti-power`.
 *
 * Every function ECMA-262 leaves implementation-approximated is plate's own, from
 * `#plate/engine/math.ts` (OD-P7-6): `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`,
 * `cosh`, `tanh`, `exp`, `log`, `log10` and `pow`, each with IEEE results (NaN, ±INF, ±0). This
 * module names no approximated `Math` member and never `**` on a number, so a result is the same
 * in every engine. Everything else it computes by operations ECMA-262 defines exactly: `+`, `-`,
 * `*`, `/`, `Number` of a power of two, and of `Math` only `abs`, `floor`, `ceil`, `sign`, `sqrt`,
 * `PI` and `E`.
 *
 * Over those IEEE results it applies QTI's rules: a NaN, the result of an argument outside a
 * function's natural domain, is NULL; an infinity is a value of `qti-math-operator` and
 * `qti-stats-operator`, as the operator names' table gives it, and NULL from `qti-power`, whose
 * float value set holds no infinity.
 *
 * It value-imports only engine leaves, `#plate/model/values.ts` and `effect`'s `Option` and
 * `Result`, and reads the evaluator's types from `#plate/engine/evaluate.ts` as types, so the
 * dispatcher's table may import it without a cycle.
 *
 * @module
 */
import { Option, Result } from "effect";
import type { Evaluate, Evaluator, FamilyTable, Scope } from "#plate/engine/evaluate.ts";
import type { EngineFailure } from "#plate/engine/failures.ts";
import {
  acos,
  asin,
  atan,
  atan2,
  cos,
  cosh,
  exp,
  log,
  log10,
  pow,
  sin,
  sinh,
  tan,
  tanh,
} from "#plate/engine/math.ts";
import {
  floatNull,
  floatOf,
  floatValue,
  integerNull,
  integerValue,
  numberOf,
} from "#plate/engine/numbers.ts";
import type { NumberSingle } from "#plate/engine/numbers.ts";
import { operandValues } from "#plate/engine/operands.ts";
import type { Expression } from "#plate/model/expression.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * A `qti-math-operator`'s name.
 */
type MathOperatorName = Extract<Expression, { readonly kind: "math-operator" }>["name"];

/**
 * A `qti-stats-operator`'s name.
 */
type StatsOperatorName = Extract<Expression, { readonly kind: "stats-operator" }>["name"];

/**
 * Give the single float of a computed float, or the float NULL when it is NaN, the result of an
 * argument outside a function's natural domain. An infinity is kept.
 *
 * @param value The computed float.
 * @returns The value.
 */
const floatOrNull = (value: number): Value => (Number.isNaN(value) ? floatNull : floatValue(value));

/**
 * Give the reciprocal of a trigonometric or hyperbolic function's value, as the information model
 * rules it: NULL, written NaN here, for a value of 0 or -0 and for a NaN, the value of a NaN
 * argument; 0 of the quotient's sign for a value of ±INF; else `1 / value`.
 *
 * @param value The function's value.
 * @returns The reciprocal, NaN for NULL.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMathOp
 */
const reciprocal = (value: number): number => (value === 0 ? Number.NaN : 1 / value);

/**
 * Give the exact integer a float's floor or ceiling is, none for ±INF and NaN, which no integer
 * holds (9.10).
 *
 * @param value The float's floor or ceiling, by `Math.floor` or `Math.ceil`.
 * @returns The integer, or none.
 */
const integralOf = (value: number): Option.Option<bigint> =>
  Number.isFinite(value) ? Option.some(BigInt(value)) : Option.none();

/**
 * The degrees in a radian, `180 / π` with `Math.PI`'s double, computed once so that `toDegrees` is
 * one product, as Java's `Math.toDegrees` is.
 */
const degreesPerRadian = 180 / Math.PI;

/**
 * The radians in a degree, `π / 180` with `Math.PI`'s double, computed once so that `toRadians` is
 * one product, as Java's `Math.toRadians` is.
 */
const radiansPerDegree = Math.PI / 180;

/**
 * How a `qti-math-operator` name computes its value: a float function of one argument, a float
 * function of two (`atan2`), or an integer function of one number (`signum`, `floor`, `ceil`),
 * which takes an integer operand as it is. A float function gives NaN for NULL.
 */
type Operation =
  | { readonly _tag: "float"; readonly apply: (x: number) => number }
  | { readonly _tag: "pair"; readonly apply: (y: number, x: number) => number }
  | {
      readonly _tag: "integer";
      readonly apply: (single: NumberSingle) => Option.Option<bigint>;
    };

/**
 * Construct the operation of a float function of one argument.
 *
 * @param apply The function, NaN for NULL.
 * @returns The operation.
 */
const unary = (apply: (x: number) => number): Operation => ({ _tag: "float", apply });

/**
 * Construct the operation of an integer function of one number.
 *
 * @param ofInteger The function of an integer operand.
 * @param ofFloat The function of a float operand, none when no integer is its value.
 * @returns The operation.
 */
const integral = (
  ofInteger: (value: bigint) => bigint,
  ofFloat: (value: number) => Option.Option<bigint>,
): Operation => ({
  _tag: "integer",
  apply: (single) =>
    single.baseType === "integer" ? Option.some(ofInteger(single.value)) : ofFloat(single.value),
});

/**
 * Give the sign of an integer: -1, 0 or 1.
 *
 * @param value The integer.
 * @returns Its sign.
 */
const signOf = (value: bigint): bigint => {
  if (value === 0n) {
    return 0n;
  }

  return value > 0n ? 1n : -1n;
};

/**
 * Every `qti-math-operator` name's operation, by name (R§6.8; `I#Enumerated_MathOperatorNameEnum`):
 *
 * - `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh` and `exp` are
 *   `#plate/engine/math.ts`'s; `log` is its `log10` (base 10) and `ln` its `log`.
 * - `sec`, `csc`, `cot`, `sech`, `csch` and `coth` are the {@link reciprocal} of `cos`, `sin`, `tan`,
 *   `cosh`, `sinh` and `tanh`; `asec`, `acsc` and `acot` are `acos`, `asin` and `atan` of `1 / x`,
 *   so an argument below 1 in magnitude gives NaN, NULL, for the first two.
 * - `toDegrees` is `x × (180 / π)` and `toRadians` is `x × (π / 180)`, one product by
 *   {@link degreesPerRadian} or {@link radiansPerDegree}, so a result overflows only when the true
 *   result does.
 * - `abs` is `Math.abs`; `signum`, `floor` and `ceil` give an exact integer, the integer an integer
 *   operand holds for `floor` and `ceil`; ±INF and NaN give none for `floor` and `ceil`, NaN none
 *   for `signum`, whose ±INF is ±1 (9.10).
 */
const operations = {
  abs: unary((x) => Math.abs(x)),
  acos: unary(acos),
  acot: unary((x) => atan(1 / x)),
  acsc: unary((x) => asin(1 / x)),
  asec: unary((x) => acos(1 / x)),
  asin: unary(asin),
  atan: unary(atan),
  atan2: { _tag: "pair", apply: atan2 },
  ceil: integral(
    (value) => value,
    (value) => integralOf(Math.ceil(value)),
  ),
  cos: unary(cos),
  cosh: unary(cosh),
  cot: unary((x) => reciprocal(tan(x))),
  coth: unary((x) => reciprocal(tanh(x))),
  csc: unary((x) => reciprocal(sin(x))),
  csch: unary((x) => reciprocal(sinh(x))),
  exp: unary(exp),
  floor: integral(
    (value) => value,
    (value) => integralOf(Math.floor(value)),
  ),
  ln: unary(log),
  log: unary(log10),
  sec: unary((x) => reciprocal(cos(x))),
  sech: unary((x) => reciprocal(cosh(x))),
  signum: integral(signOf, (value) =>
    Number.isNaN(value) ? Option.none() : Option.some(BigInt(Math.sign(value))),
  ),
  sin: unary(sin),
  sinh: unary(sinh),
  tan: unary(tan),
  tanh: unary(tanh),
  toDegrees: unary((x) => x * degreesPerRadian),
  toRadians: unary((x) => x * radiansPerDegree),
} satisfies { readonly [N in MathOperatorName]: Operation };

/**
 * Give the value of an operation over its operands' numbers.
 *
 * @param operation The name's operation.
 * @param numbers The operands' numbers, in order.
 * @returns The value, or the operation's NULL when the operand count is not its arity: two for
 *   `atan2`, one for every other name (9.22).
 */
const operate = (operation: Operation, numbers: readonly NumberSingle[]): Value => {
  switch (operation._tag) {
    case "float": {
      const [x, ...rest] = numbers;

      return x === undefined || rest.length > 0
        ? floatNull
        : floatOrNull(operation.apply(floatOf(x)));
    }
    case "pair": {
      const [y, x, ...rest] = numbers;

      return y === undefined || x === undefined || rest.length > 0
        ? floatNull
        : floatOrNull(operation.apply(floatOf(y), floatOf(x)));
    }
    case "integer": {
      const [x, ...rest] = numbers;
      if (x === undefined || rest.length > 0) {
        return integerNull;
      }

      return Option.match(operation.apply(x), { onNone: () => integerNull, onSome: integerValue });
    }
    default: {
      return operation satisfies never;
    }
  }
};

/**
 * Evaluate every operand, left to right ({@link operandValues}), and give the number each holds;
 * the first failure is the result.
 *
 * @param operands The operands.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The numbers; none when an operand is NULL, or not a single integer or float, which the
 *   validator refuses (P23) on a checked item; or the first operand's failure.
 */
const numbersOf = (
  operands: readonly Expression[],
  scope: Scope,
  evaluate: Evaluate,
): Result.Result<Option.Option<readonly NumberSingle[]>, EngineFailure> =>
  Result.map(operandValues(operands, scope, evaluate), (values) =>
    Option.all(values.map((value) => numberOf(value))),
  );

/**
 * Give the value of a `qti-math-operator`: its name's operation over its operands, a single float,
 * or a single integer for `signum`, `floor` and `ceil` (R§6.8). It is NULL when an operand is
 * NULL, when the operand count is not the name's (9.22), and when the operation's argument falls
 * outside the function's natural domain.
 *
 * @param expression The `qti-math-operator`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The value, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpMathOp
 */
const evaluateMathOperator: Evaluator<"math-operator"> = (expression, scope, evaluate) => {
  const operation = operations[expression.name];

  return Result.map(numbersOf(expression.operands, scope, evaluate), (numbers) =>
    Option.match(numbers, {
      onNone: () => (operation._tag === "integer" ? integerNull : floatNull),
      onSome: (held) => operate(operation, held),
    }),
  );
};

/**
 * Give the value of a `qti-math-constant`: a single float, the double nearest pi or e.
 *
 * @param expression The `qti-math-constant`.
 * @returns The value.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#ExpMathConstant
 */
const evaluateMathConstant: Evaluator<"math-constant"> = (expression) =>
  Result.succeed(floatValue(expression.name === "pi" ? Math.PI : Math.E));

/**
 * Give the floats a container holds: each member, an integer through `toFloat`.
 *
 * @param value The operand's value.
 * @returns The floats, in order; none when the value is NULL, not a container, or holds a member
 *   that is not an integer or a float, which the validator refuses (P23) on a checked item.
 */
const membersOf = (value: Value): Option.Option<readonly number[]> => {
  if (value.cardinality === "single" || value.values.length === 0) {
    return Option.none();
  }

  return Option.all(
    value.values.map((single) =>
      single.baseType === "integer" || single.baseType === "float"
        ? Option.some(floatOf(single))
        : Option.none(),
    ),
  );
};

/**
 * The greatest magnitude a member may have for the statistics to be computed on the members as they
 * are: 2^494. A deviation from the mean of such members is under 2^495, its square under 2^990, and
 * a sum of fewer than 2^32 of either (an array's greatest length) under 2^1022, so no intermediate
 * sum or square overflows.
 */
const unscaledMagnitude = Number(2n ** 494n);

/**
 * The scale the statistics compute larger members at: 2^-530, which brings every finite magnitude,
 * under 2^1024, under {@link unscaledMagnitude}. A power of two, so a scaled member is the member's
 * exact image unless it falls below the normal range, which only a member more than 2^1000 times
 * smaller than the largest does, too small to move a sum.
 */
const largeScale = 1 / Number(2n ** 530n);

/**
 * Give the scale the statistics compute members at: 1, or {@link largeScale} when a member's
 * magnitude exceeds {@link unscaledMagnitude}, so that no intermediate overflows unless the
 * statistic does. A power of two moves no rounding in the normal range, so the scale changes a
 * statistic only where an intermediate overflowed without it.
 *
 * @param members The floats.
 * @returns The scale.
 */
const scaleOf = (members: readonly number[]): number => {
  for (const member of members) {
    if (Math.abs(member) > unscaledMagnitude) {
      return largeScale;
    }
  }

  return 1;
};

/**
 * Give the arithmetic mean of floats: their sum, left to right, over their count.
 *
 * @param members The floats, at least one.
 * @returns The mean.
 */
const meanOf = (members: readonly number[]): number => {
  let sum = 0;
  for (const member of members) {
    sum += member;
  }

  return sum / members.length;
};

/**
 * Give the sum of the squared deviations of floats from their mean, each square a product.
 *
 * @param members The floats, at least one.
 * @returns The sum.
 */
const squaredDeviationsOf = (members: readonly number[]): number => {
  const mean = meanOf(members);
  let sum = 0;
  for (const member of members) {
    const deviation = member - mean;
    sum += deviation * deviation;
  }

  return sum;
};

/**
 * Give a statistic of floats by name: the mean, and the variance and standard deviation of a
 * sample (over n − 1) and of a population (over n), each root by `Math.sqrt` (9.20).
 *
 * It computes on the members times their {@link scaleOf} and divides the scale back out, once for
 * the mean and a standard deviation, twice for a variance, so a statistic is ±INF only when its
 * true value exceeds the largest float: the mean of [1e308, 1e308] is 1e308, and the population
 * standard deviation of [1e200, -1e200] is 1e200 while its variance is INF.
 *
 * @param name The statistic.
 * @param members The floats, at least one.
 * @returns The statistic; NaN for the four spreads of a single float, which need a container size
 *   greater than 1.
 */
const statisticOf = (name: StatsOperatorName, members: readonly number[]): number => {
  const scale = scaleOf(members);
  const scaled = members.map((member) => member * scale);
  if (name === "mean") {
    return meanOf(scaled) / scale;
  }

  if (members.length < 2) {
    return Number.NaN;
  }

  const squares = squaredDeviationsOf(scaled);
  switch (name) {
    case "popSD": {
      return Math.sqrt(squares / members.length) / scale;
    }
    case "popVariance": {
      return squares / members.length / scale / scale;
    }
    case "sampleSD": {
      return Math.sqrt(squares / (members.length - 1)) / scale;
    }
    case "sampleVariance": {
      return squares / (members.length - 1) / scale / scale;
    }
    default: {
      return name satisfies never;
    }
  }
};

/**
 * Give the value of a `qti-stats-operator`: a single float, its name's statistic of its operand's
 * members (9.20). It is NULL when the operand is NULL, for a spread of a container of one, and for
 * a statistic that is NaN, as one over an infinite member may be. An infinite statistic is kept: a
 * mean over an infinite member, or a statistic whose true value exceeds the largest float.
 *
 * @param expression The `qti-stats-operator`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives the operand's value.
 * @returns The value, or the operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpStatsOp
 */
const evaluateStatsOperator: Evaluator<"stats-operator"> = (expression, scope, evaluate) => {
  const [operand] = expression.operands;

  return Result.map(evaluate(operand, scope), (value) =>
    Option.match(membersOf(value), {
      onNone: () => floatNull,
      onSome: (members) => floatOrNull(statisticOf(expression.name, members)),
    }),
  );
};

/**
 * Give the value of a `qti-power`: a single float, its first operand raised to its second by
 * `#plate/engine/math.ts`'s `pow`. It is NULL when either operand is NULL and when the result is
 * ±INF or NaN, outside the float value set (§4.4).
 *
 * @param expression The `qti-power`.
 * @param scope The item and the variables of the attempt.
 * @param evaluate The evaluator, which gives each operand's value.
 * @returns The value, or the first operand's failure.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#OpPower
 */
const evaluatePower: Evaluator<"power"> = (expression, scope, evaluate) =>
  Result.map(numbersOf(expression.operands, scope, evaluate), (numbers) =>
    Option.match(numbers, {
      onNone: () => floatNull,
      onSome: ([base, exponent]) => {
        if (base === undefined || exponent === undefined) {
          return floatNull;
        }

        const result = pow(floatOf(base), floatOf(exponent));

        return Number.isFinite(result) ? floatValue(result) : floatNull;
      },
    }),
  );

/**
 * The functions family's evaluators by kind.
 */
export const functionsEvaluators: FamilyTable<
  "math-constant" | "math-operator" | "power" | "stats-operator"
> = {
  "math-constant": evaluateMathConstant,
  "math-operator": evaluateMathOperator,
  power: evaluatePower,
  "stats-operator": evaluateStatsOperator,
};
