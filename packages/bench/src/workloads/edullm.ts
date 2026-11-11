import { pgCopyBinary } from "@edullm/bronze-repository/pg-copy-binary.ts"
import { decodeDocument, jsonOf } from "@edullm/database/archive/bson.ts"
import { admitBrief } from "@edullm/passage-forge/analyze.ts"
import { BriefSchema } from "@edullm/passage-forge/brief.ts"
import duckfeetMedium from "@edullm/passage-forge/briefs/duckfeet-medium.json" with { type: "json" }
import duckfeet from "@edullm/passage-forge/briefs/duckfeet.json" with { type: "json" }
import nest from "@edullm/passage-forge/briefs/nest.json" with { type: "json" }
import seed from "@edullm/passage-forge/briefs/seed.json" with { type: "json" }
import { Array as Arr, Effect, Formatter, Schema, Stream, String as Str } from "effect"
import type { Workload } from "#workload.ts"

const encoder = new TextEncoder()

/** Bytes written big-endian, as PostgreSQL's binary COPY and nothing else here writes them. */
const bigEndian = (bytes: number, value: number): ReadonlyArray<number> =>
	Arr.makeBy(bytes, (index) => (value >>> ((bytes - 1 - index) * 8)) & 0xff)

/** A `COPY … TO STDOUT (FORMAT binary)` stream of `rows` tuples of `fields` text fields, every fifth field null, cut
 * into chunks of `chunk` bytes as a socket would deliver it. */
const copyBinaryOf = (rows: number, fields: number, chunk: number): ReadonlyArray<Uint8Array> => {
	const out: Array<number> = []
	const append = (bytes: Iterable<number>) => {
		for (const byte of bytes) {
			out.push(byte)
		}
	}
	append(pgCopyBinary.signature)
	append(bigEndian(4, 0))
	append(bigEndian(4, 0))
	for (const row of Arr.range(0, rows - 1)) {
		append(bigEndian(2, fields))
		for (const field of Arr.range(0, fields - 1)) {
			if ((row + field) % 5 === 0) {
				append(bigEndian(4, 0xffffffff))
			} else {
				const text = encoder.encode(`row ${row} field ${field} ${Str.repeat(field * 3)("x")}`)
				append(bigEndian(4, text.length))
				append(text)
			}
		}
	}
	append(bigEndian(2, 0xffff))
	const bytes = Uint8Array.from(out)
	return Arr.makeBy(Math.ceil(bytes.length / chunk), (index) =>
		bytes.subarray(index * chunk, (index + 1) * chunk)
	)
}

/** One BSON value as the encoder below writes it. */
type Bson =
	| Readonly<{ kind: "string"; value: string }>
	| Readonly<{ kind: "int32"; value: number }>
	| Readonly<{ kind: "int64"; value: bigint }>
	| Readonly<{ kind: "double"; value: number }>
	| Readonly<{ kind: "bool"; value: boolean }>
	| Readonly<{ kind: "null" }>
	| Readonly<{ kind: "oid"; value: string }>
	| Readonly<{ kind: "date"; value: bigint }>
	| Readonly<{ kind: "document"; value: ReadonlyArray<readonly [string, Bson]> }>
	| Readonly<{ kind: "array"; value: ReadonlyArray<Bson> }>

const littleEndian = (bytes: number, value: bigint): ReadonlyArray<number> =>
	Arr.makeBy(bytes, (index) => Number((value >> BigInt(index * 8)) & 0xffn))

const cString = (text: string): ReadonlyArray<number> => [...encoder.encode(text), 0]

/** A BSON document's bytes: the encoder MongoDB's exports are written by, for the types edullm's archive reads. */
const bsonDocument = (entries: ReadonlyArray<readonly [string, Bson]>): ReadonlyArray<number> => {
	const body = Arr.flatMap(entries, ([key, value]) => bsonElement(key, value))
	return [...littleEndian(4, BigInt(body.length + 5)), ...body, 0]
}

