import { regex } from "arkregex"
import { Schema } from "effect"
import { FormSchema } from "#brief.ts"
import { RoleSchema } from "#manifest.ts"

const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/** One surface reference inside a sentence, so pronoun and overlap checks are mechanical. */
const MentionSchema = Schema.Struct({
	/** Exact substring of the sentence. */
	surface: Schema.NonEmptyString,
	/** Lexicon lemma of the head noun. */
	lemma: Schema.NonEmptyString,
	/** Lexicon lemma of a possessor inside the phrase ("the seed's root" → seed), else null. */
	possessor: Schema.NullOr(Schema.NonEmptyString),
	kind: Schema.Literals(["np", "pronoun", "there"])
})

/**
 * The realized passage: frames of one or two sentences, each frame with its own picture, then
 * the questions with keys. Mirrors the authoring frame schema in scripts_v2_stories.py.
 */
export const RealizedSchema = Schema.Struct({
	frames: Schema.Array(
		Schema.Struct({
			sentences: Schema.Array(
				Schema.Struct({
					index: Index,
					text: Schema.NonEmptyString,
					mentions: Schema.Array(MentionSchema)
				})
			),
			/** Kebab-case image slug prefixed with the atom's short code. */
			imageId: Schema.String.check(Schema.isPattern(regex("^[a-z0-9]+(-[a-z0-9]+)+$"))),
			/** Illustrator brief: who and what is in the picture, where, in what state. Never leaks an unasked answer. */
			imageDescription: Schema.NonEmptyString
		})
	),
	questions: Schema.Array(
		Schema.Struct({
			form: FormSchema,
			text: Schema.NonEmptyString,
			/** The accepted answer in the form's key shape (05 §2): the slot, as the text said it. */
			key: Schema.NonEmptyString,
			/** Other acceptable phrasings of the same slot. */
			alsoAccepted: Schema.Array(Schema.NonEmptyString),
			targetSentence: Index,
			role: RoleSchema
		})
	)
})
export type Realized = typeof RealizedSchema.Type
