import { type Json, jsonTextOf } from "@effect-bench/json"
import { fnv1a32 } from "@effect-bench/testing/random"
import { Array as Arr, Clock, Effect, Schema, String as Str } from "effect"
import type { Workload } from "#workload.ts"

/** How many times a run repeats its workload: the rounds discarded while the engine warms up, then the rounds timed. */
export type Rounds = Readonly<{ warmup: number; timed: number }>

/** A workload whose rounds computed different results: a nondeterministic workload, never a timing to keep. */
class DigestsDisagree extends Schema.TaggedError<
	DigestsDisagree,
	{ readonly brand: unique symbol }
>()("DigestsDisagree", {
	workload: Schema.String,
	digests: Schema.Array(Schema.String)
}) {}

/** A result's digest: FNV-1a over its JSON text, so two engines agree exactly when their results do. */
const digestOf = (result: Json): string =>
	Str.padStart(8, "0")(fnv1a32(jsonTextOf(result)).toString(16))

/** One round: the workload run once, between two readings of the clock. */
const round = Effect.fnUntraced(function* (workload: Workload) {
	const start = yield* Clock.currentTimeNanos
	const result = yield* workload.run
	const end = yield* Clock.currentTimeNanos
	return { nanos: Number(end - start), digest: digestOf(result) }
})

/** A run's report: the workload, the one digest all its rounds agreed on, and each timed round in nanoseconds. */
export const measure = Effect.fnUntraced(function* (workload: Workload, rounds: Rounds) {
	const warm = yield* Effect.replicateEffect(round(workload), rounds.warmup)
	const timed = yield* Effect.replicateEffect(round(workload), rounds.timed)
	const digests = Arr.dedupe(Arr.map(Arr.appendAll(warm, timed), (each) => each.digest))
	const [digest, ...others] = digests
	if (digest === undefined || Arr.isReadonlyArrayNonEmpty(others)) {
		return yield* Effect.die(DigestsDisagree.make({ workload: workload.name, digests }))
	}
	return {
		workload: workload.name,
		source: workload.source,
		digest,
		nanos: Arr.map(timed, (each) => each.nanos)
	}
})
