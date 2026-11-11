import { regex } from "arkregex"

const WORD = regex("[A-Za-z']+", "g")
const LISTEN_PREFIX = regex("^Listen\\. ")
const DIGIT = regex("[0-9]")
const TERMINATOR = regex("[.!?]", "g")
const CAPITAL_AFTER_LOWER = regex("[a-z,] ([A-Z][a-z']*)", "g")

export const words = (text: string): ReadonlyArray<string> =>
	Array.from(text.matchAll(WORD), (match) => match[0])

export const lower = (word: string) => word.toLowerCase()

/** The spoken "Listen." prefix the authoring format adds to a story's first sentence. */
export const plainText = (text: string) => text.replace(LISTEN_PREFIX, "")

/** Crude inflection stripping so "ducks", "fed", "swimming" resolve to lexicon lemmas. Irregular forms come from the lexicon's `forms`. */
export const stems = (word: string): ReadonlyArray<string> => {
	const base = lower(word).replace("'s", "")
	const forms = new Set([base])
	for (const suffix of ["ies", "es", "s", "ed", "d", "ing", "ly", "er", "est"]) {
		if (!base.endsWith(suffix) || base.length - suffix.length < 3) {
			continue
		}
		const stem = base.slice(0, -suffix.length)
		forms.add(stem)
		if (suffix === "ies") {
			forms.add(`${stem}y`)
		}
		if (suffix === "ing" || suffix === "ed") {
			forms.add(`${stem}e`)
			if (stem.length >= 3 && stem.at(-1) === stem.at(-2)) {
				forms.add(stem.slice(0, -1))
			}
		}
	}
	return Array.from(forms)
}

export const hasDigit = (text: string) => DIGIT.test(text)

/** Count of sentence terminators; a realized sentence must have exactly one. */
export const terminators = (text: string) => Array.from(text.matchAll(TERMINATOR)).length

/** Capitalized words that follow a lowercase word — proper nouns, not sentence starts. */
export const midSentenceCapitals = (text: string): ReadonlyArray<string> =>
	Array.from(text.matchAll(CAPITAL_AFTER_LOWER), (match) => match[1] ?? "")
