/**
 * The Schema codec of the test session, for the server and the boundaries: {@link TestSessionSchema}
 * checks the plain {@link TestSession} of `#plate/session/session.ts`, {@link encodeSession} writes
 * it in the form the host stores, and {@link decodeSession} checks one the host hands back, against
 * the test it must belong to, before the library trusts it.
 *
 * The stored form names its version, as the stored item record does, and each item's record in it
 * is a stored item record. No browser module imports this file, so Schema stays out of the browser
 * bundle.
 *
 * @module
 */
import { Array as Arr, Data, Option, Result, Schema, SchemaTransformation } from "effect";
import { ItemRecordSchema, storedVersion, versionIssue, versionOf } from "#plate/codec/record.ts";
import { ResponseValueSchema, ValueSchema } from "#plate/codec/values.ts";
import type { OutcomeDeclaration } from "#plate/model/item.ts";
import type { TemplateDefault } from "#plate/model/test.ts";
import type { SessionItem, SessionPart, TestSession } from "#plate/session/session.ts";
import type { NavigationMode } from "#plate/vocabulary.ts";

/**
 * Values by identifier: an item's first outcomes or template defaults, or the test's outcomes.
 */
const ValuesSchema = Schema.Record(Schema.String, ValueSchema);

/**
 * An item's saved responses by identifier, each a value or, for a record response, a record, as
 * the session's `Responses` holds them.
 */
const SavedSchema = Schema.Record(Schema.String, ResponseValueSchema);

/**
 * The Schema of one item of a test session. `saved`, `firstOutcomes` and `templateDefaults` are
 * left out of the stored form when there are none.
 */
const SessionItemSchema = Schema.Struct({
  datestamp: Schema.String,
  duration: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  firstOutcomes: Schema.OptionFromOptionalKey(ValuesSchema),
  presented: Schema.Boolean,
  record: ItemRecordSchema,
  ref: Schema.String,
  saved: Schema.OptionFromOptionalKey(SavedSchema),
  sequenceIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  templateDefaults: Schema.OptionFromOptionalKey(ValuesSchema),
});

/**
 * The fields of a test session, as {@link TestSession} has them. `seed` is a string, required: the
 * host's seed or the one `startTest` drew, which every stored session holds. `outcomeRuns` is a
 * whole number, and `shuffleSeed` is left out of the stored form when the session has none.
 */
const sessionFields = {
  document: Schema.String,
  instance: Schema.String,
  items: Schema.Array(SessionItemSchema),
  kind: Schema.Literal("test"),
  outcomeRuns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outcomes: ValuesSchema,
  parts: Schema.Array(
    Schema.Struct({
      identifier: Schema.String,
      status: Schema.Literals(["current", "ended", "pending"]),
    }),
  ),
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  seed: Schema.String,
  shuffleSeed: Schema.OptionFromOptionalKey(Schema.String),
  started: Schema.String,
  status: Schema.Literals(["closed", "interacting"]),
  test: Schema.String,
  updated: Schema.String,
};

/**
 * The Schema of a test session; its type is {@link TestSession}, and its encoded form the
 * {@link StoredTestSession} the host keeps, which adds `version`. Encoding writes
 * {@link storedVersion} and decoding requires it, so the plain session carries no version.
 */
export const TestSessionSchema = Schema.Struct({
  ...sessionFields,
  version: Schema.Literal(storedVersion),
}).pipe(
  Schema.decodeTo(
    Schema.toType(Schema.Struct(sessionFields)),
    SchemaTransformation.transform({
      decode: ({ version: _stored, ...session }) => session,
      encode: (session) => ({ ...session, version: storedVersion }),
    }),
  ),
);

/**
 * A test session in the form the host stores: JSON-safe data that names its version, `4`. Every
 * value is written as the stored item record writes it, integers as their decimal digits, so no
 * integer is rounded on the way through the host, the test's `outcomes` among them; each item's
 * `record` is a stored item record, its seed, template values, correct responses and defaults with
 * it, so it is server data as the record is, and so is the session's own `seed`, which keys every
 * value an item draws; an item's `saved`, `firstOutcomes` and `templateDefaults`, and the
 * session's `shuffleSeed`, are absent when there are none.
 */
