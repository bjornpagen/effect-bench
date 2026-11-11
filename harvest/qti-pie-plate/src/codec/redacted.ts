/**
 * The Schema codec of the redacted item, for the server and the boundaries: {@link RedactedSchema}
 * checks the fields of a {@link Redacted}, {@link encodeRedacted} writes one in the JSON form a host
 * sends to a page, and {@link decodeRedacted} checks that form before `render` takes it.
 *
 * A `Redacted` holds Effect `Option`s and `bigint` counts, which `JSON.stringify` cannot write, so
 * this file owns the one wire form: an `Option` is an optional key, absent when none, a count is
 * its decimal digits, and neither a body node nor the record of a text past its bound holds a path
 * into its source document ({@link NoPath}).
 * `decodeRedacted` is the second way to a `Redacted`, beside `redactItem`'s allowlisted copy, and
 * brands only what its Schema checked.
 *
 * No browser module imports this file, so Schema stays out of the browser bundle.
 *
 * @module
 * @see `redactItem` in `#plate/payload.ts`, the allowlist that decides which fields a `Redacted`
 *   holds.
 */
import { Data, Option, Predicate, Result, Schema, SchemaGetter } from "effect";
import { greatestCount } from "#plate/count-range.ts";
import type {
  BodyNode,
  ChoiceInteraction,
  ExtendedTextInteraction,
  Interaction,
  SimpleChoice,
  TextEntryInteraction,
} from "#plate/model/item.ts";
import { modelledBaseTypes, modelledCardinalities } from "#plate/model/values.ts";
import { brandRedacted } from "#plate/payload.ts";
import type { Redacted, RedactedFields } from "#plate/payload.ts";

/**
 * A body element's attribute in the JSON form.
 */
interface BodyAttributeJson {
  readonly name: string;
  readonly value: string;
}

/**
 * An HTML element of the body in the JSON form, with no path ({@link NoPath}).
 */
interface BodyElementJson {
  readonly attributes: readonly BodyAttributeJson[];
  readonly children: readonly BodyNodeJson[];
  readonly kind: "element";
  readonly tag: string;
}

/**
 * A run of body text in the JSON form.
 */
interface BodyTextJson {
  readonly kind: "text";
  readonly text: string;
}

/**
 * A `qti-simple-choice` or a `qti-inline-choice` in the JSON form.
 */
interface SimpleChoiceJson {
  readonly content: readonly BodyNodeJson[];
  readonly fixed: boolean;
  readonly identifier: string;
}

/**
 * A Choice in the JSON form: its counts as decimal digits, each `Option` an optional key, and no
 * path ({@link NoPath}).
 */
interface ChoiceInteractionJson {
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
  readonly cardinality: ChoiceInteraction["cardinality"];
  readonly choices: readonly SimpleChoiceJson[];
  readonly class: string;
  readonly kind: "choice";
  readonly maxChoices: string;
  readonly messages: { readonly max?: string; readonly min?: string };
  readonly minChoices: string;
  readonly orientation?: string;
  readonly prompt?: readonly BodyNodeJson[];
  readonly response: string;
  readonly shuffle: boolean;
}

/**
 * An Inline Choice in the JSON form: `minChoices` as decimal digits, each `Option` an optional key,
 * its Label among them, and no path ({@link NoPath}).
 */
interface InlineChoiceInteractionJson {
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
  readonly choices: readonly SimpleChoiceJson[];
  readonly class: string;
  readonly kind: "inline-choice";
  readonly label?: readonly BodyNodeJson[];
  readonly messages: { readonly min?: string };
  readonly minChoices: string;
  readonly placeholder?: string;
  readonly required: boolean;
  readonly response: string;
  readonly shuffle: boolean;
}

/**
 * A Text Entry in the JSON form: `expectedLength` as decimal digits, each `Option` an optional key,
 * and no path ({@link NoPath}).
 */
interface TextEntryInteractionJson {
  readonly ariaLabel?: string;
  readonly ariaLabelledby?: string;
  readonly base: number;
  readonly baseType: TextEntryInteraction["baseType"];
  readonly cardinality: TextEntryInteraction["cardinality"];
  readonly class: string;
  readonly expectedLength?: string;
  readonly kind: "text-entry";
  readonly patternMask?: string;
  readonly patternMaskMessage?: string;
  readonly placeholder?: string;
  readonly response: string;
}

