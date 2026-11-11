/**
 * The render functions an author calls: {@link redact}, then {@link render} for the item and
 * {@link renderStatus} for the Status part, each a plain function that returns a `Result`.
 *
 * The library ends at parts and pure functions (rule `a9d04969`): `render` writes the item Root
 * around its body and nothing else, so the form, its submit control, where the Status part goes
 * and every step of a flow are the author's. Its one input that is not a function of its
 * arguments is the instance a render draws when the author passes none. `render` prints everything
 * or nothing: it writes at most the configuration's `outputBudget` characters of HTML, and an item
 * with a printed variable or a parameter whose text passed its bound, or whose printed text passed
 * the budget `redact` ran under, prints nothing; either way it returns {@link OutputTooLarge} and
 * none of the page, never a part of it. This is a browser module: it value-imports from `effect`
 * only `Option`, `Array`, `pipe`, `Data` and `Result`.
 *
 * @module
 */
import { Data, Option, Result } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import { emitBody, writesMalformedHeading } from "#plate/emit/body.ts";
import type { RenderInteraction } from "#plate/emit/body.ts";
import { emitItem, emitStatus } from "#plate/emit/item.ts";
import type { StatusInput } from "#plate/emit/item.ts";
import { resolveOverrides } from "#plate/emit/parts.ts";
import type { PartOverrides, Resolved, UnknownPart } from "#plate/emit/parts.ts";
import { toHtml, toHtmlWithin } from "#plate/emit/serialise.ts";
import type { MarkupRefused } from "#plate/emit/serialise.ts";
import type { PartSwapRefused } from "#plate/emit/swap.ts";
import { checkInstance } from "#plate/form/encoding.ts";
import type { InstanceRequirement } from "#plate/form/encoding.ts";
import { renderChoice } from "#plate/interactions/choice.ts";
import { renderExtendedText } from "#plate/interactions/extended-text.ts";
import { renderInlineChoice } from "#plate/interactions/inline-choice.ts";
import { renderTextEntry } from "#plate/interactions/text-entry.ts";
import type { RedactRecord } from "#plate/model/record.ts";
import type { ResponseValue } from "#plate/model/values.ts";
import { isRedacted, payload, redactItem } from "#plate/payload.ts";
import type {
  EmitState,
  Payload,
  Redacted,
  RenderMode,
  ValidationMessage,
  View,
} from "#plate/payload.ts";
import { drawInstance } from "#plate/seed.ts";
import type { Accepted } from "#plate/validate/verdict.ts";

/**
 * The author's inputs to one {@link render}, each optional.
 *
 * `parts` replaces parts through the swap invariant. `instance` is the instance token (see
 * {@link checkInstance}), drawn as a lowercase UUID when absent. `assetBase` overrides the
 * configuration's. `names`, `values` and `posted` are keyed by response identifier: the name a
 * response's controls post under (`entryName(instance, response)` when absent), the value they show
 * (NULL when absent), and the strings a refused post sent, which the controls show instead of
 * `values` when `messages` is not empty. A record value restores its `stringValue`, the text it was
 * typed as, into the string control bound to it, and a record without one leaves that control
 * empty; restored text counts toward the output budget as any other. `messages` are a refused
 * post's validation messages: each marks its response's controls invalid, and the first invalid
 * Control takes `autofocus`. `disabled` disables every control. `mode` is the state the item is
 * shown in, `answering` when absent, which the Root's `data-mode` names: `review` and `solution`
 * mark every interaction not editable, and `solution` shows the correct responses only when the
 * author passes them as `values`.
 */
export interface Options {
  readonly assetBase?: string;
  readonly disabled?: boolean;
  readonly instance?: string;
  readonly messages?: readonly ValidationMessage[];
  readonly mode?: RenderMode;
  readonly names?: Readonly<Record<string, string>>;
  readonly parts?: PartOverrides;
  readonly posted?: Readonly<Record<string, readonly string[]>>;
  readonly values?: Readonly<Record<string, ResponseValue>>;
}

/**
 * What {@link render} and {@link renderStatus} return: the part's HTML and the instance token that
 * scopes it.
 *
 * `instance` is the token the render used, the one the author passed or the UUID `render` drew, so
 * the author can hand it to `renderStatus`, `entryName`, `decode` and `partition`.
 */
