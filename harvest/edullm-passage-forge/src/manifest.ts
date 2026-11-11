import { Schema } from "effect"
import { FormSchema } from "#brief.ts"

/** Admissibility outcome for one lexical item. */
const AdmitSchema = Schema.Literals(["prior", "taught", "anchored", "preteach", "forbidden"])

const TierSchema = Schema.Literals(["core", "extended", "peripheral"])
const DiscourseSchema = Schema.Literals([
	"BACKGROUND",
	"SEQUENCE",
	"RESULT",
	"ELABORATION",
	"CONTRAST",
	"CONDITION"
])
export const RoleSchema = Schema.Literals(["must", "form_practice", "inference", "main_idea"])

const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/**
 * The spec manifest the model produces before any prose: every word it intends to use with its
 * admissibility, the proposition skeleton per sentence, and the question plan. The analyzer
 * gates this before realization and again after.
 */
export const ManifestSchema = Schema.Struct({
	objective: Schema.Struct({
		idea: Schema.NonEmptyString,
		/** The brief's newInformation items, each mapped to the proposition id(s) that carry it. */
		newInformation: Schema.Array(
			Schema.Struct({
				item: Schema.NonEmptyString,
				propositions: Schema.Array(Schema.NonEmptyString)
			})
		),
		/** The level-1 macroproposition, written before the sentences: "who + what they did". */
		mainIdeaSentence: Schema.NonEmptyString,
		/** Lexicon lemmas that carry the point of the passage; each should recur in ≥3 sentences. */
		coreConcepts: Schema.Array(Schema.NonEmptyString)
	}),
	/** Every content word (noun, verb, adjective, adverb, relation) the passage and questions will use. */
	lexicon: Schema.Array(
		Schema.Struct({
			lemma: Schema.NonEmptyString,
			/** Every inflected surface form the sentences or keys may use (ducks, fed, grew, sat). */
			forms: Schema.Array(Schema.NonEmptyString),
			kind: Schema.Literals(["concept", "predicate", "relation", "attribute", "time"]),
			admit: AdmitSchema,
			/** Which atom, bank tier, or anchor sentence licenses it. */
			justification: Schema.NonEmptyString,
			/** For `anchored`: the sentence index whose IS-A / HAS / LIVES-IN sentence anchors it. */
			anchorSentence: Schema.NullOr(Index)
		})
	),
	sentences: Schema.Array(
		Schema.Struct({
			index: Index,
			/** Frame (picture) this sentence belongs to; frames hold one or two consecutive sentences. */
			frame: Index,
			/** What ONE sentence will assert, as a gloss — not final prose. Two clauses = two indices. */
			intent: Schema.NonEmptyString,
			/** Every sentence asserts something; a placeholder or "guard" entry is not a sentence. */
			propositions: Schema.Array(
				Schema.Struct({
					id: Schema.NonEmptyString,
					predicate: Schema.NonEmptyString,
					args: Schema.Array(
						Schema.Struct({ role: Schema.NonEmptyString, value: Schema.NonEmptyString })
					),
					ops: Schema.Array(Schema.Literals(["NEG", "MODAL", "COND", "TIME", "QUANT", "ATTRIB"])),
					/** Proposition id this one fills a slot of, if embedded. */
					embeddedIn: Schema.NullOr(Schema.NonEmptyString),
					/**
					 * reveal = new to the child (from newInformation or the story's events);
					 * known = the child already has it: derivable from a taught atom, common knowledge,
					 *         or a sentence earlier in this same passage;
					 * restate = a TAUGHT RULE from the brief said again verbatim (only if mayRestate lists it).
					 *           Repeating this passage's own earlier sentence is `known`, not `restate`.
					 */
					status: Schema.Literals(["reveal", "known", "restate"])
				})
			).check(Schema.isMinLength(1)),
			/** Every content lemma this sentence will use (nouns, verbs, attributes, relations, time words). */
			lemmas: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
			/** Lemmas first mentioned in this sentence. */
			newConcepts: Schema.Array(Schema.NonEmptyString),
			/** Lemma shared with the previous sentence (referential coherence); null only for sentence 1. */
			sharedWithPrevious: Schema.NullOr(Schema.NonEmptyString),
			discourse: DiscourseSchema,
			onCausalChain: Schema.Boolean,
			/** Whether a causal link into this sentence is stated (because/so/made) rather than juxtaposed. */
			causeStated: Schema.NullOr(Schema.Boolean),
			/** For a RESULT sentence only: the earlier sentence that causes it. Null for every other discourse label. */
			causeFrom: Schema.NullOr(Index),
			tier: TierSchema,
			level: Index,
			/** What the picture for this sentence shows — who, what, where, state. */
			imageIntent: Schema.NonEmptyString
		})
	),
	questions: Schema.Array(
		Schema.Struct({
			form: FormSchema,
			targetSentence: Index,
			targetProposition: Schema.NonEmptyString,
			role: RoleSchema,
			/** For inference: the taught rule relied on, verbatim from the brief. */
			rule: Schema.NullOr(Schema.NonEmptyString),
			/** Why this target: which slot the form extracts and why it is central. */
			rationale: Schema.NonEmptyString
		})
	),
	/** Anything the planner judged risky and how it decided. */
	risks: Schema.Array(Schema.NonEmptyString)
})
export type Manifest = typeof ManifestSchema.Type
