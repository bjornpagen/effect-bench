import { Data } from "effect"

/**
 * @limitKind published
 * @owner QTI archive loader
 * @unit element type bytes and fixed field widths
 * @scope one BSON document of a `mongodump` archive
 * @constraint protocol constant
 * @source https://bsonspec.org/spec.html
 * "\x01 64-bit binary floating point", "\x02 UTF-8 string", "\x03 Embedded document",
 * "\x04 Array", "\x07 ObjectId", "\x08 Boolean", "\x09 UTC datetime", "\x0A Null value",
 * "\x10 32-bit integer", "\x12 64-bit integer", "\x13 128-bit decimal floating point";
 * a document is "int32 e_list \x00" and its smallest form is five bytes.
 * @verified 2026-10-06 against the three local archives (`scratchpad/u11/*-sample.txt`)
 */
const BSON = {
	double: 0x01,
	string: 0x02,
	document: 0x03,
	array: 0x04,
	objectId: 0x07,
	boolean: 0x08,
	date: 0x09,
	null: 0x0a,
	int32: 0x10,
	int64: 0x12,
	decimal128: 0x13,
	minimumDocumentBytes: 5,
	int32Bytes: 4,
	int64Bytes: 8,
	objectIdBytes: 12,
	decimal128Bytes: 16
} as const

/**
 * @limitKind published
 * @owner QTI archive loader
 * @unit bit positions and the exponent bias
 * @scope decimal128 values inside a BSON document
 * @constraint protocol constant
 * @source https://en.wikipedia.org/wiki/Decimal128_floating-point_format (IEEE 754-2008 §3.5,
 * binary integer decimal encoding): sign bit 127, combination field bits 126–110, exponent bias
 * 6176, 34 significant decimal digits, "11" leading combination bits select the implicit "100"
 * significand prefix, "11110"/"11111" are infinity and NaN.
 * @verified 2026-10-06 (no network in this lane: transcribed from the IEEE 754-2008 layout the
 * MongoDB reference decoder follows; qualification compares against the sampler on one archive)
 */
const DECIMAL128 = {
	signBit: 127n,
	combinationBits: 125n,
	specialBits: 123n,
	highExponentBits: 111n,
	lowExponentBits: 113n,
	exponentMask: 0x3fffn,
	exponentBias: 6176,
	implicitPrefix: 0b100n,
	prefixedSignificandBits: 111n,
	plainSignificandBits: 113n,
	maximumSignificand: 10n ** 34n - 1n,
	halfBits: 64n,
	selectorMask: 0b11n
} as const

/** The qti-landing §6 value model: every BSON type either has a rule or is a named refusal. */
export type BsonValue =
	| string
	| boolean
	| null
	| Readonly<{ int32: number }>
	| Readonly<{ int64: bigint }>
	| Readonly<{ double: number }>
	| Readonly<{ decimal128: string }>
	| Readonly<{ oid: string }>
	| Readonly<{ date: bigint }>
	| BsonDocument
	| readonly BsonValue[]

/** Ordered entries; insertion order is the source's key order. */
export type BsonDocument = ReadonlyMap<string, BsonValue>

export const isBsonDocument = (value: BsonValue | undefined): value is BsonDocument =>
	value instanceof Map

export const isBsonArray = (value: BsonValue | undefined): value is readonly BsonValue[] =>
	Array.isArray(value)

/** A top-level `_id` as the row identity names it: a string as spelled, an ObjectId as 24-hex. */
export const objectIdOf = (value: BsonValue | undefined): string | undefined => {
	if (typeof value === "string") {
		return value
	}
	if (value === null || typeof value !== "object" || isBsonDocument(value) || isBsonArray(value)) {
		return undefined
	}
	return "oid" in value ? value.oid : undefined
}

export type BsonRefusalReason =
	| "bson-length"
	| "text-nul"
	| "double-nonfinite"
	| "decimal128-nonfinite"
	| "bson-duplicate-key"
	| "bson-type-unmodelled"

/** `key` is the top-level key under decode; `objectId` is the `_id` when it was decoded before the fault. */
export class BsonRefused extends Data.TaggedError("BsonRefused")<{
	readonly reason: BsonRefusalReason
	readonly key?: string
	readonly objectId?: string
}> {}

