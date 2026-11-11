import type { Brief, Form } from "#brief.ts"
import type { Manifest } from "#manifest.ts"
import type { Realized } from "#realized.ts"
import {
	hasDigit,
	lower,
	midSentenceCapitals,
	plainText,
	stems,
	terminators,
	words
} from "#text.ts"

import {
	ATTITUDE_VERBS,
	CAUSE_MARKERS,
	JUXTAPOSED_CAUSE_BUDGET,
	PLACE_PARTICLES,
	PRONOUNS,
	STOPWORDS,
	SUBORDINATORS,
	YES_NO_OPENERS
} from "#vocabulary.ts"

/**
 * Deterministic checks over the passage object.
 * Gates fail the passage; flags are read by a human. Nothing here calls a model.
 */
export type Finding = {
	readonly code: string
	readonly severity: "gate" | "flag"
	readonly detail: string
	readonly sentence: number | null
}

type Measures = {
	readonly sentences: number
	readonly words: number
	readonly wordsPerSentence: ReadonlyArray<number>
	readonly propositions: number
	readonly propositionsPerSentence: ReadonlyArray<number>
	readonly concepts: number
	readonly mentions: number
	readonly repeats: number
	readonly newConceptsPerSentence: ReadonlyArray<number>
	readonly pronouns: number
	readonly chainSentences: ReadonlyArray<number>
	readonly statedCauses: number
	readonly juxtaposedCauses: number
	readonly forms: ReadonlyArray<Form>
	readonly anchored: ReadonlyArray<string>
	readonly preteach: ReadonlyArray<string>
	readonly forbidden: ReadonlyArray<string>
}

export type Report = {
	readonly status: "pass" | "fail"
	readonly gates: ReadonlyArray<Finding>
	readonly flags: ReadonlyArray<Finding>
	readonly measures: Measures
}

type Sentence = Realized["frames"][number]["sentences"][number]
type Question = Realized["questions"][number]

/** Everything the checks read, built once. */
type Context = {
	readonly brief: Brief
	readonly manifest: Manifest
	readonly realized: Realized
	readonly sentences: ReadonlyArray<Sentence>
	readonly lexiconLemmas: ReadonlySet<string>
	readonly lexiconForms: ReadonlySet<string>
	readonly taughtWords: ReadonlySet<string>
	readonly taughtConcepts: ReadonlySet<string>
	readonly roster: ReadonlySet<string>
	readonly passageStems: ReadonlySet<string>
}

const gate = (code: string, detail: string, sentence: number | null = null): Finding => ({
	code,
	severity: "gate",
	detail,
	sentence
})

const flag = (code: string, detail: string, sentence: number | null = null): Finding => ({
	code,
	severity: "flag",
	detail,
	sentence
})

const buildContext = (brief: Brief, manifest: Manifest, realized: Realized): Context => {
	const sentences = realized.frames
		.flatMap((frame) => frame.sentences)
		.toSorted((a, b) => a.index - b.index)
	return {
		brief,
		manifest,
		realized,
		sentences,
		lexiconLemmas: new Set(manifest.lexicon.map((entry) => lower(entry.lemma))),
		lexiconForms: new Set(
			manifest.lexicon.flatMap((entry) =>
				[entry.lemma, ...entry.forms].flatMap((form) => words(form).map(lower))
			)
		),
		taughtWords: new Set(brief.taughtWords.flatMap((entry) => words(entry.word).map(lower))),
		taughtConcepts: new Set(brief.taughtConcepts.map((entry) => lower(entry.concept))),
		roster: new Set(brief.roster.map(lower)),
		passageStems: new Set(sentences.flatMap((s) => words(plainText(s.text)).flatMap(stems)))
	}
}

const previousOf = (context: Context, sentence: Sentence): Sentence | undefined => {
	const position = context.sentences.indexOf(sentence)
	return position > 0 ? context.sentences[position - 1] : undefined
}

const npLemmas = (sentence: Sentence) =>
	sentence.mentions.filter((m) => m.kind === "np").map((m) => lower(m.lemma))

/** Noun lemmas that count as concepts: roster names are prior and carry no load. */
const conceptLemmas = (context: Context, sentence: Sentence) =>
	npLemmas(sentence).filter((lemma) => !context.roster.has(lemma))

const resolvesToLexicon = (context: Context, token: string) =>
	stems(token).some(
		(stem) =>
			context.lexiconLemmas.has(stem) ||
			context.lexiconForms.has(stem) ||
			context.taughtWords.has(stem) ||
			context.taughtConcepts.has(stem)
	)

