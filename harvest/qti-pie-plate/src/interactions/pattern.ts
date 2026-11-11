/**
 * The checks Text Entry and Extended Text share: a response against its interaction's
 * `pattern-mask`, a tier (b) check, run only under `validateResponses`, and the message an entry
 * that did not decode earns ({@link malformedMessage}).
 *
 * A `pattern-mask` is an XML Schema regular expression, which {@link compile} turns into an
 * automaton once per check, and {@link matches} runs that automaton over each value, anchored at
 * both ends, in time linear in the value's length: it never backtracks, so a hostile pattern such
 * as `(a+)+b` against a long posted value answers at once. Nothing is kept between checks:
 * compiling takes time linear in the pattern's length and its automaton's states, at most
 * `maximumStates`, and the patterns are author content, so a host that renders many packages holds
 * none of them after its checks return. A value of base type `integer` or `float` is matched in its
 * canonical lexical form, as `format` writes it, so on a `float` binding a posted `1.50` is matched
 * as `1.5` and on an `integer` binding `007` as `7`. A `string` is matched as the candidate typed
 * it, its line breaks already LF, and so is a record's `stringValue`, which `checkResponses` passes
 * as that string, so on a record binding `12.0` is matched as typed, never as `12`. Each member of
 * a `multiple` or `ordered` value is matched on its own.
 *
 * The check is this function, which the host runs with the posted response; no native `pattern`
 * attribute is written.
 *
 * The module is pure and synchronous, a browser module.
 *
 * @module
 */
import { Option, Result, pipe } from "effect";
import type { Configuration } from "#plate/configuration.ts";
import type { Malformed } from "#plate/form/encoding.ts";
import { message } from "#plate/messages.ts";
import type { Locale, MessageKey } from "#plate/messages.ts";
import type { TextEntryInteraction } from "#plate/model/item.ts";
import { compile, matches } from "#plate/model/regex.ts";
import type { Matcher } from "#plate/model/regex.ts";
import { format } from "#plate/model/values.ts";
import type { Value } from "#plate/model/values.ts";

/**
 * Compile a pattern.
 *
 * @param pattern The `pattern-mask`, as written.
 * @returns Its matcher, or none when {@link compile} refuses it.
 */
const matcherOf = (pattern: string): Option.Option<Matcher> => Result.getSuccess(compile(pattern));

/**
 * Check a text response against its interaction's `pattern-mask`.
 *
 * The response mismatches when any of its values does not match the whole pattern, so one
 * mismatching member of a container gives the message. NULL is not checked. An interaction without
 * a `pattern-mask` checks nothing, and so does one whose pattern {@link compile} refuses (outside
 * Appendix F's grammar, or past its `maximumStates`), which an item built by `open` never holds:
 * it shows the notice `pattern-mask` instead.
 *
 * @example
 *   // With validateResponses on, against pattern-mask="([0-9.]{0,6})":
 *   patternMessage(interaction, { baseType: "string", cardinality: "single", values: [{ baseType: "string", value: "12a" }] }, configuration);
 *   // Option.some of the author's data-patternmask-message, else patternMismatch's text
 *
 * @param interaction The Text Entry or Extended Text: its `pattern-mask` and the author's message.
 * @param value The decoded response.
 * @param configuration The configuration, which gives `validateResponses` and the locale.
 * @returns The one pattern message, the author's `data-patternmask-message` or else the locale's
 *   `patternMismatch`; none when the response matches, is NULL, or is not checked.
 */
export const patternMessage = (
  interaction: Pick<TextEntryInteraction, "patternMask" | "patternMaskMessage">,
  value: Value,
  configuration: Configuration,
): Option.Option<string> =>
  configuration.validateResponses
    ? pipe(
        interaction.patternMask,
        Option.flatMap(matcherOf),
        Option.filter((matcher) =>
          value.values.some((single) => !matches(matcher, format(single))),
        ),
        Option.map(() =>
          Option.getOrElse(interaction.patternMaskMessage, () =>
            message(configuration.locale, "patternMismatch"),
          ),
        ),
      )
    : Option.none();

/**
 * The message a Text Entry or Extended Text gives for each reason its entry did not decode, but
 * for a numeric binding's `number`, whose message {@link malformedMessage} gives itself.
 *
 * A file (`file`) and a second entry (`single-many`) get their own messages on every binding.
 * `identifier` on any binding, `character`, which a browser never posts, and `number` on a
 * `string` binding, which only a {@link Malformed} built by hand carries, get the general
 * `notAccepted`.
 */
const refusals = {
  character: "notAccepted",
  file: "malformedFile",
  identifier: "notAccepted",
  number: "notAccepted",
  "single-many": "malformedSingleMany",
} as const satisfies Readonly<Record<Malformed["reason"], MessageKey>>;

/**
 * Give the message a text entry that did not decode earns, a tier (a) check.
 *
 * Every binding gives `malformedFile` for a file and `malformedSingleMany` for a second entry. On
 * an `integer` or `float` binding, a text that is not a number gives the author's
 * `data-patternmask-message` when set, else `malformedNumber`. Any other reason gives
 * `notAccepted`.
 *
 * @param interaction The Text Entry or Extended Text: its base type and the author's message.
 * @param reason Why the entry did not decode.
 * @param locale The locale of the message.
 * @returns The one message.
 */
export const malformedMessage = (
  interaction: Pick<TextEntryInteraction, "baseType" | "patternMaskMessage">,
  reason: Malformed["reason"],
  locale: Locale,
): string =>
  reason === "number" && interaction.baseType !== "string"
    ? Option.getOrElse(interaction.patternMaskMessage, () => message(locale, "malformedNumber"))
    : message(locale, refusals[reason]);
