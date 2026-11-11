import { regex } from "arkregex"
import { Schema } from "effect"

/**
 * Question forms the curriculum can have made firm. Names follow the Q-strand atoms.
 */
export const FormSchema = Schema.Literals([
	"who",
	"what_did",
	"what_object",
	"what_thing",
	"what_actor",
	"where",
	"where_from",
	"where_to",
	"when",
	"why_because",
	"why_to",
	"how",
	"how_feel",
	"how_many",
	"not",
	"what_mean",
	"first_next_last",
	"main_idea",
	"cant_tell",
	"apply_rule"
])
export type Form = typeof FormSchema.Type

const Positive = Schema.Int.check(Schema.isGreaterThan(0))

/**
 * Curriculum state the passage must respect: everything a T atom may rely on.
 * Words and concepts not listed here and not K-entry must be anchored or pre-taught.
 */
export const BriefSchema = Schema.Struct({
	/** Candidate atom key, `c_t_*`. */
	key: Schema.String.check(Schema.isPattern(regex("^c_t_[a-z0-9_]+$"))),
	/** Curriculum position this passage would sit at (after every atom it relies on). */
	position: Positive,
	objective: Schema.Struct({
		/** The higher-order idea the passage instantiates; the child already holds it (or its class sentence). */
		idea: Schema.NonEmptyString,
		/**
		 * True, specific, interesting propositions the child does not yet know and should hear. This is
		 * what reading is for. Each must be sayable in prior/taught words plus at most one anchored name.
		 */
		newInformation: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
		/** Taught rules the passage may state verbatim (e.g. as the premise of a licensed inference). Empty = never restate. */
		mayRestate: Schema.Array(Schema.NonEmptyString)
	}),
	firmForms: Schema.Array(FormSchema),
	/** V atoms: relation and attribute words already taught. */
	taughtWords: Schema.Array(
		Schema.Struct({ word: Schema.NonEmptyString, atom: Schema.NonEmptyString })
	),
	/** K atoms: class nouns and ideas already taught, with the definition the child heard. */
	taughtConcepts: Schema.Array(
		Schema.Struct({
			concept: Schema.NonEmptyString,
			atom: Schema.NonEmptyString,
			definition: Schema.NonEmptyString
		})
	),
	/** K/L atoms: rules an inference may rely on, with the one direction they entail. */
	taughtRules: Schema.Array(
		Schema.Struct({
			rule: Schema.NonEmptyString,
			atom: Schema.NonEmptyString,
			entails: Schema.NonEmptyString
		})
	),
	/** Child names the course uses. */
	roster: Schema.Array(Schema.NonEmptyString),
	/** Capacity stage from the firm P atoms. */
	stage: Schema.Struct({
		sentences: Positive,
		questions: Positive,
		maxWordsPerSentence: Positive,
		/**
		 * How many new-information items the listener can hold in one passage. Kindergarten runs 1–3;
		 * the range widens with the course. The brief's newInformation length must fall inside it.
		 */
		newItems: Schema.Struct({ min: Positive, max: Positive }),
		/**
		 * Cohesion level: low-knowledge listeners need explicit causal and referential supports.
		 * high = every causal step stated with because/so/to, nouns repeated, no pronouns — the first-read default.
		 * medium = one causal step may be juxtaposed; adjacent single-candidate pronouns allowed.
		 * low = causes may be juxtaposed and pronouns used — a re-read for a child who already holds the idea.
		 */
		cohesion: Schema.Literals(["high", "medium", "low"]),
		orderFree: Schema.Boolean,
		pronounsAllowed: Schema.Boolean,
		requireInference: Schema.Boolean,
		requireMainIdea: Schema.Boolean
	}),
	/** Optional setting or topic steer. */
	setting: Schema.NullOr(Schema.NonEmptyString),
	/** Topics, objects or names to keep out (neighbouring atoms use them). */
	avoid: Schema.Array(Schema.NonEmptyString)
})
export type Brief = typeof BriefSchema.Type