/**
 * An Extended Text in the JSON form: a Text Entry's fields, with `expectedLines`, `maxStrings` and
 * `minStrings` as decimal digits, and `expectedLines`, `maxStrings` and its Prompt optional keys.
 */
interface ExtendedTextInteractionJson extends Omit<
  TextEntryInteractionJson,
  "cardinality" | "kind"
> {
  readonly cardinality: ExtendedTextInteraction["cardinality"];
  readonly expectedLines?: string;
  readonly format: ExtendedTextInteraction["format"];
  readonly kind: "extended-text";
  readonly maxStrings?: string;
  readonly minStrings: string;
  readonly prompt?: readonly BodyNodeJson[];
}

/**
 * A body part plate does not render, in the JSON form, with no path ({@link NoPath}).
 */
interface UnsupportedJson {
  readonly feature: string;
  readonly kind: "unsupported";
}

/**
 * A node of the body in the JSON form: the encoded side of {@link BodyNodeSchema}, written out
 * because the body is recursive and its suspended reference needs a declared type.
 */
type BodyNodeJson =
  | BodyElementJson
  | BodyTextJson
  | ChoiceInteractionJson
  | InlineChoiceInteractionJson
  | TextEntryInteractionJson
  | ExtendedTextInteractionJson
  | UnsupportedJson;

/**
 * The body's recursive reference: an element's children, a Prompt, a Label and a choice's content
 * are body nodes again.
 */
const BodyNodes = Schema.Array(
  // oxlint-disable-next-line eslint/no-use-before-define -- the body is recursive; the suspended reference is read only after `BodyNodeSchema` is defined.
  Schema.suspend((): Schema.Codec<BodyNode, BodyNodeJson> => BodyNodeSchema),
);

/**
 * A text the author may omit: an optional key, absent when none.
 */
const OptionalText = Schema.OptionFromOptionalKey(Schema.String);

/**
 * A body node's path into its source document, which the JSON form never holds (review P2-6). A
 * path names where a node sits among its siblings, so the path of a shown template block's
 * content, `…/qti-template-block[2]/qti-content-body/p`, or of a kept choice's content,
 * `…/qti-simple-choice[3]/span`, would tell a page that hidden template content exists and where;
 * and nothing after redaction reads a path (the emitter, the interactions and the form do not).
 *
 * Encoding writes no `path` key, and decoding gives every node the path `""`. A `path` key in the
 * input, as JSON written before the form dropped it holds, is dropped whatever its value, as
 * {@link decodeRedacted} drops any key the form does not hold. The type side keeps `path:
 * string`, so the codec's body-node union stays the model's `BodyNode`, and `redact`'s own result
 * keeps its paths on the server.
 */
const NoPath = Schema.optionalKey(Schema.Unknown).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.succeed(""),
    encode: SchemaGetter.omit(),
  }),
);

/**
 * `max-choices` and `min-choices`: a count from 0 to 2^63-1, held exactly and written as its
 * decimal digits (reading 46).
 */
const ChoiceCount = Schema.BigIntFromString.check(
  Schema.isBetweenBigInt({ maximum: greatestCount, minimum: 0n }),
);

/**
 * `min-strings`: a count with no upper bound (reading 46 does not list it), held exactly and
 * written as its decimal digits.
 */
const Count = Schema.BigIntFromString.check(Schema.isGreaterThanOrEqualToBigInt(0n));

/**
 * `expected-length`, `expected-lines` and `max-strings`: a {@link Count}, an optional key absent
 * when the author gave none.
 */
const OptionalCount = Schema.OptionFromOptionalKey(Count);

/**
 * A template visibility's type side, the model's `TemplateVisibility`: a choice's, a template
 * block's or a template inline's `show-hide` and `template-identifier`.
 */
const TemplateVisibility = Schema.Struct({
  showHide: Schema.Literals(["hide", "show"]),
  templateIdentifier: Schema.String,
});

/**
 * A choice's template visibility, which the JSON form never holds: decoding gives none, and
 * encoding refuses a choice that holds one, because `redact` settles each choice's visibility
 * before the item leaves the server.
 */
