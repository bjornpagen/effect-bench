/**
 * An item's correct responses: {@link solution}, a plain function a host calls to show the answers
 * an item declares or its template processing set, such as on a solution page.
 *
 * This is a browser module: it value-imports from `effect` only `Option`, so a host that imports
 * `solution` alone bundles no Schema and no Effect runtime.
 *
 * @module
 */
import { Option } from "effect";
import type { TemplateRule } from "#plate/model/expression.ts";
import type { Item, RecordDeclaration, ResponseDeclaration } from "#plate/model/item.ts";
import type { SolutionRecord } from "#plate/model/record.ts";
import { nullOf, nullRecord } from "#plate/model/values.ts";
import type { RecordValue, Value } from "#plate/model/values.ts";
import type { Responses } from "#plate/session/session.ts";
import type { Accepted } from "#plate/validate/verdict.ts";

/**
 * Give a response declaration's correct response.
 *
 * @param declaration The response declaration.
 * @returns Its `qti-correct-response`, or NULL of its base type and cardinality when it declares
 *   none.
 */
const correctOf = (declaration: ResponseDeclaration): Value =>
  Option.getOrElse(declaration.correct, () =>
    nullOf(declaration.baseType, declaration.cardinality),
  );

/**
 * Give a record response declaration's correct response.
 *
 * @param declaration The record response declaration.
 * @returns Its `qti-correct-response`, or the NULL record when it declares none.
 */
const recordCorrectOf = (declaration: RecordDeclaration): RecordValue =>
  Option.getOrElse(declaration.correct, () => nullRecord);

/**
 * Give the identifiers of the responses whose correct response a `qti-set-correct-response` among
 * template rules sets, at any depth of their template conditions, whether or not its branch would
 * run.
 *
 * @param rules The template rules.
 * @returns The targeted identifiers, in document order, repeats included.
 */
const correctTargets = (rules: readonly TemplateRule[]): readonly string[] =>
  rules.flatMap((rule): readonly string[] => {
    switch (rule.kind) {
      case "set-correct-response": {
        return [rule.identifier];
      }
      case "template-condition": {
        return [
          ...rule.branches.flatMap((branch) => correctTargets(branch.then)),
          ...Option.match(rule.otherwise, { onNone: () => [], onSome: correctTargets }),
        ];
      }
      case "exit-template":
      case "set-default-value":
      case "set-template-value":
      case "template-constraint": {
        return [];
      }
      default: {
        return rule satisfies never;
      }
    }
  });

/**
 * Give the identifiers of the responses whose correct response an item's template processing sets.
 *
 * @param item The item.
 * @returns The identifiers a `qti-set-correct-response` targets, none when template processing does
 *   not run.
 */
const templateCorrectTargets = (item: Item): ReadonlySet<string> =>
  new Set(Option.match(item.templateProcessing, { onNone: () => [], onSome: correctTargets }));

/**
 * Give the correct response a record holds for a response, reading only the record's own keys: the
 * map comes from a plain object, which inherits `Object.prototype`, and `constructor` is a valid
 * identifier.
 *
 * @param record The record's correct responses, if any.
 * @param identifier The response's identifier.
 * @returns The record's value, or none when there is no record or it holds none by that name.
 */
const recorded = (record: SolutionRecord | undefined, identifier: string): Option.Option<Value> =>
  record !== undefined && Object.hasOwn(record.correct, identifier)
    ? Option.fromUndefinedOr(record.correct[identifier])
    : Option.none();

/**
 * Give an item's correct responses, by response identifier.
 *
 * With a record, each response's correct response is the one the record holds, which the item's
 * template processing set when its first attempt started, else the declaration's
 * `qti-correct-response`, else NULL of the declared base type and cardinality. With no record, an
 * item whose template processing runs gives NULL for each response a `qti-set-correct-response`
 * in it targets, at any depth, since that value is drawn only when the record starts; every other
 * response gives its declaration's correct response, or NULL. An item whose template processing
 * does not run, which its `unsupported` then marks, gives its declarations' correct responses.
 * Each record response gives its declaration's `qti-correct-response`, else the NULL record (a
 * record of no field), with or without a record: template processing that would set one is
 * marked `record-set` and does not run, so no record holds one.
 *
 * It takes `check`'s {@link Accepted}, never `redact`'s output, which holds no correct response.
 *
 * @param document The accepted item.
 * @param record The item's record, of which it reads only the correct responses template
 *   processing set.
 * @returns A value for every response the item declares, a record response's a record, each value
 *   of base type integer an exact `bigint`.
 * @see https://www.imsglobal.org/spec/qti/v3p0/info/index.html#Data_CorrectResponse
 */
export const solution = (document: Accepted, record?: SolutionRecord): Responses => {
  const withheld = record === undefined ? templateCorrectTargets(document.item) : new Set<string>();

  return {
    ...Object.fromEntries(
      [...document.item.responses].map(([identifier, declaration]) => [
        identifier,
        withheld.has(identifier)
          ? nullOf(declaration.baseType, declaration.cardinality)
          : Option.getOrElse(recorded(record, identifier), () => correctOf(declaration)),
      ]),
    ),
    ...Object.fromEntries(
      Array.from(document.item.records?.values() ?? [], (declaration) => [
        declaration.identifier,
        recordCorrectOf(declaration),
      ]),
    ),
  };
};
