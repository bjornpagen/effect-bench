import { Data, Deferred, Effect, Exit, Result, Schema, Stream } from "effect"
import { type NonNegativeInteger, NonNegativeIntegerSchema } from "#numbers.ts"

/**
 * @limitKind published
 * @owner Bronze COPY binary grammar
 * @unit bytes and bit positions
 * @scope one PostgreSQL binary COPY body
 * @constraint protocol constant
 * @source https://www.postgresql.org/docs/17/sql-copy.html#id-1.9.3.55.9.4
 * "11-byte sequence PGCOPY", "32-bit integer", "16-bit integer";
 * "Bits 16–31 are reserved to denote critical file format issues."
 * @verified 2026-09-16
 */
const FORMAT = {
	signature: Uint8Array.of(80, 71, 67, 79, 80, 89, 10, 255, 13, 10, 0),
	shortBytes: 2,
	wordBytes: 4,
	criticalFlags: 0xffff0000,
	maximumFields: 0x7fff,
	maximumLength: 0x7fffffff,
	trailer: 0xffff,
	nullLength: 0xffffffff
} as const

class PgCopyFramesRefused extends Data.TaggedError("PgCopyFramesRefused")<{
	readonly reason:
		| "roster-field-count"
		| "signature"
		| "critical-flags"
		| "extension-length"
		| "tuple-field-count"
		| "field-length"
		| "trailing-bytes"
		| "truncated"
		| "stream-already-consumed"
	readonly byteOffset: number
}> {}

type PgCopyProgress = Readonly<{ bytes: number; tuples: number }>

class PgCopyFramingInvariant extends Data.TaggedError("PgCopyFramingInvariant") {}

type Phase =
	| "signature"
	| "flags"
	| "extension-length"
	| "extension"
	| "fields"
	| "length"
	| "payload"
	| "trailer"

/** Fixed grammar registers: no field payload, tuple object or byte buffer is allocated. */
class Frames {
	phase: Phase = "signature"
	bytes = 0
	tuples = 0
	private signatureOffset = 0
	private word = 0
	private wordBytes = 0
	private remaining = 0
	private fields = 0
	private readonly fieldCount: number

	constructor(fieldCount: number) {
		this.fieldCount = fieldCount
	}

	private refused(reason: PgCopyFramesRefused["reason"], byteOffset = this.bytes) {
		return new PgCopyFramesRefused({ reason, byteOffset })
	}

	private next(phase: Phase) {
		this.phase = phase
		this.word = 0
		this.wordBytes = 0
	}

	private endField() {
		this.fields -= 1
		if (this.fields === 0) {
			this.tuples += 1
			this.next("fields")
		} else {
			this.next("length")
		}
	}

	private acceptSignature(byte: number) {
		if (byte !== FORMAT.signature[this.signatureOffset]) {
			return this.refused("signature", this.bytes - 1)
		}
		this.signatureOffset += 1
		if (this.signatureOffset === FORMAT.signature.length) {
			this.next("flags")
		}
		return undefined
	}

	private acceptFields(value: number) {
		if (value === FORMAT.trailer) {
			this.next("trailer")
			return undefined
		}
		if (value !== this.fieldCount) {
			return this.refused("tuple-field-count", this.bytes - FORMAT.shortBytes)
		}
		this.fields = value
		if (value === 0) {
			this.tuples += 1
			this.next("fields")
		} else {
			this.next("length")
		}
		return undefined
	}

	private acceptLength(value: number) {
		if (value === FORMAT.nullLength || value === 0) {
			this.endField()
			return undefined
		}
		if (value > FORMAT.maximumLength) {
			return this.refused("field-length", this.bytes - FORMAT.wordBytes)
		}
		this.remaining = value
		this.next("payload")
		return undefined
	}

	private acceptWord(value: number) {
		switch (this.phase) {
			case "flags":
				if ((value & FORMAT.criticalFlags) !== 0) {
					return this.refused("critical-flags", this.bytes - FORMAT.wordBytes)
				}
				this.next("extension-length")
				return undefined
			case "extension-length":
				if (value > FORMAT.maximumLength) {
					return this.refused("extension-length", this.bytes - FORMAT.wordBytes)
				}
				this.remaining = value
				this.next(value === 0 ? "fields" : "extension")
				return undefined
			case "fields":
				return this.acceptFields(value)
			case "length":
				return this.acceptLength(value)
			default:
				throw new PgCopyFramingInvariant()
		}
	}