const NoTemplateVisibility = Schema.optionalKey(Schema.Never).pipe(
  Schema.decodeTo(
    Schema.Option(TemplateVisibility).check(
      Schema.makeFilter(Option.isNone, {
        message: "a redacted choice holds no template visibility; redact settles it",
      }),
    ),
    { decode: SchemaGetter.succeed(Option.none()), encode: SchemaGetter.omit() },
  ),
);

/**
 * The choices of a Choice or an Inline Choice, each with its content, `fixed` and identifier, in
 * document order, and no template visibility.
 */
const Choices = Schema.Array(
  Schema.Struct({
    content: BodyNodes,
    fixed: Schema.Boolean,
    identifier: Schema.String,
    templateVisibility: NoTemplateVisibility,
  }),
);

/**
 * A printed variable's `base` or `index`: an exact integer, or the name of the variable that holds
 * one.
 */
const IntegerOrRef = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("literal"), value: Schema.BigInt }),
  Schema.Struct({ _tag: Schema.Literal("ref"), identifier: Schema.String }),
]);

/**
 * Why the JSON form holds no printed variable, the message of the refusal on either side.
 */
const noPrintedVariable =
  "a redacted body holds no printed variable; redact puts the text it prints in its place, or its notice when the record holds no value for it (OD-P8-14)";

/**
 * A printed variable, which the JSON form never holds (OD-P8-14): `redact` puts the text each one
 * prints in its place before the item leaves the server, and its notice only where the record
 * holds no value for it. Its encoded side is `Never`, so decoding refuses a body node of its kind
 * and encoding refuses a body that holds one, as a second line behind `redact`, as the emitter is
 * one behind `url.ts`. Its type side holds every field of the model's printed variable, so the
 * codec's body-node union stays the model's `BodyNode`.
 */
const NoPrintedVariable = Schema.Never.pipe(
  Schema.decodeTo(
    Schema.Struct({
      base: IntegerOrRef,
      delimiter: Schema.String,
      field: Schema.Option(Schema.String),
      format: Schema.Option(Schema.String),
      identifier: Schema.String,
      index: Schema.Option(IntegerOrRef),
      kind: Schema.Literal("printed-variable"),
      mappingIndicator: Schema.String,
      path: Schema.String,
      powerForm: Schema.Boolean,
    }),
    {
      decode: SchemaGetter.forbidden(() => noPrintedVariable),
      encode: SchemaGetter.forbidden(() => noPrintedVariable),
    },
  ),
);

/**
 * Why the JSON form holds no template block or inline, the message of the refusal on either side.
 */
const noTemplateContent =
  "a redacted body holds no template block or inline; redact puts its content in its place when its template value shows it, nothing when it hides it, or its notice when the record holds no value for it (OD-P8-14)";

/**
 * A template block or inline, which the JSON form never holds (OD-P8-14): `redact` settles each
 * one's visibility before the item leaves the server, as it prints each printed variable
 * ({@link NoPrintedVariable}), so the template variable that decides it never reaches the page.
 * Its encoded side is `Never`, so decoding refuses a body node of either kind and encoding refuses
 * a body that holds one. Its type side holds every field of the model's template block, so the
 * codec's body-node union stays the model's `BodyNode`.
 */
const NoTemplateContent = Schema.Never.pipe(
  Schema.decodeTo(
    Schema.Struct({
      content: BodyNodes,
      identifier: Schema.String,
      kind: Schema.Literals(["template-block", "template-inline"]),
      path: Schema.String,
      responses: Schema.Array(Schema.String),
      templateVisibility: TemplateVisibility,
    }),
    {
      decode: SchemaGetter.forbidden(() => noTemplateContent),
      encode: SchemaGetter.forbidden(() => noTemplateContent),
    },
  ),
);

/**
 * The fields a Text Entry and an Extended Text share, as `TextEntryInteraction` declares them.
 */
const textControlFields = {
  ariaLabel: OptionalText,
  ariaLabelledby: OptionalText,
  base: Schema.Int,
  baseType: Schema.Literals(["float", "integer", "string"]),
  class: Schema.String,
  expectedLength: OptionalCount,
  path: NoPath,
  patternMask: OptionalText,
  patternMaskMessage: OptionalText,
  placeholder: OptionalText,
  response: Schema.String,
};