export type StoredTestSession = typeof TestSessionSchema.Encoded;

/**
 * An item ref of the test a stored session must belong to, as far as the session reads it.
 */
interface SessionItemRef {
  /**
   * The item ref's identifier, which the session's item for it names as its `ref`.
   */
  readonly identifier: string;
  readonly kind: "item-ref";
  /**
   * The template defaults the item ref applies, as far as the session reads them: the template
   * variable each sets. A session item of a started nonlinear part holds a value of exactly these.
   */
  readonly templateDefaults: readonly Pick<TemplateDefault, "templateIdentifier">[];
}

/**
 * A section of the test a stored session must belong to, as far as the session reads it: the
 * sections and item refs it holds, in document order.
 */
interface SessionSection {
  readonly children: readonly (SessionItemRef | SessionSection)[];
  readonly kind: "section";
}

/**
 * The test a stored session must belong to: its identifier, its document's location, its parts
 * with each one's navigation mode and the item refs it holds, each with its template defaults, and
 * its outcome declarations, as the accepted test's model gives them, so an `AcceptedTest` is one.
 */
export interface SessionTest {
  readonly test: {
    /**
     * The test document's location.
     */
    readonly document: string;
    /**
     * The test's identifier.
     */
    readonly identifier: string;
    /**
     * The test's outcome declarations, by identifier: the outcomes a session of it holds, each of
     * its declared base type and cardinality.
     */
    readonly outcomes: ReadonlyMap<string, Pick<OutcomeDeclaration, "baseType" | "cardinality">>;
    /**
     * The test's parts in order, each with its sections, whose item refs are the session's items
     * in document order, and its navigation mode: a nonlinear part's items hold their template
     * defaults from the part's start.
     */
    readonly parts: readonly {
      readonly children: readonly SessionSection[];
      readonly identifier: string;
      readonly navigation: NavigationMode;
    }[];
  };
}

/**
 * Where the session codec failed: reading a session the host handed back, or writing one.
 */
export type SessionStage = "decode" | "encode";

/**
 * What each {@link SessionStage}'s failure means and what to do about it.
 */
const sessionRemedies: Readonly<Record<SessionStage, (issue: string) => string>> = {
  decode: (issue) =>
    `The stored test session is not one this renderer reads: ${issue}. Pass back, unchanged, the session encodeSession wrote, or start the test again.`,
  encode: (issue) =>
    `The test session does not fit its stored form: ${issue}. Pass the session startTest or advance returned, unchanged; if you did, report it with the test as a renderer defect.`,
};

/**
 * A test session the codec could not read or write: one the host handed back that this renderer
 * did not write, another version included (`stage` `decode`), or one that does not fit the
 * session's Schema on its way out (`stage` `encode`).
 */
export class InvalidSession extends Data.TaggedError("InvalidSession")<{
  /**
   * What is wrong, with the path to it: the version found, when that is what is wrong.
   */
  readonly issue: string;
  /**
   * Whether the session failed on its way in from the host or on its way out to it.
   */
  readonly stage: SessionStage;
  /**
   * The value the stored session holds under `version`, which is `4` when something else is
   * wrong; none when it is not an object or names no version, and at stage `encode`, where no
   * stored session was read.
   */
  readonly version: Option.Option<unknown>;
}> {
  /**
   * What is wrong and what to do instead, in one line.
   */
  override get message(): string {
    return sessionRemedies[this.stage](this.issue);
  }
}

/**
 * Which of a session's names did not match its test's: the test's identifier or its document's
 * location.
 */
export type SessionField = "document" | "test";

/**
 * A stored session that belongs to another test, or to another document of a test with the same
 * identifier, than the one it was handed back with.
 */
export class SessionMismatch extends Data.TaggedError("SessionMismatch")<{
  /**
   * The test's own identifier or document location.
   */
  readonly expected: string;
  /**
   * Which of the two did not match.
   */
  readonly field: SessionField;
  /**
   * What the stored session names instead.
   */
  readonly found: string;
}> {
  /**
   * What is wrong and what to do instead, in one line.
   */
  override get message(): string {
    const named = this.field === "test" ? "test" : "test document";

    return `The stored test session belongs to the ${named} ${this.found}, not ${this.expected}. Pass the session started for this test, or start a new one.`;
  }
}

