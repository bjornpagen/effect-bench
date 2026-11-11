import { NodeRuntime, NodeServices } from "@effect/platform-node"
import {
	Array as Arr,
	Effect,
	FileSystem,
	Number as Num,
	Option,
	Path,
	Result,
	Schema,
	String as Str
} from "effect"
import { ENGINES } from "#engines.ts"
import { MODULES } from "#modules.ts"

const Run = Schema.Struct({
	engine: Schema.String,
	module: Schema.String,
	workload: Schema.String,
	digest: Schema.optionalKey(Schema.String),
	nanos: Schema.optionalKey(Schema.Array(Schema.Finite)),
	failure: Schema.optionalKey(Schema.String)
})
type Run = typeof Run.Type

const Deopt = Schema.Struct({
	module: Schema.String,
	workload: Schema.String,
	bailouts: Schema.Finite
})

const Meta = Schema.Struct({
	started: Schema.String,
	machine: Schema.String,
	cores: Schema.String,
	warmup: Schema.Finite,
	timed: Schema.Finite,
	engines: Schema.Array(
		Schema.Struct({ name: Schema.String, label: Schema.String, version: Schema.String })
	)
})

const decodeRun = Schema.decodeEffect(Schema.fromJsonString(Run))

const decodeDeopt = Schema.decodeEffect(Schema.fromJsonString(Deopt))

const decodeMeta = Schema.decodeEffect(Schema.fromJsonString(Meta))

const linesOf = (text: string) => Arr.filter(Str.split("\n")(text), Str.isNonEmpty)

const median = (values: ReadonlyArray<number>) => {
	const sorted = Arr.sort(values, Num.Order)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 1
		? (sorted[middle] ?? Number.NaN)
		: ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2
}

const geomean = (values: ReadonlyArray<number>) =>
	values.length === 0
		? Number.NaN
		: Math.exp(Arr.reduce(values, 0, (sum, v) => sum + Math.log(v)) / values.length)

const ratio = (value: number) => (Number.isFinite(value) ? `${value.toFixed(2)}×` : "–")

const ms = (nanos: number) =>
	nanos / 1e6 >= 100 ? (nanos / 1e6).toFixed(0) : (nanos / 1e6).toFixed(2)

const BEGIN = "<!-- results:begin -->"
const END = "<!-- results:end -->"

/**
 * `pnpm report [run]`: the README's results, from one matrix run in `data/` (the latest unless named): the engines
 * and their versions, every workload's median on our Node and every other engine's median as a ratio to it (lower is
 * faster; ✗ a run that failed, ≠ a digest that differs from our Node's), the geometric means by source, and V8's
 * tiers taken apart. It rewrites the README between its two markers and nothing else.
 */