export interface Rendered {
  readonly html: string;
  readonly instance: string;
}

/**
 * Where an instance token was passed: `render`'s `options.instance` or `renderStatus`'s
 * `input.instance`.
 */
type InstanceSource = "input.instance" | "options.instance";

/**
 * What each {@link InstanceRequirement} says a broken token holds.
 */
const breaches: Readonly<Record<InstanceRequirement, (token: string) => string>> = {
  characters: (token) =>
    `holds ${JSON.stringify(/[^\w.:-]/u.exec(token)?.[0] ?? "")}, which is not an ASCII letter, a digit, "_", ".", ":" or "-"`,
  "id-boundary": (token) =>
    token.endsWith("-")
      ? `ends in "-", so its ids can equal another instance's`
      : `holds "--", so its ids can equal another instance's`,
  "non-empty": () => "is empty",
};

/**
 * What to pass instead, by where the token was passed.
 */
const instanceRemedies: Readonly<Record<InstanceSource, string>> = {
  "input.instance":
    'Pass the token the item was rendered with: ASCII letters, digits, "_", ".", ":" and "-", not ending in "-" and holding no "--"',
  "options.instance":
    'Omit instance to draw a UUID, or pass a token of ASCII letters, digits, "_", ".", ":" and "-" that does not end in "-" and holds no "--"',
};

/**
 * An instance token that breaks a requirement {@link checkInstance} checks: a developer error,
 * returned through a `Result`, never thrown.
 *
 * `requirement` is the first requirement the token breaks, and `source` says where it was passed.
 */
export class InvalidInstance extends Data.TaggedError("InvalidInstance")<{
  readonly requirement: InstanceRequirement;
  readonly source: InstanceSource;
  readonly token: string;
}> {
  /**
   * The token, what it breaks, and what to pass instead.
   */
  override get message(): string {
    return `The instance token ${JSON.stringify(this.token)} in ${this.source} ${breaches[this.requirement](this.token)}. ${instanceRemedies[this.source]}.`;
  }
}

/**
 * A configured heading level at which plate cannot write a heading: a developer error, returned
 * through a `Result`, never thrown.
 *
 * `configure` gives only an integer from 2 to 6, so only a `Configuration` built by hand, which
 * skips `configure`, reaches it. {@link renderStatus} writes its heading at the level itself, so it
 * refuses a level that is not an integer from 1 to 6. {@link render} shifts the item's headings to
 * the level, capped at `h6` (`writesMalformedHeading` in `#plate/emit/body.ts`), so it refuses a
 * level only for an item that writes a heading, and only where the capped level is not an integer:
 * `NaN`, `-Infinity` or a fraction below 6. Every other level renders, capped at `h6`. `level` is
 * the configuration's `headingLevel`.
 */
export class InvalidHeadingLevel extends Data.TaggedError("InvalidHeadingLevel")<{
  readonly level: number;
}> {
  /**
   * The level, and how to build a configuration that holds a valid one.
   */
  override get message(): string {
    return `The configuration's headingLevel ${String(this.level)} is not a level a heading can be written at. Build the configuration with configure, which takes an integer from 2 to 6.`;
  }
}

/**
 * An item `render` was given that neither `redact` nor the codec's `decodeRedacted` made: a
 * developer error, returned through a `Result`, never thrown.
 *
 * The `Redacted` brand is checked in the type and, since the brand alone cannot hold at run time,
 * by a mark only those two producers set (`isRedacted` in `#plate/payload.ts`). A copy of a
 * redacted item (a spread, a JSON round trip, a `structuredClone`) or an object built by hand and
 * cast carries no mark, so {@link render} refuses it before it reads anything else. It has no
 * field: the value it refuses is the caller's own, and naming none of it keeps the item's content
 * out of the error.
 */
export class NotRedacted extends Data.TaggedError("NotRedacted") {
  /**
   * What render was given, and the two ways to a value it takes.
   */
  // oxlint-disable-next-line eslint/class-methods-use-this -- A field would be an own property of the error, and this one has none: its message names no part of the caller's value.
  override get message(): string {
    return "The item passed to render was not made by redact or decodeRedacted, so it carries no redaction mark: a copy of a redacted item, or an object built by hand, is refused. Pass the value redact returns, or decode the stored JSON with decodeRedacted and pass its value.";
  }
}