// ── Lexicon ─────────────────────────────────────────────────────────────────────────────────────
const checkLexicon = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { manifest, brief } = context
	const anchored = manifest.lexicon.filter((entry) => entry.admit === "anchored")
	if (anchored.length > 1) {
		findings.push(gate("VOCAB.ANCHORED.MANY", anchored.map((e) => e.lemma).join(", ")))
	}
	for (const entry of anchored.filter((entry) => entry.anchorSentence === null)) {
		findings.push(gate("VOCAB.ANCHOR.MISSING", `${entry.lemma} names no anchor sentence`))
	}
	for (const entry of manifest.lexicon.filter((entry) => entry.admit === "forbidden")) {
		findings.push(gate("VOCAB.FORBIDDEN", `${entry.lemma}: ${entry.justification}`))
	}
	for (const entry of manifest.lexicon.filter((entry) => entry.admit === "preteach")) {
		findings.push(
			gate("VOCAB.PRETEACH", `${entry.lemma} needs an atom first: ${entry.justification}`)
		)
	}
	for (const entry of manifest.lexicon.filter((entry) => entry.admit === "taught")) {
		const lemma = lower(entry.lemma)
		const taughtByAtom =
			context.taughtConcepts.has(lemma) ||
			words(lemma).every((token) => context.taughtWords.has(token)) ||
			brief.taughtWords.some((taught) => lower(taught.word) === lemma)
		if (!taughtByAtom) {
			findings.push(
				gate("VOCAB.TAUGHT.UNLISTED", `${entry.lemma}: no V/K atom in the brief teaches it`)
			)
		}
	}
	return findings
}

const checkUndeclaredVocabulary = (context: Context): Finding[] => {
	const undeclared = new Set<string>()
	for (const sentence of context.sentences) {
		for (const token of words(plainText(sentence.text))) {
			const low = lower(token)
			const isName = context.roster.has(low.replace("'s", ""))
			if (!STOPWORDS.has(low) && !isName && !resolvesToLexicon(context, token)) {
				undeclared.add(low)
			}
		}
	}
	return undeclared.size === 0
		? []
		: [
				gate(
					"VOCAB.UNDECLARED",
					`words with no lexicon entry: ${Array.from(undeclared).join(", ")}`
				)
			]
}

const checkAvoidList = (context: Context): Finding[] =>
	context.brief.avoid
		.filter((avoid) =>
			context.sentences.some((s) => words(s.text).map(lower).includes(lower(avoid)))
		)
		.map((avoid) => gate("CONTENT.AVOID", `"${avoid}" is on the avoid list`))

// ── Sentences ───────────────────────────────────────────────────────────────────────────────────
const checkCounts = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { sentences, brief, manifest } = context
	if (sentences.length !== brief.stage.sentences) {
		findings.push(
			gate(
				"LENGTH.SENTENCES",
				`${sentences.length} sentences; stage allows ${brief.stage.sentences}`
			)
		)
	}
	if (manifest.sentences.length !== sentences.length) {
		findings.push(
			gate(
				"PLAN.SENTENCES",
				`manifest plans ${manifest.sentences.length}, realized ${sentences.length}`
			)
		)
	}
	return findings
}

const checkSentenceForm = (context: Context, sentence: Sentence): Finding[] => {
	const findings: Finding[] = []
	const text = plainText(sentence.text)
	const tokens = words(text)
	const low = tokens.map(lower)
	if (tokens.length > context.brief.stage.maxWordsPerSentence) {
		findings.push(
			gate(
				"LENGTH.WORDS",
				`${tokens.length} words > ${context.brief.stage.maxWordsPerSentence}: "${text}"`,
				sentence.index
			)
		)
	}
	if (hasDigit(text)) {
		findings.push(gate("CONTENT.DIGIT", `numeral in "${text}"`, sentence.index))
	}
	if (terminators(text) !== 1) {
		findings.push(
			gate(
				"SENTENCE.PACKED",
				`${terminators(text)} sentence terminators in one index: "${text}" — the plan must give each sentence its own index`,
				sentence.index
			)
		)
	}
	if (low.some((t) => ATTITUDE_VERBS.has(t))) {
		findings.push(gate("CONSTR.ATTITUDE", "think/know complement before its atom", sentence.index))
	}
	if (low.includes("if")) {
		findings.push(gate("CONSTR.IF", "conditional before its atom", sentence.index))
	}
	const subordinators = low.filter((t) => SUBORDINATORS.has(t))
	if (subordinators.length > 1) {
		findings.push(
			gate("EMBED.STACKED", `${subordinators.join(", ")} in one sentence`, sentence.index)
		)
	}
	for (const token of midSentenceCapitals(text)) {
		if (!context.roster.has(lower(token))) {
			findings.push(
				flag(
					"CONTENT.PROPER",
					`capitalized "${token}" mid-sentence is not a roster name`,
					sentence.index
				)
			)
		}
	}
	const planned = context.manifest.sentences.find((s) => s.index === sentence.index)
	if (planned !== undefined && planned.propositions.length > 3) {
		findings.push(
			flag(
				"LOAD.PROPOSITIONS",
				`${planned.propositions.length} propositions planned`,
				sentence.index
			)
		)
	}
	return findings
}