/**
 * The Schema of one body node, a union over the ten kinds of `BodyNode`, every field included; its
 * type is {@link BodyNode} and its encoded form {@link BodyNodeJson}, which holds no path
 * ({@link NoPath}), no printed variable ({@link NoPrintedVariable}) and no template block or inline
 * ({@link NoTemplateContent}).
 */
const BodyNodeSchema = Schema.Union([
  Schema.Struct({
    attributes: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
    children: BodyNodes,
    kind: Schema.Literal("element"),
    path: NoPath,
    tag: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    ariaLabel: OptionalText,
    ariaLabelledby: OptionalText,
    cardinality: Schema.Literals(["multiple", "single"]),
    choices: Choices,
    class: Schema.String,
    kind: Schema.Literal("choice"),
    maxChoices: ChoiceCount,
    messages: Schema.Struct({ max: OptionalText, min: OptionalText }),
    minChoices: ChoiceCount,
    orientation: OptionalText,
    path: NoPath,
    prompt: Schema.OptionFromOptionalKey(BodyNodes),
    response: Schema.String,
    shuffle: Schema.Boolean,
  }),
  Schema.Struct({
    ariaLabel: OptionalText,
    ariaLabelledby: OptionalText,
    choices: Choices,
    class: Schema.String,
    kind: Schema.Literal("inline-choice"),
    label: Schema.OptionFromOptionalKey(BodyNodes),
    messages: Schema.Struct({ min: OptionalText }),
    minChoices: ChoiceCount,
    path: NoPath,
    placeholder: OptionalText,
    required: Schema.Boolean,
    response: Schema.String,
    shuffle: Schema.Boolean,
  }),
  Schema.Struct({
    ...textControlFields,
    cardinality: Schema.Literals(["record", "single"]),
    kind: Schema.Literal("text-entry"),
  }),
  Schema.Struct({
    ...textControlFields,
    cardinality: Schema.Literals(["multiple", "ordered", "record", "single"]),
    expectedLines: OptionalCount,
    format: Schema.Literals(["plain", "preformatted", "xhtml"]),
    kind: Schema.Literal("extended-text"),
    maxStrings: OptionalCount,
    minStrings: Count,
    prompt: Schema.OptionFromOptionalKey(BodyNodes),
  }),
  Schema.Struct({
    feature: Schema.String,
    kind: Schema.Literal("unsupported"),
    path: NoPath,
  }),
  NoPrintedVariable,
  NoTemplateContent,
]);

/**
 * A body node as the members of {@link BodyNodeSchema} type it, read from the union itself. The
 * codec's test pins it to `BodyNode` both ways, so `tsc` refuses a model kind or field the union
 * lacks; the suspended {@link BodyNodes} cannot serve, because its annotation declares its type
 * `BodyNode`. `#plate/index.ts` does not export it.
 */
export type SchemaBodyNode = typeof BodyNodeSchema.Type;

/**
 * The first printed variable, or `param-variable` parameter, whose text passed its bound, as the
 * JSON form holds it: an optional key, absent when every text fits. Its `bound` is a whole number
 * of characters, at least 1, its `identifier` the variable `render`'s `OutputTooLarge` names, and
 * its `limit` which limit the bound is, `"text"` (the 1,000,000 one text may hold) or `"budget"`
 * (the output budget `redact` ran under); a form without `limit`, or with another value, is
 * refused. Like a body node it holds no path ({@link NoPath}): the path of a printed variable
 * inside a shown template block would tell a page where hidden template content sits.
 */
const Unprinted = Schema.OptionFromOptionalKey(
  Schema.Struct({
    bound: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    identifier: Schema.String,
    limit: Schema.Literals(["budget", "text"]),
    path: NoPath,
  }),
);

/**
 * A response's binding in the JSON form: a response of a base type writes its identifier, base type
 * and cardinality, and a record response its identifier and the cardinality `record`, with no base
 * type, since a record has none of its own.
 */
const ResponseBindingSchema = Schema.Union([
  Schema.Struct({
    baseType: Schema.Literals(modelledBaseTypes),
    cardinality: Schema.Literals(modelledCardinalities),
    identifier: Schema.String,
  }),
  Schema.Struct({
    cardinality: Schema.Literal("record"),
    identifier: Schema.String,
  }),
]);