/**
 * An item `render` cannot print in full, returned through a `Result`, never thrown: its HTML would
 * pass the configuration's `outputBudget`, the host's limit, or a printed variable's text passed
 * its bound, so the page would show its slot blank.
 *
 * {@link render} counts the characters it writes as it writes them, as a string's `length` counts
 * them, and stops at the first chunk that would pass the budget, so it never builds the oversized
 * page and returns none of it. `budget` is the configuration's `outputBudget` and `item` the
 * redacted item's `identifier`. `printed` is none for the budget, and names the bound in
 * characters, which limit it is and the variable when a printed variable's text, or a
 * `param-variable` parameter's, passed it (the redacted item's `unprinted`), which `redact` does
 * not print: `limit` `"text"` with the bound 1,000,000, the most one text may hold, for a
 * conversion wider than that or a whole text longer; or `limit` `"budget"` with the output budget
 * `redact` ran under, when the item's printed text passed it at that variable, where `redact`
 * stopped printing. `limit` names the limit, not the cause, and tells the two apart when both are
 * 1,000,000. A parameter is named by its template variable.
 */
export class OutputTooLarge extends Data.TaggedError("OutputTooLarge")<{
  readonly budget: number;
  readonly item: string;
  readonly printed: Option.Option<{
    readonly bound: number;
    readonly identifier: string;
    readonly limit: "budget" | "text";
  }>;
}> {
  /**
   * The item, the limit it passed (the budget, or the bound and the variable, as `limit` names
   * it), that nothing was written, and what to change.
   */
  override get message(): string {
    return Option.match(this.printed, {
      onNone: () =>
        `Item ${JSON.stringify(this.item)} renders to more than ${String(this.budget)} characters of HTML, the configuration's outputBudget, so render wrote none of it. Raise outputBudget, up to 536,870,888, if the host can hold a page that large.`,
      onSome: ({ bound, identifier, limit }) =>
        limit === "text"
          ? `Item ${JSON.stringify(this.item)} would print more than ${String(bound)} characters for the variable ${JSON.stringify(identifier)}, so render wrote none of it. Shorten that variable's value, or the width or precision in its printed variable's format, so its text fits.`
          : `Item ${JSON.stringify(this.item)} prints more than ${String(bound)} characters of variables, the output budget redact ran under, by the variable ${JSON.stringify(identifier)}, so redact stopped printing there and render wrote none of it. Raise outputBudget, up to 536,870,888, in the configuration you pass to both redact and render, if the host can hold that much text.`,
    });
  }
}

/**
 * Check an instance token where it was passed.
 *
 * @param token The token.
 * @param source Where the author passed it.
 * @returns The token, or {@link InvalidInstance} naming the first requirement it breaks.
 */
const checkedInstance = (
  token: string,
  source: InstanceSource,
): Result.Result<string, InvalidInstance> =>
  Option.match(checkInstance(token), {
    onNone: () => Result.succeed(token),
    onSome: (requirement) => Result.fail(new InvalidInstance({ requirement, source, token })),
  });

