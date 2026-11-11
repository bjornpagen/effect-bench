/**
 * The one type a refused document carries, and the closed list of rules it may name.
 *
 * A refusal is data, not an error class: the verdict holds it beside the document it judges, and
 * the reader adapter fails with it. The structural validator, the prose rules, the item model, the
 * verdict, the reader adapter and the package reader all produce {@link Refusal}, and no other
 * module defines one, so a caller and a test see one roster, {@link refusalRules}, whichever stage
 * refused. The wording that turns a refusal into a sentence belongs to the verdict.
 *
 * @module
 */
import { Schema } from "effect";

/**
 * Every rule a {@link Refusal} may name, each exactly once.
 *
 * The first eight are the structural validator's (the XSD's elements, attributes and text, and the
 * readings' placements and child counts), the next seven the prose rules' (responses, identifiers,
 * bindings, templates, value types, variables and expression types), then `count-range`, which the
 * structural validator gives for reading 46's count attributes and the item model for the
 * `max-choices` and `min-choices` it reads, then the verdict's `not-qti-root`, then the reader
 * adapter's `not-well-formed`, located by line and column, and `reader-refused`, located at the
 * whole document with the shared reader's own rule in {@link Refusal.readerRule}.
 *
 * The next thirteen are M2's. A test's prose rules give `expression-placement`, an outcome-only
 * expression outside outcome processing (reading 23). The manifest gives `not-qti3-package`, a root
 * outside QTI 3.0's content packaging namespace, `package-profile`, a `schemaversion` other than
 * the two accepted, and `dependency-unresolved`. The file rules give `package-manifest-missing`,
 * `package-path-outside`, `package-file-unlisted` and `package-file-missing`. Opening a package
 * gives `item-ref-unresolved`, `ambiguous-reference`, a dotted reference that two readings
 * resolve, which reading 48 ("a dotted reference is accepted when exactly one reading names a real
 * item ref, test part or section and its variable") refuses, `resource-type-mismatch`, a resource
 * whose document's root is not the one its declared type names, and `lom-identifier` and
 * `lom-title`, an item's or test's identifier or title that its resource's own LOM metadata gives
 * otherwise, which reading 62 ("an item's or test's identifier and title are those its package's
 * LOM metadata gives it") refuses.
 *
 * The next four are align-54's, under the qti package's names: `inclusion-cycle`, a chain of
 * section refs that leads back to a document already on it (reading 85), `branch-target`, a branch
 * rule's target that no branch rule may name (reading 87), `document-lang`, a language an item or
 * test uses that its resource's LOM record does not list (reading 134), and
 * `lom-learning-resource-type`, a LOM `learningResourceType` of `exam` or `self assessment`
 * (reading 122). Every other refusal align-54 adds is an existing rule with a new `check` in its
 * detail.
 *
 * The last, `assembly-limit`, is plate's own stated limit and no rule of QTI: a package whose
 * tests, taken together, place section documents more than 2,048 times, or place more than 4 MiB of
 * them, counting a document once for each placement. Opening a package judges a section document
 * once for each test and context that places it (reading 5, a section document's references
 * "resolve once for each test that includes the section"; reading 145, a fragment a section
 * document splices "is judged in the test that places it, once per placement"), so its cost follows
 * the assembled tests, which a package can make far larger than itself. Its detail names the
 * `bound` passed, `placements` or `bytes`, its `limit`, and the count `reached` when the count
 * stopped. Whether a package is refused never depends on the order of its manifest's resources,
 * since every test's placements count toward one total; which bound the refusal names, and its
 * `reached`, may, since the count stops at the first bound it passes, in the manifest's order of
 * the tests.
 *
 * Adding a rule here is the only way a stage gains a new refusal.
 */
export const refusalRules = [
  "unknown-element",
  "unknown-attribute",
  "missing-attribute",
  "attribute-type",
  "padded-attribute",
  "text-not-allowed",
  "misplaced-element",
  "child-count",
  "undeclared-response",
  "duplicate-identifier",
  "binding",
  "template-requirements",
  "value-type",
  "undeclared-variable",
  "expression-type",
  "count-range",
  "not-qti-root",
  "not-well-formed",
  "reader-refused",
  "expression-placement",
  "not-qti3-package",
  "package-profile",
  "package-manifest-missing",
  "package-path-outside",
  "package-file-unlisted",
  "package-file-missing",
  "dependency-unresolved",
  "item-ref-unresolved",
  "ambiguous-reference",
  "resource-type-mismatch",
  "lom-identifier",
  "lom-title",
  "inclusion-cycle",
  "branch-target",
  "document-lang",
  "lom-learning-resource-type",
  "assembly-limit",
] as const;

/**
 * The Schema of one of {@link refusalRules}, which refuses any other string when decoding.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `RefusalRule` is the Schema and the type of a rule under one name, the interface the phase's slice list fixes, so a decoder and a signature read as one thing.
export const RefusalRule = Schema.Literals(refusalRules);

/**
 * A rule a {@link Refusal} names, one of {@link refusalRules}.
 */
export type RefusalRule = typeof RefusalRule.Type;

/**
 * The Schema of where in a document a refusal points.
 *
 * `path` is an element or attribute path as the source view spells it (`qti-assessment-item/
 * qti-item-body/qti-choice-interaction`, `…/@identifier`). `position` is the line and column the
 * shared reader reported, which only a document that is not well-formed has, because the reader
 * keeps no positions on the elements it builds. `document` points at the whole document, for a
 * refusal no part of the document owns.
 */
// oxlint-disable-next-line eslint/no-redeclare -- `Location` is the Schema and the type of a location under one name, the interface the phase's slice list fixes, so a decoder and a signature read as one thing.
export const Location = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("path"), path: Schema.String }),
  Schema.Struct({ column: Schema.Int, kind: Schema.Literal("position"), line: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("document") }),
]);

/**
 * Where in a document a refusal points: an element or attribute path, a line and column, or the
 * whole document.
 */
export type Location = typeof Location.Type;

/**
 * A document the renderer will not render, with the rule it breaks and where.
 *
 * `document` is the location the caller gave the document. `suggestion` is the nearest known name
 * from the table of misspellings, set only when that table has one. `readerRule` is the shared
 * reader's own rule name, set only for `reader-refused`. `detail` holds the facts the verdict's
 * wording needs, keyed by name, so a test asserts `rule`, `location`, `suggestion` and
 * `readerRule`, never the sentence.
 */
export class Refusal extends Schema.TaggedClass<Refusal>()("Refusal", {
  detail: Schema.Record(Schema.String, Schema.String),
  document: Schema.String,
  location: Location,
  readerRule: Schema.Option(Schema.String),
  rule: RefusalRule,
  suggestion: Schema.Option(Schema.String),
}) {}