const bsonElement = (key: string, value: Bson): ReadonlyArray<number> => {
	switch (value.kind) {
		case "string": {
			const text = encoder.encode(value.value)
			return [0x02, ...cString(key), ...littleEndian(4, BigInt(text.length + 1)), ...text, 0]
		}
		case "int32":
			return [0x10, ...cString(key), ...littleEndian(4, BigInt(value.value))]
		case "int64":
			return [0x12, ...cString(key), ...littleEndian(8, value.value)]
		case "double": {
			const view = new DataView(new ArrayBuffer(8))
			view.setFloat64(0, value.value, true)
			return [0x01, ...cString(key), ...new Uint8Array(view.buffer)]
		}
		case "bool":
			return [0x08, ...cString(key), value.value ? 1 : 0]
		case "null":
			return [0x0a, ...cString(key)]
		case "oid":
			return [
				0x07,
				...cString(key),
				...Arr.makeBy(12, (index) =>
					Number.parseInt(Str.slice(index * 2, index * 2 + 2)(value.value), 16)
				)
			]
		case "date":
			return [0x09, ...cString(key), ...littleEndian(8, value.value)]
		case "document":
			return [0x03, ...cString(key), ...bsonDocument(value.value)]
		case "array":
			return [
				0x04,
				...cString(key),
				...bsonDocument(Arr.map(value.value, (each, index) => [`${index}`, each] as const))
			]
	}
}

/** An archived attempt, shaped like the MongoDB exports edullm's archive reads: identity, scores, a nested history. */
const attemptOf = (index: number): Uint8Array =>
	Uint8Array.from(
		bsonDocument([
			["_id", { kind: "oid", value: Str.padStart(24, "0")((index * 7919).toString(16)) }],
			["student", { kind: "string", value: `student-${index % 97}` }],
			["lesson", { kind: "int32", value: index % 40 }],
			["score", { kind: "double", value: (index % 13) / 13 }],
			["completed", { kind: "bool", value: index % 3 !== 0 }],
			["notes", { kind: "null" }],
			[
				"answers",
				{
					kind: "array",
					value: Arr.makeBy(1 + (index % 6), (turn) => ({
						kind: "document",
						value: [
							["at", { kind: "date", value: 1_760_000_000_000n + BigInt(index * 1000 + turn) }],
							["answer", { kind: "string", value: `answer ${turn} of attempt ${index} é ü 😀` }],
							["correct", { kind: "bool", value: (index + turn) % 2 === 0 }]
						]
					}))
				}
			],
			[
				"meta",
				{
					kind: "document",
					value: [
						["source", { kind: "string", value: "mongodb-export" }],
						["version", { kind: "int64", value: 9_007_199_254_740_993n + BigInt(index) }]
					]
				}
			]
		])
	)

const COPY_CHUNKS = copyBinaryOf(10_000, 6, 65_536)

const ATTEMPTS: ReadonlyArray<Uint8Array> = Arr.makeBy(2000, attemptOf)

/** The forge's four committed briefs, decoded 250 times over: a brief is decoded on every request that reads it. */
const BRIEFS: ReadonlyArray<unknown> = Arr.flatten(
	Arr.makeBy(250, () => [seed, nest, duckfeet, duckfeetMedium])
)

const decodeBrief = Schema.decodeUnknownEffect(BriefSchema)

/** edullm's own compute: its PostgreSQL COPY-binary frame scanner, its BSON decoder and its passage briefs. */
export const WORKLOADS: ReadonlyArray<Workload> = [
	{
		name: "edullm-copy-binary-10000",
		source: "@edullm/bronze-repository",
		run: Effect.gen(function* () {
			const scanned = pgCopyBinary.scan(Stream.fromIterable(COPY_CHUNKS), 6)
			yield* Stream.runDrain(scanned.stream)
			const tuples = yield* scanned.tuples
			const progress = yield* scanned.progress
			return () => ({ tuples, bytes: progress.bytes })
		}).pipe(Effect.orDie)
	},
	{
		name: "edullm-bson-decode-2000",
		source: "@edullm/database",
		run: Effect.sync(() => {
			const decoded = Arr.map(ATTEMPTS, decodeDocument)
			const texts = Arr.map(decoded, jsonOf)
			return () => texts
		})
	},
	{
		name: "edullm-briefs-decode-1000",
		source: "@edullm/passage-forge",
		run: Effect.map(
			Effect.orDie(Effect.forEach(BRIEFS, (brief) => decodeBrief(brief))),
			(briefs) => {
				const admitted = Arr.map(briefs, admitBrief)
				return () => Formatter.format({ briefs, admitted })
			}
		)
	}
]