/**
 * The Schema of a redacted item's fields; its type is {@link RedactedFields}, and its encoded form
 * the {@link RedactedJson} a host sends to a page.
 */
export const RedactedSchema = Schema.Struct({
  body: BodyNodes,
  document: Schema.String,
  identifier: Schema.String,
  lang: OptionalText,
  notices: Schema.Array(Schema.String),
  responses: Schema.Array(ResponseBindingSchema),
  title: Schema.String,
  unprinted: Unprinted,
});

/**
 * A redacted item in the form a host sends to a page: plain JSON, which `JSON.stringify` writes
 * without loss. An `Option` is an optional key, absent when none, a count is its decimal digits,
 * and neither a body node nor `unprinted` holds a path ({@link NoPath}).
 */
export type RedactedJson = typeof RedactedSchema.Encoded;

/**
 * Where the redacted-item codec failed: reading the JSON form a host handed over, or writing one
 * from a `Redacted`.
 */
export type RedactedStage = "decode" | "encode";

/**
 * What each {@link RedactedStage}'s failure means and what to do about it.
 */
const redactedRemedies: Readonly<Record<RedactedStage, (issue: string) => string>> = {
  decode: (issue) =>
    `The input is not the JSON form encodeRedacted writes: ${issue}. Pass encodeRedacted's output to decodeRedacted unchanged, through JSON.stringify and JSON.parse if it crosses the wire.`,
  encode: (issue) =>
    `A field of the redacted item does not fit its JSON form: ${issue}. Only an item built by hand can cause this; pass the Redacted that redact returned.`,
};

/**
 * A redacted item the codec could not read or write: input that is not the JSON form
 * {@link encodeRedacted} writes, or that holds an interaction `render` cannot emit (`stage`
 * `decode`), or a `Redacted` with a field that does not fit {@link RedactedSchema} (`stage`
 * `encode`), which only an object built by hand can hold.
 */
export class InvalidRedacted extends Data.TaggedError("InvalidRedacted")<{
  /**
   * What the Schema found wrong, with the path to it, how deep the input nests past
   * {@link maximumDepth}, which interaction sits where QTI's schema admits none, or what reading
   * the input threw.
   */
  readonly issue: string;
  /**
   * Whether the item failed on its way in from the JSON form or on its way out to it.
   */
  readonly stage: RedactedStage;
}> {
  /**
   * What is wrong and what to do instead, in one line.
   */
  override get message(): string {
    return redactedRemedies[this.stage](this.issue);
  }
}

/**
 * Write a redacted item in the JSON form a host sends to a page.
 *
 * @param item The item `redact` gave.
 * @returns The {@link RedactedJson}, which holds no path ({@link NoPath}), which `JSON.stringify`
 *   writes without loss, and which {@link decodeRedacted} reads back to `item` with every path
 *   `""`; or {@link InvalidRedacted} at stage `encode` naming a field that does not fit.
 */
export const encodeRedacted = (item: Redacted): Result.Result<RedactedJson, InvalidRedacted> =>
  Result.mapError(
    Schema.encodeResult(RedactedSchema)(item),
    (schemaError) => new InvalidRedacted({ issue: schemaError.message, stage: "encode" }),
  );

/**
 * The most levels of arrays and objects the JSON form may nest, the outermost value counted as
 * the first.
 *
 * `encodeRedacted` never writes more than 511 levels for an item `redact` produced. crust's reader
 * refuses a document that opens more than 256 elements at once (`defaultElementDepth` in
 * `@qti-pie/crust/read.ts`, a limit the operator ruled to keep, ruling `97a93093`), so at most 254
 * nest below `qti-item-body`; each adds at most two levels to the outermost object's one, the array
 * that holds it and its own object, and a run of text or an attribute inside the deepest adds two
 * more. Schema's decode recurses through every level and overflows Node's default stack from about
 * 1,540 levels, on a chain of `span`s in a fresh process. The bound sits between, about twice the
 * deepest item, so a body shape that spends four levels per element still fits.
 */
const maximumDepth = 1024;