const checkMentions = (context: Context, sentence: Sentence): Finding[] => {
	const findings: Finding[] = []
	const text = plainText(sentence.text)
	for (const mention of sentence.mentions) {
		if (!text.includes(mention.surface)) {
			findings.push(
				gate("MENTION.SURFACE", `"${mention.surface}" is not in "${text}"`, sentence.index)
			)
		}
		if (
			!context.lexiconLemmas.has(lower(mention.lemma)) &&
			!context.roster.has(lower(mention.lemma))
		) {
			findings.push(
				gate("MENTION.LEMMA", `lemma "${mention.lemma}" is not in the lexicon`, sentence.index)
			)
		}
	}
	for (const token of words(text).map(lower)) {
		if (PRONOUNS.has(token) && !sentence.mentions.some((m) => lower(m.surface) === token)) {
			findings.push(
				gate(
					"MENTION.PRONOUN.UNDECLARED",
					`pronoun "${token}" has no mention record`,
					sentence.index
				)
			)
		}
	}
	return findings
}

const checkReference = (context: Context, sentence: Sentence): Finding[] => {
	const findings: Finding[] = []
	const previous = previousOf(context, sentence)
	const anaphors = sentence.mentions.filter((m) => m.kind === "pronoun" || m.kind === "there")
	for (const mention of anaphors) {
		if (previous === undefined) {
			findings.push(
				gate("REF.NO_ANTECEDENT", `"${mention.surface}" in the first sentence`, sentence.index)
			)
			continue
		}
		const previousNp = previous.mentions.filter((m) => m.kind === "np")
		if (!previousNp.some((m) => lower(m.lemma) === lower(mention.lemma))) {
			findings.push(
				gate(
					"REF.DISTANT",
					`"${mention.surface}" → ${mention.lemma}: no noun in the previous sentence`,
					sentence.index
				)
			)
		}
		if (mention.kind === "pronoun" && !context.brief.stage.pronounsAllowed) {
			findings.push(
				flag(
					"REF.PRONOUN",
					`pronoun "${mention.surface}" before the pronoun atom is firm — prefer the noun`,
					sentence.index
				)
			)
			if (previousNp.length >= 2) {
				findings.push(
					flag(
						"REF.CANDIDATES",
						`"${mention.surface}" follows ${previousNp.length} nouns (${previousNp.map((m) => m.lemma).join(", ")})`,
						sentence.index
					)
				)
			}
		}
	}
	return findings
}

/** Referential coherence: each sentence repeats a noun from the one before (02 §3; 04 rule 8). */
const checkOverlap = (context: Context, sentence: Sentence): Finding[] => {
	const findings: Finding[] = []
	const previous = previousOf(context, sentence)
	if (previous !== undefined) {
		const lemmasOf = (s: Sentence) =>
			new Set(
				s.mentions.flatMap((m) =>
					m.possessor === null ? [lower(m.lemma)] : [lower(m.lemma), lower(m.possessor)]
				)
			)
		const sharesWith = (other: Sentence) => {
			const theirs = lemmasOf(other)
			return Array.from(lemmasOf(sentence)).some((lemma) => theirs.has(lemma))
		}
		if (!sharesWith(previous)) {
			const beforePrevious = previousOf(context, previous)
			const planned = context.manifest.sentences.find((s) => s.index === sentence.index)
			const linkedByCause = planned?.causeFrom === previous.index && planned.causeStated === true
			// Fletcher & Bloom: ~two sentences stay in the buffer; a stated connective to s−1 plus a
			// noun shared with s−2 keeps the thread, but the low-knowledge default is the adjacent noun.
			if (beforePrevious !== undefined && sharesWith(beforePrevious) && linkedByCause) {
				findings.push(
					flag(
						"REF.BUFFER",
						"no noun shared with the previous sentence; the link rides on the connective and a noun two sentences back — repeat the noun for a first read",
						sentence.index
					)
				)
			} else {
				findings.push(
					gate("REF.GAP", "no concept shared with the previous sentence", sentence.index)
				)
			}
		}
	}
	return findings
}

const checkConceptLoad = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const seen = new Set<string>()
	for (const sentence of context.sentences) {
		let fresh = 0
		for (const lemma of conceptLemmas(context, sentence)) {
			if (!seen.has(lemma)) {
				fresh += 1
				seen.add(lemma)
			}
		}
		if (fresh >= 3) {
			findings.push(flag("LOAD.CONCEPTS", `${fresh} concepts first appear here`, sentence.index))
		}
	}
	return findings
}

const checkFrames = (context: Context): Finding[] => {
	const findings: Finding[] = []
	context.realized.frames.forEach((frame, index) => {
		if (frame.sentences.length === 0 || frame.sentences.length > 2) {
			findings.push(
				gate("FRAME.SIZE", `frame ${index + 1} has ${frame.sentences.length} sentences`)
			)
		}
	})
	context.realized.frames.forEach((frame, index) => {
		const plannedFrames = new Set(
			frame.sentences.map(
				(sentence) => context.manifest.sentences.find((s) => s.index === sentence.index)?.frame
			)
		)
		if (plannedFrames.size !== 1) {
			findings.push(
				gate("FRAME.PLAN", `frame ${index + 1} groups sentences the plan put in different frames`)
			)
		}
	})
	const ids = context.realized.frames.map((f) => f.imageId)
	if (new Set(ids).size !== ids.length) {
		findings.push(gate("FRAME.IMAGE.DUPLICATE", "image ids repeat"))
	}
	return findings
}

