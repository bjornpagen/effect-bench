# Working in effect-bench

effect-bench measures how idiomatic, generator-heavy Effect 4 code runs on different JavaScript engines and
compilers: Node (V8, its JIT tiers one by one), LLRT (QuickJS-ng, an interpreter), Bun (JavaScriptCore) and Bun's
ahead-of-time compiler. Every workload is real code from a real codebase, reached as a dependency, run on inputs
built in memory, and checked: each run prints a digest of its result, and every engine must print the same one.
This repository holds the workloads, the harness and the reports; the engines are built and run elsewhere.

## Code is the documentation

Code, types and lint rules are the documentation. The only comments are JSDoc on declarations and the
comments other tools read (license headers, `#__PURE__`, bundler hints, triple-slash references, formatter
ignores): oxlint's `no-comment` rule refuses every other comment, and `pnpm format:write` deletes them with its
fix. Write JSDoc and Markdown only for what code cannot express: why a design exists, what it rejects, and
outside facts. They state rules in plain words and never narrate history or cite documents.

Lint (oxlint, superlint) and Effect's diagnostics record owner decisions: strengthen them, never weaken them to
let code through. Inline suppressions are refused (`no-inline-suppression`); a file a rule must spare is named in
config. Rules rejected on purpose live in `REJECTED` in the dev tools' preset, and Effect's diagnostics in
`REJECTED_DIAGNOSTICS`, each with its reason. They are off in every block, naming one in a block is a type error,
and turning one back on needs the owner. A rule that forces worse code is rejected, never kept with an allow-list
or worked around.

## Design

- **Representation over control flow.** When a new case appears, change the types so it stops being
  special or stops being expressible, instead of adding a branch, flag, guard or sentinel. Parse at the
  boundary once; never re-validate inside. Absence is a variant or an `Option`, never a fallback.
- **Delete before you add.** A fix removes the cause. A new rule, guard or branch needs evidence that
  deleting something could not do the job.
- **Hard cutovers.** A change replaces the old way everywhere in one go: no shims, aliases or readers of an
  old form.
- **Real code, harvested.** A workload runs the code a real codebase runs every day: a published library through its
  npm package, and anything else copied into `harvest/<name>/` at a recorded commit, one workspace package per source,
  cut down only where a benchmark must (I/O dropped, inputs built in memory). Harvested code keeps its own style:
  the root tsconfig turns every Effect diagnostic off under `harvest/`, oxfmt and fallow's dead-code report skip it,
  and it is still type-checked. Nothing is rewritten to suit an engine: an engine that cannot run the code as written
  is a finding.
- **One bundle, every engine.** A workload's hot path touches no Node built-in, file, network, clock or
  randomness it was not handed: inputs are built in memory from seeds, and the same bundle runs unchanged on every
  engine.
- **A measurement is never a verdict.** Timings never gate and never cache. What gates is correctness: the
  digests agree, and the workloads' property tests pass.
- **Libraries as they are meant to be used.** Prefer what Effect already does over a home-rolled version; when
  in doubt, go with what Effect does.

## Workspace

A Turborepo workspace. Every package sits at `packages/<name>`, is named `@effect-bench/<name>`, and exports
its raw TypeScript (no build step):

- `packages/json`: the JSON door: the `Json` type and `jsonTextOf`, total over it, whose text is
  `JSON.stringify`'s. On Effect alone, and depending on no workspace package, since the dev tools import it too.
- `packages/devtools`: the dev tools: the lint preset (`lintConfig`, `REJECTED`, `REJECTED_DIAGNOSTICS`), the
  tsconfig base and its Effect-free variant, the oxlint plugin and superlint, each with its fixtures, as the bin
  `superlint`.
- `packages/testing`: the choice-stream testing library every suite runs on, with `pnpm fuzz` and `pnpm mutate`.
- `packages/bench`: the harness and the workloads. Each `src/workloads/<module>.ts` exports a `WORKLOADS` roster,
  `pnpm bundle` makes each `<module>.entry.ts` one ESM file in `dist/`, and a run is
  `<engine> dist/<module>.mjs <workload> <warmup> <timed>`, printing one JSON line.
- `harvest/<name>`: code copied from other codebases at a recorded commit (its `package.json` says where from).
- The root holds `oxlint.config.ts` (this repository's own lists for the preset), the superlint options in
  `package.json`, `turbo.json`, and the `tsconfig.json` every package extends: it extends the dev tools' base and
  is the repository's one Effect plugin block.

Inside a package, import through its own `#` map with the real extension; across packages, import the
other package's export by name, without an extension (`@effect-bench/testing/explore`).

A package that uses no Effect opts out of it in three places, which the root superlint holds together: its
directory goes on `superlint.effectFree` in the root `package.json`, its tsconfig extends
`@effect-bench/devtools/tsconfig.effect-free.json` (the base without the plugin), and its `package.json` depends
on no `effect` or `@effect/*` package. oxlint then runs the preset's Effect-free block over it (no `try`, no
`new Error`, no `async`, strict booleans, no `console`, no `process.env`, no `Math.random`), and every package not
listed extends the root tsconfig. No package is Effect-free today.