/**
 * Tell whether a value nests arrays and objects more than {@link maximumDepth} levels deep,
 * measured with a list of pending values rather than by recursion, so the measure cannot overflow
 * the stack it guards, and stopping at the first value past the bound, so a cycle ends it too.
 *
 * It follows own enumerable properties, the only ones plain JSON data has. The Schema reads
 * inherited and non-enumerable ones too, so a live object can hide a deep field from this measure;
 * {@link decodeRedacted} refuses whatever such a field makes the Schema throw.
 *
 * @param input The value as the host handed it over.
 * @returns Whether some array or object in it sits more than `maximumDepth` levels down.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The JSON form arrives from the host as any value, and this measures it before the Schema reads it.
const nestsTooDeep = (input: unknown): boolean => {
  const pending: { readonly depth: number; readonly value: unknown }[] = [
    { depth: 1, value: input },
  ];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Predicate.isObjectOrArray(next.value)) {
      if (next.depth > maximumDepth) {
        return true;
      }

      for (const value of Object.values(next.value)) {
        pending.push({ depth: next.depth + 1, value });
      }
    }
  }

  return false;
};

/**
 * A body node waiting to be walked, with the content it sits in when QTI's schema admits no
 * interaction there, a Prompt, a Label or a choice's content, and none elsewhere.
 */
interface PendingNode {
  readonly node: BodyNode;
  readonly within: Option.Option<string>;
}

/**
 * Content an interaction holds where QTI's schema admits no interaction, with the words that name
 * where it sits.
 */
interface Region {
  readonly nodes: readonly BodyNode[];
  readonly within: string;
}

/**
 * The content each choice of a Choice or an Inline Choice holds, in document order.
 *
 * @param choices The interaction's choices.
 * @param owner The words that name the interaction.
 * @returns One region per choice.
 */
const choiceRegions = (choices: readonly SimpleChoice[], owner: string): readonly Region[] =>
  choices.map((simple) => ({
    nodes: simple.content,
    within: `the content of the choice ${JSON.stringify(simple.identifier)} of ${owner}`,
  }));

/**
 * The content an interaction holds where QTI's schema admits no interaction, in document order: a
 * Choice's Prompt then its choices' content, an Extended Text's Prompt, an Inline Choice's Label
 * then its choices' content, and nothing of a Text Entry's.
 *
 * @param interaction The interaction.
 * @returns Its regions, first in the document first.
 */
const regionsOf = (interaction: Interaction): readonly Region[] => {
  const owner = `the ${interaction.kind} interaction for the response ${JSON.stringify(interaction.response)}`;
  const named = (nodes: Option.Option<readonly BodyNode[]>, part: string): readonly Region[] =>
    Option.match(nodes, {
      onNone: () => [],
      onSome: (content) => [{ nodes: content, within: `the ${part} of ${owner}` }],
    });

  switch (interaction.kind) {
    case "choice": {
      return [...named(interaction.prompt, "Prompt"), ...choiceRegions(interaction.choices, owner)];
    }
    case "extended-text": {
      return named(interaction.prompt, "Prompt");
    }
    case "inline-choice": {
      return [...named(interaction.label, "Label"), ...choiceRegions(interaction.choices, owner)];
    }
    case "text-entry": {
      return [];
    }
    default: {
      return interaction satisfies never;
    }
  }
};

/**
 * Find the first interaction, in document order, that the body holds inside a Choice's Prompt or a
 * choice's content, inside an Extended Text's Prompt, or inside an Inline Choice's Label or the
 * content of one of its choices: content where QTI's schema admits no interaction, and where
 * `render` throws `NestedInteractionDefect` on one, or, in an Inline Choice's choice, writes no
 * text for it.
 *
 * It walks with a list of pending nodes rather than by recursion, as {@link nestsTooDeep} does, so
 * no body the depth bound lets through can overflow the stack.
 *
 * @param body The body the Schema decoded.
 * @returns What the interaction is and where it sits, or none when the body holds none there.
 */
