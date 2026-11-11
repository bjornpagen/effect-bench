/**
 * The public surface of `@qti-pie/plate`, published through the `exports` map in `package.json`:
 * the functions an author calls, the native-form helpers, their types and their errors.
 *
 * Items: `open` checks a document, `begin` starts an item's stored record, `redact` and `render`
 * show an item, `checkResponses` and `score` take its answers, `solution` gives its correct
 * responses and `restore` reads its stored record back. Packages and tests: `openPackage` checks a
 * content package and `itemRefs` lists a test's item refs; `startTest`, `current`, `itemView`,
 * `permits`, `allowedIntents` and `advance` run a test session, which `encodeSession` and
 * `decodeSession` store; `navigationState` and the intent helpers (`intentName`, `encodeIntent`,
 * `decodeIntent`) are the navigation API, and `renderNavigation` adds plain-button parts over it.
 * `results` writes a Results Reporting document.
 *
 * `open`, `openPackage` and `configure` return Effects. Every other function is plain, callable
 * with no Effect runtime: it returns its value, or a `Result` when a caller can make it fail.
 *
 * Nothing else under `src/` is reachable from outside the package. The tests' seams
 * (`acceptForTest`, `acceptTestForTest`, `acceptSectionForTest`, `acceptStimulusForTest` and
 * `acceptPackageForTest`) and the redacted item's brand constructor (`brandRedacted`) and the
 * predicate that reads its mark are never exported here, so only `check` makes an `Accepted` and
 * the other accepted roots, only `openPackage` makes an `AcceptedPackage`, and only `redact` and
 * `decodeRedacted` make a `Redacted`, which `render` checks at run time too (`NotRedacted`).
 *
 * @module
 */
export { begin } from "#plate/begin.ts";

export type { StoredRecord } from "#plate/codec/record.ts";

export { InvalidRecord } from "#plate/codec/record.ts";

export {
  decodeRedacted,
  encodeRedacted,
  InvalidRedacted,
  type RedactedJson,
} from "#plate/codec/redacted.ts";

export type { StoredTestSession } from "#plate/codec/session.ts";

export {
  decodeSession,
  encodeSession,
  InvalidSession,
  SessionMismatch,
} from "#plate/codec/session.ts";

export type { Configuration } from "#plate/configuration.ts";

export { configure, InvalidConfiguration } from "#plate/configuration.ts";

export type { StatusInput } from "#plate/emit/item.ts";

export type { Attributes, Element, Node, PartFunction, Text } from "#plate/emit/node.ts";

export { h } from "#plate/emit/node.ts";

export type { PartOverrides } from "#plate/emit/parts.ts";

export { UnknownPart } from "#plate/emit/parts.ts";

export type { MarkupRefusal } from "#plate/emit/serialise.ts";

export {
  EscapableRawTextElementChild,
  EventHandlerAttribute,
  MalformedAttributeName,
  MalformedTagName,
  MarkupRefused,
  PlaintextElement,
  RawTextChildren,
  VoidElementChildren,
} from "#plate/emit/serialise.ts";

export { PartSwapRefused } from "#plate/emit/swap.ts";

export type { EngineFailure } from "#plate/engine/evaluate.ts";

export {
  OutcomeMismatchError,
  RecordOperandError,
  UnknownIdentifierError,
  UnmappedResponseError,
} from "#plate/engine/evaluate.ts";

export type {
  Binding,
  DecodeOptions,
  Entry,
  InstanceRequirement,
  Partition,
  PostedBaseType,
  RecordBinding,
  ValueBinding,
} from "#plate/form/encoding.ts";

export {
  checkInstance,
  decode,
  encode,
  entryName,
  isPosted,
  Malformed,
  partition,
} from "#plate/form/encoding.ts";

export { decodeIntent, encodeIntent, intentName } from "#plate/form/intent.ts";

export type { RecordValue, ResponseValue, Value } from "#plate/model/values.ts";

export type {
  NavigationItem,
  NavigationItemState,
  NavigationOptions,
  NavigationPart,
  NavigationState,
} from "#plate/navigation.ts";

export { navigationState, renderNavigation } from "#plate/navigation.ts";

export type {
  AcceptedPackage,
  ItemRefEntry,
  PackageResource,
  PackageTest,
  PackageVerdict,
} from "#plate/package/open.ts";

export { itemRefs, openPackage } from "#plate/package/open.ts";

export type { Posting, Redacted, RenderMode, ValidationMessage } from "#plate/payload.ts";

export { postings } from "#plate/payload.ts";

export type { Options, Rendered } from "#plate/render.ts";

export {
  InvalidHeadingLevel,
  InvalidInstance,
  NotRedacted,
  OutputTooLarge,
  redact,
  render,
  renderStatus,
} from "#plate/render.ts";

export { checkResponses } from "#plate/responses.ts";

export type { Restored } from "#plate/restore.ts";

export { restore } from "#plate/restore.ts";

export type { ResultContext, ResultsInput } from "#plate/results/results.ts";

export { InvalidResultContext, ResultItemMissing, results } from "#plate/results/results.ts";

export {
  InvalidResponses,
  RecordMismatch,
  RecordRequired,
  ResponsesRefused,
  score,
} from "#plate/score.ts";

export type { AdvanceFailure } from "#plate/session/advance.ts";

export { advance, IntentRefused, StepResponseMisfit } from "#plate/session/advance.ts";

export { UnknownItemRef } from "#plate/session/control.ts";

export { allowedIntents } from "#plate/session/intents.ts";

export type {
  Intent,
  Responses,
  SessionItem,
  SessionPart,
  Step,
  TestSession,
} from "#plate/session/session.ts";

export type { Current, ItemView, Permits, SummaryItem, TestSummary } from "#plate/session/start.ts";

export {
  current,
  InvalidSessionInstance,
  InvalidTime,
  ItemNotInSession,
  itemView,
  permits,
  startTest,
  TestNotDeliverable,
} from "#plate/session/start.ts";

export { solution } from "#plate/solution.ts";

export { open } from "#plate/validate/open.ts";

export type {
  Accepted,
  AcceptedSection,
  AcceptedStimulus,
  AcceptedTest,
  Verdict,
} from "#plate/validate/verdict.ts";

export { acceptedItem } from "#plate/validate/verdict.ts";
