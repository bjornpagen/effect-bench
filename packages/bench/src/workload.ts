import type { Json } from "@effect-bench/json"
import type { Effect } from "effect"

/**
 * One benchmark: real code from a real codebase, reached through its package and run on an input the workload
 * builds in memory. Its result is a JSON value whose digest every engine must print the same: a timing counts only
 * beside a digest that agrees.
 */
export type Workload = Readonly<{
	/** kebab-case, unique in its module's roster: what a run names and what its report carries. */
	name: string
	/** The package whose code runs, as a dependency names it. */
	source: string
	run: Effect.Effect<Json>
}>