const main = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = path.join(import.meta.dirname, "..", "..", "..")
	const data = path.join(root, "data")
	const named = Arr.get(globalThis.process.argv, 2)
	const listed = yield* fs.readDirectory(data)
	const all = Arr.sort(listed, Str.Order)
	const run = yield* Effect.fromOption(Option.orElse(named, () => Arr.last(all)))
	const directory = path.join(data, run)
	const metaText = yield* fs.readFileString(path.join(directory, "meta.json"))
	const meta = yield* decodeMeta(metaText)
	const runsText = yield* fs.readFileString(path.join(directory, "runs.jsonl"))
	const runs = yield* Effect.forEach(linesOf(runsText), (line) => decodeRun(line))
	const deoptsText = yield* fs
		.readFileString(path.join(directory, "deopts.jsonl"))
		.pipe(Effect.orElseSucceed(() => ""))
	const deopts = yield* Effect.forEach(linesOf(deoptsText), (line) => decodeDeopt(line))
	const find = (engine: string, workload: string) =>
		Arr.findFirst(runs, (each) => each.engine === engine && each.workload === workload)
	const medianOf = (each: Run) => (each.nanos === undefined ? Number.NaN : median(each.nanos))
	const reference = (workload: string) => Option.map(find("node", workload), medianOf)
	const relative = (engine: string, workload: string) =>
		Option.flatMap(find(engine, workload), (each) =>
			Option.map(reference(workload), (base) => medianOf(each) / base)
		)
	const digestOf = (engine: string, workload: string) =>
		Option.flatMap(find(engine, workload), (each) => Option.fromUndefinedOr(each.digest))
	const others = Arr.drop(ENGINES, 1)
	const disagrees = (engine: string, workload: string) =>
		Option.exists(
			digestOf("node", workload),
			(reference) => !Option.contains(digestOf(engine, workload), reference)
		)
	const cell = (engine: string, workload: string) =>
		Option.match(find(engine, workload), {
			onNone: () => "–",
			onSome: (each) =>
				each.failure !== undefined
					? "✗"
					: `${Option.match(relative(engine, workload), { onNone: () => "–", onSome: ratio })}${
							disagrees(engine, workload) ? " ≠" : ""
						}`
		})
	const workloadRows = Arr.flatMap(MODULES, ({ module, workloads }) =>
		Arr.map(workloads, (workload) => {
			const bailouts = Option.match(
				Arr.findFirst(deopts, (each) => each.workload === workload.name),
				{ onNone: () => "–", onSome: (each) => `${each.bailouts}` }
			)
			const base = Option.match(reference(workload.name), { onNone: () => "–", onSome: ms })
			return `| ${module} | \`${workload.name}\` | ${base} | ${Arr.join(
				Arr.map(others, (engine) => cell(engine.name, workload.name)),
				" | "
			)} | ${bailouts} |`
		})
	)
	const geoFor = (engine: string, names: ReadonlyArray<string>) =>
		geomean(
			Arr.filterMap(names, (name) =>
				Option.match(relative(engine, name), {
					onNone: () => Result.failVoid,
					onSome: (value) => (Number.isFinite(value) ? Result.succeed(value) : Result.failVoid)
				})
			)
		)
	const everyName = Arr.flatMap(MODULES, ({ workloads }) => Arr.map(workloads, (w) => w.name))
	const geoRows = [
		...Arr.map(
			MODULES,
			({ module, workloads }) =>
				`| ${module} | ${Arr.join(
					Arr.map(others, (engine) =>
						ratio(
							geoFor(
								engine.name,
								Arr.map(workloads, (w) => w.name)
							)
						)
					),
					" | "
				)} |`
		),
		`| **all** | ${Arr.join(
			Arr.map(others, (engine) => `**${ratio(geoFor(engine.name, everyName))}**`),
			" | "
		)} |`
	]
	const tierGain = (slower: string, faster: string, names: ReadonlyArray<string>) =>
		geomean(
			Arr.filterMap(names, (name) => {
				const pair = Option.all([
					Option.map(find(slower, name), medianOf),
					Option.map(find(faster, name), medianOf)
				])
				return Option.match(pair, {
					onNone: () => Result.failVoid,
					onSome: ([a, b]) => (Number.isFinite(a / b) ? Result.succeed(a / b) : Result.failVoid)
				})
			})
		)
	const tierRows = Arr.map(MODULES, ({ module, workloads }) => {
		const names = Arr.map(workloads, (w) => w.name)
		const bailouts = Arr.filterMap(deopts, (each) =>
			Arr.contains(names, each.workload) ? Result.succeed(each.bailouts) : Result.failVoid
		)
		return `| ${module} | ${ratio(tierGain("node-jitless", "node-sparkplug", names))} | ${ratio(
			tierGain("node-sparkplug", "node-maglev", names)
		)} | ${ratio(tierGain("node-maglev", "node", names))} | ${ratio(tierGain("node-jitless", "node", names))} | ${
			bailouts.length === 0 ? "–" : `${median(bailouts)}`
		} |`
	})
	const engineRows = Arr.map(
		meta.engines,
		(engine) => `| ${engine.label} | \`${engine.name}\` | ${engine.version} |`
	)
	const section = Arr.join(
		[
			BEGIN,
			"",
			`Run ${meta.started} on ${meta.machine}: every workload ${meta.warmup} warm-up rounds then ${meta.timed} timed rounds in its own process, pinned to cores ${meta.cores}, the engines taking turns in rotating order. Times are medians of the timed rounds.`,
			"",
			"| Engine | Column | Version |",
			"| --- | --- | --- |",
			...engineRows,
			"",
			"### Every workload",
			"",
			"Our Node's median in milliseconds, then every other engine's median as a ratio to it: below 1× is faster than our Node. ✗ is a run that failed; ≠ is a result whose digest differs from our Node's. The last column counts V8's deoptimizations (`--trace-deopt` bailouts) over the run on our Node.",
			"",
			`| Source | Workload | node (ms) | ${Arr.join(
				Arr.map(others, (e) => e.name),
				" | "
			)} | deopts |`,
			`| --- | --- | ---: | ${Arr.join(
				Arr.map(others, () => "---:"),
				" | "
			)} | ---: |`,
			...workloadRows,
			"",
			"### Geometric means, by source",
			"",
			`| Source | ${Arr.join(
				Arr.map(others, (e) => e.name),
				" | "
			)} |`,
			`| --- | ${Arr.join(
				Arr.map(others, () => "---:"),
				" | "
			)} |`,
			...geoRows,
			"",
			"### V8's tiers, taken apart",
			"",
			"How much faster each tier makes our Node, as a geometric mean of the ratio of medians: Sparkplug over Ignition alone, Maglev over Sparkplug, TurboFan over Maglev, and every tier over Ignition alone, with the median deoptimization count.",
			"",
			"| Source | Sparkplug | + Maglev | + TurboFan | all tiers | deopts |",
			"| --- | ---: | ---: | ---: | ---: | ---: |",
			...tierRows,
			"",
			END
		],
		"\n"
	)
	const readmePath = path.join(root, "README.md")
	const readme = yield* fs.readFileString(readmePath)
	const [before] = Str.split(BEGIN)(readme)
	const after = Option.getOrElse(Arr.get(Str.split(END)(readme), 1), () => "\n")
	yield* fs.writeFileString(readmePath, `${before}${section}${after}`)
})

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))
