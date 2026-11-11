import { Result } from "effect";
import { tour } from "#crust/tour.ts";
import type { Leaf } from "#crust/tour.ts";
import type { Child, Element } from "#crust/tree.ts";

/**
 * What opening one element of a rebuild gives: its counterpart's own fields, every one but its
 * children, and the context its children are rebuilt in.
 */
export interface Opened<S> {
  readonly element: Omit<Element, "children">;
  readonly scope: S;
}

/**
 * Rebuild `root` and everything below it, in document order, threading a context down the tree:
 * each element is replaced by the counterpart `open` gives it in its parent's context, and each
 * leaf, in place and in order, by the nodes `leaf` gives for it.
 *
 * The rebuild folds `root`'s {@link tour}, so a tree of any depth or width is rebuilt without
 * recursion. Each open puts the counterpart in the children list being filled and makes its own
 * list and context the ones in force; each close returns to the list and context it interrupted,
 * and the root's own close, which interrupted none, ends the rebuild. The callbacks see only the
 * original nodes. The first failure in document order ends the rebuild.
 *
 * @param root - The element to rebuild.
 * @param scope - The context `root` is opened in.
 * @param open - Gives an element's counterpart and its children's context, or a failure.
 * @param leaf - Gives the nodes that stand in a leaf's place, none to drop it, or a failure.
 * @returns The rebuilt root, or the first failure.
 */
export const rebuild = <S, E>(
  root: Element,
  scope: S,
  open: (element: Element, scope: S) => Result.Result<Opened<S>, E>,
  leaf: (node: Leaf) => Result.Result<readonly Child[], E>,
): Result.Result<Element, E> => {
  const top = open(root, scope);
  if (Result.isFailure(top)) {
    return Result.fail(top.failure);
  }

  const children: Child[] = [];
  const rebuilt: Element = { ...top.success.element, children };
  const interrupted: { readonly into: Child[]; readonly scope: S }[] = [];
  let into = children;
  let current = top.success.scope;
  const steps = tour(root);
  // The first step is the root's own open, which `rebuilt` already stands for.
  steps.next();
  for (const step of steps) {
    if (step.kind === "open") {
      const opened = open(step.element, current);
      if (Result.isFailure(opened)) {
        return Result.fail(opened.failure);
      }

      const below: Child[] = [];
      into.push({ ...opened.success.element, children: below });
      interrupted.push({ into, scope: current });
      into = below;
      current = opened.success.scope;
    } else if (step.kind === "close") {
      const resumed = interrupted.pop();
      // Only the root's own close, the tour's last step, interrupted nothing: the rebuild is done.
      if (resumed === undefined) {
        break;
      }

      ({ into, scope: current } = resumed);
    } else {
      const nodes = leaf(step.node);
      if (Result.isFailure(nodes)) {
        return Result.fail(nodes.failure);
      }

      into.push(...nodes.success);
    }
  }

  return Result.succeed(rebuilt);
};