	private acceptByte(byte: number) {
		this.bytes += 1
		if (this.phase === "signature") {
			return this.acceptSignature(byte)
		}
		// Multiplication preserves unsigned 32-bit values without signed bitwise coercion.
		this.word = this.word * 256 + byte
		this.wordBytes += 1
		const width = this.phase === "fields" ? FORMAT.shortBytes : FORMAT.wordBytes
		return this.wordBytes === width ? this.acceptWord(this.word) : undefined
	}

	private skip(available: number) {
		const consumed = Math.min(available, this.remaining)
		this.remaining -= consumed
		this.bytes += consumed
		if (this.remaining === 0) {
			if (this.phase === "extension") {
				this.next("fields")
			} else {
				this.endField()
			}
		}
		return consumed
	}

	write(chunk: Uint8Array): Result.Result<void, PgCopyFramesRefused> {
		let offset = 0
		while (offset < chunk.byteLength) {
			if (this.phase === "trailer") {
				return Result.fail(this.refused("trailing-bytes"))
			}
			if (this.phase === "extension" || this.phase === "payload") {
				offset += this.skip(chunk.byteLength - offset)
				continue
			}
			const byte = chunk[offset]
			if (byte === undefined) {
				return Result.fail(this.refused("truncated"))
			}
			offset += 1
			const refused = this.acceptByte(byte)
			if (refused !== undefined) {
				return Result.fail(refused)
			}
		}
		return Result.succeed(undefined)
	}

	finish(): Result.Result<NonNegativeInteger, PgCopyFramesRefused> {
		return this.phase === "trailer"
			? Result.succeed(Schema.decodeUnknownSync(NonNegativeIntegerSchema)(this.tuples))
			: Result.fail(this.refused("truncated"))
	}
}

/**
 * A scan is consumed once. The sink receives the original Uint8Array objects with
 * unchanged bytes and boundaries. A framing failure refuses the offending chunk;
 * an incomplete upload must be aborted by the host's existing scoped custody.
 * Completion waits for upstream EOF after the valid trailer. Progress records
 * examined bytes and complete tuples, including progress before a failed chunk.
 */
const scan = <E, R>(
	bytes: Stream.Stream<Uint8Array, E, R>,
	fieldCount: number
): Readonly<{
	stream: Stream.Stream<Uint8Array, E | PgCopyFramesRefused, R>
	tuples: Effect.Effect<NonNegativeInteger, E | PgCopyFramesRefused>
	progress: Effect.Effect<PgCopyProgress>
}> => {
	const frames = new Frames(fieldCount)
	const completion = Deferred.makeUnsafe<NonNegativeInteger, E | PgCopyFramesRefused>()
	let consumption: "fresh" | "reading" | "complete" = "fresh"
	const stream = Stream.suspend(() => {
		if (consumption !== "fresh") {
			return Stream.fail(
				new PgCopyFramesRefused({ reason: "stream-already-consumed", byteOffset: frames.bytes })
			)
		}
		consumption = "reading"
		const source: Stream.Stream<Uint8Array, E | PgCopyFramesRefused, R> =
			Number.isInteger(fieldCount) && fieldCount >= 0 && fieldCount <= FORMAT.maximumFields
				? bytes
				: Stream.fail(new PgCopyFramesRefused({ reason: "roster-field-count", byteOffset: 0 }))
		return source.pipe(
			Stream.tap((chunk) => Effect.suspend(() => Effect.fromResult(frames.write(chunk)))),
			Stream.concat(
				Stream.fromEffectDrain(
					Effect.suspend(() => Effect.fromResult(frames.finish())).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								consumption = "complete"
							})
						)
					)
				)
			),
			Stream.onExit((exit) => {
				if (Exit.isFailure(exit)) {
					return Deferred.failCause(completion, exit.cause)
				}
				return Deferred.complete(
					completion,
					consumption === "complete"
						? Effect.fromResult(frames.finish())
						: Effect.fail(
								new PgCopyFramesRefused({ reason: "truncated", byteOffset: frames.bytes })
							)
				)
			})
		)
	})
	return {
		stream,
		tuples: Deferred.await(completion),
		progress: Effect.sync(() => ({ bytes: frames.bytes, tuples: frames.tuples }))
	}
}

export const pgCopyBinary = {
	scan,
	get signature() {
		return Uint8Array.from(FORMAT.signature)
	}
}