/**
 * Copy an accepted document's item into the form the page may know: its body, title and language,
 * shown as the record's template values and outcome values say, without its correct responses,
 * mappings, defaults, processing or template rules.
 *
 * A printed variable prints the value `record` holds for it, a template value else an outcome
 * value, formatted as its attributes say; NULL prints nothing, and one whose value `record` does
 * not hold shows the notice `qti-printed-variable`. A template block or inline, and a choice with
 * a `template-identifier`, is shown or hidden by the template value `record` holds: a hidden choice
 * is absent from its interaction. A `param` whose `value` names a `param-variable` template
 * variable passes that variable's value. One whose template value `record` does not hold is
 * withheld: a block, an inline or a `param` shows its notice, and a choice is absent, the
 * redacted item's notices naming `template-identifier` once for all such choices.
 *
 * A printed variable or a parameter on content the page sees whose text would pass 1,000,000
 * characters (a conversion wider than that, or a whole text longer) prints nothing, and the
 * redacted item's `unprinted` names the first, with that bound and the limit `"text"`, so
 * {@link render} fails {@link OutputTooLarge} rather than show the slot blank. Content the page
 * does not see is never printed, so it never fails a render.
 *
 * The printed text is held to `limits.outputBudget`, the budget `render` holds its HTML to:
 * `redact` counts the characters each printed variable and parameter on content the page sees
 * prints, in document order, and stops printing at the first whose text would pass what remains.
 * That one and every later one print nothing, and `unprinted` names it with the budget as its bound
 * and the limit `"budget"`, so `render` fails {@link OutputTooLarge} naming the variable. So
 * `redact` never builds more printed text than the budget, however much the item would print. Pass
 * the configuration you pass to `render`; with none, the configuration's default, 16,777,216,
 * applies. `redact` holds the budget to 1 to 536,870,888, as `configure` does, but clamps rather
 * than refuses: `NaN` runs under the default, 16,777,216, a fraction under its floor, anything
 * above 536,870,888 (`Infinity` included) under 536,870,888, and anything below 1 (0 and
 * `-Infinity` included) under 1. When the budget runs out, `unprinted`'s bound is the budget it ran
 * under.
 *
 * With no record, an item whose template processing does not run reads as the record its first
 * attempt starts with (its declared template defaults and its outcomes' starting values), and an
 * item whose template processing runs withholds every printed variable, template block, template
 * inline, `param-variable` parameter and choice with a template visibility. It never copies a
 * template value or an outcome value it does not print or pass, the record's seed or an override
 * template processing set. `redactItem` in `#plate/payload.ts` lists what it copies.
 *
 * The redacted item's notices can name more than the record's, which `fresh` lists from the
 * features the item marks: under a template processing the engine does not run, no template value
 * is computed, so a printed variable that names a template variable shows the notice
 * `qti-printed-variable`, which the redacted item's notices name and the record's do not.
 *
 * It takes only `check`'s `Accepted` (rule `723e580c`), so a hand-built item never reaches
 * {@link render} unchecked: `check` drops a `javascript:` href, and refuses an `onclick` on every
 * element the Schematron's extension-attribute lists cover (reading 90, E10). The emitter still
 * drops every event-handler attribute it meets, as defence in depth. It always gives a redacted
 * item: what it cannot print shows as a notice.
 *
 * @example
 *   const shown = redact(accepted, record, configuration); // record: the attempt's Restored["record"]
 *   const rendered = render(shown, configuration, { instance: "q1" });
 *
 * @param document The document `check` accepted.
 * @param record The attempt's template values and outcome values, such as its record, whose type
 *   is `Restored["record"]`; none to show the item as it reads with no record.
 * @param limits The output budget its printed text is held to, clamped to 1 to 536,870,888: the
 *   configuration passed to `render`, or `{ outputBudget }`; none for the configuration's default,
 *   16,777,216.
 * @returns The redacted item, the one input {@link render} takes.
 */
export const redact = (
  document: Accepted,
  record?: RedactRecord,
  limits?: Pick<Configuration, "outputBudget">,
): Redacted => redactItem(document.item, record, limits);

/**
 * Give a record keyed by response identifier as the map a view holds.
 *
 * @param record The author's record, none when absent.
 * @returns Its entries as a map, empty when absent.
 */
const mapOf = <A>(record: Readonly<Record<string, A>> = {}): ReadonlyMap<string, A> =>
  new Map(Object.entries(record));

/**
 * Build the view of one render from the author's options.
 *
 * @param instance The checked or drawn instance token.
 * @param configuration The configuration, which gives the locale and the seed.
 * @param options The author's options.
 * @returns The view `payload` reads, its mode `answering` when the author names none, holding the
 *   configuration's `seed` when it has one.
 */
const viewOf = (instance: string, configuration: Configuration, options: Options): View => {
  const view: View = {
    finished: options.disabled ?? false,
    instance,
    locale: configuration.locale,
    messages: options.messages ?? [],
    mode: options.mode ?? "answering",
    names: mapOf(options.names),
    posted: Option.map(Option.fromUndefinedOr(options.posted), mapOf),
    values: mapOf(options.values),
  };

  return configuration.seed === undefined ? view : { ...view, seed: configuration.seed };
};

