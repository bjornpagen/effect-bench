# effect-bench

How fast does idiomatic, generator-heavy Effect 4 code run when the engine underneath changes? effect-bench runs
real code from real codebases on nine engines and checks that every one of them computes the same answer:

- **Node 26.13.0 (ours)**: a hardened build (V8's heap sandbox, pointer compression, V8 control-flow integrity,
  Fedora's hardening flags), with every V8 tier, then with the tiers taken away one by one: no TurboFan, Sparkplug
  alone, and Ignition alone (`--jitless`).
- **Node 26.13.0 (upstream)**: the official linux-arm64 binary, same V8, without the sandbox or pointer
  compression; the control for our build.
- **LLRT 0.10.0-beta**: AWS's runtime on QuickJS-ng, an interpreter with no JIT at all.
- **Bun canary**: its JavaScriptCore JIT, and its new ahead-of-time compiler (`bun compile`), once fed the same
  JavaScript bundle and once fed the TypeScript sources, so its checker sees the types.

[AGENTS.md](AGENTS.md) is the working contract for anyone, human or agent, changing the code.

## The workloads

Every workload is code that runs in a real codebase every day, reached as a published package or harvested into
`harvest/` at a recorded commit and cut down only where a benchmark must (I/O dropped, inputs built in memory).

| Source                | Where it comes from                                                       | What runs                                                                                                         |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| testing               | superstarter's choice-stream property-testing engine (`packages/testing`) | generating, replaying, enumerating and shrinking cases                                                            |
| effect-xml            | `@aidenzepp/effect-xml` 0.2.0 from npm                                    | typed and untyped XML decoding through Effect Schema, round trips, streaming, refusals                            |
| qti-pie               | `aidenzepp/qti-pie` at `f5365d6` (crust and plate)                        | opening QTI 3.0 items and tests: XML, validation tables, model building                                           |
| grizzle               | grizzle's compiler at `e9227af`, with its own fixture schemas             | drafting each schema's first PostgreSQL migration, as `grizzle generate` does                                     |
| openapi-cli-generator | `aidenzepp/effect-openapi-cli-generator` at `ac03fdb`                     | loading, resolving, normalizing and importing an OpenAPI document into Effect Schema, then emitting an Effect CLI |
| edullm                | edullm at `261203b`                                                       | its PostgreSQL COPY-binary frame scanner, its BSON archive decoder, its passage briefs                            |
| superstarter          | superstarter at `326f1f8`                                                 | a day of todo server actions over their real wire contracts                                                       |

Each run prints a digest of its whole result; an engine that computes something else is marked ≠ below.

## Results

<!-- results:begin -->

Run 2026-11-11T06:09:47.465Z on an Apple M1 Mac mini (4 performance and 4 efficiency cores, 8 GB) running Fedora Asahi Linux with 16 KiB pages: every workload 10 warm-up rounds then 20 timed rounds in its own process, pinned to cores 4-7, the engines taking turns in rotating order. Times are medians of the timed rounds.

| Engine                    | Column           | Version                                                         |
| ------------------------- | ---------------- | --------------------------------------------------------------- |
| Node (ours, hardened)     | `node`           | v26.13.0 V8 14.6.202.34-node.40 sandbox=1 pointer-compression=1 |
| Node, no TurboFan         | `node-maglev`    | v26.13.0 V8 14.6.202.34-node.40 sandbox=1 pointer-compression=1 |
| Node, Sparkplug only      | `node-sparkplug` | v26.13.0 V8 14.6.202.34-node.40 sandbox=1 pointer-compression=1 |
| Node, Ignition only       | `node-jitless`   | v26.13.0 V8 14.6.202.34-node.40 sandbox=1 pointer-compression=1 |
| Node (upstream binary)    | `node-upstream`  | v26.13.0 V8 14.6.202.34-node.40 sandbox=0 pointer-compression=0 |
| LLRT                      | `llrt`           | LLRT v0.10.0-beta (linux, arm64)                                |
| Bun (JIT)                 | `bun-jit`        | 1.4.4-canary.1+89452d2ac                                        |
| Bun AOT (from the bundle) | `bun-aot-js`     | 1.4.4-canary.1+89452d2ac                                        |
| Bun AOT (from TypeScript) | `bun-aot-ts`     | 1.4.4-canary.1+89452d2ac                                        |

### Every workload

Our Node's median in milliseconds, then every other engine's median as a ratio to it: below 1× is faster than our Node. ✗ is a run that failed; ≠ is a result whose digest differs from our Node's. The last column counts V8's deoptimizations (`--trace-deopt` bailouts) over the run on our Node.

| Source                | Workload                              | node (ms) | node-maglev | node-sparkplug | node-jitless | node-upstream |    llrt | bun-jit | bun-aot-js | bun-aot-ts | deopts |
| --------------------- | ------------------------------------- | --------: | ----------: | -------------: | -----------: | ------------: | ------: | ------: | ---------: | ---------: | -----: |
| edullm                | `edullm-copy-binary-10000`            |      3.52 |       1.22× |         15.13× |       22.27× |         1.00× |  25.55× |   0.67× |      1.21× |      1.74× |     38 |
| edullm                | `edullm-bson-decode-2000`             |     26.47 |       1.12× |          2.40× |        3.17× |         1.05× |   4.23× |   0.79× |      0.70× |      0.66× |     33 |
| edullm                | `edullm-briefs-decode-1000`           |      5.78 |       1.23× |          4.80× |        7.35× |         1.93× |  12.21× |   0.56× |      0.75× |      0.68× |     31 |
| effect-xml            | `xml-decode-bank-40`                  |      0.46 |       1.00× |          4.22× |        6.34× |         1.44× |  10.81× |   0.90× |      0.78× |      0.74× |     12 |
| effect-xml            | `xml-decode-bank-640`                 |      4.92 |       1.24× |          4.56× |        9.04× |         1.44× |  15.48× |   0.75× |      0.86× |      0.86× |     39 |
| effect-xml            | `xml-decode-bank-10240`               |     85.65 |       1.28× |          4.37× |        8.50× |         1.39× |  14.65× |   0.66× |      0.81× |      0.81× |     44 |
| effect-xml            | `xml-roundtrip-bank-640`              |     11.74 |       1.27× |          5.80× |        8.63× |         1.54× |  14.70× |   0.74× |      0.87× |      0.86× |     51 |
| effect-xml            | `xml-tree-bank-640`                   |      3.51 |       1.42× |          6.54× |        9.72× |         1.40× |  16.09× |   0.71× |      0.82× |      0.90× |     67 |
| effect-xml            | `xml-stream-bank-640`                 |      6.26 |       1.28× |          5.82× |        9.42× |         1.44× |  16.17× |   0.78× |      0.92× |      0.88× |     33 |
| effect-xml            | `xml-refuse-bad-last-640`             |     12.79 |       1.21× |          6.24× |        9.22× |         1.50× |  15.88× |   0.89× |      1.07× |      0.99× |     70 |
| grizzle               | `grizzle-draft-platform`              |     79.93 |       1.11× |          2.56× |        3.66× |         1.24× |   5.70× |   1.09× |      0.75× |      0.73× |    152 |
| grizzle               | `grizzle-draft-billing`               |     85.67 |       1.13× |          2.51× |        3.57× |         1.25× |   5.64× |   1.10× |      0.73× |      0.69× |    179 |
| grizzle               | `grizzle-draft-payroll`               |     51.37 |       1.10× |          2.48× |        3.54× |         1.25× |   5.50× |   1.13× |      0.75× |      0.74× |    159 |
| grizzle               | `grizzle-draft-work`                  |      7.92 |       1.06× |          2.14× |        3.02× |         1.18× |   4.55× |   1.03× |      0.66× |      0.62× |     83 |
| grizzle               | `grizzle-draft-plans`                 |      3.94 |       1.04× |          2.06× |        2.89× |         1.25× |   4.30× |   1.06× |      0.56× |      0.51× |     75 |
| grizzle               | `grizzle-draft-queue`                 |     12.84 |       1.07× |          1.95× |        3.19× |         1.18× |   4.93× |   1.11× |      0.72× |      0.67× |     84 |
| grizzle               | `grizzle-draft-search`                |      4.10 |       1.06× |          2.14× |        3.03× |         1.24× | 4.60× ≠ |   1.06× |      0.58× |      0.55× |     79 |
| grizzle               | `grizzle-draft-ledger`                |      2.28 |       1.01× |          2.07× |        2.93× |         1.24× |   4.41× |   0.99× |      0.48× |      0.44× |     65 |
| grizzle               | `grizzle-draft-network`               |      3.26 |       1.08× |          2.10× |        2.97× |         1.26× |   4.54× |   1.10× |      0.56× |      0.53× |     68 |
| grizzle               | `grizzle-draft-schedule`              |      3.68 |       1.03× |          2.07× |        2.92× |         1.23× |   4.46× |   1.04× |      0.56× |      0.51× |     81 |
| grizzle               | `grizzle-draft-calendars`             |      4.15 |       1.06× |          2.13× |        2.98× |         1.22× |   4.58× |   1.08× |      0.60× |      0.54× |     60 |
| openapi-cli-generator | `openapi-rows-body`                   |     62.53 |       1.29× |          2.71× |        5.42× |         1.34× |       ✗ |   1.15× |      0.93× |      0.85× |    127 |
| openapi-cli-generator | `openapi-rows-doc`                    |     21.49 |       1.15× |          2.66× |        4.37× |         1.32× |       ✗ |   1.19× |      0.79× |      0.73× |     60 |
| openapi-cli-generator | `openapi-rows-dsc`                    |     21.16 |       1.22× |          2.79× |        4.55× |         1.36× |       ✗ |   1.33× |      0.85× |      0.79× |     59 |
| openapi-cli-generator | `openapi-rows-enc-fields`             |     34.73 |       1.29× |          3.22× |        5.27× |         1.41× |       ✗ |   1.23× |      0.90× |      0.84× |    100 |
| openapi-cli-generator | `openapi-rows-enc-rules`              |     38.07 |       1.28× |          2.66× |        5.30× |         1.40× |       ✗ |   1.24× |      0.90× |      0.82× |     67 |
| openapi-cli-generator | `openapi-rows-fmt`                    |     43.19 |       1.38× |          3.70× |        5.80× |         1.31× |       ✗ |   1.06× |      0.85× |      0.79× |     57 |
| openapi-cli-generator | `openapi-rows-prm`                    |     46.43 |       1.25× |          2.55× |        5.06× |         1.33× |       ✗ |   1.17× |      0.93× |      0.80× |     69 |
| openapi-cli-generator | `openapi-rows-pth`                    |     50.44 |       1.26× |          3.10× |        5.17× |         1.36× |       ✗ |   1.13× |      0.88× |      0.80× |     64 |
| openapi-cli-generator | `openapi-rows-ref`                    |      9.22 |       1.14× |          2.34× |        3.82× |         1.31× |       ✗ |   1.42× |      0.62× |      0.56× |     44 |
| openapi-cli-generator | `openapi-rows-rsp`                    |     27.98 |       1.18× |          2.89× |        4.70× |         1.38× |       ✗ |   1.13× |      0.84× |      0.77× |     44 |
| openapi-cli-generator | `openapi-rows-s30`                    |     46.04 |       1.28× |          3.16× |        5.22× |         1.35× |       ✗ |   1.16× |      0.91× |      0.83× |     98 |
| openapi-cli-generator | `openapi-rows-sch-a`                  |     60.02 |       1.31× |          3.45× |        5.69× |         1.40× |       ✗ |   1.12× |      0.94× |      0.87× |    113 |
| openapi-cli-generator | `openapi-rows-sch-b`                  |     42.21 |       1.27× |          3.31× |        5.49× |         1.34× |       ✗ |   1.17× |      0.92× |      0.84× |     67 |
| openapi-cli-generator | `openapi-rows-sec`                    |     16.36 |       1.19× |          2.76× |        4.55× |         1.38× |       ✗ |   1.31× |      0.77× |      0.72× |     38 |
| openapi-cli-generator | `openapi-rows-srv`                    |      7.71 |       1.15× |          2.43× |        4.02× |         1.32× |       ✗ |   1.24× |      0.62× |      0.57× |     30 |
| openapi-cli-generator | `openapi-rows-ssc`                    |     16.36 |       1.18× |          2.75× |        4.55× |         1.37× |       ✗ |   1.28× |      0.77× |      0.70× |     24 |
| openapi-cli-generator | `openapi-rows-sty-cookie-querystring` |     15.96 |       1.18× |          2.59× |        4.26× |         1.34× |       ✗ |   1.37× |      0.72× |      0.67× |     44 |
| openapi-cli-generator | `openapi-rows-sty-path-query-header`  |     89.56 |       1.29× |          3.31× |        5.54× |         1.42× |       ✗ |   1.12× |      0.92× |      0.86× |     97 |
| qti-pie               | `qti-open-item-4`                     |      0.90 |       0.94× |          1.78× |        2.59× |         1.47× |   4.21× |   0.99× |      0.76× |      0.55× |     25 |
| qti-pie               | `qti-open-item-64`                    |      2.21 |       1.09× |          3.50× |        5.13× |         1.67× |   8.25× |   1.12× |      0.91× |      0.74× |     31 |
| qti-pie               | `qti-open-item-512`                   |     12.45 |       1.29× |          4.28× |        6.30× |         1.53× |  10.21× |   1.10× |      1.13× |      0.93× |    123 |
| qti-pie               | `qti-open-test-100`                   |      2.20 |       1.12× |          3.99× |        5.94× |         1.73× |  10.37× |   1.16× |      1.01× |      0.78× |     45 |
| qti-pie               | `qti-open-test-1000`                  |     17.24 |       1.36× |          4.81× |        7.22× |         1.32× |  12.61× |   1.04× |      1.18× |      0.93× |    208 |
| superstarter          | `superstarter-todo-actions-200`       |     41.38 |       1.02× |          1.62× |        2.66× |         1.25× |   4.13× |   0.59× |      0.50× |      0.50× |     44 |
| testing               | `testing-generate`                    |      7.33 |       1.21× |          2.90× |        4.25× |         0.64× |   5.90× |   0.22× |      0.24× |      0.29× |     14 |
| testing               | `testing-replay`                      |      2.32 |       0.80× |          1.47× |        1.99× |         0.66× |   4.14× |   0.30× |      0.19× |      0.23× |     37 |
| testing               | `testing-count`                       |      3.22 |       1.00× |          1.38× |        1.97× |         0.64× |   3.79× |   0.13× |      0.18× |      0.18× |      6 |
| testing               | `testing-shrink`                      |      0.32 |       1.14× |          2.10× |        3.39× |         0.78× |   4.75× |   0.48× |      0.50× |      0.44× |      5 |

### Geometric means, by source

| Source                | node-maglev | node-sparkplug | node-jitless | node-upstream |      llrt |   bun-jit | bun-aot-js | bun-aot-ts |
| --------------------- | ----------: | -------------: | -----------: | ------------: | --------: | --------: | ---------: | ---------: |
| edullm                |       1.19× |          5.59× |        8.04× |         1.27× |    10.97× |     0.67× |      0.86× |      0.92× |
| effect-xml            |       1.24× |          5.29× |        8.62× |         1.45× |    14.71× |     0.77× |      0.87× |      0.86× |
| grizzle               |       1.07× |          2.19× |        3.14× |         1.23× |     4.81× |     1.07× |      0.63× |      0.59× |
| openapi-cli-generator |       1.24× |          2.89× |        4.90× |         1.36× |         – |     1.21× |      0.83× |      0.76× |
| qti-pie               |       1.15× |          3.48× |        5.14× |         1.54× |     8.57× |     1.08× |      0.99× |      0.77× |
| superstarter          |       1.02× |          1.62× |        2.66× |         1.25× |     4.13× |     0.59× |      0.50× |      0.50× |
| testing               |       1.02× |          1.88× |        2.74× |         0.68× |     4.58× |     0.25× |      0.25× |      0.27× |
| **all**               |   **1.16×** |      **3.00×** |    **4.69×** |     **1.28×** | **7.28×** | **0.91×** |  **0.72×** |  **0.67×** |

### V8's tiers, taken apart

How much faster each tier makes our Node, as a geometric mean of the ratio of medians: Sparkplug over Ignition alone, Maglev over Sparkplug, TurboFan over Maglev, and every tier over Ignition alone, with the median deoptimization count.

| Source                | Sparkplug | + Maglev | + TurboFan | all tiers | deopts |
| --------------------- | --------: | -------: | ---------: | --------: | -----: |
| edullm                |     1.44× |    4.70× |      1.19× |     8.04× |     33 |
| effect-xml            |     1.63× |    4.28× |      1.24× |     8.62× |     44 |
| grizzle               |     1.43× |    2.05× |      1.07× |     3.14× |     81 |
| openapi-cli-generator |     1.70× |    2.34× |      1.24× |     4.90× |     62 |
| qti-pie               |     1.48× |    3.03× |      1.15× |     5.14× |     45 |
| superstarter          |     1.64× |    1.59× |      1.02× |     2.66× |     44 |
| testing               |     1.46× |    1.84× |      1.02× |     2.74× |     10 |

<!-- results:end -->

### What it says

**Higher-order Effect code is not bad for a JIT; it is where a JIT pays most.** Taking V8's tiers away one by one,
Effect's own machinery gains the most from compilation: everything over Ignition alone is 8.6× on effect-xml's Schema
decoding and 8.0× on edullm's scanners and decoders, against 3.1× on grizzle's compiler, which is mostly plain
TypeScript over Maps and arrays. An interpreter pays its dispatch, call-frame and allocation costs on every one of
Effect's small calls, generator resumes and short-lived objects; a JIT removes most of them even where it cannot
inline.

**What is true in the myth is narrower: TurboFan adds little, and not only to Effect code.** Maglev, V8's fast
optimizing tier, gives 1.6–4.7× over Sparkplug; TurboFan on top of it adds 1.02–1.24×, and 1.07× even on grizzle's
plain code. Speculative inlining across megamorphic call sites is where the last tier would earn its keep, and on
code shaped like this, Effect or not, it has little left to find. Deoptimizations do not track Effect either:
grizzle's compiler bails out more often (a median of 81 per run) than effect-xml (44), edullm (33) or superstarter's
actions (44).

**Bun's ahead-of-time compiler is the fastest engine here: 0.67× our Node's time over all 49 workloads, 0.50–0.59× on grizzle's compiler and superstarter's server actions.** Compiling from TypeScript beats
compiling from the bundle (0.67× against 0.72×; qti-pie 0.77× against 0.99×), since the checker fixes object shapes
the bundle leaves open. Bun's JIT on the same bundle is level with our Node overall (0.91×) and slower on the
library-heavy sources.

**Our hardened Node is faster than upstream's binary, not slower: upstream takes 1.28× our time.** The heap sandbox
and V8's signed code cost less than pointer compression saves, since compressed pointers halve the heap's size and
keep more of it in cache. The one exception is the testing engine (upstream 0.68×), whose tapes are numbers in
typed arrays; there Bun runs four times faster than our Node, and nearly three times faster than upstream's.

**LLRT is an interpreter, and it shows: 7.3× our Node's time, from 4–6× on grizzle's compiler to 25× on a
byte-at-a-time stream.** It also gets two things wrong:

- **Numbers.** LLRT replaces `Number.prototype.toString` and `JSON.stringify` with Rust's `ryu`, which writes
  `9.223372036854776e18`, `1e-6` and `1.2345678901234568e20` where ECMA-262 requires `9223372036854776000`,
  `0.000001` and `123456789012345680000`; `String(x)` still goes through QuickJS and is right. grizzle writes such a
  number into a migration's snapshot, so on LLRT the `search` schema drafts a different migration (≠ above).
- **`Intl`.** LLRT's default build has none, and Effect's `effect/cli` creates an `Intl.Segmenter` as it loads, so the
  OpenAPI generator cannot start (✗ above). LLRT's `intl402` feature adds it.

Pinning matters: before runs were pinned to the performance cores, the same workloads timed up to 3.4× slower on our
Node, depending on which cluster the scheduler chose.

## Running it

```sh
pnpm install
pnpm --filter @effect-bench/bench bundle            # one ESM bundle per source in packages/bench/dist
pnpm --filter @effect-bench/bench matrix <root> <cores> <warmup> <timed> "<machine>" [via]
pnpm --filter @effect-bench/bench report            # rewrites the Results section from the latest run in data/
```

`<root>` is a directory on the bench machine holding `bin/` (`node-ours`, `node-upstream`, `llrt`, `bun`),
`bench/` (the bundles) and `aot/` (each source's `bun compile` executables: `<source>-js-aot` from its bundle,
`<source>-ts-aot` from `packages/bench/src/workloads/<source>.entry.ts`). `via` is a command that runs one shell
line on the bench machine when that is another machine. A single workload runs as
`<engine> <bundle> <workload> <warmup> <timed>`, and `<bundle> list` prints a bundle's workloads.

## License

0BSD. See [LICENSE](LICENSE).
