import { XmlSchema } from "@aidenzepp/effect-xml"
import type { Json } from "@effect-bench/json"
import {
	Array as Arr,
	Effect,
	Formatter,
	Option,
	Result,
	Schema,
	Stream,
	String as Str
} from "effect"
import type { Workload } from "#workload.ts"

/** effect-xml: XML decoded into Effect Schema values and encoded back, on Effect's own XML tokenizer. */
const SOURCE = "@aidenzepp/effect-xml"

/** The QTI 3.0 namespace, the default element namespace of the item bank. */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"

const qti = XmlSchema.namespaces({ "": QTI })

const Variable = qti.Element("qti-variable", { attributes: { identifier: Schema.String } })

const Correct = qti.Element("qti-correct", { attributes: { identifier: Schema.String } })

const Match = qti.Element("qti-match", {
	content: XmlSchema.elements({ correct: Correct, variable: Variable })
})

const BranchRule = qti.Element("qti-branch-rule", {
	attributes: { target: Schema.String },
	content: XmlSchema.elements({ match: Match })
})

const Weight = qti.Element("qti-weight", {
	attributes: { identifier: Schema.String, value: Schema.Finite }
})

/** One record of the bank: an item reference with its weights and branch rules. */
const ItemRef = qti.Element("qti-assessment-item-ref", {
	attributes: {
		category: Schema.optionalKey(Schema.String),
		fixed: Schema.optionalKey(Schema.Boolean),
		href: Schema.String,
		identifier: Schema.String,
		required: Schema.optionalKey(Schema.Boolean)
	},
	content: XmlSchema.elements({
		rules: XmlSchema.many(BranchRule),
		weights: XmlSchema.many(Weight)
	})
})

const ItemBank = qti.Element("qti-item-bank", {
	content: XmlSchema.elements({ refs: XmlSchema.many(ItemRef) })
})

const BankDocument = XmlSchema.fromString(ItemBank)

const BankTree = XmlSchema.ElementFromString({ "": QTI })

/** The root-anchored path of every record in a bank, for the stream. */
const BANK_PATH: ReadonlyArray<string> = [
	XmlSchema.clark(Option.some(QTI), "qti-item-bank"),
	XmlSchema.clark(Option.some(QTI), "qti-assessment-item-ref")
]

/** Record `index` of a bank, the shape effect-xml's own benchmarks generate; without `href` it fails a typed
 * decode, since every item reference requires one. */
const recordText = (index: number, href: boolean): string => {
	const hrefAttribute = href ? ` href="items/item-${index}.xml"` : ""
	return `  <qti-assessment-item-ref identifier="item-${index}"${hrefAttribute} category="section-${index % 8}" required="true" fixed="false">
    <qti-weight identifier="W${index % 4}" value="${(index % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-${index + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-${index}"/>
        <qti-correct identifier="RESPONSE-${index}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
`
}

/** A bank of `records` item references; with `badLast`, the last one has no `href`. */
const bankText = (records: number, badLast: boolean): string =>
	Arr.join(
		[
			`<?xml version="1.0" encoding="UTF-8"?>\n<qti-item-bank xmlns="${QTI}">\n`,
			...Arr.makeBy(records, (index) => recordText(index, !(badLast && index === records - 1))),
			"</qti-item-bank>\n"
		],
		""
	)

/** A text cut into pieces of `size` code units, as a reader would hand it to a stream. */
const chunksOf = (text: string, size: number): ReadonlyArray<string> =>
	Arr.makeBy(Math.ceil(text.length / size), (index) =>
		Str.slice(index * size, (index + 1) * size)(text)
	)

type Bank = typeof ItemBank.Type

/** What a decoded bank amounts to: how many records, the sum of their weights and the last record's target. */
const summaryOf = (refs: Bank["refs"]): Json => ({
	records: refs.length,
	weight: Arr.reduce(refs, 0, (sum, ref) =>
		Arr.reduce(ref.weights, sum, (inner, weight) => inner + weight.value)
	),
	last: Option.match(Arr.last(refs), {
		onNone: () => null,
		onSome: (ref) => ref.href
	})
})

const decodeBank = Schema.decodeUnknownEffect(BankDocument)

const encodeBank = Schema.encodeEffect(BankDocument)

const decodeTree = Schema.decodeUnknownEffect(BankTree)

/** The bank sizes every typed decode runs at: about 16 KiB, 256 KiB and 4 MiB of text. */
const SIZES: ReadonlyArray<number> = [40, 640, 10_240]

const BANKS: ReadonlyArray<readonly [number, string]> = Arr.map(SIZES, (records) => [
	records,
	bankText(records, false)
])

const STREAMED = bankText(640, false)

const STREAMED_CHUNKS = chunksOf(STREAMED, 4096)

const BAD_LAST = bankText(640, true)

/** Typed decodes at three sizes, an encode round trip, the untyped tree, the record stream and the refusal path. */
export const EFFECT_XML_WORKLOADS: ReadonlyArray<Workload> = [
	...Arr.map(BANKS, ([records, text]): Workload => ({
		name: `xml-decode-bank-${records}`,
		source: SOURCE,
		run: Effect.map(Effect.orDie(decodeBank(text)), (bank) => () => summaryOf(bank.refs))
	})),
	{
		name: "xml-roundtrip-bank-640",
		source: SOURCE,
		run: Effect.gen(function* () {
			const bank = yield* decodeBank(STREAMED)
			const text = yield* encodeBank(bank)
			const again = yield* decodeBank(text)
			return () => ({ encoded: text.length, decoded: summaryOf(again.refs) })
		}).pipe(Effect.orDie)
	},
	{
		name: "xml-tree-bank-640",
		source: SOURCE,
		run: Effect.map(Effect.orDie(decodeTree(STREAMED)), (tree) => () => Formatter.format(tree))
	},
	{
		name: "xml-stream-bank-640",
		source: SOURCE,
		run: Stream.fromIterable(STREAMED_CHUNKS).pipe(
			Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(ItemRef, BANK_PATH)()),
			Stream.runCollect,
			Effect.orDie,
			Effect.map((refs) => () => summaryOf(refs))
		)
	},
	{
		name: "xml-refuse-bad-last-640",
		source: SOURCE,
		run: Effect.map(
			Effect.result(decodeBank(BAD_LAST)),
			(decoded) => () =>
				Result.match(decoded, {
					onSuccess: () => "accepted",
					onFailure: (error) =>
						Result.match(XmlSchema.findDecodeError(error.issue), {
							onSuccess: (found) => `${found.reason._tag} ${found.path}`,
							onFailure: () => "refused without an XML error"
						})
				})
		)
	}
]