/**
 * Build the emit state of one render.
 *
 * @param configuration The configuration, which gives the locale, the heading level and the asset
 *   base.
 * @param parts The resolved part overrides.
 * @param assetBase The author's asset base, which overrides the configuration's.
 * @returns The emit state.
 */
const stateOf = (configuration: Configuration, parts: Resolved, assetBase?: string): EmitState => ({
  assetBase: assetBase ?? configuration.assetBase,
  headingLevel: configuration.headingLevel,
  locale: configuration.locale,
  parts,
});

/**
 * Construct the render function each interaction of a body is handed to, dispatching on its kind.
 *
 * @param built The render's payload.
 * @param state The render's emit state.
 * @returns The function that renders one interaction through its module.
 */
const interactionRenderer =
  (built: Payload, state: EmitState): RenderInteraction =>
  (interaction) => {
    switch (interaction.kind) {
      case "choice": {
        return renderChoice(interaction, built, state);
      }
      case "extended-text": {
        return renderExtendedText(interaction, built, state);
      }
      case "inline-choice": {
        return renderInlineChoice(interaction, built, state);
      }
      case "text-entry": {
        return renderTextEntry(interaction, built, state);
      }
      default: {
        return interaction satisfies never;
      }
    }
  };

/**
 * Render an item: the item Root around its body, as HTML.
 *
 * It resolves the overrides once, takes the instance from `options.instance` as given or draws a
 * lowercase UUID v4 (`drawInstance`, from `crypto.getRandomValues`, never derived from the seed;
 * not `crypto.randomUUID`, which a browser gives only in a secure context, so a page served over
 * plain HTTP lacks it), builds the payload from the redacted item and the options, and emits the
 * body and the Root. A shuffled Choice is presented in the order the configuration's `seed`, the
 * instance and its response key give. The Root's `data-mode` names `options.mode`. It writes no
 * form, submit control, title or record. Given the same instance, configuration and inputs, it
 * gives the same HTML, and it returns the instance it used.
 *
 * It takes only the very object `redact`, or the codec's `decodeRedacted`, returned (rule
 * `723e580c`). Before anything else, before the instance, the heading level or the budget, it asks
 * whether `item` carries the mark those two set (`isRedacted` in `#plate/payload.ts`), and fails
 * {@link NotRedacted} when it does not: a copy of a redacted item (a spread, a JSON round trip) or
 * an object built by hand and cast type-checks, but was never the allowlist's. {@link renderStatus}
 * and `renderNavigation` take no item, so they read no mark.
 *
 * It prints everything or nothing. First, an item whose `unprinted` names a printed variable or a
 * parameter whose text passed its bound, 1,000,000 or the budget `redact` ran under, fails
 * {@link OutputTooLarge} naming the bound, which limit it is and the variable, before anything is
 * built. Then it counts the characters of HTML as it writes them, as a string's `length` counts
 * them, and stops at the first chunk that would pass the configuration's `outputBudget`: HTML of
 * exactly `outputBudget` characters is returned, and one more fails {@link OutputTooLarge} with
 * none of the page built or returned.
 *
 * An item that writes a heading at a level that, capped at 6, is not an integer (only a
 * `Configuration` built by hand, with a `headingLevel` of `NaN`, `-Infinity` or a fraction below
 * 6, gives one) fails {@link InvalidHeadingLevel} once the Root is built and before any HTML is
 * written: after an unknown part, an instance token or a part swap would fail, and before refused
 * markup or the output budget would.
 *
 * @example
 *   const rendered = render(redact(accepted, undefined, configuration), configuration, {
 *     instance: "q1",
 *   });
 *   // Result.succeed({ html: '<qti-assessment-item id="q1-item" …>…</qti-assessment-item>', instance: "q1" })
 *
 * @param item The item `redact` gave, or `decodeRedacted`: that object itself, never a copy.
 * @param configuration The configuration, which gives the locale, the heading level, the asset
 *   base, the seed and the output budget.
 * @param options The author's inputs, none by default.
 * @returns The Root's HTML and the instance token it used, or {@link NotRedacted} for an item
 *   neither `redact` nor `decodeRedacted` returned, {@link UnknownPart} for an override the part
 *   table lacks, {@link InvalidInstance} for an instance token that breaks a requirement,
 *   {@link PartSwapRefused} for a replacement that breaks the swap invariant,
 *   {@link InvalidHeadingLevel} for a heading level no heading of the item can be written at,
 *   {@link MarkupRefused} for a replacement holding markup the serialiser cannot write, or
 *   {@link OutputTooLarge} for an item with a text past its bound, or HTML that would pass the
 *   configuration's `outputBudget`.
 */