// ── Chain and gist ──────────────────────────────────────────────────────────────────────────────
const formsOf = (context: Context, lemma: string): ReadonlySet<string> => {
	const entry = context.manifest.lexicon.find((candidate) => lower(candidate.lemma) === lemma)
	return new Set([lemma, ...(entry === undefined ? [] : entry.forms.map(lower))])
}

const sentenceHasLemma = (context: Context, sentence: Sentence, lemma: string) => {
	const surfaces = formsOf(context, lemma)
	return (
		sentence.mentions.some((m) => lower(m.lemma) === lemma) ||
		words(plainText(sentence.text)).some(
			(w) => surfaces.has(lower(w)) || stems(w).some((stem) => surfaces.has(stem))
		)
	)
}

type Proposition = Manifest["sentences"][number]["propositions"][number]

/**
 * The model's `restate` label is not evidence. A restatement is a proposition whose content words
 * all come from a taught rule or definition; repeating this passage's own earlier sentence is not one.
 */
const restatesTaughtRule = (brief: Brief, proposition: Proposition): boolean => {
	const ruleStems = new Set(
		[...brief.taughtRules.map((r) => r.rule), ...brief.taughtConcepts.map((c) => c.definition)]
			.flatMap((text) => words(text).map(lower))
			.filter((w) => !STOPWORDS.has(w))
			.flatMap(stems)
	)
	const content = [proposition.predicate, ...proposition.args.map((a) => a.value)]
		.flatMap((text) => words(text).map(lower))
		.filter((w) => !STOPWORDS.has(w))
	const hits = content.filter((w) => stems(w).some((stem) => ruleStems.has(stem))).length
	return content.length >= 2 && hits === content.length
}

/** The passage must teach: every newInformation item is carried, and no taught rule is restated uninvited. */
const checkNewInformation = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { manifest, brief } = context
	const propositionIds = new Set(manifest.sentences.flatMap((s) => s.propositions.map((p) => p.id)))
	const reveals = manifest.sentences.flatMap((s) =>
		s.propositions.filter((p) => p.status === "reveal")
	)
	if (reveals.length === 0) {
		findings.push(gate("INFO.NONE", "no proposition is marked reveal; the passage teaches nothing"))
	}
	for (const item of brief.objective.newInformation) {
		const mapped = manifest.objective.newInformation.find((entry) => entry.item === item)
		const carried = (mapped?.propositions ?? []).some((id) => propositionIds.has(id))
		if (!carried) {
			findings.push(
				gate("INFO.MISSING", `new information not carried by any proposition: "${item}"`)
			)
		}
	}
	const restated = manifest.sentences.filter((s) =>
		s.propositions.some((p) => p.status === "restate" && restatesTaughtRule(brief, p))
	)
	if (brief.objective.mayRestate.length === 0 && restated.length > 0) {
		findings.push(
			gate(
				"INFO.RESTATED",
				`sentence(s) ${restated.map((s) => s.index).join(", ")} restate a taught rule; the brief allows none`
			)
		)
	}
	return findings
}

const hasCauseMarker = (sentence: Sentence) =>
	words(plainText(sentence.text))
		.map(lower)
		.some((w) => CAUSE_MARKERS.has(w))

/**
 * Causal steps read from the text, not the manifest's label. A step is causal when the plan marks
 * the sentence RESULT or names a causeFrom; sequence and elaboration steps owe no connective.
 * A causal step is stated iff the sentence, or the sentence it follows, carries because / so / to / made.
 */
const causalSteps = (
	context: Context
): { readonly stated: number[]; readonly juxtaposed: number[] } => {
	const stated: number[] = []
	const juxtaposed: number[] = []
	const causal = context.manifest.sentences.filter((s) => s.discourse === "RESULT")
	for (const planned of causal) {
		const sentence = context.sentences.find((s) => s.index === planned.index)
		if (sentence === undefined) {
			continue
		}
		const source = context.sentences.find((s) => s.index === planned.causeFrom)
		const previous = previousOf(context, sentence)
		const marked =
			hasCauseMarker(sentence) ||
			(source !== undefined && hasCauseMarker(source)) ||
			(previous !== undefined && hasCauseMarker(previous))
		if (marked) {
			stated.push(planned.index)
		} else {
			juxtaposed.push(planned.index)
		}
	}
	return { stated, juxtaposed }
}

/** The cohesion dial: how many causal steps may go unstated, and whether pronouns are lawful. */
const checkCohesion = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const level = context.brief.stage.cohesion
	const { juxtaposed } = causalSteps(context)
	const budget = JUXTAPOSED_CAUSE_BUDGET[level]
	if (juxtaposed.length > budget) {
		findings.push(
			gate(
				"CAUSE.BUDGET",
				`${juxtaposed.length} causal step(s) unstated (sentences ${juxtaposed.join(", ")}); cohesion "${level}" allows ${budget}`
			)
		)
	}
	const pronouns = context.sentences.flatMap((s) =>
		s.mentions.filter((m) => m.kind === "pronoun").map(() => s.index)
	)
	if (level === "high" && pronouns.length > 0) {
		findings.push(
			gate(
				"REF.PRONOUN.HIGH",
				`pronoun(s) in sentence(s) ${pronouns.join(", ")}; cohesion "high" repeats the noun`
			)
		)
	}
	return findings
}