/**
 * Write a test session in the form the host stores.
 *
 * @param session The session.
 * @returns The {@link StoredTestSession}, which `JSON.stringify` writes without loss and
 *   {@link decodeSession} reads back to `session`, or {@link InvalidSession} at stage `encode`
 *   naming a value that does not fit the session's Schema.
 */
export const encodeSession = (
  session: TestSession,
): Result.Result<StoredTestSession, InvalidSession> =>
  Result.mapError(
    Schema.encodeResult(TestSessionSchema)(session),
    (schemaError) =>
      new InvalidSession({ issue: schemaError.message, stage: "encode", version: Option.none() }),
  );

/**
 * Check that a session names the test it was handed back with.
 *
 * @param session The decoded session.
 * @param test The test it must belong to.
 * @returns The session, or {@link SessionMismatch} naming the first name that differs: the test's
 *   identifier, then its document's location.
 */
const belonging = (
  session: TestSession,
  test: SessionTest,
): Result.Result<TestSession, SessionMismatch> => {
  if (session.test !== test.test.identifier) {
    return Result.fail(
      new SessionMismatch({ expected: test.test.identifier, field: "test", found: session.test }),
    );
  }

  return session.document === test.test.document
    ? Result.succeed(session)
    : Result.fail(
        new SessionMismatch({
          expected: test.test.document,
          field: "document",
          found: session.document,
        }),
      );
};

/**
 * List the item refs among some section children, nested sections' included, in document order,
 * as `itemRefsIn` of `#plate/model/item-refs.ts` walks the test's model.
 *
 * @param children The children.
 * @returns Their item refs.
 */
const refsIn = (
  children: readonly (SessionItemRef | SessionSection)[],
): readonly SessionItemRef[] =>
  children.flatMap((child) => (child.kind === "item-ref" ? [child] : refsIn(child.children)));

/**
 * Write a count of things, the noun in the plural unless the count is 1.
 *
 * @param count The count.
 * @param noun The noun, singular.
 * @returns The count and the noun, such as `1 item` or `3 items`.
 */
const counted = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/**
 * One rule a decoded session must meet against its test.
 *
 * @param session The decoded session, which names its test.
 * @param test The test.
 * @returns What breaks the rule, with the path to it, or none when the session meets it.
 */
type SessionRule = (session: TestSession, test: SessionTest) => Option.Option<string>;

/**
 * The session's items are its test's item refs in document order, one per ref: the test model
 * neither selects nor reorders them, it marks a selection or an ordering.
 */
const itemsRule: SessionRule = (session, test) => {
  const refs = test.test.parts.flatMap((part) =>
    refsIn(part.children).map((ref) => ref.identifier),
  );
  if (session.items.length !== refs.length) {
    return Option.some(
      `items holds ${counted(session.items.length, "item")}, where the test has ${counted(refs.length, "item ref")}, one item each`,
    );
  }

  return Arr.findFirst(session.items, (item, index) =>
    item.ref === refs[index]
      ? Option.none()
      : Option.some(
          `items[${String(index)}].ref is ${JSON.stringify(item.ref)}, where the test's item ref ${String(index + 1)} in document order is ${JSON.stringify(refs[index])}`,
        ),
  );
};

/**
 * The items are numbered from 1 in order.
 */
const sequenceRule: SessionRule = (session) =>
  Arr.findFirst(session.items, (item, index) =>
    item.sequenceIndex === index + 1
      ? Option.none()
      : Option.some(
          `items[${String(index)}].sequenceIndex is ${String(item.sequenceIndex)}, where the items are numbered from 1 in order, so it is ${String(index + 1)}`,
        ),
  );

/**
 * The session's parts are its test's parts, in order.
 */
const partsRule: SessionRule = (session, test) => {
  const parts = test.test.parts.map((part) => part.identifier);
  if (session.parts.length !== parts.length) {
    return Option.some(
      `parts holds ${counted(session.parts.length, "part")}, where the test has ${String(parts.length)}`,
    );
  }

  return Arr.findFirst(session.parts, (part, index) =>
    part.identifier === parts[index]
      ? Option.none()
      : Option.some(
          `parts[${String(index)}].identifier is ${JSON.stringify(part.identifier)}, where the test's part ${String(index + 1)} is ${JSON.stringify(parts[index])}`,
        ),
  );
};

