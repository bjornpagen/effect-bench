/**
 * The locales the renderer writes its own text in.
 *
 * The configuration's `locale` admits exactly these, so every locale a host can pick has a catalog.
 */
export const locales = ["en"] as const;

/**
 * A locale the renderer writes its own text in.
 */
export type Locale = (typeof locales)[number];

/**
 * The English catalog: every string the renderer writes into an item, keyed by the role it plays.
 *
 * A `{name}` in a text is a placeholder that {@link message} fills. A Status heading's key is the
 * `heading` it names (`notAccepted`, `scored`, `responseRecorded`, `review`, `solution`,
 * `partSubmitted`, `testFinished`), and a page's title is `title` with a state's text as its
 * `state` (`answering`, `notAccepted`, `responseRecorded`, `scored`, `partSubmitted`, `review`,
 * `solution`, `finished`), so the closed test's summary is titled "Finished: {test}" through
 * `title` and `finished`. An item's state in words (`itemAnswered`, `itemNotAnswered`,
 * `itemSubmitted`, `itemClosed`) follows its name (`itemOf` on a navigation button, `item` on the
 * confirm page's list) through `itemState`, so the punctuation between them is the locale's. The
 * closed test's summary heads the test's outcomes with `testOutcomes`, writes a NULL outcome as
 * `nullValue`, and says with `outcomesNotRun` that outcome processing the engine cannot run did not
 * run. `atLeastStrings` and `atMostStrings` read in the plural, so at a count of 1 an Extended Text
 * writes `atLeastOneString` or `atMostOneString`, their singular. This catalog is the source of the
 * keys and of each key's placeholders; any other locale's catalog has the same keys and
 * placeholders.
 */
const en = {
  answer: "Answer",
  answerOf: "Answer {n} of {count}",
  answering: "Answering",
  atLeast: "Select at least {n}.",
  atLeastOneString: "Enter at least 1 answer.",
  atLeastStrings: "Enter at least {n} answers.",
  atMost: "Select at most {n}.",
  atMostOneString: "Enter at most 1 answer.",
  atMostStrings: "Enter at most {n} answers.",
  choiceOf: "Choice {n} of {count}",
  confirm: "Confirm",
  confirmList: "Unanswered or unsubmitted items",
  confirmTitle: "Confirm: {intent}, {test}",
  downloadResults: "Download results (XML)",
  endOfPart: "This is the last item in this part. End the part to go on.",
  endPart: "End part",
  finished: "Finished",
  item: "Item {n}",
  itemAnswered: "answered",
  itemClosed: "closed",
  itemNotAnswered: "not answered",
  itemOf: "Item {n} of {count}",
  itemState: "{item}, {state}",
  itemSubmitted: "submitted",
  malformedFile: "Enter text, not a file.",
  malformedNumber: "Enter a number.",
  malformedSingleMany: "Enter one answer.",
  nextItem: "Next item",
  notAccepted: "Not accepted",
  notice: "Not supported here: {feature}",
  nullValue: "NULL",
  outcomesNotRun: "The test's outcome processing did not run.",
  partSubmitted: "Part submitted",
  patternMismatch: "Enter an answer in the form this question asks for.",
  previousItem: "Previous item",
  responseRecorded: "Response recorded",
  resume: "Resume: {test}, Item {n} of {count}",
  return: "Return",
  review: "Review",
  reviewItem: "Review: Item {n}",
  reviewNotAllowed: "review not allowed",
  score: "Score: {score}",
  scored: "Scored",
  selectPrompt: "Select an answer",
  skippingNotAllowed: "Answer this item before you submit it.",
  solution: "Solution",
  solutionItem: "Solution: Item {n}",
  solutionNotAllowed: "solution not allowed",
  submit: "Submit",
  submitAnswer: "Submit answer",
  submitPart: "Submit part",
  testFinished: "Test finished",
  testNavigation: "Test navigation",
  testOutcomes: "Test outcomes",
  title: "{state}: {title}",
  unknownChoice: "Choose one of the listed options.",
} as const;

/**
 * The key of a string the renderer writes.
 */
export type MessageKey = keyof typeof en;

/**
 * The names of the `{name}` placeholders in a catalog text, as a union, or `never` when it has
 * none.
 */
type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/**
 * The values {@link message} fills a key's placeholders with, one per placeholder.
 *
 * Each value is text as the candidate reads it: a number arrives already formatted for the locale,
 * `notice`'s `feature` is the feature key in QTI's own spelling (an element name, `pattern-mask`,
 * `cardinality="record"`), a `test` is the test's title, and `confirmTitle`'s `intent` is the
 * navigation label of the intent it confirms (`submitPart`'s or `endPart`'s text).
 */
export type MessageParams<Key extends MessageKey> = Readonly<
  Record<Placeholders<(typeof en)[Key]>, string>
>;

/**
 * The arguments {@link message} takes after the key: the params, required exactly when the key's
 * text has a placeholder, so no `{name}` reaches the page unfilled.
 */
type MessageArguments<Key extends MessageKey> = [Placeholders<(typeof en)[Key]>] extends [never]
  ? [params?: MessageParams<Key>]
  : [params: MessageParams<Key>];

/**
 * The text of every key in each locale.
 */
const catalogs: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en };

/**
 * A `{name}` placeholder in a catalog text; its one group is the name.
 */
const placeholder = /\{(?<name>[A-Za-z]+)\}/gu;

/**
 * Write a count or a position as a locale writes numbers: the form a number takes in
 * {@link MessageParams}, already formatted for the locale.
 *
 * @example
 *   numeral("en", 12_000n); // "12,000"
 *
 * @param locale The locale of the renderer's own text.
 * @param n The number; a `bigint` is written exactly, at any size.
 * @returns The number, formatted for `locale`.
 */
export const numeral = (locale: Locale, n: bigint | number): string =>
  new Intl.NumberFormat(locale).format(n);

/**
 * Write the renderer's text for a key in a locale.
 *
 * A placeholder without a value, which only a call around the parameter types can leave, stays as
 * written rather than becoming empty.
 *
 * @example
 *   message("en", "answerOf", { count: "2", n: "1" }); // "Answer 1 of 2"
 *
 * @param locale The locale to write in.
 * @param key The string to write.
 * @param params The values of the key's `{name}` placeholders.
 * @returns The key's text in `locale`, with every placeholder filled.
 */
export const message = <Key extends MessageKey>(
  locale: Locale,
  key: Key,
  ...[params]: MessageArguments<Key>
): string => {
  const values: Readonly<Record<string, string>> = params ?? {};

  return catalogs[locale][key].replaceAll(
    placeholder,
    (whole, name: string) => values[name] ?? whole,
  );
};