/** A sentence that neither reveals, sets up the chain, nor opens the passage exists only to host a word. */
const checkFiller = (context: Context): Finding[] =>
	context.manifest.sentences
		.filter(
			(s) =>
				s.index !== 1 &&
				!s.onCausalChain &&
				s.discourse !== "BACKGROUND" &&
				s.propositions.every((p) => p.status !== "reveal")
		)
		.map((s) =>
			flag(
				"CONTENT.FILLER",
				`carries no new information and is off the chain: "${s.intent}"`,
				s.index
			)
		)

const checkGist = (context: Context): Finding[] => {
	const findings: Finding[] = []
	for (const lemma of new Set(context.manifest.objective.coreConcepts.map(lower))) {
		const count = context.sentences.filter((s) => sentenceHasLemma(context, s, lemma)).length
		if (count < 3) {
			findings.push(
				flag(
					"CORE.REPETITION",
					`core concept "${lemma}" appears in ${count} sentences; recall improves at ≥3`
				)
			)
		}
	}
	const decoration = context.manifest.sentences.filter(
		(s) => !s.onCausalChain && s.discourse !== "BACKGROUND"
	)
	if (decoration.length > 1) {
		findings.push(
			flag(
				"CONTENT.DECORATION",
				`${decoration.length} sentences off the chain: ${decoration.map((s) => s.index).join(", ")}`
			)
		)
	}
	return findings
}

// ── Questions ───────────────────────────────────────────────────────────────────────────────────
const keyContentWords = (question: Question) =>
	words(question.key)
		.map(lower)
		.filter((w) => !STOPWORDS.has(w))

const checkQuestionLiteral = (context: Context, question: Question): Finding[] => {
	if (question.role !== "must" && question.role !== "form_practice") {
		return []
	}
	const findings: Finding[] = []
	const keyWords = keyContentWords(question)
	const offText = keyWords.filter(
		(w) => !context.roster.has(w) && !stems(w).some((s) => context.passageStems.has(s))
	)
	if (offText.length > 0) {
		findings.push(
			gate(
				"KEY.NOT_LITERAL",
				`key "${question.key}" uses words the passage did not: ${offText.join(", ")}`
			)
		)
	}
	// A why-key may draw on the sentence that states the cause (manifest causeFrom), not only the target.
	const planned = context.manifest.sentences.find((s) => s.index === question.targetSentence)
	const causeFrom = planned?.causeFrom
	const keySentences = new Set(
		causeFrom === null || causeFrom === undefined
			? [question.targetSentence]
			: [question.targetSentence, causeFrom]
	)
	const keyStems = new Set(
		context.sentences
			.filter((s) => keySentences.has(s.index))
			.flatMap((s) => words(plainText(s.text)).flatMap(stems))
	)
	const missing = keyWords.filter(
		(w) => !context.roster.has(w) && !stems(w).some((s) => keyStems.has(s))
	)
	if (missing.length > 0) {
		findings.push(
			flag(
				"KEY.OFF_TARGET",
				`key "${question.key}" has words not in sentence(s) ${Array.from(keySentences).join(", ")}`
			)
		)
	}
	return findings
}

const checkQuestionForm = (context: Context, question: Question, order: number): Finding[] => {
	const findings: Finding[] = []
	const firstWord = words(question.text)[0]
	const opener = firstWord === undefined ? "" : lower(firstWord)
	if (
		YES_NO_OPENERS.has(opener) &&
		question.form !== "cant_tell" &&
		question.form !== "apply_rule"
	) {
		findings.push(gate("Q.YESNO", `"${question.text}" opens as a yes/no question`))
	}
	if (
		question.form === "where" &&
		words(question.key)
			.map(lower)
			.some((w) => PLACE_PARTICLES.has(w))
	) {
		findings.push(
			flag(
				"KEY.WHERE.PHRASE",
				`where-key "${question.key}" is a phrase; RULES §26 wants the place noun`
			)
		)
	}
	if (question.form === "why_because" || question.form === "why_to") {
		const target = context.sentences.find((s) => s.index === question.targetSentence)
		const planned = context.manifest.sentences.find((s) => s.index === question.targetSentence)
		const marked =
			target !== undefined &&
			words(plainText(target.text))
				.map(lower)
				.some((w) => CAUSE_MARKERS.has(w))
		if (!marked && planned?.causeStated !== true) {
			findings.push(
				flag(
					"CAUSE.JUXTAPOSED",
					`why-question on sentence ${question.targetSentence} but its cause is not stated there`
				)
			)
		}
	}
	if (question.role === "inference") {
		const planned = context.manifest.questions[order]
		const rules = new Set(context.brief.taughtRules.map((r) => r.rule))
		if (planned === undefined || planned.rule === null || !rules.has(planned.rule)) {
			findings.push(
				gate("Q.INFERENCE.RULE", `inference question ${order + 1} names no taught rule`)
			)
		}
	}
	return findings
}

