import type { Child, Element } from "#crust/tree.ts";

/**
 * A node that holds no other node.
 */
export type Leaf = Exclude<Child, Element>;

/**
 * One step of a tour of a tree in document order: an element's start, a leaf, or an element's end.
 */
export type Step =
  | { readonly element: Element; readonly kind: "open" }
  | { readonly kind: "leaf"; readonly node: Leaf }
  | { readonly element: Element; readonly kind: "close" };

/**
 * Tour a node and everything below it in document order: an element opens, its children's tours
 * follow in order, and it closes; a leaf is one step.
 *
 * The tour keeps its own stack, so a tree of any depth or width is toured without recursion, and a
 * reader that stops early never walks the rest. An element's close goes on the stack beneath its
 * children, which go on last first, so each child's whole tour leaves the stack before its next
 * sibling's, and the close after the last child's. Every walk of crust's trees reads this one tour.
 *
 * @param node - The node to tour.
 * @yields {Step} Each step, in document order.
 */
export const tour = function* tour(node: Child): Generator<Step, void, undefined> {
  const pending: (Child | Extract<Step, { readonly kind: "close" }>)[] = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.kind === "close") {
      yield next;
    } else if (next.kind === "element") {
      yield { element: next, kind: "open" };
      pending.push({ element: next, kind: "close" });
      for (const child of next.children.toReversed()) {
        pending.push(child);
      }
    } else {
      yield { kind: "leaf", node: next };
    }
  }
};

/**
 * Visit a node and everything below it in document order, each once: the open and leaf steps of
 * its {@link tour}.
 *
 * @param node - The node to visit.
 * @yields {Child} Each node, an element before its descendants.
 */
export const preorder = function* preorder(node: Child): Generator<Child, void, undefined> {
  for (const step of tour(node)) {
    if (step.kind === "open") {
      yield step.element;
    } else if (step.kind === "leaf") {
      yield step.node;
    }
  }
};
