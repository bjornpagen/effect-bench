import type { Identity } from "@harvest/grizzle-engine/core/identity.ts"
import { identifierOf } from "@harvest/grizzle-engine/core/identity.ts"
import { draftMigration } from "@harvest/grizzle-engine/deploy/render/generate.ts"
import { emptySnapshot, noWorkload } from "@harvest/grizzle-engine/deploy/snapshot/build.ts"
import { codebookOf } from "@harvest/grizzle-engine/deploy/snapshot/build.ts"
import { Network } from "@harvest/grizzle-engine/fixtures/api/graph.ts"
import { Ledger } from "@harvest/grizzle-engine/fixtures/api/ledger.ts"
import { Payroll } from "@harvest/grizzle-engine/fixtures/api/payroll.ts"
import { platformAt } from "@harvest/grizzle-engine/fixtures/api/platform.ts"
import { Queue } from "@harvest/grizzle-engine/fixtures/api/queue.ts"
import { Search } from "@harvest/grizzle-engine/fixtures/api/search.ts"
import { Calendars, Schedule } from "@harvest/grizzle-engine/fixtures/api/spans.ts"
import { Plans, Work } from "@harvest/grizzle-engine/fixtures/api/work.ts"
import { draftCodebook, noRenames } from "@harvest/grizzle-engine/ir/codes.ts"
import { completeInstallOptions } from "@harvest/grizzle-engine/physical/complete.ts"
import { compileInstallation } from "@harvest/grizzle-engine/physical/install/compile.ts"
import { own, rostersOf } from "@harvest/grizzle-engine/schema/own.ts"
import { schemaDescOf } from "@harvest/grizzle-engine/schema/schema.ts"
import { Array as Arr, Effect, Formatter } from "effect"
import type { Workload } from "#workload.ts"

/** grizzle's compiler, harvested from its main branch: a schema's laws, roles and tables compiled into PostgreSQL. */
const SOURCE = "@harvest/grizzle-engine"

/** What drafting refused: the stage and the compiler's own refusal, rendered. */
type Refused = Readonly<{ stage: string; refusal: string }>

/**
 * A schema's first migration, drafted as `grizzle generate` drafts it for a schema with no committed snapshot and no
 * login: the schema owned, its rosters coded from the empty codebook, its installation compiled, and the migration
 * drafted against the empty snapshot. Every step is grizzle's own; a refusal is the result, never a defect, so every
 * engine must refuse alike.
 */
const draftOf = (value: unknown) => {
	const desc = schemaDescOf(value)
	if (desc === undefined) {
		return { stage: "schema", refusal: "not a schema value" } satisfies Refused
	}
	const owned = own(desc)
	if (!owned.ok) {
		return { stage: "own", refusal: Formatter.format(owned.error) } satisfies Refused
	}
	const installation: Identity<"schema"> = owned.value.installation
	const previous = emptySnapshot({ schemaName: desc.name, schema: identifierOf(installation) })
	const codes = draftCodebook(codebookOf(previous), noRenames, rostersOf(owned.value))
	if (!codes.ok) {
		return { stage: "codes", refusal: Formatter.format(codes.error) } satisfies Refused
	}
	const installed = compileInstallation(
		owned.value,
		completeInstallOptions(owned.value, installation, [], [], codes.value)
	)
	if (!installed.ok) {
		return { stage: "install", refusal: Formatter.format(installed.error) } satisfies Refused
	}
	return draftMigration({
		previous,
		installation: installed.value,
		workload: noWorkload,
		declared: { renames: [], drops: [] },
		abandoned: []
	})
}

/** grizzle's own fixture schemas, by the name each workload carries. */
const SCHEMAS: ReadonlyArray<readonly [string, unknown]> = [
	["platform", platformAt("platform").Platform],
	["billing", platformAt("platform").Billing],
	["payroll", Payroll],
	["work", Work],
	["plans", Plans],
	["queue", Queue],
	["search", Search],
	["ledger", Ledger],
	["network", Network],
	["schedule", Schedule],
	["calendars", Calendars]
]

/** Each fixture schema drafted into its first migration: the SQL files, the snapshot and the meta. */
export const WORKLOADS: ReadonlyArray<Workload> = Arr.map(SCHEMAS, ([name, schema]): Workload => ({
	name: `grizzle-draft-${name}`,
	source: SOURCE,
	run: Effect.sync(() => {
		const drafted = draftOf(schema)
		return () => Formatter.format(drafted)
	})
}))