/** L3: a what-did question must pin one deed when the actor does several things. */
const checkQuestionAmbiguity = (context: Context, question: Question): Finding[] => {
	if (question.form !== "what_did") {
		return []
	}
	const questionStems = new Set(words(question.text).flatMap(stems))
	const target = context.sentences.find((s) => s.index === question.targetSentence)
	const surfaceStems = (surface: string) => words(surface).flatMap(stems)
	const actor = target?.mentions.find(
		(m) => m.kind === "np" && surfaceStems(m.surface).some((stem) => questionStems.has(stem))
	)
	if (actor === undefined) {
		return []
	}
	const actorLemma = lower(actor.lemma)
	const actorSentences = context.sentences.filter((s) => npLemmas(s).includes(actorLemma))
	const actorStems = new Set([...formsOf(context, actorLemma), ...stems(actorLemma)])
	const pinning = words(question.text)
		.map(lower)
		.filter((w) => !STOPWORDS.has(w) && !stems(w).some((stem) => actorStems.has(stem)))
	return actorSentences.length >= 2 && pinning.length === 0
		? [
				gate(
					"Q.AMBIGUOUS",
					`"${question.text}" — ${actor.lemma} acts in ${actorSentences.length} sentences; add a time or place to pin the deed`
				)
			]
		: []
}

const checkQuestionTargets = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { brief, sentences } = context
	const questions = context.realized.questions
	const firm = new Set<Form>(brief.firmForms)
	const targets = new Set<number>()
	let lastTarget = 0
	questions.forEach((question, order) => {
		if (!firm.has(question.form)) {
			findings.push(gate("Q.FORM.UNFIRM", `${question.form} is not a firm form`))
		}
		if (question.targetSentence > sentences.length) {
			findings.push(
				gate("Q.TARGET.RANGE", `question ${order + 1} targets sentence ${question.targetSentence}`)
			)
		}
		if (targets.has(question.targetSentence) && question.role !== "main_idea") {
			findings.push(
				gate("Q.TARGET.DUPLICATE", `two questions target sentence ${question.targetSentence}`)
			)
		}
		targets.add(question.targetSentence)
		if (
			!brief.stage.orderFree &&
			question.role !== "main_idea" &&
			question.targetSentence < lastTarget
		) {
			findings.push(
				gate(
					"Q.ORDER",
					`question ${order + 1} goes back to sentence ${question.targetSentence} before order is free`
				)
			)
		}
		lastTarget = Math.max(lastTarget, question.targetSentence)
	})
	return findings
}

const checkQuestionRoles = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { stage } = context.brief
	const questions = context.realized.questions
	const count = (role: Question["role"]) => questions.filter((q) => q.role === role).length
	if (count("form_practice") > 1) {
		findings.push(
			flag("Q.FORM_PRACTICE.MANY", `${count("form_practice")} form-practice questions; cap is 1`)
		)
	}
	const inferenceOk = stage.requireInference ? count("inference") === 1 : count("inference") === 0
	if (!inferenceOk) {
		findings.push(
			gate(
				"Q.INFERENCE.COUNT",
				`${count("inference")} inference questions; stage ${stage.requireInference ? "requires exactly one" : "allows none"}`
			)
		)
	}
	const mainIdeaOk = stage.requireMainIdea ? count("main_idea") === 1 : count("main_idea") === 0
	if (!mainIdeaOk) {
		findings.push(
			gate(
				"Q.MAIN_IDEA.COUNT",
				`${count("main_idea")} main-idea questions; stage ${stage.requireMainIdea ? "requires exactly one" : "allows none"}`
			)
		)
	}
	return findings
}

const checkQuestionSet = (context: Context): Finding[] => {
	const findings: Finding[] = []
	const { brief, manifest } = context
	const questions = context.realized.questions
	if (questions.length !== brief.stage.questions) {
		findings.push(
			gate("Q.COUNT", `${questions.length} questions; stage requires ${brief.stage.questions}`)
		)
	}
	const targets = new Set(questions.map((q) => q.targetSentence))
	const forms = new Set(questions.map((q) => q.form))
	if (forms.size < 3 && questions.length >= 3) {
		findings.push(gate("Q.FORMS.FEW", `only ${forms.size} distinct forms`))
	}
	const chain = manifest.sentences.filter((s) => s.onCausalChain).map((s) => s.index)
	const outcome = chain.at(-1)
	if (outcome !== undefined && !targets.has(outcome)) {
		findings.push(
			flag("Q.OUTCOME.UNASKED", `the chain's outcome (sentence ${outcome}) is not asked`)
		)
	}
	const must = manifest.sentences.filter((s) => s.onCausalChain && s.level <= 2).map((s) => s.index)
	const hit = must.filter((i) => targets.has(i)).length
	if (must.length > 0 && hit < Math.ceil(questions.length / 2)) {
		findings.push(
			flag(
				"Q.MUST.COVERAGE",
				`${hit} of ${questions.length} questions hit must-ask sentences (${must.join(", ")})`
			)
		)
	}
	return findings
}