const utf8 = new TextDecoder()

const hexOf = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** A decimal128 as a JSON number: `[-]digits[E<exponent>]`, exact; `undefined` for infinity and NaN. */
const decimal128Of = (low: bigint, high: bigint): string | undefined => {
	const bits = (high << DECIMAL128.halfBits) | low
	const negative = ((bits >> DECIMAL128.signBit) & 1n) === 1n
	const prefixed =
		((bits >> DECIMAL128.combinationBits) & DECIMAL128.selectorMask) === DECIMAL128.selectorMask
	if (
		prefixed &&
		((bits >> DECIMAL128.specialBits) & DECIMAL128.selectorMask) === DECIMAL128.selectorMask
	) {
		return undefined
	}
	const exponentBits = prefixed ? DECIMAL128.highExponentBits : DECIMAL128.lowExponentBits
	const exponent =
		Number((bits >> exponentBits) & DECIMAL128.exponentMask) - DECIMAL128.exponentBias
	const significandBits = prefixed
		? DECIMAL128.prefixedSignificandBits
		: DECIMAL128.plainSignificandBits
	const plain = bits & ((1n << significandBits) - 1n)
	const encoded = prefixed ? (DECIMAL128.implicitPrefix << significandBits) | plain : plain
	// IEEE 754-2008: a significand above the 34-digit maximum is non-canonical and reads as zero.
	const significand = encoded > DECIMAL128.maximumSignificand ? 0n : encoded
	return `${negative ? "-" : ""}${significand}${exponent === 0 ? "" : `E${exponent}`}`
}

type Scalar = Readonly<{ value: BsonValue; next: number }>

/** A cursor over one document's bytes; little-endian scalars through one DataView. */
class Cursor {
	private readonly bytes: Uint8Array
	private readonly view: DataView
	private topKey: string | undefined
	private objectId: string | undefined

	constructor(bytes: Uint8Array) {
		this.bytes = bytes
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	}

	private refuse(reason: BsonRefusalReason): never {
		throw new BsonRefused({
			reason,
			...(this.topKey === undefined ? {} : { key: this.topKey }),
			...(this.objectId === undefined ? {} : { objectId: this.objectId })
		})
	}

	private require(position: number, width: number): void {
		if (position < 0 || position + width > this.bytes.byteLength) {
			this.refuse("bson-length")
		}
	}

	private int32(position: number): number {
		this.require(position, BSON.int32Bytes)
		return this.view.getInt32(position, true)
	}

	private cstring(position: number): Readonly<{ text: string; next: number }> {
		const terminator = this.bytes.indexOf(0, position)
		if (terminator === -1) {
			return this.refuse("bson-length")
		}
		return { text: utf8.decode(this.bytes.subarray(position, terminator)), next: terminator + 1 }
	}

	private string(position: number): Readonly<{ text: string; next: number }> {
		const length = this.int32(position)
		const start = position + BSON.int32Bytes
		const end = start + length
		if (length < 1) {
			this.refuse("bson-length")
		}
		this.require(start, length)
		if (this.bytes[end - 1] !== 0) {
			this.refuse("bson-length")
		}
		const text = utf8.decode(this.bytes.subarray(start, end - 1))
		if (text.includes("\0")) {
			this.refuse("text-nul")
		}
		return { text, next: end }
	}

	private double(position: number): Scalar {
		this.require(position, BSON.int64Bytes)
		const double = this.view.getFloat64(position, true)
		if (!Number.isFinite(double)) {
			this.refuse("double-nonfinite")
		}
		return { value: { double }, next: position + BSON.int64Bytes }
	}

	private int64(position: number): bigint {
		this.require(position, BSON.int64Bytes)
		return this.view.getBigInt64(position, true)
	}

	private decimal128(position: number): Scalar {
		this.require(position, BSON.decimal128Bytes)
		const decimal128 = decimal128Of(
			this.view.getBigUint64(position, true),
			this.view.getBigUint64(position + BSON.int64Bytes, true)
		)
		if (decimal128 === undefined) {
			return this.refuse("decimal128-nonfinite")
		}
		return { value: { decimal128 }, next: position + BSON.decimal128Bytes }
	}

