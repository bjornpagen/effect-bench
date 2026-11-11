/** Closed word lists the analyzer reads. Function words are not content and need no lexicon entry. */

export const YES_NO_OPENERS: ReadonlySet<string> = new Set([
	"did",
	"is",
	"was",
	"were",
	"does",
	"do",
	"can",
	"are",
	"will",
	"has",
	"have"
])

export const PRONOUNS: ReadonlySet<string> = new Set([
	"he",
	"she",
	"it",
	"they",
	"them",
	"his",
	"her",
	"its",
	"their",
	"him"
])

export const SUBORDINATORS: ReadonlySet<string> = new Set([
	"because",
	"so",
	"when",
	"while",
	"after",
	"before",
	"that",
	"which",
	"until",
	"if"
])

export const ATTITUDE_VERBS: ReadonlySet<string> = new Set([
	"think",
	"thinks",
	"thought",
	"know",
	"knows",
	"knew",
	"believe"
])

/** Words that state a cause inside a sentence; a why-question may target such a sentence literally. */
export const CAUSE_MARKERS: ReadonlySet<string> = new Set([
	"because",
	"so",
	"made",
	"makes",
	"make",
	"to"
])

/** A where-key containing one of these is a phrase, not the place noun RULES §26 asks for. */
export const PLACE_PARTICLES: ReadonlySet<string> = new Set([
	"in",
	"at",
	"on",
	"under",
	"behind",
	"over",
	"next",
	"between",
	"from",
	"to"
])

export const STOPWORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"the",
	"and",
	"but",
	"or",
	"of",
	"to",
	"in",
	"on",
	"at",
	"for",
	"with",
	"from",
	"into",
	"by",
	"is",
	"are",
	"was",
	"were",
	"be",
	"has",
	"have",
	"had",
	"did",
	"do",
	"does",
	"not",
	"no",
	"this",
	"that",
	"these",
	"those",
	"there",
	"then",
	"so",
	"because",
	"very",
	"some",
	"all",
	"every",
	"can",
	"cannot",
	"could",
	"will",
	"it",
	"its",
	"he",
	"she",
	"they",
	"them",
	"his",
	"her",
	"their",
	"him",
	"who",
	"what",
	"where",
	"when",
	"why",
	"how",
	"many",
	"up",
	"down",
	"out",
	"off",
	"too",
	"as",
	"one",
	"two",
	"three",
	"listen"
])

/** Juxtaposed causal steps a passage may contain at each cohesion level. */
export const JUXTAPOSED_CAUSE_BUDGET: Readonly<Record<"high" | "medium" | "low", number>> = {
	high: 0,
	medium: 1,
	low: Number.POSITIVE_INFINITY
}
