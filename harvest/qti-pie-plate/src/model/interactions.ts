/**
 * The walk that finds an item body's interactions, which response validation and the payload
 * share.
 *
 * It lives apart from the item model because the model builder value-imports the Effect runtime,
 * and both callers are browser modules: this module value-imports only `Option`.
 *
 * @module
 */
import { Option } from "effect";
import type { BodyNode, Interaction } from "#plate/model/item.ts";

/**
 * Collect the interactions of body nodes in document order, inside elements, template blocks and
 * inlines, Prompts, Labels and choices. A template block's or inline's content is walked whatever
 * its visibility, so over the model its interactions are found; a redacted body holds no template
 * block or inline, its hidden content already gone.
 *
 * @param nodes The body nodes.
 * @returns The interactions.
 */
export const interactionsIn = (nodes: readonly BodyNode[]): readonly Interaction[] =>
  nodes.flatMap((node): readonly Interaction[] => {
    switch (node.kind) {
      case "element": {
        return interactionsIn(node.children);
      }
      case "template-block":
      case "template-inline": {
        return interactionsIn(node.content);
      }
      case "choice": {
        return [
          node,
          ...interactionsIn(Option.getOrElse(node.prompt, () => [])),
          ...node.choices.flatMap((choice) => interactionsIn(choice.content)),
        ];
      }
      case "extended-text": {
        return [node, ...interactionsIn(Option.getOrElse(node.prompt, () => []))];
      }
      case "inline-choice": {
        return [
          node,
          ...interactionsIn(Option.getOrElse(node.label, () => [])),
          ...node.choices.flatMap((choice) => interactionsIn(choice.content)),
        ];
      }
      case "text-entry": {
        return [node];
      }
      case "printed-variable":
      case "text":
      case "unsupported": {
        return [];
      }
      default: {
        return node satisfies never;
      }
    }
  });
