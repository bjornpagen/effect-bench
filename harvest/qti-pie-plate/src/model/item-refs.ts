/**
 * The walk that lists a test's item refs, which the session, its navigation and the package reader
 * share, and the split of a prefixed name's rest into the occurrence and the variable it names
 * ({@link occurrenceOf}), which the test model, the package reader and the test scope share.
 *
 * It lives apart from the test model because the model builder value-imports the Effect runtime,
 * and the session's and the engine's modules are browser modules: this module value-imports
 * nothing.
 *
 * @module
 */
import type { ItemRef, SectionChild } from "#plate/model/test.ts";

/**
 * List the item refs among some section children, nested sections' included, in document order.
 *
 * @param children The children.
 * @returns Their item refs.
 */
export const itemRefsIn = (children: readonly SectionChild[]): readonly ItemRef[] =>
  children.flatMap((child) => (child.kind === "item-ref" ? [child] : itemRefsIn(child.children)));

/**
 * List the identifiers of the item refs among some section children, nested sections' included,
 * in document order.
 *
 * @param children The children.
 * @returns Their item refs' identifiers.
 */
export const refIdentifiersIn = (children: readonly SectionChild[]): readonly string[] =>
  itemRefsIn(children).map((ref) => ref.identifier);

/**
 * The numbered form of a prefixed name's rest, `N.VAR`: `N` all digits and at least 1, its leading
 * zeros allowed, the first instance being 1 (reading 88, "a numbered reference such as
 * `Q01.2.SCORE` names an instance of an item ref that a selection with replacement can repeat, and
 * nothing else"), as the qti package matches a numbered reading's number (`positiveNumberPattern`
 * in `packages/pantry/src/qti/expressions.ts`). So `0.VAR` is no occurrence: it names the variable
 * `0.VAR`, which no item has, since an identifier never starts with a digit.
 */
const occurrenceForm = /^(?<occurrence>0*[1-9]\d*)\.(?<variable>.+)$/su;

/**
 * What the rest of a prefixed name names in its item: the occurrence, counted from 1, and the
 * variable's name.
 */
export interface Occurrence {
  readonly occurrence: bigint;
  readonly variable: string;
}

/**
 * Split the rest of a prefixed name, what follows its item ref, into the occurrence it names and
 * the variable: `N.VAR` in the numbered form names occurrence `N`, and any other rest names
 * occurrence 1 and is the variable whole.
 *
 * The split reads the form alone; whether a numbered reading counts is judged apart. By reading 88
 * it counts only where a selection with replacement can repeat its item ref, and a name whose only
 * resolving reading is numbered elsewhere is refused (`openPackage` in `#plate/package/open.ts`,
 * `undeclared-variable` with `check: "numbered"`), as the qti package resolves a numbered reading
 * only when its item ref is `replaced` (the relation `Reading` in
 * `packages/pantry/src/qti/expressions.ts`). The test model (`Test.repeatable` in
 * `#plate/model/test.ts`) and the engine (`TestScope.repeatable` in `#plate/engine/scope.ts`) count
 * it as the package does: through any other item ref the rest is the variable whole.
 *
 * @param rest The part of the name after the item ref and its dot.
 * @returns The occurrence and the variable's name.
 */
export const occurrenceOf = (rest: string): Occurrence => {
  const groups = occurrenceForm.exec(rest)?.groups;

  return {
    occurrence: BigInt(groups?.["occurrence"] ?? "1"),
    variable: groups?.["variable"] ?? rest,
  };
};