const checkImageLeaks = (context: Context): Finding[] =>
	context.realized.questions
		.filter((q) => q.form === "cant_tell")
		.flatMap((question) =>
			context.realized.frames
				.filter((frame) =>
					keyContentWords(question).some((w) => lower(frame.imageDescription).includes(w))
				)
				.map((frame) =>
					flag("IMG.LEAK", `image ${frame.imageId} may show what "${question.text}" leaves open`)
				)
		)

// ── Measures ────────────────────────────────────────────────────────────────────────────────────
const measure = (context: Context, forms: ReadonlyArray<Form>): Measures => {
	const { sentences, manifest } = context
	const wordsPerSentence = sentences.map((s) => words(plainText(s.text)).length)
	const seen = new Set<string>()
	const newConceptsPerSentence = sentences.map((sentence) => {
		let fresh = 0
		for (const lemma of conceptLemmas(context, sentence)) {
			if (!seen.has(lemma)) {
				fresh += 1
				seen.add(lemma)
			}
		}
		return fresh
	})
	const mentions = sentences.reduce((total, s) => total + npLemmas(s).length, 0)
	const byAdmit = (admit: Manifest["lexicon"][number]["admit"]) =>
		manifest.lexicon.filter((e) => e.admit === admit).map((e) => e.lemma)
	return {
		sentences: sentences.length,
		words: wordsPerSentence.reduce((a, b) => a + b, 0),
		wordsPerSentence,
		propositions: manifest.sentences.reduce((a, s) => a + s.propositions.length, 0),
		propositionsPerSentence: manifest.sentences.map((s) => s.propositions.length),
		concepts: seen.size,
		mentions,
		repeats: mentions - seen.size,
		newConceptsPerSentence,
		pronouns: sentences.reduce(
			(total, s) => total + s.mentions.filter((m) => m.kind !== "np").length,
			0
		),
		chainSentences: manifest.sentences.filter((s) => s.onCausalChain).map((s) => s.index),
		statedCauses: causalSteps(context).stated.length,
		juxtaposedCauses: causalSteps(context).juxtaposed.length,
		forms,
		anchored: byAdmit("anchored"),
		preteach: byAdmit("preteach"),
		forbidden: byAdmit("forbidden")
	}
}

// ── Entry points ────────────────────────────────────────────────────────────────────────────────
export const analyze = (brief: Brief, manifest: Manifest, realized: Realized): Report => {
	const context = buildContext(brief, manifest, realized)
	const findings: Finding[] = [
		...checkLexicon(context),
		...checkUndeclaredVocabulary(context),
		...checkAvoidList(context),
		...checkCounts(context),
		...context.sentences.flatMap((sentence) => [
			...checkSentenceForm(context, sentence),
			...checkMentions(context, sentence),
			...checkReference(context, sentence),
			...checkOverlap(context, sentence)
		]),
		...checkConceptLoad(context),
		...checkFrames(context),
		...checkNewInformation(context),
		...checkCohesion(context),
		...checkFiller(context),
		...checkGist(context),
		...realized.questions.flatMap((question, order) => [
			...checkQuestionLiteral(context, question),
			...checkQuestionForm(context, question, order),
			...checkQuestionAmbiguity(context, question)
		]),
		...checkQuestionTargets(context),
		...checkQuestionRoles(context),
		...checkQuestionSet(context),
		...checkImageLeaks(context)
	]
	const gates = findings.filter((f) => f.severity === "gate")
	const flags = findings.filter((f) => f.severity === "flag")
	const forms = Array.from(new Set(realized.questions.map((q) => q.form)))
	return {
		status: gates.length === 0 ? "pass" : "fail",
		gates,
		flags,
		measures: measure(context, forms)
	}
}

const planCounts = (brief: Brief, manifest: Manifest): Finding[] => {
	const findings: Finding[] = []
	if (manifest.sentences.length !== brief.stage.sentences) {
		findings.push(
			gate(
				"PLAN.SENTENCES",
				`plans ${manifest.sentences.length} sentences; stage allows ${brief.stage.sentences}`
			)
		)
	}
	if (manifest.questions.length !== brief.stage.questions) {
		findings.push(
			gate(
				"PLAN.QUESTIONS",
				`plans ${manifest.questions.length} questions; stage requires ${brief.stage.questions}`
			)
		)
	}
	const firm = new Set<Form>(brief.firmForms)
	for (const question of manifest.questions.filter((q) => !firm.has(q.form))) {
		findings.push(gate("PLAN.FORM.UNFIRM", `${question.form} is not a firm form`))
	}
	const indices = manifest.sentences.map((sentence) => sentence.index).toSorted((a, b) => a - b)
	if (indices.some((index, position) => index !== position + 1)) {
		findings.push(gate("PLAN.INDICES", `sentence indices are not 1..n: ${indices.join(", ")}`))
	}
	for (const sentence of manifest.sentences.filter((s) => s.propositions.length > 3)) {
		findings.push(
			gate(
				"PLAN.LOAD",
				`sentence ${sentence.index} plans ${sentence.propositions.length} propositions; a five-year-old's sentence holds 1–3`
			)
		)
	}
	return findings
}