/**
 * Where each part status may stand in the parts' order: parts run in order and an ended part never
 * reopens, so the statuses are `ended` parts, then at most one `current` part, then `pending` ones.
 */
const statusOrder: Readonly<Record<SessionPart["status"], number>> = {
  current: 1,
  ended: 0,
  pending: 2,
};

/**
 * The parts are ended, then at most one is current, then the rest are pending; a closed session
 * has no current part.
 */
const statusRule: SessionRule = (session) =>
  Arr.findFirst(session.parts, (part, index) => {
    if (part.status === "current" && session.status === "closed") {
      return Option.some(
        `parts[${String(index)}].status is "current" while status is "closed", where a closed session's parts are all ended`,
      );
    }

    return Option.flatMap(Arr.get(session.parts, index - 1), (previous) =>
      statusOrder[previous.status] > statusOrder[part.status] ||
      (previous.status === "current" && part.status === "current")
        ? Option.some(
            `parts[${String(index)}].status is ${JSON.stringify(part.status)} after a ${JSON.stringify(previous.status)} part, where the parts are ended, then at most one current, then pending`,
          )
        : Option.none(),
    );
  });

/**
 * Each item's record is scoped by the session's instance, a `.` and the item's sequence index.
 */
const instanceRule: SessionRule = (session) =>
  Arr.findFirst(session.items, (item, index) => {
    const expected = `${session.instance}.${String(item.sequenceIndex)}`;

    return item.record.instance === expected
      ? Option.none()
      : Option.some(
          `items[${String(index)}].record.instance is ${JSON.stringify(item.record.instance)}, where it is the session's instance, a "." and the item's sequenceIndex: ${JSON.stringify(expected)}`,
        );
  });

/**
 * An ISO 8601 UTC instant in the extended format: a date, a time to the second with any decimal
 * fraction, and `Z`; the year in four digits, or signed in six, as `Date.prototype.toISOString`
 * writes a year outside 0 to 9999.
 */