const misplacedInteraction = (body: readonly BodyNode[]): Option.Option<string> => {
  const pending: PendingNode[] = [];
  const enqueue = (nodes: readonly BodyNode[], within: Option.Option<string>): void => {
    for (const node of nodes.toReversed()) {
      pending.push({ node, within });
    }
  };

  enqueue(body, Option.none());
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, within } = next;

    switch (node.kind) {
      case "element": {
        enqueue(node.children, within);
        break;
      }
      case "template-block":
      case "template-inline": {
        // The Schema refuses either kind first; a body that held one would hold its content here.
        enqueue(node.content, within);
        break;
      }
      case "printed-variable":
      case "text":
      case "unsupported": {
        break;
      }
      case "choice":
      case "extended-text":
      case "inline-choice":
      case "text-entry": {
        if (Option.isSome(within)) {
          return Option.some(
            `a ${node.kind} interaction for the response ${JSON.stringify(node.response)} sits inside ${within.value}, where QTI's schema admits no interaction and render cannot emit one`,
          );
        }

        for (const region of regionsOf(node).toReversed()) {
          enqueue(region.nodes, Option.some(region.within));
        }
        break;
      }
      default: {
        return node satisfies never;
      }
    }
  }

  return Option.none();
};

/**
 * Measure the input's depth, check it against {@link RedactedSchema}, then walk its body for an
 * interaction `render` cannot emit; the first two may throw on a live object, which
 * {@link decodeRedacted} refuses.
 *
 * @param input The JSON form as the host handed it over.
 * @returns The redacted item, or {@link InvalidRedacted} at stage `decode`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The JSON form arrives from the host as any value, and this is the check that parses it.
const decodeJson = (input: unknown): Result.Result<Redacted, InvalidRedacted> =>
  nestsTooDeep(input)
    ? Result.fail(
        new InvalidRedacted({
          issue: `it nests arrays and objects more than ${String(maximumDepth)} levels deep, deeper than encodeRedacted writes for any item the reader accepts`,
          stage: "decode",
        }),
      )
    : Result.flatMap(
        Result.mapError(
          Schema.decodeUnknownResult(RedactedSchema)(input),
          (schemaError) => new InvalidRedacted({ issue: schemaError.message, stage: "decode" }),
        ),
        (fields: RedactedFields) =>
          Option.match(misplacedInteraction(fields.body), {
            onNone: () => Result.succeed(brandRedacted(fields)),
            onSome: (issue) => Result.fail(new InvalidRedacted({ issue, stage: "decode" })),
          }),
      );

/**
 * Check the JSON form of a redacted item and make the {@link Redacted} `render` takes. It never
 * throws, whatever it is handed.
 *
 * It checks the JSON's shape, every field against {@link RedactedSchema}, which admits no printed
 * variable and no template block or inline, since `redact` leaves none, and one rule of the body's
 * content: no interaction stands, at any depth, inside a Choice's Prompt or a choice's content,
 * inside an Extended Text's Prompt, or inside an Inline Choice's Label or a choice's content, where
 * QTI's schema admits none and `render` cannot emit one, so `render` never meets such an
 * interaction in a `Redacted` it returns. It checks the item against no other rule of QTI's, so a
 * host trusts redacted JSON only as far as the item it came from; the emitter still keeps only the
 * HTML subset's elements and attributes, and the URLs `url.ts` keeps.
 *
 * @param input The JSON form as the host handed it over: the {@link RedactedJson}
 *   {@link encodeRedacted} wrote, after any JSON round trip. A count written as a JSON number is
 *   refused, and so is input that nests arrays and objects more than {@link maximumDepth} levels
 *   deep, which no item the reader accepts reaches. So is a live object that throws when read,
 *   such as one hiding a deep field in its prototype or a non-enumerable property, or holding a
 *   getter that throws; plain JSON data never does.
 * @returns The redacted item, every body node's path, and `unprinted`'s, `""` ({@link NoPath}),
 *   branded only after every field passed {@link RedactedSchema} and its body held no interaction
 *   where `render` cannot emit one, or {@link InvalidRedacted} at stage `decode` naming what does
 *   not fit.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The JSON form arrives from the host as any value, and this is the check that parses it.
export const decodeRedacted = (input: unknown): Result.Result<Redacted, InvalidRedacted> =>
  Result.flatMap(
    Result.try({
      catch: (thrown) =>
        new InvalidRedacted({
          issue: `reading it threw ${Predicate.isError(thrown) ? `${thrown.name}: ${thrown.message}` : "a value that is not an Error"}, which plain JSON data never does`,
          stage: "decode",
        }),
      try: () => decodeJson(input),
    }),
    (decoded) => decoded,
  );
