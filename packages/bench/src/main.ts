import { jsonTextOf } from "@effect-bench/json"
import { Array as Arr, Cause, Console, Effect, Schema } from "effect"
import { measure } from "#measure.ts"
import type { Workload } from "#workload.ts"

/** A count of rounds, as a command line spells it. */
const RoundCount = Schema.FiniteFromString.check(Schema.isInt32(), Schema.isGreaterThanOrEqualTo(0))

/** What a bundle is run with, after the engine and the bundle: the workload's name, its warm-up rounds and its timed
 * rounds. */
const Invocation = Schema.Tuple([Schema.NonEmptyString, RoundCount, RoundCount])

/** A bundle asked for its roster: the name of every workload it holds, one per line. */
const Listing = Schema.Tuple([Schema.Literal("list")])

const decodeArguments = Schema.decodeUnknownEffect(Schema.Union([Listing, Invocation]))

/** A bundle was asked for a workload its roster does not hold. */
class WorkloadUnknown extends Schema.TaggedError<
	WorkloadUnknown,
	{ readonly brand: unique symbol }
>()("WorkloadUnknown", {
	workload: Schema.String,
	roster: Schema.Array(Schema.String)
}) {}

/** One run of one workload from a bundle's roster, its report printed as one line of JSON; or the roster listed. */
const run = Effect.fnUntraced(function* (
	roster: ReadonlyArray<Workload>,
	argv: ReadonlyArray<string>
) {
	const invocation = yield* decodeArguments(argv)
	if (invocation.length === 1) {
		return yield* Console.log(
			Arr.join(
				Arr.map(roster, (each) => each.name),
				"\n"
			)
		)
	}
	const [name, warmup, timed] = invocation
	const workload = yield* Effect.fromOption(
		Arr.findFirst(roster, (each) => each.name === name)
	).pipe(
		Effect.mapError(() =>
			WorkloadUnknown.make({ workload: name, roster: Arr.map(roster, (each) => each.name) })
		)
	)
	const report = yield* measure(workload, { warmup, timed })
	yield* Console.log(jsonTextOf(report))
})

/** A bundle's entry: runs the workload its command line names, and on any failure prints the cause and exits 1. */
export const main = (roster: ReadonlyArray<Workload>, argv: ReadonlyArray<string>) =>
	Effect.runFork(
		run(roster, argv).pipe(
			Effect.catchCause((cause) =>
				Console.error(Cause.pretty(cause)).pipe(
					Effect.andThen(
						Effect.sync(() => {
							globalThis.process.exitCode = 1
						})
					)
				)
			)
		)
	)