const instantForm =
  /^(?<year>[+-]\d{6}|\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?Z$/u;

/**
 * Report whether a text is an ISO 8601 UTC instant a `Date` reads as written: in
 * {@link instantForm}, naming a day the calendar has and a time of day from 00:00:00 to 23:59:59,
 * within the range a `Date` holds.
 *
 * @param text The text.
 * @returns Whether it is such an instant.
 */
const isInstant = (text: string): boolean => {
  const fields = instantForm.exec(text)?.groups;
  const time = Date.parse(text);
  if (fields === undefined || !Number.isFinite(time)) {
    return false;
  }

  const read = new Date(time);

  return (
    read.getUTCFullYear() === Number(fields["year"]) &&
    read.getUTCMonth() + 1 === Number(fields["month"]) &&
    read.getUTCDate() === Number(fields["day"]) &&
    read.getUTCHours() === Number(fields["hour"]) &&
    read.getUTCMinutes() === Number(fields["minute"]) &&
    read.getUTCSeconds() === Number(fields["second"])
  );
};

/**
 * `started`, `updated` and each item's `datestamp` are ISO 8601 UTC instants, and the session was
 * not updated before it started.
 */
const datesRule: SessionRule = (session) => {
  const dates: readonly (readonly [string, string])[] = [
    ["started", session.started],
    ["updated", session.updated],
    ...session.items.map(
      (item, index) => [`items[${String(index)}].datestamp`, item.datestamp] as const,
    ),
  ];
  const invalid = Arr.findFirst(dates, ([path, date]) =>
    isInstant(date)
      ? Option.none()
      : Option.some(
          `${path} is ${JSON.stringify(date)}, which is not an ISO 8601 UTC instant such as "2026-11-05T10:00:00.000Z"`,
        ),
  );

  return Option.orElse(invalid, () =>
    Date.parse(session.updated) < Date.parse(session.started)
      ? Option.some(
          `updated, ${JSON.stringify(session.updated)}, is before started, ${JSON.stringify(session.started)}`,
        )
      : Option.none(),
  );
};

/**
 * The position is the index of one of the items, or 0 when the session has none.
 */
const positionRule: SessionRule = (session) =>
  session.position < Math.max(session.items.length, 1)
    ? Option.none()
    : Option.some(
        session.items.length === 0
          ? `position is ${String(session.position)}, where a session with no item holds 0`
          : `position is ${String(session.position)}, past the last of the session's ${counted(session.items.length, "item")}, at ${String(session.items.length - 1)}`,
      );

/**
 * Write some identifiers for a message, each in quotes, separated by commas.
 *
 * @param identifiers The identifiers.
 * @returns The list, such as `"T", "U"`.
 */
const quoted = (identifiers: readonly string[]): string =>
  identifiers.map((identifier) => JSON.stringify(identifier)).join(", ");

/**
 * Judge one session item's stored template defaults against its item ref's, when its part is
 * nonlinear and has started: the item holds a value of exactly the template variables the ref's
 * defaults set, and holds none when they set none.
 *
 * @param item The session item.
 * @param index Its index among the session's items.
 * @param ref Its item ref.
 * @returns What does not fit, or none when the item's keys are the ref's.
 */
const defaultsIssue = (
  item: SessionItem,
  index: number,
  ref: SessionItemRef,
): Option.Option<string> => {
  const path = `items[${String(index)}].templateDefaults`;
  const wanted = [...new Set(ref.templateDefaults.map((each) => each.templateIdentifier))];
  const gives =
    wanted.length === 0
      ? `its item ref ${JSON.stringify(ref.identifier)}, in a nonlinear part that has started, gives no template default`
      : `its item ref ${JSON.stringify(ref.identifier)}, in a nonlinear part that has started, gives defaults of exactly ${quoted(wanted)}`;

  return Option.match(item.templateDefaults, {
    onNone: () =>
      wanted.length === 0 ? Option.none() : Option.some(`${path} is absent, where ${gives}`),
    onSome: (stored) => {
      const missing = Arr.findFirst(wanted, (identifier) =>
        Object.hasOwn(stored, identifier)
          ? Option.none()
          : Option.some(`${path} holds no value of ${JSON.stringify(identifier)}, where ${gives}`),
      );
      const extra = Arr.findFirst(Object.keys(stored), (identifier) =>
        wanted.includes(identifier)
          ? Option.none()
          : Option.some(`${path} holds ${JSON.stringify(identifier)}, where ${gives}`),
      );

      return Option.orElse(
        Option.orElse(missing, () => extra),
        () =>
          wanted.length === 0
            ? Option.some(`${path} is present and empty, where ${gives}, so the item holds none`)
            : Option.none(),
      );
    },
  });
};

/**
 * Each item of a nonlinear part that has started, current or ended, holds the template defaults
 * its item ref gives by exactly their template identifiers, and none when the ref gives none: the
 * part evaluated them at its start, so a key missing or extra is not one the renderer wrote. An
 * item of a pending part, which has evaluated none, or of a linear part, which evaluates them when
 * the candidate meets the item, is not judged. The values are `present`'s to check when it shows
 * the item. {@link itemsRule} has already matched the items to the test's item refs.
 */
const templateDefaultsRule: SessionRule = (session, test) => {
  const places = test.test.parts.flatMap((part, partIndex) => {
    const judged =
      part.navigation === "nonlinear" &&
      Option.exists(Arr.get(session.parts, partIndex), ({ status }) => status !== "pending");

    return refsIn(part.children).map((ref) => ({ judged, ref }));
  });

  return Arr.findFirst(session.items, (item, index) =>
    Option.flatMap(Arr.get(places, index), ({ judged, ref }) =>
      judged ? defaultsIssue(item, index, ref) : Option.none(),
    ),
  );
};

/**
 * The session holds a value of exactly the test's declared outcomes, each of its declared base type
 * and cardinality.
 */
const outcomesRule: SessionRule = (session, test) => {
  const declared = test.test.outcomes;
  const undeclared = Arr.findFirst(Object.keys(session.outcomes), (identifier) =>
    declared.has(identifier)
      ? Option.none()
      : Option.some(
          `outcomes holds ${JSON.stringify(identifier)}, which the test does not declare`,
        ),
  );

  return Option.orElse(undeclared, () =>
    Arr.findFirst([...declared], ([identifier, declaration]) => {
      const value = Object.hasOwn(session.outcomes, identifier)
        ? Option.fromUndefinedOr(session.outcomes[identifier])
        : Option.none();

      return Option.match(value, {
        onNone: () =>
          Option.some(
            `outcomes holds no value of the test's outcome ${JSON.stringify(identifier)}`,
          ),
        onSome: ({ baseType, cardinality }) =>
          baseType === declaration.baseType && cardinality === declaration.cardinality
            ? Option.none()
            : Option.some(
                `outcomes.${identifier} is of base type ${baseType} and cardinality ${cardinality}, where the test declares it ${declaration.baseType} and ${declaration.cardinality}`,
              ),
      });
    }),
  );
};

/**
 * The rules a decoded session must meet against its test, in the order they are checked. The
 * session's Schema already holds `outcomeRuns` to a whole number of at least 0.
 */
const sessionRules: readonly SessionRule[] = [
  itemsRule,
  sequenceRule,
  partsRule,
  statusRule,
  instanceRule,
  datesRule,
  positionRule,
  templateDefaultsRule,
  outcomesRule,
];

/**
 * Check a decoded session against the test it belongs to.
 *
 * @param session The decoded session, which names its test.
 * @param test The test.
 * @param version The version the stored session holds.
 * @returns The session, or {@link InvalidSession} at stage `decode` naming the first rule it
 *   breaks.
 */
const fitting = (
  session: TestSession,
  test: SessionTest,
  version: Option.Option<unknown>,
): Result.Result<TestSession, InvalidSession> =>
  Option.match(
    Arr.findFirst(sessionRules, (rule) => rule(session, test)),
    {
      onNone: () => Result.succeed(session),
      onSome: (issue) => Result.fail(new InvalidSession({ issue, stage: "decode", version })),
    },
  );

/**
 * Check a test session the host handed back.
 *
 * The session must be one the renderer wrote for this test: after it names the test and its
 * document, its items are the test's item refs in document order, one per ref, numbered from 1 in
 * order, each record's instance the session's instance, a `.` and the item's sequence index; its
 * parts are the test's parts in order, ended, then at most one current, then pending, and none
 * current once the session is closed; `started`, `updated` and each item's `datestamp` are ISO
 * 8601 UTC instants, `updated` not before `started`; `position` is the index of one of its items,
 * or 0 when it has none; each item of a nonlinear part that has started, current or ended, holds
 * template defaults keyed by exactly the template variables its item ref's defaults set, and none
 * when they set none, where an item of a pending or a linear part is not judged; `outcomes` holds a
 * value of exactly the test's declared outcomes, each of its declared base type and cardinality;
 * and `outcomeRuns` is a whole number of at least 0. The template defaults' values are checked by
 * `present` when it shows the item, against the item's declarations, which `SessionTest` does not
 * hold.
 *
 * @param input The stored session, as the host returned it: the {@link StoredTestSession}
 *   {@link encodeSession} wrote, after any JSON round trip. A session that names no version, or
 *   another version than {@link storedVersion}, is refused before the rest is read.
 * @param test The test the session must belong to: pass the `AcceptedTest` `check` gave.
 * @returns The session; {@link SessionMismatch} when the session names another test or test
 *   document; or {@link InvalidSession} at stage `decode` naming what does not fit, the stored
 *   form or a rule above, with the version found when that is what does not fit.
 */
export const decodeSession = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The host stores the session and hands it back as any value, and this is the check that parses it.
  input: unknown,
  test: SessionTest,
): Result.Result<TestSession, InvalidSession | SessionMismatch> => {
  const version = versionOf(input);

  return Option.match(versionIssue(input), {
    onNone: () =>
      Result.flatMap(
        Result.mapError(
          Schema.decodeUnknownResult(TestSessionSchema)(input),
          (schemaError) =>
            new InvalidSession({ issue: schemaError.message, stage: "decode", version }),
        ),
        (session) =>
          Result.flatMap(belonging(session, test), (owned) => fitting(owned, test, version)),
      ),
    onSome: (issue) => Result.fail(new InvalidSession({ issue, stage: "decode", version })),
  });
};
