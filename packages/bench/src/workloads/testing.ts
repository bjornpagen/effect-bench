import { count } from "@effect-bench/testing/enumerate"
import { array, boolean, type Gen, int, weighted } from "@effect-bench/testing/gen"
import { wordsOf } from "@effect-bench/testing/random"
import { completeShrink, shrink } from "@effect-bench/testing/shrink"
import { forcedChooser, generate, randomChooser } from "@effect-bench/testing/source"
import { Array as Arr, Effect, Formatter } from "effect"
import type { Workload } from "#workload.ts"

/** The testing library's engine: a choice-stream property-test engine on Effect, harvested from superstarter. */
const SOURCE = "@effect-bench/testing"

/** A generator shaped like a real suite's: a dependent bound, a collection and weighted branches. */
const composite: Gen<unknown> = (source) => {
	const bound = source.draw(int(0, 8))
	return {
		bound,
		items: source.draw(
			array(
				weighted([
					[1, int(0, bound)],
					[3, int(10, 2000)]
				]),
				{ min: 0, max: 16 }
			)
		),
		flag: source.draw(boolean)
	}
}

/** The streams the generating workloads draw from: one per case, so every engine draws the same cases. */
const SEEDS: ReadonlyArray<number> = Arr.range(1, 1000)

const sampled = generate(composite, randomChooser(wordsOf(99)))

/** A collection that fails once any item reaches the threshold, and a wide failing case to shrink. */
const items = array(int(0, 1000), { min: 0, max: 64 })

const failingWide = generate(items, randomChooser(wordsOf(7)))

const reachesThreshold = (values: ReadonlyArray<number>) =>
	Effect.succeed(Arr.some(values, (value) => value >= 500))

/** The engine's own hot paths: drawing cases, replaying tapes, enumerating a space and shrinking a failure. */
export const WORKLOADS: ReadonlyArray<Workload> = [
	{
		name: "testing-generate",
		source: SOURCE,
		run: Effect.sync(() =>
			Arr.map(SEEDS, (seed) =>
				Formatter.format(generate(composite, randomChooser(wordsOf(seed))).value)
			)
		)
	},
	{
		name: "testing-replay",
		source: SOURCE,
		run: Effect.sync(() =>
			Arr.map(SEEDS, () =>
				Formatter.format(
					generate(composite, forcedChooser(sampled.tape.values, sampled.tape.length)).value
				)
			)
		)
	},
	{
		name: "testing-count",
		source: SOURCE,
		run: Effect.sync(() => {
			const counted = count(array(int(0, 9), { min: 0, max: 3 }), 2000)
			return counted.kind === "within" ? counted.cases : -counted.limit
		})
	},
	{
		name: "testing-shrink",
		source: SOURCE,
		run: Effect.map(shrink(items, failingWide, reachesThreshold, completeShrink), (shrunk) =>
			Formatter.format(shrunk.best.failure)
		)
	}
]
