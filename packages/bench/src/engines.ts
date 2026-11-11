/**
 * One engine of the matrix: the command, relative to the bench root, that runs one module's workloads, and the one
 * that reports its version. The bench root holds `bin/` (node-ours, node-upstream, llrt, bun), `bench/` (the
 * bundles) and `aot/` (Bun's AOT executables, `<module>-js-aot` from the bundle and `<module>-ts-aot` from the
 * TypeScript entry).
 */
export type Engine = Readonly<{
	name: string
	label: string
	command: (module: string) => ReadonlyArray<string>
	version: ReadonlyArray<string>
}>

const nodeVersion = (binary: string): ReadonlyArray<string> => [
	binary,
	"-p",
	'process.version + " V8 " + process.versions.v8 + " sandbox=" + process.config.variables.v8_enable_sandbox + " pointer-compression=" + process.config.variables.v8_enable_pointer_compression'
]

const OURS = "bin/node-ours"

const bundle = (module: string) => `bench/${module}.mjs`

/** Every engine the matrix runs, the reference first: our hardened Node with every V8 tier on. */
export const ENGINES: ReadonlyArray<Engine> = [
	{
		name: "node",
		label: "Node (ours, hardened)",
		command: (module) => [OURS, bundle(module)],
		version: nodeVersion(OURS)
	},
	{
		name: "node-maglev",
		label: "Node, no TurboFan",
		command: (module) => [OURS, "--no-turbofan", bundle(module)],
		version: nodeVersion(OURS)
	},
	{
		name: "node-sparkplug",
		label: "Node, Sparkplug only",
		command: (module) => [OURS, "--no-maglev", "--no-turbofan", bundle(module)],
		version: nodeVersion(OURS)
	},
	{
		name: "node-jitless",
		label: "Node, Ignition only",
		command: (module) => [OURS, "--jitless", bundle(module)],
		version: nodeVersion(OURS)
	},
	{
		name: "node-upstream",
		label: "Node (upstream binary)",
		command: (module) => ["bin/node-upstream", bundle(module)],
		version: nodeVersion("bin/node-upstream")
	},
	{
		name: "llrt",
		label: "LLRT",
		command: (module) => ["bin/llrt", bundle(module)],
		version: ["bin/llrt", "--version"]
	},
	{
		name: "bun-jit",
		label: "Bun (JIT)",
		command: (module) => ["bin/bun", bundle(module)],
		version: ["bin/bun", "--revision"]
	},
	{
		name: "bun-aot-js",
		label: "Bun AOT (from the bundle)",
		command: (module) => [`aot/${module}-js-aot`],
		version: ["bin/bun", "--revision"]
	},
	{
		name: "bun-aot-ts",
		label: "Bun AOT (from TypeScript)",
		command: (module) => [`aot/${module}-ts-aot`],
		version: ["bin/bun", "--revision"]
	}
]
