/**
 * The opt-in Effect surface of `@qti-pie/plate`, published as `@qti-pie/plate/effect` through the
 * `exports` map in `package.json`, so one import serves a server module that runs Effect.
 *
 * It holds the public surface of `.` under the same names, with each function that returns a
 * `Result` (and `acceptedItem`, which returns an `Option`) replaced by its Effect version:
 * `render`, `renderStatus`, `renderNavigation`, `current`, `itemView`, `redact` and
 * `checkResponses` read the {@link Configuration} service in place of a configuration argument;
 * `begin`, `startTest`, `advance` and `results` take time from `Clock` and draw an absent seed
 * through {@link Randomness}; the rest lift the plain call's `Result` unchanged. Each mirror calls
 * its plain function, so a given input succeeds and fails as it does from `.`. `open`,
 * `openPackage` and `configure` already return Effects, and the functions that cannot fail are the
 * plain ones, so all of these are the same values `.` exports. Beside them are the service and its
 * layers ({@link ConfigurationFromEnv}, {@link configurationLayer}), {@link Randomness} and its
 * draws, the stored forms' Schemas and their JSON Schema documents, {@link Refused} and
 * {@link PlateError}.
 *
 * One name of `.` means something else here: `Configuration` is the service, not the plain settings
 * type. A host names that type as the service's shape, `(typeof Configuration)["Service"]`, equally
 * as `typeof ConfigurationSchema.Type`, or imports it from `.`.
 *
 * Nothing under `src/` imports this module, and no browser module reaches it: a host that does not
 * import `./effect` loads none of it.
 *
 * @module
 */
export {
  Configuration,
  ConfigurationFromEnv,
  configurationLayer,
} from "#plate/effect/configuration.ts";

export type { PlateError } from "#plate/effect/operations.ts";

export {
  acceptedItem,
  allowedIntents,
  checkResponses,
  current,
  decode,
  decodeRedacted,
  decodeSession,
  encodeRedacted,
  encodeSession,
  itemView,
  navigationState,
  permits,
  redact,
  Refused,
  render,
  renderNavigation,
  renderStatus,
  restore,
  score,
} from "#plate/effect/operations.ts";

export { drawnInstance, drawnSeed, Randomness } from "#plate/effect/randomness.ts";

export {
  ConfigurationJsonSchema,
  ConfigurationSchema,
  RedactedJsonJsonSchema,
  RedactedJsonSchema,
  RefusalJsonSchema,
  RefusalSchema,
  StoredRecordJsonSchema,
  StoredRecordSchema,
  StoredTestSessionJsonSchema,
  StoredTestSessionSchema,
} from "#plate/effect/schemas.ts";

export { advance, begin, results, startTest } from "#plate/effect/session.ts";

export type {
  Accepted,
  AcceptedPackage,
  AcceptedSection,
  AcceptedStimulus,
  AcceptedTest,
  AdvanceFailure,
  Attributes,
  Binding,
  Current,
  DecodeOptions,
  Element,
  EngineFailure,
  Entry,
  InstanceRequirement,
  Intent,
  ItemRefEntry,
  ItemView,
  MarkupRefusal,
  NavigationItem,
  NavigationItemState,
  NavigationOptions,
  NavigationPart,
  NavigationState,
  Node,
  Options,
  PackageResource,
  PackageTest,
  PackageVerdict,
  PartFunction,
  PartOverrides,
  Partition,
  Permits,
  PostedBaseType,
  Posting,
  RecordBinding,
  RecordValue,
  Redacted,
  RedactedJson,
  Rendered,
  RenderMode,
  Responses,
  ResponseValue,
  Restored,
  ResultContext,
  ResultsInput,
  SessionItem,
  SessionPart,
  StatusInput,
  Step,
  StoredRecord,
  StoredTestSession,
  SummaryItem,
  TestSession,
  TestSummary,
  Text,
  ValidationMessage,
  Value,
  ValueBinding,
  Verdict,
} from "#plate/index.ts";

export {
  checkInstance,
  configure,
  decodeIntent,
  encode,
  encodeIntent,
  entryName,
  EscapableRawTextElementChild,
  EventHandlerAttribute,
  h,
  intentName,
  IntentRefused,
  InvalidConfiguration,
  InvalidHeadingLevel,
  InvalidInstance,
  InvalidRecord,
  InvalidRedacted,
  InvalidResponses,
  InvalidResultContext,
  InvalidSession,
  InvalidSessionInstance,
  InvalidTime,
  isPosted,
  ItemNotInSession,
  itemRefs,
  Malformed,
  MalformedAttributeName,
  MalformedTagName,
  MarkupRefused,
  NotRedacted,
  open,
  openPackage,
  OutcomeMismatchError,
  OutputTooLarge,
  partition,
  PartSwapRefused,
  PlaintextElement,
  postings,
  RawTextChildren,
  RecordMismatch,
  RecordOperandError,
  RecordRequired,
  ResponsesRefused,
  ResultItemMissing,
  SessionMismatch,
  solution,
  StepResponseMisfit,
  TestNotDeliverable,
  UnknownIdentifierError,
  UnknownItemRef,
  UnknownPart,
  UnmappedResponseError,
  VoidElementChildren,
} from "#plate/index.ts";