const planLexicon = (manifest: Manifest): Finding[] => {
	const findings: Finding[] = []
	const anchored = manifest.lexicon.filter((entry) => entry.admit === "anchored")
	if (anchored.length > 1) {
		findings.push(gate("PLAN.ANCHORED.MANY", anchored.map((entry) => entry.lemma).join(", ")))
	}
	for (const entry of manifest.lexicon.filter((entry) => entry.admit === "forbidden")) {
		findings.push(gate("PLAN.FORBIDDEN", `${entry.lemma}: ${entry.justification}`))
	}
	for (const entry of manifest.lexicon.filter((entry) => entry.admit === "preteach")) {
		findings.push(gate("PLAN.PRETEACH", `${entry.lemma}: ${entry.justification}`))
	}
	return findings
}

const planFrames = (manifest: Manifest): Finding[] => {
	const findings: Finding[] = []
	const frames = new Map<number, number[]>()
	for (const sentence of manifest.sentences) {
		frames.set(sentence.frame, [...(frames.get(sentence.frame) ?? []), sentence.index])
	}
	for (const [frame, members] of frames) {
		const sorted = members.toSorted((a, b) => a - b)
		const consecutive = sorted.every(
			(index, position) => position === 0 || index === (sorted[position - 1] ?? Number.NaN) + 1
		)
		if (sorted.length > 2 || !consecutive) {
			findings.push(
				gate(
					"PLAN.FRAME",
					`frame ${frame} holds sentences ${sorted.join(", ")}; a frame is one or two consecutive sentences`
				)
			)
		}
	}
	return findings
}

/** A cause edge belongs to a RESULT sentence and points at an earlier one; anything else is a mislabel. */
const planCauses = (manifest: Manifest): Finding[] =>
	manifest.sentences
		.filter(
			(s) =>
				(s.causeFrom !== null && s.discourse !== "RESULT") ||
				(s.causeFrom !== null && s.causeFrom >= s.index) ||
				(s.discourse === "RESULT" && s.causeFrom === null)
		)
		.map((s) =>
			gate(
				"PLAN.CAUSE",
				`sentence ${s.index}: discourse ${s.discourse} with causeFrom ${s.causeFrom}; only a RESULT sentence carries causeFrom, and it names an earlier sentence`
			)
		)

/** The plan must prove its own referential chain before a word is written. */
const planCoherence = (manifest: Manifest): Finding[] => {
	const findings: Finding[] = []
	const planLemmas = new Map(manifest.sentences.map((s) => [s.index, new Set(s.lemmas.map(lower))]))
	const nouns = new Set(
		manifest.lexicon.filter((entry) => entry.kind === "concept").map((entry) => lower(entry.lemma))
	)
	for (const sentence of manifest.sentences) {
		const own = planLemmas.get(sentence.index)
		const before = planLemmas.get(sentence.index - 1)
		if (sentence.index === 1 || own === undefined || before === undefined) {
			continue
		}
		const shared = sentence.sharedWithPrevious === null ? null : lower(sentence.sharedWithPrevious)
		const holds = shared !== null && own.has(shared) && before.has(shared)
		if (shared !== null && holds && !nouns.has(shared)) {
			findings.push(
				gate(
					"PLAN.GAP.VERB",
					`sentence ${sentence.index} shares only the verb "${sentence.sharedWithPrevious}" with sentence ${sentence.index - 1}; the thread must be a repeated noun`
				)
			)
			continue
		}
		if (!holds) {
			findings.push(
				gate(
					"PLAN.GAP",
					`sentence ${sentence.index} claims to share "${sentence.sharedWithPrevious}" with sentence ${sentence.index - 1}, but the planned lemmas do not bear it out`
				)
			)
		}
	}
	return findings
}

/**
 * Gates on the manifest alone, before any prose. A plan that fails here cannot be written
 * correctly, so the pipeline stops and reports instead of realizing.
 */
export const analyzePlan = (brief: Brief, manifest: Manifest): ReadonlyArray<Finding> => [
	...planCounts(brief, manifest),
	...planLexicon(manifest),
	...planFrames(manifest),
	...planCauses(manifest),
	...planCoherence(manifest)
]

/** Brief-level admission: the stage bounds how much new information one passage may carry. */
export const admitBrief = (brief: Brief): ReadonlyArray<Finding> => {
	const count = brief.objective.newInformation.length
	const { min, max } = brief.stage.newItems
	return count >= min && count <= max
		? []
		: [gate("BRIEF.NEW_ITEMS", `${count} new-information items; the stage allows ${min}–${max}`)]
}
