import { jsonTextOf } from "@effect-bench/json"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import {
	Array as Arr,
	Console,
	DateTime,
	Effect,
	FileSystem,
	Option,
	Path,
	Schema,
	Stdio,
	String as Str
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ENGINES, type Engine } from "#engines.ts"
import { MODULES } from "#modules.ts"

/** A count of rounds, as a command line spells it. */
const RoundCount = Schema.FiniteFromString.check(Schema.isInt32(), Schema.isGreaterThanOrEqualTo(0))

/**
 * `pnpm matrix <root> <cores> <warmup> <timed> <machine> [via]`: every workload of every module on every engine,
 * each run its own process pinned to `cores` (taskset), run from the bench root `root` on the bench machine, through
 * `via` when that machine is another one (a command that runs one shell line there, such as an ssh wrapper). The
 * engines take turns, their order rotated from one workload to the next, so no engine always runs first. Every
 * result goes to `data/<started>/runs.jsonl` as it lands, and `meta.json` records the machine, the rounds and each
 * engine's version. A last pass runs every workload once more on our Node with `--trace-deopt` and counts V8's
 * bailouts into `deopts.jsonl`. `pnpm report` turns a run into the README's tables.
 */
const Arguments = Schema.TupleWithRest(
	Schema.Tuple([
		Schema.NonEmptyString,
		Schema.NonEmptyString,
		RoundCount,
		RoundCount,
		Schema.NonEmptyString
	]),
	[Schema.NonEmptyString]
)

/** A word as POSIX sh reads it back exactly. */
const quoted = (word: string) => `'${Str.replaceAll("'", `'"'"'`)(word)}'`

/** The JSON line a run's harness prints last, if it printed one. */
const reportOf = (output: string) =>
	Arr.findLast(Str.split("\n")(output), Str.startsWith('{"workload"'))

const main = Effect.gen(function* () {
	const stdio = yield* Stdio.Stdio
	const args = yield* stdio.args
	const decoded = yield* Schema.decodeUnknownEffect(Arguments)(args)
	const [root, cores, warmup, timed, machine, ...rest] = decoded
	const via = Arr.head(rest)
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const now = yield* DateTime.now
	const started = DateTime.formatIso(now)
	const directory = path.join(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"data",
		Str.replaceAll(":", "-")(started)
	)
	yield* fs.makeDirectory(directory, { recursive: true })
	const viaWords = Option.match(via, { onNone: () => [], onSome: Str.split(" ") })
	const shell = (line: string) =>
		Option.match(Arr.head(viaWords), {
			onNone: () => ChildProcess.make("sh", ["-c", line]),
			onSome: (program) => ChildProcess.make(program, [...Arr.drop(viaWords, 1), line])
		})
	const runLine = (words: ReadonlyArray<string>) =>
		spawner.string(shell(`cd ${quoted(root)} && ${Arr.join(Arr.map(words, quoted), " ")}`), {
			includeStderr: true
		})
	const versions = yield* Effect.forEach(ENGINES, (engine) =>
		Effect.map(runLine(engine.version), (output) => [engine.name, Str.trim(output)] as const)
	)
	yield* fs.writeFileString(
		path.join(directory, "meta.json"),
		jsonTextOf({
			started,
			machine,
			cores,
			warmup,
			timed,
			engines: Arr.map(ENGINES, (engine) => ({
				name: engine.name,
				label: engine.label,
				version: Arr.findFirst(versions, ([name]) => name === engine.name).pipe((found) =>
					found._tag === "Some" ? found.value[1] : ""
				)
			}))
		})
	)
	const runs = path.join(directory, "runs.jsonl")
	const workloads = Arr.flatMap(MODULES, ({ module, workloads: roster }) =>
		Arr.map(roster, (workload) => ({ module, workload: workload.name }))
	)
	const turn = (engine: Engine, module: string, workload: string) =>
		Effect.gen(function* () {
			const output = yield* runLine([
				"taskset",
				"-c",
				cores,
				"timeout",
				"1800",
				...engine.command(module),
				workload,
				`${warmup}`,
				`${timed}`
			])
			const line = reportOf(output)
			const record =
				line._tag === "Some"
					? `{"engine":${jsonTextOf(engine.name)},"module":${jsonTextOf(module)},${Str.slice(1)(line.value)}`
					: jsonTextOf({ engine: engine.name, module, workload, failure: Str.slice(-2000)(output) })
			yield* fs.writeFileString(runs, `${record}\n`, { flag: "a" })
			yield* Console.log(`${line._tag === "Some" ? "ok  " : "FAIL"} ${engine.name} ${workload}`)
		})
	yield* Effect.forEach(
		Arr.map(workloads, (each, index) => ({ ...each, index })),
		({ module, workload, index }) =>
			Effect.forEach(
				Arr.appendAll(
					Arr.drop(ENGINES, index % ENGINES.length),
					Arr.take(ENGINES, index % ENGINES.length)
				),
				(engine) => turn(engine, module, workload)
			)
	)
	const deopts = path.join(directory, "deopts.jsonl")
	yield* Effect.forEach(workloads, ({ module, workload }) =>
		Effect.gen(function* () {
			const output = yield* runLine([
				"taskset",
				"-c",
				cores,
				"timeout",
				"1800",
				"bin/node-ours",
				"--trace-deopt",
				`bench/${module}.mjs`,
				workload,
				`${warmup}`,
				`${timed}`
			])
			const bailouts = Arr.filter(Str.split("\n")(output), Str.includes("[bailout")).length
			yield* fs.writeFileString(deopts, `${jsonTextOf({ module, workload, bailouts })}\n`, {
				flag: "a"
			})
			yield* Console.log(`deopts ${workload} ${bailouts}`)
		})
	)
	yield* Console.log(`matrix written to ${directory}`)
})

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))