	private value(type: number, position: number): Scalar {
		switch (type) {
			case BSON.double:
				return this.double(position)
			case BSON.string: {
				const { text, next } = this.string(position)
				return { value: text, next }
			}
			case BSON.document: {
				const { value, end } = this.document(position, false)
				return { value, next: end }
			}
			case BSON.array: {
				const { value, end } = this.document(position, false)
				return { value: [...value.values()], next: end }
			}
			case BSON.objectId: {
				this.require(position, BSON.objectIdBytes)
				const oid = hexOf(this.bytes.subarray(position, position + BSON.objectIdBytes))
				return { value: { oid }, next: position + BSON.objectIdBytes }
			}
			case BSON.boolean:
				this.require(position, 1)
				return { value: this.bytes[position] === 1, next: position + 1 }
			case BSON.date:
				return { value: { date: this.int64(position) }, next: position + BSON.int64Bytes }
			case BSON.null:
				return { value: null, next: position }
			case BSON.int32:
				return { value: { int32: this.int32(position) }, next: position + BSON.int32Bytes }
			case BSON.int64:
				return { value: { int64: this.int64(position) }, next: position + BSON.int64Bytes }
			case BSON.decimal128:
				return this.decimal128(position)
			default:
				return this.refuse("bson-type-unmodelled")
		}
	}

	/** One `e_list` element: type byte, key, value; returns the position after it. */
	private element(position: number, top: boolean, entries: Map<string, BsonValue>): number {
		const type = this.bytes[position]
		if (type === undefined) {
			return this.refuse("bson-length")
		}
		const { text: key, next } = this.cstring(position + 1)
		if (top) {
			this.topKey = key
		}
		const { value, next: after } = this.value(type, next)
		if (entries.has(key)) {
			this.refuse("bson-duplicate-key")
		}
		entries.set(key, value)
		if (top && key === "_id") {
			this.objectId = objectIdOf(value)
		}
		return after
	}

	document(offset: number, top: boolean): Readonly<{ value: BsonDocument; end: number }> {
		const length = this.int32(offset)
		const end = offset + length
		if (length < BSON.minimumDocumentBytes || end > this.bytes.byteLength) {
			this.refuse("bson-length")
		}
		if (this.bytes[end - 1] !== 0) {
			this.refuse("bson-length")
		}
		const entries = new Map<string, BsonValue>()
		let position = offset + BSON.int32Bytes
		while (position < end - 1) {
			position = this.element(position, top, entries)
		}
		if (position !== end - 1) {
			this.refuse("bson-length")
		}
		return { value: entries, end }
	}
}

/**
 * One complete int32-prefixed document; the bytes are exactly the document (qti-landing §6).
 * Throws `BsonRefused`; the archive layer's `archiveAttempt` turns it into the typed refusal.
 */
export const decodeDocument = (bytes: Uint8Array): BsonDocument => {
	const { value, end } = new Cursor(bytes).document(0, true)
	if (end !== bytes.byteLength) {
		throw new BsonRefused({ reason: "bson-length" })
	}
	return value
}

/** Millisecond-precision ISO 8601 (`YYYY-MM-DDTHH:MM:SS.mmmZ`), the §6 jsonb spelling of a UTC datetime. */
export const isoOf = (epochMilliseconds: bigint): string =>
	new Date(Number(epochMilliseconds)).toISOString()

/** The §6 jsonb column: exact int64 and decimal128 digits, ObjectId as 24-hex, dates as ISO strings. */
export const jsonOf = (value: BsonValue): string => {
	if (value === null) {
		return "null"
	}
	if (typeof value === "string") {
		return JSON.stringify(value)
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false"
	}
	if (isBsonArray(value)) {
		return `[${value.map(jsonOf).join(",")}]`
	}
	if (isBsonDocument(value)) {
		return `{${[...value].map(([key, member]) => `${JSON.stringify(key)}:${jsonOf(member)}`).join(",")}}`
	}
	if ("int32" in value) {
		return String(value.int32)
	}
	if ("int64" in value) {
		return value.int64.toString()
	}
	if ("double" in value) {
		return String(value.double)
	}
	if ("decimal128" in value) {
		return value.decimal128
	}
	if ("oid" in value) {
		return JSON.stringify(value.oid)
	}
	return JSON.stringify(isoOf(value.date))
}
