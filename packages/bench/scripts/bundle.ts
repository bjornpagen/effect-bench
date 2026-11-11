import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Array as Arr, Console, Effect, FileSystem, Path, Schema, String as Str } from "effect"
import { build } from "esbuild"

/** esbuild refused an entry: its message carries the file and the reason. */
class BundleRefused extends Schema.TaggedError<BundleRefused, { readonly brand: unique symbol }>()(
	"BundleRefused",
	{
		entry: Schema.String,
		cause: Schema.Defect()
	}
) {}

/**
 * `pnpm bundle`: every `src/workloads/<module>.entry.ts` bundled by esbuild into `dist/<module>.mjs`, one ESM file
 * that every engine runs unchanged. Nothing is minified, so names survive into bytecode and machine-code dumps;
 * `node:` modules stay imports, each engine providing its own.
 */
const main = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = path.resolve(import.meta.dirname, "..")
	const directory = path.join(root, "src/workloads")
	const names = yield* fs.readDirectory(directory)
	const entries = Arr.filter(names, Str.endsWith(".entry.ts"))
	yield* Effect.forEach(entries, (entry) =>
		Effect.tryPromise({
			try: () =>
				build({
					entryPoints: [path.join(directory, entry)],
					outfile: path.join(root, "dist", Str.replace(".entry.ts", ".mjs")(entry)),
					bundle: true,
					format: "esm",
					platform: "neutral",
					mainFields: ["module", "main"],
					target: "es2024",
					external: ["node:*"],
					minify: false,
					logLevel: "warning"
				}),
			catch: (cause) => BundleRefused.make({ entry, cause })
		}).pipe(Effect.andThen(Console.log(`bundled ${entry}`)))
	)
})

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))
