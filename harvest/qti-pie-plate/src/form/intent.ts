/**
 * The one mapping between a test session's intents and form entries: the name an intent posts
 * under, the value it encodes to, and the intent a posted entry decodes to.
 *
 * An intent posts under its test session's instance, and an item of the session posts under
 * `<instance>.<sequence index>`, so the two never share a name. `partition` of
 * `#plate/form/encoding.ts`, given an item's instance, calls the intent entry of a session whose
 * instance is a drawn UUID foreign; {@link decodeIntent} reads it by its own name.
 *
 * @module
 */
import { Array, Option } from "effect";
import type { Entry } from "#plate/form/encoding.ts";
import type { Intent } from "#plate/session/session.ts";

/**
 * An intent that carries nothing but its kind.
 */
type PlainIntent = Exclude<Intent, { readonly kind: "go" }>;

/**
 * The kinds of {@link PlainIntent}, each of which posts as itself.
 */
const plainKinds = [
  "end-part",
  "next",
  "previous",
  "submit-item",
  "submit-part",
] as const satisfies readonly PlainIntent["kind"][];

/**
 * What a `go` intent's value begins with; the sequence index follows it.
 */
const goPrefix = "go:";

/**
 * A sequence index as `go` posts it: a positive decimal integer with no sign and no leading zero.
 */
const sequenceIndexDigits = /^[1-9]\d*$/u;

/**
 * Name the form entry a test session's intent posts under.
 *
 * @param instance The test session's instance token.
 * @returns `<instance>.intent`.
 */
export const intentName = (instance: string): string => `${instance}.intent`;

/**
 * Encode an intent as the value its form entry posts, which {@link decodeIntent} reads back.
 *
 * @example
 *   encodeIntent({ kind: "submit-item" }); // "submit-item"
 *   encodeIntent({ kind: "go", sequenceIndex: 3 }); // "go:3"
 *
 * @param intent The intent.
 * @returns The intent's kind, or for `go`, `go:` and the sequence index in decimal.
 */
export const encodeIntent = (intent: Intent): string =>
  intent.kind === "go" ? `${goPrefix}${String(intent.sequenceIndex)}` : intent.kind;

/**
 * Read a sequence index as `go` posts it.
 *
 * @param digits The text after `go:`.
 * @returns The index, or none unless the text is a positive decimal integer no greater than
 *   `Number.MAX_SAFE_INTEGER`, written without a sign or a leading zero.
 */
const readSequenceIndex = (digits: string): Option.Option<number> => {
  if (!sequenceIndexDigits.test(digits)) {
    return Option.none();
  }

  const index = Number(digits);

  return Number.isSafeInteger(index) ? Option.some(index) : Option.none();
};

/**
 * Read one posted value as an intent.
 *
 * @param value The posted value.
 * @returns The intent {@link encodeIntent} writes as `value`, or none when it writes no intent so.
 */
const readIntent = (value: string): Option.Option<Intent> => {
  if (value.startsWith(goPrefix)) {
    return Option.map(readSequenceIndex(value.slice(goPrefix.length)), (sequenceIndex): Intent => ({
      kind: "go",
      sequenceIndex,
    }));
  }

  return Option.map(
    Array.findFirst(plainKinds, (kind) => kind === value),
    (kind): Intent => ({ kind }),
  );
};

/**
 * Decode the intent posted for a test session.
 *
 * Only the entry named {@link intentName} of `instance` is read; every other entry, another
 * session's intent included, is ignored. The value is read exactly as {@link encodeIntent} writes
 * it, with no trimming and no change of case.
 *
 * @param entries The posted entries.
 * @param instance The test session's instance token.
 * @returns The intent, or none when no entry is named for the session, when more than one is, when
 *   it is a file, or when its value is not one {@link encodeIntent} writes.
 */
export const decodeIntent = (
  entries: readonly Entry[],
  instance: string,
): Option.Option<Intent> => {
  const name = intentName(instance);
  const posted = entries.filter(([entry]) => entry === name).map(([, value]) => value);
  const texts = posted.filter((value): value is string => typeof value === "string");

  return posted.length === 1 ? Option.flatMap(Array.head(texts), readIntent) : Option.none();
};
