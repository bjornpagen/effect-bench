import { open } from "@qti-pie/plate"
import { Array as Arr, Effect, Formatter } from "effect"
import type { Workload } from "#workload.ts"

/** qti-pie's plate: IMS QTI 3.0 assessments read, validated and built into a model, through its public `open`. */
const SOURCE = "@qti-pie/plate"

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"

const MATCH_CORRECT = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"

/** A single-choice item with `choices` choices, its first one correct, scored by the match-correct template. */
const choiceItemXml = (choices: number): string =>
	Arr.join(
		[
			`<qti-assessment-item xmlns="${QTI}" identifier="choice-${choices}" title="Choice" adaptive="false" time-dependent="false">`,
			'<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">',
			"<qti-correct-response><qti-value>C0</qti-value></qti-correct-response>",
			"</qti-response-declaration>",
			'<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>',
			'<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1">',
			"<qti-prompt>Pick the first choice.</qti-prompt>",
			...Arr.makeBy(
				choices,
				(index) => `<qti-simple-choice identifier="C${index}">Choice ${index}</qti-simple-choice>`
			),
			"</qti-choice-interaction></qti-item-body>",
			`<qti-response-processing template="${MATCH_CORRECT}"/>`,
			"</qti-assessment-item>"
		],
		""
	)

/** A test of `refs` item references in one section of one nonlinear part, as qti-pie's growth tests write one. */
const testXml = (refs: number): string =>
	Arr.join(
		[
			`<qti-assessment-test xmlns="${QTI}" identifier="T" title="T">`,
			'<qti-test-part identifier="P" navigation-mode="nonlinear" submission-mode="individual">',
			'<qti-assessment-section identifier="S" title="Section" visible="true">',
			...Arr.makeBy(
				refs,
				(index) => `<qti-assessment-item-ref identifier="i${index + 1}" href="choice.xml"/>`
			),
			"</qti-assessment-section></qti-test-part></qti-assessment-test>"
		],
		""
	)

const encoder = new TextEncoder()

/** One document opened, its whole verdict rendered: the model it built, or every refusal. */
const opened = (location: string, text: string): Workload["run"] => {
	const bytes = encoder.encode(text)
	return Effect.map(open(location, bytes), (verdict) => () => Formatter.format(verdict))
}

/** The choice counts an item is opened at, and the item-reference counts a test is. */
const CHOICES: ReadonlyArray<number> = [4, 64, 512]

const REFS: ReadonlyArray<number> = [100, 1000]

/** Opening items and tests: reading the XML, checking it against QTI's tables and building the model. */
export const QTI_PIE_WORKLOADS: ReadonlyArray<Workload> = [
	...Arr.map(CHOICES, (choices): Workload => ({
		name: `qti-open-item-${choices}`,
		source: SOURCE,
		run: opened("choice.xml", choiceItemXml(choices))
	})),
	...Arr.map(REFS, (refs): Workload => ({
		name: `qti-open-test-${refs}`,
		source: SOURCE,
		run: opened("test.xml", testXml(refs))
	}))
]