export const render = (
  item: Redacted,
  configuration: Configuration,
  options: Options = {},
): Result.Result<
  Rendered,
  | InvalidHeadingLevel
  | InvalidInstance
  | MarkupRefused
  | NotRedacted
  | OutputTooLarge
  | PartSwapRefused
  | UnknownPart
> =>
  Result.gen(function* renderItem() {
    if (!isRedacted(item)) {
      return yield* Result.fail(new NotRedacted());
    }

    if (Option.isSome(item.unprinted)) {
      const { bound, identifier, limit } = item.unprinted.value;

      return yield* Result.fail(
        new OutputTooLarge({
          budget: configuration.outputBudget,
          item: item.identifier,
          printed: Option.some({ bound, identifier, limit }),
        }),
      );
    }

    const parts = yield* resolveOverrides(options.parts);
    const instance = yield* options.instance === undefined
      ? Result.succeed(drawInstance())
      : checkedInstance(options.instance, "options.instance");
    const state = stateOf(configuration, parts, options.assetBase);
    const built = payload(item, viewOf(instance, configuration, options));
    const body = yield* emitBody(built, state, interactionRenderer(built, state));
    const root = yield* emitItem(built, state, body);

    if (writesMalformedHeading(built.body, configuration.headingLevel)) {
      return yield* Result.fail(new InvalidHeadingLevel({ level: configuration.headingLevel }));
    }

    const html = yield* Result.fromOption(
      yield* toHtmlWithin(root, configuration.outputBudget),
      () =>
        new OutputTooLarge({
          budget: configuration.outputBudget,
          item: item.identifier,
          printed: Option.none(),
        }),
    );

    return { html, instance };
  });

/**
 * Render the Status part: the status region, its heading and what it shows, as HTML.
 *
 * It checks `input.instance`, which must be the token the item was rendered with, then the part
 * overrides, then the configuration's heading level, at which it writes the region's heading: an
 * integer from 1 to 6, or {@link InvalidHeadingLevel}, which only a `Configuration` built by hand
 * gives. It then emits the region through the same part overrides `render` takes. It places the
 * region nowhere and moves no focus.
 *
 * @example
 *   renderStatus({ heading: "scored", instance: "q1", score: "1" }, configuration);
 *   // Result.succeed({ html: '<section id="q1-status" role="status" …>…</section>', instance: "q1" })
 *
 * @param input The author's Status input.
 * @param configuration The configuration, which gives the locale and the heading level.
 * @param options The part overrides, none by default.
 * @returns The region's HTML and `input.instance`, or {@link InvalidInstance} for an
 *   `input.instance` that breaks a requirement, {@link UnknownPart} for an override the part table
 *   lacks, {@link InvalidHeadingLevel} for a heading level that is not an integer from 1 to 6,
 *   {@link PartSwapRefused} for a replacement that breaks the swap invariant, or
 *   {@link MarkupRefused} for a replacement holding markup the serialiser cannot write.
 */
export const renderStatus = (
  input: StatusInput,
  configuration: Configuration,
  options: Pick<Options, "parts"> = {},
): Result.Result<
  Rendered,
  InvalidHeadingLevel | InvalidInstance | MarkupRefused | PartSwapRefused | UnknownPart
> =>
  Result.gen(function* renderStatusRegion() {
    yield* checkedInstance(input.instance, "input.instance");

    const parts = yield* resolveOverrides(options.parts);
    // Plain JavaScript can hand over a configuration with no headingLevel, which the Status
    // heading reads as 1, as rowFor does.
    const configured: number | undefined = configuration.headingLevel;
    const headingLevel = configured ?? 1;

    if (!Number.isInteger(headingLevel) || headingLevel < 1 || headingLevel > 6) {
      return yield* Result.fail(new InvalidHeadingLevel({ level: headingLevel }));
    }

    const region = yield* emitStatus(input, stateOf(configuration, parts));

    return { html: yield* toHtml(region), instance: input.instance };
  });