## Toolchain

- Node 26 runs TypeScript directly by type stripping; pnpm installs. A script is `node <file>.ts`.
- Nothing is configured twice. Every external dependency's version lives once, in the strict pnpm catalog
  (`pnpm-workspace.yaml`), and a package names it `catalog:`. The root's `devEngines` admits Node 26 and newer, and
  `@types/node` is 26's. pnpm's settings live in `pnpm-workspace.yaml` (exact saves, strict engines, a day's
  release age, its supply-chain policy), never in an `.npmrc`. A dependency the policy refuses is investigated,
  never installed around.
- TypeScript 7.1 beta with Effect's language service built in, from `@effect/tsgo`. The gate's typechecks run
  `effect-tsgo tsrs`: Effect's build of tsrs, the oxc project's Rust port of the TypeScript 7 compiler.
  `pnpm install` runs `effect-tsgo patch`, which swaps Effect's build of the Go compiler into `node_modules` for
  editors and superlint. oxlint's type-aware rules run on tsgolint's own TypeScript-Go. The tsconfig base lists
  every diagnostic the installed `@effect/tsgo` ships, every one an error except those in `REJECTED_DIAGNOSTICS`,
  and the root superlint holds the list to the plugin's own roster, so a diagnostic a release adds is listed or the
  gate fails. The root `tsconfig.json` restates the plugin once, and its `overrides` hold every per-file exception.
- `pnpm check` is the gate. The pre-commit hook runs it, skipped during merges and rebases, and the pre-push
  hook runs it again over every commit a push carries; both run only the pinned lefthook. It is `turbo run` over
  every package's typecheck, superlint and oxlint, the dev tools' fixture suites, and the root's repo-wide tasks:
  oxfmt in check mode (`format`), the root superlint (which also runs the tsconfig gate), fallow (`dead-code` and
  `architecture`) and `dedupe`. Nothing in the gate writes files; `pnpm format:write` does. A rule that can live in
  oxlint lives there; superlint keeps the rules that need types.
- fallow holds the architecture: import cycles, zone boundaries and policy rules. `.fallowrc.json` puts every
  file in a zone (`requireAllFiles`), and a zone imports only what its rule allows. A new import across zones is a
  decision: widen the rule on purpose or move the code. Every fallow suppression carries its reason.

## Conventions

- **Imports.** Inside a package, only through its `#` subpath imports with their real extension; across
  packages, by package export. No relative imports and no dynamic imports. Effect is imported from its barrel:
  `import { Effect, Schema } from "effect"`.
- **Names.** kebab-case files. A Schema and its type share one name. Errors are `Schema.TaggedError` classes
  named `<Subject><State>`, tag equal to class name. Closed results are `kind` unions with kebab-case values.
  Rosters are SCREAMING plurals with a derived singular type.
- **Functions.** Arrow consts and inline exports, as plain functions: no overloads, no default or optional
  parameters. A function that returns an Effect is an `Effect.fn`.
- **Effect.** Effect is the internal currency. `Effect.provide` happens once, at an entry point. Effect's
  diagnostics refuse `async`, `try` in Effect code, a Node built-in Effect's platform covers, `Math.random`,
  `Date`, timers, `console`, `fetch` and `process.env`: use Effect and its FileSystem and ChildProcess, `Random`,
  `DateTime`/`Clock`, `Effect.sleep`, `Effect.log*` and `Config`. Native array, record and string methods give way
  to Effect's `Array`, `Record` and `String`, JSON from outside is read through a Schema and JSON text is written
  through `jsonTextOf` (`@effect-bench/json`), and nested calls become a pipe where Effect suggests one. A fallback
  for a nullable value is `??`, never `||`. Regular expressions go through arkregex.
- **Code doors.** A module only some files may import is a door in `oxlint.config.ts`'s `import-doors`. A brand is
  minted only in the module that declares it (`brands-sole-mint`). A test names an error's tag or a roster's member
  through its type, never as a bare string the compiler cannot check (`unchecked-vocabulary-literal`). No call
  spreads a variable-length list into its arguments (`no-spread-argument`). Every literal that bounds concurrency,
  retries, timeouts, batch size or budget carries its evidence as `@limitKind` JSDoc, and one that has none is
  reported, never given invented evidence (`.agents/skills/indefensible-numbers`).
- **Tests.** Tests run on Vitest through `@effect-bench/testing`, the choice-stream library in
  `packages/testing`: a property draws its inputs from generators (`explore`, `exhaust` over a finite space,
  `commands` for a state machine), and a fact with no input space is a plain `it.effect`. A run's seed comes from
  `TEST_SEED` or a fresh draw and prints first; a failure prints its replay token and a kept-case literal. Kept
  cases in code are the only permanent record, pasted by a person. `pnpm mutate` measures a suite by source
  mutation, never a gate. Every test process runs under the library's `HARDENED_FLAGS`. The library's lint rules
  refuse example tables, fixed seeds, sleeps, wall-clock verdicts, error prose, serialized and order-blind
  comparisons, bare boolean asserts, mocks, snapshots and retries.

## Working here

- Commit only when asked. Leave others' uncommitted changes untouched.
